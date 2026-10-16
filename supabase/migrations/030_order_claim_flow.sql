-- =====================================================================
-- 030：訂單到派工簡化（小公司「誰有空誰接」）
--
--  1. 預設流程改為三步：設計 → 製作 → 出貨（沂融：設計 → 製作 → 品檢交件）
--     沒選產品、沒選範本的訂單也會套用公司預設流程
--  2. 建單時可指定「設計由誰做」（orders.designer_id），其他工序不指定人
--  3. 工序依序開放：前一步完成，下一步才能接；輪到的那一步通知全公司「有新工作可接」
--  4. task_claim「我來做」＝接下並開始；LINE 通知有「我來做」「做好了」按鈕
--  5. 績效統計 performance_stats(月份)：每人完成工序、快單、準時率、經手快單營收
-- =====================================================================

-- ---------- 1. 站別與三步流程 ----------
alter table public.routing_templates add column if not exists is_company_default boolean not null default false;
alter table public.orders add column if not exists designer_id uuid references public.employees(id);
create index if not exists idx_orders_designer on public.orders (designer_id);

-- 沂融補「設計」站；兩家補「製作」站
insert into public.work_stations (company_id, code, name, sort_order, is_outsource_capable, color, is_active)
select c.id, 'DESIGN', '設計', 15, false, 'violet', true
  from public.companies c
 where c.code = 'YR'
   and not exists (select 1 from public.work_stations s where s.company_id = c.id and s.code = 'DESIGN');
insert into public.work_stations (company_id, code, name, sort_order, is_outsource_capable, color, is_active)
select c.id, 'MAKE', '製作', 45, c.code = 'XX', 'amber', true
  from public.companies c
 where c.code in ('XX', 'YR')
   and not exists (select 1 from public.work_stations s where s.company_id = c.id and s.code = 'MAKE');

-- 三步範本（每家一個，設為公司預設）
insert into public.routing_templates (company_id, product_category, name, is_default, is_active, is_company_default)
select c.id, '其他', '標準三步（設計→製作→出貨）', true, true, true
  from public.companies c
 where c.code in ('XX', 'YR')
   and not exists (select 1 from public.routing_templates t where t.company_id = c.id and t.is_company_default);

insert into public.routing_template_steps (company_id, template_id, station_id, step_no, offset_days)
select t.company_id, t.id, s.id, v.step_no, v.offset_days
  from public.routing_templates t
  join public.companies c on c.id = t.company_id
 cross join (values ('DESIGN', 1, 2), ('MAKE', 2, 1), ('SHIP', 3, 0)) as v(code, step_no, offset_days)
  join public.work_stations s
    on s.company_id = t.company_id
   and s.code = case when v.code = 'SHIP' and c.code = 'YR' then 'QCSHIP' else v.code end
 where t.is_company_default
   and not exists (select 1 from public.routing_template_steps x where x.template_id = t.id);

-- 產品預設流程改用三步（易老闆確認細流程後可在產品主檔改回）
update public.products p
   set default_routing_template_id = (select t.id from public.routing_templates t
                                       where t.company_id = p.company_id and t.is_company_default limit 1)
 where exists (select 1 from public.routing_templates t where t.company_id = p.company_id and t.is_company_default);

-- 沒選範本時：產品預設 → 產品分類預設 → 公司預設
create or replace function public.trg_order_default_template_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_cat text;
begin
  if new.routing_template_id is null and new.source_link_id is null then
    if new.product_id is not null then
      select default_routing_template_id, category into new.routing_template_id, v_cat
        from products where id = new.product_id and company_id = new.company_id;
      if new.routing_template_id is null and v_cat is not null then
        select id into new.routing_template_id from routing_templates
         where company_id = new.company_id and product_category = v_cat and is_active and is_default
         order by created_at limit 1;
      end if;
    end if;
    if new.routing_template_id is null then
      select id into new.routing_template_id from routing_templates
       where company_id = new.company_id and is_company_default and is_active
       order by created_at limit 1;
    end if;
  end if;
  return new;
end $$;

-- 展開工序：設計站帶入訂單指定的設計人員（其他站不指定人）
create or replace function public.expand_order_tasks(p_order_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_order record; v_step record; v_count int := 0; v_owner uuid;
begin
  select o.id, o.company_id, o.due_date, o.routing_template_id, o.designer_id
    into v_order from orders o where o.id = p_order_id;
  if v_order is null then raise exception 'order not found: %', p_order_id; end if;
  if v_order.routing_template_id is null then return 0; end if;

  delete from order_tasks where order_id = p_order_id;

  for v_step in
    select s.station_id, s.step_no, s.offset_days, ws.default_owner_id, ws.code
      from routing_template_steps s
      join work_stations ws on ws.id = s.station_id
     where s.template_id = v_order.routing_template_id
     order by s.step_no
  loop
    v_owner := case when v_step.code = 'DESIGN' and v_order.designer_id is not null
                    then v_order.designer_id else v_step.default_owner_id end;
    insert into order_tasks (company_id, order_id, station_id, step_no, assignee_id, due_at, status)
    values (v_order.company_id, p_order_id, v_step.station_id, v_step.step_no, v_owner,
            case when v_order.due_date is not null then v_order.due_date - v_step.offset_days else null end,
            case when v_owner is null then 'pending' else 'assigned' end);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------- 2. 通知 ----------
insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind, is_enabled, params,
                                       recipient_scopes, in_app_enabled, line_enabled, line_mode, template_title)
select c.id, 'task_available', '有新工作可接', 'dispatch', 'event', true, '{}'::jsonb,
       array['all_company'], true, true, 'immediate', '有新工作可接'
  from public.companies c
on conflict do nothing;

-- 這道工序是否輪到了（前面的工序都完成或跳過）
create or replace function public._task_is_current(p_task order_tasks)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not exists (select 1 from order_tasks t
                      where t.order_id = p_task.order_id and t.step_no < p_task.step_no
                        and t.status not in ('done', 'skipped'));
$$;

create or replace function public._task_label(p_task order_tasks)
returns text language sql stable security definer set search_path to 'public' as $$
  select o.order_no || '｜' || o.item_name || '｜' || s.name
      || '（第 ' || p_task.step_no || '/' || (select count(*) from order_tasks x where x.order_id = p_task.order_id) || ' 步）'
      || coalesce('｜交期 ' || to_char(p_task.due_at, 'MM/DD'), '')
    from orders o, work_stations s
   where o.id = p_task.order_id and s.id = p_task.station_id;
$$;

create or replace function public._task_notify(p_task order_tasks, p_rule text, p_title text, p_body text,
                                               p_targets uuid[], p_exclude uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r notification_rules; v_emp uuid; v_n int := 0; v_status text;
begin
  select * into r from notification_rules where company_id = p_task.company_id and rule_code = p_rule;
  if r is null or not r.is_enabled or (not r.in_app_enabled and not r.line_enabled) then return 0; end if;
  v_status := case when not r.line_enabled then 'skipped' when r.line_mode = 'digest' then 'digest' else 'pending' end;
  for v_emp in
    select distinct u from unnest(coalesce(p_targets, '{}')) u
     where u is not null and u is distinct from p_exclude
       and exists (select 1 from employees e where e.id = u and e.is_active and e.company_id = p_task.company_id)
  loop
    insert into notifications (company_id, rule_code, ref_type, ref_id, employee_id, title, body, line_status)
    values (p_task.company_id, p_rule, 'order_task', p_task.id, v_emp, p_title, p_body, v_status);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 輪到某道工序時通知：有指定人（設計）只通知他，否則通知全公司
create or replace function public._task_announce(p_task order_tasks, p_exclude uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_targets uuid[];
begin
  if p_task.status not in ('pending', 'assigned') then return; end if;
  if exists (select 1 from orders o where o.id = p_task.order_id and o.status <> 'active') then return; end if;
  if p_task.assignee_id is not null then
    v_targets := array[p_task.assignee_id];
  else
    select coalesce(array_agg(id), '{}') into v_targets from employees
     where company_id = p_task.company_id and is_active;
  end if;
  perform _task_notify(p_task, 'task_available',
    case when p_task.assignee_id is not null then '輪到你的工作' else '有新工作可接' end,
    _task_label(p_task), v_targets, p_exclude);
end $$;

create or replace function public.trg_order_tasks_announce_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_next order_tasks;
begin
  if tg_op = 'INSERT' then
    -- 展開時依步驟順序寫入：第一步寫入時前面沒有工序
    if not exists (select 1 from order_tasks t where t.order_id = new.order_id and t.step_no < new.step_no) then
      perform _task_announce(new, public.current_employee_id());
    end if;
    return new;
  end if;
  if new.status in ('done', 'skipped') and old.status not in ('done', 'skipped') then
    for v_next in
      select * from order_tasks t
       where t.order_id = new.order_id and t.step_no > new.step_no and t.status in ('pending', 'assigned')
         and _task_is_current(t)
       order by t.step_no
    loop
      perform _task_announce(v_next, null);
    end loop;
  end if;
  return new;
end $$;
create trigger trg_order_tasks_announce after insert or update of status on public.order_tasks
  for each row execute function public.trg_order_tasks_announce_fn();

-- ---------- 3. 我來做／做好了 ----------
create or replace function public._task_claim(p_actor uuid, p_task uuid)
returns order_tasks language plpgsql security definer set search_path to 'public' as $$
declare v_t order_tasks; v_who text;
begin
  select * into v_t from order_tasks where id = p_task for update;
  if not found then raise exception 'P0002: 找不到這道工序'; end if;
  if not exists (select 1 from employees where id = p_actor and company_id = v_t.company_id and is_active) then
    raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501';
  end if;
  if exists (select 1 from orders o where o.id = v_t.order_id and o.status <> 'active') then
    raise exception 'P0001: 這張訂單不在進行中';
  end if;
  if v_t.status = 'in_progress' and v_t.assignee_id = p_actor then return v_t; end if;
  if v_t.status not in ('pending', 'assigned') then
    select name into v_who from employees where id = v_t.assignee_id;
    raise exception 'P0001: 這道工序已經%', case v_t.status
      when 'in_progress' then '被 ' || coalesce(v_who, '別人') || ' 接走了'
      when 'done' then '完成了' when 'skipped' then '跳過了' when 'outsourced' then '外包出去了'
      else '不能接（' || v_t.status || '）' end;
  end if;
  if v_t.status = 'assigned' and v_t.assignee_id is distinct from p_actor and not _qj_is_manager(p_actor) then
    select name into v_who from employees where id = v_t.assignee_id;
    raise exception 'P0001: 這道工序指定給 %', coalesce(v_who, '別人');
  end if;
  if not _task_is_current(v_t) then raise exception 'P0001: 前面的工序還沒完成，還不能接'; end if;
  update order_tasks set assignee_id = p_actor, status = 'in_progress', updated_by = p_actor
   where id = p_task returning * into v_t;
  return v_t;
end $$;

create or replace function public._task_finish(p_actor uuid, p_task uuid)
returns order_tasks language plpgsql security definer set search_path to 'public' as $$
declare v_t order_tasks;
begin
  select * into v_t from order_tasks where id = p_task for update;
  if not found then raise exception 'P0002: 找不到這道工序'; end if;
  if not exists (select 1 from employees where id = p_actor and company_id = v_t.company_id and is_active) then
    raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501';
  end if;
  if v_t.status = 'done' then return v_t; end if;
  if v_t.assignee_id is distinct from p_actor and not _qj_is_manager(p_actor) then
    raise exception 'P0005: 這道工序不是你接的' using errcode = '42501';
  end if;
  if v_t.status in ('assigned', 'pending') then
    if not _task_is_current(v_t) then raise exception 'P0001: 前面的工序還沒完成'; end if;
    update order_tasks set assignee_id = coalesce(assignee_id, p_actor), status = 'in_progress', updated_by = p_actor
     where id = p_task;
  elsif v_t.status not in ('in_progress', 'blocked', 'waiting_customer') then
    raise exception 'P0001: 這道工序目前不能標記完成';
  elsif v_t.status in ('blocked', 'waiting_customer') then
    update order_tasks set status = 'in_progress', updated_by = p_actor where id = p_task;
  end if;
  update order_tasks set status = 'done', updated_by = p_actor where id = p_task returning * into v_t;
  return v_t;
end $$;

create or replace function public._task_result(p_t order_tasks)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'ok', true, 'task_id', p_t.id, 'new_status', p_t.status, 'order_id', p_t.order_id,
    'order_no', (select order_no from orders where id = p_t.order_id),
    'label', _task_label(p_t),
    'station_code', (select code from work_stations where id = p_t.station_id),
    'order_all_done', not exists (select 1 from order_tasks x where x.order_id = p_t.order_id and x.status not in ('done', 'skipped')),
    'only_ship_left', not exists (select 1 from order_tasks x join work_stations s on s.id = x.station_id
                                   where x.order_id = p_t.order_id and x.status not in ('done', 'skipped')
                                     and s.code not in ('SHIP', 'QCSHIP')));
$$;

create or replace function public.task_claim(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_emp uuid := public.current_employee_id();
begin
  if v_emp is null then raise exception 'P0005: 你在這家公司沒有員工身分' using errcode = '42501'; end if;
  return _task_result(_task_claim(v_emp, p_task_id));
end $$;

create or replace function public.task_finish(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_emp uuid := public.current_employee_id();
begin
  if v_emp is null then raise exception 'P0005: 你在這家公司沒有員工身分' using errcode = '42501'; end if;
  return _task_result(_task_finish(v_emp, p_task_id));
end $$;

-- LINE 按鈕（service role）
create or replace function public.line_task_action(p_line_user_id text, p_action text, p_task_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_t order_tasks; v_actor uuid;
begin
  select * into v_t from order_tasks where id = p_task_id;
  if not found then raise exception 'P0002: 找不到這道工序'; end if;
  select employee_id into v_actor from _qj_line_employees(p_line_user_id) where company_id = v_t.company_id limit 1;
  if v_actor is null then raise exception 'P0005: 你不是這家公司的員工，或 LINE 還沒綁定'; end if;
  if p_action = 'claim' then v_t := _task_claim(v_actor, p_task_id);
  elsif p_action = 'done' then v_t := _task_finish(v_actor, p_task_id);
  else raise exception 'P0001: 不支援的動作 %', p_action;
  end if;
  return _task_result(v_t);
end $$;

-- 目前可以接的工作（LINE「工作」指令）
create or replace function public.line_task_list(p_line_user_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from _qj_line_employees(p_line_user_id)) then
    raise exception 'P0005: 這個 LINE 還沒綁定員工，請先輸入 6 碼綁定碼';
  end if;
  return jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'label', _task_label(t)) order by t.due_at nulls last, t.created_at)
        from order_tasks t join orders o on o.id = t.order_id
       where t.company_id in (select company_id from _qj_line_employees(p_line_user_id))
         and o.status = 'active' and t.status = 'pending' and _task_is_current(t)), '[]'),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'label', _task_label(t), 'status', t.status) order by t.due_at nulls last)
        from order_tasks t join orders o on o.id = t.order_id
       where t.assignee_id in (select employee_id from _qj_line_employees(p_line_user_id))
         and o.status = 'active' and t.status in ('assigned', 'in_progress', 'blocked', 'waiting_customer')), '[]'));
end $$;

-- _task_result 要看到同一個指令裡剛更新的工序，不能宣告為 stable
alter function public._task_result(order_tasks) volatile;

-- 誰有空誰接：除了「設計」，站別不預設負責人
update public.work_stations set default_owner_id = null where code <> 'DESIGN' and default_owner_id is not null;

-- ---------- 4. 績效統計 ----------
create or replace function public.performance_stats(p_month date)
returns table (employee_id uuid, employee_name text, tasks_done int, tasks_on_time int,
               quick_done int, quick_on_time int, quick_amount numeric, avg_task_hours numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_cid uuid := public.current_company_id();
  v_from timestamptz := (date_trunc('month', p_month)::date)::timestamp at time zone 'Asia/Taipei';
  v_to timestamptz := ((date_trunc('month', p_month) + interval '1 month')::date)::timestamp at time zone 'Asia/Taipei';
begin
  if not public.is_manager() then raise exception 'P0005: 只有主管以上可以看績效' using errcode = '42501'; end if;
  return query
  select e.id, e.name,
    (select count(*)::int from order_tasks t where t.assignee_id = e.id and t.status = 'done'
       and t.done_at >= v_from and t.done_at < v_to),
    (select count(*)::int from order_tasks t where t.assignee_id = e.id and t.status = 'done'
       and t.done_at >= v_from and t.done_at < v_to
       and (t.due_at is null or (t.done_at at time zone 'Asia/Taipei')::date <= t.due_at)),
    (select count(*)::int from quick_jobs q where q.assignee_id = e.id and q.done_at >= v_from and q.done_at < v_to
       and q.status <> 'cancelled'),
    (select count(*)::int from quick_jobs q where q.assignee_id = e.id and q.done_at >= v_from and q.done_at < v_to
       and q.status <> 'cancelled' and (q.pickup_at is null or q.done_at <= q.pickup_at)),
    (select coalesce(sum(q.amount_total), 0) from quick_jobs q where q.assignee_id = e.id and q.status = 'closed'
       and q.closed_at >= v_from and q.closed_at < v_to),
    (select round(avg(extract(epoch from (t.done_at - t.started_at)) / 3600)::numeric, 1) from order_tasks t
      where t.assignee_id = e.id and t.status = 'done' and t.started_at is not null
        and t.done_at >= v_from and t.done_at < v_to)
  from employees e
  where e.company_id = v_cid and e.is_active
  order by e.emp_no;
end $$;

insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('performance', '績效統計', 'ops', true, 60, true)
on conflict (module_key) do nothing;
insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, 'performance', true from public.companies c
on conflict do nothing;
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'performance', true, false, false, false, true
  from public.roles r where r.tier in ('owner', 'manager')
on conflict do nothing;
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'performance', (select id from public.menus where menu_key = 'grp_ops'), '績效統計', 'Trophy', '/dashboard/performance', 'performance', 50, true
where not exists (select 1 from public.menus where menu_key = 'performance');

-- ---------- 5. 權限 ----------
revoke execute on function public._task_is_current(order_tasks) from public, anon, authenticated;
revoke execute on function public._task_label(order_tasks) from public, anon, authenticated;
revoke execute on function public._task_notify(order_tasks, text, text, text, uuid[], uuid) from public, anon, authenticated;
revoke execute on function public._task_announce(order_tasks, uuid) from public, anon, authenticated;
revoke execute on function public.trg_order_tasks_announce_fn() from public, anon, authenticated;
revoke execute on function public._task_claim(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._task_finish(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._task_result(order_tasks) from public, anon, authenticated;
revoke execute on function public.task_claim(uuid) from public, anon;
revoke execute on function public.task_finish(uuid) from public, anon;
grant execute on function public.task_claim(uuid) to authenticated;
grant execute on function public.task_finish(uuid) to authenticated;
revoke execute on function public.line_task_action(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.line_task_list(text) from public, anon, authenticated;
grant execute on function public.line_task_action(text, text, uuid) to service_role;
grant execute on function public.line_task_list(text) to service_role;
revoke execute on function public.performance_stats(date) from public, anon;
grant execute on function public.performance_stats(date) to authenticated;
