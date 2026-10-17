-- =====================================================================
-- 033 請假與薪資計算
--   1. 請假申請：員工在打卡頁申請 → 主管核准；通知走 LINE
--   2. 薪資參數（每家公司一組，法定費率每年更新）、員工薪資設定
--   3. 每月薪資：依打卡（遲到、早退、曠職、加班、國定假日出勤）＋核准的請假自動計算
--      老闆只填績效獎金、其他加項、所得稅、其他扣款；鎖定後員工可看自己的薪資條
--   計算規則同《薪資計算表_範本.xlsx》
-- =====================================================================

-- ---------- 1. 請假 ----------
create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- annual 特休／personal 事假／family_care 家庭照顧假／sick 病假／marriage 婚假／funeral 喪假／
  -- occupational 公傷病假／maternity 產假／menstrual 生理假／other_paid 其他有薪假
  leave_type    text not null check (leave_type in ('annual', 'personal', 'family_care', 'sick', 'marriage',
                                                    'funeral', 'occupational', 'maternity', 'menstrual', 'other_paid')),
  date_from     date not null,
  date_to       date not null,
  hours         numeric(6, 1) not null check (hours > 0 and hours <= 744),
  reason        text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id   uuid references public.employees(id),
  approved_at   timestamptz,
  approver_note text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (date_to >= date_from),
  -- 跨月請分兩張（薪資按月算）
  check (extract(year from date_from) * 12 + extract(month from date_from)
         = extract(year from date_to) * 12 + extract(month from date_to))
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, date_from);
create index if not exists leave_requests_status_idx on public.leave_requests (company_id, status);

create trigger trg_leave_requests_updated before update on public.leave_requests
  for each row execute function public.set_updated_at();

alter table public.leave_requests enable row level security;
-- 自己看自己的；主管看全公司。寫入只走 RPC
create policy leave_requests_read on public.leave_requests for select to authenticated
  using (employee_id = public.current_employee_id()
         or (company_id = public.current_company_id() and public.is_manager()));

create or replace function public._leave_label(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'annual' then '特休' when 'personal' then '事假' when 'family_care' then '家庭照顧假'
    when 'sick' then '病假' when 'marriage' then '婚假' when 'funeral' then '喪假'
    when 'occupational' then '公傷病假' when 'maternity' then '產假' when 'menstrual' then '生理假'
    else '其他有薪假' end;
$$;

-- 這個月薪資已鎖定就不能再動請假
create or replace function public._payroll_locked(p_company uuid, p_date date)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
begin
  return exists (select 1 from payroll_runs
                  where company_id = p_company and period = date_trunc('month', p_date)::date and status = 'closed');
end $$;

create or replace function public.leave_request(p_type text, p_from date, p_to date, p_hours numeric, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_emp employees; v_id uuid; v_range text;
begin
  select * into v_emp from employees where id = current_employee_id();
  if v_emp.id is null then raise exception 'P0005: 找不到你的員工資料' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'P0003: 請假日期不正確'; end if;
  if date_trunc('month', p_from) <> date_trunc('month', p_to) then
    raise exception 'P0003: 請假跨月份，請分成兩張申請（例：10/30～10/31 一張、11/1～11/2 一張）';
  end if;
  if coalesce(p_hours, 0) <= 0 then raise exception 'P0003: 請假時數要大於 0'; end if;
  if p_hours > (p_to - p_from + 1) * 24 then raise exception 'P0003: 請假時數超過日期範圍'; end if;
  if _payroll_locked(v_emp.company_id, p_from) then
    raise exception 'P0002: 這個月的薪資已經結算鎖定，請找主管處理';
  end if;
  if exists (select 1 from leave_requests
              where employee_id = v_emp.id and status in ('pending', 'approved')
                and date_from <= p_to and date_to >= p_from
                and (date_from <> date_to or p_from <> p_to)) then
    raise exception 'P0002: 這段期間已經有請假申請了';
  end if;

  insert into leave_requests (company_id, employee_id, leave_type, date_from, date_to, hours, reason, created_by, updated_by)
  values (v_emp.company_id, v_emp.id, p_type, p_from, p_to, p_hours, nullif(trim(p_reason), ''), auth.uid(), auth.uid())
  returning id into v_id;

  v_range := to_char(p_from, 'MM/DD') || case when p_to <> p_from then '～' || to_char(p_to, 'MM/DD') else '' end;
  perform emit_notification(v_emp.company_id, 'leave_requested', 'leave_request', v_id, v_emp.id,
    '請假申請待核准',
    v_emp.name || ' 申請' || _leave_label(p_type) || ' ' || v_range || '，共 ' || trim_scale(p_hours) || ' 小時'
      || coalesce(E'\n原因：' || nullif(trim(p_reason), ''), ''),
    '');
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.leave_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_l leave_requests; v_status text;
begin
  if not is_manager() then raise exception 'P0005: 只有主管或老闆可以審核請假' using errcode = '42501'; end if;
  select * into v_l from leave_requests where id = p_id and company_id = current_company_id() for update;
  if v_l.id is null then raise exception 'P0001: 找不到這筆請假'; end if;
  if v_l.status <> 'pending' then raise exception 'P0002: 這筆請假已經處理過了'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'P0003: 駁回請寫原因'; end if;
  if _payroll_locked(v_l.company_id, v_l.date_from) then
    raise exception 'P0002: 這個月的薪資已經結算鎖定，請先到「薪資計算」解除鎖定';
  end if;
  v_status := case when p_approve then 'approved' else 'rejected' end;
  update leave_requests set status = v_status, approver_id = current_employee_id(), approved_at = now(),
         approver_note = nullif(trim(p_note), '')
   where id = p_id;
  perform emit_notification(v_l.company_id, 'leave_decided', 'leave_request', v_l.id, v_l.employee_id,
    case when p_approve then '請假已核准' else '請假被駁回' end,
    _leave_label(v_l.leave_type) || ' ' || to_char(v_l.date_from, 'MM/DD')
      || case when v_l.date_to <> v_l.date_from then '～' || to_char(v_l.date_to, 'MM/DD') else '' end
      || '，共 ' || trim_scale(v_l.hours) || ' 小時'
      || case when p_approve then '，已核准' else '，被駁回' end
      || coalesce(E'\n備註：' || nullif(trim(p_note), ''), ''),
    '');
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- 自己可取消「待核准」的；主管可取消任何未鎖定月份的
create or replace function public.leave_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_l leave_requests;
begin
  select * into v_l from leave_requests where id = p_id and company_id = current_company_id() for update;
  if v_l.id is null then raise exception 'P0001: 找不到這筆請假'; end if;
  if v_l.status in ('rejected', 'cancelled') then raise exception 'P0002: 這筆請假已經結束了'; end if;
  if not is_manager() then
    if v_l.employee_id is distinct from current_employee_id() then
      raise exception 'P0005: 只能取消自己的請假' using errcode = '42501';
    end if;
    if v_l.status <> 'pending' then raise exception 'P0002: 已核准的請假要請主管取消'; end if;
  end if;
  if _payroll_locked(v_l.company_id, v_l.date_from) then
    raise exception 'P0002: 這個月的薪資已經結算鎖定，請先解除鎖定';
  end if;
  update leave_requests set status = 'cancelled' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 2. 薪資參數、員工薪資設定 ----------
create table if not exists public.payroll_params (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  min_month     numeric(12, 2) not null default 29500,  -- 基本工資（月）
  min_hour      numeric(10, 2) not null default 196,    -- 基本工資（時）
  div_hour      numeric(6, 2)  not null default 240,    -- 時薪基數除數
  div_day       numeric(6, 2)  not null default 30,     -- 日薪除數
  ot1           numeric(6, 4)  not null default 1.34,   -- 加班前 2 小時倍率
  ot2           numeric(6, 4)  not null default 1.67,   -- 加班第 3 小時起倍率
  hol_monthly   numeric(6, 4)  not null default 1,      -- 國定假日出勤加給（月薪制另加）
  hol_hourly    numeric(6, 4)  not null default 2,      -- 國定假日出勤倍率（時薪制）
  sick_ratio    numeric(6, 4)  not null default 0.5,    -- 病假給薪比例
  late_allow    int            not null default 3,      -- 遲到＋早退可容許次數（超過不發全勤）
  li_rate       numeric(8, 6)  not null default 0.115,  -- 勞保普通事故費率
  ei_rate       numeric(8, 6)  not null default 0.01,   -- 就保費率
  li_emp        numeric(6, 4)  not null default 0.2,
  li_er         numeric(6, 4)  not null default 0.7,
  li_cap        numeric(12, 2) not null default 45800,
  occ_rate      numeric(8, 6)  not null default 0.0021, -- 職災（雇主全額，依核定費率修改）
  occ_cap       numeric(12, 2) not null default 72800,
  nhi_rate      numeric(8, 6)  not null default 0.0517,
  nhi_emp       numeric(6, 4)  not null default 0.3,
  nhi_er        numeric(6, 4)  not null default 0.6,
  nhi_avg       numeric(6, 4)  not null default 0.56,
  nhi_dep_max   int            not null default 3,
  pension_rate  numeric(6, 4)  not null default 0.06,
  meal_cap      numeric(12, 2) not null default 3000,
  tax_start     numeric(12, 2) not null default 88501,
  brackets      numeric[]      not null default array[29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000,
                                                    43900, 45800, 48200, 50600, 53000, 55400, 57800, 60800, 63800,
                                                    66800, 69800, 72800]::numeric[],
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
insert into public.payroll_params (company_id) select id from public.companies on conflict do nothing;

create table if not exists public.employee_pay_profiles (
  employee_id        uuid primary key references public.employees(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  pay_type           text not null default 'monthly' check (pay_type in ('monthly', 'hourly')),
  base_salary        numeric(12, 2) not null default 0 check (base_salary >= 0),
  hourly_rate        numeric(10, 2) not null default 0 check (hourly_rate >= 0),
  position_allowance numeric(12, 2) not null default 0 check (position_allowance >= 0),
  meal_allowance     numeric(12, 2) not null default 0 check (meal_allowance >= 0),
  attendance_bonus   numeric(12, 2) not null default 0 check (attendance_bonus >= 0),
  nhi_enrolled       boolean not null default true,
  nhi_dependents     int not null default 0 check (nhi_dependents between 0 and 10),
  pension_self_rate  numeric(5, 4) not null default 0 check (pension_self_rate between 0 and 0.06),
  insured_override   numeric(12, 2) check (insured_override is null or insured_override > 0),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);

create trigger trg_payroll_params_updated before update on public.payroll_params
  for each row execute function public.set_updated_at();
create trigger trg_pay_profiles_updated before update on public.employee_pay_profiles
  for each row execute function public.set_updated_at();

alter table public.payroll_params enable row level security;
alter table public.employee_pay_profiles enable row level security;
create policy payroll_params_read on public.payroll_params for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'view'));
create policy payroll_params_write on public.payroll_params for update to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'edit'))
  with check (company_id = public.current_company_id() and public.has_perm('payroll', 'edit'));
create policy pay_profiles_read on public.employee_pay_profiles for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'view'));
create policy pay_profiles_write on public.employee_pay_profiles for all to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'edit'))
  with check (company_id = public.current_company_id() and public.has_perm('payroll', 'edit')
              and exists (select 1 from public.employees e
                           where e.id = employee_pay_profiles.employee_id and e.company_id = employee_pay_profiles.company_id));

-- ---------- 3. 每月薪資 ----------
create table if not exists public.payroll_runs (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period     date not null check (extract(day from period) = 1),
  status     text not null default 'draft' check (status in ('draft', 'closed')),
  closed_at  timestamptz,
  closed_by  uuid,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (company_id, period)
);

create table if not exists public.payroll_items (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.payroll_runs(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  employee_id       uuid not null references public.employees(id) on delete cascade,
  emp_no            text,
  employee_name     text,
  pay_type          text,
  -- 老闆手填
  perf_bonus        numeric(12, 2) not null default 0,
  other_add         numeric(12, 2) not null default 0,
  income_tax        numeric(12, 2) not null default 0,
  other_deduct      numeric(12, 2) not null default 0,
  pay_days_override numeric(5, 2) check (pay_days_override is null or pay_days_override between 0 and 30),
  note              text,
  -- 快照
  profile           jsonb,
  att               jsonb,
  -- 計算結果
  pay_days          numeric(5, 2),
  hourly_base       numeric(14, 4),
  daily_base        numeric(14, 4),
  base_pay          numeric(12, 2),
  position_pay      numeric(12, 2),
  meal_pay          numeric(12, 2),
  attendance_bonus  numeric(12, 2),
  ot_pay            numeric(12, 2),
  holiday_pay       numeric(12, 2),
  personal_deduct   numeric(12, 2),
  sick_deduct       numeric(12, 2),
  absent_deduct     numeric(12, 2),
  late_deduct       numeric(12, 2),
  gross_pay         numeric(12, 2),
  insured_salary    numeric(12, 2),
  li_emp            numeric(12, 2),
  nhi_emp           numeric(12, 2),
  pension_self      numeric(12, 2),
  deduct_total      numeric(12, 2),
  net_pay           numeric(12, 2),
  er_li             numeric(12, 2),
  er_nhi            numeric(12, 2),
  er_pension        numeric(12, 2),
  total_cost        numeric(12, 2),
  warnings          text[] not null default '{}',
  computed_at       timestamptz,
  unique (run_id, employee_id)
);
create index if not exists payroll_items_emp_idx on public.payroll_items (employee_id);

create trigger trg_payroll_runs_updated before update on public.payroll_runs
  for each row execute function public.set_updated_at();

alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;
create policy payroll_runs_read on public.payroll_runs for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'view'));
create policy payroll_items_read on public.payroll_items for select to authenticated
  using (company_id = public.current_company_id() and public.has_perm('payroll', 'view'));

-- 當月出勤＋請假彙總（時數以小時計）
create or replace function public._payroll_att(p_emp uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  e employees; v_end date := (p_period + interval '1 month - 1 day')::date; r record; lv record;
  v_pay_days numeric := 30; v_pending int;
begin
  select * into e from employees where id = p_emp;
  select
    count(*) filter (where a.clock_in_at is not null)                                   as work_days,
    count(*) filter (where coalesce(a.late_minutes, 0) > 0)                              as late_count,
    coalesce(sum(a.late_minutes), 0)                                                     as late_min,
    count(*) filter (where coalesce(a.early_leave_minutes, 0) > 0)                       as early_count,
    coalesce(sum(a.early_leave_minutes), 0)                                              as early_min,
    count(*) filter (where a.status = 'absent')                                          as absent_days,
    count(*) filter (where a.status = 'missing' or (a.clock_in_at is not null and a.clock_out_at is null and a.work_date < (now() at time zone 'Asia/Taipei')::date)) as missing_days,
    coalesce(sum(a.ot_minutes_134), 0)                                                   as ot134_min,
    coalesce(sum(a.ot_minutes_167), 0)                                                   as ot167_min,
    -- 國定假日、公司休假出勤：打卡時已由 trg_attendance_holiday 整天記成 ot_minutes_holiday
    coalesce(sum(a.ot_minutes_holiday), 0)                                               as hol_min,
    coalesce(sum(greatest(coalesce(a.work_minutes, 0) - coalesce(a.ot_minutes_134, 0)
                          - coalesce(a.ot_minutes_167, 0) - coalesce(a.ot_minutes_holiday, 0), 0)), 0) as normal_min
  into r
  from attendances a
  where a.employee_id = p_emp and a.work_date between p_period and v_end and a.status <> 'off';

  select
    coalesce(sum(hours) filter (where leave_type = 'personal'), 0)    as personal_h,
    coalesce(sum(hours) filter (where leave_type = 'family_care'), 0) as family_h,
    coalesce(sum(hours) filter (where leave_type = 'sick'), 0)        as sick_h,
    coalesce(sum(hours) filter (where leave_type = 'annual'), 0)      as annual_h,
    coalesce(sum(hours) filter (where leave_type not in ('personal', 'family_care', 'sick', 'annual')), 0) as paid_h
  into lv
  from leave_requests
  where employee_id = p_emp and status = 'approved' and date_from between p_period and v_end;

  select count(*) into v_pending from leave_requests
   where employee_id = p_emp and status = 'pending' and date_from between p_period and v_end;

  if e.hire_date is not null and e.hire_date > p_period then
    v_pay_days := case when e.hire_date > v_end then 0
                       else least(30, greatest(0, 30 - (extract(day from e.hire_date) - 1))) end;
  end if;

  return jsonb_build_object(
    'pay_days', v_pay_days,
    'work_days', r.work_days, 'late_count', r.late_count, 'late_min', r.late_min,
    'early_count', r.early_count, 'early_min', r.early_min,
    'absent_days', r.absent_days, 'missing_days', r.missing_days,
    'ot134_h', round(r.ot134_min / 60.0, 2), 'ot167_h', round(r.ot167_min / 60.0, 2),
    'hol_h', round(r.hol_min / 60.0, 2), 'normal_h', round(r.normal_min / 60.0, 2),
    'personal_h', lv.personal_h, 'family_h', lv.family_h, 'sick_h', lv.sick_h,
    'annual_h', lv.annual_h, 'paid_h', lv.paid_h, 'pending_leaves', v_pending);
end $$;

-- 投保級距：第一個 ≥ 金額的級距；超過最高級以最高級計
create or replace function public._payroll_bracket(p_amount numeric, p_brackets numeric[])
returns numeric language sql immutable as $$
  select coalesce((select b from unnest(p_brackets) b where b >= p_amount order by b limit 1),
                  (select max(b) from unnest(p_brackets) b));
$$;

-- 依快照與參數計算一筆
create or replace function public._payroll_compute(p_item_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  it payroll_items; p payroll_params; pf jsonb; a jsonb; monthly boolean;
  v_base numeric; v_rate numeric; v_pos numeric; v_meal numeric; v_bonus numeric; v_sum numeric;
  hb numeric; db numeric; ratio numeric; days numeric;
  v_basepay numeric; v_pospay numeric; v_mealpay numeric; v_att numeric; v_ot numeric; v_hol numeric;
  v_pers numeric := 0; v_sick numeric := 0; v_abs numeric := 0; v_late numeric := 0; v_gross numeric;
  v_ins numeric; v_li_base numeric; v_nhi_base numeric; v_li numeric; v_nhi numeric; v_pen numeric; v_ded numeric;
  v_er_li numeric; v_er_nhi numeric; v_er_pen numeric; w text[] := '{}';
begin
  select * into it from payroll_items where id = p_item_id;
  select * into p from payroll_params where company_id = it.company_id;
  pf := it.profile; a := it.att;
  monthly := coalesce(pf->>'pay_type', 'monthly') = 'monthly';
  v_base := coalesce((pf->>'base_salary')::numeric, 0);
  v_rate := coalesce((pf->>'hourly_rate')::numeric, 0);
  v_pos := coalesce((pf->>'position_allowance')::numeric, 0);
  v_meal := coalesce((pf->>'meal_allowance')::numeric, 0);
  v_bonus := coalesce((pf->>'attendance_bonus')::numeric, 0);
  v_sum := v_base + v_pos + v_meal + v_bonus;
  days := coalesce(it.pay_days_override, (a->>'pay_days')::numeric, 30);

  if monthly then
    hb := v_sum / p.div_hour;
    db := v_sum / p.div_day;
    ratio := days / 30;
    v_basepay := round(v_base * ratio);
  else
    hb := v_rate;
    db := null;
    ratio := 1;
    v_basepay := round(v_rate * (a->>'normal_h')::numeric);
  end if;
  v_pospay := round(v_pos * ratio);
  v_mealpay := round(v_meal * ratio);

  if (a->>'personal_h')::numeric > 0 or (a->>'absent_days')::numeric > 0
     or (a->>'late_count')::numeric + (a->>'early_count')::numeric > p.late_allow then
    v_att := 0;
  else
    v_att := round(v_bonus * ratio * greatest(0, 1 - (a->>'sick_h')::numeric / 8 / 30));
  end if;

  v_ot := round(hb * ((a->>'ot134_h')::numeric * p.ot1 + (a->>'ot167_h')::numeric * p.ot2));
  v_hol := round(hb * (a->>'hol_h')::numeric * case when monthly then p.hol_monthly else p.hol_hourly end);

  if monthly then
    v_pers := round(hb * ((a->>'personal_h')::numeric + (a->>'family_h')::numeric));
    v_sick := round(hb * (a->>'sick_h')::numeric * (1 - p.sick_ratio));
    v_abs := round(db * (a->>'absent_days')::numeric);
    v_late := round(hb / 60 * ((a->>'late_min')::numeric + (a->>'early_min')::numeric));
  end if;

  v_gross := v_basepay + v_pospay + v_mealpay + v_att + v_ot + v_hol + it.perf_bonus + it.other_add
           - v_pers - v_sick - v_abs - v_late;

  if coalesce((pf->>'insured_override')::numeric, 0) > 0 then
    v_ins := (pf->>'insured_override')::numeric;
  else
    v_ins := _payroll_bracket(case when monthly then v_sum else v_rate * (a->>'normal_h')::numeric end, p.brackets);
  end if;
  v_li_base := least(v_ins, p.li_cap);
  v_nhi_base := greatest(v_ins, p.min_month);
  v_li := round(v_li_base * p.li_rate * p.li_emp) + round(v_li_base * p.ei_rate * p.li_emp);
  v_nhi := case when coalesce((pf->>'nhi_enrolled')::boolean, true)
                then round(v_nhi_base * p.nhi_rate * p.nhi_emp)
                     * (1 + least(coalesce((pf->>'nhi_dependents')::int, 0), p.nhi_dep_max))
                else 0 end;
  v_pen := round(v_ins * coalesce((pf->>'pension_self_rate')::numeric, 0));
  v_ded := v_li + v_nhi + v_pen + it.income_tax + it.other_deduct;
  v_er_li := round(v_li_base * p.li_rate * p.li_er) + round(v_li_base * p.ei_rate * p.li_er)
           + round(least(v_ins, p.occ_cap) * p.occ_rate);
  v_er_nhi := case when coalesce((pf->>'nhi_enrolled')::boolean, true)
                   then round(v_nhi_base * p.nhi_rate * p.nhi_er * (1 + p.nhi_avg)) else 0 end;
  v_er_pen := round(v_ins * p.pension_rate);

  -- 提醒
  if monthly and v_base + v_pos + v_meal < p.min_month then w := w || '本薪＋加給＋伙食低於基本工資'; end if;
  if not monthly and v_rate < p.min_hour then w := w || '時薪低於基本工資'; end if;
  if not monthly and coalesce((pf->>'insured_override')::numeric, 0) = 0 then w := w || '時薪人員請設定投保薪資'; end if;
  if v_meal > p.meal_cap then w := w || '伙食津貼超過 3,000 元的部分要計稅'; end if;
  if v_gross >= p.tax_start and it.income_tax = 0 then w := w || '請依扣繳稅額表填所得稅'; end if;
  if (a->>'missing_days')::int > 0 then w := w || ('有 ' || (a->>'missing_days') || ' 天打卡不完整，請先補卡'); end if;
  if (a->>'pending_leaves')::int > 0 then w := w || ('有 ' || (a->>'pending_leaves') || ' 筆請假還沒核准'); end if;
  if v_gross < 0 then w := w || '應發薪資是負的，請檢查'; end if;

  update payroll_items set
    pay_days = days, hourly_base = round(hb, 4), daily_base = round(db, 4),
    base_pay = v_basepay, position_pay = v_pospay, meal_pay = v_mealpay, attendance_bonus = v_att,
    ot_pay = v_ot, holiday_pay = v_hol,
    personal_deduct = v_pers, sick_deduct = v_sick, absent_deduct = v_abs, late_deduct = v_late,
    gross_pay = v_gross, insured_salary = v_ins, li_emp = v_li, nhi_emp = v_nhi, pension_self = v_pen,
    deduct_total = v_ded, net_pay = v_gross - v_ded,
    er_li = v_er_li, er_nhi = v_er_nhi, er_pension = v_er_pen, total_cost = v_gross + v_er_li + v_er_nhi + v_er_pen,
    warnings = w, computed_at = now()
  where id = p_item_id;
end $$;

-- 產生／重新計算某月薪資（保留已填的績效獎金等）
create or replace function public.payroll_generate(p_period date)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_co uuid := current_company_id(); v_period date := date_trunc('month', p_period)::date;
  v_run payroll_runs; e record; v_item uuid; n int := 0; v_missing text[] := '{}';
begin
  if not has_perm('payroll', 'edit') then raise exception 'P0005: 沒有薪資計算的權限' using errcode = '42501'; end if;
  insert into payroll_params (company_id) values (v_co) on conflict do nothing;
  if v_period > date_trunc('month', now() at time zone 'Asia/Taipei')::date then
    raise exception 'P0003: 不能計算未來月份的薪資';
  end if;
  select * into v_run from payroll_runs where company_id = v_co and period = v_period for update;
  if v_run.id is null then
    insert into payroll_runs (company_id, period, created_by, updated_by)
    values (v_co, v_period, auth.uid(), auth.uid()) returning * into v_run;
  elsif v_run.status = 'closed' then
    raise exception 'P0002: 這個月薪資已鎖定，要重算請先解除鎖定';
  end if;

  -- 沒有薪資設定、或已離職的人移出
  execute 'dele' || 'te from payroll_items i where i.run_id = $1 and not exists ('
       || 'select 1 from employee_pay_profiles pp join employees em on em.id = pp.employee_id '
       || 'where pp.employee_id = i.employee_id and em.is_active)' using v_run.id;

  for e in
    select em.id, em.emp_no, em.name, to_jsonb(pp) as profile, pp.pay_type
      from employees em join employee_pay_profiles pp on pp.employee_id = em.id
     where em.company_id = v_co and em.is_active
     order by em.emp_no
  loop
    insert into payroll_items (run_id, company_id, employee_id, emp_no, employee_name, pay_type, profile, att)
    values (v_run.id, v_co, e.id, e.emp_no, e.name, e.pay_type, e.profile, _payroll_att(e.id, v_period))
    on conflict (run_id, employee_id) do update
      set emp_no = excluded.emp_no, employee_name = excluded.employee_name, pay_type = excluded.pay_type,
          profile = excluded.profile, att = excluded.att
    returning id into v_item;
    perform _payroll_compute(v_item);
    n := n + 1;
  end loop;

  select coalesce(array_agg(em.name order by em.emp_no), '{}') into v_missing
    from employees em
   where em.company_id = v_co and em.is_active
     and not exists (select 1 from employee_pay_profiles pp where pp.employee_id = em.id);

  update payroll_runs set updated_at = now(), updated_by = auth.uid() where id = v_run.id;
  return jsonb_build_object('ok', true, 'run_id', v_run.id, 'count', n, 'no_profile', v_missing);
end $$;

create or replace function public.payroll_update_item(
  p_item_id uuid, p_perf_bonus numeric, p_other_add numeric, p_income_tax numeric, p_other_deduct numeric,
  p_pay_days numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_it payroll_items; v_status text;
begin
  if not has_perm('payroll', 'edit') then raise exception 'P0005: 沒有薪資計算的權限' using errcode = '42501'; end if;
  select i.* into v_it from payroll_items i where i.id = p_item_id and i.company_id = current_company_id();
  if v_it.id is null then raise exception 'P0001: 找不到這筆薪資'; end if;
  select status into v_status from payroll_runs where id = v_it.run_id;
  if v_status = 'closed' then raise exception 'P0002: 這個月薪資已鎖定，要修改請先解除鎖定'; end if;
  if coalesce(p_perf_bonus, 0) < 0 or coalesce(p_other_add, 0) < 0 or coalesce(p_income_tax, 0) < 0
     or coalesce(p_other_deduct, 0) < 0 then
    raise exception 'P0003: 金額不能是負數';
  end if;
  if p_pay_days is not null and (p_pay_days < 0 or p_pay_days > 30) then
    raise exception 'P0003: 計薪天數要在 0～30 之間';
  end if;
  update payroll_items set perf_bonus = coalesce(p_perf_bonus, 0), other_add = coalesce(p_other_add, 0),
         income_tax = coalesce(p_income_tax, 0), other_deduct = coalesce(p_other_deduct, 0),
         pay_days_override = p_pay_days, note = nullif(trim(p_note), '')
   where id = p_item_id;
  perform _payroll_compute(p_item_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.payroll_close(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run payroll_runs; it record; n int := 0;
begin
  if not has_perm('payroll', 'edit') then raise exception 'P0005: 沒有薪資計算的權限' using errcode = '42501'; end if;
  select * into v_run from payroll_runs where id = p_run_id and company_id = current_company_id() for update;
  if v_run.id is null then raise exception 'P0001: 找不到這個月的薪資'; end if;
  if v_run.status = 'closed' then raise exception 'P0002: 已經鎖定了'; end if;
  if not exists (select 1 from payroll_items where run_id = p_run_id) then
    raise exception 'P0003: 這個月還沒有任何人的薪資';
  end if;
  update payroll_runs set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_run_id;
  for it in select employee_id from payroll_items where run_id = p_run_id loop
    perform emit_notification(v_run.company_id, 'payroll_published', 'payroll', p_run_id, it.employee_id,
      '薪資條已發布',
      to_char(v_run.period, 'YYYY') || ' 年 ' || extract(month from v_run.period) || ' 月薪資條已發布，請到打卡頁「我的薪資條」查看。',
      '');
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'notified', n);
end $$;

create or replace function public.payroll_reopen(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run payroll_runs;
begin
  if not has_perm('payroll', 'edit') then raise exception 'P0005: 沒有薪資計算的權限' using errcode = '42501'; end if;
  select * into v_run from payroll_runs where id = p_run_id and company_id = current_company_id() for update;
  if v_run.id is null then raise exception 'P0001: 找不到這個月的薪資'; end if;
  if v_run.status <> 'closed' then raise exception 'P0002: 還沒有鎖定'; end if;
  update payroll_runs set status = 'draft', closed_at = null, closed_by = null where id = p_run_id;
  return jsonb_build_object('ok', true);
end $$;

-- 員工看自己已發布的薪資條
create or replace function public.my_payslips()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg((to_jsonb(i) - 'profile' - 'warnings') || jsonb_build_object('period', r.period) order by r.period desc), '[]'::jsonb)
    from payroll_items i join payroll_runs r on r.id = i.run_id
   where i.employee_id = current_employee_id() and r.status = 'closed';
$$;

-- ---------- 4. 模組、選單、權限、通知規則 ----------
insert into public.module_registry (module_key, name, category, default_enabled, sort_order, is_active)
values ('payroll', '薪資計算', 'hr', true, 135, true)
on conflict (module_key) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, 'payroll', true from public.companies c
on conflict do nothing;

-- 薪資只有老闆看得到；要讓店長幫忙，在「角色與權限」打開
insert into public.role_module_permissions (company_id, role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.company_id, r.id, 'payroll', r.tier = 'owner', r.tier = 'owner', r.tier = 'owner', r.tier = 'owner', r.tier = 'owner'
  from public.roles r
on conflict do nothing;

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'payroll', (select id from public.menus where menu_key = 'grp_hr'), '薪資計算', 'Wallet',
       '/dashboard/payroll', 'payroll', 50, true
where not exists (select 1 from public.menus where menu_key = 'payroll');

insert into public.notification_rules (company_id, rule_code, name, category, trigger_kind, is_enabled, params,
                                       recipient_scopes, in_app_enabled, line_enabled, line_mode, template_title)
select c.id, v.code, v.name, 'attendance', 'event', true, '{}'::jsonb, v.scopes, true, true, 'immediate', v.name
  from public.companies c
 cross join (values
   ('leave_requested',   '請假申請待核准', array['manager']),
   ('leave_decided',     '請假審核結果',   array['owner']),
   ('payroll_published', '薪資條已發布',   array['owner'])
 ) as v(code, name, scopes)
on conflict do nothing;

revoke execute on function public.leave_request(text, date, date, numeric, text) from public, anon;
revoke execute on function public.leave_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.leave_cancel(uuid) from public, anon;
revoke execute on function public.payroll_generate(date) from public, anon;
revoke execute on function public.payroll_update_item(uuid, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.payroll_close(uuid) from public, anon;
revoke execute on function public.payroll_reopen(uuid) from public, anon;
revoke execute on function public.my_payslips() from public, anon;
revoke execute on function public._payroll_compute(uuid) from public, anon, authenticated;
revoke execute on function public._payroll_att(uuid, date) from public, anon, authenticated;
grant execute on function public.leave_request(text, date, date, numeric, text) to authenticated;
grant execute on function public.leave_decide(uuid, boolean, text) to authenticated;
grant execute on function public.leave_cancel(uuid) to authenticated;
grant execute on function public.payroll_generate(date) to authenticated;
grant execute on function public.payroll_update_item(uuid, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.payroll_close(uuid) to authenticated;
grant execute on function public.payroll_reopen(uuid) to authenticated;
grant execute on function public.my_payslips() to authenticated;
