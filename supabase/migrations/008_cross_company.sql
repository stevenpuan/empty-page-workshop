-- ============================================================
-- S4: 跨公司外包串接
-- 目的: cross_company_links / cross_company_events / vendors 擴充
--       payables & receivables 基礎表 / outsource_stats view
-- 相依: 007_scheduling.sql (order_tasks 狀態機)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. vendors 擴充三欄（夥伴公司綁定）
-- ────────────────────────────────────────────────────────────
alter table public.vendors
  add column if not exists linked_company_id uuid references public.companies(id),
  add column if not exists auto_dispatch     boolean not null default false,
  add column if not exists partner_routing_template_id uuid references public.routing_templates(id);

comment on column public.vendors.linked_company_id is '指向 companies；有值代表此廠商是集團內夥伴公司';
comment on column public.vendors.auto_dispatch     is '是否啟用跨公司自動建單';
comment on column public.vendors.partner_routing_template_id is '對方公司要套用的工序範本';

-- ────────────────────────────────────────────────────────────
-- 2. customers 確認 is_internal_partner 已存在（S2 已建）
-- ────────────────────────────────────────────────────────────
-- customers.is_internal_partner 已在 S2 建立，此處不重複

-- ────────────────────────────────────────────────────────────
-- 3. cross_company_links（跨公司單據對應）
-- ────────────────────────────────────────────────────────────
create table if not exists public.cross_company_links (
  id               uuid primary key default gen_random_uuid(),
  from_company_id  uuid not null references public.companies(id),
  from_task_id     uuid not null references public.order_tasks(id),
  from_order_id    uuid not null references public.orders(id),
  to_company_id    uuid not null references public.companies(id),
  to_order_id      uuid references public.orders(id),
  vendor_id        uuid references public.vendors(id),
  agreed_amount    numeric not null default 0,
  agreed_due_date  date,
  status           text not null default 'dispatched'
                   check (status in ('dispatched','accepted','in_progress',
                                     'completed','rejected','cancelled')),
  payable_id       uuid,   -- S5 建表後補 FK
  receivable_id    uuid,   -- S5 建表後補 FK
  dispatched_at    timestamptz not null default now(),
  completed_at     timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

create index if not exists idx_ccl_from on public.cross_company_links(from_company_id, status);
create index if not exists idx_ccl_to   on public.cross_company_links(to_company_id, status);
create index if not exists idx_ccl_from_task on public.cross_company_links(from_task_id);
create unique index if not exists idx_ccl_from_task_unique
  on public.cross_company_links(from_task_id) where status not in ('rejected','cancelled');

comment on table public.cross_company_links is '跨公司外包單據橋接表，一筆 link 對應祥興一道外包工序 ↔ 沂融一張工單';

-- 通用 trigger
create trigger trg_cross_company_links_updated
  before update on public.cross_company_links
  for each row execute function set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. cross_company_events（事件紀錄）
-- ────────────────────────────────────────────────────────────
create table if not exists public.cross_company_events (
  id               uuid primary key default gen_random_uuid(),
  link_id          uuid not null references public.cross_company_links(id),
  event            text not null
                   check (event in ('dispatch','accept','progress','complete',
                                    'reject','cancel','amount_adjust')),
  actor_company_id uuid not null references public.companies(id),
  actor_id         uuid,  -- employee id
  payload          jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_cce_link on public.cross_company_events(link_id, created_at);

comment on table public.cross_company_events is '跨公司外包每一次動作的完整日誌';

-- ────────────────────────────────────────────────────────────
-- 5. payables 基礎表（S5 將擴充觸發器與付款沖帳）
-- ────────────────────────────────────────────────────────────
create table if not exists public.payables (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  vendor_id      uuid not null references public.vendors(id),
  doc_no         text not null,
  source_type    text not null default 'outsource'
                 check (source_type in ('outsource','purchase','manual')),
  related_order_id uuid references public.orders(id),
  amount         numeric not null default 0,
  paid_amount    numeric not null default 0,
  status         text not null default 'unpaid'
                 check (status in ('unpaid','partial','paid','void')),
  due_date       date,
  invoice_no     text,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

create index if not exists idx_payables_company on public.payables(company_id, status);
create index if not exists idx_payables_vendor  on public.payables(vendor_id);

create trigger trg_payables_updated
  before update on public.payables
  for each row execute function set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. receivables 基礎表（S5 將擴充）
-- ────────────────────────────────────────────────────────────
create table if not exists public.receivables (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  customer_id    uuid not null references public.customers(id),
  doc_no         text not null,
  source_type    text not null default 'outsource'
                 check (source_type in ('outsource','delivery','manual')),
  related_order_id uuid references public.orders(id),
  amount         numeric not null default 0,
  received_amount numeric not null default 0,
  status         text not null default 'unreceived'
                 check (status in ('unreceived','partial','received','void')),
  due_date       date,
  invoice_no     text,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);

create index if not exists idx_receivables_company  on public.receivables(company_id, status);
create index if not exists idx_receivables_customer on public.receivables(customer_id);

create trigger trg_receivables_updated
  before update on public.receivables
  for each row execute function set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 7. RLS
-- ────────────────────────────────────────────────────────────

-- cross_company_links: 雙方公司皆可讀，只有 service_role 可寫
alter table public.cross_company_links enable row level security;

drop policy if exists ccl_read on public.cross_company_links;
create policy ccl_read on public.cross_company_links
  for select using (
    from_company_id = public.current_company_id()
    or to_company_id = public.current_company_id()
  );

drop policy if exists ccl_write_manager on public.cross_company_links;
create policy ccl_write_manager on public.cross_company_links
  for all using (
    from_company_id = public.current_company_id() and public.is_manager()
  ) with check (
    from_company_id = public.current_company_id() and public.is_manager()
  );

-- cross_company_events: 雙方可讀，trigger/edge function 寫入
alter table public.cross_company_events enable row level security;

drop policy if exists cce_read on public.cross_company_events;
create policy cce_read on public.cross_company_events
  for select using (
    exists (
      select 1 from public.cross_company_links l
      where l.id = link_id
        and (l.from_company_id = public.current_company_id()
             or l.to_company_id = public.current_company_id())
    )
  );

drop policy if exists cce_insert_system on public.cross_company_events;
create policy cce_insert_system on public.cross_company_events
  for insert with check (true);  -- Edge Function (security definer) 寫入

-- payables: 本公司 manager 可讀寫
alter table public.payables enable row level security;

drop policy if exists payables_read on public.payables;
create policy payables_read on public.payables
  for select using (company_id = public.current_company_id() and public.is_manager());

drop policy if exists payables_write on public.payables;
create policy payables_write on public.payables
  for all using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

drop policy if exists payables_insert_system on public.payables;
create policy payables_insert_system on public.payables
  for insert with check (true);  -- Edge Function 寫入

-- receivables: 本公司 manager 可讀寫
alter table public.receivables enable row level security;

drop policy if exists receivables_read on public.receivables;
create policy receivables_read on public.receivables
  for select using (company_id = public.current_company_id() and public.is_manager());

drop policy if exists receivables_write on public.receivables;
create policy receivables_write on public.receivables
  for all using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

drop policy if exists receivables_insert_system on public.receivables;
create policy receivables_insert_system on public.receivables
  for insert with check (true);  -- Edge Function 寫入

-- ────────────────────────────────────────────────────────────
-- 8. outsource_stats view（外包追蹤統計）
-- ────────────────────────────────────────────────────────────
create or replace view public.outsource_stats as
select
  l.from_company_id,
  count(*)                                               as total_links,
  count(*) filter (where l.status = 'dispatched')        as dispatched_count,
  count(*) filter (where l.status = 'in_progress')       as in_progress_count,
  count(*) filter (where l.status = 'completed')         as completed_count,
  count(*) filter (where l.status = 'rejected')          as rejected_count,
  count(*) filter (where l.status = 'cancelled')         as cancelled_count,
  count(*) filter (where l.status not in ('completed','rejected','cancelled')
                         and l.agreed_due_date < current_date) as overdue_count,
  coalesce(sum(l.agreed_amount) filter (where l.status = 'completed'), 0) as completed_amount,
  coalesce(sum(l.agreed_amount) filter (where l.status not in ('completed','rejected','cancelled')), 0) as outstanding_amount
from public.cross_company_links l
group by l.from_company_id;

-- ────────────────────────────────────────────────────────────
-- 9. group_reconciliation view（集團往來對帳）
-- ────────────────────────────────────────────────────────────
create or replace view public.group_reconciliation as
select
  l.id as link_id,
  l.from_company_id,
  fc.name as from_company_name,
  l.to_company_id,
  tc.name as to_company_name,
  fo.order_no as from_order_no,
  fo.item_name as from_item_name,
  too.order_no as to_order_no,
  l.agreed_amount,
  l.agreed_due_date,
  l.status as link_status,
  l.dispatched_at,
  l.completed_at,
  p.amount as payable_amount,
  p.status as payable_status,
  r.amount as receivable_amount,
  r.status as receivable_status,
  case when l.payable_id is not null and l.receivable_id is not null
            and p.amount is distinct from r.amount
       then true else false end as amount_mismatch
from public.cross_company_links l
join public.companies fc on fc.id = l.from_company_id
join public.companies tc on tc.id = l.to_company_id
join public.orders fo on fo.id = l.from_order_id
left join public.orders too on too.id = l.to_order_id
left join public.payables p on p.id = l.payable_id
left join public.receivables r on r.id = l.receivable_id;

-- ────────────────────────────────────────────────────────────
-- 10. dispatch_outsource RPC（核心：發包外包）
-- ────────────────────────────────────────────────────────────
create or replace function public.dispatch_outsource(
  p_task_id      uuid,
  p_vendor_id    uuid,
  p_amount       numeric,
  p_due_date     date default null,
  p_note         text default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_emp         uuid := public.current_employee_id();
  v_company     uuid := public.current_company_id();
  v_task        record;
  v_vendor      record;
  v_order       record;
  v_to_customer record;
  v_new_order_id uuid;
  v_link_id     uuid;
  v_task_count  int;
  v_to_order_no text;
begin
  -- ① 驗證呼叫者是 manager/owner
  if not public.is_manager() then
    raise exception 'P0005: 僅 manager/owner 可發包外包';
  end if;

  -- ② 取得工序
  select t.*, o.order_no, o.item_name, o.spec, o.qty, o.unit,
         o.customer_id, o.due_date as order_due_date,
         ws.name as station_name
    into v_task
    from public.order_tasks t
    join public.orders o on o.id = t.order_id
    join public.work_stations ws on ws.id = t.station_id
   where t.id = p_task_id and t.company_id = v_company;

  if v_task is null then
    raise exception 'P0001: 找不到工序或無權限';
  end if;

  if v_task.status not in ('pending','assigned','in_progress') then
    raise exception 'P0002: 此工序狀態 (%) 不可發包', v_task.status;
  end if;

  -- ③ 驗證 vendor 綁定
  select * into v_vendor
    from public.vendors
   where id = p_vendor_id and company_id = v_company;

  if v_vendor is null then
    raise exception 'P0001: 找不到廠商';
  end if;

  if v_vendor.linked_company_id is null then
    raise exception 'P0006: 此廠商未綁定夥伴公司，無法自動建單';
  end if;

  if not v_vendor.auto_dispatch then
    raise exception 'P0006: 此廠商未啟用自動派工';
  end if;

  if v_vendor.partner_routing_template_id is null then
    raise exception 'P0006: 此廠商未設定對方工序範本';
  end if;

  -- ④ 在對方公司 upsert「祥興印刷」為客戶
  select * into v_to_customer
    from public.customers
   where company_id = v_vendor.linked_company_id
     and is_internal_partner = true
     and name = (select name from public.companies where id = v_company)
   limit 1;

  if v_to_customer is null then
    insert into public.customers (
      company_id, customer_code, name, is_internal_partner, is_active
    ) values (
      v_vendor.linked_company_id,
      (select code from public.companies where id = v_company),
      (select name from public.companies where id = v_company),
      true,
      true
    ) returning * into v_to_customer;
  end if;

  -- ⑤ 產生對方公司的工單編號
  v_to_order_no := public.next_doc_no(v_vendor.linked_company_id, 'WO');

  -- ⑥ 在對方公司建立工單
  insert into public.orders (
    company_id, order_no, customer_id, item_name, spec,
    qty, unit, due_date, status, routing_template_id,
    source_link_id, note, created_by
  ) values (
    v_vendor.linked_company_id,
    v_to_order_no,
    v_to_customer.id,
    v_task.station_name || '：' || v_task.item_name,
    v_task.spec,
    v_task.qty,
    v_task.unit,
    coalesce(p_due_date, v_task.order_due_date),
    'confirmed',
    v_vendor.partner_routing_template_id,
    null,  -- source_link_id 待 link 建完回填
    '由 ' || (select name from public.companies where id = v_company) || ' 發包（' || v_task.order_no || '）',
    v_emp
  ) returning id into v_new_order_id;

  -- ⑦ 展開對方工序
  v_task_count := public.expand_order_tasks(v_new_order_id);

  -- ⑧ 建立 cross_company_link
  insert into public.cross_company_links (
    from_company_id, from_task_id, from_order_id,
    to_company_id, to_order_id, vendor_id,
    agreed_amount, agreed_due_date, status,
    note, created_by
  ) values (
    v_company, p_task_id, v_task.order_id,
    v_vendor.linked_company_id, v_new_order_id, p_vendor_id,
    p_amount, coalesce(p_due_date, v_task.order_due_date), 'dispatched',
    p_note, v_emp
  ) returning id into v_link_id;

  -- ⑨ 回填 orders.source_link_id
  update public.orders
     set source_link_id = v_link_id
   where id = v_new_order_id;

  -- ⑩ 更新發包方工序狀態 → outsourced
  update public.order_tasks
     set status = 'outsourced',
         vendor_id = p_vendor_id,
         is_outsource = true,
         outsourced_at = now(),
         outsource_due_at = coalesce(p_due_date, v_task.order_due_date),
         updated_by = v_emp
   where id = p_task_id;

  -- ⑪ 寫事件日誌
  insert into public.cross_company_events (
    link_id, event, actor_company_id, actor_id, payload
  ) values (
    v_link_id, 'dispatch', v_company, v_emp,
    jsonb_build_object(
      'from_order_no', v_task.order_no,
      'to_order_no', v_to_order_no,
      'station', v_task.station_name,
      'amount', p_amount,
      'due_date', coalesce(p_due_date, v_task.order_due_date),
      'task_count', v_task_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'link_id', v_link_id,
    'to_order_id', v_new_order_id,
    'to_order_no', v_to_order_no,
    'task_count', v_task_count
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 11. complete_outsource RPC（對方完工回寫）
-- ────────────────────────────────────────────────────────────
create or replace function public.complete_outsource(
  p_link_id uuid
) returns jsonb
language plpgsql security definer
as $$
declare
  v_link        record;
  v_from_vendor record;
  v_to_customer record;
  v_payable_id  uuid;
  v_recv_id     uuid;
  v_pay_no      text;
  v_recv_no     text;
begin
  select * into v_link
    from public.cross_company_links
   where id = p_link_id;

  if v_link is null then
    raise exception 'P0001: 找不到外包連結';
  end if;

  if v_link.status = 'completed' then
    return jsonb_build_object('ok', true, 'already_completed', true);
  end if;

  -- ① 更新 from_task → done
  update public.order_tasks
     set status = 'done',
         done_at = now()
   where id = v_link.from_task_id
     and status = 'outsourced';

  -- ② 產生祥興端應付
  v_pay_no := public.next_doc_no(v_link.from_company_id, 'AP');

  insert into public.payables (
    company_id, vendor_id, doc_no, source_type,
    related_order_id, amount, due_date, note
  ) values (
    v_link.from_company_id,
    v_link.vendor_id,
    v_pay_no,
    'outsource',
    v_link.from_order_id,
    v_link.agreed_amount,
    v_link.agreed_due_date,
    '跨公司外包完工自動產生'
  ) returning id into v_payable_id;

  -- ③ 找到對方公司的「祥興」客戶，產生沂融端應收
  select * into v_to_customer
    from public.customers
   where company_id = v_link.to_company_id
     and is_internal_partner = true
   limit 1;

  v_recv_no := public.next_doc_no(v_link.to_company_id, 'AR');

  insert into public.receivables (
    company_id, customer_id, doc_no, source_type,
    related_order_id, amount, due_date, note
  ) values (
    v_link.to_company_id,
    v_to_customer.id,
    v_recv_no,
    'outsource',
    v_link.to_order_id,
    v_link.agreed_amount,
    v_link.agreed_due_date,
    '跨公司外包完工自動產生'
  ) returning id into v_recv_id;

  -- ④ 更新 link 狀態
  update public.cross_company_links
     set status = 'completed',
         completed_at = now(),
         payable_id = v_payable_id,
         receivable_id = v_recv_id
   where id = p_link_id;

  -- ⑤ 寫事件
  insert into public.cross_company_events (
    link_id, event, actor_company_id, actor_id, payload
  ) values (
    p_link_id, 'complete', v_link.to_company_id, null,
    jsonb_build_object(
      'payable_no', v_pay_no,
      'receivable_no', v_recv_no,
      'amount', v_link.agreed_amount
    )
  );

  -- ⑥ 檢查祥興端訂單是否全部完成（觸發 order_all_done 邏輯）
  -- task_done RPC 已做此邏輯，但此處是 complete_outsource 直接改 status
  -- 不經由 task_done RPC，所以手動檢查
  perform 1;  -- 省略：order_all_done 提示由前端判斷

  return jsonb_build_object(
    'ok', true,
    'payable_id', v_payable_id,
    'receivable_id', v_recv_id,
    'payable_no', v_pay_no,
    'receivable_no', v_recv_no
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 12. reject_outsource RPC（沂融拒接）
-- ────────────────────────────────────────────────────────────
create or replace function public.reject_outsource(
  p_link_id uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_link  record;
  v_emp   uuid := public.current_employee_id();
  v_company uuid := public.current_company_id();
begin
  if not public.is_manager() then
    raise exception 'P0005: 僅 manager/owner 可拒接';
  end if;

  select * into v_link
    from public.cross_company_links
   where id = p_link_id and to_company_id = v_company;

  if v_link is null then
    raise exception 'P0001: 找不到外包連結或無權限';
  end if;

  if v_link.status != 'dispatched' then
    raise exception 'P0002: 此外包狀態 (%) 無法拒接', v_link.status;
  end if;

  -- ① 更新 link → rejected
  update public.cross_company_links
     set status = 'rejected'
   where id = p_link_id;

  -- ② 發包方工序退回 pending
  update public.order_tasks
     set status = 'pending',
         vendor_id = null,
         is_outsource = false,
         outsourced_at = null,
         outsource_due_at = null
   where id = v_link.from_task_id;

  -- ③ 對方工單作廢
  update public.orders
     set status = 'void'
   where id = v_link.to_order_id;

  -- ④ 事件
  insert into public.cross_company_events (
    link_id, event, actor_company_id, actor_id, payload
  ) values (
    p_link_id, 'reject', v_company, v_emp,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 13. cancel_outsource RPC（祥興取消發包）
-- ────────────────────────────────────────────────────────────
create or replace function public.cancel_outsource(
  p_link_id uuid,
  p_reason  text default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_link  record;
  v_emp   uuid := public.current_employee_id();
  v_company uuid := public.current_company_id();
begin
  if not public.is_manager() then
    raise exception 'P0005: 僅 manager/owner 可取消發包';
  end if;

  select * into v_link
    from public.cross_company_links
   where id = p_link_id and from_company_id = v_company;

  if v_link is null then
    raise exception 'P0001: 找不到外包連結或無權限';
  end if;

  if v_link.status in ('completed','rejected','cancelled') then
    raise exception 'P0002: 此外包狀態 (%) 無法取消', v_link.status;
  end if;

  -- ① link → cancelled
  update public.cross_company_links
     set status = 'cancelled'
   where id = p_link_id;

  -- ② 發包方工序退回 pending
  update public.order_tasks
     set status = 'pending',
         vendor_id = null,
         is_outsource = false,
         outsourced_at = null,
         outsource_due_at = null
   where id = v_link.from_task_id;

  -- ③ 對方工單作廢
  update public.orders
     set status = 'void'
   where id = v_link.to_order_id;

  -- ④ 事件
  insert into public.cross_company_events (
    link_id, event, actor_company_id, actor_id, payload
  ) values (
    p_link_id, 'cancel', v_company, v_emp,
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 14. trg_auto_complete_outsource（沂融最後工序完成時自動觸發）
-- ────────────────────────────────────────────────────────────
create or replace function public.trg_auto_complete_outsource_fn()
returns trigger language plpgsql security definer
as $$
declare
  v_order   record;
  v_link_id uuid;
  v_pending int;
begin
  -- 只在狀態變為 done 時觸發
  if NEW.status != 'done' or OLD.status = 'done' then
    return NEW;
  end if;

  -- 檢查此工序的訂單是否有 source_link_id（來自外包）
  select o.id, o.source_link_id
    into v_order
    from public.orders o
   where o.id = NEW.order_id and o.source_link_id is not null;

  if v_order is null then
    return NEW;  -- 非外包訂單，不處理
  end if;

  -- 檢查訂單是否全部工序都完成/跳過
  select count(*) into v_pending
    from public.order_tasks
   where order_id = NEW.order_id
     and status not in ('done','skipped');

  if v_pending > 0 then
    return NEW;  -- 還有未完成工序
  end if;

  -- 全部完成，呼叫 complete_outsource
  perform public.complete_outsource(v_order.source_link_id);

  return NEW;
end;
$$;

-- 此 trigger 掛在 order_tasks 上，注意命名排在 trg_task_status_log 之後
drop trigger if exists trg_z_auto_complete_outsource on public.order_tasks;
create trigger trg_z_auto_complete_outsource
  after update on public.order_tasks
  for each row execute function trg_auto_complete_outsource_fn();

-- ────────────────────────────────────────────────────────────
-- 15. 模組權限種子（outsource + group 模組）
-- ────────────────────────────────────────────────────────────
-- 使用 S1 的 module_permissions 表註冊新模組
insert into public.module_permissions (module, role_id, can_read, can_write)
select 'outsource', id, true, true
  from public.roles where name in ('老闆','店長')
on conflict (module, role_id) do nothing;

insert into public.module_permissions (module, role_id, can_read, can_write)
select 'outsource', id, true, false
  from public.roles where name = '員工'
on conflict (module, role_id) do nothing;

insert into public.module_permissions (module, role_id, can_read, can_write)
select 'group_overview', id, true, true
  from public.roles where name = '老闆'
on conflict (module, role_id) do nothing;

-- ────────────────────────────────────────────────────────────
-- 16. doc_no_counters 種子（AP / AR 類型）
-- ────────────────────────────────────────────────────────────
insert into public.doc_no_counters (company_id, doc_type, current_ym, current_seq)
select c.id, dt.t, to_char(now(), 'YYMM'), 0
  from public.companies c
  cross join (values ('AP'),('AR')) as dt(t)
on conflict do nothing;

-- ============================================================
-- 完成
-- ============================================================
