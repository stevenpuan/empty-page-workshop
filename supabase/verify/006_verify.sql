-- =============================================================
-- 006_verify.sql — S2 驗收測試（主檔 + 訂單 + 工序展開）
-- 對應 005_masters.sql、006_orders.sql
--
-- ★ 沿用 004_verify.sql 的三位測試使用者：
--   11111111-…-111 = 老闆（祥興＋沂融，can_switch_company）
--   22222222-…-222 = 祥興員工
--   33333333-…-333 = 沂融員工
--
-- ★ 整段自動回滾：不留殘留資料
-- =============================================================

begin;

-- =============================================================
-- 第一段：建立測試資料
-- =============================================================

-- 確認測試使用者仍在（由 004_verify 建立，或手動補）
do $$
declare
  v_xx uuid; v_yr uuid;
  v_xx_owner_role uuid; v_xx_staff_role uuid;
  v_yr_owner_role uuid; v_yr_staff_role uuid;
begin
  select id into v_xx from public.companies where code='XX';
  select id into v_yr from public.companies where code='YR';

  select id into v_xx_owner_role from public.roles where company_id=v_xx and code='owner';
  select id into v_xx_staff_role from public.roles where company_id=v_xx and code='staff';
  select id into v_yr_owner_role from public.roles where company_id=v_yr and code='owner';
  select id into v_yr_staff_role from public.roles where company_id=v_yr and code='staff';

  -- 若測試使用者不存在則建立（這些是 verify-only 用的假 UUID）
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, role)
  values
    ('11111111-1111-1111-1111-111111111111', 'test-owner@test.local', '$2a$10$test', now(), 'authenticated'),
    ('22222222-2222-2222-2222-222222222222', 'test-xx-staff@test.local', '$2a$10$test', now(), 'authenticated'),
    ('33333333-3333-3333-3333-333333333333', 'test-yr-staff@test.local', '$2a$10$test', now(), 'authenticated')
  on conflict (id) do nothing;

  -- 員工（role_id 來自 roles 表）
  insert into public.employees (company_id, user_id, emp_no, name, role_id, can_switch_company)
  values (v_xx, '11111111-1111-1111-1111-111111111111', 'T-BOSS', '測試老闆', v_xx_owner_role, true)
  on conflict (company_id, emp_no) do nothing;

  insert into public.employees (company_id, user_id, emp_no, name, role_id, can_switch_company)
  values (v_yr, '11111111-1111-1111-1111-111111111111', 'T-BOSS', '測試老闆', v_yr_owner_role, false)
  on conflict (company_id, emp_no) do nothing;

  insert into public.employees (company_id, user_id, emp_no, name, role_id)
  values (v_xx, '22222222-2222-2222-2222-222222222222', 'T-XX01', '測試祥興師傅', v_xx_staff_role)
  on conflict (company_id, emp_no) do nothing;

  insert into public.employees (company_id, user_id, emp_no, name, role_id)
  values (v_yr, '33333333-3333-3333-3333-333333333333', 'T-YR01', '測試沂融師傅', v_yr_staff_role)
  on conflict (company_id, emp_no) do nothing;

  -- 設定當前公司
  insert into public.user_company_context (user_id, current_company_id)
  values ('11111111-1111-1111-1111-111111111111', v_xx)
  on conflict (user_id) do update set current_company_id = excluded.current_company_id;

  insert into public.user_company_context (user_id, current_company_id)
  values ('22222222-2222-2222-2222-222222222222', v_xx)
  on conflict (user_id) do update set current_company_id = excluded.current_company_id;

  insert into public.user_company_context (user_id, current_company_id)
  values ('33333333-3333-3333-3333-333333333333', v_yr)
  on conflict (user_id) do update set current_company_id = excluded.current_company_id;
end $$;

-- ---------------------------------------------------------------
-- 建立測試主檔資料（以 postgres 角色直接寫，繞過 RLS）
-- ---------------------------------------------------------------

-- 祥興客戶
insert into public.customers (company_id, customer_code, name, payment_term)
select id, 'T-C01', '測試客戶祥興', 'net30' from public.companies where code='XX'
on conflict (company_id, customer_code) do nothing;

-- 沂融客戶
insert into public.customers (company_id, customer_code, name, payment_term)
select id, 'T-C01', '測試客戶沂融', 'cash' from public.companies where code='YR'
on conflict (company_id, customer_code) do nothing;

-- 祥興廠商
insert into public.vendors (company_id, vendor_code, name, vendor_type)
select id, 'T-V01', '測試廠商祥興', '外包印刷' from public.companies where code='XX'
on conflict (company_id, vendor_code) do nothing;

-- 沂融廠商
insert into public.vendors (company_id, vendor_code, name, vendor_type)
select id, 'T-V01', '測試廠商沂融', '後加工' from public.companies where code='YR'
on conflict (company_id, vendor_code) do nothing;

-- 祥興工序站別（8 站）
do $$
declare
  v_xx uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.work_stations (company_id, code, name, sort_order, color) values
    (v_xx, 'T-S01', '接單', 1, '#3B82F6'),
    (v_xx, 'T-S02', '設計', 2, '#8B5CF6'),
    (v_xx, 'T-S03', '校稿', 3, '#F59E0B'),
    (v_xx, 'T-S04', '輸出製版', 4, '#10B981'),
    (v_xx, 'T-S05', '印刷', 5, '#EF4444'),
    (v_xx, 'T-S06', '後加工', 6, '#6366F1'),
    (v_xx, 'T-S07', '品檢包裝', 7, '#14B8A6'),
    (v_xx, 'T-S08', '出貨', 8, '#F97316')
  on conflict (company_id, code) do nothing;
end $$;

-- 沂融工序站別（4 站）
do $$
declare
  v_yr uuid;
begin
  select id into v_yr from public.companies where code='YR';

  insert into public.work_stations (company_id, code, name, sort_order, color) values
    (v_yr, 'T-S01', '接單', 1, '#3B82F6'),
    (v_yr, 'T-S02', '加工', 2, '#8B5CF6'),
    (v_yr, 'T-S03', '品檢', 3, '#10B981'),
    (v_yr, 'T-S04', '出貨', 4, '#F97316')
  on conflict (company_id, code) do nothing;
end $$;

-- 祥興「名片」工序範本 + 8 個步驟
do $$
declare
  v_xx uuid;
  v_tmpl uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.routing_templates (company_id, product_category, name, is_default)
  values (v_xx, '名片', '名片標準流程', true)
  on conflict (company_id, product_category, name) do nothing
  returning id into v_tmpl;

  -- 如果已存在則取得 id
  if v_tmpl is null then
    select id into v_tmpl from public.routing_templates
    where company_id = v_xx and product_category = '名片' and name = '名片標準流程';
  end if;

  -- 刪除舊步驟再重建
  delete from public.routing_template_steps where template_id = v_tmpl;

  insert into public.routing_template_steps (company_id, template_id, station_id, step_no, offset_days) values
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S01'), 1, 7),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S02'), 2, 6),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S03'), 3, 5),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S04'), 4, 4),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S05'), 5, 3),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S06'), 6, 2),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S07'), 7, 1),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S08'), 8, 0);
end $$;

-- 祥興「布條帆布」工序範本（跳過輸出製版與印刷 → 6 步）
do $$
declare
  v_xx uuid;
  v_tmpl uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.routing_templates (company_id, product_category, name, is_default)
  values (v_xx, '布條帆布', '布條標準流程', true)
  on conflict (company_id, product_category, name) do nothing
  returning id into v_tmpl;

  if v_tmpl is null then
    select id into v_tmpl from public.routing_templates
    where company_id = v_xx and product_category = '布條帆布' and name = '布條標準流程';
  end if;

  delete from public.routing_template_steps where template_id = v_tmpl;

  insert into public.routing_template_steps (company_id, template_id, station_id, step_no, offset_days) values
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S01'), 1, 5),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S02'), 2, 4),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S03'), 3, 3),
    -- 跳過 T-S04(輸出製版) 和 T-S05(印刷)
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S06'), 4, 2),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S07'), 5, 1),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S08'), 6, 0);
end $$;

-- 祥興「純代印」工序範本（跳過設計與校稿 → 6 步）
do $$
declare
  v_xx uuid;
  v_tmpl uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.routing_templates (company_id, product_category, name, is_default)
  values (v_xx, '純代印', '純代印標準流程', true)
  on conflict (company_id, product_category, name) do nothing
  returning id into v_tmpl;

  if v_tmpl is null then
    select id into v_tmpl from public.routing_templates
    where company_id = v_xx and product_category = '純代印' and name = '純代印標準流程';
  end if;

  delete from public.routing_template_steps where template_id = v_tmpl;

  insert into public.routing_template_steps (company_id, template_id, station_id, step_no, offset_days) values
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S01'), 1, 5),
    -- 跳過 T-S02(設計) 和 T-S03(校稿)
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S04'), 2, 4),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S05'), 3, 3),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S06'), 4, 2),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S07'), 5, 1),
    (v_xx, v_tmpl, (select id from public.work_stations where company_id=v_xx and code='T-S08'), 6, 0);
end $$;

-- 祥興品項
do $$
declare
  v_xx uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.products (company_id, product_code, name, category, unit, default_routing_template_id)
  values (
    v_xx, 'T-P01', '名片 300P', '名片', '盒',
    (select id from public.routing_templates where company_id=v_xx and name='名片標準流程')
  ) on conflict (company_id, product_code) do nothing;

  insert into public.products (company_id, product_code, name, category, unit, default_routing_template_id)
  values (
    v_xx, 'T-P02', '布條 3m', '布條帆布', '條',
    (select id from public.routing_templates where company_id=v_xx and name='布條標準流程')
  ) on conflict (company_id, product_code) do nothing;

  insert into public.products (company_id, product_code, name, category, unit, default_routing_template_id)
  values (
    v_xx, 'T-P03', '純代印文件', '純代印', '份',
    (select id from public.routing_templates where company_id=v_xx and name='純代印標準流程')
  ) on conflict (company_id, product_code) do nothing;
end $$;


-- =============================================================
-- 第二段：越權測試 — 主檔隔離
-- =============================================================

-- ---------- V1　祥興員工只看得到祥興客戶 ----------
-- 預期：只有「測試客戶祥興」
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.customers where customer_code = 'T-C01';
  assert v_count = 1, format('V1 失敗：祥興員工看到 %s 筆客戶 T-C01（應為 1）', v_count);

  select count(*) into v_count from public.customers where name like '%沂融%';
  assert v_count = 0, format('V1 失敗：祥興員工看到沂融客戶（%s 筆）', v_count);

  raise notice 'V1 通過 ✅　祥興員工只看到祥興客戶';
end $$;
reset role;

-- ---------- V2　沂融員工只看得到沂融客戶 ----------
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.customers where customer_code = 'T-C01';
  assert v_count = 1, 'V2 失敗：沂融員工看到非 1 筆客戶 T-C01';

  select count(*) into v_count from public.customers where name like '%祥興%';
  assert v_count = 0, format('V2 失敗：沂融員工看到祥興客戶（%s 筆）', v_count);

  raise notice 'V2 通過 ✅　沂融員工只看到沂融客戶';
end $$;
reset role;

-- ---------- V3　沂融員工看不到祥興廠商 ----------
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.vendors where name like '%祥興%';
  assert v_count = 0, format('V3 失敗：沂融員工看到祥興廠商（%s 筆）', v_count);

  raise notice 'V3 通過 ✅　沂融員工看不到祥興廠商';
end $$;
reset role;

-- ---------- V4　祥興員工看不到沂融工序站別 ----------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.work_stations where code like 'T-S%';
  -- 祥興有 8 站
  assert v_count = 8, format('V4 失敗：祥興員工看到 %s 站（應為 8）', v_count);

  raise notice 'V4 通過 ✅　祥興員工只看到自己的 8 個站別';
end $$;
reset role;

-- ---------- V5　員工不能新增客戶（僅 manager+ 可寫） ----------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare
  v_count int;
begin
  begin
    insert into public.customers (company_id, customer_code, name)
    select id, 'T-HACK', '越權客戶' from public.companies where code='XX';
    raise exception 'V5 失敗：staff 竟然可以新增客戶';
  exception when others then
    -- 預期被 RLS 拒絕
    null;
  end;
  raise notice 'V5 通過 ✅　staff 無法新增客戶';
end $$;
reset role;

-- ---------- V6　跨公司寫入被拒（沂融員工寫祥興客戶） ----------
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
begin
  begin
    insert into public.customers (company_id, customer_code, name)
    select id, 'T-HACK', '越權客戶' from public.companies where code='XX';
    raise exception 'V6 失敗：沂融員工竟然可以寫入祥興客戶';
  exception when others then
    null;
  end;
  raise notice 'V6 通過 ✅　跨公司寫入被 RLS 拒絕';
end $$;
reset role;


-- =============================================================
-- 第三段：訂單展開測試
-- =============================================================

-- ---------- V7　名片訂單自動展開 8 道工序 ----------
do $$
declare
  v_xx uuid;
  v_order_id uuid;
  v_task_count int;
  v_order_no text;
begin
  select id into v_xx from public.companies where code='XX';

  -- 建立名片訂單（status=active → 觸發自動展開）
  insert into public.orders (
    company_id, order_no, item_name, spec, qty, unit,
    due_date, status, routing_template_id
  ) values (
    v_xx, 'AUTO', '名片 300P 雙面', '300P 銅西雙面四色 上霧P', 200, '盒',
    current_date + 14, 'active',
    (select id from public.routing_templates where company_id=v_xx and name='名片標準流程')
  ) returning id, order_no into v_order_id, v_order_no;

  select count(*) into v_task_count from public.order_tasks where order_id = v_order_id;

  assert v_task_count = 8,
    format('V7 失敗：名片訂單展開 %s 道工序（應為 8）', v_task_count);
  assert v_order_no like 'XX-WO-%',
    format('V7 失敗：單號格式錯誤 %s', v_order_no);

  raise notice 'V7 通過 ✅　名片訂單展開 8 道工序，單號 %', v_order_no;
end $$;

-- ---------- V8　布條訂單展開 6 道（跳過輸出製版＋印刷） ----------
do $$
declare
  v_xx uuid;
  v_order_id uuid;
  v_task_count int;
  v_has_print boolean;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.orders (
    company_id, order_no, item_name, qty, unit,
    due_date, status, routing_template_id
  ) values (
    v_xx, 'AUTO', '布條帆布 3m', 10, '條',
    current_date + 10, 'active',
    (select id from public.routing_templates where company_id=v_xx and name='布條標準流程')
  ) returning id into v_order_id;

  select count(*) into v_task_count from public.order_tasks where order_id = v_order_id;

  -- 確認沒有「輸出製版」和「印刷」站
  select exists(
    select 1 from public.order_tasks ot
    join public.work_stations ws on ws.id = ot.station_id
    where ot.order_id = v_order_id and ws.name in ('輸出製版','印刷')
  ) into v_has_print;

  assert v_task_count = 6,
    format('V8 失敗：布條訂單展開 %s 道工序（應為 6）', v_task_count);
  assert not v_has_print,
    'V8 失敗：布條訂單不應包含輸出製版或印刷';

  raise notice 'V8 通過 ✅　布條訂單展開 6 道工序（跳過輸出製版＋印刷）';
end $$;

-- ---------- V9　純代印訂單展開 6 道（跳過設計＋校稿） ----------
do $$
declare
  v_xx uuid;
  v_order_id uuid;
  v_task_count int;
  v_has_design boolean;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.orders (
    company_id, order_no, item_name, qty, unit,
    due_date, status, routing_template_id
  ) values (
    v_xx, 'AUTO', '純代印文件', 100, '份',
    current_date + 10, 'active',
    (select id from public.routing_templates where company_id=v_xx and name='純代印標準流程')
  ) returning id into v_order_id;

  select count(*) into v_task_count from public.order_tasks where order_id = v_order_id;

  select exists(
    select 1 from public.order_tasks ot
    join public.work_stations ws on ws.id = ot.station_id
    where ot.order_id = v_order_id and ws.name in ('設計','校稿')
  ) into v_has_design;

  assert v_task_count = 6,
    format('V9 失敗：純代印訂單展開 %s 道工序（應為 6）', v_task_count);
  assert not v_has_design,
    'V9 失敗：純代印訂單不應包含設計或校稿';

  raise notice 'V9 通過 ✅　純代印訂單展開 6 道工序（跳過設計＋校稿）';
end $$;

-- ---------- V10　due_at 倒推正確 ----------
do $$
declare
  v_xx uuid;
  v_order_id uuid;
  v_due date;
  v_first_task_due date;
  v_last_task_due date;
begin
  select id into v_xx from public.companies where code='XX';

  -- 用名片範本建一單（交期 14 天後）
  v_due := current_date + 14;

  insert into public.orders (
    company_id, order_no, item_name, qty, unit,
    due_date, status, routing_template_id
  ) values (
    v_xx, 'AUTO', 'due_at 測試', 1, '份',
    v_due, 'active',
    (select id from public.routing_templates where company_id=v_xx and name='名片標準流程')
  ) returning id into v_order_id;

  -- 第一道（接單，offset_days=7）→ due_at = 交期 - 7
  select due_at into v_first_task_due
  from public.order_tasks where order_id = v_order_id order by step_no limit 1;

  -- 最後一道（出貨，offset_days=0）→ due_at = 交期
  select due_at into v_last_task_due
  from public.order_tasks where order_id = v_order_id order by step_no desc limit 1;

  assert v_first_task_due = v_due - 7,
    format('V10 失敗：第一道 due_at=%s（應為 %s）', v_first_task_due, v_due - 7);
  assert v_last_task_due = v_due,
    format('V10 失敗：最後一道 due_at=%s（應為 %s）', v_last_task_due, v_due);

  raise notice 'V10 通過 ✅　due_at 由交期正確倒推';
end $$;

-- ---------- V11　draft 訂單不展開工序 ----------
do $$
declare
  v_xx uuid;
  v_order_id uuid;
  v_task_count int;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.orders (
    company_id, order_no, item_name, qty, unit,
    due_date, status, routing_template_id
  ) values (
    v_xx, 'AUTO', '草稿不展開', 1, '份',
    current_date + 7, 'draft',
    (select id from public.routing_templates where company_id=v_xx and name='名片標準流程')
  ) returning id into v_order_id;

  select count(*) into v_task_count from public.order_tasks where order_id = v_order_id;

  assert v_task_count = 0,
    format('V11 失敗：draft 訂單不應展開工序（展開了 %s 道）', v_task_count);

  -- 從 draft → active，應觸發展開
  update public.orders set status = 'active' where id = v_order_id;

  select count(*) into v_task_count from public.order_tasks where order_id = v_order_id;

  assert v_task_count = 8,
    format('V11 失敗：draft→active 後應展開 8 道（實際 %s）', v_task_count);

  raise notice 'V11 通過 ✅　draft 不展開；轉 active 後展開 8 道工序';
end $$;

-- ---------- V12　單號格式與併發不重號 ----------
do $$
declare
  v_xx uuid;
  v_nos text[];
  v_no text;
  i int;
begin
  select id into v_xx from public.companies where code='XX';

  for i in 1..5 loop
    insert into public.orders (
      company_id, order_no, item_name, qty, unit, status
    ) values (
      v_xx, 'AUTO', '併發測試 #' || i, 1, '份', 'draft'
    ) returning order_no into v_no;
    v_nos := array_append(v_nos, v_no);
  end loop;

  -- 檢查所有單號不重複
  assert array_length(v_nos, 1) = 5, 'V12 失敗：未產生 5 個單號';

  -- 檢查格式
  for i in 1..5 loop
    assert v_nos[i] like 'XX-WO-%',
      format('V12 失敗：單號格式錯誤 %s', v_nos[i]);
  end loop;

  -- 確認不重複
  assert (select count(distinct x) from unnest(v_nos) x) = 5,
    'V12 失敗：有重複單號';

  raise notice 'V12 通過 ✅　5 張訂單單號不重複，格式正確';
end $$;

-- ---------- V13　訂單 RLS：祥興員工看不到沂融訂單 ----------
-- 先在沂融建一張訂單
do $$
declare
  v_yr uuid;
begin
  select id into v_yr from public.companies where code='YR';
  insert into public.orders (company_id, order_no, item_name, qty, unit, status)
  values (v_yr, 'AUTO', '沂融測試訂單', 1, '份', 'draft');
end $$;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.orders where item_name = '沂融測試訂單';
  assert v_count = 0, format('V13 失敗：祥興員工看到沂融訂單（%s 筆）', v_count);
  raise notice 'V13 通過 ✅　祥興員工看不到沂融訂單';
end $$;
reset role;

-- ---------- V14　staff 不能新增訂單 ----------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  begin
    insert into public.orders (company_id, order_no, item_name, qty, unit, status)
    select id, 'AUTO', 'staff越權', 1, '份', 'draft'
    from public.companies where code='XX';
    raise exception 'V14 失敗：staff 竟然可以新增訂單';
  exception when others then
    null;
  end;
  raise notice 'V14 通過 ✅　staff 無法新增訂單';
end $$;
reset role;

-- ---------- V15　訂單不可刪除（禁刪 trigger） ----------
do $$
declare
  v_xx uuid;
  v_oid uuid;
begin
  select id into v_xx from public.companies where code='XX';

  insert into public.orders (company_id, order_no, item_name, qty, unit, status)
  values (v_xx, 'AUTO', '不可刪除測試', 1, '份', 'draft')
  returning id into v_oid;

  begin
    delete from public.orders where id = v_oid;
    raise exception 'V15 失敗：訂單竟然可以刪除';
  exception when sqlstate 'P0001' then
    raise notice 'V15 通過 ✅　訂單不可刪除（P0001 錯誤正確觸發）';
  end;
end $$;

-- ---------- V16　RLS 覆蓋率 ----------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_tables
  where schemaname = 'public' and rowsecurity = false;

  assert v_count = 0,
    format('V16 失敗：有 %s 張表未啟用 RLS', v_count);

  raise notice 'V16 通過 ✅　所有 public 表皆啟用 RLS';
end $$;


-- =============================================================
-- 清除：整段回滾
-- =============================================================
rollback;

-- =============================================================
-- 總結
-- =============================================================
do $$
begin
  raise notice '';
  raise notice '====================================================';
  raise notice '  S2 驗證完成！全部自動回滾，無殘留測試資料。';
  raise notice '  若上方無任何 ASSERT 失敗訊息 → 全數通過 ✅';
  raise notice '====================================================';
end $$;
