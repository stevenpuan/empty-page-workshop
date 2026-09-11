-- ============================================================
-- 012_security_hardening.sql
-- 安全加固：RLS 政策角色統一為 authenticated
-- 日期：2026-09-11
-- ============================================================
-- 說明：將 47 條使用 {public} 角色的 RLS 政策改為 {authenticated}
-- 原因：{public} 包含 anon 角色，雖然 current_company_id() 的 ACL
--       已阻止匿名存取，但應遵循最小權限原則
-- 影響：零風險 — 所有 SECURITY DEFINER trigger 函數以 postgres
--       superuser 身份執行，繞過 RLS，不受角色限制影響
-- ============================================================

BEGIN;

-- === attendance_amendments (4 policies) ===
ALTER POLICY amendments_insert ON attendance_amendments TO authenticated;
ALTER POLICY amendments_manager_select ON attendance_amendments TO authenticated;
ALTER POLICY amendments_staff_select ON attendance_amendments TO authenticated;
ALTER POLICY amendments_update ON attendance_amendments TO authenticated;

-- === attendances (4 policies) ===
ALTER POLICY attendances_insert ON attendances TO authenticated;
ALTER POLICY attendances_manager_select ON attendances TO authenticated;
ALTER POLICY attendances_staff_select ON attendances TO authenticated;
ALTER POLICY attendances_update ON attendances TO authenticated;

-- === cross_company_events (2 policies) ===
ALTER POLICY cce_insert_system ON cross_company_events TO authenticated;
ALTER POLICY cce_read ON cross_company_events TO authenticated;

-- === cross_company_links (2 policies) ===
ALTER POLICY ccl_read ON cross_company_links TO authenticated;
ALTER POLICY ccl_write_manager ON cross_company_links TO authenticated;

-- === customers (2 policies) ===
ALTER POLICY customers_read ON customers TO authenticated;
ALTER POLICY customers_write ON customers TO authenticated;

-- === order_costs (2 policies) ===
ALTER POLICY order_costs_read ON order_costs TO authenticated;
ALTER POLICY order_costs_write ON order_costs TO authenticated;

-- === order_task_logs (2 policies) ===
ALTER POLICY otl_insert_system ON order_task_logs TO authenticated;
ALTER POLICY otl_read ON order_task_logs TO authenticated;

-- === order_tasks (3 policies) ===
ALTER POLICY order_tasks_read ON order_tasks TO authenticated;
ALTER POLICY order_tasks_update_staff ON order_tasks TO authenticated;
ALTER POLICY order_tasks_write_manager ON order_tasks TO authenticated;

-- === orders (2 policies) ===
ALTER POLICY orders_read ON orders TO authenticated;
ALTER POLICY orders_write ON orders TO authenticated;

-- === payables (3 policies) ===
ALTER POLICY payables_insert_system ON payables TO authenticated;
ALTER POLICY payables_read ON payables TO authenticated;
ALTER POLICY payables_write ON payables TO authenticated;

-- === payment_allocations (2 policies) ===
ALTER POLICY payment_alloc_read ON payment_allocations TO authenticated;
ALTER POLICY payment_alloc_write ON payment_allocations TO authenticated;

-- === payments (2 policies) ===
ALTER POLICY payments_read ON payments TO authenticated;
ALTER POLICY payments_write ON payments TO authenticated;

-- === products (2 policies) ===
ALTER POLICY products_read ON products TO authenticated;
ALTER POLICY products_write ON products TO authenticated;

-- === purchase_items (2 policies) ===
ALTER POLICY purchase_items_read ON purchase_items TO authenticated;
ALTER POLICY purchase_items_write ON purchase_items TO authenticated;

-- === purchases (2 policies) ===
ALTER POLICY purchases_read ON purchases TO authenticated;
ALTER POLICY purchases_write ON purchases TO authenticated;

-- === receivables (3 policies) ===
ALTER POLICY receivables_insert_system ON receivables TO authenticated;
ALTER POLICY receivables_read ON receivables TO authenticated;
ALTER POLICY receivables_write ON receivables TO authenticated;

-- === routing_template_steps (2 policies) ===
ALTER POLICY routing_steps_read ON routing_template_steps TO authenticated;
ALTER POLICY routing_steps_write ON routing_template_steps TO authenticated;

-- === routing_templates (2 policies) ===
ALTER POLICY routing_templates_read ON routing_templates TO authenticated;
ALTER POLICY routing_templates_write ON routing_templates TO authenticated;

-- === vendors (2 policies) ===
ALTER POLICY vendors_read ON vendors TO authenticated;
ALTER POLICY vendors_write ON vendors TO authenticated;

-- === work_stations (2 policies) ===
ALTER POLICY work_stations_read ON work_stations TO authenticated;
ALTER POLICY work_stations_write ON work_stations TO authenticated;

-- === Staff notification permission (both companies) ===
INSERT INTO role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.company_id, r.id, 'notification', true, false, true, false, false
FROM roles r WHERE r.code = 'staff'
ON CONFLICT DO NOTHING;

COMMIT;
