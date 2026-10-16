-- 024：產品主檔納入模組與選單（原本頁面用 module "products" 但 registry 沒有，主管進不去）
insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('products', '產品主檔', 'settings', true, 15, true)
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, 'products', true from public.companies c
on conflict do nothing;

insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'products', true, true, true, r.code = 'owner', true
  from public.roles r where r.code in ('owner', 'manager')
on conflict do nothing;

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'products', (select id from public.menus where menu_key = 'grp_settings'), '產品主檔', 'Package', '/dashboard/products', 'products', 15, true
where not exists (select 1 from public.menus where menu_key = 'products');
