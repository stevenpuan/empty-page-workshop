-- ============================================================
-- Demo 測試資料 v2（祥興數位影印廣告印刷）
-- 內容：站別 3、客戶 5、廠商 4、訂單 6、工序 18（各種進度）
-- 可重複執行（ON CONFLICT / NOT EXISTS 保護），不會產生重複資料
-- 執行方式：Supabase Dashboard → SQL Editor → New query → 貼上 → Run
-- ============================================================

DO $$
DECLARE
  v_company uuid := '95755162-5905-469c-8158-8cbcc1bdb2e9'; -- 祥興
  v_steven  uuid := 'ca90cbd2-4873-4013-bbee-91b4441c9b71'; -- Steven (E001)
  v_pre     uuid := '11111111-0000-4000-8000-000000000001';
  v_prt     uuid := '11111111-0000-4000-8000-000000000002';
  v_post    uuid := '11111111-0000-4000-8000-000000000003';
BEGIN

  -- ---------- 1. 站別 ----------
  INSERT INTO public.work_stations (id, company_id, code, name, sort_order, is_outsource_capable, is_active) VALUES
    (v_pre,  v_company, 'PRE',  '印前作業', 10, false, true),
    (v_prt,  v_company, 'PRT',  '印刷',     20, false, true),
    (v_post, v_company, 'POST', '後加工',   30, true,  true)
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 2. 客戶 ----------
  INSERT INTO public.customers (id, company_id, customer_code, name, contact, phone, payment_term, is_active) VALUES
    ('22222222-0000-4000-8000-000000000001', v_company, 'C001', '大安國際旅行社', '陳小姐', '02-2700-1234', 'net30', true),
    ('22222222-0000-4000-8000-000000000002', v_company, 'C002', '晨光早餐連鎖',   '林先生', '02-2345-6789', 'cash',  true),
    ('22222222-0000-4000-8000-000000000003', v_company, 'C003', '禾豐建設股份有限公司', '王經理', '02-8765-4321', 'net60', true),
    ('22222222-0000-4000-8000-000000000004', v_company, 'C004', '小熊親子館',     '許小姐', '0912-345-678', 'cash',  true),
    ('22222222-0000-4000-8000-000000000005', v_company, 'C005', '沂融企業社',     '內部往來', '02-9999-0000', 'net30', true)
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 3. 廠商 ----------
  INSERT INTO public.vendors (id, company_id, vendor_code, name, vendor_type, contact, phone, payment_term, is_outsource, is_active) VALUES
    ('33333333-0000-4000-8000-000000000001', v_company, 'V001', '永豐紙業',       '材料', '周先生', '02-1111-2222', 'net30', false, true),
    ('33333333-0000-4000-8000-000000000002', v_company, 'V002', '東洋油墨行',     '材料', '吳小姐', '02-3333-4444', 'cash',  false, true),
    ('33333333-0000-4000-8000-000000000003', v_company, 'V003', '精工燙金加工廠', '外包', '鄭師傅', '0933-111-222', 'net30', true,  true),
    ('33333333-0000-4000-8000-000000000004', v_company, 'V004', '大圖輸出中心',   '外包', '高先生', '02-5555-6666', 'cash',  true,  true)
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 4. 訂單 ----------
  -- O1 名片：印前完成、印刷進行中
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  VALUES ('44444444-0000-4000-8000-000000000001', v_company, 'SO-DEMO-001',
    '22222222-0000-4000-8000-000000000001', '名片印刷', '300P銅西卡 雙面彩色 90x54mm', 2000, '張',
    3000, 150, 3150, CURRENT_DATE + 5, 'active', '急件，客戶週五要')
  ON CONFLICT (id) DO NOTHING;

  -- O2 DM：全部完成
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status)
  VALUES ('44444444-0000-4000-8000-000000000002', v_company, 'SO-DEMO-002',
    '22222222-0000-4000-8000-000000000002', '開幕DM', 'A4 128P銅版 雙面 折二摺', 5000, '張',
    12000, 600, 12600, CURRENT_DATE - 2, 'done')
  ON CONFLICT (id) DO NOTHING;

  -- O3 海報：剛建立，尚未開始
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status)
  VALUES ('44444444-0000-4000-8000-000000000003', v_company, 'SO-DEMO-003',
    '22222222-0000-4000-8000-000000000003', '建案海報', 'A2 150P銅版 單面 上亮膜', 300, '張',
    18000, 900, 18900, CURRENT_DATE + 14, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- O4 貼紙：後加工卡關（示範異常），且已逾期
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  VALUES ('44444444-0000-4000-8000-000000000004', v_company, 'SO-DEMO-004',
    '22222222-0000-4000-8000-000000000004', '品牌LOGO貼紙', '防水貼紙 刀模裁切 5x5cm', 10000, '張',
    8000, 400, 8400, CURRENT_DATE - 3, 'active', '刀模延遲')
  ON CONFLICT (id) DO NOTHING;

  -- O5 邀請卡：後加工外包中
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  VALUES ('44444444-0000-4000-8000-000000000005', v_company, 'SO-DEMO-005',
    '22222222-0000-4000-8000-000000000001', '尾牙邀請卡', '250P象牙卡 燙金', 800, '張',
    24000, 1200, 25200, CURRENT_DATE + 10, 'active', '燙金委外')
  ON CONFLICT (id) DO NOTHING;

  -- O6 菜單：草稿
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status)
  VALUES ('44444444-0000-4000-8000-000000000006', v_company, 'SO-DEMO-006',
    '22222222-0000-4000-8000-000000000002', '新菜單', 'A4 200P銅版 護貝', 150, '張',
    6000, 300, 6300, CURRENT_DATE + 20, 'draft')
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 5. 工序（每張訂單 3 站，進度各異） ----------
  -- O1：印前 done、印刷 in_progress、後加工 pending
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, assignee_id, status, started_at, done_at, due_at) VALUES
    ('55555555-0000-4000-8000-000000000101', v_company, '44444444-0000-4000-8000-000000000001', v_pre,  1, v_steven, 'done',        now() - interval '2 days', now() - interval '1 day', CURRENT_DATE + 1),
    ('55555555-0000-4000-8000-000000000102', v_company, '44444444-0000-4000-8000-000000000001', v_prt,  2, v_steven, 'in_progress', now() - interval '4 hours', NULL, CURRENT_DATE + 3),
    ('55555555-0000-4000-8000-000000000103', v_company, '44444444-0000-4000-8000-000000000001', v_post, 3, NULL,     'pending',     NULL, NULL, CURRENT_DATE + 5)
  ON CONFLICT (id) DO NOTHING;

  -- O2：全部 done
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, assignee_id, status, started_at, done_at, due_at) VALUES
    ('55555555-0000-4000-8000-000000000201', v_company, '44444444-0000-4000-8000-000000000002', v_pre,  1, v_steven, 'done', now() - interval '5 days', now() - interval '4 days', CURRENT_DATE - 4),
    ('55555555-0000-4000-8000-000000000202', v_company, '44444444-0000-4000-8000-000000000002', v_prt,  2, v_steven, 'done', now() - interval '4 days', now() - interval '3 days', CURRENT_DATE - 3),
    ('55555555-0000-4000-8000-000000000203', v_company, '44444444-0000-4000-8000-000000000002', v_post, 3, v_steven, 'done', now() - interval '3 days', now() - interval '2 days', CURRENT_DATE - 2)
  ON CONFLICT (id) DO NOTHING;

  -- O3：全部 pending
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, assignee_id, status, due_at) VALUES
    ('55555555-0000-4000-8000-000000000301', v_company, '44444444-0000-4000-8000-000000000003', v_pre,  1, v_steven, 'pending', CURRENT_DATE + 4),
    ('55555555-0000-4000-8000-000000000302', v_company, '44444444-0000-4000-8000-000000000003', v_prt,  2, NULL,     'pending', CURRENT_DATE + 9),
    ('55555555-0000-4000-8000-000000000303', v_company, '44444444-0000-4000-8000-000000000003', v_post, 3, NULL,     'pending', CURRENT_DATE + 13)
  ON CONFLICT (id) DO NOTHING;

  -- O4：印前 done、印刷 done、後加工 blocked
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, assignee_id, status, started_at, done_at, due_at, blocked_reason) VALUES
    ('55555555-0000-4000-8000-000000000401', v_company, '44444444-0000-4000-8000-000000000004', v_pre,  1, v_steven, 'done',    now() - interval '6 days', now() - interval '5 days', CURRENT_DATE - 5, NULL),
    ('55555555-0000-4000-8000-000000000402', v_company, '44444444-0000-4000-8000-000000000004', v_prt,  2, v_steven, 'done',    now() - interval '5 days', now() - interval '4 days', CURRENT_DATE - 4, NULL),
    ('55555555-0000-4000-8000-000000000403', v_company, '44444444-0000-4000-8000-000000000004', v_post, 3, v_steven, 'blocked', now() - interval '4 days', NULL, CURRENT_DATE - 3, '刀模廠延遲交貨，預計週四到')
  ON CONFLICT (id) DO NOTHING;

  -- O5：印前 done、印刷 done、後加工 outsourced（委外燙金）
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, assignee_id, status, started_at, done_at, due_at, is_outsource, vendor_id, outsourced_at, outsource_due_at) VALUES
    ('55555555-0000-4000-8000-000000000501', v_company, '44444444-0000-4000-8000-000000000005', v_pre,  1, v_steven, 'done',       now() - interval '3 days', now() - interval '2 days', CURRENT_DATE - 1, false, NULL, NULL, NULL),
    ('55555555-0000-4000-8000-000000000502', v_company, '44444444-0000-4000-8000-000000000005', v_prt,  2, v_steven, 'done',       now() - interval '2 days', now() - interval '1 day', CURRENT_DATE + 2, false, NULL, NULL, NULL),
    ('55555555-0000-4000-8000-000000000503', v_company, '44444444-0000-4000-8000-000000000005', v_post, 3, NULL,     'outsourced', NULL, NULL, CURRENT_DATE + 8, true, '33333333-0000-4000-8000-000000000003', now() - interval '1 day', CURRENT_DATE + 8)
  ON CONFLICT (id) DO NOTHING;

  -- O6 草稿：不建工序

END $$;

-- ---------- 驗證結果 ----------
SELECT 'customers' AS tbl, count(*) FROM public.customers WHERE company_id='95755162-5905-469c-8158-8cbcc1bdb2e9'
UNION ALL SELECT 'vendors',  count(*) FROM public.vendors  WHERE company_id='95755162-5905-469c-8158-8cbcc1bdb2e9'
UNION ALL SELECT 'orders',   count(*) FROM public.orders   WHERE company_id='95755162-5905-469c-8158-8cbcc1bdb2e9'
UNION ALL SELECT 'stations', count(*) FROM public.work_stations WHERE company_id='95755162-5905-469c-8158-8cbcc1bdb2e9'
UNION ALL SELECT 'tasks',    count(*) FROM public.order_tasks WHERE company_id='95755162-5905-469c-8158-8cbcc1bdb2e9';
