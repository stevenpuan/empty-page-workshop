-- =============================================================
-- 001_core_tenant.sql  (v2)
-- Sprint  : S1（租戶、認證、權限骨架）
-- 目的     : 雙公司多租戶核心：公司、登入者 profiles、角色(roles+tier)、班別、
--            員工、部門(預留)、當前公司 context、單號產生器、共通 trigger、RLS helper
-- 相依     : 無（本專案第一支 migration）
-- 可重跑   : 是
-- 依據     : 《基礎架構整併分析 v1.0》§3、§4、§10.4
-- v2 變更  : employees.role text → role_id(roles)、must_change_password 移至 profiles、
--            新增 profiles/roles/departments、is_platform_admin()、has_perm()、
--            companies.login_domain
-- =============================================================

create extension if not exists "pgcrypto" with schema extensions;

-- =============================================================
-- 1. 共通 trigger 函式
-- =============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- =============================================================
-- 2. 公司主檔
-- =============================================================
create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,                    -- XX | YR
  name              text not null,
  short_name        text,
  tax_id            text,
  invoice_entity    text,
  address           text,
  phone             text,
  lat               numeric(10,7),
  lng               numeric(10,7),
  clock_radius_m    int  not null default 150,
  line_channel_key  text,                                    -- 對應 Secret 後綴，不存 token
  login_domain      text not null,                           -- 內部帳號網域：xiangxing.local
  theme_color       text not null default 'cyan',            -- cyan=祥興 orange=沂融
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  constraint companies_code_chk check (code ~ '^[A-Z]{2}$'),
  constraint companies_login_domain_uk unique (login_domain)
);
drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- =============================================================
-- 3. 登入者 profiles（跨公司共通；每個 auth user 一列）
-- =============================================================
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  display_name          text,
  must_change_password  boolean not null default true,
  is_platform_admin     boolean not null default false,   -- 系統設計師；僅 service_role/SQL 可改
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- auth.users 新增 → 自動建 profiles（不做首位註冊者自動 admin）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- =============================================================
-- 4. 角色（每公司獨立；tier 決定資料範圍，矩陣決定功能）
-- =============================================================
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  tier        text not null,
  is_system   boolean not null default false,
  sort_order  int  not null default 10,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint roles_tier_chk check (tier in ('owner','manager','staff')),
  constraint roles_code_uk unique (company_id, code)
);
create index if not exists idx_roles_company on public.roles(company_id);
drop trigger if exists trg_roles_updated on public.roles;
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

-- 內建角色保護：is_system 列不可刪、不可改 tier/code
create or replace function public.protect_system_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception '內建角色不可刪除';
    end if;
    return old;
  end if;
  if old.is_system and (new.tier <> old.tier or new.code <> old.code or new.is_system = false) then
    raise exception '內建角色的代碼與層級不可修改';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_system_role() from public, anon, authenticated;
drop trigger if exists trg_roles_protect on public.roles;
create trigger trg_roles_protect before update or delete on public.roles
  for each row execute function public.protect_system_role();

-- =============================================================
-- 5. 部門（預留；本案兩家皆單層，先建表不建資料）
-- =============================================================
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  code        text,
  parent_id   uuid references public.departments(id) on delete set null,
  manager_id  uuid,                       -- → employees，於 employees 建立後補 FK
  sort_order  int not null default 10,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create index if not exists idx_departments_company on public.departments(company_id);
drop trigger if exists trg_departments_updated on public.departments;
create trigger trg_departments_updated before update on public.departments
  for each row execute function public.set_updated_at();

-- =============================================================
-- 6. 班別
-- =============================================================
create table if not exists public.shifts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  name                   text not null,
  start_time             time not null,
  end_time               time not null,
  break_minutes          int  not null default 60,
  late_tolerance_minutes int  not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);
create index if not exists idx_shifts_company on public.shifts(company_id);
drop trigger if exists trg_shifts_updated on public.shifts;
create trigger trg_shifts_updated before update on public.shifts
  for each row execute function public.set_updated_at();

-- =============================================================
-- 7. 員工（每公司一列；同一 auth user 可在兩家各有一列）
-- =============================================================
create table if not exists public.employees (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,
  emp_no                text not null,
  name                  text not null,
  role_id               uuid not null references public.roles(id),
  department_id         uuid references public.departments(id) on delete set null,
  position              text,
  phone                 text,
  line_user_id          text,
  shift_id              uuid references public.shifts(id) on delete set null,
  hire_date             date,
  can_switch_company    boolean not null default false,
  is_active             boolean not null default true,
  note                  text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint employees_empno_uk unique (company_id, emp_no),
  constraint employees_user_uk  unique (company_id, user_id)
);
create index if not exists idx_employees_company on public.employees(company_id);
create index if not exists idx_employees_user    on public.employees(user_id);
create index if not exists idx_employees_role    on public.employees(role_id);
drop trigger if exists trg_employees_updated on public.employees;
create trigger trg_employees_updated before update on public.employees
  for each row execute function public.set_updated_at();

-- 角色必須屬於同一公司
create or replace function public.check_employee_role_company()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.roles r where r.id = new.role_id and r.company_id = new.company_id) then
    raise exception '角色不屬於該公司';
  end if;
  return new;
end;
$$;
revoke all on function public.check_employee_role_company() from public, anon, authenticated;
drop trigger if exists trg_employees_role_company on public.employees;
create trigger trg_employees_role_company before insert or update of role_id, company_id on public.employees
  for each row execute function public.check_employee_role_company();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'departments_manager_fk') then
    alter table public.departments
      add constraint departments_manager_fk foreign key (manager_id) references public.employees(id) on delete set null;
  end if;
end $$;

-- =============================================================
-- 8. 當前公司 context（整個權限體系的樞紐）
-- =============================================================
create table if not exists public.user_company_context (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  current_company_id uuid not null references public.companies(id),
  switched_at        timestamptz not null default now()
);

-- =============================================================
-- 9. 單號產生器
-- =============================================================
create table if not exists public.doc_no_counters (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc_type   text not null,                       -- WO | QT | DN | AR | RC | P | AP | PAY
  period     text not null,                       -- YYMM
  last_seq   int  not null default 0,
  constraint doc_no_uk unique (company_id, doc_type, period)
);

create or replace function public.next_doc_no(p_company_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Taipei', 'YYMM');
  v_code   text;
  v_seq    int;
begin
  select code into v_code from companies where id = p_company_id;
  if v_code is null then
    raise exception 'company not found: %', p_company_id;
  end if;
  insert into doc_no_counters (company_id, doc_type, period, last_seq)
  values (p_company_id, p_doc_type, v_period, 1)
  on conflict (company_id, doc_type, period)
  do update set last_seq = doc_no_counters.last_seq + 1
  returning last_seq into v_seq;
  return v_code || '-' || p_doc_type || '-' || v_period || lpad(v_seq::text, 3, '0');
end;
$$;
revoke all on function public.next_doc_no(uuid, text) from public, anon, authenticated;
grant execute on function public.next_doc_no(uuid, text) to service_role;   -- 前端不直接取號，由 trigger/函式取

-- =============================================================
-- 10. RLS Helper（全部 security definer，擁有者 postgres bypass RLS）
--     ★ employees / profiles 不可設 FORCE ROW LEVEL SECURITY
-- =============================================================
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.user_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from employees where user_id = auth.uid() and is_active
  union
  select id from companies where public.is_platform_admin()
$$;

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select current_company_id from user_company_context where user_id = auth.uid()
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from employees e
  where e.user_id = auth.uid() and e.company_id = public.current_company_id() and e.is_active
  limit 1
$$;

-- 回傳 tier：owner | manager | staff（平台管理員視為 owner）
create or replace function public.current_role_code()
returns text language sql stable security definer set search_path = public as $$
  select case when public.is_platform_admin() then 'owner'
         else (select r.tier from employees e join roles r on r.id = e.role_id
               where e.user_id = auth.uid() and e.company_id = public.current_company_id() and e.is_active
               limit 1) end
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_code() in ('owner','manager'), false)
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_code() = 'owner', false)
$$;

-- 功能開關：owner 與平台管理員恆真（與前端 can() 同源）；矩陣表於 002 建立
create or replace function public.has_perm(p_module text, p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_owner() then return true; end if;
  if to_regclass('public.role_module_permissions') is null then return false; end if;
  return exists (
    select 1
    from employees e
    join role_module_permissions p on p.role_id = e.role_id
    where e.user_id = auth.uid()
      and e.company_id = public.current_company_id()
      and e.is_active
      and p.module_key = p_module
      and case p_action
            when 'view'   then p.can_view
            when 'create' then p.can_create
            when 'edit'   then p.can_edit
            when 'delete' then p.can_delete
            when 'export' then p.can_export
            else false end);
end;
$$;

do $$ declare f text; begin
  foreach f in array array['is_platform_admin()','user_company_ids()','current_company_id()',
    'current_employee_id()','current_role_code()','is_manager()','is_owner()','has_perm(text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- =============================================================
-- 11. 切換公司（can_switch_company 或平台管理員）
-- =============================================================
create or replace function public.switch_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_allowed boolean;
begin
  if p_company_id is null then
    raise exception 'company id is required';
  end if;
  select public.is_platform_admin() or exists (
    select 1 from employees
    where user_id = auth.uid() and company_id = p_company_id and is_active and can_switch_company
  ) into v_allowed;
  if not v_allowed then
    raise exception 'not allowed to switch to this company';
  end if;
  insert into user_company_context (user_id, current_company_id, switched_at)
  values (auth.uid(), p_company_id, now())
  on conflict (user_id)
  do update set current_company_id = excluded.current_company_id, switched_at = now();
end;
$$;
revoke all on function public.switch_company(uuid) from public, anon;
grant execute on function public.switch_company(uuid) to authenticated;

-- 首次登入若尚無 context：自動指到唯一那家（一般員工）
create or replace function public.ensure_company_context()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_cid uuid;
begin
  select current_company_id into v_cid from user_company_context where user_id = auth.uid();
  if v_cid is not null then return v_cid; end if;
  select company_id into v_cid from employees where user_id = auth.uid() and is_active order by created_at limit 1;
  if v_cid is null and public.is_platform_admin() then
    select id into v_cid from companies where is_active order by code limit 1;
  end if;
  if v_cid is null then return null; end if;
  insert into user_company_context (user_id, current_company_id) values (auth.uid(), v_cid)
  on conflict (user_id) do nothing;
  return v_cid;
end;
$$;
revoke all on function public.ensure_company_context() from public, anon;
grant execute on function public.ensure_company_context() to authenticated;

-- 首次改密碼完成
create or replace function public.complete_password_change()
returns void language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;
revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- =============================================================
-- 12. RLS
-- =============================================================
alter table public.companies            enable row level security;
alter table public.profiles             enable row level security;
alter table public.roles                enable row level security;
alter table public.departments          enable row level security;
alter table public.shifts               enable row level security;
alter table public.employees            enable row level security;
alter table public.user_company_context enable row level security;
alter table public.doc_no_counters      enable row level security;

-- companies：看得到自己有員工身分的公司（老闆兩家、平台管理員全部）
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (id in (select public.user_company_ids()));
drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies for update to authenticated
  using (id = public.current_company_id() and public.has_perm('company_settings','edit'))
  with check (id = public.current_company_id() and public.has_perm('company_settings','edit'));

-- profiles：只讀自己；只能改 display_name（旗標欄位由 trigger 擋）
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create or replace function public.protect_profile_flags()
returns trigger language plpgsql set search_path = public as $$
begin
  -- service_role / postgres 放行；一般登入者不得自行改平台管理員旗標
  if auth.role() = 'authenticated' and new.is_platform_admin <> old.is_platform_admin then
    raise exception '不可自行修改平台管理員旗標';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_flags() from public, anon, authenticated;
drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_flags();

-- roles：同公司可讀；寫需 roles:edit
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('roles','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('roles','edit'));

-- departments
drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('employees','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('employees','edit'));

-- shifts
drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('company_settings','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('company_settings','edit'));

-- employees：同公司皆可讀（指派下拉需要姓名）；寫需 employees:edit
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists employees_write on public.employees;
create policy employees_write on public.employees for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('employees','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('employees','edit'));

-- 有 employees:edit 的 manager 不得把人設成 owner 層級、不得改 can_switch_company（僅 owner）
create or replace function public.protect_employee_privilege()
returns trigger language plpgsql set search_path = public as $$
declare v_new_tier text;
begin
  -- service_role / SQL（無登入者）或 owner 放行；只約束一般登入者
  if auth.role() is distinct from 'authenticated' or public.is_owner() then return new; end if;
  select tier into v_new_tier from public.roles where id = new.role_id;
  if v_new_tier = 'owner' then
    raise exception '只有老闆可以指派老闆層級的角色';
  end if;
  if tg_op = 'UPDATE' then
    if new.can_switch_company <> old.can_switch_company then
      raise exception '只有老闆可以設定跨公司權限';
    end if;
    if exists (select 1 from public.roles where id = old.role_id and tier = 'owner') then
      raise exception '不可修改老闆層級的員工';
    end if;
  elsif new.can_switch_company then
    raise exception '只有老闆可以設定跨公司權限';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_employee_privilege() from public, anon, authenticated;
drop trigger if exists trg_employees_privilege on public.employees;
create trigger trg_employees_privilege before insert or update on public.employees
  for each row execute function public.protect_employee_privilege();

-- user_company_context：只讀自己；寫一律走 switch_company()/ensure_company_context()
drop policy if exists ucc_read on public.user_company_context;
create policy ucc_read on public.user_company_context for select to authenticated
  using (user_id = (select auth.uid()));

-- doc_no_counters：前端不可讀寫
drop policy if exists docno_none on public.doc_no_counters;
create policy docno_none on public.doc_no_counters for select to authenticated using (false);

-- 給 anon 的登入頁公司清單（只露四欄；用函式而非 security definer view，避開 linter ERROR）
create or replace function public.login_companies()
returns table(code text, name text, login_domain text, theme_color text)
language sql stable security definer set search_path = public as $$
  select code, name, login_domain, theme_color from companies where is_active order by code
$$;
revoke all on function public.login_companies() from public;
grant execute on function public.login_companies() to anon, authenticated;

-- =============================================================
-- 13. 種子：兩家公司 + 各三個內建角色 + 日班
--     ★ tax_id / address / phone / lat / lng 待易老闆提供後以 UPDATE 補上
-- =============================================================
insert into public.companies (code, name, short_name, invoice_entity, lat, lng, clock_radius_m, line_channel_key, login_domain, theme_color)
values
  ('XX', '祥興數位影印廣告印刷', '祥興印刷', '祥興數位影印廣告印刷', 24.0000000, 120.5000000, 150, 'XX', 'xiangxing.local', 'cyan'),
  ('YR', '沂融企業社',           '沂融',     '沂融企業社',           24.0000000, 120.5000000, 150, 'YR', 'yirong.local',    'orange')
on conflict (code) do nothing;

insert into public.roles (company_id, code, name, tier, is_system, sort_order)
select c.id, v.code, v.name, v.tier, true, v.so
from public.companies c
cross join (values ('owner','老闆','owner',1), ('manager','店長','manager',2), ('staff','員工','staff',3)) as v(code, name, tier, so)
on conflict (company_id, code) do nothing;

insert into public.shifts (company_id, name, start_time, end_time, break_minutes, late_tolerance_minutes)
select c.id, '日班', '08:30', '17:30', 60, 5
from public.companies c
where not exists (select 1 from public.shifts s where s.company_id = c.id and s.name = '日班');

-- =============================================================
-- 14. Edge Function 專用 helper（僅 service_role 可呼叫）
-- =============================================================
create or replace function public.find_user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from auth.refresh_tokens where user_id = p_user_id::text
     or session_id in (select id from auth.sessions where user_id = p_user_id);
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
