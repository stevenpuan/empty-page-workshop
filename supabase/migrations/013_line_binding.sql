-- ============================================================
-- 013_line_binding.sql — LINE 帳號綁定碼機制
-- Sprint: S8-LINE
-- 功能：
--   1. employees 新增 line_bind_code / line_bind_at 欄位
--   2. generate_line_bind_code() — 產生 6 碼綁定碼（大寫英數）
--   3. refresh_line_bind_code(p_employee_id) — 重新產碼（老闆/主管用）
--   4. bind_line_account(p_code, p_line_user_id) — Webhook 呼叫，綁定
--   5. unbind_line_account(p_employee_id) — 解綁
-- ============================================================

-- ── 1. 新增欄位 ─────────────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS line_bind_code  text,
  ADD COLUMN IF NOT EXISTS line_bind_at    timestamptz;

-- 唯一索引（只索引非 null）
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_line_bind_code
  ON employees (line_bind_code)
  WHERE line_bind_code IS NOT NULL;

-- ── 2. 產碼函式（6 碼大寫英數，排除混淆字元 0OI1L）──────────
CREATE OR REPLACE FUNCTION generate_line_bind_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    END LOOP;
    -- 確認不重複
    SELECT EXISTS(SELECT 1 FROM employees WHERE line_bind_code = v_code) INTO v_exists;
    IF NOT v_exists THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;

-- ── 3. 為所有現有員工產碼 ──────────────────────────────────
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT id FROM employees WHERE line_bind_code IS NULL
  LOOP
    UPDATE employees SET line_bind_code = generate_line_bind_code() WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ── 4. 新員工自動產碼 trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION trg_auto_line_bind_code()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.line_bind_code IS NULL THEN
    NEW.line_bind_code := generate_line_bind_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_line_bind_code ON employees;
CREATE TRIGGER auto_line_bind_code
  BEFORE INSERT ON employees
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_line_bind_code();

-- ── 5. refresh_line_bind_code — 重新產碼（老闆/主管用）─────
CREATE OR REPLACE FUNCTION refresh_line_bind_code(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  v_code := generate_line_bind_code();
  UPDATE employees
     SET line_bind_code = v_code,
         line_user_id   = NULL,
         line_bind_at   = NULL
   WHERE id = p_employee_id;
  RETURN v_code;
END;
$$;

-- ── 6. bind_line_account — Webhook 呼叫，綁定 ─────────────
CREATE OR REPLACE FUNCTION bind_line_account(
  p_code         text,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  record;
BEGIN
  -- 查找綁定碼對應的員工
  SELECT id, name, company_id, line_user_id
    INTO v_emp
    FROM employees
   WHERE line_bind_code = upper(trim(p_code));

  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_NOT_FOUND',
      'message', '綁定碼不存在，請確認後重新輸入。');
  END IF;

  -- 檢查是否已綁定其他 LINE
  IF v_emp.line_user_id IS NOT NULL AND v_emp.line_user_id <> p_line_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_BOUND',
      'message', '此帳號已綁定其他 LINE，請聯繫主管重新產碼。');
  END IF;

  -- 檢查此 LINE 是否已綁定其他員工
  IF EXISTS(SELECT 1 FROM employees WHERE line_user_id = p_line_user_id AND id <> v_emp.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LINE_ALREADY_USED',
      'message', '此 LINE 帳號已綁定其他員工，請聯繫主管處理。');
  END IF;

  -- 綁定
  UPDATE employees
     SET line_user_id = p_line_user_id,
         line_bind_at = now()
   WHERE id = v_emp.id;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'employee_name', v_emp.name,
    'company_id', v_emp.company_id,
    'message', '綁定成功！' || v_emp.name || '，你將開始收到系統通知。'
  );
END;
$$;

-- ── 7. unbind_line_account — 解綁 ─────────────────────────
CREATE OR REPLACE FUNCTION unbind_line_account(p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees
     SET line_user_id = NULL,
         line_bind_at = NULL
   WHERE id = p_employee_id;
END;
$$;

-- ── 8. 授權 ───────────────────────────────────────────────
-- bind_line_account 需要被 anon 呼叫（Webhook 無 JWT）
GRANT EXECUTE ON FUNCTION bind_line_account(text, text) TO anon;
GRANT EXECUTE ON FUNCTION bind_line_account(text, text) TO authenticated;

-- 其他函式僅 authenticated
GRANT EXECUTE ON FUNCTION generate_line_bind_code() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_line_bind_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unbind_line_account(uuid) TO authenticated;
