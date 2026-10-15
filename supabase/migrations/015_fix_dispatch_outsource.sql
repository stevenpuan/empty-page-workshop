-- =====================================================================
-- 015_fix_dispatch_outsource.sql
-- 修正 dispatch_outsource 兩個既有錯誤（派外包從未成功過）：
--   1. 建立夥伴公司訂單時 status 寫 'confirmed'，
--      違反 orders_status_check（draft/active/shipped/closed/void）→ 改 'active'
--   2. orders.created_by 參照 auth.users(id)，原本帶入員工 id → 改 auth.uid()
-- 驗證（交易內回滾）：派外包 → 沂融自動展開 3 道工序 → 全部完成
--   → 祥興端工序 done、祥興應付 1234、沂融應收 1234、連結 completed ✅
-- 相依：014_security_fixes
-- =====================================================================
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.dispatch_outsource(uuid,uuid,numeric,date,text)'::regprocedure);

  v_new := regexp_replace(v_def, '''confirmed'',(\s*v_vendor\.partner_routing_template_id)', '''active'',\1');
  v_new := regexp_replace(v_new, 'v_emp(\s*\)\s*returning id into v_new_order_id)', 'auth.uid()\1');

  if v_new <> v_def then
    execute v_new;
  else
    raise notice '015: 已修正過，略過';
  end if;
end $$;
