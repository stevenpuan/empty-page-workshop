-- ============================================================
-- 011_notification_engine.sql  —  S7 通知引擎
-- 17 sections (final)
-- ============================================================

-- ======================== Section 1 ========================
-- Enable pg_net extension (async HTTP from DB)
-- ============================================================
create extension if not exists pg_net with schema extensions;

-- ======================== Section 2 ========================
-- Update notification_rules: fill template_title / template_body
-- ============================================================
update notification_rules set template_title = '工序逾期',
  template_body = '{{order_no}} 的工序「{{station}}」已逾期（到期：{{due_date}}），負責人：{{assignee}}'
where rule_code = 'task_overdue' and template_title is null;

update notification_rules set template_title = '工序卡關過久',
  template_body = '{{order_no}} 的工序「{{station}}」已卡關超過 1 天，原因：{{reason}}'
where rule_code = 'task_blocked' and template_title is null;

update notification_rules set template_title = '校稿久候',
  template_body = '{{order_no}} 的工序「{{station}}」等待客戶回覆已超過 3 天'
where rule_code = 'task_waiting_customer' and template_title is null;

update notification_rules set template_title = '外包逾期未收回',
  template_body = '{{order_no}} 的外包工序「{{station}}」已逾期（外包到期：{{due_date}}），外包商：{{vendor}}'
where rule_code = 'outsource_overdue' and template_title is null;

update notification_rules set template_title = '收到跨公司發包',
  template_body = '{{from_company}} 發包工序「{{station}}」（訂單 {{order_no}}），請確認接單'
where rule_code = 'outsource_dispatched' and template_title is null;

update notification_rules set template_title = '外包被拒接',
  template_body = '{{order_no}} 的外包工序「{{station}}」被對方拒接，請重新安排'
where rule_code = 'outsource_rejected' and template_title is null;

update notification_rules set template_title = '外包完成回寫',
  template_body = '{{order_no}} 的外包工序「{{station}}」已完成，外包商回報完工'
where rule_code = 'outsource_completed' and template_title is null;

update notification_rules set template_title = '應付到期提醒',
  template_body = '應付帳款 {{doc_no}} 將於 {{due_date}} 到期，餘額 ${{balance}}'
where rule_code = 'payable_due_soon' and template_title is null;

update notification_rules set template_title = '應付逾期',
  template_body = '應付帳款 {{doc_no}} 已逾期（到期：{{due_date}}），餘額 ${{balance}}'
where rule_code = 'payable_overdue' and template_title is null;

update notification_rules set template_title = '月結請款提醒',
  template_body = '應收帳款 {{doc_no}} 將於 {{due_date}} 到期，餘額 ${{balance}}'
where rule_code = 'receivable_due_soon' and template_title is null;

update notification_rules set template_title = '逾期未收款',
  template_body = '應收帳款 {{doc_no}} 已逾期（到期：{{due_date}}），餘額 ${{balance}}'
where rule_code = 'receivable_overdue' and template_title is null;

update notification_rules set template_title = '未打上班卡',
  template_body = '{{employee_name}} 今日尚未打上班卡（班別 {{shift_name}} 開始：{{start_time}}）'
where rule_code = 'clock_in_missing' and template_title is null;

update notification_rules set template_title = '異地打卡',
  template_body = '{{employee_name}} 打卡位置異常（距離 {{distance}}m），原因：{{reason}}'
where rule_code = 'abnormal_location' and template_title is null;

update notification_rules set template_title = '簽核逾時',
  template_body = '{{employee_name}} 的補卡申請已超過 24 小時未審核'
where rule_code = 'approval_pending' and template_title is null;

update notification_rules set template_title = '帳號已建立',
  template_body = '新員工 {{employee_name}}（{{emp_no}}）帳號已建立'
where rule_code = 'account_created' and template_title is null;

update notification_rules set template_title = '系統異常通知',
  template_body = '{{message}}'
where rule_code = 'system_alert' and template_title is null;

-- ======================== Section 3 ========================
-- Helper: call_edge_function — pg_net POST to Edge Function
-- ============================================================
create or replace function call_edge_function(
  p_fn_name text,
  p_body    jsonb
) returns bigint
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_url text;
  v_key text;
begin
  v_url := 'https://sfpjbimwmhqpywjsfhgl.supabase.co/functions/v1/' || p_fn_name;
  -- Use INTERNAL_PUSH_KEY from vault; fallback to service_role key
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'INTERNAL_PUSH_KEY';
  if v_key is null then
    v_key := current_setting('app.settings.service_role_key', true);
  end if;
  return net.http_post(
    url     := v_url,
    body    := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_key, '')
    )
  );
exception when others then
  -- Log but don't fail the caller
  insert into error_logs (level, message, context, route)
  values ('warn', 'call_edge_function failed: ' || sqlerrm,
          jsonb_build_object('fn', p_fn_name, 'body', p_body), 'notification');
  return null;
end;
$$;

-- ======================== Section 4 ========================
-- Update emit_notification: after insert, queue LINE push for immediate
-- We add a AFTER INSERT trigger on notifications for line push
-- ============================================================
create or replace function trg_line_push_immediate()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_line_user_id text;
  v_channel_key  text;
begin
  -- Only fire for immediate pending
  if new.line_status <> 'pending' then return new; end if;

  select e.line_user_id, c.line_channel_key
    into v_line_user_id, v_channel_key
    from employees e
    join companies c on c.id = e.company_id
   where e.id = new.employee_id;

  -- Skip if no LINE binding
  if v_line_user_id is null or v_channel_key is null then return new; end if;

  perform call_edge_function('line-push', jsonb_build_object(
    'notification_id', new.id,
    'line_user_id',    v_line_user_id,
    'channel_key',     v_channel_key,
    'title',           new.title,
    'body',            new.body
  ));

  return new;
end;
$$;

drop trigger if exists trg_notifications_line_push on notifications;
create trigger trg_notifications_line_push
  after insert on notifications
  for each row
  when (new.line_status = 'pending')
  execute function trg_line_push_immediate();

-- ======================== Section 5 ========================
-- notify_scan_all() — master scan function (11 scan rules)
-- Called by pg_cron every 5 minutes
-- ============================================================
create or replace function notify_scan_all()
returns int
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_total int := 0;
  v_n     int;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_now   timestamptz := now();
  rec     record;
begin
  -- ---- 1. task_overdue ----
  -- order_tasks where due_at < today and status not in (done, skipped)
  for rec in
    select t.company_id, t.id as task_id, t.assignee_id,
           o.order_no,
           s.name as station_name,
           t.due_at::text as due_date,
           e.name as assignee_name
      from order_tasks t
      join orders o on o.id = t.order_id
      join work_stations s on s.id = t.station_id
      left join employees e on e.id = t.assignee_id
     where t.due_at < v_today
       and t.status not in ('done','skipped')
  loop
    select emit_notification(
      rec.company_id, 'task_overdue', 'order_task', rec.task_id,
      rec.assignee_id,
      '工序逾期',
      rec.order_no || ' 的工序「' || rec.station_name || '」已逾期（到期：' || rec.due_date || '），負責人：' || coalesce(rec.assignee_name, '-')
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 2. task_blocked ----
  -- order_tasks blocked for > 1 day
  for rec in
    select t.company_id, t.id as task_id, t.assignee_id,
           o.order_no,
           s.name as station_name,
           coalesce(t.blocked_reason, '-') as reason
      from order_tasks t
      join orders o on o.id = t.order_id
      join work_stations s on s.id = t.station_id
     where t.status = 'blocked'
       and t.updated_at < v_now - interval '1 day'
  loop
    select emit_notification(
      rec.company_id, 'task_blocked', 'order_task', rec.task_id,
      rec.assignee_id,
      '工序卡關過久',
      rec.order_no || ' 的工序「' || rec.station_name || '」已卡關超過 1 天，原因：' || rec.reason
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 3. task_waiting_customer ----
  -- order_tasks waiting_customer > 3 days
  for rec in
    select t.company_id, t.id as task_id, t.assignee_id,
           o.order_no,
           s.name as station_name
      from order_tasks t
      join orders o on o.id = t.order_id
      join work_stations s on s.id = t.station_id
     where t.status = 'waiting_customer'
       and t.updated_at < v_now - interval '3 days'
  loop
    select emit_notification(
      rec.company_id, 'task_waiting_customer', 'order_task', rec.task_id,
      rec.assignee_id,
      '校稿久候',
      rec.order_no || ' 的工序「' || rec.station_name || '」等待客戶回覆已超過 3 天'
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 4. outsource_overdue ----
  -- outsourced tasks past outsource_due_at
  for rec in
    select t.company_id, t.id as task_id, t.assignee_id,
           o.order_no,
           s.name as station_name,
           t.outsource_due_at::text as due_date,
           v.name as vendor_name
      from order_tasks t
      join orders o on o.id = t.order_id
      join work_stations s on s.id = t.station_id
      left join vendors v on v.id = t.vendor_id
     where t.is_outsource = true
       and t.outsource_due_at < v_today
       and t.status not in ('done','skipped')
  loop
    select emit_notification(
      rec.company_id, 'outsource_overdue', 'order_task', rec.task_id,
      rec.assignee_id,
      '外包逾期未收回',
      rec.order_no || ' 的外包工序「' || rec.station_name || '」已逾期（外包到期：' || rec.due_date || '），外包商：' || coalesce(rec.vendor_name, '-'),
      null, null
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 5. payable_due_soon ----
  -- payables due within 3 days, balance > 0
  for rec in
    select p.company_id, p.id as payable_id, p.doc_no,
           p.due_date::text as due_date,
           p.balance::text as balance_text
      from payables p
     where p.due_date between v_today and v_today + 3
       and p.balance > 0
       and p.status <> 'paid'
  loop
    select emit_notification(
      rec.company_id, 'payable_due_soon', 'payable', rec.payable_id,
      null,
      '應付到期提醒',
      '應付帳款 ' || rec.doc_no || ' 將於 ' || rec.due_date || ' 到期，餘額 $' || rec.balance_text,
      'once'  -- dedupe_suffix = 'once' → fires only once per ref
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 6. payable_overdue ----
  -- payables past due, balance > 0, every 5 days
  for rec in
    select p.company_id, p.id as payable_id, p.doc_no,
           p.due_date::text as due_date,
           p.balance::text as balance_text
      from payables p
     where p.due_date < v_today
       and p.balance > 0
       and p.status <> 'paid'
       and (v_today - p.due_date) % 5 = 0  -- fire every 5 days
  loop
    select emit_notification(
      rec.company_id, 'payable_overdue', 'payable', rec.payable_id,
      null,
      '應付逾期',
      '應付帳款 ' || rec.doc_no || ' 已逾期（到期：' || rec.due_date || '），餘額 $' || rec.balance_text
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 7. receivable_due_soon ----
  -- receivables due within 7 days
  for rec in
    select r.company_id, r.id as recv_id, r.doc_no,
           r.due_date::text as due_date,
           r.balance::text as balance_text
      from receivables r
     where r.due_date between v_today and v_today + 7
       and r.balance > 0
       and r.status <> 'received'
  loop
    select emit_notification(
      rec.company_id, 'receivable_due_soon', 'receivable', rec.recv_id,
      null,
      '月結請款提醒',
      '應收帳款 ' || rec.doc_no || ' 將於 ' || rec.due_date || ' 到期，餘額 $' || rec.balance_text,
      'once'
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 8. receivable_overdue ----
  -- receivables past due, every 3 days
  for rec in
    select r.company_id, r.id as recv_id, r.doc_no,
           r.due_date::text as due_date,
           r.balance::text as balance_text
      from receivables r
     where r.due_date < v_today
       and r.balance > 0
       and r.status <> 'received'
       and (v_today - r.due_date) % 3 = 0
  loop
    select emit_notification(
      rec.company_id, 'receivable_overdue', 'receivable', rec.recv_id,
      null,
      '逾期未收款',
      '應收帳款 ' || rec.doc_no || ' 已逾期（到期：' || rec.due_date || '），餘額 $' || rec.balance_text
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 9. clock_in_missing ----
  -- employees with shift, 15 min past start, no attendance today
  for rec in
    select e.company_id, e.id as emp_id, e.name as emp_name,
           sh.name as shift_name,
           sh.start_time::text as start_time
      from employees e
      join shifts sh on sh.id = e.shift_id
     where e.is_active
       and sh.is_active
       -- shift start + 15 min tolerance has passed (in Taipei time)
       and (v_now at time zone 'Asia/Taipei')::time > (sh.start_time + (sh.late_tolerance_minutes || ' minutes')::interval)
       -- but not too late (within 2 hours of shift start) to avoid re-firing
       and (v_now at time zone 'Asia/Taipei')::time < (sh.start_time + interval '2 hours')
       -- no attendance record today
       and not exists (
         select 1 from attendances a
          where a.employee_id = e.id and a.work_date = v_today
       )
  loop
    select emit_notification(
      rec.company_id, 'clock_in_missing', 'employee', rec.emp_id,
      rec.emp_id,
      '未打上班卡',
      rec.emp_name || ' 今日尚未打上班卡（班別 ' || rec.shift_name || ' 開始：' || rec.start_time || '）',
      'once'  -- only fire once per day
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  -- ---- 10. approval_pending ----
  -- attendance_amendments pending > 24h
  for rec in
    select a.company_id, a.id as amend_id, a.employee_id,
           e.name as emp_name
      from attendance_amendments a
      join employees e on e.id = a.employee_id
     where a.status = 'pending'
       and a.created_at < v_now - interval '24 hours'
  loop
    select emit_notification(
      rec.company_id, 'approval_pending', 'attendance_amendment', rec.amend_id,
      rec.employee_id,
      '簽核逾時',
      rec.emp_name || ' 的補卡申請已超過 24 小時未審核'
    ) into v_n;
    v_total := v_total + coalesce(v_n, 0);
  end loop;

  return v_total;
end;
$$;

-- ======================== Section 6 ========================
-- Event trigger: abnormal_location (attendances)
-- ============================================================
create or replace function trg_notify_abnormal_location()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare v_emp_name text; v_distance text; v_reason text;
begin
  if not new.is_abnormal_location then return new; end if;
  -- Skip if old record already abnormal (avoid re-fire on unrelated update)
  if tg_op = 'UPDATE' and old.is_abnormal_location then return new; end if;

  select name into v_emp_name from employees where id = new.employee_id;
  v_distance := coalesce(coalesce(new.clock_in_distance_m, new.clock_out_distance_m)::text, '?');
  v_reason   := coalesce(new.abnormal_reason, '未知');

  perform emit_notification(
    new.company_id, 'abnormal_location', 'attendance', new.id,
    new.employee_id,
    '異地打卡',
    coalesce(v_emp_name, '-') || ' 打卡位置異常（距離 ' || v_distance || 'm），原因：' || v_reason,
    ''  -- empty suffix → no daily dedupe, fire every time
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_abnormal_location on attendances;
create trigger trg_notify_abnormal_location
  after insert or update on attendances
  for each row
  when (new.is_abnormal_location = true)
  execute function trg_notify_abnormal_location();

-- ======================== Section 7 ========================
-- Event trigger: outsource_dispatched (order_tasks)
-- Fires when is_outsource turns true (cross-company dispatch)
-- ============================================================
create or replace function trg_notify_outsource_dispatched()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_order_no    text;
  v_station     text;
  v_from_company text;
  v_counterpart uuid;
begin
  -- Only fire when is_outsource just turned true
  if not new.is_outsource then return new; end if;
  if tg_op = 'UPDATE' and old.is_outsource then return new; end if;

  select o.order_no into v_order_no from orders o where o.id = new.order_id;
  select s.name into v_station from work_stations s where s.id = new.station_id;
  select c.name into v_from_company from companies c where c.id = new.company_id;

  -- Determine counterpart company (the vendor's linked company)
  select v.linked_company_id into v_counterpart
    from vendors v where v.id = new.vendor_id;

  perform emit_notification(
    new.company_id, 'outsource_dispatched', 'order_task', new.id,
    new.assignee_id,
    '收到跨公司發包',
    coalesce(v_from_company, '-') || ' 發包工序「' || coalesce(v_station, '-') || '」（訂單 ' || coalesce(v_order_no, '-') || '），請確認接單',
    '',  -- no daily dedupe
    v_counterpart
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_outsource_dispatched on order_tasks;
create trigger trg_notify_outsource_dispatched
  after update on order_tasks
  for each row
  when (new.is_outsource = true and new.outsourced_at is not null and (old.outsourced_at is null or old.outsourced_at is distinct from new.outsourced_at))
  execute function trg_notify_outsource_dispatched();

-- ======================== Section 8 ========================
-- Event trigger: outsource_rejected (order_tasks)
-- Fires when outsource task status changes to 'rejected'
-- ============================================================
create or replace function trg_notify_outsource_rejected()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare v_order_no text; v_station text;
begin
  if new.status <> 'rejected' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'rejected' then return new; end if;
  if not new.is_outsource then return new; end if;

  select o.order_no into v_order_no from orders o where o.id = new.order_id;
  select s.name into v_station from work_stations s where s.id = new.station_id;

  perform emit_notification(
    new.company_id, 'outsource_rejected', 'order_task', new.id,
    new.assignee_id,
    '外包被拒接',
    coalesce(v_order_no, '-') || ' 的外包工序「' || coalesce(v_station, '-') || '」被對方拒接，請重新安排',
    ''
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_outsource_rejected on order_tasks;
create trigger trg_notify_outsource_rejected
  after update on order_tasks
  for each row
  when (new.status = 'rejected' and old.status is distinct from 'rejected')
  execute function trg_notify_outsource_rejected();

-- ======================== Section 9 ========================
-- Event trigger: outsource_completed (order_tasks)
-- Fires when outsource task status changes to 'done'
-- ============================================================
create or replace function trg_notify_outsource_completed()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_order_no text; v_station text; v_counterpart uuid;
begin
  if new.status <> 'done' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'done' then return new; end if;
  if not new.is_outsource then return new; end if;

  select o.order_no into v_order_no from orders o where o.id = new.order_id;
  select s.name into v_station from work_stations s where s.id = new.station_id;
  select v.linked_company_id into v_counterpart from vendors v where v.id = new.vendor_id;

  perform emit_notification(
    new.company_id, 'outsource_completed', 'order_task', new.id,
    new.assignee_id,
    '外包完成回寫',
    coalesce(v_order_no, '-') || ' 的外包工序「' || coalesce(v_station, '-') || '」已完成，外包商回報完工',
    '',
    v_counterpart
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_outsource_completed on order_tasks;
create trigger trg_notify_outsource_completed
  after update on order_tasks
  for each row
  when (new.is_outsource = true and new.status = 'done' and old.status is distinct from 'done')
  execute function trg_notify_outsource_completed();

-- ======================== Section 10 ========================
-- Event trigger: account_created (employees)
-- Fires on new employee insert
-- ============================================================
create or replace function trg_notify_account_created()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
begin
  perform emit_notification(
    new.company_id, 'account_created', 'employee', new.id,
    null,
    '帳號已建立',
    '新員工 ' || coalesce(new.name, '-') || '（' || coalesce(new.emp_no, '-') || '）帳號已建立',
    ''
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_account_created on employees;
create trigger trg_notify_account_created
  after insert on employees
  for each row
  execute function trg_notify_account_created();

-- ======================== Section 11 ========================
-- send_line_digests() — batch send digest notifications
-- Called by pg_cron daily at 08:00 Taipei (00:00 UTC)
-- ============================================================
create or replace function send_line_digests()
returns int
language plpgsql security definer set search_path = 'public'
as $$
declare
  rec     record;
  v_total int := 0;
  v_body  text;
begin
  -- Group digest notifications by employee, send one message per person
  for rec in
    select n.employee_id,
           e.line_user_id,
           c.line_channel_key,
           array_agg(n.id order by n.created_at) as notif_ids,
           string_agg('● ' || n.title || '：' || n.body, chr(10) order by n.created_at) as digest_text,
           count(*) as cnt
      from notifications n
      join employees e on e.id = n.employee_id
      join companies c on c.id = n.company_id
     where n.line_status = 'digest'
       and e.line_user_id is not null
       and c.line_channel_key is not null
     group by n.employee_id, e.line_user_id, c.line_channel_key
  loop
    v_body := '📋 今日通知摘要（' || rec.cnt || ' 則）' || chr(10) || chr(10) || rec.digest_text;

    perform call_edge_function('line-push', jsonb_build_object(
      'notification_ids', to_jsonb(rec.notif_ids),
      'line_user_id',     rec.line_user_id,
      'channel_key',      rec.line_channel_key,
      'title',            '每日通知摘要',
      'body',             v_body
    ));

    -- Mark as sent
    update notifications
       set line_status = 'sent', line_sent_at = now()
     where id = any(rec.notif_ids);

    v_total := v_total + rec.cnt;
  end loop;

  return v_total;
end;
$$;

-- ======================== Section 12 ========================
-- pg_cron: scan every 5 minutes
-- ============================================================
select cron.schedule(
  'notify-scan-5min',
  '*/5 * * * *',
  $$select public.cron_guarded('notify_scan_all')$$
);

-- ======================== Section 13 ========================
-- pg_cron: send digests daily at 00:00 UTC = 08:00 Taipei
-- ============================================================
select cron.schedule(
  'send-line-digests-daily',
  '0 0 * * *',
  $$select public.cron_guarded('send_line_digests')$$
);

-- ======================== Section 14 ========================
-- notification_rules: add update RPC for frontend settings page
-- ============================================================
create or replace function update_notification_rule(
  p_rule_id           uuid,
  p_is_enabled        boolean default null,
  p_in_app_enabled    boolean default null,
  p_line_enabled      boolean default null,
  p_line_mode         text    default null,
  p_recipient_scopes  text[]  default null
) returns void
language plpgsql security definer set search_path = 'public'
as $$
declare v_cid uuid;
begin
  select company_id into v_cid from notification_rules where id = p_rule_id;
  if v_cid is null then raise exception 'Rule not found'; end if;
  if v_cid <> current_company_id() then raise exception 'Access denied'; end if;
  if not has_perm('notification', 'edit') then raise exception 'No permission'; end if;

  update notification_rules set
    is_enabled       = coalesce(p_is_enabled,       is_enabled),
    in_app_enabled   = coalesce(p_in_app_enabled,   in_app_enabled),
    line_enabled     = coalesce(p_line_enabled,      line_enabled),
    line_mode        = coalesce(p_line_mode,         line_mode),
    recipient_scopes = coalesce(p_recipient_scopes,  recipient_scopes),
    updated_at       = now(),
    updated_by       = auth.uid()
  where id = p_rule_id;
end;
$$;

-- ======================== Section 15 ========================
-- RPC: mark_notification_read / mark_all_read
-- ============================================================
create or replace function mark_notification_read(p_notification_id uuid)
returns void
language plpgsql security definer set search_path = 'public'
as $$
begin
  update notifications
     set is_read = true, read_at = now()
   where id = p_notification_id
     and employee_id in (
       select e.id from employees e where e.user_id = auth.uid()
     );
end;
$$;

create or replace function mark_all_notifications_read()
returns int
language plpgsql security definer set search_path = 'public'
as $$
declare v_n int;
begin
  update notifications
     set is_read = true, read_at = now()
   where is_read = false
     and employee_id in (
       select e.id from employees e where e.user_id = auth.uid()
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ======================== Section 16 ========================
-- View: unread notification count (for sidebar badge)
-- ============================================================
create or replace view my_notification_count as
select count(*) as unread_count
  from notifications n
  join employees e on e.id = n.employee_id
 where e.user_id = auth.uid()
   and n.is_read = false;

-- ======================== Section 17 ========================
-- Add notification_rules to module_registry + role_module_permissions
-- ============================================================
insert into module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('notification', '通知中心', 'system', true, 90, true)
on conflict (module_key) do nothing;

-- Grant to owner and manager for both companies
insert into role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select e.company_id, r.id, 'notification', true, false, true, false, false
  from roles r
  join (values
    ('95755162-5905-469c-8158-8cbcc1bdb2e9'),
    ('85da97b0-5c59-4c35-bc77-5fe8020bbaf3')
  ) as e(company_id) on r.company_id = e.company_id::uuid
 where r.code in ('owner', 'manager')
on conflict do nothing;
