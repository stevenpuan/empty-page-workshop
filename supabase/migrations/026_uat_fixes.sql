-- =====================================================================
-- 026：2026-10-16 介面實測（UAT）發現的問題
-- =====================================================================

-- 1. 訂單稅額預設改為 null：未帶稅額時由 trigger 以 5% 計（原本預設 0 使 5% 規則失效）
alter table public.orders alter column tax_amount set default null;

-- 2. 交期／日期合理範圍（實測可輸入西元 202610 年）
update public.orders set due_date = make_date(2026, extract(month from due_date)::int, extract(day from due_date)::int)
 where due_date > date '2100-12-31' and extract(year from due_date) between 202600 and 202699;
update public.order_tasks set due_at = make_date(2026, extract(month from due_at)::int, extract(day from due_at)::int)
 where due_at > date '2100-12-31' and extract(year from due_at) between 202600 and 202699;
alter table public.orders add constraint orders_due_date_range
  check (due_date is null or due_date between date '2000-01-01' and date '2100-12-31');

-- 3. 訂單成本彙總：每張訂單都有一列（沒有成本也要顯示營收），並提供未稅營收
create or replace view public.order_cost_summary with (security_invoker = true) as
select o.id as order_id,
       o.company_id,
       o.order_no,
       o.item_name,
       o.amount_total as order_amount,
       coalesce(sum(oc.amount) filter (where oc.cost_type = 'material'), 0) as material_cost,
       coalesce(sum(oc.amount) filter (where oc.cost_type = 'outsource'), 0) as outsource_cost,
       coalesce(sum(oc.amount) filter (where oc.cost_type = 'labor'), 0) as labor_cost,
       coalesce(sum(oc.amount) filter (where oc.cost_type = 'other'), 0) as other_cost,
       coalesce(sum(oc.amount), 0) as total_cost,
       coalesce(o.amount_untaxed, 0) - coalesce(sum(oc.amount), 0) as gross_profit,
       coalesce(o.amount_untaxed, 0) as order_amount_untaxed
  from public.orders o
  left join public.order_costs oc on oc.order_id = o.id
 group by o.id, o.company_id, o.order_no, o.item_name, o.amount_total, o.amount_untaxed;
revoke all on public.order_cost_summary from anon;
grant select on public.order_cost_summary to authenticated;

-- 4. 「帳號已建立」通知：實際綁上登入帳號時才發（原本新增員工資料就發，且建帳號時反而不發）
create or replace function public.trg_notify_account_created()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.user_id is not distinct from new.user_id then return new; end if;
  perform emit_notification(
    new.company_id, 'account_created', 'employee', new.id,
    null,
    '帳號已建立',
    '新員工 ' || coalesce(new.name, '-') || '（' || coalesce(new.emp_no, '-') || '）帳號已建立',
    ''
  );
  return new;
end $$;
create trigger trg_notify_account_created_upd after update of user_id on public.employees
  for each row execute function public.trg_notify_account_created();
revoke execute on function public.trg_notify_account_created() from public, anon, authenticated;
