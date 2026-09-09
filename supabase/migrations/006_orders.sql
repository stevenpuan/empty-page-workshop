-- =============================================================
-- 006_orders.sql — S2 訂單與工序
-- Sprint: S2 主檔與訂單
-- 相依: 005_masters.sql（customers, products, work_stations,
--        routing_templates, routing_template_steps）
-- =============================================================

-- =============================================================
-- 1. 訂單 orders
-- =============================================================
create table if not exists public.orders (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  order_no               text not null,
  customer_id            uuid references public.customers(id) on delete set null,
  product_id             uuid references public.products(id) on delete set null,
  item_name              text not null,
  spec                   text,
  qty                    numeric not null default 0,
  unit                   text not null default '張',
  amount_untaxed         numeric(14,2) not null default 0,
  tax_amount             numeric(14,2) not null default 0,
  amount_total           numeric(14,2) not null default 0,
  due_date               date,
  status                 text not null default 'draft'
                           check (status in ('draft','active','shipped','closed','void')),
  routing_template_id    uuid references public.routing_templates(id) on delete set null,
  source_link_id         uuid,  -- → cross_company_links（S4 加 FK）
  note                   text,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint orders_no_uk unique (company_id, order_no)
);
create index if not exists idx_orders_company on public.orders(company_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_status on public.orders(company_id, status);
create index if not exists idx_orders_due on public.orders(company_id, due_date);

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

-- =============================================================
-- 2. 工序 order_tasks
-- =============================================================
create table if not exists public.order_tasks (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  order_id               uuid not null references public.orders(id) on delete cascade,
  station_id             uuid not null references public.work_stations(id) on delete restrict,
  step_no                int not null,
  assignee_id            uuid references public.employees(id) on delete set null,
  vendor_id              uuid references public.vendors(id) on delete set null,
  is_outsource           boolean not null default false,
  due_at                 date,
  status                 text not null default 'pending'
                           check (status in (
                             'pending','assigned','in_progress','done',
                             'waiting_customer','outsourced','blocked','skipped'
                           )),
  started_at             timestamptz,
  done_at                timestamptz,
  outsourced_at          timestamptz,
  outsource_due_at       date,
  blocked_reason         text,
  purchase_id            uuid,  -- → purchases（S5 加 FK）
  note                   text,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint order_tasks_step_uk unique (order_id, step_no)
);
create index if not exists idx_order_tasks_company on public.order_tasks(company_id);
create index if not exists idx_order_tasks_order on public.order_tasks(order_id);
create index if not exists idx_order_tasks_status on public.order_tasks(company_id, status, due_at);
create index if not exists idx_order_tasks_assignee on public.order_tasks(assignee_id, status);
create index if not exists idx_order_tasks_station on public.order_tasks(station_id);

drop trigger if exists trg_order_tasks_updated on public.order_tasks;
create trigger trg_order_tasks_updated before update on public.order_tasks
  for each row execute function public.set_updated_at();

-- =============================================================
-- 3. 啟用 RLS
-- =============================================================
alter table public.orders      enable row level security;
alter table public.order_tasks enable row level security;

-- =============================================================
-- 4. RLS 政策
-- =============================================================

-- ---------- orders ----------
-- 讀：同公司皆可讀（S3 起再用 view 對 staff 隱藏金額欄）
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select
  using (company_id = public.current_company_id());

-- 寫：owner 或 manager（新增、編輯訂單）
drop policy if exists orders_write on public.orders;
create policy orders_write on public.orders for all
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- ---------- order_tasks ----------
-- 讀：同公司皆可讀（看板需要全覽）
drop policy if exists order_tasks_read on public.order_tasks;
create policy order_tasks_read on public.order_tasks for select
  using (company_id = public.current_company_id());

-- 寫（manager+）：可指派、重排、修改任何工序
drop policy if exists order_tasks_write_manager on public.order_tasks;
create policy order_tasks_write_manager on public.order_tasks for all
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- 寫（staff）：只能更新被指派給自己的工序（開始／完成／卡關）
-- ★ 不開放 insert/delete，只開放 update
drop policy if exists order_tasks_update_staff on public.order_tasks;
create policy order_tasks_update_staff on public.order_tasks for update
  using (
    company_id = public.current_company_id()
    and assignee_id = public.current_employee_id()
  )
  with check (
    company_id = public.current_company_id()
    and assignee_id = public.current_employee_id()
  );

-- =============================================================
-- 5. 禁止刪除單據 trigger（作廢代替刪除）
-- =============================================================
create or replace function public.prevent_order_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '單據不可刪除，請改為作廢'
    using errcode = 'P0001';
  return null;
end;
$$;

drop trigger if exists trg_prevent_order_delete on public.orders;
create trigger trg_prevent_order_delete before delete on public.orders
  for each row execute function public.prevent_order_delete();

-- =============================================================
-- 6. 自動展開工序 expand_order_tasks()
--    ★ 依 routing_template 展開步驟，每步建立 order_task
--    ★ due_at = order.due_date − step.offset_days
--    ★ is_optional 步驟也會展開（前端可 skip）
-- =============================================================
create or replace function public.expand_order_tasks(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    record;
  v_step     record;
  v_count    int := 0;
begin
  -- 取得訂單資訊
  select o.id, o.company_id, o.due_date, o.routing_template_id
    into v_order
    from orders o
   where o.id = p_order_id;

  if v_order is null then
    raise exception 'order not found: %', p_order_id;
  end if;

  if v_order.routing_template_id is null then
    return 0;  -- 無範本則不展開
  end if;

  -- 刪除該訂單已有的工序（重新展開用）
  delete from order_tasks where order_id = p_order_id;

  -- 依範本步驟逐一建立 order_task
  for v_step in
    select s.station_id, s.step_no, s.offset_days, s.is_optional,
           ws.default_owner_id
      from routing_template_steps s
      join work_stations ws on ws.id = s.station_id
     where s.template_id = v_order.routing_template_id
     order by s.step_no
  loop
    insert into order_tasks (
      company_id, order_id, station_id, step_no,
      assignee_id, due_at, status
    ) values (
      v_order.company_id,
      p_order_id,
      v_step.station_id,
      v_step.step_no,
      v_step.default_owner_id,
      case when v_order.due_date is not null
           then v_order.due_date - v_step.offset_days
           else null end,
      'pending'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =============================================================
-- 7. trigger：訂單新增時自動展開工序
--    ★ 僅在 INSERT 且 status = 'active' 時觸發
--    ★ draft 狀態不展開（報價單 / 草稿）
-- =============================================================
create or replace function public.trg_order_expand_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- INSERT 且為 active 狀態：自動展開
  if TG_OP = 'INSERT' and NEW.status = 'active' and NEW.routing_template_id is not null then
    perform expand_order_tasks(NEW.id);
  end if;

  -- UPDATE：從非 active 變成 active 時也展開（草稿確認時）
  if TG_OP = 'UPDATE'
     and OLD.status <> 'active'
     and NEW.status = 'active'
     and NEW.routing_template_id is not null then
    perform expand_order_tasks(NEW.id);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_order_expand on public.orders;
create trigger trg_order_expand after insert or update on public.orders
  for each row execute function public.trg_order_expand_fn();

-- =============================================================
-- 8. 訂單新增時自動產生單號
--    ★ 如果 order_no 為空或為 'AUTO'，由 next_doc_no 產生
-- =============================================================
create or replace function public.trg_order_set_no_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.order_no is null or NEW.order_no = '' or NEW.order_no = 'AUTO' then
    NEW.order_no := next_doc_no(NEW.company_id, 'WO');
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_order_set_no on public.orders;
create trigger trg_order_set_no before insert on public.orders
  for each row execute function public.trg_order_set_no_fn();

-- =============================================================
-- 9. 稽核 trigger
-- =============================================================
drop trigger if exists trg_audit_orders on public.orders;
create trigger trg_audit_orders after insert or update or delete on public.orders
  for each row execute function public.audit_row_change();

-- =============================================================
-- 驗證（手動跑）
-- =============================================================
-- ① RLS 覆蓋率
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and rowsecurity = false;
-- 預期：0 rows
--
-- ② 展開測試（需先有範本資料）
-- select expand_order_tasks('<order-id>');
--
-- ③ 單號測試
-- insert into orders (company_id, item_name, status)
-- values ('<xx-id>', '測試品名', 'active');
-- → order_no 應為 XX-WO-YYMM001
