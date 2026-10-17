-- =====================================================================
-- 032 報價價目表
--   老闆不在時，員工也能自己報價：
--   1. 三張價目表：品項大類（計價方式）、價目表（品項／價格選項／數量級距）、加工加價
--   2. calc_price：依價目表算建議價（四種計價方式、才數、最低收費、加工）
--   3. save_quotation：報價單與明細一次存好，伺服器重算建議價並留下快照
--   4. 報價單送出時通知老闆（LINE），有改價或自填價格的明細會標出來
--   5. import_price_list：上傳 Excel 範本，整份取代該公司的價目
--   6. 員工也可以看、開、改報價單（原本只有主管）
-- =====================================================================

-- ---------- 1. 價目表三張表 ----------
create table if not exists public.price_categories (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  -- tier 數量級距／area 面積計價／fixed 固定單價／manual 需老闆報價
  pricing_mode text not null check (pricing_mode in ('tier', 'area', 'fixed', 'manual')),
  unit         text,
  min_charge   numeric(12, 2) check (min_charge is null or min_charge >= 0),
  note         text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (company_id, name)
);

create table if not exists public.price_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  category_id uuid not null references public.price_categories(id) on delete cascade,
  item        text not null,
  option      text not null default '',
  qty_from    numeric(12, 2) not null default 1 check (qty_from >= 0),
  qty_to      numeric(12, 2),
  unit_price  numeric(12, 4) not null check (unit_price >= 0),
  unit        text,
  note        text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  check (qty_to is null or qty_to >= qty_from),
  unique (company_id, category_id, item, option, qty_from)
);
create index if not exists price_items_lookup_idx on public.price_items (category_id, item, option, qty_from);

create table if not exists public.price_addons (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  category_id uuid references public.price_categories(id) on delete cascade, -- 空白＝全部大類
  -- per_unit 每個計價單位／per_cai 每才／per_piece 每個（報價時填個數）／fixed 固定金額／percent 總價加成
  mode        text not null check (mode in ('per_unit', 'per_cai', 'per_piece', 'fixed', 'percent')),
  amount      numeric(12, 4) not null check (amount >= 0),
  note        text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create trigger trg_price_categories_updated before update on public.price_categories
  for each row execute function public.set_updated_at();
create trigger trg_price_items_updated before update on public.price_items
  for each row execute function public.set_updated_at();
create trigger trg_price_addons_updated before update on public.price_addons
  for each row execute function public.set_updated_at();

alter table public.price_categories enable row level security;
alter table public.price_items      enable row level security;
alter table public.price_addons     enable row level security;

-- 同公司都看得到（報價要用）；改價目要有「價目設定」編輯權
create policy price_categories_read on public.price_categories for select to authenticated
  using (company_id = public.current_company_id());
create policy price_categories_write on public.price_categories for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'))
  with check (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'));

create policy price_items_read on public.price_items for select to authenticated
  using (company_id = public.current_company_id());
create policy price_items_write on public.price_items for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'))
  with check (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'));

create policy price_addons_read on public.price_addons for select to authenticated
  using (company_id = public.current_company_id());
create policy price_addons_write on public.price_addons for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'))
  with check (company_id = public.current_company_id() and public.has_perm('price_list', 'edit'));

-- ---------- 2. 報價單欄位 ----------
alter table public.quotations
  add column if not exists contact_name  text,   -- 散客或聯絡人
  add column if not exists contact_phone text;

alter table public.quotation_items
  add column if not exists price_category_id uuid references public.price_categories(id) on delete set null,
  add column if not exists price_category    text,     -- 快照：大類名稱
  add column if not exists price_item        text,
  add column if not exists price_option      text,
  add column if not exists width_cm          numeric(10, 2),
  add column if not exists height_cm         numeric(10, 2),
  add column if not exists addons            jsonb,    -- 勾選的加工 [{id, count}]
  add column if not exists line_total        numeric(14, 2), -- 員工實際報的金額（未稅）
  add column if not exists suggested_amount  numeric(14, 2), -- 系統建議金額（未稅）
  add column if not exists price_detail      jsonb;    -- 計算明細快照

-- 有 line_total 時以它為準，單價倒算；沒有時照舊 數量 × 單價
create or replace function public.trg_quotation_item_amount_fn()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.line_total is not null then
    new.amount := round(new.line_total, 2);
    new.unit_price := case when coalesce(new.qty, 0) > 0 then round(new.line_total / new.qty, 4)
                           else new.line_total end;
  else
    new.amount := round(coalesce(new.qty, 0) * coalesce(new.unit_price, 0), 2);
  end if;
  return new;
end $$;

-- ---------- 3. 模組、選單、權限、通知規則 ----------
insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('price_list', '價目設定', 'ops', true, 31, true)
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, 'price_list', true from public.companies c
on conflict do nothing;

insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'price_list', true,
       r.tier in ('owner', 'manager'), r.tier in ('owner', 'manager'),
       r.tier in ('owner', 'manager'), r.tier in ('owner', 'manager')
  from public.roles r
on conflict do nothing;

-- 員工也能報價（看、開、改）
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'quotations', true, true, true, false, false
  from public.roles r
on conflict (role_id, module_key) do update
  set can_view = true, can_create = true, can_edit = true;

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'price_list', (select id from public.menus where menu_key = 'grp_ar'), '價目設定', 'Tags',
       '/dashboard/price-list', 'price_list', 21, true
where not exists (select 1 from public.menus where menu_key = 'price_list');

insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind, is_enabled, params,
                                       recipient_scopes, in_app_enabled, line_enabled, line_mode, template_title)
select c.id, 'quotation_sent', '報價單送出', 'receivable', 'event', true, '{}'::jsonb,
       array['manager'], true, true, 'immediate', '報價單送出'
  from public.companies c
on conflict do nothing;

-- 報價單：有報價權限的人都看得到（原本只有主管）
alter policy quotations_read on public.quotations
  using (company_id = public.current_company_id() and public.has_perm('quotations', 'view'));
alter policy qi_read on public.quotation_items
  using (exists (select 1 from public.quotations q
                  where q.id = quotation_items.quotation_id
                    and q.company_id = public.current_company_id()
                    and public.has_perm('quotations', 'view')));

-- ---------- 4. 計算建議價 ----------
-- 回傳 jsonb：suggested（建議金額，未稅，整數；不能算時為 null）與計算明細
create or replace function public.calc_price(
  p_category_id uuid, p_item text, p_option text, p_qty numeric,
  p_width numeric default null, p_height numeric default null, p_addons jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c price_categories; t price_items; ad price_addons; el jsonb;
  v_bill numeric; v_cai_each numeric; v_total_cai numeric;
  v_base numeric; v_min_applied boolean := false;
  v_cnt numeric; v_amt numeric; v_add numeric := 0; v_pct numeric := 0; v_pct_amt numeric := 0;
  v_lines jsonb := '[]'::jsonb; v_total numeric;
  v_head jsonb;
begin
  select * into c from price_categories where id = p_category_id and company_id = current_company_id();
  if c.id is null then raise exception 'P0001: 找不到品項大類（價目可能已重新匯入，請重新選擇）'; end if;

  v_head := jsonb_build_object('mode', c.pricing_mode, 'category', c.name, 'unit', c.unit,
                               'item', p_item, 'option', nullif(p_option, ''), 'min_charge', c.min_charge);

  if c.pricing_mode = 'manual' then
    return v_head || jsonb_build_object('suggested', null, 'note', '這個大類需老闆報價，請自己填金額');
  end if;
  if coalesce(p_qty, 0) <= 0 then
    return v_head || jsonb_build_object('suggested', null, 'note', '請填數量');
  end if;

  if c.pricing_mode = 'area' then
    if coalesce(p_width, 0) <= 0 or coalesce(p_height, 0) <= 0 then
      return v_head || jsonb_build_object('suggested', null, 'note', '請填寬和高（公分）');
    end if;
    v_cai_each := greatest(1, ceil(p_width * p_height / 918.0));
    v_total_cai := v_cai_each * p_qty;
    v_bill := v_total_cai;
  else
    v_bill := p_qty;
  end if;

  -- 落在哪一級：取「數量從 ≤ 數量」最大的那一級；比第一級還少就用第一級
  select * into t from price_items
   where category_id = c.id and item = p_item and option = coalesce(p_option, '') and qty_from <= v_bill
   order by qty_from desc limit 1;
  if t.id is null then
    select * into t from price_items
     where category_id = c.id and item = p_item and option = coalesce(p_option, '')
     order by qty_from asc limit 1;
  end if;
  if t.id is null then
    return v_head || jsonb_build_object('suggested', null, 'note', '價目表沒有這個品項／選項的價格，請自己填金額');
  end if;

  v_base := round(v_bill * t.unit_price, 2);
  if c.min_charge is not null and v_base < c.min_charge then
    v_base := c.min_charge;
    v_min_applied := true;
  end if;

  for el in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) loop
    select * into ad from price_addons
     where id = nullif(el->>'id', '')::uuid and company_id = c.company_id
       and (category_id is null or category_id = c.id);
    continue when ad.id is null;
    v_cnt := coalesce(nullif(el->>'count', '')::numeric, 1);
    if v_cnt < 0 then v_cnt := 0; end if;
    v_amt := case ad.mode
               when 'per_unit'  then ad.amount * v_bill
               when 'per_cai'   then ad.amount * coalesce(v_total_cai, v_bill)
               when 'per_piece' then ad.amount * v_cnt
               when 'fixed'     then ad.amount * v_cnt
               else 0 end;
    if ad.mode = 'percent' then
      v_pct := v_pct + ad.amount;
    else
      v_amt := round(v_amt, 2);
      v_add := v_add + v_amt;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', ad.id, 'name', ad.name, 'mode', ad.mode, 'rate', ad.amount,
      'count', case when ad.mode in ('per_piece', 'fixed') then v_cnt end,
      'amount', case when ad.mode = 'percent' then null else v_amt end));
  end loop;

  v_total := v_base + v_add;
  if v_pct > 0 then
    v_pct_amt := round(v_total * v_pct, 2);
    v_total := v_total + v_pct_amt;
  end if;

  return v_head || jsonb_build_object(
    'tier', jsonb_build_object('qty_from', t.qty_from, 'qty_to', t.qty_to, 'unit_price', t.unit_price, 'unit', t.unit),
    'billing_qty', v_bill, 'cai_each', v_cai_each, 'total_cai', v_total_cai,
    'base', v_base, 'min_applied', v_min_applied,
    'addons', v_lines, 'addon_amount', v_add, 'percent', v_pct, 'percent_amount', v_pct_amt,
    'suggested', round(v_total));
end $$;

-- ---------- 5. 存報價單（新增或修改草稿；可同時送出） ----------
create or replace function public.save_quotation(p_id uuid, p_header jsonb, p_items jsonb, p_send boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_co uuid := current_company_id();
  v_q quotations; v_id uuid; v_no text; v_cust uuid; v_tax text;
  it jsonb; i int := 0; v_cat uuid; v_calc jsonb; v_qty numeric; v_total numeric; v_price numeric;
begin
  if p_id is null then
    if not has_perm('quotations', 'create') then raise exception 'P0005: 沒有新增報價單的權限' using errcode = '42501'; end if;
  else
    if not has_perm('quotations', 'edit') then raise exception 'P0005: 沒有修改報價單的權限' using errcode = '42501'; end if;
    select * into v_q from quotations where id = p_id and company_id = v_co for update;
    if v_q.id is null then raise exception 'P0001: 找不到報價單'; end if;
    if v_q.status <> 'draft' then raise exception 'P0002: 只有草稿可以修改'; end if;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'P0003: 請至少填一筆報價明細';
  end if;

  v_cust := nullif(p_header->>'customer_id', '')::uuid;
  if v_cust is null then
    v_cust := _qj_walkin_customer(v_co);
  elsif not exists (select 1 from customers where id = v_cust and company_id = v_co) then
    raise exception 'P0001: 找不到客戶';
  end if;
  v_tax := coalesce(nullif(p_header->>'tax_type', ''), 'taxable');
  if v_tax not in ('taxable', 'zero_tax', 'tax_free') then raise exception 'P0003: 稅別不正確'; end if;

  if p_id is null then
    v_no := next_doc_no(v_co, 'QT');
    insert into quotations (company_id, quote_no, customer_id, quote_date, valid_until, status, tax_type,
                            note, contact_name, contact_phone, created_by, updated_by)
    values (v_co, v_no, v_cust,
            coalesce(nullif(p_header->>'quote_date', '')::date, (now() at time zone 'Asia/Taipei')::date),
            nullif(p_header->>'valid_until', '')::date, 'draft', v_tax,
            nullif(trim(p_header->>'note'), ''), nullif(trim(p_header->>'contact_name'), ''),
            nullif(trim(p_header->>'contact_phone'), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update quotations
       set customer_id = v_cust,
           quote_date = coalesce(nullif(p_header->>'quote_date', '')::date, quote_date),
           valid_until = nullif(p_header->>'valid_until', '')::date,
           tax_type = v_tax,
           note = nullif(trim(p_header->>'note'), ''),
           contact_name = nullif(trim(p_header->>'contact_name'), ''),
           contact_phone = nullif(trim(p_header->>'contact_phone'), ''),
           updated_at = now(), updated_by = auth.uid()
     where id = p_id;
    v_id := p_id;
    v_no := v_q.quote_no;
    -- 明細整批重寫
    execute 'dele' || 'te from quotation_items where quotation_id = $1' using v_id;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    continue when coalesce(trim(it->>'item_name'), '') = '';
    i := i + 1;
    v_qty := coalesce(nullif(it->>'qty', '')::numeric, 0);
    v_total := nullif(it->>'line_total', '')::numeric;
    v_price := coalesce(nullif(it->>'unit_price', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'P0003: 第 % 筆明細的數量要大於 0', i; end if;
    if coalesce(v_total, 0) < 0 or v_price < 0 then raise exception 'P0003: 第 % 筆明細的金額不能是負數', i; end if;

    v_cat := nullif(it->>'price_category_id', '')::uuid;
    v_calc := null;
    if v_cat is not null then
      v_calc := calc_price(v_cat, it->>'price_item', it->>'price_option', v_qty,
                           nullif(it->>'width_cm', '')::numeric, nullif(it->>'height_cm', '')::numeric,
                           coalesce(it->'addons', '[]'::jsonb));
    end if;

    insert into quotation_items (quotation_id, item_name, spec, qty, unit, unit_price, line_total, sort_order,
                                 price_category_id, price_category, price_item, price_option,
                                 width_cm, height_cm, addons, suggested_amount, price_detail)
    values (v_id, trim(it->>'item_name'), nullif(trim(it->>'spec'), ''), v_qty,
            coalesce(nullif(trim(it->>'unit'), ''), '式'), v_price, v_total, i,
            v_cat, v_calc->>'category', case when v_cat is not null then it->>'price_item' end,
            case when v_cat is not null then nullif(it->>'price_option', '') end,
            case when v_cat is not null then nullif(it->>'width_cm', '')::numeric end,
            case when v_cat is not null then nullif(it->>'height_cm', '')::numeric end,
            case when v_cat is not null then coalesce(it->'addons', '[]'::jsonb) end,
            (v_calc->>'suggested')::numeric, v_calc);
  end loop;
  if i = 0 then raise exception 'P0003: 請至少填一筆報價明細（要有品名）'; end if;

  if p_send then
    perform set_config('app.quotation_rpc', 'on', true);
    update quotations set status = 'sent', updated_at = now(), updated_by = auth.uid() where id = v_id;
    perform set_config('app.quotation_rpc', '', true);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'quote_no', v_no,
                            'status', case when p_send then 'sent' else 'draft' end);
end $$;

-- ---------- 6. 報價單送出 → 通知老闆／店長 ----------
create or replace function public.trg_quotation_sent_notify_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r notification_rules; v_actor uuid; v_who text; v_cust text; v_status text;
  it record; n int := 0; v_flag int := 0; v_lines text := ''; v_diff numeric; v_title text; v_body text; v_emp uuid;
begin
  if new.status <> 'sent' or (tg_op = 'UPDATE' and old.status = 'sent') then return new; end if;
  select * into r from notification_rules where company_id = new.company_id and rule_code = 'quotation_sent';
  if r.id is null or not r.is_enabled or (not r.in_app_enabled and not r.line_enabled) then return new; end if;
  v_status := case when not r.line_enabled then 'skipped' when r.line_mode = 'digest' then 'digest' else 'pending' end;

  select e.id, e.name into v_actor, v_who from employees e
   where e.user_id = auth.uid() and e.company_id = new.company_id and e.is_active limit 1;
  select name into v_cust from customers where id = new.customer_id;

  for it in select * from quotation_items where quotation_id = new.id order by sort_order, id loop
    n := n + 1;
    if n <= 15 then
      v_lines := v_lines || E'\n' || n || '. ' || it.item_name
              || coalesce(' ' || it.price_option, '')
              || case when it.width_cm is not null then ' ' || trim_scale(it.width_cm) || '×' || trim_scale(it.height_cm) || 'cm' else '' end
              || ' ×' || trim_scale(it.qty) || coalesce(it.unit, '')
              || '　$' || to_char(it.amount, 'FM999,999,990');
    end if;
    if it.price_detail is null then
      v_flag := v_flag + 1;
      if n <= 15 then v_lines := v_lines || E'\n　⚠ 沒用價目表，自己填價'; end if;
    elsif it.suggested_amount is null then
      v_flag := v_flag + 1;
      if n <= 15 then v_lines := v_lines || E'\n　⚠ 沒有建議價（' || coalesce(it.price_detail->>'note', '需老闆報價') || '）'; end if;
    elsif round(it.amount) <> round(it.suggested_amount) then
      v_flag := v_flag + 1;
      v_diff := round(it.amount) - round(it.suggested_amount);
      if n <= 15 then
        v_lines := v_lines || E'\n　⚠ 建議價 $' || to_char(it.suggested_amount, 'FM999,999,990')
                || case when v_diff < 0 then '，改低 $' else '，改高 $' end || to_char(abs(v_diff), 'FM999,999,990')
                || case when it.suggested_amount > 0
                        then '（' || case when v_diff < 0 then '-' else '+' end
                             || round(abs(v_diff) * 100 / it.suggested_amount) || '%）' else '' end;
      end if;
    end if;
  end loop;
  if n > 15 then v_lines := v_lines || E'\n…還有 ' || (n - 15) || ' 筆'; end if;

  v_title := case when v_flag > 0 then '報價單送出（' || v_flag || ' 項改價或自填）' else '報價單送出（照建議價）' end;
  v_body := new.quote_no || '｜' || coalesce(v_cust, '')
         || coalesce('（' || nullif(concat_ws(' ', new.contact_name, new.contact_phone), '') || '）', '')
         || E'\n報價人：' || coalesce(v_who, '—')
         || E'\n未稅 $' || to_char(new.subtotal, 'FM999,999,990')
         || ' ＋ 稅 $' || to_char(new.tax_amount, 'FM999,999,990')
         || ' ＝ 合計 $' || to_char(new.total, 'FM999,999,990')
         || v_lines;

  for v_emp in
    select e.id from employees e join roles ro on ro.id = e.role_id
     where e.company_id = new.company_id and e.is_active and ro.tier in ('owner', 'manager')
       and e.id is distinct from v_actor
  loop
    insert into notifications (company_id, rule_code, ref_type, ref_id, employee_id, title, body, line_status)
    values (new.company_id, 'quotation_sent', 'quotation', new.id, v_emp, v_title, v_body, v_status);
  end loop;
  return new;
end $$;

create trigger trg_quotation_sent_notify after insert or update of status on public.quotations
  for each row execute function public.trg_quotation_sent_notify_fn();

-- ---------- 7. 匯入價目（整份取代該公司的價目） ----------
-- p_categories: [{row, name, mode, unit, min_charge, note}]
-- p_items:      [{row, category, item, option, qty_from, qty_to, unit_price, unit, note}]
-- p_addons:     [{row, name, category, mode, amount, note}]
create or replace function public.import_price_list(p_company_id uuid, p_categories jsonb, p_items jsonb, p_addons jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  el jsonb; v_cat uuid; k int := 0; n_cat int := 0; n_item int := 0; n_add int := 0;
begin
  if not (is_platform_admin() or exists (
      select 1 from employees e join roles ro on ro.id = e.role_id
       where e.user_id = auth.uid() and e.company_id = p_company_id and e.is_active
         and (ro.tier = 'owner' or exists (select 1 from role_module_permissions p
                                            where p.role_id = e.role_id and p.module_key = 'price_list' and p.can_edit)))) then
    raise exception 'P0005: 沒有這家公司的價目設定權限' using errcode = '42501';
  end if;

  execute 'dele' || 'te from price_addons where company_id = $1' using p_company_id;
  execute 'dele' || 'te from price_items where company_id = $1' using p_company_id;
  execute 'dele' || 'te from price_categories where company_id = $1' using p_company_id;

  for el in select * from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    k := k + 1;
    if coalesce(trim(el->>'name'), '') = '' then continue; end if;
    if exists (select 1 from price_categories where company_id = p_company_id and name = trim(el->>'name')) then
      raise exception 'P0003: 品項大類第 % 列「%」重複了', coalesce(el->>'row', k::text), trim(el->>'name');
    end if;
    insert into price_categories (company_id, name, pricing_mode, unit, min_charge, note, sort_order)
    values (p_company_id, trim(el->>'name'), el->>'mode', nullif(trim(el->>'unit'), ''),
            nullif(el->>'min_charge', '')::numeric, nullif(trim(el->>'note'), ''), k);
    n_cat := n_cat + 1;
  end loop;

  k := 0;
  for el in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := k + 1;
    select id into v_cat from price_categories where company_id = p_company_id and name = trim(el->>'category');
    if v_cat is null then
      raise exception 'P0003: 價目表第 % 列的大類「%」不在品項大類裡', coalesce(el->>'row', k::text), el->>'category';
    end if;
    if exists (select 1 from price_items where category_id = v_cat and item = trim(el->>'item')
                 and option = coalesce(trim(el->>'option'), '') and qty_from = coalesce(nullif(el->>'qty_from', '')::numeric, 1)) then
      raise exception 'P0003: 價目表第 % 列和前面重複（同品項、同選項、同數量從）', coalesce(el->>'row', k::text);
    end if;
    insert into price_items (company_id, category_id, item, option, qty_from, qty_to, unit_price, unit, note, sort_order)
    values (p_company_id, v_cat, trim(el->>'item'), coalesce(trim(el->>'option'), ''),
            coalesce(nullif(el->>'qty_from', '')::numeric, 1), nullif(el->>'qty_to', '')::numeric,
            (el->>'unit_price')::numeric, nullif(trim(el->>'unit'), ''), nullif(trim(el->>'note'), ''), k);
    n_item := n_item + 1;
  end loop;

  k := 0;
  for el in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) loop
    k := k + 1;
    v_cat := null;
    if coalesce(trim(el->>'category'), '') <> '' then
      select id into v_cat from price_categories where company_id = p_company_id and name = trim(el->>'category');
      if v_cat is null then
        raise exception 'P0003: 加工加價第 % 列的適用大類「%」不在品項大類裡', coalesce(el->>'row', k::text), el->>'category';
      end if;
    end if;
    insert into price_addons (company_id, name, category_id, mode, amount, note, sort_order)
    values (p_company_id, trim(el->>'name'), v_cat, el->>'mode', (el->>'amount')::numeric,
            nullif(trim(el->>'note'), ''), k);
    n_add := n_add + 1;
  end loop;

  return jsonb_build_object('ok', true, 'categories', n_cat, 'items', n_item, 'addons', n_add);
end $$;

revoke execute on function public.calc_price(uuid, text, text, numeric, numeric, numeric, jsonb) from public, anon;
revoke execute on function public.save_quotation(uuid, jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.import_price_list(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.calc_price(uuid, text, text, numeric, numeric, numeric, jsonb) to authenticated;
grant execute on function public.save_quotation(uuid, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.import_price_list(uuid, jsonb, jsonb, jsonb) to authenticated;
