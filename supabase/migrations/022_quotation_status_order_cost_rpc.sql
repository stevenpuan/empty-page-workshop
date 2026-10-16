-- =====================================================================
-- 022：報價單狀態與轉訂單、工單手動成本改走 RPC；補外鍵索引
-- 2026-10-16
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 報價單狀態：draft → sent → accepted；draft／sent → void
-- ---------------------------------------------------------------------
alter table public.quotations add column if not exists order_id uuid references public.orders(id);

create or replace function public.trg_quotation_status_guard_fn()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and coalesce(current_setting('app.quotation_rpc', true), '') <> 'on' then
    raise exception 'P0007: 報價單狀態請用系統按鈕變更' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_quotation_status_guard before update of status on public.quotations
  for each row execute function public.trg_quotation_status_guard_fn();

create or replace function public.set_quotation_status(p_quotation_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_q record;
begin
  if not (public.is_manager() or public.has_perm('quotations', 'edit')) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select * into v_q from quotations where id = p_quotation_id and company_id = public.current_company_id();
  if v_q.id is null then raise exception 'P0001: 找不到報價單'; end if;
  if not (
       (v_q.status = 'draft' and p_status in ('sent', 'accepted', 'void'))
    or (v_q.status = 'sent'  and p_status in ('accepted', 'void'))
  ) then
    raise exception 'P0002: 報價單狀態 % 不能改成 %', v_q.status, p_status;
  end if;
  perform set_config('app.quotation_rpc', 'on', true);
  update quotations set status = p_status, updated_at = now(), updated_by = auth.uid() where id = p_quotation_id;
  perform set_config('app.quotation_rpc', '', true);
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- 已接受的報價單轉成訂單草稿（金額沿用報價、品項取第一列＋筆數）
create or replace function public.convert_quotation_to_order(p_quotation_id uuid, p_due_date date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_q record; v_first record; v_cnt int; v_oid uuid; v_no text;
begin
  if not (public.is_manager() or public.has_perm('orders', 'create')) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select * into v_q from quotations where id = p_quotation_id and company_id = public.current_company_id() for update;
  if v_q.id is null then raise exception 'P0001: 找不到報價單'; end if;
  if v_q.status <> 'accepted' then raise exception 'P0002: 只有已接受的報價單可以轉訂單'; end if;
  if v_q.order_id is not null then raise exception 'P0002: 此報價單已轉過訂單'; end if;
  select * into v_first from quotation_items where quotation_id = p_quotation_id order by sort_order, id limit 1;
  select count(*) into v_cnt from quotation_items where quotation_id = p_quotation_id;

  insert into orders (company_id, customer_id, item_name, spec, qty, unit,
                      amount_untaxed, tax_amount, due_date, status, note, created_by, updated_by)
  values (v_q.company_id, v_q.customer_id,
          coalesce(v_first.item_name, '報價 ' || v_q.quote_no) || case when v_cnt > 1 then '（等 ' || v_cnt || ' 項）' else '' end,
          v_first.spec, case when v_cnt = 1 then v_first.qty end, case when v_cnt = 1 then v_first.unit end,
          v_q.subtotal, v_q.tax_amount, p_due_date, 'draft',
          '由報價單 ' || v_q.quote_no || ' 轉入', auth.uid(), auth.uid())
  returning id, order_no into v_oid, v_no;

  update quotations set order_id = v_oid, updated_at = now() where id = p_quotation_id;
  return jsonb_build_object('ok', true, 'order_id', v_oid, 'order_no', v_no);
end $$;

-- ---------------------------------------------------------------------
-- 2. 工單手動成本：只能經 RPC 新增
-- ---------------------------------------------------------------------
create or replace function public.add_order_cost(
  p_order_id uuid, p_cost_type text, p_amount numeric, p_recognized_at date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_o record; v_id uuid;
begin
  if not public.is_manager() then raise exception 'P0005: 僅主管可新增成本' using errcode = '42501'; end if;
  select * into v_o from orders where id = p_order_id and company_id = public.current_company_id();
  if v_o.id is null then raise exception 'P0001: 找不到工單'; end if;
  if p_cost_type not in ('material', 'outsource', 'labor', 'other') then raise exception 'P0003: 成本類別不正確'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'P0003: 金額需大於 0'; end if;
  insert into order_costs (company_id, order_id, cost_type, source_type, amount, recognized_at, note, created_by, updated_by)
  values (v_o.company_id, p_order_id, p_cost_type, 'manual', round(p_amount, 2),
          coalesce(p_recognized_at, (now() at time zone 'Asia/Taipei')::date), p_note, auth.uid(), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'cost_id', v_id);
end $$;

-- 前端不再直接寫 order_costs：寫入權限收回，只保留讀
revoke all on public.order_costs from authenticated, anon;
grant select on public.order_costs to authenticated;

revoke execute on function public.trg_quotation_status_guard_fn() from public, anon, authenticated;
revoke execute on function
  public.set_quotation_status(uuid, text), public.convert_quotation_to_order(uuid, date),
  public.add_order_cost(uuid, text, numeric, date, text)
from public, anon;
grant execute on function
  public.set_quotation_status(uuid, text), public.convert_quotation_to_order(uuid, date),
  public.add_order_cost(uuid, text, numeric, date, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 3. 外鍵索引（advisor：unindexed foreign keys）
-- ---------------------------------------------------------------------
do $$
declare r record; v_name text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conrelid, a.attname as col, c.conkey
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    v_name := left(replace(r.tbl::text, 'public.', '') || '_' || r.col || '_fkidx', 63);
    execute format('create index if not exists %I on %s (%I)', v_name, r.tbl, r.col);
  end loop;
end $$;
