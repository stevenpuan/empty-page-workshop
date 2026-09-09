-- =============================================================
-- 002_rbac_menus.sql
-- Sprint  : S1
-- 目的     : 模組登錄(module_registry)、資料驅動選單(menus)、公司模組開關(company_modules)、
--            角色權限矩陣(role_module_permissions) + 種子（選單樹、預設矩陣、兩家模組開關）
-- 相依     : 001_core_tenant.sql
-- 可重跑   : 是
-- 依據     : 《基礎架構整併分析 v1.0》§4.3、§5、附錄 A
-- =============================================================

-- =============================================================
-- 1. 模組登錄（全域）
-- =============================================================
create table if not exists public.module_registry (
  module_key       text primary key,
  name             text not null,
  category         text not null check (category in ('ops','finance','hr','settings','system')),
  default_enabled  boolean not null default true,
  sort_order       int not null default 10,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- =============================================================
-- 2. 選單（全域；呈現層）
-- =============================================================
create table if not exists public.menus (
  id          uuid primary key default gen_random_uuid(),
  menu_key    text unique not null,
  parent_id   uuid references public.menus(id) on delete cascade,
  title       text not null,
  icon        text,                                   -- lucide-react 匯出名
  route       text,
  module_key  text references public.module_registry(module_key) on delete set null,
  min_tier    text check (min_tier in ('owner','manager','staff')),
  sort_order  int not null default 10,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_menus_parent on public.menus(parent_id);

-- =============================================================
-- 3. 公司模組開關
-- =============================================================
create table if not exists public.company_modules (
  company_id  uuid not null references public.companies(id) on delete cascade,
  module_key  text not null references public.module_registry(module_key) on delete cascade,
  is_enabled  boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (company_id, module_key)
);
drop trigger if exists trg_company_modules_updated on public.company_modules;
create trigger trg_company_modules_updated before update on public.company_modules
  for each row execute function public.set_updated_at();

-- =============================================================
-- 4. 角色權限矩陣
-- =============================================================
create table if not exists public.role_module_permissions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  module_key  text not null references public.module_registry(module_key) on delete cascade,
  can_view    boolean not null default false,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  can_export  boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint rmp_role_module_uk unique (role_id, module_key)
);
create index if not exists idx_rmp_company on public.role_module_permissions(company_id);
create index if not exists idx_rmp_role_module on public.role_module_permissions(role_id, module_key);
drop trigger if exists trg_rmp_updated on public.role_module_permissions;
create trigger trg_rmp_updated before update on public.role_module_permissions
  for each row execute function public.set_updated_at();

-- company_id 必須與 role 的公司一致
create or replace function public.check_rmp_company()
returns trigger language plpgsql set search_path = public as $$
begin
  select company_id into new.company_id from public.roles where id = new.role_id;
  if new.company_id is null then raise exception '角色不存在'; end if;
  return new;
end;
$$;
revoke all on function public.check_rmp_company() from public, anon, authenticated;
drop trigger if exists trg_rmp_company on public.role_module_permissions;
create trigger trg_rmp_company before insert or update on public.role_module_permissions
  for each row execute function public.check_rmp_company();

-- 新公司建立時展開預設 company_modules
create or replace function public.seed_company_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.company_modules (company_id, module_key, is_enabled)
  select new.id, m.module_key, m.default_enabled from public.module_registry m where m.is_active
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.seed_company_modules() from public, anon, authenticated;
drop trigger if exists trg_companies_seed_modules on public.companies;
create trigger trg_companies_seed_modules after insert on public.companies
  for each row execute function public.seed_company_modules();

-- =============================================================
-- 5. RLS
-- =============================================================
alter table public.module_registry         enable row level security;
alter table public.menus                   enable row level security;
alter table public.company_modules         enable row level security;
alter table public.role_module_permissions enable row level security;

drop policy if exists module_registry_read on public.module_registry;
create policy module_registry_read on public.module_registry for select to authenticated using (true);
drop policy if exists module_registry_write on public.module_registry;
create policy module_registry_write on public.module_registry for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists menus_read on public.menus;
create policy menus_read on public.menus for select to authenticated using (true);
drop policy if exists menus_write on public.menus;
create policy menus_write on public.menus for all to authenticated
  using (public.has_perm('menus','edit')) with check (public.has_perm('menus','edit'));

drop policy if exists company_modules_read on public.company_modules;
create policy company_modules_read on public.company_modules for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists company_modules_write on public.company_modules;
create policy company_modules_write on public.company_modules for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('company_settings','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('company_settings','edit'));

drop policy if exists rmp_read on public.role_module_permissions;
create policy rmp_read on public.role_module_permissions for select to authenticated
  using (company_id = public.current_company_id());
drop policy if exists rmp_write on public.role_module_permissions;
create policy rmp_write on public.role_module_permissions for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('roles','edit'))
  with check (company_id = public.current_company_id() and public.has_perm('roles','edit'));

-- =============================================================
-- 6. 種子：模組登錄
-- =============================================================
insert into public.module_registry (module_key, name, category, default_enabled, sort_order) values
  ('dashboard',          '營運總覽',       'ops',      true, 10),
  ('orders',             '訂單與工單',     'ops',      true, 20),
  ('quotations',         '報價單',         'ops',      true, 30),
  ('board',              '派工看板',       'ops',      true, 40),
  ('my_work',            '我的工作',       'ops',      true, 50),
  ('outsource',          '外包追蹤',       'ops',      true, 60),
  ('customers',          '客戶主檔',       'ops',      true, 70),
  ('receivables',        '應收與收款',     'finance',  true, 80),
  ('vendors',            '廠商主檔',       'finance',  true, 90),
  ('purchases',          '進貨單',         'finance',  true, 100),
  ('payables',           '應付與付款',     'finance',  true, 110),
  ('clock',              '打卡',           'hr',       true, 120),
  ('attendance',         '出勤與簽核',     'hr',       true, 130),
  ('attendance_summary', '月出勤彙總',     'hr',       true, 140),
  ('group_overview',     '集團總覽',       'ops',      true, 150),
  ('stations',           '工序站別與範本', 'settings', true, 200),
  ('employees',          '員工與帳號',     'settings', true, 210),
  ('roles',              '角色與權限',     'settings', true, 220),
  ('notification_rules', '通知規則',       'settings', true, 230),
  ('company_settings',   '公司設定',       'settings', true, 240),
  ('lookups',            '代碼字典',       'settings', true, 250),
  ('menus',              '選單管理',       'system',   true, 300),
  ('system_configs',     '系統參數',       'system',   true, 310),
  ('audit_logs',         '稽核日誌',       'system',   true, 320),
  ('activity_logs',      '操作日誌',       'system',   true, 330),
  ('error_logs',         '錯誤日誌',       'system',   true, 340),
  ('changelog',          '版本更新',       'system',   true, 350)
on conflict (module_key) do update set name = excluded.name, category = excluded.category, sort_order = excluded.sort_order;

-- =============================================================
-- 7. 種子：選單樹（§5.2）
-- =============================================================
do $$
declare g_ops uuid; g_ar uuid; g_ap uuid; g_hr uuid; g_set uuid; g_sys uuid;
begin
  insert into public.menus (menu_key, title, icon, route, module_key, sort_order) values
    ('home', '營運總覽', 'LayoutDashboard', '/dashboard', 'dashboard', 1)
  on conflict (menu_key) do nothing;

  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_ops', '訂單與派工', 'ClipboardList', 10)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_ar', '客戶與應收', 'Users', 20)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_ap', '採購與應付', 'Truck', 30)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_hr', '出勤', 'Clock', 40)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, route, module_key, min_tier, sort_order) values
    ('group_overview', '集團總覽', 'Building2', '/dashboard/group', 'group_overview', 'owner', 50)
  on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_settings', '設定', 'Settings', 80)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_system', '系統', 'Wrench', 90)
    on conflict (menu_key) do nothing;
  insert into public.menus (menu_key, title, icon, route, sort_order) values
    ('notifications', '通知中心', 'Bell', '/dashboard/notifications', 95),
    ('profile', '個人設定', 'User', '/dashboard/profile', 99)
  on conflict (menu_key) do nothing;

  select id into g_ops from public.menus where menu_key = 'grp_ops';
  select id into g_ar  from public.menus where menu_key = 'grp_ar';
  select id into g_ap  from public.menus where menu_key = 'grp_ap';
  select id into g_hr  from public.menus where menu_key = 'grp_hr';
  select id into g_set from public.menus where menu_key = 'grp_settings';
  select id into g_sys from public.menus where menu_key = 'grp_system';

  insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order) values
    ('orders',    g_ops, '訂單與工單', 'FileText',     '/dashboard/orders',    'orders',    10),
    ('board',     g_ops, '派工看板',   'KanbanSquare', '/dashboard/board',     'board',     20),
    ('my_work',   g_ops, '我的工作',   'CheckSquare',  '/dashboard/my-work',   'my_work',   30),
    ('outsource', g_ops, '外包追蹤',   'Send',         '/dashboard/outsource', 'outsource', 40),

    ('customers',   g_ar, '客戶主檔',   'Contact',   '/dashboard/customers',   'customers',   10),
    ('quotations',  g_ar, '報價單',     'Receipt',   '/dashboard/quotations',  'quotations',  20),
    ('receivables', g_ar, '應收與收款', 'Wallet',    '/dashboard/receivables', 'receivables', 30),

    ('vendors',   g_ap, '廠商主檔',   'Store',     '/dashboard/vendors',   'vendors',   10),
    ('purchases', g_ap, '進貨單',     'PackagePlus','/dashboard/purchases', 'purchases', 20),
    ('payables',  g_ap, '應付與付款', 'Banknote',  '/dashboard/payables',  'payables',  30),

    ('clock',              g_hr, '打卡',       'Fingerprint',  '/dashboard/clock',              'clock',              10),
    ('attendance',         g_hr, '出勤與簽核', 'CalendarCheck','/dashboard/attendance',         'attendance',         20),
    ('attendance_summary', g_hr, '月出勤彙總', 'Table',        '/dashboard/attendance/summary', 'attendance_summary', 30),

    ('stations',           g_set, '工序站別與範本', 'Workflow',   '/dashboard/settings/stations',  'stations',           10),
    ('employees',          g_set, '員工與帳號',     'UserCog',    '/dashboard/settings/employees', 'employees',          20),
    ('roles',              g_set, '角色與權限',     'KeyRound',   '/dashboard/settings/roles',     'roles',              30),
    ('notification_rules', g_set, '通知規則',       'BellRing',   '/dashboard/settings/rules',     'notification_rules', 40),
    ('company_settings',   g_set, '公司設定',       'Building',   '/dashboard/settings/company',   'company_settings',   50),
    ('lookups',            g_set, '代碼字典',       'List',       '/dashboard/settings/lookups',   'lookups',            60),

    ('menus',          g_sys, '選單管理', 'Menu',          '/dashboard/system/menus',         'menus',          10),
    ('system_configs', g_sys, '系統參數', 'Settings2',     '/dashboard/system/configs',       'system_configs', 20),
    ('audit_logs',     g_sys, '稽核日誌', 'ShieldCheck',   '/dashboard/system/audit-logs',    'audit_logs',     30),
    ('activity_logs',  g_sys, '操作日誌', 'Activity',      '/dashboard/system/activity-logs', 'activity_logs',  40),
    ('error_logs',     g_sys, '錯誤日誌', 'AlertTriangle', '/dashboard/system/error-logs',    'error_logs',     50),
    ('changelog',      g_sys, '版本更新', 'History',       '/dashboard/system/changelog',     'changelog',      60)
  on conflict (menu_key) do nothing;
end $$;

-- =============================================================
-- 8. 種子：兩家公司模組開關（沂融關 quotations / group_overview）
-- =============================================================
insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, m.module_key, m.default_enabled
from public.companies c cross join public.module_registry m
on conflict do nothing;

update public.company_modules cm set is_enabled = false
from public.companies c
where cm.company_id = c.id and c.code = 'YR' and cm.module_key in ('quotations','group_overview');

-- =============================================================
-- 9. 種子：預設權限矩陣（附錄 A）
--    owner：全開（has_perm 對 owner 恆真，寫入僅供 UI 顯示）
-- =============================================================
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, m.module_key, true, true, true, true, true
from public.roles r cross join public.module_registry m
where r.code = 'owner'
on conflict (role_id, module_key) do nothing;

-- manager
with p(module_key, v, c, e, d, x) as (values
  ('dashboard',          true,  false, false, false, false),
  ('orders',             true,  true,  true,  false, true ),
  ('quotations',         true,  true,  true,  false, true ),
  ('board',              true,  true,  true,  false, false),
  ('my_work',            true,  false, true,  false, false),
  ('outsource',          true,  true,  true,  false, false),
  ('customers',          true,  true,  true,  false, true ),
  ('receivables',        true,  true,  true,  false, true ),
  ('vendors',            true,  true,  true,  false, true ),
  ('purchases',          true,  true,  true,  false, true ),
  ('payables',           true,  true,  true,  false, true ),
  ('clock',              true,  true,  false, false, false),
  ('attendance',         true,  false, true,  false, true ),
  ('attendance_summary', true,  false, false, false, true ),
  ('group_overview',     false, false, false, false, false),
  ('stations',           true,  false, false, false, false),
  ('employees',          true,  false, false, false, false),
  ('roles',              true,  false, false, false, false),
  ('notification_rules', true,  false, false, false, false),
  ('company_settings',   true,  false, false, false, false),
  ('lookups',            true,  false, false, false, false),
  ('menus',              false, false, false, false, false),
  ('system_configs',     false, false, false, false, false),
  ('audit_logs',         false, false, false, false, false),
  ('activity_logs',      false, false, false, false, false),
  ('error_logs',         false, false, false, false, false),
  ('changelog',          true,  false, false, false, false))
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, p.module_key, p.v, p.c, p.e, p.d, p.x
from public.roles r cross join p
where r.code = 'manager'
on conflict (role_id, module_key) do nothing;

-- staff
with p(module_key, v, c, e, d, x) as (values
  ('board',     true, false, false, false, false),
  ('my_work',   true, false, true,  false, false),
  ('clock',     true, true,  false, false, false),
  ('changelog', true, false, false, false, false))
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, p.module_key, p.v, p.c, p.e, p.d, p.x
from public.roles r cross join p
where r.code = 'staff'
on conflict (role_id, module_key) do nothing;
