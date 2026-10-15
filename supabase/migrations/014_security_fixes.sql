-- =====================================================================
-- 014_security_fixes.sql
-- Sprint：上線前資安修補（2026-10-15 全面健檢 C1/C2/C3/H1 + 中低項）
-- 相依：001–013、20261015143521（Lovable 自動產生）
-- 可重跑：是
--
-- 1. 彙總 View 改為以呼叫者權限執行（套用 RLS），撤銷 anon 讀取
-- 2. 集團對帳 View 限 owner、限本人所屬公司
-- 3. 所有 SECURITY DEFINER 函式：撤銷 PUBLIC/anon，依用途重新授權
-- 4. 10 個 RPC 補上身分／公司檢查（未登入的 service_role / cron 不受影響）
-- 5. 工序狀態：進出「外包中」只能經由外包 RPC；修正派外包／退回／取消的轉換錯誤
-- 6. Lovable 新增的三條 INSERT 政策 → 見 014b
-- 7. 4 張表政策 {public} → {authenticated}；3 個函式補 search_path
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. View：security_invoker + 撤銷 anon
-- ---------------------------------------------------------------------
alter view public.board_stats                set (security_invoker = true);
alter view public.outsource_stats            set (security_invoker = true);
alter view public.order_cost_summary         set (security_invoker = true);
alter view public.payables_summary           set (security_invoker = true);
alter view public.receivables_summary        set (security_invoker = true);
alter view public.attendance_monthly_summary set (security_invoker = true);
alter view public.attendance_daily_report    set (security_invoker = true);
alter view public.my_notification_count      set (security_invoker = true);

-- ---------------------------------------------------------------------
-- 2. 集團對帳：需同時看兩家應付／應收，維持 definer，但只給 owner、限所屬公司
-- ---------------------------------------------------------------------
create or replace view public.group_reconciliation as
select l.id as link_id,
       l.from_company_id, fc.name as from_company_name,
       l.to_company_id,   tc.name as to_company_name,
       fo.order_no as from_order_no, fo.item_name as from_item_name,
       too.order_no as to_order_no,
       l.agreed_amount, l.agreed_due_date, l.status as link_status,
       l.dispatched_at, l.completed_at,
       p.amount as payable_amount, p.status as payable_status,
       r.amount as receivable_amount, r.status as receivable_status,
       case when l.payable_id is not null and l.receivable_id is not null
             and p.amount is distinct from r.amount then true else false end as amount_mismatch
  from public.cross_company_links l
  join public.companies fc on fc.id = l.from_company_id
  join public.companies tc on tc.id = l.to_company_id
  join public.orders fo on fo.id = l.from_order_id
  left join public.orders too on too.id = l.to_order_id
  left join public.payables p on p.id = l.payable_id
  left join public.receivables r on r.id = l.receivable_id
 where public.is_owner()
   and l.from_company_id in (select public.user_company_ids())
   and l.to_company_id   in (select public.user_company_ids());

revoke all on public.board_stats, public.outsource_stats, public.order_cost_summary,
              public.payables_summary, public.receivables_summary,
              public.attendance_monthly_summary, public.attendance_daily_report,
              public.my_notification_count, public.group_reconciliation
  from anon;
grant select on public.board_stats, public.outsource_stats, public.order_cost_summary,
                public.payables_summary, public.receivables_summary,
                public.attendance_monthly_summary, public.attendance_daily_report,
                public.my_notification_count, public.group_reconciliation
  to authenticated;

-- ---------------------------------------------------------------------
-- 3. 函式權限
--    trigger 函式：只留 service_role（trigger 觸發時不檢查 EXECUTE）
--    系統內部函式：只留 service_role
--    使用者 RPC：authenticated + service_role
--    login_companies：登入頁需要 anon
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_internal text[] := array[
    'call_edge_function','notify_scan_all','send_line_digests',
    'generate_line_bind_code','bind_line_account','expand_order_tasks',
    'emit_notification','resolve_recipients','mark_line_result',
    'cron_guarded','purge_maintenance_job','find_user_id_by_email',
    'revoke_user_sessions','write_audit'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname,
           p.prorettype = 'trigger'::regtype as is_trg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if not r.is_trg and not (r.proname = any(v_internal)) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

grant execute on function public.login_companies() to anon;

-- 之後新建的函式預設不給 anon / PUBLIC
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- 4. RPC 補身分／公司檢查（插在函式 BEGIN 之後；auth.uid() 為 null 代表
--    service_role / cron / postgres，不受影響）
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
  g record;
begin
  for g in
    select * from (values
      ('public.allocate_payment(uuid,uuid,date,text,numeric,jsonb,text,text,date,text,uuid)',
       $g$if auth.uid() is not null and (p_company_id is distinct from public.current_company_id() or not public.is_manager()) then
    raise exception 'P0005: 無權限（僅本公司主管可付款沖帳）' using errcode = '42501';
  end if;$g$),
      ('public.allocate_collection(uuid,uuid,date,text,numeric,jsonb,text,text,date,text,uuid)',
       $g$if auth.uid() is not null and (p_company_id is distinct from public.current_company_id() or not public.is_manager()) then
    raise exception 'P0005: 無權限（僅本公司主管可收款沖帳）' using errcode = '42501';
  end if;$g$),
      ('public.void_payment(uuid)',
       $g$if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from public.payments where id = p_payment_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;$g$),
      ('public.void_collection(uuid)',
       $g$if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from public.collections where id = p_collection_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;$g$),
      ('public.confirm_purchase(uuid)',
       $g$if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from public.purchases where id = p_purchase_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;$g$),
      ('public.void_purchase(uuid)',
       $g$if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from public.purchases where id = p_purchase_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;$g$),
      ('public.complete_outsource(uuid)',
       $g$if auth.uid() is not null and not exists (
       select 1 from public.cross_company_links l
        where l.id = p_link_id
          and public.current_company_id() in (l.from_company_id, l.to_company_id)) then
    raise exception 'P0005: 無權限' using errcode = '42501';
  end if;
  perform set_config('app.task_rpc', 'outsource', true);$g$),
      ('public.dispatch_outsource(uuid,uuid,numeric,date,text)',
       $g$perform set_config('app.task_rpc', 'outsource', true);$g$),
      ('public.cancel_outsource(uuid,text)',
       $g$perform set_config('app.task_rpc', 'outsource', true);$g$),
      ('public.reject_outsource(uuid,text)',
       $g$perform set_config('app.task_rpc', 'outsource', true);$g$)
    ) as t(fn, guard)
  loop
    v_def := pg_get_functiondef(g.fn::regprocedure);
    if position('-- guard:014' in v_def) > 0 then
      continue;  -- 已套用過
    end if;
    v_new := regexp_replace(v_def, '(\$function\$.*?\mbegin\M)',
                            '\1' || chr(10) || '  -- guard:014' || chr(10) || '  ' || g.guard,
                            'i');
    if v_new = v_def then
      raise exception '014: 無法在 % 插入檢查', g.fn;
    end if;
    execute v_new;
  end loop;
end $$;

-- LINE 綁定碼：僅同公司主管可重新產碼（會回傳新碼）
create or replace function public.refresh_line_bind_code(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if auth.uid() is not null and (not public.is_manager() or not exists (
       select 1 from public.employees
        where id = p_employee_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 僅同公司主管可重新產生綁定碼' using errcode = '42501';
  end if;
  v_code := public.generate_line_bind_code();
  update public.employees
     set line_bind_code = v_code, line_user_id = null, line_bind_at = null
   where id = p_employee_id;
  return v_code;
end;
$$;

-- 解除綁定：本人、同公司主管，或 webhook（service_role）
create or replace function public.unbind_line_account(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and p_employee_id is distinct from public.current_employee_id()
     and (not public.is_manager() or not exists (
           select 1 from public.employees
            where id = p_employee_id and company_id = public.current_company_id())) then
    raise exception 'P0005: 無權限解除此員工的 LINE 綁定' using errcode = '42501';
  end if;
  update public.employees
     set line_user_id = null, line_bind_at = null
   where id = p_employee_id;
end;
$$;

-- CREATE OR REPLACE 會保留既有權限，再明確設一次
revoke all on function public.refresh_line_bind_code(uuid), public.unbind_line_account(uuid) from public, anon;
grant execute on function public.refresh_line_bind_code(uuid), public.unbind_line_account(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. 工序狀態轉換：進出 outsourced 只能經由外包 RPC
--    同時修正：pending/assigned 可派外包；退回／取消可回 pending
-- ---------------------------------------------------------------------
create or replace function public.trg_task_transition_check_fn()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_valid boolean := false;
  v_rpc   boolean := coalesce(current_setting('app.task_rpc', true), '') = 'outsource';
begin
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  if (NEW.status = 'outsourced' or OLD.status = 'outsourced') and not v_rpc then
    raise exception 'outsource_rpc_required: 外包狀態只能透過「派外包／完成／退回／取消」功能變更'
      using errcode = 'P0002';
  end if;

  v_valid := case
    when OLD.status = 'pending'          and NEW.status in ('assigned','in_progress','skipped','outsourced') then true
    when OLD.status = 'assigned'         and NEW.status in ('in_progress','skipped','outsourced') then true
    when OLD.status = 'in_progress'      and NEW.status in ('done','blocked','waiting_customer','outsourced','skipped') then true
    when OLD.status = 'blocked'          and NEW.status in ('in_progress','skipped') then true
    when OLD.status = 'waiting_customer' and NEW.status in ('in_progress','skipped') then true
    when OLD.status = 'outsourced'       and NEW.status in ('done','in_progress','pending') then true
    else false
  end;

  if not v_valid then
    raise exception 'invalid_status_transition: % → %', OLD.status, NEW.status
      using errcode = 'P0002';
  end if;

  if NEW.status = 'blocked' and (NEW.blocked_reason is null or trim(NEW.blocked_reason) = '') then
    raise exception 'blocked_reason is required when status = blocked'
      using errcode = 'P0003';
  end if;

  return NEW;
end;
$$;
revoke all on function public.trg_task_transition_check_fn() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. 政策角色 {public} → {authenticated}；補 search_path
-- ---------------------------------------------------------------------
alter policy quotations_read    on public.quotations             to authenticated;
alter policy quotations_write   on public.quotations             to authenticated;
alter policy qi_read            on public.quotation_items        to authenticated;
alter policy qi_write           on public.quotation_items        to authenticated;
alter policy collections_read   on public.collections            to authenticated;
alter policy collections_write  on public.collections            to authenticated;
alter policy ca_read            on public.collection_allocations to authenticated;
alter policy ca_write           on public.collection_allocations to authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('prevent_order_delete','calc_due_date','haversine_m')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;
