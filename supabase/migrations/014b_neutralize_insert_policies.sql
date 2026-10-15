-- =====================================================================
-- 014b_neutralize_insert_policies.sql
-- 目的：讓 Lovable 於 20261015143521 新增的 INSERT 政策失效
--       （同公司任何員工都能直接新增應付／應收／跨公司事件）
-- 作法：改為 with check (false)，等同不存在。
--       應付／應收／跨公司事件只應由 SECURITY DEFINER 函式寫入（不受 RLS 限制）。
-- 待辦：之後可改為 drop policy（需在 Supabase 確認視窗按「允許」）
-- 相依：014_security_fixes
-- =====================================================================
alter policy payables_insert_system    on public.payables             with check (false);
alter policy receivables_insert_system on public.receivables          with check (false);
alter policy cce_insert_system         on public.cross_company_events with check (false);
