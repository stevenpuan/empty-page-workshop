-- =============================================================
-- 003_system_base.sql
-- Sprint  : S1
-- 目的     : 系統參數(system_configs)、代碼字典(lookups)、三張日誌、保留清除政策、
--            通用稽核 trigger、禁刪 trigger、版本更新(changelogs)、pg_cron 排程
-- 相依     : 002_rbac_menus.sql
-- 可重跑   : 是
-- 依據     : 《基礎架構整併分析 v1.0》§6、§7
-- =============================================================

-- =============================================================
-- 1. 系統參數（company_id null = 全系統）
-- =============================================================
create table if not exists public.system_configs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  key          text not null,
  value        text,
  value_type   text not null default 'string' check (value_type in ('string','int','numeric','bool','json','time')),
  group_name   text,
  description  text,
  is_secret    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);
create unique index if not exists ux_system_configs_global on public.system_configs (key) where company_id is null;
create unique index if not exists ux_system_configs_company on public.system_configs (company_id, key) where company_id is not null;
drop trigger if exists trg_system_configs_updated on public.system_configs;
create trigger trg_system_configs_updated before update on public.system_configs
  for each row execute function public.set_updated_at();

-- 讀值：公司層優先，退回全系統層
create or replace function public.get_config(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value from system_configs where key = p_key and company_id = public.current_company_id()),
    (select value from system_configs where key = p_key and company_id is null))
$$;
revoke all on function public.get_config(text) from public, anon;
grant execute on function public.get_config(text) to authenticated, service_role;

-- =============================================================
-- 2. 代碼字典（company_id null = 共用）
-- =============================================================
create table if not exists public.lookups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  category    text not null,
  code        text not null,
  label       text not null,
  sort_order  int not null default 10,
  is_active   boolean not null default true,
  meta        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create unique index if not exists ux_lookups_global on public.lookups (category, code) where company_id is null;
create unique index if not exists ux_lookups_company on public.lookups (company_id, category, code) where company_id is not null;
create index if not exists idx_lookups_category on public.lookups (category);
drop trigger if exists trg_lookups_updated on public.lookups;
create trigger trg_lookups_updated before update on public.lookups
  for each row execute function public.set_updated_at();

-- =============================================================
-- 3. 日誌三表（company_id 可空）
-- =============================================================
create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,
  route       text,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_logs_created on public.activity_logs (created_at desc);

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  action        text not null,                 -- insert | update | delete | create_account | reset_password | ...
  target_table  text,
  target_id     text,
  before_data   jsonb,
  after_data    jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_target on public.audit_logs (target_table, target_id);

create table if not exists public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  level       text not null default 'error',
  message     text,
  context     jsonb,
  route       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_error_logs_created on public.error_logs (created_at desc);

-- =============================================================
-- 4. 通用稽核 trigger（掛在敏感表）
-- =============================================================
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := old.id::text;
    begin v_company := old.company_id; exception when others then v_company := null; end;
    insert into audit_logs (company_id, user_id, action, target_table, target_id, before_data)
    values (v_company, auth.uid(), 'delete', tg_table_name, v_id, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_id := new.id::text;
    begin v_company := new.company_id; exception when others then v_company := null; end;
    insert into audit_logs (company_id, user_id, action, target_table, target_id, before_data, after_data)
    values (v_company, auth.uid(), 'update', tg_table_name, v_id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    v_id := new.id::text;
    begin v_company := new.company_id; exception when others then v_company := null; end;
    insert into audit_logs (company_id, user_id, action, target_table, target_id, after_data)
    values (v_company, auth.uid(), 'insert', tg_table_name, v_id, to_jsonb(new));
    return new;
  end if;
end;
$$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

-- 掛到敏感表（company_modules 無 id 欄，另行處理）
do $$ declare t text; begin
  foreach t in array array['companies','employees','roles','role_module_permissions','system_configs'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- profiles 只稽核旗標變更
create or replace function public.audit_profile_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_platform_admin <> old.is_platform_admin or new.must_change_password <> old.must_change_password then
    insert into audit_logs (user_id, action, target_table, target_id, before_data, after_data)
    values (auth.uid(), 'update', 'profiles', new.id::text,
            jsonb_build_object('is_platform_admin', old.is_platform_admin, 'must_change_password', old.must_change_password),
            jsonb_build_object('is_platform_admin', new.is_platform_admin, 'must_change_password', new.must_change_password));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_profile_flags() from public, anon, authenticated;
drop trigger if exists trg_audit_profiles on public.profiles;
create trigger trg_audit_profiles after update on public.profiles
  for each row execute function public.audit_profile_flags();

-- =============================================================
-- 5. 禁刪 trigger（單據與帳務表用；S2 起掛上）
-- =============================================================
create or replace function public.prevent_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception '此類資料不可刪除，請改為作廢（void）或停用';
end;
$$;
revoke all on function public.prevent_delete() from public, anon, authenticated;

-- =============================================================
-- 6. 版本更新紀錄
-- =============================================================
create table if not exists public.changelogs (
  id           uuid primary key default gen_random_uuid(),
  version      text not null,
  type         text not null default 'feature',
  title        text not null,
  content      text,
  released_at  date not null default (now() at time zone 'Asia/Taipei')::date,
  created_at   timestamptz not null default now(),
  created_by   uuid
);

-- =============================================================
-- 7. 保留與清除
-- =============================================================
create table if not exists public.purge_policy (
  key         text primary key,
  label       text not null,
  days        int  not null check (days > 0),
  note        text,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
drop trigger if exists trg_purge_policy_updated on public.purge_policy;
create trigger trg_purge_policy_updated before update on public.purge_policy
  for each row execute function public.set_updated_at();

create table if not exists public.purge_run_log (
  id           bigserial primary key,
  ran_at       timestamptz not null default now(),
  dry_run      boolean not null,
  ok           boolean not null,
  duration_ms  int,
  detail       jsonb
);

insert into public.purge_policy (key, label, days, note) values
  ('error_logs',    '錯誤紀錄',  90,  null),
  ('activity_logs', '操作紀錄',  90,  null),
  ('audit_logs',    '稽核紀錄',  365, '帳務系統建議至少保留一年'),
  ('notifications', '站內通知',  180, '含 LINE 投遞紀錄；004 建表後生效')
on conflict (key) do nothing;

create or replace function public.purge_maintenance(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; n int; v_detail jsonb := '{}'::jsonb; v_ok boolean := true; t0 timestamptz := clock_timestamp();
begin
  if auth.uid() is not null and not public.is_platform_admin() and not public.is_owner() then
    raise exception '權限不足';
  end if;
  for r in select * from purge_policy where is_active loop
    begin
      if to_regclass('public.' || r.key) is null then
        v_detail := v_detail || jsonb_build_object(r.key, 'SKIP: table missing');
        continue;
      end if;
      if p_dry_run then
        execute format('select count(*) from public.%I where created_at < now() - ($1 || '' days'')::interval', r.key)
          into n using r.days::text;
      else
        execute format('with d as (delete from public.%I where created_at < now() - ($1 || '' days'')::interval returning 1) select count(*) from d', r.key)
          into n using r.days::text;
      end if;
      v_detail := v_detail || jsonb_build_object(r.key, n);
    exception when others then
      v_ok := false;
      v_detail := v_detail || jsonb_build_object(r.key, 'ERROR: ' || sqlerrm);
    end;
  end loop;
  insert into purge_run_log (dry_run, ok, duration_ms, detail)
  values (p_dry_run, v_ok, extract(milliseconds from clock_timestamp() - t0)::int, v_detail);
  return v_detail;
end;
$$;
revoke all on function public.purge_maintenance(boolean) from public, anon;
grant execute on function public.purge_maintenance(boolean) to authenticated, service_role;

-- cron 守衛：失敗寫 error_logs，不讓排程靜默死掉
create or replace function public.cron_guarded(p_fn text)
returns void language plpgsql security definer set search_path = public as $$
begin
  execute format('select public.%I()', p_fn);
exception when others then
  insert into error_logs (level, message, context, route)
  values ('error', 'cron ' || p_fn || ' failed: ' || sqlerrm, jsonb_build_object('fn', p_fn, 'sqlstate', sqlstate), 'cron');
end;
$$;
revoke all on function public.cron_guarded(text) from public, anon, authenticated;

create or replace function public.purge_maintenance_job()
returns void language sql security definer set search_path = public as $$
  select public.purge_maintenance(false)
$$;
revoke all on function public.purge_maintenance_job() from public, anon, authenticated;

-- pg_cron：台北 06:00 = UTC 22:00（前一日）
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron 未能啟用：%（請至 Dashboard → Integrations → Cron 啟用後重跑本段）', sqlerrm;
    end;
  end;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-maintenance-daily';
    perform cron.schedule('purge-maintenance-daily', '0 22 * * *', $c$ select public.cron_guarded('purge_maintenance_job') $c$);
  end if;
end $$;

-- =============================================================
-- 8. RLS
-- =============================================================
alter table public.system_configs enable row level security;
alter table public.lookups        enable row level security;
alter table public.activity_logs  enable row level security;
alter table public.audit_logs     enable row level security;
alter table public.error_logs     enable row level security;
alter table public.changelogs     enable row level security;
alter table public.purge_policy   enable row level security;
alter table public.purge_run_log  enable row level security;

-- system_configs：全系統列人人可讀（非 secret）；公司列同公司可讀；寫需 system_configs:edit（全系統列另需平台管理員）
drop policy if exists system_configs_read on public.system_configs;
create policy system_configs_read on public.system_configs for select to authenticated
  using ((company_id is null and (not is_secret or public.is_platform_admin()))
      or company_id = public.current_company_id());
drop policy if exists system_configs_write_company on public.system_configs;
create policy system_configs_write_company on public.system_configs for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('system_configs','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('system_configs','edit'));
drop policy if exists system_configs_write_global on public.system_configs;
create policy system_configs_write_global on public.system_configs for all to authenticated
  using (company_id is null and public.is_platform_admin())
  with check (company_id is null and public.is_platform_admin());

-- lookups：共用列人人可讀；公司列同公司；寫：公司列需 lookups:edit，共用列需平台管理員
drop policy if exists lookups_read on public.lookups;
create policy lookups_read on public.lookups for select to authenticated
  using (company_id is null or company_id = public.current_company_id());
drop policy if exists lookups_write_company on public.lookups;
create policy lookups_write_company on public.lookups for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('lookups','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('lookups','edit'));
drop policy if exists lookups_write_global on public.lookups;
create policy lookups_write_global on public.lookups for all to authenticated
  using (company_id is null and public.is_platform_admin())
  with check (company_id is null and public.is_platform_admin());

-- 日誌：讀需權限（平台管理員全看）；activity/error 前端只能寫自己；audit 前端不可寫
drop policy if exists activity_logs_read on public.activity_logs;
create policy activity_logs_read on public.activity_logs for select to authenticated
  using (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_perm('activity_logs','view')));
drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert on public.activity_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_perm('audit_logs','view')));

drop policy if exists error_logs_read on public.error_logs;
create policy error_logs_read on public.error_logs for select to authenticated
  using (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_perm('error_logs','view')));
drop policy if exists error_logs_insert on public.error_logs;
create policy error_logs_insert on public.error_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- changelogs：人人可讀；寫需平台管理員
drop policy if exists changelogs_read on public.changelogs;
create policy changelogs_read on public.changelogs for select to authenticated using (true);
drop policy if exists changelogs_write on public.changelogs;
create policy changelogs_write on public.changelogs for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- purge：owner／平台管理員可讀；policy 可改 days
drop policy if exists purge_policy_read on public.purge_policy;
create policy purge_policy_read on public.purge_policy for select to authenticated
  using (public.is_owner());
drop policy if exists purge_policy_update on public.purge_policy;
create policy purge_policy_update on public.purge_policy for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists purge_run_log_read on public.purge_run_log;
create policy purge_run_log_read on public.purge_run_log for select to authenticated
  using (public.is_owner());

-- =============================================================
-- 9. 種子：全系統參數、共用字典
-- =============================================================
insert into public.system_configs (company_id, key, value, value_type, group_name, description) values
  (null, 'site_name',                 '祥興印刷營運系統', 'string', '系統', '系統名稱'),
  (null, 'password.min_length',       '8',                'int',    '安全', '密碼最少字元數'),
  (null, 'notify.line_digest_time',   '08:00',            'time',   '通知', 'LINE 彙整推播時間（台北）'),
  (null, 'notify.scan_interval_min',  '5',                'int',    '通知', '排程掃描間隔（分鐘）'),
  (null, 'attendance.late_tolerance_default', '5',        'int',    '出勤', '預設遲到容忍分鐘'),
  (null, 'payable.default_term',      'monthly_end',      'string', '應付', '預設付款條件'),
  (null, 'ui.board_columns_max',      '8',                'int',    '介面', '看板最多欄數'),
  (null, 'ui.list_page_size',         '50',               'int',    '介面', '列表每頁筆數')
on conflict do nothing;

insert into public.lookups (company_id, category, code, label, sort_order, meta) values
  (null, 'payment_term', 'cash',        '現金／即付',     10, null),
  (null, 'payment_term', 'net30',       '30 天',          20, '{"days":30}'),
  (null, 'payment_term', 'net60',       '60 天',          30, '{"days":60}'),
  (null, 'payment_term', 'net90',       '90 天',          40, '{"days":90}'),
  (null, 'payment_term', 'monthly_15',  '次月 15 日',     50, null),
  (null, 'payment_term', 'monthly_end', '次月月底',       60, null),
  (null, 'payment_method', 'cash',     '現金',   10, null),
  (null, 'payment_method', 'transfer', '匯款',   20, null),
  (null, 'payment_method', 'check',    '支票',   30, null),
  (null, 'payment_method', 'atm',      'ATM',    40, null),
  (null, 'tax_type', 'taxable', '應稅', 10, '{"rate":0.05}'),
  (null, 'tax_type', 'zero',    '零稅率', 20, '{"rate":0}'),
  (null, 'tax_type', 'exempt',  '免稅',   30, '{"rate":0}'),
  (null, 'unit', 'sheet', '張', 10, null),
  (null, 'unit', 'piece', '件', 20, null),
  (null, 'unit', 'book',  '本', 30, null),
  (null, 'unit', 'pcs',   '個', 40, null),
  (null, 'unit', 'set',   '組', 50, null),
  (null, 'unit', 'ream',  '令', 60, null),
  (null, 'unit', 'roll',  '卷', 70, null),
  (null, 'unit', 'can',   '罐', 80, null),
  (null, 'vendor_type', 'paper',      '紙材',       10, null),
  (null, 'vendor_type', 'ink_plate',  '油墨版材',   20, null),
  (null, 'vendor_type', 'print_out',  '外包印刷',   30, null),
  (null, 'vendor_type', 'finishing',  '後加工',     40, null),
  (null, 'vendor_type', 'supplies',   '設備耗材',   50, null),
  (null, 'vendor_type', 'other',      '其他',       90, null),
  (null, 'product_category', 'card',     '名片',        10, null),
  (null, 'product_category', 'banner',   '布條帆布',    20, null),
  (null, 'product_category', 'dm',       '明信片 DM',   30, null),
  (null, 'product_category', 'agency',   '純代印',      40, null),
  (null, 'product_category', 'box',      '紙盒',        50, null),
  (null, 'product_category', 'sticker',  '貼紙',        60, null),
  (null, 'product_category', 'other',    '其他',        90, null),
  (null, 'position', 'printer',   '印務',   10, null),
  (null, 'position', 'designer',  '美編',   20, null),
  (null, 'position', 'finishing', '後加工', 30, null),
  (null, 'position', 'front',     '門市',   40, null),
  (null, 'position', 'sales',     '業務',   50, null),
  (null, 'blocked_reason', 'material',  '缺料',       10, null),
  (null, 'blocked_reason', 'machine',   '設備故障',   20, null),
  (null, 'blocked_reason', 'confirm',   '待客戶確認', 30, null),
  (null, 'blocked_reason', 'other',     '其他',       90, null),
  (null, 'changelog_type', 'feature',     '功能', 10, null),
  (null, 'changelog_type', 'fix',         '修正', 20, null),
  (null, 'changelog_type', 'improvement', '優化', 30, null)
on conflict do nothing;

insert into public.changelogs (version, type, title, content)
select '0.1.0', 'feature', 'S1 底座建立', '雙公司多租戶、角色權限矩陣、資料驅動選單、系統參數、代碼字典、日誌與保留政策。'
where not exists (select 1 from public.changelogs where version = '0.1.0');

-- =============================================================
-- 10. 寫稽核（service_role 用；Edge Function 呼叫）
-- =============================================================
create or replace function public.write_audit(p_company_id uuid, p_user_id uuid, p_action text, p_target_table text, p_target_id text, p_after jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (company_id, user_id, action, target_table, target_id, after_data)
  values (p_company_id, p_user_id, p_action, p_target_table, p_target_id, p_after)
$$;
revoke all on function public.write_audit(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit(uuid, uuid, text, text, text, jsonb) to service_role;
