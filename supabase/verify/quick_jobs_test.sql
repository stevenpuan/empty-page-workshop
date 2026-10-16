-- 快單（029）冒煙測試：以第一位已綁 LINE 的員工模擬 LINE 開單、派工、完成、收款；最後丟例外整筆回滾，不留資料。
-- 用法：Supabase SQL Editor 整段貼上執行，錯誤訊息裡的 ROLLBACK 後面就是結果。
do $$
declare
  XX uuid := (select id from companies where code = 'XX');
  lu text := (select line_user_id from employees where line_user_id is not null and company_id = XX limit 1);
  r jsonb; jid uuid; staff uuid; out text := ''; v text; n int;
begin
  r := public.line_quick_job_create(lu, null, '名片 2 盒', '王先生', '0912345678', now() + interval '3 hours', '預估 600 元', '快單 名片2盒 王先生', null);
  jid := (r->>'id')::uuid;
  out := out || '1 LINE 開單 ' || (r->>'job_no') || ' ' || (r->>'status') || E'\n';
  staff := (select id from employees where company_id = XX and is_active and id <> (select id from employees where line_user_id = lu) limit 1);
  r := public.line_quick_job_action(lu, 'assign', r->>'job_no', staff, null);
  out := out || '2 派工 ' || (r->>'status') || ' ' || (r->>'assignee_name') || E'\n';
  select string_agg(rule_code, ',') into v from notifications where ref_id = jid;
  out := out || '  通知 ' || coalesce(v, '') || E'\n';
  r := public.line_quick_job_action(lu, 'done', right(r->>'job_no', 7), null, null);
  out := out || '3 完成 ' || (r->>'status') || E'\n';
  r := public.line_quick_job_pickup(lu, r->>'job_no', 650, 'cash', null);
  select status || '/' || received_amount || '/' || source_type into v from receivables
   where id = (select receivable_id from quick_jobs where id = jid);
  out := out || '4 收現 650 → 應收 ' || v || E'\n';
  r := public.line_quick_job_create(lu, null, '海報 1 張', '李小姐', null, null, null, null, null);
  r := public.line_quick_job_pickup(lu, r->>'job_no', 350, 'unpaid', '12345678');
  select status || '/' || received_amount into v from receivables
   where id = (select receivable_id from quick_jobs where id = (r->>'id')::uuid);
  out := out || '5 未收 350 → 應收 ' || v || E'\n';
  begin
    perform public.line_quick_job_create('U-not-bound', null, 'x', null, null, null, null, null, null);
    out := out || '6 未綁定 LINE：未擋（錯誤）' || E'\n';
  exception when others then out := out || '6 未綁定 LINE：擋下' || E'\n'; end;
  raise exception 'ROLLBACK%', E'\n' || out;
end $$;
