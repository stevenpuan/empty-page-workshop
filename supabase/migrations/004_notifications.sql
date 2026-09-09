-- =============================================================
-- 004_notifications.sql
-- Sprint  : S1
-- 目的     : 通知規則(notification_rules)、通知投遞(notifications)、收件人解析、emit_notification()
--            事件型與排程型共用同一套規則與同一支 emit
-- 相依     : 003_system_base.sql
-- 可重跑   : 是
-- 依據     : 《基礎架構整併分析 v1.0》§8
-- =============================================================

-- =============================================================
-- 1. 規則（每公司一套）
-- =============================================================
create table if not exists public.notification_rules (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  rule_code        text not null,
  name             text not null,
  category         text not null check (category in ('dispatch','outsource','payable','receivable','attendance','system')),
  trigger_kind     text not null check (trigger_kind in ('event','scan')),
  is_enabled       boolean not null default true,
  params           jsonb not null default '{}'::jsonb,
  recipient_scopes text[] not null default '{}',
  in_app_enabled   boolean not null default true,
  line_enabled     boolean not null default true,
  line_mode        text not null default 'immediate' check (line_mode in ('immediate','digest')),
  template_title   text,
  template_body    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint notification_rules_uk unique (company_id, rule_code)
);
create index if not exists idx_notification_rules_company on public.notification_rules(company_id);
drop trigger if exists trg_notification_rules_updated on public.notification_rules;
create trigger trg_notification_rules_updated before update on public.notification_rules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit on public.notification_rules;
create trigger trg_audit after insert or update or delete on public.notification_rules
  for each row execute function public.audit_row_change();

comment on column public.notification_rules.recipient_scopes is
  'tokens: owner(該筆負責人) | manager(本公司 tier>=manager) | role:<code> | user:<employee_id> | all_company | counterpart(跨公司對方 manager)';

-- =============================================================
-- 2. 投遞（站內 + LINE 同列）
-- =============================================================
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  rule_code      text not null,
  ref_type       text,
  ref_id         uuid,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  title          text not null,
  body           text not null,
  is_read        boolean not null default false,
  read_at        timestamptz,
  line_status    text not null default 'pending' check (line_status in ('pending','sent','failed','skipped','digest')),
  line_sent_at   timestamptz,
  line_error     text,
  line_attempts  int not null default 0,
  dedupe_key     text,
  created_at     timestamptz not null default now()
);
create unique index if not exists ux_notifications_dedupe on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists idx_notifications_employee on public.notifications (employee_id, is_read, created_at desc);
create index if not exists idx_notifications_line_pending on public.notifications (company_id, line_status) where line_status in ('pending','digest');

-- =============================================================
-- 3. 收件人解析
-- =============================================================
create or replace function public.resolve_recipients(
  p_company_id uuid,
  p_scopes text[],
  p_owner_employee_id uuid default null,
  p_counterpart_company_id uuid default null
) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare s text; v_ids uuid[] := '{}';
begin
  foreach s in array coalesce(p_scopes, '{}') loop
    if s = 'owner' then
      if p_owner_employee_id is not null then v_ids := v_ids || p_owner_employee_id; end if;
    elsif s = 'manager' then
      v_ids := v_ids || array(select e.id from employees e join roles r on r.id = e.role_id
                              where e.company_id = p_company_id and e.is_active and r.tier in ('owner','manager'));
    elsif s = 'all_company' then
      v_ids := v_ids || array(select id from employees where company_id = p_company_id and is_active);
    elsif s like 'role:%' then
      v_ids := v_ids || array(select e.id from employees e join roles r on r.id = e.role_id
                              where e.company_id = p_company_id and e.is_active and r.code = substr(s, 6));
    elsif s like 'user:%' then
      v_ids := v_ids || array(select id from employees where id = substr(s, 6)::uuid and company_id = p_company_id and is_active);
    elsif s = 'counterpart' and p_counterpart_company_id is not null then
      v_ids := v_ids || array(select e.id from employees e join roles r on r.id = e.role_id
                              where e.company_id = p_counterpart_company_id and e.is_active and r.tier in ('owner','manager'));
    end if;
  end loop;
  return query select distinct u from unnest(v_ids) u where u is not null;
end;
$$;
revoke all on function public.resolve_recipients(uuid, text[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_recipients(uuid, text[], uuid, uuid) to service_role;

-- =============================================================
-- 4. emit：事件型 trigger 與排程型掃描共用
--    回傳實際新增的通知筆數；dedupe_key 衝突則略過
-- =============================================================
create or replace function public.emit_notification(
  p_company_id uuid,
  p_rule_code text,
  p_ref_type text,
  p_ref_id uuid,
  p_owner_employee_id uuid,
  p_title text,
  p_body text,
  p_dedupe_suffix text default null,           -- 預設 YYYYMMDD；傳 '' 代表不去重
  p_counterpart_company_id uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r public.notification_rules; v_emp uuid; v_n int := 0; v_key text; v_status text;
  v_suffix text := coalesce(p_dedupe_suffix, to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD'));
begin
  select * into r from notification_rules where company_id = p_company_id and rule_code = p_rule_code;
  if r is null or not r.is_enabled then return 0; end if;
  if not r.in_app_enabled and not r.line_enabled then return 0; end if;

  v_status := case when not r.line_enabled then 'skipped'
                   when r.line_mode = 'digest' then 'digest'
                   else 'pending' end;

  for v_emp in select * from resolve_recipients(p_company_id, r.recipient_scopes, p_owner_employee_id, p_counterpart_company_id) loop
    v_key := case when v_suffix = '' then null
                  else p_rule_code || ':' || coalesce(p_ref_id::text, '-') || ':' || v_emp::text || ':' || v_suffix end;
    insert into notifications (company_id, rule_code, ref_type, ref_id, employee_id, title, body, line_status, dedupe_key)
    select (select company_id from employees where id = v_emp), p_rule_code, p_ref_type, p_ref_id, v_emp, p_title, p_body, v_status, v_key
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.emit_notification(uuid, text, text, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.emit_notification(uuid, text, text, uuid, uuid, text, text, text, uuid) to service_role;

-- 標示 LINE 投遞結果（Edge Function line-push 回寫用）
create or replace function public.mark_line_result(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update notifications
  set line_status = case when p_ok then 'sent' else 'failed' end,
      line_sent_at = case when p_ok then now() else line_sent_at end,
      line_error = p_error,
      line_attempts = line_attempts + 1
  where id = p_id
$$;
revoke all on function public.mark_line_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.mark_line_result(uuid, boolean, text) to service_role;

-- =============================================================
-- 5. RLS
-- =============================================================
alter table public.notification_rules enable row level security;
alter table public.notifications      enable row level security;

drop policy if exists notification_rules_read on public.notification_rules;
create policy notification_rules_read on public.notification_rules for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists notification_rules_write on public.notification_rules;
create policy notification_rules_write on public.notification_rules for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('notification_rules','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('notification_rules','edit'));

-- 通知：只看自己的（含跨公司 counterpart 收到的，因 employee_id 就是自己）
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (employee_id in (select id from public.employees where user_id = (select auth.uid())));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (employee_id in (select id from public.employees where user_id = (select auth.uid())))
  with check (employee_id in (select id from public.employees where user_id = (select auth.uid())));
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (is_read and employee_id in (select id from public.employees where user_id = (select auth.uid())));

-- 使用者只能改 is_read / read_at
create or replace function public.protect_notification_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    new.company_id := old.company_id; new.rule_code := old.rule_code; new.ref_type := old.ref_type;
    new.ref_id := old.ref_id; new.employee_id := old.employee_id; new.title := old.title; new.body := old.body;
    new.line_status := old.line_status; new.line_sent_at := old.line_sent_at; new.line_error := old.line_error;
    new.line_attempts := old.line_attempts; new.dedupe_key := old.dedupe_key; new.created_at := old.created_at;
    if new.is_read and not old.is_read then new.read_at := now(); end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_notification_fields() from public, anon, authenticated;
drop trigger if exists trg_notifications_protect on public.notifications;
create trigger trg_notifications_protect before update on public.notifications
  for each row execute function public.protect_notification_fields();

-- Realtime：通知中心訂閱
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;

-- =============================================================
-- 6. 種子：每家 11 條 scan + 5 條 event（SA-SD §10.2 + 分析 §8.2）
-- =============================================================
with rules(rule_code, name, category, kind, params, scopes, in_app, line, mode) as (values
  ('task_overdue',          '工序逾期',           'dispatch',   'scan',  '{"repeat_every_days":1}',                 array['owner','manager'],        true, true,  'digest'),
  ('task_blocked',          '工序卡關過久',       'dispatch',   'scan',  '{"days_over":1,"repeat_every_days":1}',   array['manager'],                true, true,  'digest'),
  ('task_waiting_customer', '校稿久候',           'dispatch',   'scan',  '{"days_over":3,"repeat_every_days":1}',   array['owner'],                  true, true,  'digest'),
  ('outsource_overdue',     '外包逾期未收回',     'outsource',  'scan',  '{"repeat_every_days":2}',                 array['manager'],                true, true,  'digest'),
  ('payable_due_soon',      '應付到期前 3 日',    'payable',    'scan',  '{"days_before":3}',                       array['manager'],                true, true,  'digest'),
  ('payable_overdue',       '應付逾期',           'payable',    'scan',  '{"repeat_every_days":5}',                 array['role:owner'],             true, true,  'digest'),
  ('receivable_due_soon',   '月結請款提醒',       'receivable', 'scan',  '{"days_before":7}',                       array['manager'],                true, true,  'digest'),
  ('receivable_overdue',    '逾期未收',           'receivable', 'scan',  '{"repeat_every_days":3}',                 array['manager'],                true, true,  'digest'),
  ('clock_in_missing',      '未打上班卡',         'attendance', 'scan',  '{"minutes_after_shift_start":15}',        array['owner','manager'],        true, true,  'immediate'),
  ('abnormal_location',     '異地打卡',           'attendance', 'event', '{}',                                      array['manager'],                true, true,  'immediate'),
  ('approval_pending',      '簽核逾時',           'attendance', 'scan',  '{"hours_over":24}',                       array['manager'],                true, true,  'digest'),
  ('outsource_dispatched',  '收到跨公司發包',     'outsource',  'event', '{}',                                      array['counterpart'],            true, true,  'immediate'),
  ('outsource_rejected',    '外包被拒接',         'outsource',  'event', '{}',                                      array['manager'],                true, true,  'immediate'),
  ('outsource_completed',   '外包完成回寫',       'outsource',  'event', '{}',                                      array['manager','counterpart'],  true, true,  'immediate'),
  ('account_created',       '系統帳號建立',       'system',     'event', '{}',                                      array['role:owner'],             true, false, 'digest'),
  ('system_alert',          '系統異常',           'system',     'event', '{}',                                      array['role:owner'],             true, true,  'immediate'))
insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind, params, recipient_scopes, in_app_enabled, line_enabled, line_mode)
select c.id, r.rule_code, r.name, r.category, r.kind, r.params::jsonb, r.scopes, r.in_app, r.line, r.mode
from public.companies c cross join rules r
on conflict (company_id, rule_code) do nothing;
