-- =====================================================================
-- 028：應收／應付 收付款與沖帳功能補齊
--
--  1. 收款／付款可記手續費（匯費）與折讓：可沖金額 = 實收(付) + 手續費 + 折讓
--  2. 允許「預收／預付」：收付款可先不沖或部分沖帳，未沖餘額之後再沖（apply_*）
--  3. 尾差、壞帳、折讓單獨沖銷（write_off_*），可用作廢收付款反沖
--  4. 手動新增應收／應付（雜項、期初帳款），可作廢；發票號碼、到期日、備註可修改
--  5. 沖帳檢查：應收必須是同一客戶、應付必須是同一廠商（原本沒檢查）
--  6. 作廢收付款保留沖帳明細（標示已作廢），不再刪除歷史
--  7. 六張帳務表前端只能讀，寫入一律經由上述 RPC（原本主管可直接改已收金額）
-- =====================================================================

-- ---------- 0. 舊版函式與限制（參數改變需先移除，避免 PostgREST 多載衝突） ----------
drop function if exists public.allocate_collection(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid);
drop function if exists public.allocate_payment(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid);
alter table public.payments drop constraint if exists payments_method_check;

-- ---------- 1. 欄位 ----------
alter table public.collections
  add column if not exists fee_amount       numeric not null default 0,
  add column if not exists discount_amount  numeric not null default 0,
  add column if not exists allocated_amount numeric not null default 0;
alter table public.payments
  add column if not exists fee_amount       numeric not null default 0,
  add column if not exists discount_amount  numeric not null default 0,
  add column if not exists allocated_amount numeric not null default 0;

update public.collections c
   set allocated_amount = coalesce((select sum(a.allocated_amount) from public.collection_allocations a
                                     where a.collection_id = c.id), 0)
 where c.status = 'confirmed';
update public.payments p
   set allocated_amount = coalesce((select sum(a.allocated_amount) from public.payment_allocations a
                                     where a.payment_id = p.id), 0)
 where p.status = 'confirmed';
-- 已作廢的舊資料：沖帳明細當時已被移除，可沖金額視同全數沖回
update public.collections set allocated_amount = amount where status = 'void' and allocated_amount = 0;
update public.payments    set allocated_amount = amount where status = 'void' and allocated_amount = 0;

alter table public.collections
  add column if not exists unallocated_amount numeric
  generated always as (case when status = 'void' then 0
                            else amount + fee_amount + discount_amount - allocated_amount end) stored;
alter table public.payments
  add column if not exists unallocated_amount numeric
  generated always as (case when status = 'void' then 0
                            else amount + fee_amount + discount_amount - allocated_amount end) stored;

alter table public.collections add constraint collections_amounts_chk
  check (amount >= 0 and fee_amount >= 0 and discount_amount >= 0
         and allocated_amount <= amount + fee_amount + discount_amount);
alter table public.payments add constraint payments_amounts_chk
  check (amount >= 0 and fee_amount >= 0 and discount_amount >= 0
         and allocated_amount <= amount + fee_amount + discount_amount);
alter table public.collections add constraint collections_method_chk
  check (method in ('cash', 'transfer', 'check', 'atm', 'offset', 'other'));
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'transfer', 'check', 'atm', 'offset', 'other'));

-- 作廢沖帳明細：保留紀錄
alter table public.collection_allocations add column if not exists voided_at timestamptz;
alter table public.payment_allocations    add column if not exists voided_at timestamptz;

create index if not exists idx_collections_customer on public.collections (customer_id);
create index if not exists idx_payments_vendor on public.payments (vendor_id);

-- ---------- 2. 共用：把沖帳明細套到一張收款／付款 ----------
create or replace function public._apply_collection_allocs(p_collection_id uuid, p_allocations jsonb)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare
  v_col collections%rowtype; v_a jsonb; v_r receivables%rowtype;
  v_amt numeric; v_total numeric := 0; v_new numeric;
begin
  select * into v_col from collections where id = p_collection_id for update;
  if not found then raise exception 'P0002: 找不到收款單'; end if;
  if v_col.status <> 'confirmed' then raise exception 'P0001: 收款單已作廢，不能沖帳'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'P0001: 沖帳明細格式錯誤';
  end if;
  for v_a in select * from jsonb_array_elements(p_allocations) loop
    v_amt := round(coalesce((v_a->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then raise exception 'P0001: 沖帳金額必須大於 0'; end if;
    select * into v_r from receivables where id = (v_a->>'receivable_id')::uuid for update;
    if not found then raise exception 'P0002: 找不到應收帳款'; end if;
    if v_r.company_id <> v_col.company_id then raise exception 'P0005: 應收帳款不屬於本公司'; end if;
    if v_r.customer_id <> v_col.customer_id then
      raise exception 'P0001: 應收 % 不是這位客戶的帳款', v_r.doc_no;
    end if;
    if v_r.status = 'void' then raise exception 'P0001: 應收 % 已作廢', v_r.doc_no; end if;
    v_new := v_r.received_amount + v_amt;
    if v_new > v_r.amount then
      raise exception 'P0001: 應收 % 沖帳超過餘額（餘額 %）', v_r.doc_no, v_r.amount - v_r.received_amount;
    end if;
    insert into collection_allocations (company_id, collection_id, receivable_id, allocated_amount, created_by)
    values (v_col.company_id, v_col.id, v_r.id, v_amt, auth.uid());
    update receivables
       set received_amount = v_new,
           status = case when v_new >= amount then 'received' when v_new > 0 then 'partial' else 'unreceived' end
     where id = v_r.id;
    v_total := v_total + v_amt;
  end loop;
  if v_col.allocated_amount + v_total > v_col.amount + v_col.fee_amount + v_col.discount_amount then
    raise exception 'P0001: 沖帳合計 % 超過這筆收款可沖金額 %',
      v_col.allocated_amount + v_total, v_col.amount + v_col.fee_amount + v_col.discount_amount - v_col.allocated_amount;
  end if;
  update collections set allocated_amount = allocated_amount + v_total, updated_by = auth.uid()
   where id = v_col.id;
  return v_total;
end $$;

create or replace function public._apply_payment_allocs(p_payment_id uuid, p_allocations jsonb)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare
  v_pay payments%rowtype; v_a jsonb; v_p payables%rowtype;
  v_amt numeric; v_total numeric := 0; v_new numeric;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then raise exception 'P0002: 找不到付款單'; end if;
  if v_pay.status <> 'confirmed' then raise exception 'P0001: 付款單已作廢，不能沖帳'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'P0001: 沖帳明細格式錯誤';
  end if;
  for v_a in select * from jsonb_array_elements(p_allocations) loop
    v_amt := round(coalesce((v_a->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then raise exception 'P0001: 沖帳金額必須大於 0'; end if;
    select * into v_p from payables where id = (v_a->>'payable_id')::uuid for update;
    if not found then raise exception 'P0002: 找不到應付帳款'; end if;
    if v_p.company_id <> v_pay.company_id then raise exception 'P0005: 應付帳款不屬於本公司'; end if;
    if v_p.vendor_id <> v_pay.vendor_id then
      raise exception 'P0001: 應付 % 不是這家廠商的帳款', v_p.doc_no;
    end if;
    if v_p.status = 'void' then raise exception 'P0001: 應付 % 已作廢', v_p.doc_no; end if;
    v_new := v_p.paid_amount + v_amt;
    if v_new > v_p.amount then
      raise exception 'P0001: 應付 % 沖帳超過餘額（餘額 %）', v_p.doc_no, v_p.amount - v_p.paid_amount;
    end if;
    insert into payment_allocations (company_id, payment_id, payable_id, allocated_amount, created_by)
    values (v_pay.company_id, v_pay.id, v_p.id, v_amt, auth.uid());
    update payables
       set paid_amount = v_new,
           status = case when v_new >= amount then 'paid' when v_new > 0 then 'partial' else 'unpaid' end
     where id = v_p.id;
    v_total := v_total + v_amt;
  end loop;
  if v_pay.allocated_amount + v_total > v_pay.amount + v_pay.fee_amount + v_pay.discount_amount then
    raise exception 'P0001: 沖帳合計 % 超過這筆付款可沖金額 %',
      v_pay.allocated_amount + v_total, v_pay.amount + v_pay.fee_amount + v_pay.discount_amount - v_pay.allocated_amount;
  end if;
  update payments set allocated_amount = allocated_amount + v_total, updated_by = auth.uid()
   where id = v_pay.id;
  return v_total;
end $$;

-- ---------- 3. 收款／付款（新增手續費、折讓、預收預付） ----------
-- 新版比舊版多 p_fee_amount（手續費）、p_discount_amount（折讓）；p_allocations 可為空陣列（預收）
create or replace function public.allocate_collection(
  p_company_id uuid, p_customer_id uuid, p_collect_date date, p_method text, p_amount numeric,
  p_allocations jsonb default '[]'::jsonb, p_bank_account text default null, p_check_no text default null,
  p_check_due_date date default null, p_note text default null, p_created_by uuid default null,
  p_fee_amount numeric default 0, p_discount_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_no text; v_alloc numeric;
begin
  if auth.uid() is not null and (p_company_id is distinct from public.current_company_id() or not public.is_manager()) then
    raise exception 'P0005: 無權限（僅本公司主管可收款沖帳）' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_fee_amount, 0) < 0 or coalesce(p_discount_amount, 0) < 0 then
    raise exception 'P0001: 金額不可為負數';
  end if;
  if coalesce(p_amount, 0) + coalesce(p_fee_amount, 0) + coalesce(p_discount_amount, 0) <= 0 then
    raise exception 'P0001: 收款金額必須大於 0';
  end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'check', 'atm', 'offset', 'other') then
    raise exception 'P0001: 收款方式不正確';
  end if;
  if p_method = 'check' and coalesce(trim(p_check_no), '') = '' then
    raise exception 'P0001: 支票收款請填寫支票號碼';
  end if;
  if not exists (select 1 from customers where id = p_customer_id and company_id = p_company_id) then
    raise exception 'P0002: 找不到客戶';
  end if;

  v_no := public.next_doc_no(p_company_id, 'CM');
  insert into collections (company_id, collection_no, customer_id, collect_date, method, amount,
                           fee_amount, discount_amount, bank_account, check_no, check_due_date,
                           status, note, created_by)
  values (p_company_id, v_no, p_customer_id, coalesce(p_collect_date, current_date), p_method,
          round(coalesce(p_amount, 0), 2), round(coalesce(p_fee_amount, 0), 2),
          round(coalesce(p_discount_amount, 0), 2), nullif(trim(p_bank_account), ''),
          nullif(trim(p_check_no), ''), p_check_due_date, 'confirmed', nullif(trim(p_note), ''),
          coalesce(auth.uid(), p_created_by))
  returning id into v_id;

  v_alloc := public._apply_collection_allocs(v_id, coalesce(p_allocations, '[]'::jsonb));
  return jsonb_build_object('success', true, 'collection_id', v_id, 'collection_no', v_no,
    'allocated', v_alloc,
    'unallocated', (select unallocated_amount from collections where id = v_id));
end $$;

create or replace function public.allocate_payment(
  p_company_id uuid, p_vendor_id uuid, p_pay_date date, p_method text, p_amount numeric,
  p_allocations jsonb default '[]'::jsonb, p_bank_account text default null, p_check_no text default null,
  p_check_due_date date default null, p_note text default null, p_created_by uuid default null,
  p_fee_amount numeric default 0, p_discount_amount numeric default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_no text; v_alloc numeric;
begin
  if auth.uid() is not null and (p_company_id is distinct from public.current_company_id() or not public.is_manager()) then
    raise exception 'P0005: 無權限（僅本公司主管可付款沖帳）' using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) < 0 or coalesce(p_fee_amount, 0) < 0 or coalesce(p_discount_amount, 0) < 0 then
    raise exception 'P0001: 金額不可為負數';
  end if;
  if coalesce(p_amount, 0) + coalesce(p_fee_amount, 0) + coalesce(p_discount_amount, 0) <= 0 then
    raise exception 'P0001: 付款金額必須大於 0';
  end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'check', 'atm', 'offset', 'other') then
    raise exception 'P0001: 付款方式不正確';
  end if;
  if p_method = 'check' and coalesce(trim(p_check_no), '') = '' then
    raise exception 'P0001: 支票付款請填寫支票號碼';
  end if;
  if not exists (select 1 from vendors where id = p_vendor_id and company_id = p_company_id) then
    raise exception 'P0002: 找不到廠商';
  end if;

  v_no := public.next_doc_no(p_company_id, 'PM');
  insert into payments (company_id, payment_no, vendor_id, pay_date, method, amount,
                        fee_amount, discount_amount, bank_account, check_no, check_due_date,
                        status, note, created_by)
  values (p_company_id, v_no, p_vendor_id, coalesce(p_pay_date, current_date), p_method,
          round(coalesce(p_amount, 0), 2), round(coalesce(p_fee_amount, 0), 2),
          round(coalesce(p_discount_amount, 0), 2), nullif(trim(p_bank_account), ''),
          nullif(trim(p_check_no), ''), p_check_due_date, 'confirmed', nullif(trim(p_note), ''),
          coalesce(auth.uid(), p_created_by))
  returning id into v_id;

  v_alloc := public._apply_payment_allocs(v_id, coalesce(p_allocations, '[]'::jsonb));
  return jsonb_build_object('success', true, 'payment_id', v_id, 'payment_no', v_no,
    'allocated', v_alloc,
    'unallocated', (select unallocated_amount from payments where id = v_id));
end $$;

-- ---------- 4. 未沖餘額之後再沖（預收／預付轉沖帳） ----------
create or replace function public.apply_collection(p_collection_id uuid, p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_alloc numeric;
begin
  if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from collections where id = p_collection_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  v_alloc := public._apply_collection_allocs(p_collection_id, p_allocations);
  return jsonb_build_object('success', true, 'allocated', v_alloc,
    'unallocated', (select unallocated_amount from collections where id = p_collection_id));
end $$;

create or replace function public.apply_payment(p_payment_id uuid, p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_alloc numeric;
begin
  if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from payments where id = p_payment_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  v_alloc := public._apply_payment_allocs(p_payment_id, p_allocations);
  return jsonb_build_object('success', true, 'allocated', v_alloc,
    'unallocated', (select unallocated_amount from payments where id = p_payment_id));
end $$;

-- ---------- 5. 作廢收款／付款：反沖並保留明細 ----------
create or replace function public.void_collection(p_collection_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_col collections%rowtype; v_a record; v_new numeric;
begin
  if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from collections where id = p_collection_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select * into v_col from collections where id = p_collection_id for update;
  if not found then raise exception 'P0002: 找不到收款單'; end if;
  if v_col.status = 'void' then raise exception 'P0001: 這筆收款已經作廢'; end if;

  for v_a in select * from collection_allocations
              where collection_id = p_collection_id and voided_at is null for update loop
    update receivables
       set received_amount = greatest(0, received_amount - v_a.allocated_amount),
           status = case when status = 'void' then 'void'
                         when greatest(0, received_amount - v_a.allocated_amount) >= amount then 'received'
                         when greatest(0, received_amount - v_a.allocated_amount) > 0 then 'partial'
                         else 'unreceived' end
     where id = v_a.receivable_id;
    update collection_allocations set voided_at = now() where id = v_a.id;
  end loop;

  update collections set status = 'void', updated_by = auth.uid() where id = p_collection_id;
  return jsonb_build_object('success', true, 'collection_id', p_collection_id);
end $$;

create or replace function public.void_payment(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pay payments%rowtype; v_a record;
begin
  if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from payments where id = p_payment_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  select * into v_pay from payments where id = p_payment_id for update;
  if not found then raise exception 'P0002: 找不到付款單'; end if;
  if v_pay.status = 'void' then raise exception 'P0001: 這筆付款已經作廢'; end if;

  for v_a in select * from payment_allocations
              where payment_id = p_payment_id and voided_at is null for update loop
    update payables
       set paid_amount = greatest(0, paid_amount - v_a.allocated_amount),
           status = case when status = 'void' then 'void'
                         when greatest(0, paid_amount - v_a.allocated_amount) >= amount then 'paid'
                         when greatest(0, paid_amount - v_a.allocated_amount) > 0 then 'partial'
                         else 'unpaid' end
     where id = v_a.payable_id;
    update payment_allocations set voided_at = now() where id = v_a.id;
  end loop;

  update payments set status = 'void', updated_by = auth.uid() where id = p_payment_id;
  return jsonb_build_object('success', true, 'payment_id', p_payment_id);
end $$;

-- ---------- 6. 沖銷（尾差、折讓、壞帳）：以一張「沖銷」收付款記錄，可作廢反沖 ----------
create or replace function public.write_off_receivable(p_receivable_id uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_r receivables%rowtype; v_amt numeric; v_res jsonb;
begin
  select * into v_r from receivables where id = p_receivable_id;
  if not found then raise exception 'P0002: 找不到應收帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_r.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'P0001: 請填寫沖銷原因'; end if;
  if v_r.status in ('void', 'received') then raise exception 'P0001: 這筆應收已結清或作廢'; end if;
  v_amt := coalesce(p_amount, v_r.amount - v_r.received_amount);
  v_res := public.allocate_collection(v_r.company_id, v_r.customer_id, current_date, 'offset', 0,
             jsonb_build_array(jsonb_build_object('receivable_id', v_r.id, 'amount', v_amt)),
             null, null, null, '沖銷：' || trim(p_reason), auth.uid(), 0, v_amt);
  return v_res;
end $$;

create or replace function public.write_off_payable(p_payable_id uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_p payables%rowtype; v_amt numeric; v_res jsonb;
begin
  select * into v_p from payables where id = p_payable_id;
  if not found then raise exception 'P0002: 找不到應付帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_p.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'P0001: 請填寫沖銷原因'; end if;
  if v_p.status in ('void', 'paid') then raise exception 'P0001: 這筆應付已結清或作廢'; end if;
  v_amt := coalesce(p_amount, v_p.amount - v_p.paid_amount);
  v_res := public.allocate_payment(v_p.company_id, v_p.vendor_id, current_date, 'offset', 0,
             jsonb_build_array(jsonb_build_object('payable_id', v_p.id, 'amount', v_amt)),
             null, null, null, '沖銷：' || trim(p_reason), auth.uid(), 0, v_amt);
  return v_res;
end $$;

-- ---------- 7. 手動應收／應付 ----------
create or replace function public.create_manual_receivable(
  p_customer_id uuid, p_amount numeric, p_due_date date, p_invoice_no text, p_note text, p_related_order_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cid uuid := public.current_company_id(); v_c customers%rowtype; v_no text; v_id uuid; v_due date;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'P0005: 無權限（僅主管可新增應收）' using errcode = '42501';
  end if;
  select * into v_c from customers where id = p_customer_id and company_id = v_cid;
  if not found then raise exception 'P0002: 找不到客戶'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'P0001: 金額必須大於 0'; end if;
  if p_related_order_id is not null and not exists (
       select 1 from orders where id = p_related_order_id and company_id = v_cid) then
    raise exception 'P0002: 找不到關聯訂單';
  end if;
  v_due := coalesce(p_due_date, public.calc_due_date(coalesce(v_c.payment_term, 'cash'), current_date));
  v_no := public.next_doc_no(v_cid, 'AR');
  insert into receivables (company_id, customer_id, doc_no, source_type, related_order_id, amount,
                           due_date, invoice_no, note, created_by)
  values (v_cid, p_customer_id, v_no, 'manual', p_related_order_id, round(p_amount, 2),
          v_due, nullif(trim(p_invoice_no), ''), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('success', true, 'receivable_id', v_id, 'doc_no', v_no, 'due_date', v_due);
end $$;

create or replace function public.create_manual_payable(
  p_vendor_id uuid, p_amount numeric, p_due_date date, p_invoice_no text, p_note text, p_related_order_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cid uuid := public.current_company_id(); v_v vendors%rowtype; v_no text; v_id uuid; v_due date;
begin
  if auth.uid() is not null and not public.is_manager() then
    raise exception 'P0005: 無權限（僅主管可新增應付）' using errcode = '42501';
  end if;
  select * into v_v from vendors where id = p_vendor_id and company_id = v_cid;
  if not found then raise exception 'P0002: 找不到廠商'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'P0001: 金額必須大於 0'; end if;
  if p_related_order_id is not null and not exists (
       select 1 from orders where id = p_related_order_id and company_id = v_cid) then
    raise exception 'P0002: 找不到關聯訂單';
  end if;
  v_due := coalesce(p_due_date, public.calc_due_date(coalesce(v_v.payment_term, 'cash'), current_date));
  v_no := public.next_doc_no(v_cid, 'AP');
  insert into payables (company_id, vendor_id, doc_no, source_type, related_order_id, amount,
                        due_date, invoice_no, note, created_by)
  values (v_cid, p_vendor_id, v_no, 'manual', p_related_order_id, round(p_amount, 2),
          v_due, nullif(trim(p_invoice_no), ''), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('success', true, 'payable_id', v_id, 'doc_no', v_no, 'due_date', v_due);
end $$;

-- 修改發票號碼／到期日／備註（金額不能改：出貨、進貨、外包產生的帳款金額由來源單據決定）
create or replace function public.update_receivable_info(
  p_receivable_id uuid, p_invoice_no text, p_due_date date, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_r receivables%rowtype;
begin
  select * into v_r from receivables where id = p_receivable_id for update;
  if not found then raise exception 'P0002: 找不到應收帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_r.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if v_r.status = 'void' then raise exception 'P0001: 已作廢的應收不能修改'; end if;
  update receivables
     set invoice_no = nullif(trim(p_invoice_no), ''),
         due_date = coalesce(p_due_date, due_date),
         note = nullif(trim(p_note), ''),
         updated_by = auth.uid()
   where id = p_receivable_id;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.update_payable_info(
  p_payable_id uuid, p_invoice_no text, p_due_date date, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_p payables%rowtype;
begin
  select * into v_p from payables where id = p_payable_id for update;
  if not found then raise exception 'P0002: 找不到應付帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_p.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if v_p.status = 'void' then raise exception 'P0001: 已作廢的應付不能修改'; end if;
  update payables
     set invoice_no = nullif(trim(p_invoice_no), ''),
         due_date = coalesce(p_due_date, due_date),
         note = nullif(trim(p_note), ''),
         updated_by = auth.uid()
   where id = p_payable_id;
  return jsonb_build_object('success', true);
end $$;

-- 作廢手動帳款（出貨／進貨／外包產生的，請從來源單據作廢或調整）
create or replace function public.void_receivable(p_receivable_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_r receivables%rowtype;
begin
  select * into v_r from receivables where id = p_receivable_id for update;
  if not found then raise exception 'P0002: 找不到應收帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_r.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if v_r.status = 'void' then raise exception 'P0001: 這筆應收已經作廢'; end if;
  if v_r.source_type = 'delivery' then raise exception 'P0001: 出貨產生的應收，請到出貨單作廢'; end if;
  if v_r.source_type = 'outsource' then raise exception 'P0001: 外包產生的應收，請由外包追蹤調整'; end if;
  if v_r.received_amount > 0 then raise exception 'P0001: 已有收款沖帳，請先作廢收款'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'P0001: 請填寫作廢原因'; end if;
  update receivables
     set status = 'void',
         note = concat_ws('；', note, '作廢：' || trim(p_reason)),
         updated_by = auth.uid()
   where id = p_receivable_id;
  return jsonb_build_object('success', true);
end $$;

create or replace function public.void_payable(p_payable_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_p payables%rowtype;
begin
  select * into v_p from payables where id = p_payable_id for update;
  if not found then raise exception 'P0002: 找不到應付帳款'; end if;
  if auth.uid() is not null and (not public.is_manager() or v_p.company_id is distinct from public.current_company_id()) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  if v_p.status = 'void' then raise exception 'P0001: 這筆應付已經作廢'; end if;
  if v_p.source_type = 'purchase' then raise exception 'P0001: 進貨產生的應付，請到進貨單作廢'; end if;
  if v_p.source_type = 'outsource' then raise exception 'P0001: 外包產生的應付，請由外包追蹤調整'; end if;
  if v_p.paid_amount > 0 then raise exception 'P0001: 已有付款沖帳，請先作廢付款'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'P0001: 請填寫作廢原因'; end if;
  update payables
     set status = 'void',
         note = concat_ws('；', note, '作廢：' || trim(p_reason)),
         updated_by = auth.uid()
   where id = p_payable_id;
  return jsonb_build_object('success', true);
end $$;

-- ---------- 8. 權限 ----------
revoke execute on function public._apply_collection_allocs(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._apply_payment_allocs(uuid, jsonb) from public, anon, authenticated;

revoke execute on function public.allocate_collection(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid, numeric, numeric) from public, anon;
revoke execute on function public.allocate_payment(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid, numeric, numeric) from public, anon;
revoke execute on function public.apply_collection(uuid, jsonb) from public, anon;
revoke execute on function public.apply_payment(uuid, jsonb) from public, anon;
revoke execute on function public.void_collection(uuid) from public, anon;
revoke execute on function public.void_payment(uuid) from public, anon;
revoke execute on function public.write_off_receivable(uuid, numeric, text) from public, anon;
revoke execute on function public.write_off_payable(uuid, numeric, text) from public, anon;
revoke execute on function public.create_manual_receivable(uuid, numeric, date, text, text, uuid) from public, anon;
revoke execute on function public.create_manual_payable(uuid, numeric, date, text, text, uuid) from public, anon;
revoke execute on function public.update_receivable_info(uuid, text, date, text) from public, anon;
revoke execute on function public.update_payable_info(uuid, text, date, text) from public, anon;
revoke execute on function public.void_receivable(uuid, text) from public, anon;
revoke execute on function public.void_payable(uuid, text) from public, anon;

grant execute on function public.allocate_collection(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid, numeric, numeric) to authenticated;
grant execute on function public.allocate_payment(uuid, uuid, date, text, numeric, jsonb, text, text, date, text, uuid, numeric, numeric) to authenticated;
grant execute on function public.apply_collection(uuid, jsonb) to authenticated;
grant execute on function public.apply_payment(uuid, jsonb) to authenticated;
grant execute on function public.void_collection(uuid) to authenticated;
grant execute on function public.void_payment(uuid) to authenticated;
grant execute on function public.write_off_receivable(uuid, numeric, text) to authenticated;
grant execute on function public.write_off_payable(uuid, numeric, text) to authenticated;
grant execute on function public.create_manual_receivable(uuid, numeric, date, text, text, uuid) to authenticated;
grant execute on function public.create_manual_payable(uuid, numeric, date, text, text, uuid) to authenticated;
grant execute on function public.update_receivable_info(uuid, text, date, text) to authenticated;
grant execute on function public.update_payable_info(uuid, text, date, text) to authenticated;
grant execute on function public.void_receivable(uuid, text) to authenticated;
grant execute on function public.void_payable(uuid, text) to authenticated;

-- 帳務表前端只能讀；寫入一律走上面的 RPC
revoke all on public.receivables, public.payables, public.collections, public.payments,
              public.collection_allocations, public.payment_allocations from anon, authenticated;
grant select on public.receivables, public.payables, public.collections, public.payments,
                public.collection_allocations, public.payment_allocations to authenticated;
