-- =====================================================================
-- 017_line_bind_privacy.sql
-- LINE 綁定碼只給「本人」與「同公司主管」看
-- 問題：employees_read 讓同公司所有人都能讀 employees 全部欄位，
--       員工可讀到同事的 line_bind_code，綁到自己的 LINE 就能收到對方的通知。
-- 作法：
--   1. authenticated 改用欄位層級權限：SELECT 不含 line_bind_code；
--      INSERT/UPDATE 不含 line_user_id / line_bind_code / line_bind_at（只能經由綁定流程寫入）
--   2. 新增 get_line_bind_status()：主管看全公司、其他人只看自己
--   3. anon 對 employees 不需要任何權限
-- 注意：前端查 employees 不可再用 select("*")
-- 相依：013_line_binding、014_security_fixes
-- =====================================================================
revoke all on public.employees from anon;
revoke select, insert, update on public.employees from authenticated;

grant select (id, company_id, user_id, emp_no, name, role_id, department_id, position, phone,
              line_user_id, shift_id, hire_date, can_switch_company, is_active, note,
              created_at, created_by, updated_at, updated_by, line_bind_at)
  on public.employees to authenticated;

grant insert (id, company_id, user_id, emp_no, name, role_id, department_id, position, phone,
              shift_id, hire_date, can_switch_company, is_active, note,
              created_at, created_by, updated_at, updated_by)
  on public.employees to authenticated;

grant update (company_id, user_id, emp_no, name, role_id, department_id, position, phone,
              shift_id, hire_date, can_switch_company, is_active, note,
              updated_at, updated_by)
  on public.employees to authenticated;

create or replace function public.get_line_bind_status()
returns table (employee_id uuid, line_bind_code text, is_bound boolean, line_bind_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.line_bind_code, e.line_user_id is not null, e.line_bind_at
    from public.employees e
   where e.company_id = public.current_company_id()
     and (public.is_manager() or e.id = public.current_employee_id());
$$;

revoke all on function public.get_line_bind_status() from public, anon;
grant execute on function public.get_line_bind_status() to authenticated, service_role;
