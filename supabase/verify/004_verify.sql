-- =============================================================
-- 004_verify.sql — S1 越權測試矩陣（A1–A15 資料庫層）＋權限自我檢查
-- 用法：整份貼進 SQL Editor 執行。全部包在 raise exception 內 → 自動回滾、不留測試資料。
--       看到 ERROR 是正常的：訊息本身就是報告。有 ★ 代表失敗，無 ★ 代表通過。
-- 相依：001–004 已套用
-- =============================================================
do $$
declare
  u_boss  uuid := '11111111-1111-1111-1111-111111111111';
  u_xxmgr uuid := '22222222-2222-2222-2222-222222222222';
  u_xxstf uuid := '33333333-3333-3333-3333-333333333333';
  u_yrstf uuid := '44444444-4444-4444-4444-444444444444';
  u_admin uuid := '55555555-5555-5555-5555-555555555555';
  c_xx uuid; c_yr uuid; n int; t text; msg text := ''; fails int := 0; r record;
  e_xxstf uuid;
begin
  select id into c_xx from companies where code = 'XX';
  select id into c_yr from companies where code = 'YR';

  -- ---------- 建測試帳號 ----------
  insert into auth.users (id, email, aud, role) values
    (u_boss,  'test-boss@xiangxing.local',  'authenticated','authenticated'),
    (u_xxmgr, 'test-xxmgr@xiangxing.local', 'authenticated','authenticated'),
    (u_xxstf, 'test-xxstf@xiangxing.local', 'authenticated','authenticated'),
    (u_yrstf, 'test-yrstf@yirong.local',    'authenticated','authenticated'),
    (u_admin, 'test-admin@puansage.net',    'authenticated','authenticated');
  update profiles set is_platform_admin = true, must_change_password = false where id = u_admin;

  insert into employees (company_id, user_id, emp_no, name, role_id, can_switch_company)
  select c_xx, u_boss, 'T-B01', '測試老闆', id, true from roles where company_id = c_xx and code = 'owner';
  insert into employees (company_id, user_id, emp_no, name, role_id, can_switch_company)
  select c_yr, u_boss, 'T-B01', '測試老闆', id, true from roles where company_id = c_yr and code = 'owner';
  insert into employees (company_id, user_id, emp_no, name, role_id)
  select c_xx, u_xxmgr, 'T-M01', '測試祥興店長', id from roles where company_id = c_xx and code = 'manager';
  insert into employees (company_id, user_id, emp_no, name, role_id)
  select c_xx, u_xxstf, 'T-S01', '測試祥興師傅', id from roles where company_id = c_xx and code = 'staff'
  returning id into e_xxstf;
  insert into employees (company_id, user_id, emp_no, name, role_id)
  select c_yr, u_yrstf, 'T-S01', '測試沂融師傅', id from roles where company_id = c_yr and code = 'staff';

  insert into user_company_context (user_id, current_company_id) values
    (u_boss, c_xx), (u_xxmgr, c_xx), (u_xxstf, c_xx), (u_yrstf, c_yr), (u_admin, c_xx);

  -- ---------- A0 anon 掃描：所有表 0 列、無函式權限錯誤 ----------
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'anon', true);
  execute 'set local role anon';
  for r in select tablename from pg_tables where schemaname = 'public' order by 1 loop
    begin
      execute format('select count(*) from public.%I', r.tablename) into n;
      if n > 0 then fails := fails + 1; msg := msg || format(E'\n  ★ A0 anon 看得到 %s %s 列', r.tablename, n); end if;
    exception when insufficient_privilege then
      if sqlerrm like '%for function%' then fails := fails + 1; msg := msg || format(E'\n  ★ A0 %s 噴函式權限錯誤', r.tablename); end if;
    end;
  end loop;
  execute 'reset role';

  -- ---------- 沂融 staff ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_yrstf, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- A1 只看得到沂融的人
  select count(*) into n from employees where company_id = c_xx;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A1 沂融 staff 看得到祥興員工'; end if;
  select count(*) into n from employees;
  if n <> 2 then fails := fails + 1; msg := msg || format(E'\n  ★ A1 沂融 staff 員工清單應 2 列，實際 %s', n); end if;
  -- A2 跨公司寫入
  begin
    insert into shifts (company_id, name, start_time, end_time) values (c_xx, '越權班', '01:00', '02:00');
    fails := fails + 1; msg := msg || E'\n  ★ A2 沂融 staff 可寫入祥興 shifts';
  exception when others then null; end;
  -- A3 沂融 staff 只見沂融公司
  select count(*) into n from companies;
  if n <> 1 then fails := fails + 1; msg := msg || format(E'\n  ★ A3 沂融 staff companies 應 1 列，實際 %s', n); end if;
  -- A7 staff 不可切公司
  begin
    perform switch_company(c_xx);
    fails := fails + 1; msg := msg || E'\n  ★ A7 沂融 staff 可 switch_company 到祥興';
  exception when others then null; end;
  update user_company_context set current_company_id = c_xx where user_id = u_yrstf;
  get diagnostics n = row_count;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A7 沂融 staff 可直接改 user_company_context'; end if;
  -- A12 沂融只看到沂融的 roles / rmp / rules
  select count(*) into n from roles where company_id = c_xx;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A12 沂融看得到祥興 roles'; end if;
  select count(*) into n from notification_rules where company_id = c_xx;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A12 沂融看得到祥興 notification_rules'; end if;
  -- A14 menus 全域可讀
  select count(*) into n from menus;
  if n = 0 then fails := fails + 1; msg := msg || E'\n  ★ A14 staff 讀不到 menus'; end if;
  -- has_perm
  if has_perm('payables','view') then fails := fails + 1; msg := msg || E'\n  ★ staff has_perm(payables,view) 應 false'; end if;
  if not has_perm('my_work','view') then fails := fails + 1; msg := msg || E'\n  ★ staff has_perm(my_work,view) 應 true'; end if;
  if current_role_code() <> 'staff' then fails := fails + 1; msg := msg || format(E'\n  ★ staff tier 應 staff，得 %s', current_role_code()); end if;
  execute 'reset role';

  -- ---------- 祥興 staff ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_xxstf, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- A10 自己加權限
  begin
    insert into role_module_permissions (role_id, module_key, can_view)
    select role_id, 'payables', true from employees where id = e_xxstf
    on conflict (role_id, module_key) do update set can_view = true;
    if has_perm('payables','view') then fails := fails + 1; msg := msg || E'\n  ★ A10 staff 自行加權限成功'; end if;
  exception when others then null; end;
  -- A13 自升平台管理員
  begin
    update profiles set is_platform_admin = true where id = u_xxstf;
    if is_platform_admin() then fails := fails + 1; msg := msg || E'\n  ★ A13 staff 可自升平台管理員'; end if;
  exception when others then null; end;
  -- staff 不可讀日誌 / 參數寫入
  select count(*) into n from audit_logs;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ staff 可讀 audit_logs'; end if;
  update system_configs set value = '99' where key = 'ui.list_page_size';
  get diagnostics n = row_count;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ staff 可改全系統參數'; end if;
  -- staff 可讀共用字典
  select count(*) into n from lookups where category = 'unit';
  if n = 0 then fails := fails + 1; msg := msg || E'\n  ★ staff 讀不到共用 lookups'; end if;
  -- 日誌只能寫自己
  begin
    insert into activity_logs (user_id, action) values (u_boss, 'forged');
    fails := fails + 1; msg := msg || E'\n  ★ staff 可偽造他人 activity_logs';
  exception when others then null; end;
  insert into activity_logs (user_id, action, company_id) values (u_xxstf, 'login', c_xx);
  execute 'reset role';

  -- ---------- 祥興 manager ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_xxmgr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not has_perm('payables','view') then fails := fails + 1; msg := msg || E'\n  ★ manager has_perm(payables,view) 應 true'; end if;
  if has_perm('roles','edit') then fails := fails + 1; msg := msg || E'\n  ★ manager has_perm(roles,edit) 應 false'; end if;
  -- A11 manager 改 roles tier
  update roles set tier = 'owner' where company_id = c_xx and code = 'manager';
  get diagnostics n = row_count;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A11 manager 可改 roles'; end if;
  -- A3 manager 查 rmp 不含沂融
  select count(*) into n from role_module_permissions where company_id = c_yr;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A3 祥興 manager 看得到沂融權限矩陣'; end if;
  execute 'reset role';

  -- ---------- 老闆 ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_boss, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from companies;
  if n <> 2 then fails := fails + 1; msg := msg || format(E'\n  ★ 老闆 companies 應 2 列，實際 %s', n); end if;
  if not has_perm('menus','edit') then fails := fails + 1; msg := msg || E'\n  ★ owner has_perm 應恆真'; end if;
  -- A8 切到沂融
  perform switch_company(c_yr);
  select count(*) into n from employees;
  if n <> 2 then fails := fails + 1; msg := msg || format(E'\n  ★ A8 老闆切沂融後 employees 應 2 列，實際 %s', n); end if;
  select count(*) into n from roles where company_id = c_xx;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ A8 老闆在沂融 context 仍看到祥興 roles'; end if;
  perform switch_company(c_xx);
  -- owner 可寫 roles（新增自訂角色）
  insert into roles (company_id, code, name, tier) values (c_xx, 'accountant', '會計', 'manager');
  -- 內建角色不可刪
  begin
    delete from roles where company_id = c_xx and code = 'staff';
    fails := fails + 1; msg := msg || E'\n  ★ 內建角色可被刪除';
  exception when others then null; end;
  execute 'reset role';

  -- ---------- 平台管理員 ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from companies;
  if n <> 2 then fails := fails + 1; msg := msg || format(E'\n  ★ 平台管理員 companies 應 2 列，實際 %s', n); end if;
  if not has_perm('system_configs','edit') then fails := fails + 1; msg := msg || E'\n  ★ 平台管理員 has_perm 應恆真'; end if;
  select count(*) into n from employees where user_id = u_admin;
  if n > 0 then fails := fails + 1; msg := msg || E'\n  ★ 平台管理員不應有員工列'; end if;
  perform switch_company(c_yr); perform switch_company(c_xx);
  execute 'reset role';

  -- ---------- 稽核 trigger 有留痕 ----------
  select count(*) into n from audit_logs where target_table = 'roles' and action = 'insert';
  if n = 0 then fails := fails + 1; msg := msg || E'\n  ★ audit_row_change 未記錄 roles insert'; end if;

  -- ---------- emit_notification ----------
  select emit_notification(c_xx, 'system_alert', 'test', null, null, '測試', '測試內容') into n;
  if n <> 1 then fails := fails + 1; msg := msg || format(E'\n  ★ emit_notification 應送 1 位（老闆），實際 %s', n); end if;
  select emit_notification(c_xx, 'system_alert', 'test', null, null, '測試', '測試內容') into n;
  if n <> 0 then fails := fails + 1; msg := msg || E'\n  ★ emit_notification 同日去重失效'; end if;

  raise exception '%', format('【S1 越權驗證】失敗 %s 項%s', fails, case when fails = 0 then E'\n  → 全部通過 ✅' else msg end);
end $$;
