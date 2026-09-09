-- =============================================================
-- 005_masters.sql — S2 主檔（客戶、廠商、品項、工序站別、工序範本）
-- Sprint: S2 主檔與訂單
-- 相依: 001_core_tenant.sql（companies, employees, set_updated_at）
-- =============================================================

-- =============================================================
-- 1. 客戶 customers
-- =============================================================
create table if not exists public.customers (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  customer_code          text not null,
  name                   text not null,
  tax_id                 text,
  contact                text,
  phone                  text,
  address                text,
  payment_term           text not null default 'cash'
                           check (payment_term in ('cash','net30','net60','net90','monthly_15','monthly_end')),
  is_internal_partner    boolean not null default false,
  note                   text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint customers_code_uk unique (company_id, customer_code)
);
create index if not exists idx_customers_company on public.customers(company_id);

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

-- =============================================================
-- 2. 廠商 vendors
--    ★ linked_company_id / auto_dispatch / partner_routing_template_id
--      於 S4（007_cross_company.sql）才新增
-- =============================================================
create table if not exists public.vendors (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  vendor_code            text not null,
  name                   text not null,
  tax_id                 text,
  vendor_type            text not null default '其他'
                           check (vendor_type in ('紙材','油墨版材','外包印刷','後加工','設備耗材','其他')),
  contact                text,
  phone                  text,
  payment_term           text not null default 'cash'
                           check (payment_term in ('cash','net30','net60','net90','monthly_15','monthly_end')),
  bank_account           text,
  is_outsource           boolean not null default false,
  note                   text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint vendors_code_uk unique (company_id, vendor_code)
);
create index if not exists idx_vendors_company on public.vendors(company_id);

drop trigger if exists trg_vendors_updated on public.vendors;
create trigger trg_vendors_updated before update on public.vendors
  for each row execute function public.set_updated_at();

-- =============================================================
-- 3. 工序站別 work_stations
-- =============================================================
create table if not exists public.work_stations (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  code                   text not null,
  name                   text not null,
  sort_order             int not null default 10,
  is_outsource_capable   boolean not null default false,
  default_owner_id       uuid references public.employees(id) on delete set null,
  color                  text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint work_stations_code_uk unique (company_id, code)
);
create index if not exists idx_work_stations_company on public.work_stations(company_id);

drop trigger if exists trg_work_stations_updated on public.work_stations;
create trigger trg_work_stations_updated before update on public.work_stations
  for each row execute function public.set_updated_at();

-- =============================================================
-- 4. 工序範本 routing_templates
-- =============================================================
create table if not exists public.routing_templates (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  product_category       text not null
                           check (product_category in ('名片','布條帆布','明信片DM','純代印','紙盒','貼紙','其他')),
  name                   text not null,
  is_default             boolean not null default false,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint routing_templates_name_uk unique (company_id, product_category, name)
);
create index if not exists idx_routing_templates_company on public.routing_templates(company_id);

drop trigger if exists trg_routing_templates_updated on public.routing_templates;
create trigger trg_routing_templates_updated before update on public.routing_templates
  for each row execute function public.set_updated_at();

-- =============================================================
-- 5. 工序範本步驟 routing_template_steps
-- =============================================================
create table if not exists public.routing_template_steps (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  template_id            uuid not null references public.routing_templates(id) on delete cascade,
  station_id             uuid not null references public.work_stations(id) on delete restrict,
  step_no                int not null,
  offset_days            int not null default 0,
  is_optional            boolean not null default false,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint routing_steps_order_uk unique (template_id, step_no)
);
create index if not exists idx_routing_steps_company on public.routing_template_steps(company_id);
create index if not exists idx_routing_steps_template on public.routing_template_steps(template_id);

drop trigger if exists trg_routing_steps_updated on public.routing_template_steps;
create trigger trg_routing_steps_updated before update on public.routing_template_steps
  for each row execute function public.set_updated_at();

-- =============================================================
-- 6. 品項 products
-- =============================================================
create table if not exists public.products (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  product_code           text not null,
  name                   text not null,
  category               text not null default '其他'
                           check (category in ('名片','布條帆布','明信片DM','純代印','紙盒','貼紙','其他')),
  spec_template          text,
  unit                   text not null default '張',
  default_routing_template_id uuid references public.routing_templates(id) on delete set null,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id),
  constraint products_code_uk unique (company_id, product_code)
);
create index if not exists idx_products_company on public.products(company_id);

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

-- =============================================================
-- 7. 啟用 RLS
-- =============================================================
alter table public.customers              enable row level security;
alter table public.vendors                enable row level security;
alter table public.work_stations          enable row level security;
alter table public.routing_templates      enable row level security;
alter table public.routing_template_steps enable row level security;
alter table public.products               enable row level security;

-- =============================================================
-- 8. RLS 政策
--    讀：同公司皆可讀（下拉選單需要）
--    寫：owner 或 manager（UI 再由 has_perm 收斂）
--    ★ 平台管理員由 helper 函式內建支援（is_manager() 對平台管理員恆 true）
--      → 不需要，平台管理員用 is_platform_admin() 判斷
--      → 實際上平台管理員沒有員工身分時 current_company_id() 為 null，
--        不會通過 company_id = current_company_id() 條件。
--        因此平台管理員需要先切到該公司才能操作。這是設計上的正確行為。
-- =============================================================

-- ---------- customers ----------
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select
  using (company_id = public.current_company_id());

drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers for all
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- ---------- vendors ----------
drop policy if exists vendors_read on public.vendors;
create policy vendors_read on public.vendors for select
  using (company_id = public.current_company_id());

drop policy if exists vendors_write on public.vendors;
create policy vendors_write on public.vendors for all
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- ---------- work_stations ----------
drop policy if exists work_stations_read on public.work_stations;
create policy work_stations_read on public.work_stations for select
  using (company_id = public.current_company_id());

-- 工序站別為設定類：僅 owner 可寫
drop policy if exists work_stations_write on public.work_stations;
create policy work_stations_write on public.work_stations for all
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- ---------- routing_templates ----------
drop policy if exists routing_templates_read on public.routing_templates;
create policy routing_templates_read on public.routing_templates for select
  using (company_id = public.current_company_id());

drop policy if exists routing_templates_write on public.routing_templates;
create policy routing_templates_write on public.routing_templates for all
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- ---------- routing_template_steps ----------
drop policy if exists routing_steps_read on public.routing_template_steps;
create policy routing_steps_read on public.routing_template_steps for select
  using (company_id = public.current_company_id());

drop policy if exists routing_steps_write on public.routing_template_steps;
create policy routing_steps_write on public.routing_template_steps for all
  using (company_id = public.current_company_id() and public.is_owner())
  with check (company_id = public.current_company_id() and public.is_owner());

-- ---------- products ----------
drop policy if exists products_read on public.products;
create policy products_read on public.products for select
  using (company_id = public.current_company_id());

drop policy if exists products_write on public.products;
create policy products_write on public.products for all
  using (company_id = public.current_company_id() and public.is_manager())
  with check (company_id = public.current_company_id() and public.is_manager());

-- =============================================================
-- 9. 稽核 trigger（敏感設定表）
--    ★ audit_row_change() 已在 003_system_base.sql 建立
-- =============================================================
drop trigger if exists trg_audit_customers on public.customers;
create trigger trg_audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_vendors on public.vendors;
create trigger trg_audit_vendors after insert or update or delete on public.vendors
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_work_stations on public.work_stations;
create trigger trg_audit_work_stations after insert or update or delete on public.work_stations
  for each row execute function public.audit_row_change();

-- =============================================================
-- 驗證（手動跑）
-- =============================================================
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and rowsecurity = false;
-- 預期：0 rows
--
-- select tablename, policyname, cmd from pg_policies
--   where schemaname='public' order by tablename, policyname;
