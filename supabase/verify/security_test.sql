-- 安全性測試（2026-10-17，034 之後）：匿名、跨公司、員工越權、員工直接改資料
-- 全部在交易內，最後丟例外回滾，不留資料。
-- 註：整段一次跑若管理工具逾時，可依 1／2／3 段分開執行（2026-10-17 分段實測全數通過）。
-- 錯誤訊息裡 ROLLBACK 後面就是結果；「失敗 0 項」才算通過。
-- 以 Steven（祥興老闆）身分執行，中途暫時把他改成「員工」。
do $$
declare
  t record; n bigint; v_log text := ''; v_fail int := 0; v_ok boolean; r jsonb;
  XX uuid := '95755162-5905-469c-8158-8cbcc1bdb2e9'; YR uuid := '85da97b0-5c59-4c35-bc77-5fe8020bbaf3';
  ST uuid := 'ca90cbd2-4873-4013-bbee-91b4441c9b71'; v_staff uuid; v_task uuid;
begin
  -- 1. 匿名：所有資料表、檢視都讀不到
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') loop
    begin
      execute format('select count(*) from public.%I', t.relname) into n;
      if n > 0 then v_log := v_log || ' | FAIL 匿名讀得到 ' || t.relname; v_fail := v_fail + 1; end if;
    exception when others then null;
    end;
  end loop;
  reset role;

  -- 2. 老闆在祥興：看不到沂融的業務資料
  perform set_config('request.jwt.claims', '{"sub":"c443807f-82d8-41d8-a0c1-5d1e3cc66ab3","role":"authenticated"}', true);
  set local role authenticated;
  for t in select c.table_name from information_schema.columns c
             join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relkind = 'r'
            where c.table_schema = 'public' and c.column_name = 'company_id'
              and c.table_name not in ('companies', 'company_modules', 'roles', 'employees', 'cross_company_links',
                                       'cross_company_events', 'user_company_context', 'lookups', 'system_configs', 'menus') loop
    begin
      execute format('select count(*) from public.%I where company_id = $1', t.table_name) into n using YR;
      if n > 0 then v_log := v_log || ' | FAIL 祥興看得到沂融 ' || t.table_name; v_fail := v_fail + 1; end if;
    exception when others then null;
    end;
  end loop;
  reset role;

  -- 3. 員工
  select id into v_task from order_tasks where company_id = XX and status in ('pending', 'assigned') order by created_at desc limit 1;
  if v_task is not null then
    update order_tasks set assignee_id = ST, status = 'assigned' where id = v_task and status = 'pending';
    update order_tasks set assignee_id = ST where id = v_task;
  end if;
  select id into v_staff from roles where company_id = XX and tier = 'staff';
  update employees set role_id = v_staff where id = ST;
  set local role authenticated;

  for t in select unnest(array['payroll_items', 'payroll_runs', 'employee_pay_profiles', 'payroll_params', 'receivables',
                               'payables', 'collections', 'payments', 'order_costs', 'purchases', 'audit_logs', 'error_logs']) as relname loop
    begin
      execute format('select count(*) from public.%I', t.relname) into n;
      if n > 0 then v_log := v_log || ' | FAIL 員工讀得到 ' || t.relname; v_fail := v_fail + 1; end if;
    exception when others then null;
    end;
  end loop;

  -- 出勤直接修改：以政策定義檢查（只允許主管），不實際對整張表下 update
  if not exists (select 1 from pg_policies where tablename = 'attendances' and policyname = 'attendances_update'
                  and qual like '%is_manager()%' and with_check like '%is_manager()%') then
    v_log := v_log || ' | FAIL 員工能改出勤（出勤修改政策不是限主管）'; v_fail := v_fail + 1;
  end if;
  v_ok := false;
  begin insert into attendances(company_id, employee_id, work_date, status) values (XX, ST, '2020-01-01', 'normal');
  exception when others then v_ok := true; end;
  if not v_ok then v_log := v_log || ' | FAIL 員工能自建出勤'; v_fail := v_fail + 1; end if;
  v_ok := false;
  begin insert into attendance_amendments(company_id, employee_id, request_type, request_time, reason, status)
        values (XX, ST, 'clock_in', now(), 'x', 'approved');
  exception when others then v_ok := true; end;
  if not v_ok then v_log := v_log || ' | FAIL 員工能新增已核准的補卡'; v_fail := v_fail + 1; end if;
  update leave_requests set status = 'approved' where status = 'pending'; get diagnostics n = row_count;
  if n > 0 then v_log := v_log || ' | FAIL 員工能自己核准請假'; v_fail := v_fail + 1; end if;
  update role_module_permissions set can_edit = true where can_edit = false; get diagnostics n = row_count;
  if n > 0 then v_log := v_log || ' | FAIL 員工能改權限'; v_fail := v_fail + 1; end if;
  begin
    update employees set role_id = (select id from roles where company_id = XX and tier = 'owner') where id = ST;
    get diagnostics n = row_count;
    if n > 0 then v_log := v_log || ' | FAIL 員工能把自己升成老闆'; v_fail := v_fail + 1; end if;
  exception when others then null; end;
  update quotations set total = 1 where total <> 1; get diagnostics n = row_count;
  if n > 0 then v_log := v_log || ' | FAIL 員工能直接改報價金額'; v_fail := v_fail + 1; end if;
  if v_task is not null then
    v_ok := false;
    begin update order_tasks set due_at = now() - interval '1 day' where id = v_task;
    exception when others then v_ok := true; end;
    if not v_ok then v_log := v_log || ' | FAIL 員工能改工序交期'; v_fail := v_fail + 1; end if;
    r := task_claim(v_task);
    r := task_finish(v_task);
    if (select status from order_tasks where id = v_task) <> 'done' then
      v_log := v_log || ' | FAIL 員工用我來做／做好了失敗'; v_fail := v_fail + 1;
    end if;
  end if;

  for t in select * from (values
    ('payroll_generate', 'select payroll_generate(''2026-10-01'')'),
    ('import_price_list', format('select import_price_list(%L, ''[]'', ''[]'', ''[]'')', XX)),
    ('approve_amendment', 'select approve_amendment(gen_random_uuid(), true, null)'),
    ('leave_decide', 'select leave_decide(gen_random_uuid(), true, null)'),
    ('void_receivable', format('select void_receivable((select id from receivables where company_id = %L and status <> ''void'' limit 1), ''x'')', XX)),
    ('create_manual_receivable', format('select create_manual_receivable((select id from customers where company_id = %L limit 1), 100, null, null, ''x'', null)', XX)),
    ('add_order_cost', format('select add_order_cost((select id from orders where company_id = %L limit 1), ''other'', 1, null, ''x'')', XX)),
    ('purge_maintenance', 'select purge_maintenance(true)')
  ) as v(name, q) loop
    begin
      execute t.q;
      v_log := v_log || ' | FAIL 員工呼叫 ' || t.name || ' 沒被擋'; v_fail := v_fail + 1;
    exception when others then null;
    end;
  end loop;

  raise exception 'ROLLBACK 失敗 % 項 %', v_fail, v_log;
end $$;
