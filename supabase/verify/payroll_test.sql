-- 033 請假與薪資測試（全部在交易內，最後 ROLLBACK，不留資料）
-- 用 Steven（祥興老闆）登入身分；數字與《薪資計算表_範本.xlsx》範例相同
do $$
declare
  XX uuid := '95755162-5905-469c-8158-8cbcc1bdb2e9';
  ST uuid := 'ca90cbd2-4873-4013-bbee-91b4441c9b71';   -- Steven：月薪（同範例「設計」）
  T2 uuid := '88888888-0000-4000-8000-000000000002';   -- 張師傅：月薪（同範例「現場」）
  T3 uuid := '88888888-0000-4000-8000-000000000003';   -- 黃設計：月中到職
  v_r jsonb; v_run uuid; v_leave uuid; v_ok boolean; v_n int; it payroll_items; v_log text := '';
  v_staff_role uuid;
begin
  -- 準備資料（以資料庫管理者身分）
  update employees set hire_date = null where id in (ST, T2);
  update employees set hire_date = '2026-09-16' where id = T3;
  insert into holidays (company_id, holiday_date, name, kind) values (XX, '2026-09-28', '測試國定假日', 'national')
  on conflict do nothing;
  -- Steven：22 天出勤，1 次遲到 8 分，加班 1.34 共 6 小時、1.67 共 1 小時
  insert into attendances (company_id, employee_id, work_date, clock_in_at, clock_out_at, status, late_minutes,
                           early_leave_minutes, work_minutes, ot_minutes_134, ot_minutes_167)
  select XX, ST, d::date, d + interval '8 hours', d + interval '17 hours', 'normal',
         case when d::date = '2026-09-02' then 8 else 0 end, 0, 480, 0, 0
    from generate_series('2026-09-01'::timestamptz, '2026-09-22'::timestamptz, interval '1 day') d;
  update attendances set ot_minutes_134 = 120, work_minutes = 600
   where employee_id = ST and work_date in ('2026-09-03', '2026-09-04');
  update attendances set ot_minutes_134 = 120, ot_minutes_167 = 60, work_minutes = 660
   where employee_id = ST and work_date = '2026-09-08';

  -- 張師傅：4 次遲到共 25 分；加班 1.34 共 3 小時；國定假日出勤 8 小時；事假 4 小時
  insert into attendances (company_id, employee_id, work_date, clock_in_at, clock_out_at, status, late_minutes,
                           early_leave_minutes, work_minutes, ot_minutes_134, ot_minutes_167)
  select XX, T2, d::date, d + interval '8 hours', d + interval '17 hours', 'normal',
         case when d::date in ('2026-09-01','2026-09-02','2026-09-03') then 5
              when d::date = '2026-09-04' then 10 else 0 end, 0,
         480 + case when d::date = '2026-09-09' then 180 else 0 end,
         case when d::date = '2026-09-09' then 120 else 0 end
           + case when d::date = '2026-09-10' then 60 else 0 end,
         0
    from generate_series('2026-09-01'::timestamptz, '2026-09-20'::timestamptz, interval '1 day') d;
  insert into attendances (company_id, employee_id, work_date, clock_in_at, clock_out_at, status, late_minutes,
                           early_leave_minutes, work_minutes, ot_minutes_134, ot_minutes_167)
  values (XX, T2, '2026-09-28', '2026-09-28 08:00+08', '2026-09-28 17:00+08', 'normal', 0, 0, 480, 0, 0);
  insert into leave_requests (company_id, employee_id, leave_type, date_from, date_to, hours, status)
  values (XX, T2, 'personal', '2026-09-15', '2026-09-15', 4, 'approved');

  insert into employee_pay_profiles (employee_id, company_id, pay_type, base_salary, position_allowance, meal_allowance, attendance_bonus, nhi_dependents)
  values (ST, XX, 'monthly', 32000, 2000, 2400, 1000, 0),
         (T2, XX, 'monthly', 30000, 0, 2400, 1000, 1),
         (T3, XX, 'monthly', 30000, 0, 0, 0, 0);

  perform set_config('request.jwt.claims', '{"sub":"c443807f-82d8-41d8-a0c1-5d1e3cc66ab3","role":"authenticated"}', true);
  set local role authenticated;

  -- 1. 請假：自己申請病假 8 小時、特休 8 小時；主管（自己是老闆）核准
  v_r := leave_request('sick', '2026-09-10', '2026-09-10', 8, '感冒');
  perform leave_decide((v_r->>'id')::uuid, true, null);
  v_r := leave_request('annual', '2026-09-11', '2026-09-11', 8, null);
  v_leave := (v_r->>'id')::uuid;
  perform leave_decide(v_leave, true, null);
  -- 重疊的多天請假要擋
  v_ok := false;
  begin perform leave_request('personal', '2026-09-10', '2026-09-12', 24, null);
  exception when others then if sqlerrm like 'P0002%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 1 重疊請假沒擋'; end if;
  -- 跨月要擋
  v_ok := false;
  begin perform leave_request('personal', '2026-09-30', '2026-10-01', 16, null);
  exception when others then if sqlerrm like 'P0003%' or sqlerrm like '%check%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 1b 跨月沒擋'; end if;
  reset role;
  select count(*) into v_n from notifications where rule_code in ('leave_requested', 'leave_decided');
  if v_n < 2 then raise exception 'FAIL 1c 請假沒通知 %', v_n; end if;
  v_log := v_log || E'\nOK 1 請假申請、核准、重疊與跨月擋下、通知 ' || v_n;
  set local role authenticated;

  -- 2. 計算 9 月薪資
  v_r := payroll_generate('2026-09-01');
  v_run := (v_r->>'run_id')::uuid;
  if (v_r->>'count')::int <> 3 then raise exception 'FAIL 2 人數 %', v_r; end if;

  select * into it from payroll_items where run_id = v_run and employee_id = ST;
  perform payroll_update_item(it.id, 1500, 0, 0, 0, null, null);
  select * into it from payroll_items where id = it.id;
  if it.attendance_bonus <> 967 or it.ot_pay <> 1513 or it.sick_deduct <> 623 or it.late_deduct <> 21
     or it.gross_pay <> 39736 or it.insured_salary <> 38200 or it.li_emp <> 955 or it.nhi_emp <> 592
     or it.net_pay <> 38189 or it.er_li <> 3422 or it.er_nhi <> 1849 or it.er_pension <> 2292 or it.total_cost <> 47299 then
    raise exception 'FAIL 2a Steven %', to_jsonb(it) - 'profile';
  end if;
  v_log := v_log || E'\nOK 2a 月薪（病假、加班、遲到、績效）應發 39736 實發 38189 公司成本 47299';

  select * into it from payroll_items where run_id = v_run and employee_id = T2;
  if it.attendance_bonus <> 0 or it.ot_pay <> 559 or it.holiday_pay <> 1113 or it.personal_deduct <> 557
     or it.late_deduct <> 58 or it.gross_pay <> 33457 or it.nhi_emp <> 1080 or it.net_pay <> 31507 then
    raise exception 'FAIL 2b 張師傅 %', to_jsonb(it) - 'profile';
  end if;
  v_log := v_log || E'\nOK 2b 月薪（國定假日、事假、遲到 4 次全勤不發）應發 33457 實發 31507';

  select * into it from payroll_items where run_id = v_run and employee_id = T3;
  if it.pay_days <> 15 or it.base_pay <> 15000 then raise exception 'FAIL 2c 月中到職 %', to_jsonb(it) - 'profile'; end if;
  v_log := v_log || E'\nOK 2c 月中到職 15 天，本薪 15000；提醒：' || array_to_string(it.warnings, '、');

  -- 3. 重算保留手填的績效獎金
  perform payroll_generate('2026-09-01');
  if (select perf_bonus from payroll_items where run_id = v_run and employee_id = ST) <> 1500 then
    raise exception 'FAIL 3 重算把績效獎金洗掉了';
  end if;
  v_log := v_log || E'\nOK 3 重算保留績效獎金';

  -- 4. 鎖定 → 員工看得到薪資條、通知、請假與重算都被擋
  v_r := payroll_close(v_run);
  if (v_r->>'notified')::int <> 3 then raise exception 'FAIL 4 通知人數 %', v_r; end if;
  if jsonb_array_length(my_payslips()) <> 1 or (my_payslips()->0->>'net_pay')::numeric <> 38189 then
    raise exception 'FAIL 4b 我的薪資條 %', my_payslips();
  end if;
  v_ok := false;
  begin perform payroll_generate('2026-09-01');
  exception when others then if sqlerrm like 'P0002%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 4c 鎖定後還能重算'; end if;
  v_ok := false;
  begin perform leave_request('personal', '2026-09-25', '2026-09-25', 2, null);
  exception when others then if sqlerrm like 'P0002%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 4d 鎖定後還能請該月的假'; end if;
  v_ok := false;
  begin perform leave_cancel(v_leave);
  exception when others then if sqlerrm like 'P0002%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 4e 鎖定後還能取消請假'; end if;
  perform payroll_reopen(v_run);
  perform payroll_update_item((select id from payroll_items where run_id = v_run and employee_id = ST), 2000, 0, 0, 0, null, null);
  if (select net_pay from payroll_items where run_id = v_run and employee_id = ST) <> 38689 then
    raise exception 'FAIL 4f 解鎖後修改';
  end if;
  v_log := v_log || E'\nOK 4 鎖定、通知、員工薪資條、鎖定後擋請假與重算、解鎖再改';

  -- 5. 員工看不到薪資資料、不能計算
  reset role;
  select id into v_staff_role from roles where company_id = XX and tier = 'staff';
  update employees set role_id = v_staff_role where id = ST;
  set local role authenticated;
  select count(*) into v_n from payroll_items;
  if v_n <> 0 then raise exception 'FAIL 5 員工看得到薪資 %', v_n; end if;
  select count(*) into v_n from employee_pay_profiles;
  if v_n <> 0 then raise exception 'FAIL 5b 員工看得到薪資設定'; end if;
  v_ok := false;
  begin perform payroll_generate('2026-09-01');
  exception when others then if sqlerrm like 'P0005%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 5c 員工可以算薪資'; end if;
  v_ok := false;
  begin perform leave_decide(v_leave, true, null);
  exception when others then if sqlerrm like 'P0005%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'FAIL 5d 員工可以審核請假'; end if;
  v_log := v_log || E'\nOK 5 員工看不到薪資、不能計算、不能審核';

  raise exception 'ROLLBACK 全部通過%', v_log;
end $$;
