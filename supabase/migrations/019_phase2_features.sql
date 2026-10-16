-- =====================================================================
-- 019_phase2_features.sql
-- 補齊規格缺漏：出貨單、國定假日加班、集團 KPI、外包金額調整、
-- 外包成本入帳、外部外包一鍵進貨、庫存、金額由 DB 計算、訂單狀態走 RPC
-- 2026-10-16
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. next_doc_no：只能替自己可存取的公司取號
-- ---------------------------------------------------------------------
create or replace function public.next_doc_no(p_company_id uuid, p_doc_type text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Taipei', 'YYMM');
  v_code   text;
  v_seq    int;
begin
  -- 外包 RPC 會替對方公司取號（app.task_rpc = outsource），其餘只能替自己可存取的公司取號
  if auth.uid() is not null
     and coalesce(current_setting('app.task_rpc', true), '') <> 'outsource'
     and p_company_id not in (select public.user_company_ids()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select code into v_code from companies where id = p_company_id;
  if v_code is null then raise exception 'company not found: %', p_company_id; end if;
  insert into doc_no_counters (company_id, doc_type, period, last_seq)
  values (p_company_id, p_doc_type, v_period, 1)
  on conflict (company_id, doc_type, period)
  do update set last_seq = doc_no_counters.last_seq + 1
  returning last_seq into v_seq;
  return v_code || '-' || p_doc_type || '-' || v_period || lpad(v_seq::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------
-- 1. 金額一律由資料庫計算
-- ---------------------------------------------------------------------
-- 1a 訂單：未稅＋稅＝含稅；稅額未給時以 5% 計
create or replace function public.trg_order_amounts_fn()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.amount_untaxed := round(coalesce(new.amount_untaxed, 0));
  if new.tax_amount is null then
    new.tax_amount := round(new.amount_untaxed * 0.05);
  end if;
  new.tax_amount := round(new.tax_amount);
  new.amount_total := new.amount_untaxed + new.tax_amount;
  return new;
end $$;
create trigger trg_order_amounts before insert or update of amount_untaxed, tax_amount, amount_total
  on public.orders for each row execute function public.trg_order_amounts_fn();

-- 1b 訂單沒指定範本時，依產品預設範本或分類預設範本補上
create or replace function public.trg_order_default_template_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_cat text;
begin
  if new.routing_template_id is null and new.source_link_id is null then
    if new.product_id is not null then
      select default_routing_template_id, category into new.routing_template_id, v_cat
        from products where id = new.product_id and company_id = new.company_id;
      if new.routing_template_id is null and v_cat is not null then
        select id into new.routing_template_id from routing_templates
         where company_id = new.company_id and product_category = v_cat
           and is_active and is_default
         order by created_at limit 1;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_order_default_template before insert on public.orders
  for each row execute function public.trg_order_default_template_fn();

-- 1c 報價單：明細金額＝數量×單價；表頭小計／稅額／合計由明細加總
create or replace function public.trg_quotation_item_amount_fn()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.amount := round(coalesce(new.qty, 0) * coalesce(new.unit_price, 0), 2);
  return new;
end $$;
create trigger trg_quotation_item_amount before insert or update on public.quotation_items
  for each row execute function public.trg_quotation_item_amount_fn();

create or replace function public.trg_quotation_totals_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.subtotal := round(coalesce((select sum(amount) from quotation_items where quotation_id = new.id), 0));
  new.tax_amount := case when coalesce(new.tax_type, 'taxable') = 'taxable'
                         then round(new.subtotal * 0.05) else 0 end;
  new.total := new.subtotal + new.tax_amount;
  return new;
end $$;
create trigger trg_quotation_totals before insert or update on public.quotations
  for each row execute function public.trg_quotation_totals_fn();

create or replace function public.trg_quotation_items_touch_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update quotations set updated_at = now()
   where id = coalesce(new.quotation_id, old.quotation_id);
  return null;
end $$;
create trigger trg_quotation_items_touch after insert or update or delete on public.quotation_items
  for each row execute function public.trg_quotation_items_touch_fn();

-- 1d 進貨單：同上；確認後明細不可再改
create or replace function public.trg_purchase_item_amount_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_status text;
begin
  select status into v_status from purchases
   where id = coalesce(new.purchase_id, old.purchase_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'P0002: 進貨單已確認或作廢，明細不可修改';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.amount := round(coalesce(new.qty, 0) * coalesce(new.unit_price, 0), 2);
  return new;
end $$;
create trigger trg_purchase_item_amount before insert or update or delete on public.purchase_items
  for each row execute function public.trg_purchase_item_amount_fn();

create or replace function public.trg_purchase_totals_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' or new.status = 'draft' then
    new.amount_untaxed := round(coalesce((select sum(amount) from purchase_items where purchase_id = new.id), 0));
    new.tax_amount := case when coalesce(new.tax_type, 'taxable') = 'taxable'
                           then round(new.amount_untaxed * 0.05) else 0 end;
    new.amount_total := new.amount_untaxed + new.tax_amount;
  end if;
  return new;
end $$;
create trigger trg_purchase_totals before insert or update on public.purchases
  for each row execute function public.trg_purchase_totals_fn();

create or replace function public.trg_purchase_items_touch_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update purchases set updated_at = now()
   where id = coalesce(new.purchase_id, old.purchase_id) and status = 'draft';
  return null;
end $$;
create trigger trg_purchase_items_touch after insert or update or delete on public.purchase_items
  for each row execute function public.trg_purchase_items_touch_fn();

-- ---------------------------------------------------------------------
-- 2. 訂單狀態只能經 RPC 變更
-- ---------------------------------------------------------------------
create or replace function public.trg_order_status_guard_fn()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and coalesce(current_setting('app.task_rpc', true), '') <> 'outsource'
     and coalesce(current_setting('app.order_rpc', true), '') <> 'on' then
    raise exception 'P0007: 訂單狀態請用系統按鈕變更（確認／作廢／出貨）' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_order_status_guard before update of status on public.orders
  for each row execute function public.trg_order_status_guard_fn();

create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_o record;
begin
  select * into v_o from orders where id = p_order_id and company_id = public.current_company_id();
  if v_o.id is null then raise exception 'P0001: 找不到訂單或無權限'; end if;
  if not (public.is_manager() or public.has_perm('orders', 'edit')) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if not (
       (v_o.status = 'draft'   and p_status in ('active', 'void'))
    or (v_o.status = 'active'  and p_status = 'void')
    or (v_o.status = 'shipped' and p_status = 'closed')
  ) then
    raise exception 'P0002: 訂單狀態 % 不能改成 %', v_o.status, p_status;
  end if;
  if p_status = 'void' and exists (
       select 1 from cross_company_links
        where from_order_id = p_order_id and status in ('dispatched', 'accepted', 'in_progress')) then
    raise exception 'P0002: 此訂單有進行中的外包，請先取消外包';
  end if;
  if p_status = 'void' and v_o.source_link_id is not null then
    raise exception 'P0002: 外包來的工單請由發包方取消，或在外包追蹤拒接';
  end if;
  perform set_config('app.order_rpc', 'on', true);
  update orders set status = p_status, updated_at = now(), updated_by = auth.uid() where id = p_order_id;
  perform set_config('app.order_rpc', '', true);
  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------
-- 3. 出貨單
-- ---------------------------------------------------------------------
create table public.delivery_notes (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  delivery_no    text not null,
  order_id       uuid not null references public.orders(id),
  customer_id    uuid references public.customers(id),
  delivery_date  date not null default ((now() at time zone 'Asia/Taipei')::date),
  qty            numeric,
  unit           text,
  amount_untaxed numeric not null default 0,
  tax_amount     numeric not null default 0,
  amount_total   numeric not null default 0,
  receivable_id  uuid references public.receivables(id),
  status         text not null default 'issued' check (status in ('issued', 'void')),
  receiver       text,
  address        text,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (company_id, delivery_no)
);
create index delivery_notes_order_idx on public.delivery_notes(order_id);
create index delivery_notes_company_idx on public.delivery_notes(company_id, delivery_date);
alter table public.delivery_notes enable row level security;
create policy delivery_notes_read on public.delivery_notes for select to authenticated
  using (company_id = public.current_company_id() and (public.is_manager() or public.has_perm('orders', 'view')));
revoke all on public.delivery_notes from anon, authenticated;
grant select on public.delivery_notes to authenticated;

create or replace function public.create_delivery_note(
  p_order_id uuid, p_delivery_date date default null, p_receiver text default null,
  p_address text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_o      record;
  v_cust   record;
  v_date   date := coalesce(p_delivery_date, (now() at time zone 'Asia/Taipei')::date);
  v_dn_no  text;
  v_dn_id  uuid;
  v_ar_id  uuid;
  v_ar_no  text;
  v_due    date;
begin
  select * into v_o from orders where id = p_order_id and company_id = public.current_company_id();
  if v_o.id is null then raise exception 'P0001: 找不到訂單或無權限'; end if;
  if not (public.is_manager() or public.has_perm('orders', 'edit')) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if v_o.status <> 'active' then
    raise exception 'P0002: 只有進行中的訂單可以出貨（目前：%）', v_o.status;
  end if;
  if exists (select 1 from delivery_notes where order_id = p_order_id and status = 'issued') then
    raise exception 'P0002: 此訂單已開過出貨單';
  end if;
  if exists (select 1 from order_tasks where order_id = p_order_id
              and status not in ('done', 'skipped')
              and station_id not in (select id from work_stations where code in ('SHIP', 'QCSHIP'))) then
    raise exception 'P0002: 還有未完成的工序，不能出貨';
  end if;

  select * into v_cust from customers where id = v_o.customer_id;
  v_dn_no := public.next_doc_no(v_o.company_id, 'DN');

  -- 外包來的工單：應收已由外包完工產生，不重複開
  if v_o.source_link_id is null and coalesce(v_o.amount_total, 0) > 0 then
    v_due := public.calc_due_date(coalesce(v_cust.payment_term, 'cash'), v_date);
    v_ar_no := public.next_doc_no(v_o.company_id, 'AR');
    insert into receivables (company_id, customer_id, doc_no, source_type, related_order_id,
                             amount, due_date, note, created_by)
    values (v_o.company_id, v_o.customer_id, v_ar_no, 'delivery', v_o.id,
            v_o.amount_total, v_due, '出貨單 ' || v_dn_no, auth.uid())
    returning id into v_ar_id;
  end if;

  insert into delivery_notes (company_id, delivery_no, order_id, customer_id, delivery_date,
                              qty, unit, amount_untaxed, tax_amount, amount_total,
                              receivable_id, receiver, address, note, created_by, updated_by)
  values (v_o.company_id, v_dn_no, v_o.id, v_o.customer_id, v_date,
          v_o.qty, v_o.unit, coalesce(v_o.amount_untaxed, 0), coalesce(v_o.tax_amount, 0),
          coalesce(v_o.amount_total, 0), v_ar_id, p_receiver,
          coalesce(p_address, v_cust.address), p_note, auth.uid(), auth.uid())
  returning id into v_dn_id;

  -- 出貨站工序：依狀態機先轉進行中再完成（021 修正，原本 pending→done 會被狀態檢查擋下）
  update order_tasks set status = 'in_progress', updated_at = now()
   where order_id = p_order_id and status in ('pending', 'assigned', 'blocked', 'waiting_customer')
     and station_id in (select id from work_stations where code in ('SHIP', 'QCSHIP'));
  update order_tasks set status = 'done', done_at = now(), updated_at = now()
   where order_id = p_order_id and status = 'in_progress'
     and station_id in (select id from work_stations where code in ('SHIP', 'QCSHIP'));

  perform set_config('app.order_rpc', 'on', true);
  update orders set status = 'shipped', updated_at = now(), updated_by = auth.uid() where id = p_order_id;
  perform set_config('app.order_rpc', '', true);

  return jsonb_build_object('ok', true, 'delivery_id', v_dn_id, 'delivery_no', v_dn_no,
                            'receivable_id', v_ar_id, 'receivable_no', v_ar_no, 'due_date', v_due);
end $$;

create or replace function public.void_delivery_note(p_delivery_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_dn record; v_ar record;
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可作廢出貨單' using errcode = '42501'; end if;
  select * into v_dn from delivery_notes where id = p_delivery_id and company_id = public.current_company_id();
  if v_dn.id is null then raise exception 'P0001: 找不到出貨單'; end if;
  if v_dn.status = 'void' then raise exception 'P0002: 已作廢'; end if;
  if v_dn.receivable_id is not null then
    select * into v_ar from receivables where id = v_dn.receivable_id;
    if coalesce(v_ar.received_amount, 0) > 0 then
      raise exception 'P0002: 應收已收款，請先作廢收款';
    end if;
    update receivables set status = 'void', updated_at = now(), updated_by = auth.uid() where id = v_dn.receivable_id;
  end if;
  update delivery_notes set status = 'void', note = concat_ws('；', note, '作廢：' || coalesce(p_reason, '')),
         updated_at = now(), updated_by = auth.uid() where id = p_delivery_id;
  perform set_config('app.order_rpc', 'on', true);
  update orders set status = 'active', updated_at = now(), updated_by = auth.uid()
   where id = v_dn.order_id and status = 'shipped';
  perform set_config('app.order_rpc', '', true);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. 國定假日與假日加班
-- ---------------------------------------------------------------------
create table public.holidays (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  holiday_date  date not null,
  name          text not null,
  kind          text not null default 'national' check (kind in ('national', 'company', 'makeup_workday')),
  is_confirmed  boolean not null default false,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (company_id, holiday_date)
);
alter table public.holidays enable row level security;
create policy holidays_read on public.holidays for select to authenticated
  using (company_id = public.current_company_id());
create policy holidays_write on public.holidays for all to authenticated
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());
revoke all on public.holidays from anon;
grant select, insert, update, delete on public.holidays to authenticated;
create trigger set_holidays_updated_at before update on public.holidays
  for each row execute function public.set_updated_at();

-- 打卡（含補卡核准）寫入工時後：國定假日的工時全部歸到假日加班
create or replace function public.trg_attendance_holiday_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(new.work_minutes, 0) > 0 and exists (
       select 1 from holidays h
        where h.company_id = new.company_id and h.holiday_date = new.work_date
          and h.kind in ('national', 'company')) then
    new.ot_minutes_holiday := new.work_minutes;
    new.ot_minutes_134 := 0;
    new.ot_minutes_167 := 0;
    new.late_minutes := 0;
    new.early_leave_minutes := 0;
    if new.status in ('late', 'early_leave') then new.status := 'normal'; end if;
  end if;
  return new;
end $$;
create trigger trg_attendance_holiday before insert or update on public.attendances
  for each row execute function public.trg_attendance_holiday_fn();

-- ---------------------------------------------------------------------
-- 5. 集團 KPI（老闆專用，兩家並排）
-- ---------------------------------------------------------------------
create or replace function public.group_kpis()
returns table (
  company_id uuid, company_code text, company_name text,
  today_new_orders int, month_orders int, month_order_amount numeric,
  wip_orders int, overdue_tasks int, outsourcing int,
  month_shipped_amount numeric, ar_balance numeric, ap_balance numeric,
  active_employees int, today_clock_in int, today_abnormal int
) language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Taipei'))::date;
begin
  if not public.is_owner() then raise exception 'P0005: 僅老闆可查看集團總覽' using errcode = '42501'; end if;
  return query
  select c.id, c.code, c.name,
    (select count(*)::int from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date = v_today),
    (select count(*)::int from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date >= v_month),
    (select coalesce(sum(o.amount_total), 0) from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date >= v_month),
    (select count(*)::int from orders o where o.company_id = c.id and o.status = 'active'),
    (select count(*)::int from order_tasks t join orders o on o.id = t.order_id
      where t.company_id = c.id and o.status = 'active'
        and t.status not in ('done', 'skipped') and t.due_at < v_today),
    (select count(*)::int from cross_company_links l where l.from_company_id = c.id
        and l.status in ('dispatched', 'accepted', 'in_progress')),
    (select coalesce(sum(d.amount_total), 0) from delivery_notes d where d.company_id = c.id
        and d.status = 'issued' and d.delivery_date >= v_month),
    (select coalesce(sum(r.balance), 0) from receivables r where r.company_id = c.id and r.status in ('unreceived', 'partial')),
    (select coalesce(sum(p.balance), 0) from payables p where p.company_id = c.id and p.status in ('unpaid', 'partial')),
    (select count(*)::int from employees e where e.company_id = c.id and e.is_active),
    (select count(*)::int from attendances a where a.company_id = c.id and a.work_date = v_today and a.clock_in_at is not null),
    (select count(*)::int from attendances a where a.company_id = c.id and a.work_date = v_today and a.is_abnormal_location)
  from companies c
  where c.is_active and c.id in (select public.user_company_ids())
  order by c.code desc;
end $$;

-- ---------------------------------------------------------------------
-- 6. 外包：完工時寫入發包方訂單成本；事後調整議定金額
-- ---------------------------------------------------------------------
create or replace function public.trg_outsource_cost_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into order_costs (company_id, order_id, cost_type, source_type, source_id,
                             amount, recognized_at, note)
    select new.from_company_id, new.from_order_id, 'outsource', 'manual', new.id,
           new.agreed_amount, (now() at time zone 'Asia/Taipei')::date,
           '外包：' || coalesce(v.name, '')
      from vendors v where v.id = new.vendor_id;
  end if;
  return new;
end $$;
create trigger trg_outsource_cost after update of status on public.cross_company_links
  for each row execute function public.trg_outsource_cost_fn();

insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind,
  recipient_scopes, line_mode, template_title, template_body)
select c.id, 'outsource_amount_adjusted', '外包金額調整', 'outsource', 'event',
       array['manager', 'counterpart'], 'immediate', '外包金額調整',
       '{{order_no}} 的外包金額由 {{old_amount}} 調整為 {{new_amount}}'
  from public.companies c
on conflict do nothing;

create or replace function public.adjust_outsource_amount(p_link_id uuid, p_amount numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_l record; v_ap record; v_ar record; v_order_no text;
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可調整外包金額' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'P0003: 金額不正確'; end if;
  select * into v_l from cross_company_links where id = p_link_id and from_company_id = public.current_company_id();
  if v_l.id is null then raise exception 'P0001: 找不到外包或無權限（只有發包方可調整）'; end if;
  if v_l.status in ('rejected', 'cancelled') then raise exception 'P0002: 此外包已結束（%）', v_l.status; end if;
  if v_l.payable_id is not null then
    select * into v_ap from payables where id = v_l.payable_id;
    if coalesce(v_ap.paid_amount, 0) > 0 then raise exception 'P0002: 應付已付款，請先作廢付款'; end if;
  end if;
  if v_l.receivable_id is not null then
    select * into v_ar from receivables where id = v_l.receivable_id;
    if coalesce(v_ar.received_amount, 0) > 0 then raise exception 'P0002: 對方應收已收款，請先作廢收款'; end if;
  end if;

  update cross_company_links set agreed_amount = p_amount, updated_at = now(), updated_by = auth.uid() where id = p_link_id;
  update payables set amount = p_amount, updated_at = now(), updated_by = auth.uid() where id = v_l.payable_id;
  update receivables set amount = p_amount, updated_at = now() where id = v_l.receivable_id;
  update order_costs set amount = p_amount, updated_at = now()
   where source_id = p_link_id and cost_type = 'outsource';

  insert into cross_company_events (link_id, event, actor_company_id, actor_id, payload)
  values (p_link_id, 'amount_adjust', v_l.from_company_id, public.current_employee_id(),
          jsonb_build_object('old_amount', v_l.agreed_amount, 'new_amount', p_amount, 'reason', p_reason));

  select order_no into v_order_no from orders where id = v_l.from_order_id;
  perform public.emit_notification(v_l.from_company_id, 'outsource_amount_adjusted', 'cross_company_link', p_link_id,
    null, '外包金額調整',
    coalesce(v_order_no, '') || ' 的外包金額由 ' || v_l.agreed_amount || ' 調整為 ' || p_amount
      || coalesce('（' || p_reason || '）', ''),
    to_char(now(), 'YYYYMMDDHH24MISS'), v_l.to_company_id);
  return jsonb_build_object('ok', true, 'old_amount', v_l.agreed_amount, 'new_amount', p_amount);
end $$;

-- 外部廠商外包（非集團公司）：一鍵建立進貨單草稿並標記工序外包廠商
create or replace function public.create_outsource_purchase(
  p_task_id uuid, p_vendor_id uuid, p_amount numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_t record; v_v record; v_pid uuid; v_no text;
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可建立進貨單' using errcode = '42501'; end if;
  select t.*, o.order_no, o.item_name, o.spec, o.qty, o.unit, ws.name as station_name into v_t
    from order_tasks t join orders o on o.id = t.order_id join work_stations ws on ws.id = t.station_id
   where t.id = p_task_id and t.company_id = public.current_company_id();
  if v_t.id is null then raise exception 'P0001: 找不到工序或無權限'; end if;
  select * into v_v from vendors where id = p_vendor_id and company_id = v_t.company_id and is_active;
  if v_v.id is null then raise exception 'P0001: 找不到廠商'; end if;
  if v_v.linked_company_id is not null then
    raise exception 'P0006: 集團內廠商請用「派外包」';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'P0003: 金額不正確'; end if;

  v_no := public.next_doc_no(v_t.company_id, 'PO');
  insert into purchases (company_id, purchase_no, vendor_id, purchase_date, source_type,
                         related_order_id, tax_type, status, note, created_by, updated_by)
  values (v_t.company_id, v_no, p_vendor_id, (now() at time zone 'Asia/Taipei')::date, 'direct',
          v_t.order_id, 'taxable', 'draft',
          coalesce(p_note, '外包 ' || v_t.order_no || '「' || v_t.station_name || '」'),
          auth.uid(), auth.uid())
  returning id into v_pid;
  insert into purchase_items (company_id, purchase_id, item_name, spec, qty, unit, unit_price, is_warehouse_in, created_by)
  values (v_t.company_id, v_pid, '外包：' || v_t.station_name || '－' || coalesce(v_t.item_name, ''),
          v_t.spec, 1, '式', p_amount, false, auth.uid());
  update order_tasks set vendor_id = p_vendor_id, purchase_id = v_pid, updated_at = now() where id = p_task_id;
  return jsonb_build_object('ok', true, 'purchase_id', v_pid, 'purchase_no', v_no);
end $$;

-- ---------------------------------------------------------------------
-- 7. 庫存
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  item_code    text,
  name         text not null,
  spec         text not null default '',
  unit         text,
  qty_on_hand  numeric not null default 0,
  avg_cost     numeric not null default 0,
  safety_qty   numeric not null default 0,
  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (company_id, name, spec)
);
create table public.inventory_moves (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  item_id      uuid not null references public.inventory_items(id),
  move_type    text not null check (move_type in ('in', 'out', 'adjust')),
  qty          numeric not null,          -- 正數入、負數出
  unit_cost    numeric not null default 0,
  source_type  text not null check (source_type in ('purchase', 'purchase_void', 'issue', 'adjust')),
  source_id    uuid,
  order_id     uuid references public.orders(id),
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid
);
create index inventory_moves_item_idx on public.inventory_moves(item_id, created_at);
create index inventory_moves_source_idx on public.inventory_moves(source_id);
alter table public.inventory_items enable row level security;
alter table public.inventory_moves enable row level security;
create policy inventory_items_read on public.inventory_items for select to authenticated
  using (company_id = public.current_company_id() and (public.is_manager() or public.has_perm('inventory', 'view')));
create policy inventory_items_edit on public.inventory_items for update to authenticated
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());
create policy inventory_moves_read on public.inventory_moves for select to authenticated
  using (company_id = public.current_company_id() and (public.is_manager() or public.has_perm('inventory', 'view')));
revoke all on public.inventory_items, public.inventory_moves from anon, authenticated;
grant select on public.inventory_items, public.inventory_moves to authenticated;
grant update (item_code, safety_qty, unit, is_active, note) on public.inventory_items to authenticated;
create trigger set_inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- 異動寫入時同步庫存量與移動平均成本
create or replace function public.trg_inventory_move_apply_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_i record; v_new_qty numeric;
begin
  select * into v_i from inventory_items where id = new.item_id for update;
  v_new_qty := v_i.qty_on_hand + new.qty;
  update inventory_items set
    qty_on_hand = v_new_qty,
    avg_cost = case when new.move_type = 'in' and new.qty > 0 and v_new_qty > 0
                    then round((greatest(v_i.qty_on_hand, 0) * v_i.avg_cost + new.qty * new.unit_cost)
                               / (greatest(v_i.qty_on_hand, 0) + new.qty), 4)
                    else v_i.avg_cost end,
    updated_at = now()
  where id = new.item_id;
  return new;
end $$;
create trigger trg_inventory_move_apply after insert on public.inventory_moves
  for each row execute function public.trg_inventory_move_apply_fn();

-- 進貨確認（stock）→ 入庫；作廢 → 反沖
create or replace function public.trg_purchase_inventory_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_it record; v_item_id uuid;
begin
  if new.status = 'confirmed' and old.status = 'draft' and new.source_type = 'stock' then
    for v_it in select * from purchase_items where purchase_id = new.id and is_warehouse_in and qty > 0 loop
      insert into inventory_items (company_id, name, spec, unit, created_by)
      values (new.company_id, v_it.item_name, coalesce(v_it.spec, ''), v_it.unit, new.updated_by)
      on conflict (company_id, name, spec) do update set unit = coalesce(inventory_items.unit, excluded.unit)
      returning id into v_item_id;
      insert into inventory_moves (company_id, item_id, move_type, qty, unit_cost, source_type, source_id, note, created_by)
      values (new.company_id, v_item_id, 'in', v_it.qty, coalesce(v_it.unit_price, 0), 'purchase', new.id,
              '進貨 ' || new.purchase_no, new.updated_by);
    end loop;
  elsif new.status = 'void' and old.status = 'confirmed' then
    insert into inventory_moves (company_id, item_id, move_type, qty, unit_cost, source_type, source_id, note, created_by)
    select m.company_id, m.item_id, 'adjust', -m.qty, m.unit_cost, 'purchase_void', new.id,
           '進貨作廢 ' || new.purchase_no, new.updated_by
      from inventory_moves m where m.source_type = 'purchase' and m.source_id = new.id;
  end if;
  return new;
end $$;
create trigger trg_purchase_inventory after update of status on public.purchases
  for each row execute function public.trg_purchase_inventory_fn();

-- 領料（出庫），可掛工單成本
create or replace function public.inventory_issue(p_item_id uuid, p_qty numeric, p_order_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_i record; v_mid uuid; v_cost numeric;
begin
  if not (public.is_manager() or public.has_perm('inventory', 'edit')) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select * into v_i from inventory_items where id = p_item_id and company_id = public.current_company_id();
  if v_i.id is null then raise exception 'P0001: 找不到品項'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'P0003: 數量需大於 0'; end if;
  if p_qty > v_i.qty_on_hand then raise exception 'P0003: 庫存不足（現有 %）', v_i.qty_on_hand; end if;
  if p_order_id is not null and not exists (select 1 from orders where id = p_order_id and company_id = v_i.company_id) then
    raise exception 'P0001: 找不到工單';
  end if;
  insert into inventory_moves (company_id, item_id, move_type, qty, unit_cost, source_type, order_id, note, created_by)
  values (v_i.company_id, p_item_id, 'out', -p_qty, v_i.avg_cost, 'issue', p_order_id, p_note, auth.uid())
  returning id into v_mid;
  v_cost := round(p_qty * v_i.avg_cost);
  if p_order_id is not null and v_cost > 0 then
    insert into order_costs (company_id, order_id, cost_type, source_type, source_id, amount, recognized_at, note, created_by)
    values (v_i.company_id, p_order_id, 'material', 'inventory', v_mid, v_cost,
            (now() at time zone 'Asia/Taipei')::date, '領料：' || v_i.name, auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'move_id', v_mid, 'cost', v_cost);
end $$;

-- 盤點調整
create or replace function public.inventory_adjust(p_item_id uuid, p_actual_qty numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_i record; v_diff numeric;
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可盤點調整' using errcode = '42501'; end if;
  select * into v_i from inventory_items where id = p_item_id and company_id = public.current_company_id();
  if v_i.id is null then raise exception 'P0001: 找不到品項'; end if;
  if p_actual_qty is null or p_actual_qty < 0 then raise exception 'P0003: 數量不正確'; end if;
  v_diff := p_actual_qty - v_i.qty_on_hand;
  if v_diff = 0 then return jsonb_build_object('ok', true, 'diff', 0); end if;
  insert into inventory_moves (company_id, item_id, move_type, qty, unit_cost, source_type, note, created_by)
  values (v_i.company_id, p_item_id, 'adjust', v_diff, v_i.avg_cost, 'adjust', coalesce(p_note, '盤點調整'), auth.uid());
  return jsonb_build_object('ok', true, 'diff', v_diff);
end $$;

-- 手動新增品項（期初）
create or replace function public.inventory_create_item(
  p_name text, p_spec text default '', p_unit text default null, p_qty numeric default 0,
  p_unit_cost numeric default 0, p_safety_qty numeric default 0, p_item_code text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_c uuid := public.current_company_id();
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可新增品項' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'P0003: 品名必填'; end if;
  insert into inventory_items (company_id, item_code, name, spec, unit, safety_qty, avg_cost, created_by)
  values (v_c, p_item_code, trim(p_name), coalesce(p_spec, ''), p_unit, coalesce(p_safety_qty, 0),
          coalesce(p_unit_cost, 0), auth.uid())
  returning id into v_id;
  if coalesce(p_qty, 0) > 0 then
    insert into inventory_moves (company_id, item_id, move_type, qty, unit_cost, source_type, note, created_by)
    values (v_c, v_id, 'adjust', p_qty, coalesce(p_unit_cost, 0), 'adjust', '期初', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'item_id', v_id);
end $$;

-- ---------------------------------------------------------------------
-- 8. 權限：新函式只開給 authenticated 需要的 RPC
-- ---------------------------------------------------------------------
revoke execute on function
  public.trg_order_amounts_fn(), public.trg_order_default_template_fn(),
  public.trg_quotation_item_amount_fn(), public.trg_quotation_totals_fn(), public.trg_quotation_items_touch_fn(),
  public.trg_purchase_item_amount_fn(), public.trg_purchase_totals_fn(), public.trg_purchase_items_touch_fn(),
  public.trg_order_status_guard_fn(), public.trg_attendance_holiday_fn(), public.trg_outsource_cost_fn(),
  public.trg_inventory_move_apply_fn(), public.trg_purchase_inventory_fn(),
  public.set_order_status(uuid, text), public.create_delivery_note(uuid, date, text, text, text),
  public.void_delivery_note(uuid, text), public.group_kpis(),
  public.adjust_outsource_amount(uuid, numeric, text), public.create_outsource_purchase(uuid, uuid, numeric, text),
  public.inventory_issue(uuid, numeric, uuid, text), public.inventory_adjust(uuid, numeric, text),
  public.inventory_create_item(text, text, text, numeric, numeric, numeric, text)
from public, anon;
grant execute on function
  public.set_order_status(uuid, text), public.create_delivery_note(uuid, date, text, text, text),
  public.void_delivery_note(uuid, text), public.group_kpis(),
  public.adjust_outsource_amount(uuid, numeric, text), public.create_outsource_purchase(uuid, uuid, numeric, text),
  public.inventory_issue(uuid, numeric, uuid, text), public.inventory_adjust(uuid, numeric, text),
  public.inventory_create_item(text, text, text, numeric, numeric, numeric, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 9. 模組、選單、權限
-- ---------------------------------------------------------------------
insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active) values
  ('inventory', '庫存', 'finance', true, 45, true),
  ('holidays', '假日行事曆', 'hr', true, 45, true),
  ('delivery', '出貨單', 'ops', true, 15, true)
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, m.k, true from public.companies c cross join (values ('inventory'), ('holidays'), ('delivery')) m(k)
on conflict do nothing;

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'inventory', (select id from public.menus where menu_key = 'grp_ap'), '庫存', 'Boxes', '/dashboard/inventory', 'inventory', 40, true
where not exists (select 1 from public.menus where menu_key = 'inventory');
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'holidays', (select id from public.menus where menu_key = 'grp_hr'), '假日行事曆', 'CalendarDays', '/dashboard/holidays', 'holidays', 40, true
where not exists (select 1 from public.menus where menu_key = 'holidays');
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'deliveries', (select id from public.menus where menu_key = 'grp_ops'), '出貨單', 'Truck', '/dashboard/deliveries', 'delivery', 15, true
where not exists (select 1 from public.menus where menu_key = 'deliveries');

insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, m.k, true, r.code <> 'staff', r.code <> 'staff', r.code = 'owner', r.code <> 'staff'
  from public.roles r cross join (values ('inventory'), ('holidays'), ('delivery')) m(k)
 where r.code in ('owner', 'manager')
    or (r.code = 'staff' and m.k = 'holidays')
on conflict do nothing;
