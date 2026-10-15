-- ============================================================
-- Demo 測試資料（沂融企業社 YR）
-- 內容：客戶 3、訂單 3、工序 9（各種進度）
-- 可重複執行（ON CONFLICT 保護），不會產生重複資料
-- 執行方式：Supabase Dashboard → SQL Editor → New query → 貼上 → Run
-- ============================================================

DO $$
DECLARE
  v_company uuid := '85da97b0-5c59-4c35-bc77-5fe8020bbaf3'; -- 沂融
  v_pre     uuid := '8e498680-527b-46d0-84a2-1600e24bdc5d'; -- 印前作業
  v_prt     uuid := 'dc9487f8-af1e-46a3-bb1b-cad505344221'; -- 印刷
  v_post    uuid := '5d396d62-8cc9-41c8-b016-6aaee5374a71'; -- 後加工
BEGIN

  -- ---------- 1. 客戶 ----------
  INSERT INTO public.customers (id, company_id, customer_code, name, contact, phone, payment_term, is_active) VALUES
    ('77777777-0000-4000-8000-000000000001', v_company, 'Y001', '陽光幼兒園',     '周園長', '02-2222-3333', 'net30', true),
    ('77777777-0000-4000-8000-000000000002', v_company, 'Y002', '鼎盛健身房',     '吳店長', '02-4444-5555', 'cash',  true),
    ('77777777-0000-4000-8000-000000000003', v_company, 'Y003', '祥興數位影印廣告印刷', '內部往來', '02-8888-0000', 'net30', true)
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 2. 訂單 ----------
  -- Y1 招生DM：印前完成、印刷進行中
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  VALUES ('88888888-0000-4000-8000-000000000001', v_company, 'SO-YR-001',
    '77777777-0000-4000-8000-000000000001', '招生DM', 'A4 128P銅版 雙面彩色 折二摺', 3000, '張',
    9000, 450, 9450, CURRENT_DATE + 4, 'active', '開學檔期，急件')
  ON CONFLICT (id) DO NOTHING;

  -- Y2 健身房海報：剛建立，尚未開始
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status)
  VALUES ('88888888-0000-4000-8000-000000000002', v_company, 'SO-YR-002',
    '77777777-0000-4000-8000-000000000002', '課程海報', 'A1 200P銅版 單面 上霧膜', 100, '張',
    15000, 750, 15750, CURRENT_DATE + 12, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Y3 祥興委託單（跨公司派工示範）：全部完成
  INSERT INTO public.orders (id, company_id, order_no, customer_id, item_name, spec, qty, unit, amount_untaxed, tax_amount, amount_total, due_date, status, note)
  VALUES ('88888888-0000-4000-8000-000000000003', v_company, 'SO-YR-003',
    '77777777-0000-4000-8000-000000000003', '邀請卡代印', '250P象牙卡 四色印刷', 800, '張',
    6000, 300, 6300, CURRENT_DATE - 1, 'shipped', '祥興委託代印')
  ON CONFLICT (id) DO NOTHING;

  -- ---------- 3. 工序（每張訂單 3 站，進度各異） ----------
  -- Y1：印前 done、印刷 in_progress、後加工 pending
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, status, started_at, done_at, due_at) VALUES
    ('99999999-0000-4000-8000-000000000101', v_company, '88888888-0000-4000-8000-000000000001', v_pre,  1, 'done',        now() - interval '1 day',  now() - interval '6 hours', CURRENT_DATE + 1),
    ('99999999-0000-4000-8000-000000000102', v_company, '88888888-0000-4000-8000-000000000001', v_prt,  2, 'in_progress', now() - interval '2 hours', NULL, CURRENT_DATE + 2),
    ('99999999-0000-4000-8000-000000000103', v_company, '88888888-0000-4000-8000-000000000001', v_post, 3, 'pending',     NULL, NULL, CURRENT_DATE + 4)
  ON CONFLICT (id) DO NOTHING;

  -- Y2：全部 pending
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, status, due_at) VALUES
    ('99999999-0000-4000-8000-000000000201', v_company, '88888888-0000-4000-8000-000000000002', v_pre,  1, 'pending', CURRENT_DATE + 3),
    ('99999999-0000-4000-8000-000000000202', v_company, '88888888-0000-4000-8000-000000000002', v_prt,  2, 'pending', CURRENT_DATE + 7),
    ('99999999-0000-4000-8000-000000000203', v_company, '88888888-0000-4000-8000-000000000002', v_post, 3, 'pending', CURRENT_DATE + 11)
  ON CONFLICT (id) DO NOTHING;

  -- Y3：全部 done
  INSERT INTO public.order_tasks (id, company_id, order_id, station_id, step_no, status, started_at, done_at, due_at) VALUES
    ('99999999-0000-4000-8000-000000000301', v_company, '88888888-0000-4000-8000-000000000003', v_pre,  1, 'done', now() - interval '4 days', now() - interval '3 days', CURRENT_DATE - 3),
    ('99999999-0000-4000-8000-000000000302', v_company, '88888888-0000-4000-8000-000000000003', v_prt,  2, 'done', now() - interval '3 days', now() - interval '2 days', CURRENT_DATE - 2),
    ('99999999-0000-4000-8000-000000000303', v_company, '88888888-0000-4000-8000-000000000003', v_post, 3, 'done', now() - interval '2 days', now() - interval '1 day',  CURRENT_DATE - 1)
  ON CONFLICT (id) DO NOTHING;

END $$;

-- ---------- 驗證結果 ----------
SELECT 'customers' AS tbl, count(*) FROM public.customers WHERE company_id='85da97b0-5c59-4c35-bc77-5fe8020bbaf3'
UNION ALL SELECT 'orders', count(*) FROM public.orders WHERE company_id='85da97b0-5c59-4c35-bc77-5fe8020bbaf3'
UNION ALL SELECT 'tasks',  count(*) FROM public.order_tasks WHERE company_id='85da97b0-5c59-4c35-bc77-5fe8020bbaf3';
