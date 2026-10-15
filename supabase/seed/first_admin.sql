-- ============================================================
-- 建立第一個管理員帳號（syichg@gmail.com）
--
-- 使用方式（兩步驟）：
--   步驟 1：先在 App 的註冊頁面用 syichg@gmail.com 註冊一個帳號
--           （或到 Supabase Dashboard → Authentication → Users → Add user 建立）
--   步驟 2：再到 SQL Editor 執行本檔案
--
-- 本腳本會：
--   1. 找到 syichg@gmail.com 的 auth 帳號（找不到會報錯提示先註冊）
--   2. 確認 profile 存在（handle_new_user trigger 通常已建，沒有就補）
--   3. 建立 owner 角色（若公司還沒有）
--   4. 建立員工資料並綁定 user_id，角色設為 owner
-- 可重複執行（已存在的資料會跳過）。
-- ============================================================

DO $$
DECLARE
  v_user_id    uuid;
  v_company_id uuid;
  v_role_id    uuid;
BEGIN
  -- 1. 找 auth 帳號
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'syichg@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '找不到 syichg@gmail.com 的帳號，請先在 App 註冊頁面註冊，或到 Authentication → Users 建立後再執行本腳本。';
  END IF;

  -- 2. 補 profile（trigger 通常已建）
  INSERT INTO public.profiles (id, display_name)
  VALUES (v_user_id, 'Steven')
  ON CONFLICT (id) DO NOTHING;

  -- 3. 找公司（優先「祥興」，否則取第一間）
  SELECT id INTO v_company_id
  FROM public.companies
  ORDER BY (name LIKE '%祥興%') DESC, created_at
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION '找不到任何公司，請先建立公司資料。';
  END IF;

  -- 4. 找或建 owner 角色
  SELECT id INTO v_role_id
  FROM public.roles
  WHERE company_id = v_company_id AND tier = 'owner'
  ORDER BY sort_order
  LIMIT 1;

  IF v_role_id IS NULL THEN
    INSERT INTO public.roles (company_id, code, name, tier, is_system, sort_order)
    VALUES (v_company_id, 'OWNER', '負責人', 'owner', true, 0)
    RETURNING id INTO v_role_id;
  END IF;

  -- 5. 建員工並綁定帳號（同 user_id 已存在則更新角色）
  INSERT INTO public.employees (company_id, user_id, emp_no, name, role_id, is_active)
  VALUES (v_company_id, v_user_id, 'E001', 'Steven', v_role_id, true)
  ON CONFLICT (company_id, emp_no) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        role_id = EXCLUDED.role_id,
        is_active = true;

  -- 6. 設定目前公司 context
  INSERT INTO public.user_company_context (user_id, current_company_id)
  VALUES (v_user_id, v_company_id)
  ON CONFLICT (user_id) DO UPDATE
    SET current_company_id = EXCLUDED.current_company_id,
        switched_at = now();

  RAISE NOTICE '完成：syichg@gmail.com 已設為公司 % 的 owner', v_company_id;
END $$;

-- 驗證結果
SELECT e.emp_no, e.name, r.name AS role, r.tier, c.name AS company
FROM public.employees e
JOIN public.roles r ON r.id = e.role_id
JOIN public.companies c ON c.id = e.company_id
WHERE e.user_id = (SELECT id FROM auth.users WHERE email = 'syichg@gmail.com');
