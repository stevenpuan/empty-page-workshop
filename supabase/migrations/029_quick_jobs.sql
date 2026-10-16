-- =====================================================================
-- 029：快單（老闆／員工用 LINE 開單 → 快單看板 → 派工 → 完成 → 取件收款列入營收）
--
--  流程：待派工(new) → 已派工(assigned) → 製作中(in_progress) → 待取件(ready) → 已結案(closed)
--        任何未結案狀態可取消(cancelled)
--  權限：開單＝所有員工；派工、取消＝主管以上；開始／完成＝被派的人或主管；取件收款＝所有員工
--  金額：取件時才填。結案自動產生應收（來源「快單」），付現／轉帳同時建收款沖帳；
--        選「未收」則留在應收等之後收款。
--  寫入一律走 RPC；網頁用 quick_job_*，LINE webhook（service role）用 line_quick_*。
-- =====================================================================

-- ---------- 1. 應收來源加「快單」 ----------
alter table public.receivables drop constraint if exists receivables_source_type_check;
alter table public.receivables add constraint receivables_source_type_check
  check (source_type in ('outsource', 'delivery', 'manual', 'quick'));

-- ---------- 2. 資料表 ----------
create table if not exists public.quick_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  job_no text not null,
  title text not null,
  customer_name text,
  customer_phone text,
  customer_id uuid references public.customers(id),
  pickup_at timestamptz,
  note text,
  status text not null default 'new'
    check (status in ('new', 'assigned', 'in_progress', 'ready', 'closed', 'cancelled')),
  assignee_id uuid references public.employees(id),
  created_by_employee_id uuid references public.employees(id),
  source text not null default 'web' check (source in ('web', 'line')),
  raw_text text,
  assigned_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  closed_at timestamptz,
  closed_by_employee_id uuid references public.employees(id),
  amount_total numeric(14, 2),
  pay_method text check (pay_method in ('cash', 'transfer', 'other', 'unpaid')),
  tax_id text,
  receivable_id uuid references public.receivables(id),
  collection_id uuid references public.collections(id),
  cancel_reason text,
  last_actor_id uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint quick_jobs_no_uk unique (company_id, job_no),
  constraint quick_jobs_amount_chk check (amount_total is null or amount_total >= 0)
);
create index if not exists idx_quick_jobs_company_status on public.quick_jobs (company_id, status);
create index if not exists idx_quick_jobs_assignee on public.quick_jobs (assignee_id);
create index if not exists idx_quick_jobs_closed_at on public.quick_jobs (company_id, closed_at);
create index if not exists idx_quick_jobs_customer on public.quick_jobs (customer_id);
create index if not exists idx_quick_jobs_receivable on public.quick_jobs (receivable_id);
create index if not exists idx_quick_jobs_collection on public.quick_jobs (collection_id);
create index if not exists idx_quick_jobs_creator on public.quick_jobs (created_by_employee_id);
create index if not exists idx_quick_jobs_closer on public.quick_jobs (closed_by_employee_id);
create index if not exists idx_quick_jobs_actor on public.quick_jobs (last_actor_id);

create trigger trg_quick_jobs_updated before update on public.quick_jobs
  for each row execute function public.set_updated_at();

-- 照片（LINE 傳來的稿件、手寫需求）
create table if not exists public.quick_job_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  job_id uuid references public.quick_jobs(id) on delete cascade,
  employee_id uuid references public.employees(id),
  line_user_id text,
  storage_path text not null unique,
  content_type text,
  created_at timestamptz not null default now()
);
create index if not exists idx_quick_job_files_job on public.quick_job_files (job_id);
create index if not exists idx_quick_job_files_company on public.quick_job_files (company_id);
create index if not exists idx_quick_job_files_employee on public.quick_job_files (employee_id);
create index if not exists idx_quick_job_files_pending on public.quick_job_files (line_user_id, created_at) where job_id is null;

alter table public.quick_jobs enable row level security;
alter table public.quick_job_files enable row level security;
create policy quick_jobs_read on public.quick_jobs for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('quick_jobs', 'view'));
create policy quick_job_files_read on public.quick_job_files for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('quick_jobs', 'view'));
revoke all on public.quick_jobs, public.quick_job_files from anon, authenticated;
grant select on public.quick_jobs, public.quick_job_files to authenticated;

alter publication supabase_realtime add table public.quick_jobs;

-- 照片儲存（私有；只有同公司有快單權限的人能讀）
insert into storage.buckets (id, name, public)
values ('quick-job-files', 'quick-job-files', false)
on conflict (id) do nothing;
create policy quick_job_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'quick-job-files' and exists (
    select 1 from public.quick_job_files f
     where f.storage_path = storage.objects.name
       and f.company_id = public.current_company_id()
       and public.has_perm('quick_jobs', 'view')));

-- ---------- 3. 模組、選單、權限、通知規則 ----------
insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('quick_jobs', '快單', 'ops', true, 5, true)
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, 'quick_jobs', true from public.companies c
on conflict do nothing;

insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'quick_jobs', true, true, true, r.tier in ('owner', 'manager'), r.tier in ('owner', 'manager')
  from public.roles r
on conflict do nothing;

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'quick_jobs', (select id from public.menus where menu_key = 'grp_ops'), '快單看板', 'Zap', '/dashboard/quick', 'quick_jobs', 5, true
where not exists (select 1 from public.menus where menu_key = 'quick_jobs');

insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind, is_enabled, params,
                                       recipient_scopes, in_app_enabled, line_enabled, line_mode, template_title)
select c.id, v.code, v.name, 'dispatch', 'event', true, '{}'::jsonb, v.scopes, true, true, 'immediate', v.name
  from public.companies c
 cross join (values
   ('quick_job_new',       '新快單待派工', array['manager']),
   ('quick_job_assigned',  '快單派給你',   array['owner']),
   ('quick_job_ready',     '快單完成待取件', array['manager', 'owner']),
   ('quick_job_cancelled', '快單取消',     array['owner'])
 ) as v(code, name, scopes)
on conflict do nothing;

-- ---------- 4. 共用小工具 ----------
create or replace function public._qj_is_manager(p_emp uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from employees e join roles r on r.id = e.role_id
                  where e.id = p_emp and e.is_active and r.tier in ('owner', 'manager'));
$$;

-- 散客客戶（每家公司一筆，快單沒有指定客戶時用）
create or replace function public._qj_walkin_customer(p_company uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  select id into v_id from customers where company_id = p_company and customer_code = 'WALKIN';
  if v_id is null then
    insert into customers (company_id, customer_code, name, payment_term, note)
    values (p_company, 'WALKIN', '散客（現金）', 'cash', '快單自動建立，請勿刪除')
    on conflict (company_id, customer_code) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from customers where company_id = p_company and customer_code = 'WALKIN';
    end if;
  end if;
  return v_id;
end $$;

-- 發通知（依通知規則開關；排除動作者本人，避免自己收到自己的通知）
create or replace function public._qj_notify(p_job_id uuid, p_rule text, p_title text, p_body text,
                                             p_targets uuid[], p_exclude uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare r notification_rules; v_job quick_jobs; v_emp uuid; v_n int := 0; v_status text;
begin
  select * into v_job from quick_jobs where id = p_job_id;
  select * into r from notification_rules where company_id = v_job.company_id and rule_code = p_rule;
  if r is null or not r.is_enabled or (not r.in_app_enabled and not r.line_enabled) then return 0; end if;
  v_status := case when not r.line_enabled then 'skipped' when r.line_mode = 'digest' then 'digest' else 'pending' end;
  for v_emp in
    select distinct u from unnest(coalesce(p_targets, '{}')) u
     where u is not null and u is distinct from p_exclude
       and exists (select 1 from employees e where e.id = u and e.is_active and e.company_id = v_job.company_id)
  loop
    insert into notifications (company_id, rule_code, ref_type, ref_id, employee_id, title, body, line_status)
    values (v_job.company_id, p_rule, 'quick_job', v_job.id, v_emp, p_title, p_body, v_status);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public._qj_managers(p_company uuid)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(e.id), '{}') from employees e join roles r on r.id = e.role_id
   where e.company_id = p_company and e.is_active and r.tier in ('owner', 'manager');
$$;

create or replace function public._qj_summary(p_job quick_jobs)
returns text language sql stable security definer set search_path to 'public' as $$
  select p_job.job_no || '｜' || p_job.title
      || coalesce('｜' || nullif(concat_ws(' ', p_job.customer_name, p_job.customer_phone), ''), '')
      || coalesce('｜取件 ' || to_char(p_job.pickup_at at time zone 'Asia/Taipei', 'MM/DD HH24:MI'), '');
$$;

-- 狀態改變時通知
create or replace function public.trg_quick_jobs_notify_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_who text;
begin
  select name into v_who from employees where id = new.last_actor_id;
  if tg_op = 'INSERT' then
    if new.status = 'new' then
      perform _qj_notify(new.id, 'quick_job_new', '新快單待派工',
        _qj_summary(new) || coalesce(E'\n開單：' || v_who, ''), _qj_managers(new.company_id), new.last_actor_id);
    elsif new.status = 'assigned' then
      perform _qj_notify(new.id, 'quick_job_assigned', '快單派給你',
        _qj_summary(new) || coalesce(E'\n派工：' || v_who, ''), array[new.assignee_id], new.last_actor_id);
    end if;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
     and new.status in ('assigned', 'in_progress') then
    perform _qj_notify(new.id, 'quick_job_assigned', '快單派給你',
      _qj_summary(new) || coalesce(E'\n派工：' || v_who, ''), array[new.assignee_id], new.last_actor_id);
  end if;
  if new.status = 'ready' and old.status <> 'ready' then
    perform _qj_notify(new.id, 'quick_job_ready', '快單完成待取件',
      _qj_summary(new) || coalesce(E'\n完成：' || v_who, ''),
      _qj_managers(new.company_id) || new.created_by_employee_id, new.last_actor_id);
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform _qj_notify(new.id, 'quick_job_cancelled', '快單取消',
      _qj_summary(new) || E'\n原因：' || coalesce(new.cancel_reason, '-'),
      array[new.assignee_id, new.created_by_employee_id], new.last_actor_id);
  end if;
  return new;
end $$;
create trigger trg_quick_jobs_notify after insert or update on public.quick_jobs
  for each row execute function public.trg_quick_jobs_notify_fn();

-- ---------- 5. 核心動作（p_actor = 執行者的員工 id） ----------
create or replace function public._qj_create(
  p_actor uuid, p_company uuid, p_title text, p_customer_name text, p_customer_phone text,
  p_pickup_at timestamptz, p_note text, p_source text, p_raw text, p_assignee uuid)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  if not exists (select 1 from employees where id = p_actor and company_id = p_company and is_active) then
    raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'P0001: 請填寫要做什麼'; end if;
  if p_assignee is not null then
    if not _qj_is_manager(p_actor) then raise exception 'P0005: 只有主管可以派工' using errcode = '42501'; end if;
    if not exists (select 1 from employees where id = p_assignee and company_id = p_company and is_active) then
      raise exception 'P0002: 找不到要派工的員工';
    end if;
  end if;
  insert into quick_jobs (company_id, job_no, title, customer_name, customer_phone, pickup_at, note,
                          status, assignee_id, assigned_at, created_by_employee_id, source, raw_text, last_actor_id)
  values (p_company, public.next_doc_no(p_company, 'QK'), trim(p_title), nullif(trim(p_customer_name), ''),
          nullif(trim(p_customer_phone), ''), p_pickup_at, nullif(trim(p_note), ''),
          case when p_assignee is null then 'new' else 'assigned' end, p_assignee,
          case when p_assignee is null then null else now() end,
          p_actor, coalesce(p_source, 'web'), p_raw, p_actor)
  returning * into v_job;
  return v_job;
end $$;

create or replace function public._qj_get_for_update(p_actor uuid, p_job uuid)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  select * into v_job from quick_jobs where id = p_job for update;
  if not found then raise exception 'P0002: 找不到這張快單'; end if;
  if not exists (select 1 from employees where id = p_actor and company_id = v_job.company_id and is_active) then
    raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501';
  end if;
  return v_job;
end $$;

create or replace function public._qj_assign(p_actor uuid, p_job uuid, p_assignee uuid)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if not _qj_is_manager(p_actor) then raise exception 'P0005: 只有主管可以派工' using errcode = '42501'; end if;
  if v_job.status not in ('new', 'assigned', 'in_progress') then
    raise exception 'P0001: 這張快單已經%，不能再派工', case v_job.status when 'ready' then '完成' when 'closed' then '結案' else '取消' end;
  end if;
  if not exists (select 1 from employees where id = p_assignee and company_id = v_job.company_id and is_active) then
    raise exception 'P0002: 找不到要派工的員工';
  end if;
  update quick_jobs
     set assignee_id = p_assignee, assigned_at = now(),
         status = case when status = 'new' then 'assigned' else status end,
         last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

create or replace function public._qj_start(p_actor uuid, p_job uuid)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if v_job.status = 'in_progress' then return v_job; end if;
  if v_job.status = 'new' then
    if not _qj_is_manager(p_actor) then raise exception 'P0001: 這張快單還沒派工，請等老闆派工'; end if;
    update quick_jobs set assignee_id = p_actor, assigned_at = now() where id = p_job;
  elsif v_job.status <> 'assigned' then
    raise exception 'P0001: 這張快單目前不能開始';
  elsif v_job.assignee_id is distinct from p_actor and not _qj_is_manager(p_actor) then
    raise exception 'P0005: 這張快單不是派給你的' using errcode = '42501';
  end if;
  update quick_jobs set status = 'in_progress', started_at = now(), last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

create or replace function public._qj_done(p_actor uuid, p_job uuid)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if v_job.status = 'ready' then return v_job; end if;
  if v_job.status not in ('new', 'assigned', 'in_progress') then
    raise exception 'P0001: 這張快單目前不能標記完成';
  end if;
  if v_job.assignee_id is distinct from p_actor and not _qj_is_manager(p_actor) then
    raise exception 'P0005: 這張快單不是派給你的' using errcode = '42501';
  end if;
  update quick_jobs
     set status = 'ready', done_at = now(), started_at = coalesce(started_at, now()),
         assignee_id = coalesce(assignee_id, p_actor), assigned_at = coalesce(assigned_at, now()),
         last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

-- 取件收款：金額此時才填；產生應收（來源「快單」），付現／轉帳同時收款沖帳
create or replace function public._qj_pickup(p_actor uuid, p_job uuid, p_amount numeric, p_method text,
                                             p_tax_id text, p_note text)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare
  v_job quick_jobs; v_amt numeric := round(coalesce(p_amount, -1), 2); v_cust uuid; v_user uuid;
  v_ar uuid; v_col uuid; v_today date := (now() at time zone 'Asia/Taipei')::date; v_desc text;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if v_job.status in ('closed', 'cancelled') then raise exception 'P0001: 這張快單已經結案或取消'; end if;
  if v_amt < 0 then raise exception 'P0001: 請填寫金額'; end if;
  if p_method is null or p_method not in ('cash', 'transfer', 'other', 'unpaid') then
    raise exception 'P0001: 收款方式不正確';
  end if;
  select user_id into v_user from employees where id = p_actor;
  v_desc := '快單 ' || v_job.job_no || '｜' || v_job.title || coalesce('｜' || v_job.customer_name, '');

  if v_amt > 0 then
    v_cust := coalesce(v_job.customer_id, _qj_walkin_customer(v_job.company_id));
    insert into receivables (company_id, customer_id, doc_no, source_type, amount, due_date, note, created_by)
    values (v_job.company_id, v_cust, public.next_doc_no(v_job.company_id, 'AR'), 'quick', v_amt, v_today,
            left(v_desc || coalesce('｜統編 ' || nullif(trim(p_tax_id), ''), ''), 500), v_user)
    returning id into v_ar;
    if p_method <> 'unpaid' then
      insert into collections (company_id, collection_no, customer_id, collect_date, method, amount, status, note, created_by)
      values (v_job.company_id, public.next_doc_no(v_job.company_id, 'CM'), v_cust, v_today, p_method, v_amt,
              'confirmed', left(v_desc, 500), v_user)
      returning id into v_col;
      perform _apply_collection_allocs(v_col, jsonb_build_array(jsonb_build_object('receivable_id', v_ar, 'amount', v_amt)));
    end if;
  end if;

  update quick_jobs
     set status = 'closed', closed_at = now(), closed_by_employee_id = p_actor,
         done_at = coalesce(done_at, now()), started_at = coalesce(started_at, now()),
         amount_total = v_amt, pay_method = case when v_amt = 0 then null else p_method end,
         tax_id = nullif(trim(p_tax_id), ''), receivable_id = v_ar, collection_id = v_col,
         note = coalesce(nullif(trim(p_note), ''), note), last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

create or replace function public._qj_cancel(p_actor uuid, p_job uuid, p_reason text)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if not _qj_is_manager(p_actor) and v_job.created_by_employee_id is distinct from p_actor then
    raise exception 'P0005: 只有主管或開單的人可以取消' using errcode = '42501';
  end if;
  if v_job.status in ('closed', 'cancelled') then raise exception 'P0001: 這張快單已經結案或取消'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'P0001: 請填寫取消原因'; end if;
  update quick_jobs set status = 'cancelled', cancel_reason = trim(p_reason), last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

create or replace function public._qj_update(p_actor uuid, p_job uuid, p_title text, p_customer_name text,
                                             p_customer_phone text, p_pickup_at timestamptz, p_note text)
returns quick_jobs language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_get_for_update(p_actor, p_job);
  if not _qj_is_manager(p_actor) and v_job.created_by_employee_id is distinct from p_actor then
    raise exception 'P0005: 只有主管或開單的人可以修改' using errcode = '42501';
  end if;
  if v_job.status in ('closed', 'cancelled') then raise exception 'P0001: 已結案或取消的快單不能修改'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'P0001: 請填寫要做什麼'; end if;
  update quick_jobs
     set title = trim(p_title), customer_name = nullif(trim(p_customer_name), ''),
         customer_phone = nullif(trim(p_customer_phone), ''), pickup_at = p_pickup_at,
         note = nullif(trim(p_note), ''), last_actor_id = p_actor
   where id = p_job returning * into v_job;
  return v_job;
end $$;

-- ---------- 6. 網頁用（登入者＝目前公司的員工） ----------
create or replace function public._qj_web_actor()
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v_emp uuid;
begin
  select id into v_emp from employees
   where user_id = auth.uid() and company_id = public.current_company_id() and is_active;
  if v_emp is null then raise exception 'P0005: 你在這家公司沒有員工身分' using errcode = '42501'; end if;
  if not public.has_perm('quick_jobs', 'view') then raise exception 'P0005: 沒有快單權限' using errcode = '42501'; end if;
  return v_emp;
end $$;

create or replace function public.quick_job_create(p_title text, p_customer_name text, p_customer_phone text,
  p_pickup_at timestamptz, p_note text, p_assignee_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_create(_qj_web_actor(), public.current_company_id(), p_title, p_customer_name, p_customer_phone,
                      p_pickup_at, p_note, 'web', null, p_assignee_id);
  return jsonb_build_object('id', v_job.id, 'job_no', v_job.job_no, 'status', v_job.status);
end $$;

create or replace function public.quick_job_assign(p_job_id uuid, p_assignee_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_assign(_qj_web_actor(), p_job_id, p_assignee_id);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

create or replace function public.quick_job_start(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_start(_qj_web_actor(), p_job_id);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

create or replace function public.quick_job_done(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_done(_qj_web_actor(), p_job_id);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

create or replace function public.quick_job_pickup(p_job_id uuid, p_amount numeric, p_method text,
  p_tax_id text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_pickup(_qj_web_actor(), p_job_id, p_amount, p_method, p_tax_id, p_note);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'amount', v_job.amount_total);
end $$;

create or replace function public.quick_job_cancel(p_job_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_cancel(_qj_web_actor(), p_job_id, p_reason);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

create or replace function public.quick_job_update(p_job_id uuid, p_title text, p_customer_name text,
  p_customer_phone text, p_pickup_at timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs;
begin
  v_job := _qj_update(_qj_web_actor(), p_job_id, p_title, p_customer_name, p_customer_phone, p_pickup_at, p_note);
  return jsonb_build_object('id', v_job.id, 'status', v_job.status);
end $$;

-- ---------- 7. LINE 用（只給 service role：line-webhook 呼叫） ----------
-- LINE 使用者對應的員工列（同一個登入帳號在兩家公司都有員工資料時，兩列都算）
create or replace function public._qj_line_employees(p_line_user_id text)
returns table (employee_id uuid, company_id uuid, company_code text, company_name text, employee_name text, is_manager boolean)
language sql stable security definer set search_path to 'public' as $$
  with b as (select id, user_id from employees where line_user_id = p_line_user_id and is_active limit 1)
  select e.id, c.id, c.code, coalesce(c.short_name, c.name), e.name, _qj_is_manager(e.id)
    from employees e join companies c on c.id = e.company_id, b
   where e.is_active and c.is_active and (e.id = b.id or (b.user_id is not null and e.user_id = b.user_id))
   order by (e.id = b.id) desc, c.code desc;
$$;

-- 依單號（完整或尾碼）找這個 LINE 使用者看得到的快單
create or replace function public._qj_line_find(p_line_user_id text, p_ref text)
returns quick_jobs language plpgsql stable security definer set search_path to 'public' as $$
declare v_job quick_jobs; v_n int; v_ref text := upper(trim(coalesce(p_ref, '')));
begin
  if v_ref ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
    select * into v_job from quick_jobs where id = v_ref::uuid
       and company_id in (select company_id from _qj_line_employees(p_line_user_id));
    if not found then raise exception 'P0002: 找不到這張快單'; end if;
    return v_job;
  end if;
  if length(v_ref) < 3 then raise exception 'P0001: 請輸入快單單號，例如 2610001'; end if;
  select count(*) into v_n from quick_jobs
   where company_id in (select company_id from _qj_line_employees(p_line_user_id))
     and upper(job_no) like '%' || v_ref;
  if v_n = 0 then raise exception 'P0002: 找不到單號 % 的快單', p_ref; end if;
  if v_n > 1 then raise exception 'P0001: 單號 % 對到多張快單，請輸入完整單號（例如 XX-QK-2610001）', p_ref; end if;
  select * into v_job from quick_jobs
   where company_id in (select company_id from _qj_line_employees(p_line_user_id))
     and upper(job_no) like '%' || v_ref;
  return v_job;
end $$;

create or replace function public._qj_line_actor_for(p_line_user_id text, p_company uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select employee_id from _qj_line_employees(p_line_user_id) where company_id = p_company limit 1;
$$;

create or replace function public._qj_json(p_job quick_jobs)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', p_job.id, 'job_no', p_job.job_no, 'title', p_job.title, 'status', p_job.status,
    'company_id', p_job.company_id,
    'company_name', (select coalesce(short_name, name) from companies where id = p_job.company_id),
    'customer_name', p_job.customer_name, 'customer_phone', p_job.customer_phone,
    'pickup_at', p_job.pickup_at, 'amount_total', p_job.amount_total, 'pay_method', p_job.pay_method,
    'assignee_name', (select name from employees where id = p_job.assignee_id),
    'summary', _qj_summary(p_job));
$$;

-- 開單；p_company_hint：訊息中的「祥興」「沂融」或公司代碼，空白＝綁定的那家
create or replace function public.line_quick_job_create(p_line_user_id text, p_company_hint text, p_title text,
  p_customer_name text, p_customer_phone text, p_pickup_at timestamptz, p_note text, p_raw text, p_assignee_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me record; v_assignee uuid; v_job quick_jobs; v_staff jsonb; v_files int;
begin
  select * into v_me from _qj_line_employees(p_line_user_id) e
   where p_company_hint is null or trim(p_company_hint) = ''
      or e.company_code = upper(trim(p_company_hint))
      or e.company_name like '%' || trim(p_company_hint) || '%'
   limit 1;
  if not found then
    if exists (select 1 from _qj_line_employees(p_line_user_id)) then
      raise exception 'P0005: 你在「%」沒有員工資料', p_company_hint;
    end if;
    raise exception 'P0005: 這個 LINE 還沒綁定員工，請先輸入 6 碼綁定碼';
  end if;

  if coalesce(trim(p_assignee_name), '') <> '' then
    if not v_me.is_manager then raise exception 'P0005: 只有主管可以派工，請拿掉「給某某」再送一次'; end if;
    select id into v_assignee from employees
     where company_id = v_me.company_id and is_active and name like '%' || trim(p_assignee_name) || '%'
     order by length(name) limit 1;
    if v_assignee is null then raise exception 'P0002: 找不到員工「%」', p_assignee_name; end if;
  end if;

  v_job := _qj_create(v_me.employee_id, v_me.company_id, p_title, p_customer_name, p_customer_phone,
                      p_pickup_at, p_note, 'line', p_raw, v_assignee);

  -- 十分鐘內先傳的照片接到這張單
  update quick_job_files set job_id = v_job.id, company_id = v_job.company_id
   where job_id is null and line_user_id = p_line_user_id and created_at > now() - interval '10 minutes';
  get diagnostics v_files = row_count;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by r.tier = 'staff' desc, e.emp_no), '[]')
    into v_staff
    from employees e join roles r on r.id = e.role_id
   where e.company_id = v_job.company_id and e.is_active;

  return _qj_json(v_job) || jsonb_build_object('is_manager', v_me.is_manager, 'staff', v_staff, 'files', v_files);
end $$;

-- 派工／開始／完成／取消；p_job_ref 為快單 id 或單號（尾碼）
create or replace function public.line_quick_job_action(p_line_user_id text, p_action text, p_job_ref text,
  p_assignee_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs; v_actor uuid;
begin
  v_job := _qj_line_find(p_line_user_id, p_job_ref);
  v_actor := _qj_line_actor_for(p_line_user_id, v_job.company_id);
  if v_actor is null then raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501'; end if;
  v_job := case p_action
    when 'assign' then _qj_assign(v_actor, v_job.id, p_assignee_id)
    when 'start'  then _qj_start(v_actor, v_job.id)
    when 'done'   then _qj_done(v_actor, v_job.id)
    when 'cancel' then _qj_cancel(v_actor, v_job.id, p_reason)
  end;
  if v_job.id is null then raise exception 'P0001: 不支援的動作 %', p_action; end if;
  return _qj_json(v_job);
end $$;

create or replace function public.line_quick_job_pickup(p_line_user_id text, p_job_ref text, p_amount numeric,
  p_method text, p_tax_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_job quick_jobs; v_actor uuid;
begin
  v_job := _qj_line_find(p_line_user_id, p_job_ref);
  v_actor := _qj_line_actor_for(p_line_user_id, v_job.company_id);
  if v_actor is null then raise exception 'P0005: 你不是這家公司的員工' using errcode = '42501'; end if;
  v_job := _qj_pickup(v_actor, v_job.id, p_amount, p_method, p_tax_id, null);
  return _qj_json(v_job);
end $$;

-- 未結案快單清單＋今日結案金額
create or replace function public.line_quick_job_list(p_line_user_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if not exists (select 1 from _qj_line_employees(p_line_user_id)) then
    raise exception 'P0005: 這個 LINE 還沒綁定員工，請先輸入 6 碼綁定碼';
  end if;
  return jsonb_build_object(
    'open', coalesce((select jsonb_agg(_qj_json(q) order by q.status, q.pickup_at nulls last, q.created_at)
                        from quick_jobs q
                       where q.company_id in (select company_id from _qj_line_employees(p_line_user_id))
                         and q.status in ('new', 'assigned', 'in_progress', 'ready')), '[]'),
    'today_closed', (select count(*) from quick_jobs q
                      where q.company_id in (select company_id from _qj_line_employees(p_line_user_id))
                        and q.status = 'closed' and (q.closed_at at time zone 'Asia/Taipei')::date = v_today),
    'today_amount', (select coalesce(sum(q.amount_total), 0) from quick_jobs q
                      where q.company_id in (select company_id from _qj_line_employees(p_line_user_id))
                        and q.status = 'closed' and (q.closed_at at time zone 'Asia/Taipei')::date = v_today));
end $$;

-- LINE 傳來的照片：十分鐘內剛開的單就接上，否則先暫存等下一張單
create or replace function public.line_quick_job_add_file(p_line_user_id text, p_storage_path text, p_content_type text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_me record; v_job quick_jobs;
begin
  select * into v_me from _qj_line_employees(p_line_user_id) limit 1;
  if not found then raise exception 'P0005: 這個 LINE 還沒綁定員工'; end if;
  select q.* into v_job from quick_jobs q
   where q.created_by_employee_id in (select employee_id from _qj_line_employees(p_line_user_id))
     and q.created_at > now() - interval '10 minutes' and q.status not in ('closed', 'cancelled')
   order by q.created_at desc limit 1;
  insert into quick_job_files (company_id, job_id, employee_id, line_user_id, storage_path, content_type)
  values (coalesce(v_job.company_id, v_me.company_id), v_job.id, v_me.employee_id, p_line_user_id,
          p_storage_path, p_content_type);
  return jsonb_build_object('job_no', v_job.job_no, 'attached', v_job.id is not null);
end $$;

-- ---------- 8. 權限 ----------
revoke execute on function public._qj_is_manager(uuid) from public, anon, authenticated;
revoke execute on function public._qj_walkin_customer(uuid) from public, anon, authenticated;
revoke execute on function public._qj_notify(uuid, text, text, text, uuid[], uuid) from public, anon, authenticated;
revoke execute on function public._qj_managers(uuid) from public, anon, authenticated;
revoke execute on function public._qj_summary(quick_jobs) from public, anon, authenticated;
revoke execute on function public.trg_quick_jobs_notify_fn() from public, anon, authenticated;
revoke execute on function public._qj_create(uuid, uuid, text, text, text, timestamptz, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public._qj_get_for_update(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._qj_assign(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._qj_start(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._qj_done(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._qj_pickup(uuid, uuid, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public._qj_cancel(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._qj_update(uuid, uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public._qj_web_actor() from public, anon, authenticated;
revoke execute on function public._qj_line_employees(text) from public, anon, authenticated;
revoke execute on function public._qj_line_find(text, text) from public, anon, authenticated;
revoke execute on function public._qj_line_actor_for(text, uuid) from public, anon, authenticated;
revoke execute on function public._qj_json(quick_jobs) from public, anon, authenticated;

revoke execute on function public.quick_job_create(text, text, text, timestamptz, text, uuid) from public, anon;
revoke execute on function public.quick_job_assign(uuid, uuid) from public, anon;
revoke execute on function public.quick_job_start(uuid) from public, anon;
revoke execute on function public.quick_job_done(uuid) from public, anon;
revoke execute on function public.quick_job_pickup(uuid, numeric, text, text, text) from public, anon;
revoke execute on function public.quick_job_cancel(uuid, text) from public, anon;
revoke execute on function public.quick_job_update(uuid, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.quick_job_create(text, text, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.quick_job_assign(uuid, uuid) to authenticated;
grant execute on function public.quick_job_start(uuid) to authenticated;
grant execute on function public.quick_job_done(uuid) to authenticated;
grant execute on function public.quick_job_pickup(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.quick_job_cancel(uuid, text) to authenticated;
grant execute on function public.quick_job_update(uuid, text, text, text, timestamptz, text) to authenticated;

revoke execute on function public.line_quick_job_create(text, text, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke execute on function public.line_quick_job_action(text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.line_quick_job_pickup(text, text, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.line_quick_job_list(text) from public, anon, authenticated;
revoke execute on function public.line_quick_job_add_file(text, text, text) from public, anon, authenticated;
grant execute on function public.line_quick_job_create(text, text, text, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.line_quick_job_action(text, text, text, uuid, text) to service_role;
grant execute on function public.line_quick_job_pickup(text, text, numeric, text, text) to service_role;
grant execute on function public.line_quick_job_list(text) to service_role;
grant execute on function public.line_quick_job_add_file(text, text, text) to service_role;

-- ---------- 9. 集團總覽加快單數字（回傳欄位改變，需先移除舊函式） ----------
drop function if exists public.group_kpis();
create function public.group_kpis()
returns table(company_id uuid, company_code text, company_name text, today_new_orders integer,
              month_orders integer, month_order_amount numeric, wip_orders integer, overdue_tasks integer,
              outsourcing integer, month_shipped_amount numeric, ar_balance numeric, ap_balance numeric,
              active_employees integer, today_clock_in integer, today_abnormal integer,
              today_quick_jobs integer, quick_open integer, today_quick_amount numeric, month_quick_amount numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Taipei'))::date;
begin
  if not public.is_owner() then raise exception 'P0005: 僅老闆可查看集團總覽' using errcode = '42501'; end if;
  return query
  select c.id, c.code, c.name,
    (select count(*)::int from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date = v_today),
    (select count(*)::int from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date >= v_month),
    (select coalesce(sum(o.amount_total), 0) from orders o where o.company_id = c.id and o.status <> 'void'
       and (o.created_at at time zone 'Asia/Taipei')::date >= v_month),
    (select count(*)::int from orders o where o.company_id = c.id and o.status = 'active'),
    (select count(*)::int from order_tasks t join orders o on o.id = t.order_id
      where t.company_id = c.id and o.status = 'active'
        and t.status not in ('done', 'skipped') and t.due_at < v_today),
    (select count(*)::int from cross_company_links l where l.from_company_id = c.id
        and l.status in ('dispatched', 'accepted', 'in_progress')),
    (select coalesce(sum(d.amount_total), 0) from delivery_notes d where d.company_id = c.id
        and d.status = 'issued' and d.delivery_date >= v_month),
    (select coalesce(sum(r.balance), 0) from receivables r where r.company_id = c.id and r.status in ('unreceived', 'partial')),
    (select coalesce(sum(p.balance), 0) from payables p where p.company_id = c.id and p.status in ('unpaid', 'partial')),
    (select count(*)::int from employees e where e.company_id = c.id and e.is_active),
    (select count(*)::int from attendances a where a.company_id = c.id and a.work_date = v_today and a.clock_in_at is not null),
    (select count(*)::int from attendances a where a.company_id = c.id and a.work_date = v_today and a.is_abnormal_location),
    (select count(*)::int from quick_jobs q where q.company_id = c.id and q.status <> 'cancelled'
       and (q.created_at at time zone 'Asia/Taipei')::date = v_today),
    (select count(*)::int from quick_jobs q where q.company_id = c.id and q.status in ('new', 'assigned', 'in_progress', 'ready')),
    (select coalesce(sum(q.amount_total), 0) from quick_jobs q where q.company_id = c.id and q.status = 'closed'
       and (q.closed_at at time zone 'Asia/Taipei')::date = v_today),
    (select coalesce(sum(q.amount_total), 0) from quick_jobs q where q.company_id = c.id and q.status = 'closed'
       and (q.closed_at at time zone 'Asia/Taipei')::date >= v_month)
  from companies c
  where c.is_active and c.id in (select public.user_company_ids())
  order by c.code desc;
end $$;
revoke execute on function public.group_kpis() from public, anon;
grant execute on function public.group_kpis() to authenticated;
