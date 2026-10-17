-- 祥興／沂融 完整回歸測試（含 019–028 新功能）
-- 在單一交易內建立 6 個測試帳號與資料，以各角色身分呼叫資料庫，最後 ROLLBACK，不留任何資料。
-- 用法：Supabase SQL Editor 整段貼上執行。2026-10-17 結果：98/98 通過（034 安全補強後；030 起產品預設流程為三步）。
begin;
create temp table _t(n serial, grp text, test text, expect text, actual text, pass boolean) on commit drop;
grant all on _t to authenticated, anon;
grant all on sequence _t_n_seq to authenticated, anon;
create temp table _v(k text primary key, v text) on commit drop;
grant all on _v to authenticated, anon;

do $setup$
declare
  XX uuid := '95755162-5905-469c-8158-8cbcc1bdb2e9';
  YR uuid := '85da97b0-5c59-4c35-bc77-5fe8020bbaf3';
  u record;
  v_tpl uuid;
begin
  for u in select * from (values
    ('O',  'aaaaaaaa-0000-4000-8000-000000000001'::uuid),
    ('XM', 'aaaaaaaa-0000-4000-8000-000000000002'::uuid),
    ('XS', 'aaaaaaaa-0000-4000-8000-000000000003'::uuid),
    ('XS2','aaaaaaaa-0000-4000-8000-000000000004'::uuid),
    ('YM', 'aaaaaaaa-0000-4000-8000-000000000005'::uuid),
    ('YS', 'aaaaaaaa-0000-4000-8000-000000000006'::uuid)) t(k, id)
  loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                           created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values (u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            lower(u.k) || '@test.local', '', now(), now(), now(), '{}', '{}');
    insert into _v values ('uid_' || u.k, u.id::text);
  end loop;

  insert into employees(company_id, user_id, emp_no, name, role_id, shift_id, can_switch_company, is_active) values
   (XX, 'aaaaaaaa-0000-4000-8000-000000000001', 'TO1', '測試老闆', 'cd672491-1244-433f-99d1-5b16f5a80ef0', null, true, true),
   (YR, 'aaaaaaaa-0000-4000-8000-000000000001', 'TO1', '測試老闆', 'f7201852-3f55-4cd4-b2de-3926aaa9eb95', null, true, true),
   (XX, 'aaaaaaaa-0000-4000-8000-000000000002', 'TXM', '祥興主管T', '5dff5c1c-f6d2-4fb4-b0c8-4264d83c6e5b', null, false, true),
   (XX, 'aaaaaaaa-0000-4000-8000-000000000003', 'TXS', '祥興員工T', '872637f0-83f7-435c-8be2-75fa40126d7a', '36a2c910-ee73-4ca3-ab6e-88a2ad392faf', false, true),
   (XX, 'aaaaaaaa-0000-4000-8000-000000000004', 'TXS2','祥興員工T2','872637f0-83f7-435c-8be2-75fa40126d7a', '36a2c910-ee73-4ca3-ab6e-88a2ad392faf', false, true),
   (YR, 'aaaaaaaa-0000-4000-8000-000000000005', 'TYM', '沂融主管T', '1d530d51-6e98-40ad-9a86-3576d15f2f14', null, false, true),
   (YR, 'aaaaaaaa-0000-4000-8000-000000000006', 'TYS', '沂融員工T', '3ad2a5b3-4939-458b-af48-7778a3c9fff6', '1b6d6d2a-5074-4cbc-ad69-b99566f8970d', false, true);

  insert into user_company_context(user_id, current_company_id) values
   ('aaaaaaaa-0000-4000-8000-000000000001', XX),
   ('aaaaaaaa-0000-4000-8000-000000000002', XX),
   ('aaaaaaaa-0000-4000-8000-000000000003', XX),
   ('aaaaaaaa-0000-4000-8000-000000000004', XX),
   ('aaaaaaaa-0000-4000-8000-000000000005', YR),
   ('aaaaaaaa-0000-4000-8000-000000000006', YR);

  insert into _v select 'emp_' || e.emp_no || '_' || c.code, e.id::text
    from employees e join companies c on c.id = e.company_id where e.emp_no like 'T%';

  insert into routing_templates(company_id, product_category, name, is_default, is_active)
  values (XX, '名片', 'TEST 名片', false, true) returning id into v_tpl;
  insert into routing_template_steps(company_id, template_id, station_id, step_no, offset_days, is_optional) values
   (XX, v_tpl, '11111111-0000-4000-8000-000000000001', 1, 3, false),
   (XX, v_tpl, '11111111-0000-4000-8000-000000000002', 2, 2, false),
   (XX, v_tpl, '11111111-0000-4000-8000-000000000003', 3, 1, false);
  insert into _v values ('tpl', v_tpl::text);
end $setup$;

do $tests$
declare
  XX uuid := '95755162-5905-469c-8158-8cbcc1bdb2e9';
  YR uuid := '85da97b0-5c59-4c35-bc77-5fe8020bbaf3';
  V_YR uuid := 'e65ba8b6-e285-4eb7-ac6a-2fa6a5c7b64b';      -- 祥興廠商「沂融企業社」(已綁定)
  V_NET30 uuid := '33333333-0000-4000-8000-000000000001';   -- 永豐紙業 net30
  V_CASH uuid := '33333333-0000-4000-8000-000000000002';    -- 東洋油墨行 cash
  CUST uuid := '22222222-0000-4000-8000-000000000001';
  uO uuid; uXM uuid; uXS uuid; uXS2 uuid; uYM uuid; uYS uuid;
  eXS uuid; eXS2 uuid; eXM uuid;
  v_tpl uuid; o1 uuid; o2 uuid; t1 uuid; t2 uuid; t3 uuid; t2b uuid;
  v_res jsonb; v_link uuid; v_link2 uuid; v_yr_order uuid;
  v_n int; v_n2 int; v_txt text; v_ok boolean; v_date date; v_due date;
  p1 uuid; p2 uuid; pay1 uuid; pay2 uuid; pay3 uuid; v_pay uuid; v_code text; v_code2 text;
  r record;
begin
  select v::uuid into uO from _v where k='uid_O';   select v::uuid into uXM from _v where k='uid_XM';
  select v::uuid into uXS from _v where k='uid_XS'; select v::uuid into uXS2 from _v where k='uid_XS2';
  select v::uuid into uYM from _v where k='uid_YM'; select v::uuid into uYS from _v where k='uid_YS';
  select v::uuid into eXS from _v where k='emp_TXS_XX'; select v::uuid into eXS2 from _v where k='emp_TXS2_XX';
  select v::uuid into eXM from _v where k='emp_TXM_XX'; select v::uuid into v_tpl from _v where k='tpl';

  perform set_config('request.jwt.claims', json_build_object('sub', uXM, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into orders(company_id, customer_id, item_name, qty, unit, amount_total, due_date, status, routing_template_id)
  values (XX, CUST, 'TEST 名片', 2, '盒', 1500, current_date + 10, 'active', v_tpl) returning id into o1;
  select count(*) into v_n from order_tasks where order_id = o1;
  insert into _t(grp,test,expect,actual,pass) values ('S2','建立訂單自動展開工序','3 道', v_n||' 道', v_n = 3);
  select due_at::date into v_due from order_tasks where order_id = o1 and step_no = 1;
  insert into _t(grp,test,expect,actual,pass) values ('S2','第 1 道工序交期倒推（交期前 3 天）', (current_date+7)::text, v_due::text, v_due = current_date + 7);
  select order_no into v_txt from orders where id = o1;
  insert into _t(grp,test,expect,actual,pass) values ('S2','單號自動產生', '有單號', coalesce(v_txt,'(空)'), v_txt is not null);
  for i in 1..20 loop
    insert into orders(company_id, customer_id, item_name, status) values (XX, CUST, 'TEST 併發 ' || i, 'draft');
  end loop;
  select count(*), count(distinct order_no) into v_n, v_n2 from orders where item_name like 'TEST 併發%';
  insert into _t(grp,test,expect,actual,pass) values ('S2','連建 20 張單號不重複','20/20', v_n2||'/'||v_n, v_n = 20 and v_n2 = 20);
  insert into orders(company_id, customer_id, item_name, qty, amount_total, due_date, status, routing_template_id)
  values (XX, CUST, 'TEST 第二張', 1, 800, current_date + 5, 'active', v_tpl) returning id into o2;
  select id into t1 from order_tasks where order_id = o1 and step_no = 1;
  select id into t2 from order_tasks where order_id = o1 and step_no = 2;
  select id into t3 from order_tasks where order_id = o1 and step_no = 3;
  select id into t2b from order_tasks where order_id = o2 and step_no = 3;

  perform public.task_assign(t1, eXS);
  select status into v_txt from order_tasks where id = t1;
  insert into _t(grp,test,expect,actual,pass) values ('S3','主管指派工序','assigned', v_txt, v_txt = 'assigned');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uXS, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.task_start(t1);
  begin
    perform public.task_block(t1, '');
    insert into _t(grp,test,expect,actual,pass) values ('S3','卡關不填原因','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S3','卡關不填原因','擋下','擋下：'||left(sqlerrm,40), true);
  end;
  perform public.task_block(t1, '客戶未給稿');
  perform public.task_start(t1);
  perform public.task_done(t1);
  select status into v_txt from order_tasks where id = t1;
  insert into _t(grp,test,expect,actual,pass) values ('S3','員工 開始→卡關→繼續→完成','done', v_txt, v_txt = 'done');
  select count(*) into v_n from order_task_logs where order_task_id = t1 and changed_by is not null;
  insert into _t(grp,test,expect,actual,pass) values ('S3','工序異動紀錄含操作人','≥ 4 筆', v_n||' 筆', v_n >= 4);
  begin
    perform public.task_start(t2);
    insert into _t(grp,test,expect,actual,pass) values ('S3','員工開始非自己的工序','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S3','員工開始非自己的工序','擋下','擋下：'||left(sqlerrm,40), true);
  end;
  update order_tasks set note = 'hack' where id = t2;
  get diagnostics v_n = row_count;
  insert into _t(grp,test,expect,actual,pass) values ('A6','員工直接改非自己負責的工序','0 列', v_n||' 列', v_n = 0);
  select count(*) into v_n from payables;
  insert into _t(grp,test,expect,actual,pass) values ('A4','祥興員工查應付','0 筆', v_n||' 筆', v_n = 0);
  update user_company_context set current_company_id = YR where user_id = uXS;
  get diagnostics v_n = row_count;
  select public.current_company_id() = XX into v_ok;
  insert into _t(grp,test,expect,actual,pass) values ('A7','員工直接改公司切換表','仍在祥興', case when v_ok then '仍在祥興（更新 '||v_n||' 列）' else '被切到沂融' end, v_ok);
  begin
    perform public.switch_company(YR);
    select public.current_company_id() = XX into v_ok;
    insert into _t(grp,test,expect,actual,pass) values ('A7','員工呼叫 switch_company 切到沂融','擋下', case when v_ok then '未切換' else '切換成功' end, v_ok);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('A7','員工呼叫 switch_company 切到沂融','擋下','擋下：'||left(sqlerrm,40), true);
  end;
  begin
    execute 'select line_bind_code from employees limit 1';
    insert into _t(grp,test,expect,actual,pass) values ('S8','員工讀同事的 LINE 綁定碼','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S8','員工讀同事的 LINE 綁定碼','擋下','擋下', true);
  end;
  select count(*) into v_n from public.get_line_bind_status();
  insert into _t(grp,test,expect,actual,pass) values ('S8','員工查綁定狀態只看到自己','1 筆', v_n||' 筆', v_n = 1);
  v_res := public.clock_in(24.0, 120.5);
  insert into _t(grp,test,expect,actual,pass) values ('S6','店內打卡','正常、距離 0m', (v_res->>'distance_m')||'m 異常='||(v_res->>'is_abnormal'), (v_res->>'is_abnormal')::boolean = false);
  v_res := public.clock_out(24.0, 120.5);
  insert into _t(grp,test,expect,actual,pass) values ('S6','下班打卡','成功', coalesce(v_res->>'success', v_res::text), coalesce((v_res->>'success')::boolean, true));
  insert into attendance_amendments(company_id, employee_id, request_type, request_time, reason)
  values (XX, eXS, 'clock_in', now() - interval '1 day', 'TEST 忘記打卡');
  insert into _t(grp,test,expect,actual,pass) values ('S6','員工申請補卡','成功','成功', true);
  begin
    insert into attendance_amendments(company_id, employee_id, request_type, request_time, reason)
    values (XX, eXS2, 'clock_in', now(), 'TEST 冒名');
    insert into _t(grp,test,expect,actual,pass) values ('S6','員工替別人申請補卡','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S6','員工替別人申請補卡','擋下','擋下', true);
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uXS2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.clock_in(24.01, 120.5);
  insert into _t(grp,test,expect,actual,pass) values ('S6','店外約 1km 打卡','標記異常', (v_res->>'distance_m')||'m 異常='||(v_res->>'is_abnormal'), (v_res->>'is_abnormal')::boolean);
  select count(*) into v_n from attendances where employee_id <> eXS2;
  insert into _t(grp,test,expect,actual,pass) values ('A5','員工查他人出勤','0 筆', v_n||' 筆', v_n = 0);
  execute 'reset role';
  select count(*) into v_n from notifications where rule_code = 'abnormal_location' and created_at > now() - interval '1 minute';
  insert into _t(grp,test,expect,actual,pass) values ('S6','異地打卡通知主管','有通知', v_n||' 則', v_n > 0);

  perform set_config('request.jwt.claims', json_build_object('sub', uXM, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select status into v_txt from attendance_amendments where reason = 'TEST 忘記打卡';
  select id into v_pay from attendance_amendments where reason = 'TEST 忘記打卡';
  perform public.approve_amendment(v_pay, true, 'ok');
  select status into v_txt from attendance_amendments where id = v_pay;
  insert into _t(grp,test,expect,actual,pass) values ('S6','主管核准補卡','approved', v_txt, v_txt = 'approved');
  select count(*) into v_n from attendances;
  insert into _t(grp,test,expect,actual,pass) values ('S6','主管看得到全公司出勤','≥ 2 筆', v_n||' 筆', v_n >= 2);

  begin
    update order_tasks set status = 'outsourced' where id = t2;
    insert into _t(grp,test,expect,actual,pass) values ('C3','直接把工序改成外包中（繞過派外包）','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C3','直接把工序改成外包中（繞過派外包）','擋下','擋下', true);
  end;
  begin
    v_res := public.dispatch_outsource(t3, V_YR, 2000, current_date + 6, 'TEST 外包');
    v_link := (v_res->>'link_id')::uuid; v_yr_order := (v_res->>'to_order_id')::uuid;
    insert into _t(grp,test,expect,actual,pass) values ('S4','祥興派外包給沂融','沂融自動建單並展開工序', '沂融工序 '||(v_res->>'task_count')||' 道', (v_res->>'task_count')::int > 0);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S4','祥興派外包給沂融','成功','錯誤：'||sqlerrm, false);
  end;
  execute 'reset role';
  select count(*) into v_n from notifications n join employees e on e.id = n.employee_id
   where n.rule_code = 'outsource_dispatched' and e.company_id = YR and n.created_at > now() - interval '1 minute';
  insert into _t(grp,test,expect,actual,pass) values ('S4','派外包時通知沂融主管','有通知', v_n||' 則', v_n > 0);
  execute 'set local role authenticated';
  select status into v_txt from order_tasks where id = t3;
  insert into _t(grp,test,expect,actual,pass) values ('S4','祥興端工序轉外包中','outsourced', v_txt, v_txt = 'outsourced');
  v_res := public.dispatch_outsource(t2b, V_YR, 600, current_date + 4, 'TEST 外包2');
  v_link2 := (v_res->>'link_id')::uuid;
  begin
    perform public.allocate_payment(YR, V_CASH, current_date, 'cash', 1, '[{"payable_id":"00000000-0000-0000-0000-000000000000","amount":1}]'::jsonb);
    insert into _t(grp,test,expect,actual,pass) values ('C2','祥興主管替沂融建付款','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C2','祥興主管替沂融建付款','擋下','擋下：'||left(sqlerrm,40), true);
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uYS, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from orders where id = o1;
  insert into _t(grp,test,expect,actual,pass) values ('A1','沂融員工用祥興訂單 id 查詢','0 筆（不洩漏）', v_n||' 筆', v_n = 0);
  select count(*) into v_n from orders where company_id = XX;
  insert into _t(grp,test,expect,actual,pass) values ('U6','沂融員工查祥興全部訂單','0 筆', v_n||' 筆', v_n = 0);
  select count(*) into v_n from customers where company_id = XX;
  insert into _t(grp,test,expect,actual,pass) values ('S4','沂融看不到祥興的終端客戶','0 筆', v_n||' 筆', v_n = 0);
  select c.name into v_txt from orders o join customers c on c.id = o.customer_id where o.id = v_yr_order;
  insert into _t(grp,test,expect,actual,pass) values ('S4','沂融工單客戶顯示為祥興','祥興…', coalesce(v_txt,'(看不到)'), v_txt like '祥興%');
  select amount_total is null or amount_total = 0 into v_ok from orders where id = v_yr_order;
  insert into _t(grp,test,expect,actual,pass) values ('S4','沂融工單不帶祥興售價','無售價', case when v_ok then '無' else '有售價' end, coalesce(v_ok, false));
  begin
    insert into customers(company_id, customer_code, name) values (XX, 'HACK', 'TEST 越權');
    insert into _t(grp,test,expect,actual,pass) values ('A2','沂融員工寫入祥興資料','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('A2','沂融員工寫入祥興資料','擋下','擋下', true);
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uYM, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reject_outsource(v_link2, 'TEST 產能不足');
  for r in select id from order_tasks where order_id = v_yr_order order by step_no loop
    perform public.task_start(r.id);
    perform public.task_done(r.id);
  end loop;
  select count(*) into v_n from payables;
  insert into _t(grp,test,expect,actual,pass) values ('A3','沂融主管查應付不含祥興','0 筆祥興', v_n||' 筆（沂融本身）', not exists(select 1 from payables where company_id = XX));
  execute 'reset role';

  select status into v_txt from order_tasks where id = t2b;
  insert into _t(grp,test,expect,actual,pass) values ('S4','沂融拒接 → 祥興工序退回','pending', v_txt, v_txt = 'pending');
  select count(*) into v_n from notifications n join employees e on e.id = n.employee_id
   where n.rule_code = 'outsource_rejected' and e.company_id = XX and n.created_at > now() - interval '1 minute';
  insert into _t(grp,test,expect,actual,pass) values ('S4','拒接通知祥興','有通知', v_n||' 則', v_n > 0);
  select status into v_txt from order_tasks where id = t3;
  insert into _t(grp,test,expect,actual,pass) values ('S4','沂融完工 → 祥興工序自動完成','done', v_txt, v_txt = 'done');
  select p.amount::text || ' / ' || r2.amount::text, p.amount = r2.amount into v_txt, v_ok
    from cross_company_links l join payables p on p.id = l.payable_id join receivables r2 on r2.id = l.receivable_id where l.id = v_link;
  insert into _t(grp,test,expect,actual,pass) values ('S4','祥興應付 = 沂融應收','2000 / 2000', coalesce(v_txt,'(沒產生)'), coalesce(v_ok,false));
  select count(*) into v_n from cross_company_events where link_id in (v_link, v_link2);
  insert into _t(grp,test,expect,actual,pass) values ('S4','跨公司事件完整記錄','≥ 4 筆', v_n||' 筆', v_n >= 4);

  perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*), bool_or(amount_mismatch) into v_n, v_ok from group_reconciliation where link_id = v_link;
  insert into _t(grp,test,expect,actual,pass) values ('S4','集團對帳表（老闆）','1 筆、金額一致', v_n||' 筆、不一致='||coalesce(v_ok::text,'-'), v_n = 1 and not coalesce(v_ok,true));
  perform public.switch_company(YR);
  select count(*) into v_n from orders;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uYM, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n2 from orders;
  select count(*) into v_txt from group_reconciliation;
  insert into _t(grp,test,expect,actual,pass) values ('A8','老闆切到沂融後的訂單數 = 沂融主管看到的','相同', v_n||' / '||v_n2, v_n = v_n2);
  insert into _t(grp,test,expect,actual,pass) values ('S4','非老闆看集團對帳','0 筆', v_txt||' 筆', v_txt = '0');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uXM, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from order_costs where order_id = o1;
  insert into purchases(company_id, purchase_no, vendor_id, purchase_date, source_type, related_order_id, amount_untaxed, tax_amount, amount_total, status)
  values (XX, 'TEST-PO-1', V_NET30, current_date, 'direct', o1, 952, 48, 1000, 'draft') returning id into p1;
  insert into purchase_items(company_id, purchase_id, item_name, qty, unit, unit_price) values (XX, p1, 'TEST 紙', 1, '令', 952);
  select amount_total into v_n2 from purchases where id = p1;
  insert into _t(grp,test,expect,actual,pass) values ('N','進貨金額由明細計算（952＋5%）','1000', v_n2::text, v_n2 = 1000);
  perform public.confirm_purchase(p1);
  select due_date into v_due from payables where purchase_id = p1;
  insert into _t(grp,test,expect,actual,pass) values ('S5','進貨確認產生應付、net30 到期日', (current_date+30)::text, coalesce(v_due::text,'(沒產生)'), v_due = current_date + 30);
  select count(*) into v_n2 from order_costs where order_id = o1;
  insert into _t(grp,test,expect,actual,pass) values ('S5','direct 進貨掛到工單成本','+1 筆', (v_n2 - v_n)||' 筆', v_n2 - v_n = 1);
  insert into purchases(company_id, purchase_no, vendor_id, purchase_date, source_type, amount_untaxed, tax_amount, amount_total, status)
  values (XX, 'TEST-PO-2', V_CASH, current_date, 'stock', 476, 24, 500, 'draft') returning id into p2;
  insert into purchase_items(company_id, purchase_id, item_name, spec, qty, unit, unit_price) values (XX, p2, 'TEST 銅版紙', 'A4 150g', 10, '包', 47.6);
  select count(*) into v_n from order_costs;
  perform public.confirm_purchase(p2);
  select count(*) into v_n2 from order_costs;
  select due_date into v_due from payables where purchase_id = p2;
  insert into _t(grp,test,expect,actual,pass) values ('S5','stock 進貨不產生工單成本、cash 當天到期','成本 +0、'||current_date, '成本 +'||(v_n2-v_n)||'、'||v_due, v_n2 = v_n and v_due = current_date);
  select id into pay1 from payables where purchase_id = p1;
  select id into pay2 from payables where purchase_id = p2;
  select payable_id into pay3 from cross_company_links where id = v_link;
  -- 028：沖帳只能沖同一家廠商的應付
  begin
    perform public.allocate_payment(XX, V_NET30, current_date, 'transfer', 1500,
      jsonb_build_array(jsonb_build_object('payable_id', pay1, 'amount', 1000),
                        jsonb_build_object('payable_id', pay2, 'amount', 500)));
    insert into _t(grp,test,expect,actual,pass) values ('S5','付款沖到別家廠商的應付','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S5','付款沖到別家廠商的應付','擋下','擋下：'||left(sqlerrm,30), true);
  end;
  begin
    -- 實付 600 ＋折讓 400 沖掉 1000
    v_res := public.allocate_payment(XX, V_NET30, current_date, 'transfer', 600,
      jsonb_build_array(jsonb_build_object('payable_id', pay1, 'amount', 1000)), null, null, null, null, null, 0, 400);
    v_pay := (v_res->>'payment_id')::uuid;
    select status into v_txt from payables where id = pay1;
    insert into _t(grp,test,expect,actual,pass) values ('S5','實付＋折讓沖清應付','paid', v_txt, v_txt = 'paid');
    perform public.void_payment(v_pay);
    select status || '/' || (select count(*) from payment_allocations where payment_id = v_pay and voided_at is not null)
      into v_txt from payables where id = pay1;
    insert into _t(grp,test,expect,actual,pass) values ('S5','付款作廢自動反沖、保留明細','unpaid/1', v_txt, v_txt = 'unpaid/1');
    -- 預付 800 不沖 → 之後沖 pay2（500）→ 未沖剩 300
    v_res := public.allocate_payment(XX, V_CASH, current_date, 'cash', 800, '[]'::jsonb);
    v_pay := (v_res->>'payment_id')::uuid;
    v_res := public.apply_payment(v_pay, jsonb_build_array(jsonb_build_object('payable_id', pay2, 'amount', 500)));
    select status || '/' || (v_res->>'unallocated')::numeric::int into v_txt from payables where id = pay2;
    insert into _t(grp,test,expect,actual,pass) values ('S5','預付款之後再沖帳','paid/300', v_txt, v_txt = 'paid/300');
    -- 沖銷 pay3 的 100
    perform public.void_payment(v_pay);  -- 還原，後面的測試要用未付的 pay2
    v_res := public.write_off_payable(pay3, 100, 'TEST 尾差');
    select status into v_txt from payables where id = pay3;
    insert into _t(grp,test,expect,actual,pass) values ('S5','沖銷部分應付','partial', v_txt, v_txt = 'partial');
    perform public.void_payment((v_res->>'payment_id')::uuid);  -- 還原，後面要調整外包金額
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S5','付款沖帳','成功','錯誤：'||sqlerrm, false);
  end;
  begin
    update payables set paid_amount = 0 where id = pay1;
    insert into _t(grp,test,expect,actual,pass) values ('S5','主管直接改應付已付金額','擋下','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S5','主管直接改應付已付金額','擋下','擋下', true);
  end;
  begin
    perform public.update_notification_rule((select id from notification_rules where company_id = XX and rule_code = 'task_overdue'), null::boolean, null::boolean, null::boolean, 'digest'::text, null::text[]);
    insert into _t(grp,test,expect,actual,pass) values ('S7','主管調整通知規則','成功','成功', true);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('S7','主管調整通知規則','成功','錯誤：'||left(sqlerrm,60), false);
  end;
  select count(*) into v_n from public.get_line_bind_status();
  insert into _t(grp,test,expect,actual,pass) values ('S8','主管查綁定狀態看到全公司','≥ 4 筆', v_n||' 筆', v_n >= 4);
  execute 'reset role';

  select bool_and(ok) into v_ok from (values
    (public.calc_due_date('cash', date '2026-10-16') = date '2026-10-16'),
    (public.calc_due_date('net30', date '2026-10-16') = date '2026-11-15'),
    (public.calc_due_date('net60', date '2026-10-16') = date '2026-12-15'),
    (public.calc_due_date('net90', date '2026-10-16') = date '2027-01-14'),
    (public.calc_due_date('monthly_15', date '2026-10-16') = date '2026-11-15'),
    (public.calc_due_date('monthly_end', date '2026-10-16') = date '2026-11-30')) t(ok);
  insert into _t(grp,test,expect,actual,pass) values ('S5','六種付款條件到期日推算','全對', case when v_ok then '全對' else '有誤' end, v_ok);

  update order_tasks set due_at = current_date - 2 where id = t2;
  v_n := public.notify_scan_all();
  select count(*) into v_n2 from notifications where rule_code = 'task_overdue' and ref_id = t2;
  insert into _t(grp,test,expect,actual,pass) values ('S7','逾期工序掃描產生通知','有通知', v_n2||' 則', v_n2 > 0);

  select line_bind_code into v_code from employees where id = eXS;
  select line_bind_code into v_code2 from employees where id = eXS2;
  v_res := to_jsonb(public.bind_line_account(v_code, 'U_TEST_ONLY_0001'));
  select line_user_id is not null into v_ok from employees where id = eXS;
  insert into _t(grp,test,expect,actual,pass) values ('S8','員工傳綁定碼完成綁定','已綁定', case when v_ok then '已綁定' else coalesce(v_res::text,'失敗') end, v_ok);
  v_res := to_jsonb(public.bind_line_account(v_code2, 'U_TEST_ONLY_0001'));
  select line_user_id is null into v_ok from employees where id = eXS2;
  insert into _t(grp,test,expect,actual,pass) values ('S8','同一個 LINE 綁第二位員工','拒絕', case when v_ok then '拒絕' else '被綁上' end, v_ok);

  -- ================= 019/020 新功能 =================
  declare
    P_CARD uuid := '66666666-0000-4000-8000-000000000001';  -- 祥興產品「名片」
    o3 uuid; o4 uuid; v_dn uuid; q1 uuid; v_inv uuid; v_num numeric; v_num2 numeric; tk record;
  begin
    -- 前面外包 RPC 設的 app.task_rpc 旗標在同一交易內會延續，正式環境每個請求各自一個交易，這裡手動清掉
    perform set_config('app.task_rpc', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uXM, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    -- 訂單：產品預設範本自動展開 8 道、金額由 DB 計算
    insert into orders(company_id, customer_id, product_id, item_name, qty, unit, amount_untaxed, tax_amount, due_date, status)
    values (XX, CUST, P_CARD, 'TEST 新流程名片', 5, '盒', 1000, null, current_date + 10, 'active') returning id into o3;
    select count(*) into v_n from order_tasks where order_id = o3;
    insert into _t(grp,test,expect,actual,pass) values ('N','訂單未選範本→依產品預設範本展開（030 起預設三步）','3 道', v_n||' 道', v_n = 3);
    select amount_total into v_num from orders where id = o3;
    insert into _t(grp,test,expect,actual,pass) values ('N','訂單含稅金額由 DB 計算（1000＋5%）','1050', v_num::text, v_num = 1050);

    begin
      update orders set status = 'void' where id = o3;
      insert into _t(grp,test,expect,actual,pass) values ('N','前端直接改訂單狀態','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','前端直接改訂單狀態','擋下','擋下', true);
    end;
    insert into orders(company_id, customer_id, product_id, item_name, qty, amount_untaxed, tax_amount, due_date, status)
    values (XX, CUST, P_CARD, 'TEST 草稿', 1, 500, 25, current_date + 7, 'draft') returning id into o4;
    perform public.set_order_status(o4, 'active');
    select count(*) into v_n from order_tasks where order_id = o4;
    insert into _t(grp,test,expect,actual,pass) values ('N','set_order_status 草稿→確認並展開工序','active／3 道',
      (select status from orders where id = o4)||'／'||v_n||' 道', v_n = 3);
    begin
      perform public.set_order_status(o4, 'closed');
      insert into _t(grp,test,expect,actual,pass) values ('N','不合法狀態轉換 active→closed','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','不合法狀態轉換 active→closed','擋下','擋下', true);
    end;

    -- 出貨單
    begin
      perform public.create_delivery_note(o3, null, null, null, null);
      insert into _t(grp,test,expect,actual,pass) values ('N','工序未完成就開出貨單','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','工序未完成就開出貨單','擋下','擋下', true);
    end;
    for tk in select t.id from order_tasks t join work_stations w on w.id = t.station_id
               where t.order_id = o3 and w.code <> 'SHIP' order by t.step_no loop
      perform public.task_start(tk.id);
      perform public.task_done(tk.id);
    end loop;
    v_res := public.create_delivery_note(o3, current_date, '王小姐', null, 'TEST');
    v_dn := (v_res->>'delivery_id')::uuid;
    select status into v_txt from orders where id = o3;
    insert into _t(grp,test,expect,actual,pass) values ('N','開出貨單→訂單轉已出貨', 'shipped', v_txt, v_txt = 'shipped');
    select amount, due_date into v_num, v_due from receivables where id = (v_res->>'receivable_id')::uuid;
    insert into _t(grp,test,expect,actual,pass) values ('N','出貨產生應收（金額、客戶 net30 到期）', '1050／'||(current_date+30),
      coalesce(v_num::text,'無')||'／'||coalesce(v_due::text,'無'), v_num = 1050 and v_due = current_date + 30);
    select t.status into v_txt from order_tasks t join work_stations w on w.id = t.station_id where t.order_id = o3 and w.code = 'SHIP';
    insert into _t(grp,test,expect,actual,pass) values ('N','出貨站工序自動完成','done', v_txt, v_txt = 'done');
    begin
      perform public.create_delivery_note(o3, null, null, null, null);
      insert into _t(grp,test,expect,actual,pass) values ('N','同一訂單重複開出貨單','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','同一訂單重複開出貨單','擋下','擋下', true);
    end;
    begin
      insert into delivery_notes(company_id, delivery_no, order_id) values (XX, 'HACK', o3);
      insert into _t(grp,test,expect,actual,pass) values ('N','前端直接寫出貨單表','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','前端直接寫出貨單表','擋下','擋下', true);
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', uXS, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      perform public.void_delivery_note(v_dn, 'x');
      insert into _t(grp,test,expect,actual,pass) values ('N','員工作廢出貨單','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','員工作廢出貨單','擋下','擋下', true);
    end;
    select count(*) into v_n from delivery_notes;
    insert into _t(grp,test,expect,actual,pass) values ('N','員工（無訂單權限）看出貨單','0 筆', v_n||' 筆', v_n = 0);
    begin
      perform public.inventory_issue((select id from inventory_items where company_id = XX and name = 'TEST 銅版紙'), 1, null, null);
      insert into _t(grp,test,expect,actual,pass) values ('N','員工領料（無庫存權限）','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','員工領料（無庫存權限）','擋下','擋下', true);
    end;
    begin
      insert into holidays(company_id, holiday_date, name) values (XX, date '2027-08-08', 'HACK');
      insert into _t(grp,test,expect,actual,pass) values ('N','員工新增假日','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','員工新增假日','擋下','擋下', true);
    end;
    begin
      perform public.next_doc_no(YR, 'WO');
      insert into _t(grp,test,expect,actual,pass) values ('N','替別家公司取單號','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','替別家公司取單號','擋下','擋下', true);
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', uXM, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.void_delivery_note(v_dn, 'TEST 作廢');
    select o.status || '／' || rv.status into v_txt from orders o, receivables rv
     where o.id = o3 and rv.id = (v_res->>'receivable_id')::uuid;
    insert into _t(grp,test,expect,actual,pass) values ('N','主管作廢出貨單→訂單回進行中、應收作廢','active／void', v_txt, v_txt = 'active／void');

    -- 報價單金額由 DB 計算
    insert into quotations(company_id, quote_no, customer_id, tax_type, subtotal, total)
    values (XX, 'TEST-Q-1', CUST, 'taxable', 99999, 99999) returning id into q1;
    insert into quotation_items(quotation_id, item_name, qty, unit_price, amount) values
      (q1, 'A', 2, 150, 0), (q1, 'B', 1, 700, 0);
    select subtotal::text||'/'||tax_amount||'/'||total into v_txt from quotations where id = q1;
    insert into _t(grp,test,expect,actual,pass) values ('N','報價小計／稅額／合計由明細計算','1000/50/1050', v_txt, v_txt = '1000/50/1050');

    -- 進貨確認後明細鎖定
    begin
      update purchase_items set unit_price = 1 where purchase_id = p1;
      insert into _t(grp,test,expect,actual,pass) values ('N','已確認進貨單改明細','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','已確認進貨單改明細','擋下','擋下', true);
    end;

    -- 庫存：stock 進貨入庫、領料掛成本、盤點
    select id, qty_on_hand, avg_cost into v_inv, v_num, v_num2 from inventory_items where company_id = XX and name = 'TEST 銅版紙';
    insert into _t(grp,test,expect,actual,pass) values ('N','stock 進貨確認後入庫','10 包 @47.6',
      coalesce(v_num::text,'無')||' 包 @'||coalesce(v_num2::text,'-'), v_num = 10 and v_num2 = 47.6);
    select count(*) into v_n from order_costs where order_id = o1;
    perform public.inventory_issue(v_inv, 3, o1, 'TEST 領料');
    select qty_on_hand into v_num from inventory_items where id = v_inv;
    select count(*) into v_n2 from order_costs where order_id = o1 and source_type = 'inventory';
    insert into _t(grp,test,expect,actual,pass) values ('N','領料扣庫存並掛工單成本','剩 7、成本 +1',
      '剩 '||v_num||'、成本 +'||v_n2, v_num = 7 and v_n2 = 1);
    begin
      perform public.inventory_issue(v_inv, 100, null, null);
      insert into _t(grp,test,expect,actual,pass) values ('N','領料超過庫存','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','領料超過庫存','擋下','擋下', true);
    end;
    perform public.inventory_adjust(v_inv, 5, 'TEST 盤點');
    select qty_on_hand into v_num from inventory_items where id = v_inv;
    insert into _t(grp,test,expect,actual,pass) values ('N','盤點調整','5', v_num::text, v_num = 5);
    begin
      update inventory_items set qty_on_hand = 999 where id = v_inv;
      insert into _t(grp,test,expect,actual,pass) values ('N','主管直接改庫存數量','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','主管直接改庫存數量','擋下','擋下', true);
    end;

    -- 外包：完工成本、事後調整金額
    select count(*) into v_n from order_costs where source_id = v_link and cost_type = 'outsource';
    insert into _t(grp,test,expect,actual,pass) values ('N','外包完工寫入發包方工單成本','1 筆', v_n||' 筆', v_n = 1);
    perform public.adjust_outsource_amount(v_link, 2500, 'TEST 加印');
    execute 'reset role';
    select l.agreed_amount::text||'/'||p.amount||'/'||rv.amount||'/'||(select amount from order_costs where source_id = v_link and cost_type = 'outsource')
      into v_txt
      from cross_company_links l join payables p on p.id = l.payable_id join receivables rv on rv.id = l.receivable_id
     where l.id = v_link;
    insert into _t(grp,test,expect,actual,pass) values ('N','調整外包金額→連結／應付／對方應收／成本同步','2500 ×4', v_txt,
      v_txt = '2500/2500/2500/2500');
    select count(*) into v_n from cross_company_events where link_id = v_link and event = 'amount_adjust';
    insert into _t(grp,test,expect,actual,pass) values ('N','調整金額寫入跨公司事件','1 筆', v_n||' 筆', v_n = 1);
    execute 'set local role authenticated';

    -- 外部廠商一鍵建進貨單
    select t.id into tk from order_tasks t where t.order_id = o4 and t.status = 'pending' order by step_no limit 1;
    v_res := public.create_outsource_purchase(tk.id, V_NET30, 1000, null);
    select amount_total::text || '/' || status || '/' || source_type into v_txt from purchases where id = (v_res->>'purchase_id')::uuid;
    insert into _t(grp,test,expect,actual,pass) values ('N','外部廠商外包一鍵建進貨單（草稿、direct、含稅）','1050/draft/direct', v_txt, v_txt = '1050/draft/direct');
    begin
      perform public.create_outsource_purchase(tk.id, V_YR, 1000, null);
      insert into _t(grp,test,expect,actual,pass) values ('N','集團內廠商用一鍵進貨','擋下（應走派外包）','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','集團內廠商用一鍵進貨','擋下（應走派外包）','擋下', true);
    end;

    -- 集團 KPI
    begin
      perform * from public.group_kpis();
      insert into _t(grp,test,expect,actual,pass) values ('N','主管查集團 KPI','擋下','未擋', false);
    exception when others then
      insert into _t(grp,test,expect,actual,pass) values ('N','主管查集團 KPI','擋下','擋下', true);
    end;
    insert into holidays(company_id, holiday_date, name, kind) values (XX, date '2027-08-08', 'TEST 公司假', 'company');
    get diagnostics v_n = row_count;
    insert into _t(grp,test,expect,actual,pass) values ('N','主管新增假日','1 列', v_n||' 列', v_n = 1);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*), sum(wip_orders) into v_n, v_n2 from public.group_kpis();
    insert into _t(grp,test,expect,actual,pass) values ('N','老闆查集團 KPI 兩家並排','2 家', v_n||' 家（進行中工單 '||v_n2||'）', v_n = 2);
    execute 'reset role';

    -- 國定假日加班
    insert into attendances(company_id, employee_id, shift_id, work_date, clock_in_at, clock_out_at, status,
                            work_minutes, early_leave_minutes, ot_minutes_134)
    values (XX, eXS, '36a2c910-ee73-4ca3-ab6e-88a2ad392faf', date '2026-12-25',
            timestamptz '2026-12-25 09:00+08', timestamptz '2026-12-25 15:00+08', 'early_leave', 300, 180, 0);
    select ot_minutes_holiday::text || '/' || status into v_txt from attendances where employee_id = eXS and work_date = date '2026-12-25';
    insert into _t(grp,test,expect,actual,pass) values ('N','國定假日出勤→工時全列假日加班、不算早退','300/normal', v_txt, v_txt = '300/normal');
  end;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin
    select count(*) into v_n from orders;
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入讀訂單','0 筆或拒絕', v_n||' 筆', v_n = 0);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入讀訂單','0 筆或拒絕','拒絕', true);
  end;
  begin
    select count(*) into v_n from board_stats;
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入讀彙總（看板統計）','拒絕', v_n||' 筆', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入讀彙總（看板統計）','拒絕','拒絕', true);
  end;
  begin
    perform public.refresh_line_bind_code(eXS);
    insert into _t(grp,test,expect,actual,pass) values ('C2','未登入重新產生綁定碼','拒絕','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C2','未登入重新產生綁定碼','拒絕','拒絕', true);
  end;
  begin
    select count(*) into v_n from public.login_companies();
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入取登入頁公司清單','可取得', v_n||' 家', v_n = 2);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C1','未登入取登入頁公司清單','可取得','錯誤：'||left(sqlerrm,40), false);
  end;
  begin
    perform * from public.group_kpis();
    insert into _t(grp,test,expect,actual,pass) values ('C2','未登入查集團 KPI','拒絕','未擋', false);
  exception when others then
    insert into _t(grp,test,expect,actual,pass) values ('C2','未登入查集團 KPI','拒絕','拒絕', true);
  end;
  execute 'reset role';
end $tests$;

select n, grp, test, expect, actual, case when pass then '✅' else '❌' end as result from _t order by n;
rollback;
