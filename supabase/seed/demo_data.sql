-- =============================================================
-- Demo 測試資料：客戶、廠商、訂單
-- 用法：Supabase Dashboard → SQL Editor → 整份貼上執行
-- 預設寫入「祥興印刷」；若要寫入別家公司，修改下方 v_company 的名稱
-- 重複執行安全：用 on conflict do nothing，不會產生重複資料
-- =============================================================

do $$
declare
  v_company uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
begin
  -- 指定公司（依名稱查找，找不到就取第一家公司）
  select id into v_company from public.companies where name like '%祥興%' limit 1;
  if v_company is null then
    select id into v_company from public.companies order by created_at limit 1;
  end if;
  if v_company is null then
    raise exception '找不到任何公司，請先建立公司';
  end if;

  -- ============ 客戶 5 筆 ============
  insert into public.customers (company_id, customer_code, name, tax_id, contact, phone, address, payment_term, is_internal_partner, note)
  values
    (v_company, 'C001', '大大餐飲集團',       '24567890', '陳經理',  '02-2345-6789',  '台北市信義區松仁路100號',   'net30',      false, null),
    (v_company, 'C002', '晴光美髮沙龍',       null,       '林小姐',  '0912-345-678', '台中市西區公益路50號',     'cash',       false, null),
    (v_company, 'C003', '宏遠建設股份有限公司', '86812345', '黃課長',  '04-2233-4455',  '台中市南屯區向上路三段200號', 'net60',      false, null),
    (v_company, 'C004', '幸福婚禮顧問',       null,       '王小姐',  '0933-222-111', null,                       'monthly_end',false, null),
    (v_company, 'C005', '沂融企業社',         null,       '內部窗口', null,           null,                       'monthly_15', true,  '集團內部夥伴')
  on conflict (company_id, customer_code) do nothing;

  -- ============ 廠商 4 筆 ============
  insert into public.vendors (company_id, vendor_code, name, tax_id, vendor_type, contact, phone, payment_term, is_outsource)
  values
    (v_company, 'V001', '永豐紙業',     '12345678', '紙材',     '周先生',  '02-2788-9900', 'net30',       false),
    (v_company, 'V002', '大東油墨',     null,       '油墨版材', '吳小姐',  '04-2355-6677', 'net60',       false),
    (v_company, 'V003', '精工後加工廠', null,       '後加工',   '鄭師傅',  '0911-888-999', 'monthly_end', true),
    (v_company, 'V004', '聯合印刷外包', null,       '外包印刷', '許先生',  '02-2987-6543', 'net30',       true)
  on conflict (company_id, vendor_code) do nothing;

  -- 取客戶 id
  select id into c1 from public.customers where company_id = v_company and customer_code = 'C001';
  select id into c2 from public.customers where company_id = v_company and customer_code = 'C002';
  select id into c3 from public.customers where company_id = v_company and customer_code = 'C003';
  select id into c4 from public.customers where company_id = v_company and customer_code = 'C004';

  -- ============ 訂單 6 筆（order_no 給 'AUTO' 由 trigger 自動產單號） ============
  -- 若已有工序範本，可把 routing_template_id 補上，active 訂單會自動展開工序
  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c1, '名片-標準款',     '300P 銅西雙面四色 上霧P', 1000, '張', 1200,  60,  1260,  current_date + 5,  'active', null
  where not exists (select 1 from public.orders where company_id = v_company and item_name = '名片-標準款');

  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c2, '布條-開幕誌慶',   '帆布 300x60cm 全彩',      2,    '條', 3000,  150, 3150,  current_date + 3,  'active', null
  where not exists (select 1 from public.orders where company_id = v_company and item_name = '布條-開幕誌慶');

  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c3, 'DM 明信片-建案宣傳', 'A5 雙面四色',          2000, '張', 4500,  225, 4725,  current_date + 10, 'active', null
  where not exists (select 1 from public.orders where company_id = v_company and item_name = 'DM 明信片-建案宣傳');

  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c4, '喜帖-燙金款',     '象牙卡 燙金 單面',        300,  '張', 9000,  450, 9450,  current_date + 21, 'draft',  null
  where not exists (select 1 from public.orders where company_id = v_company and item_name = '喜帖-燙金款');

  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c1, '貼紙-品牌LOGO',   '防水貼紙 5x5cm 刀模',     5000, '張', 2500,  125, 2625,  current_date - 3,  'active', '已過交期，測試逾期顯示'
  where not exists (select 1 from public.orders where company_id = v_company and item_name = '貼紙-品牌LOGO');

  insert into public.orders (company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  select v_company, 'AUTO', c3, '紙盒-樣品屋提盒', '350P 灰銅 裱E浪',         500,  '個', 15000, 750, 15750, current_date + 15, 'draft',  null
  where not exists (select 1 from public.orders where company_id = v_company and item_name = '紙盒-樣品屋提盒');

  raise notice 'Demo 資料寫入完成（公司：%）', v_company;
end $$;

-- 確認結果
select 'customers' as tbl, count(*) from public.customers
union all select 'vendors', count(*) from public.vendors
union all select 'orders', count(*) from public.orders
union all select 'order_tasks', count(*) from public.order_tasks;
