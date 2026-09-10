-- ============================================================
-- Sprint S5：採購與應付  009_purchasing.sql
-- 相依：008_cross_company.sql（payables, receivables 已存在）
-- 目的：purchases、purchase_items、payments、payment_allocations、
--       order_costs、calc_due_date()、付款沖帳觸發器
-- ============================================================

-- ============================================================
-- Section 1: calc_due_date() 函式
-- 根據 vendors.payment_term 推算到期日
-- 六種條件：cash / net30 / net60 / net90 / monthly_15 / monthly_end
-- ============================================================
CREATE OR REPLACE FUNCTION calc_due_date(
  p_payment_term text,
  p_base_date    date DEFAULT current_date
) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_payment_term
    WHEN 'cash'        THEN p_base_date
    WHEN 'net30'       THEN p_base_date + 30
    WHEN 'net60'       THEN p_base_date + 60
    WHEN 'net90'       THEN p_base_date + 90
    WHEN 'monthly_15'  THEN (date_trunc('month', p_base_date) + interval '1 month' + interval '14 days')::date
    WHEN 'monthly_end' THEN (date_trunc('month', p_base_date) + interval '2 months' - interval '1 day')::date
    ELSE p_base_date + 30  -- 預設 net30
  END;
END;
$$;

-- ============================================================
-- Section 2: purchases 採購單（進貨單）
-- ============================================================
CREATE TABLE IF NOT EXISTS purchases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  purchase_no      text NOT NULL,
  vendor_id        uuid NOT NULL REFERENCES vendors(id),
  purchase_date    date NOT NULL DEFAULT current_date,
  source_type      text NOT NULL DEFAULT 'stock'
                     CHECK (source_type IN ('stock', 'direct')),
  related_order_id uuid REFERENCES orders(id),
  invoice_no       text,
  invoice_date     date,
  tax_type         text NOT NULL DEFAULT 'taxable'
                     CHECK (tax_type IN ('taxable', 'zero', 'exempt')),
  amount_untaxed   numeric NOT NULL DEFAULT 0,
  tax_amount       numeric NOT NULL DEFAULT 0,
  amount_total     numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'confirmed', 'void')),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  UNIQUE (company_id, purchase_no)
);

CREATE INDEX IF NOT EXISTS idx_purchases_company_status
  ON purchases (company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor
  ON purchases (vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_related_order
  ON purchases (related_order_id) WHERE related_order_id IS NOT NULL;

-- ============================================================
-- Section 3: purchase_items 採購明細
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  purchase_id     uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_name       text NOT NULL,
  spec            text,
  qty             numeric NOT NULL DEFAULT 0,
  unit            text NOT NULL DEFAULT '張',
  unit_price      numeric NOT NULL DEFAULT 0,
  amount          numeric NOT NULL DEFAULT 0,
  is_warehouse_in boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
  ON purchase_items (purchase_id);

-- ============================================================
-- Section 4: ALTER payables — 新增 purchase_id 欄位與 balance 生成欄
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payables' AND column_name = 'purchase_id'
  ) THEN
    ALTER TABLE payables ADD COLUMN purchase_id uuid REFERENCES purchases(id);
  END IF;
END $$;

-- balance 生成欄（amount - paid_amount）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payables' AND column_name = 'balance'
  ) THEN
    ALTER TABLE payables ADD COLUMN balance numeric GENERATED ALWAYS AS (amount - paid_amount) STORED;
  END IF;
END $$;

-- 同步 receivables 也加 balance
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receivables' AND column_name = 'balance'
  ) THEN
    ALTER TABLE receivables ADD COLUMN balance numeric GENERATED ALWAYS AS (amount - received_amount) STORED;
  END IF;
END $$;

-- cross_company_links 補 FK（S4 遺留）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cross_company_links'::regclass AND conname = 'cross_company_links_payable_id_fkey'
  ) THEN
    ALTER TABLE cross_company_links
      ADD CONSTRAINT cross_company_links_payable_id_fkey
      FOREIGN KEY (payable_id) REFERENCES payables(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cross_company_links'::regclass AND conname = 'cross_company_links_receivable_id_fkey'
  ) THEN
    ALTER TABLE cross_company_links
      ADD CONSTRAINT cross_company_links_receivable_id_fkey
      FOREIGN KEY (receivable_id) REFERENCES receivables(id);
  END IF;
END $$;

-- ============================================================
-- Section 5: payments 付款單
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  payment_no    text NOT NULL,
  vendor_id     uuid NOT NULL REFERENCES vendors(id),
  pay_date      date NOT NULL DEFAULT current_date,
  method        text NOT NULL DEFAULT 'transfer'
                  CHECK (method IN ('cash', 'transfer', 'check', 'atm')),
  amount        numeric NOT NULL DEFAULT 0,
  bank_account  text,
  check_no      text,
  check_due_date date,
  status        text NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed', 'void')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  UNIQUE (company_id, payment_no)
);

CREATE INDEX IF NOT EXISTS idx_payments_company_status
  ON payments (company_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_vendor
  ON payments (vendor_id);

-- ============================================================
-- Section 6: payment_allocations 付款沖帳對應
-- 一筆付款可沖多筆應付（多對多）
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  payment_id       uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  payable_id       uuid NOT NULL REFERENCES payables(id),
  allocated_amount numeric NOT NULL DEFAULT 0
                     CHECK (allocated_amount > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment
  ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_payable
  ON payment_allocations (payable_id);

-- ============================================================
-- Section 7: order_costs 訂單成本歸集
-- ============================================================
CREATE TABLE IF NOT EXISTS order_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  order_id       uuid NOT NULL REFERENCES orders(id),
  cost_type      text NOT NULL
                   CHECK (cost_type IN ('material', 'outsource', 'labor', 'other')),
  source_type    text NOT NULL
                   CHECK (source_type IN ('purchase', 'inventory', 'manual')),
  source_id      uuid,
  amount         numeric NOT NULL DEFAULT 0,
  recognized_at  date NOT NULL DEFAULT current_date,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

CREATE INDEX IF NOT EXISTS idx_order_costs_order
  ON order_costs (order_id);
CREATE INDEX IF NOT EXISTS idx_order_costs_company
  ON order_costs (company_id, order_id);

-- ============================================================
-- Section 8: RLS policies
-- ============================================================
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_costs ENABLE ROW LEVEL SECURITY;

-- purchases
DROP POLICY IF EXISTS purchases_read ON purchases;
CREATE POLICY purchases_read ON purchases FOR SELECT
  USING (company_id = current_company_id() AND is_manager());

DROP POLICY IF EXISTS purchases_write ON purchases;
CREATE POLICY purchases_write ON purchases FOR ALL
  USING (company_id = current_company_id() AND is_manager())
  WITH CHECK (company_id = current_company_id() AND is_manager());

-- purchase_items
DROP POLICY IF EXISTS purchase_items_read ON purchase_items;
CREATE POLICY purchase_items_read ON purchase_items FOR SELECT
  USING (company_id = current_company_id() AND is_manager());

DROP POLICY IF EXISTS purchase_items_write ON purchase_items;
CREATE POLICY purchase_items_write ON purchase_items FOR ALL
  USING (company_id = current_company_id() AND is_manager())
  WITH CHECK (company_id = current_company_id() AND is_manager());

-- payments
DROP POLICY IF EXISTS payments_read ON payments;
CREATE POLICY payments_read ON payments FOR SELECT
  USING (company_id = current_company_id() AND is_manager());

DROP POLICY IF EXISTS payments_write ON payments;
CREATE POLICY payments_write ON payments FOR ALL
  USING (company_id = current_company_id() AND is_manager())
  WITH CHECK (company_id = current_company_id() AND is_manager());

-- payment_allocations
DROP POLICY IF EXISTS payment_alloc_read ON payment_allocations;
CREATE POLICY payment_alloc_read ON payment_allocations FOR SELECT
  USING (company_id = current_company_id() AND is_manager());

DROP POLICY IF EXISTS payment_alloc_write ON payment_allocations;
CREATE POLICY payment_alloc_write ON payment_allocations FOR ALL
  USING (company_id = current_company_id() AND is_manager())
  WITH CHECK (company_id = current_company_id() AND is_manager());

-- order_costs
DROP POLICY IF EXISTS order_costs_read ON order_costs;
CREATE POLICY order_costs_read ON order_costs FOR SELECT
  USING (company_id = current_company_id() AND is_manager());

DROP POLICY IF EXISTS order_costs_write ON order_costs;
CREATE POLICY order_costs_write ON order_costs FOR ALL
  USING (company_id = current_company_id() AND is_manager())
  WITH CHECK (company_id = current_company_id() AND is_manager());

-- ============================================================
-- Section 9: confirm_purchase() RPC
-- 進貨單確認：draft → confirmed
-- 自動產生 payable（到期日依廠商付款條件推算）
-- source_type='direct' 時自動寫入 order_costs
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_purchase(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase  purchases%ROWTYPE;
  v_vendor    vendors%ROWTYPE;
  v_payable_id uuid;
  v_doc_no    text;
  v_due_date  date;
  v_item      RECORD;
BEGIN
  -- 取得採購單
  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found: %', p_purchase_id;
  END IF;
  IF v_purchase.status <> 'draft' THEN
    RAISE EXCEPTION 'Purchase % is not in draft status', v_purchase.purchase_no;
  END IF;

  -- 取得廠商
  SELECT * INTO v_vendor FROM vendors WHERE id = v_purchase.vendor_id;

  -- 推算到期日
  v_due_date := calc_due_date(v_vendor.payment_term, v_purchase.purchase_date);

  -- 產生應付單號
  v_doc_no := next_doc_no(v_purchase.company_id, 'AP');

  -- 建立應付
  INSERT INTO payables (
    company_id, vendor_id, doc_no, source_type, related_order_id,
    purchase_id, amount, paid_amount, status, due_date, invoice_no, note,
    created_by
  ) VALUES (
    v_purchase.company_id, v_purchase.vendor_id, v_doc_no, 'purchase',
    v_purchase.related_order_id, v_purchase.id, v_purchase.amount_total,
    0, 'unpaid', v_due_date, v_purchase.invoice_no, v_purchase.note,
    v_purchase.updated_by
  ) RETURNING id INTO v_payable_id;

  -- source_type='direct' 時寫入 order_costs
  IF v_purchase.source_type = 'direct' AND v_purchase.related_order_id IS NOT NULL THEN
    INSERT INTO order_costs (
      company_id, order_id, cost_type, source_type, source_id,
      amount, recognized_at, note, created_by
    ) VALUES (
      v_purchase.company_id, v_purchase.related_order_id, 'material',
      'purchase', v_purchase.id, v_purchase.amount_total,
      v_purchase.purchase_date,
      '進貨單 ' || v_purchase.purchase_no,
      v_purchase.updated_by
    );
  END IF;

  -- 更新採購單狀態
  UPDATE purchases
  SET status = 'confirmed', updated_at = now()
  WHERE id = p_purchase_id;

  -- 更新 order_tasks.purchase_id（如有關聯工單）
  IF v_purchase.related_order_id IS NOT NULL THEN
    UPDATE order_tasks
    SET purchase_id = p_purchase_id, updated_at = now()
    WHERE id = (
      SELECT id FROM order_tasks
      WHERE order_id = v_purchase.related_order_id
        AND company_id = v_purchase.company_id
        AND purchase_id IS NULL
      ORDER BY step_no LIMIT 1
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', p_purchase_id,
    'payable_id', v_payable_id,
    'payable_doc_no', v_doc_no,
    'due_date', v_due_date
  );
END;
$$;

-- ============================================================
-- Section 10: void_purchase() RPC
-- 進貨單作廢：confirmed → void，同時作廢對應應付
-- ============================================================
CREATE OR REPLACE FUNCTION void_purchase(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_payable  payables%ROWTYPE;
BEGIN
  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found: %', p_purchase_id;
  END IF;
  IF v_purchase.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed purchases can be voided';
  END IF;

  -- 檢查對應應付是否已有付款
  SELECT * INTO v_payable FROM payables WHERE purchase_id = p_purchase_id AND status <> 'void';
  IF FOUND AND v_payable.paid_amount > 0 THEN
    RAISE EXCEPTION 'Cannot void purchase with partial/full payment. Void the payment first.';
  END IF;

  -- 作廢應付
  UPDATE payables SET status = 'void', updated_at = now()
  WHERE purchase_id = p_purchase_id AND status <> 'void';

  -- 移除 order_costs
  DELETE FROM order_costs
  WHERE source_type = 'purchase' AND source_id = p_purchase_id;

  -- 作廢採購單
  UPDATE purchases SET status = 'void', updated_at = now()
  WHERE id = p_purchase_id;

  RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id);
END;
$$;

-- ============================================================
-- Section 11: allocate_payment() RPC
-- 一筆付款沖多筆應付，自動更新各應付的 paid_amount 與 status
-- ============================================================
CREATE OR REPLACE FUNCTION allocate_payment(
  p_company_id    uuid,
  p_vendor_id     uuid,
  p_pay_date      date,
  p_method        text,
  p_amount        numeric,
  p_allocations   jsonb,    -- [{"payable_id":"...", "amount": 123}, ...]
  p_bank_account  text DEFAULT NULL,
  p_check_no      text DEFAULT NULL,
  p_check_due_date date DEFAULT NULL,
  p_note          text DEFAULT NULL,
  p_created_by    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id   uuid;
  v_payment_no   text;
  v_alloc        jsonb;
  v_payable      payables%ROWTYPE;
  v_alloc_amt    numeric;
  v_total_alloc  numeric := 0;
  v_new_paid     numeric;
BEGIN
  -- 驗證沖帳總額 = 付款金額
  SELECT COALESCE(SUM((a->>'amount')::numeric), 0)
  INTO v_total_alloc
  FROM jsonb_array_elements(p_allocations) a;

  IF v_total_alloc <> p_amount THEN
    RAISE EXCEPTION 'Allocation total (%) does not match payment amount (%)',
      v_total_alloc, p_amount;
  END IF;

  -- 產生付款單號
  v_payment_no := next_doc_no(p_company_id, 'PM');

  -- 建立付款單
  INSERT INTO payments (
    company_id, payment_no, vendor_id, pay_date, method, amount,
    bank_account, check_no, check_due_date, status, note, created_by
  ) VALUES (
    p_company_id, v_payment_no, p_vendor_id, p_pay_date, p_method, p_amount,
    p_bank_account, p_check_no, p_check_due_date, 'confirmed', p_note, p_created_by
  ) RETURNING id INTO v_payment_id;

  -- 逐筆沖帳
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_alloc_amt := (v_alloc->>'amount')::numeric;

    -- 鎖定並取得應付
    SELECT * INTO v_payable FROM payables
    WHERE id = (v_alloc->>'payable_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payable not found: %', v_alloc->>'payable_id';
    END IF;
    IF v_payable.status = 'void' THEN
      RAISE EXCEPTION 'Cannot allocate to voided payable: %', v_payable.doc_no;
    END IF;
    IF v_payable.company_id <> p_company_id THEN
      RAISE EXCEPTION 'Payable company mismatch';
    END IF;

    v_new_paid := v_payable.paid_amount + v_alloc_amt;
    IF v_new_paid > v_payable.amount THEN
      RAISE EXCEPTION 'Over-payment on payable %: paid % + alloc % > amount %',
        v_payable.doc_no, v_payable.paid_amount, v_alloc_amt, v_payable.amount;
    END IF;

    -- 寫入沖帳明細
    INSERT INTO payment_allocations (
      company_id, payment_id, payable_id, allocated_amount, created_by
    ) VALUES (
      p_company_id, v_payment_id, v_payable.id, v_alloc_amt, p_created_by
    );

    -- 更新應付
    UPDATE payables
    SET paid_amount = v_new_paid,
        status = CASE
          WHEN v_new_paid >= amount THEN 'paid'
          WHEN v_new_paid > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE id = v_payable.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_no', v_payment_no,
    'allocated_count', jsonb_array_length(p_allocations)
  );
END;
$$;

-- ============================================================
-- Section 12: void_payment() RPC
-- 付款作廢 → 反沖所有沖帳，應付回到之前的狀態
-- ============================================================
CREATE OR REPLACE FUNCTION void_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment  payments%ROWTYPE;
  v_alloc    RECORD;
  v_new_paid numeric;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found: %', p_payment_id;
  END IF;
  IF v_payment.status = 'void' THEN
    RAISE EXCEPTION 'Payment already voided';
  END IF;

  -- 逐筆反沖
  FOR v_alloc IN
    SELECT * FROM payment_allocations WHERE payment_id = p_payment_id
  LOOP
    v_new_paid := GREATEST(0,
      (SELECT paid_amount FROM payables WHERE id = v_alloc.payable_id)
      - v_alloc.allocated_amount
    );

    UPDATE payables
    SET paid_amount = v_new_paid,
        status = CASE
          WHEN v_new_paid >= amount THEN 'paid'
          WHEN v_new_paid > 0 THEN 'partial'
          ELSE 'unpaid'
        END,
        updated_at = now()
    WHERE id = v_alloc.payable_id;
  END LOOP;

  -- 刪除沖帳明細
  DELETE FROM payment_allocations WHERE payment_id = p_payment_id;

  -- 作廢付款單
  UPDATE payments SET status = 'void', updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('success', true, 'payment_id', p_payment_id);
END;
$$;

-- ============================================================
-- Section 13: payables_summary view
-- 應付管理列表用 — 含逾期標記
-- ============================================================
CREATE OR REPLACE VIEW payables_summary AS
SELECT
  p.id,
  p.company_id,
  p.doc_no,
  p.source_type,
  p.amount,
  p.paid_amount,
  p.amount - p.paid_amount AS balance,
  p.status,
  p.due_date,
  p.invoice_no,
  p.purchase_id,
  p.related_order_id,
  v.name AS vendor_name,
  v.vendor_code,
  CASE
    WHEN p.status IN ('paid', 'void') THEN false
    WHEN p.due_date < current_date THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN p.status IN ('paid', 'void') THEN 0
    WHEN p.due_date < current_date THEN current_date - p.due_date
    ELSE 0
  END AS overdue_days,
  p.created_at,
  p.note
FROM payables p
JOIN vendors v ON v.id = p.vendor_id;

-- ============================================================
-- Section 14: order_cost_summary view
-- 訂單成本彙總
-- ============================================================
CREATE OR REPLACE VIEW order_cost_summary AS
SELECT
  oc.order_id,
  oc.company_id,
  o.order_no,
  o.item_name,
  o.amount_total AS order_amount,
  COALESCE(SUM(oc.amount) FILTER (WHERE oc.cost_type = 'material'), 0) AS material_cost,
  COALESCE(SUM(oc.amount) FILTER (WHERE oc.cost_type = 'outsource'), 0) AS outsource_cost,
  COALESCE(SUM(oc.amount) FILTER (WHERE oc.cost_type = 'labor'), 0) AS labor_cost,
  COALESCE(SUM(oc.amount) FILTER (WHERE oc.cost_type = 'other'), 0) AS other_cost,
  COALESCE(SUM(oc.amount), 0) AS total_cost,
  o.amount_total - COALESCE(SUM(oc.amount), 0) AS gross_profit
FROM order_costs oc
JOIN orders o ON o.id = oc.order_id
GROUP BY oc.order_id, oc.company_id, o.order_no, o.item_name, o.amount_total;

-- ============================================================
-- Section 15: doc_no_counters 種子 — PO / PM
-- ============================================================
INSERT INTO doc_no_counters (company_id, doc_type, period, last_seq) VALUES
  ('95755162-5905-469c-8158-8cbcc1bdb2e9', 'PO', to_char(now(), 'YYMM'), 0),
  ('95755162-5905-469c-8158-8cbcc1bdb2e9', 'PM', to_char(now(), 'YYMM'), 0),
  ('85da97b0-5c59-4c35-bc77-5fe8020bbaf3', 'PO', to_char(now(), 'YYMM'), 0),
  ('85da97b0-5c59-4c35-bc77-5fe8020bbaf3', 'PM', to_char(now(), 'YYMM'), 0)
ON CONFLICT (company_id, doc_type, period) DO NOTHING;

-- ============================================================
-- Section 16a: module_registry + company_modules 種子
-- ============================================================
INSERT INTO module_registry (module_key, name, category, default_enabled, sort_order)
VALUES
  ('payments', '付款管理', 'finance', true, 32),
  ('order_costs', '訂單成本', 'finance', true, 34)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO company_modules (company_id, module_key, is_enabled)
VALUES
  ('95755162-5905-469c-8158-8cbcc1bdb2e9', 'payments', true),
  ('95755162-5905-469c-8158-8cbcc1bdb2e9', 'order_costs', true),
  ('85da97b0-5c59-4c35-bc77-5fe8020bbaf3', 'payments', true),
  ('85da97b0-5c59-4c35-bc77-5fe8020bbaf3', 'order_costs', true)
ON CONFLICT (company_id, module_key) DO NOTHING;

-- ============================================================
-- Section 16b: role_module_permissions 種子
-- purchases / payments / order_costs 模組權限
-- ============================================================
INSERT INTO role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT
  r.company_id,
  r.id AS role_id,
  m.module_key,
  true,                                     -- can_view
  r.tier IN ('owner', 'manager'),           -- can_create
  r.tier IN ('owner', 'manager'),           -- can_edit
  r.tier = 'owner',                         -- can_delete
  r.tier IN ('owner', 'manager')            -- can_export
FROM roles r
CROSS JOIN (
  VALUES ('purchases'), ('payments'), ('payables'), ('order_costs')
) AS m(module_key)
WHERE r.tier IN ('owner', 'manager')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ============================================================
-- Section 17: updated_at 觸發器（reuse existing function）
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_purchases') THEN
    CREATE TRIGGER set_updated_at_purchases
      BEFORE UPDATE ON purchases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_purchase_items') THEN
    CREATE TRIGGER set_updated_at_purchase_items
      BEFORE UPDATE ON purchase_items
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_payments') THEN
    CREATE TRIGGER set_updated_at_payments
      BEFORE UPDATE ON payments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_order_costs') THEN
    CREATE TRIGGER set_updated_at_order_costs
      BEFORE UPDATE ON order_costs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- Done. S5 採購與應付 migration complete.
-- ============================================================
