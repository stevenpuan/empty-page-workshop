-- =====================================================================
-- 034 安全性補強（2026-10-17 全面檢查）
--   1. 出勤紀錄：員工不能再直接改自己的打卡（上下班、遲到、加班分鐘會影響薪資）
--      打卡一律走 clock_in／clock_out，更正一律走補卡核准；只有主管可直接修正
--   2. 補卡申請：員工新增時只能是「待核准」
--   3. 工序：員工直接改工序時，只能改狀態（與卡關原因）；完成時間、交期、負責人等由系統或主管改
--   4. 系統參數：標記為機密的值，只有有權限的人看得到
--   5. 內部函式不開放外部呼叫；固定 search_path
-- =====================================================================

-- 1. 出勤紀錄
alter policy attendances_insert on public.attendances
  with check (company_id = public.current_company_id() and public.is_manager());
alter policy attendances_update on public.attendances
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- 2. 補卡申請
alter policy amendments_insert on public.attendance_amendments
  with check (company_id = public.current_company_id()
              and employee_id = public.current_employee_id()
              and status = 'pending' and approver_id is null and approved_at is null);

-- 3. 工序：員工直接更新只能動狀態（RPC 以 security definer 執行，current_user 不是 authenticated，不受限制）
create or replace function public.trg_order_tasks_staff_guard_fn()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_keep text[] := array['status', 'blocked_reason', 'updated_at', 'updated_by'];
begin
  if current_user = 'authenticated' and not public.is_manager() then
    if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'P0005: 只能更新工序狀態，其他欄位請找主管修改' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- 名稱以 trg_0 開頭，排在其他 before update 觸發器前面（自動填完成時間的觸發器在後）
create trigger trg_0_order_tasks_staff_guard before update on public.order_tasks
  for each row execute function public.trg_order_tasks_staff_guard_fn();

-- 4. 系統參數的機密值
alter policy system_configs_read on public.system_configs
  using (((company_id is null) and ((not is_secret) or public.is_platform_admin()))
         or (company_id = public.current_company_id()
             and ((not is_secret) or public.has_perm('system_configs', 'edit'))));

create or replace function public.get_config(p_key text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select value from system_configs
      where key = p_key and company_id = public.current_company_id()
        and (not is_secret or auth.uid() is null or public.has_perm('system_configs', 'edit'))),
    (select value from system_configs
      where key = p_key and company_id is null
        and (not is_secret or auth.uid() is null or public.is_platform_admin())))
$$;

-- 5. 內部函式
revoke execute on function public._payroll_locked(uuid, date) from public, anon, authenticated;
revoke execute on function public.trg_quotation_sent_notify_fn() from public, anon, authenticated;
revoke execute on function public.trg_order_tasks_staff_guard_fn() from public, anon, authenticated;
alter function public._leave_label(text) set search_path to 'public';
alter function public._payroll_bracket(numeric, numeric[]) set search_path to 'public';
