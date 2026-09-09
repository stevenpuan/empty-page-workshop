-- ============================================================
-- S3: 工序派工與看板 — 排程、日誌、Realtime、看板支援
-- 相依: 006_orders.sql (order_tasks, orders)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. order_task_logs — 工序異動日誌（每次狀態變更自動記錄）
-- ────────────────────────────────────────────────────────────
create table if not exists public.order_task_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  order_task_id uuid not null references public.order_tasks(id) on delete cascade,
  order_id      uuid not null references public.orders(id),
  old_status    text,
  new_status    text not null,
  changed_by    uuid references public.employees(id),
  reason        text,          -- 卡關原因、跳過理由等
  created_at    timestamptz not null default now()
);

comment on table public.order_task_logs is '工序狀態異動日誌，由 trigger 自動寫入';

-- 索引：依工序查日誌、依訂單查日誌、依時間排序
create index if not exists idx_otl_task    on public.order_task_logs(order_task_id, created_at);
create index if not exists idx_otl_order   on public.order_task_logs(order_id, created_at);
create index if not exists idx_otl_company on public.order_task_logs(company_id);

-- RLS
alter table public.order_task_logs enable row level security;

drop policy if exists "otl_read" on public.order_task_logs;
create policy "otl_read" on public.order_task_logs
  for select using (company_id = current_company_id());

-- 日誌只由 trigger 寫入（security definer），前端不直接 insert
drop policy if exists "otl_insert_system" on public.order_task_logs;
create policy "otl_insert_system" on public.order_task_logs
  for insert with check (
    company_id = current_company_id() and is_manager()
  );

-- ────────────────────────────────────────────────────────────
-- 2. Trigger: 工序狀態變更時自動寫日誌
-- ────────────────────────────────────────────────────────────
create or replace function public.trg_task_status_log_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 只在 status 實際改變時才寫日誌
  if OLD.status is distinct from NEW.status then
    insert into public.order_task_logs(
      company_id, order_task_id, order_id,
      old_status, new_status, changed_by, reason
    ) values (
      NEW.company_id,
      NEW.id,
      NEW.order_id,
      OLD.status,
      NEW.status,
      public.current_employee_id(),  -- fix: 避免 set_updated_at trigger 覆寫為 auth.uid()
      case
        when NEW.status = 'blocked' then NEW.blocked_reason
        else null
      end
    );

    -- 自動填充時間戳
    if NEW.status = 'in_progress' and OLD.status <> 'in_progress'
       and NEW.started_at is null then
      NEW.started_at := now();
    end if;

    if NEW.status = 'done' and OLD.status <> 'done'
       and NEW.done_at is null then
      NEW.done_at := now();
    end if;

    if NEW.status = 'outsourced' and OLD.status <> 'outsourced'
       and NEW.outsourced_at is null then
      NEW.outsourced_at := now();
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_task_status_log on public.order_tasks;
create trigger trg_task_status_log
  before update on public.order_tasks
  for each row
  execute function public.trg_task_status_log_fn();

-- ────────────────────────────────────────────────────────────
-- 3. 狀態轉換驗證 trigger
--    確保只有合法的狀態轉換才能執行
-- ────────────────────────────────────────────────────────────
create or replace function public.trg_task_transition_check_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean := false;
begin
  -- status 沒變就直接放行
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  -- 合法轉換矩陣（依 SA/SD 7.1 狀態機）
  v_valid := case
    -- pending 起始狀態
    when OLD.status = 'pending'           and NEW.status in ('assigned','in_progress','skipped')         then true
    -- assigned 已指派
    when OLD.status = 'assigned'          and NEW.status in ('in_progress','skipped')                    then true
    -- in_progress 進行中
    when OLD.status = 'in_progress'       and NEW.status in ('done','blocked','waiting_customer','outsourced','skipped') then true
    -- blocked 卡關
    when OLD.status = 'blocked'           and NEW.status in ('in_progress','skipped')                    then true
    -- waiting_customer 等客戶校稿
    when OLD.status = 'waiting_customer'  and NEW.status in ('in_progress','skipped')                    then true
    -- outsourced 已送外包
    when OLD.status = 'outsourced'        and NEW.status in ('done','in_progress')                       then true
    else false
  end;

  if not v_valid then
    raise exception 'invalid_status_transition: % → %', OLD.status, NEW.status
      using errcode = 'P0002';
  end if;

  -- blocked 必須填理由
  if NEW.status = 'blocked' and (NEW.blocked_reason is null or trim(NEW.blocked_reason) = '') then
    raise exception 'blocked_reason is required when status = blocked'
      using errcode = 'P0003';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_task_transition_check on public.order_tasks;
create trigger trg_task_transition_check
  before update on public.order_tasks
  for each row
  execute function public.trg_task_transition_check_fn();

-- ────────────────────────────────────────────────────────────
-- 4. 看板用效能索引
-- ────────────────────────────────────────────────────────────
create index if not exists idx_ot_board
  on public.order_tasks(company_id, status)
  where status not in ('done','skipped');

create index if not exists idx_ot_assignee
  on public.order_tasks(assignee_id, status)
  where assignee_id is not null;

create index if not exists idx_ot_due
  on public.order_tasks(company_id, due_at)
  where status not in ('done','skipped');

create index if not exists idx_ot_order
  on public.order_task_logs(order_task_id);

-- ────────────────────────────────────────────────────────────
-- 5. 將 order_tasks 加入 Realtime publication
-- ────────────────────────────────────────────────────────────
do $$
begin
  -- 先檢查是否已在 publication 中
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_tasks'
  ) then
    alter publication supabase_realtime add table public.order_tasks;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. staff 操作函式：開始 / 完成 / 卡關
--    security definer 繞過 RLS 寫日誌，但仍驗證 assignee
-- ────────────────────────────────────────────────────────────

-- 6a. 開始工序
create or replace function public.task_start(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_emp  uuid := current_employee_id();
begin
  select * into v_task from order_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0004';
  end if;

  -- 驗證是自己負責的工序，或者是 manager
  if v_task.assignee_id is distinct from v_emp and not is_manager() then
    raise exception 'not_your_task' using errcode = 'P0005';
  end if;

  -- 公司隔離
  if v_task.company_id <> current_company_id() then
    raise exception 'company_mismatch' using errcode = 'P0006';
  end if;

  update order_tasks
  set status = 'in_progress',
      updated_by = v_emp,
      updated_at = now()
  where id = p_task_id;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'new_status', 'in_progress');
end;
$$;

-- 6b. 完成工序
create or replace function public.task_done(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task   record;
  v_emp    uuid := current_employee_id();
  v_order  record;
  v_all_done boolean;
begin
  select * into v_task from order_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0004';
  end if;

  if v_task.assignee_id is distinct from v_emp and not is_manager() then
    raise exception 'not_your_task' using errcode = 'P0005';
  end if;

  if v_task.company_id <> current_company_id() then
    raise exception 'company_mismatch' using errcode = 'P0006';
  end if;

  update order_tasks
  set status = 'done',
      updated_by = v_emp,
      updated_at = now()
  where id = p_task_id;

  -- 檢查該訂單所有工序是否皆完成
  select bool_and(status in ('done','skipped')) into v_all_done
  from order_tasks
  where order_id = v_task.order_id;

  -- 取得訂單資訊
  select * into v_order from orders where id = v_task.order_id;

  return jsonb_build_object(
    'ok', true,
    'task_id', p_task_id,
    'new_status', 'done',
    'order_all_done', coalesce(v_all_done, false),
    'order_id', v_task.order_id,
    'order_no', v_order.order_no
  );
end;
$$;

-- 6c. 卡關
create or replace function public.task_block(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_emp  uuid := current_employee_id();
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'blocked_reason_required' using errcode = 'P0003';
  end if;

  select * into v_task from order_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0004';
  end if;

  if v_task.assignee_id is distinct from v_emp and not is_manager() then
    raise exception 'not_your_task' using errcode = 'P0005';
  end if;

  if v_task.company_id <> current_company_id() then
    raise exception 'company_mismatch' using errcode = 'P0006';
  end if;

  update order_tasks
  set status = 'blocked',
      blocked_reason = trim(p_reason),
      updated_by = v_emp,
      updated_at = now()
  where id = p_task_id;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'new_status', 'blocked');
end;
$$;

-- 6d. 指派工序（manager only）
create or replace function public.task_assign(p_task_id uuid, p_assignee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_emp  uuid := current_employee_id();
begin
  if not is_manager() then
    raise exception 'manager_required' using errcode = 'P0007';
  end if;

  select * into v_task from order_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0004';
  end if;

  if v_task.company_id <> current_company_id() then
    raise exception 'company_mismatch' using errcode = 'P0006';
  end if;

  -- 驗證 assignee 屬於同公司
  if not exists (
    select 1 from employees
    where id = p_assignee_id and company_id = v_task.company_id and is_active = true
  ) then
    raise exception 'invalid_assignee' using errcode = 'P0008';
  end if;

  update order_tasks
  set assignee_id = p_assignee_id,
      status = case when status = 'pending' then 'assigned' else status end,
      updated_by = v_emp,
      updated_at = now()
  where id = p_task_id;

  return jsonb_build_object(
    'ok', true,
    'task_id', p_task_id,
    'assignee_id', p_assignee_id,
    'new_status', case when v_task.status = 'pending' then 'assigned' else v_task.status end
  );
end;
$$;

-- 6e. 跳過工序（manager only）
create or replace function public.task_skip(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_emp  uuid := current_employee_id();
begin
  if not is_manager() then
    raise exception 'manager_required' using errcode = 'P0007';
  end if;

  select * into v_task from order_tasks where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0004';
  end if;

  if v_task.company_id <> current_company_id() then
    raise exception 'company_mismatch' using errcode = 'P0006';
  end if;

  update order_tasks
  set status = 'skipped',
      updated_by = v_emp,
      updated_at = now()
  where id = p_task_id;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'new_status', 'skipped');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. 看板統計 view（營運總覽用）
-- ────────────────────────────────────────────────────────────
create or replace view public.board_stats as
select
  ot.company_id,
  count(*) filter (where ot.status not in ('done','skipped'))           as active_tasks,
  count(*) filter (where ot.status = 'pending')                         as pending_count,
  count(*) filter (where ot.status = 'assigned')                        as assigned_count,
  count(*) filter (where ot.status = 'in_progress')                     as in_progress_count,
  count(*) filter (where ot.status = 'blocked')                         as blocked_count,
  count(*) filter (where ot.status = 'waiting_customer')                as waiting_customer_count,
  count(*) filter (where ot.status = 'outsourced')                      as outsourced_count,
  count(*) filter (where ot.status = 'done')                            as done_count,
  count(*) filter (where ot.due_at < current_date
                     and ot.status not in ('done','skipped'))            as overdue_count,
  count(*) filter (where ot.due_at = current_date
                     and ot.status not in ('done','skipped'))            as due_today_count,
  count(distinct ot.order_id) filter (where o.status = 'active')        as active_orders
from public.order_tasks ot
join public.orders o on o.id = ot.order_id
group by ot.company_id;

comment on view public.board_stats is '看板統計摘要，供營運總覽使用';

-- ────────────────────────────────────────────────────────────
-- 8. 模組註冊（board / my_work）
--    已在 S1 種子資料（002_rbac_menus.sql）中註冊完畢，
--    含 module_registry、company_modules、menus、role_module_permissions。
--    此處無需重複操作。
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 9. Grant execute on RPC functions to authenticated
-- ────────────────────────────────────────────────────────────
grant execute on function public.task_start(uuid) to authenticated;
grant execute on function public.task_done(uuid) to authenticated;
grant execute on function public.task_block(uuid, text) to authenticated;
grant execute on function public.task_assign(uuid, uuid) to authenticated;
grant execute on function public.task_skip(uuid) to authenticated;

-- Done: S3 migration complete
