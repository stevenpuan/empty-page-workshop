-- ============================================================
-- Sprint S6 · 出勤打卡
-- migration: 010_attendance.sql
-- 相依：009_purchasing.sql（S5）
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Section 1: haversine_m() — 兩點距離（公尺）
-- ────────────────────────────────────────────────────────────
create or replace function public.haversine_m(
  lat1 numeric, lng1 numeric,
  lat2 numeric, lng2 numeric
) returns numeric
language sql immutable strict
as $$
  select (
    6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  )::numeric(12,2)
$$;

comment on function public.haversine_m(numeric,numeric,numeric,numeric)
  is 'Haversine 公式：回傳兩經緯度之間的距離（公尺）';

-- ────────────────────────────────────────────────────────────
-- Section 2: attendances 出勤紀錄表
-- ────────────────────────────────────────────────────────────
create table if not exists public.attendances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  employee_id     uuid not null references public.employees(id),
  shift_id        uuid references public.shifts(id),
  work_date       date not null,

  -- 上班打卡
  clock_in_at     timestamptz,
  clock_in_lat    numeric(10,7),
  clock_in_lng    numeric(10,7),
  clock_in_distance_m  numeric(10,2),

  -- 下班打卡
  clock_out_at    timestamptz,
  clock_out_lat   numeric(10,7),
  clock_out_lng   numeric(10,7),
  clock_out_distance_m numeric(10,2),

  -- 狀態與計算
  status          text not null default 'missing'
    check (status in ('normal','late','early_leave','missing','absent','off')),
  late_minutes       integer not null default 0,
  early_leave_minutes integer not null default 0,
  work_minutes       integer not null default 0,
  ot_minutes_134     integer not null default 0,   -- 平日加班（前 2h, ×1.34）
  ot_minutes_167     integer not null default 0,   -- 平日加班（2h+, ×1.67）
  ot_minutes_holiday integer not null default 0,   -- 休息日/假日加班

  -- 異常
  is_abnormal_location boolean not null default false,
  abnormal_reason  text,

  -- 裝置
  device_hash      text,
  ip               text,

  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,

  constraint attendances_employee_date_uq unique(employee_id, work_date)
);

create index if not exists idx_attendances_company on public.attendances(company_id);
create index if not exists idx_attendances_date on public.attendances(work_date);
create index if not exists idx_attendances_employee on public.attendances(employee_id, work_date);

comment on table public.attendances is '每日出勤紀錄，一人一天一筆';

-- ────────────────────────────────────────────────────────────
-- Section 3: attendance_amendments 補卡 / 修正申請
-- ────────────────────────────────────────────────────────────
create table if not exists public.attendance_amendments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  attendance_id   uuid references public.attendances(id),
  employee_id     uuid not null references public.employees(id),
  request_type    text not null
    check (request_type in ('clock_in','clock_out','both')),
  request_time    timestamptz not null,       -- 補打時間
  request_time_out timestamptz,               -- both 時的補打下班時間
  reason          text not null,
  status          text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  approver_id     uuid references public.employees(id),
  approved_at     timestamptz,
  approver_note   text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

create index if not exists idx_amendments_company on public.attendance_amendments(company_id);
create index if not exists idx_amendments_employee on public.attendance_amendments(employee_id);
create index if not exists idx_amendments_status on public.attendance_amendments(status);

comment on table public.attendance_amendments is '補卡／修正申請，需 manager/owner 核准';

-- ────────────────────────────────────────────────────────────
-- Section 4: RLS — attendances
-- ────────────────────────────────────────────────────────────
alter table public.attendances enable row level security;

-- owner/manager 看全公司
drop policy if exists attendances_manager_select on public.attendances;
create policy attendances_manager_select on public.attendances
  for select using (
    company_id = public.current_company_id()
    and public.is_manager()
  );

-- staff 只看自己
drop policy if exists attendances_staff_select on public.attendances;
create policy attendances_staff_select on public.attendances
  for select using (
    company_id = public.current_company_id()
    and employee_id = public.current_employee_id()
  );

-- insert: 只有 RPC (security definer) 做，但保留 manager 手動建立
drop policy if exists attendances_insert on public.attendances;
create policy attendances_insert on public.attendances
  for insert with check (
    company_id = public.current_company_id()
    and (
      employee_id = public.current_employee_id()
      or public.is_manager()
    )
  );

-- update: manager 可改全公司，staff 只改自己
drop policy if exists attendances_update on public.attendances;
create policy attendances_update on public.attendances
  for update using (
    company_id = public.current_company_id()
    and (
      employee_id = public.current_employee_id()
      or public.is_manager()
    )
  ) with check (
    company_id = public.current_company_id()
    and (
      employee_id = public.current_employee_id()
      or public.is_manager()
    )
  );

-- ────────────────────────────────────────────────────────────
-- Section 5: RLS — attendance_amendments
-- ────────────────────────────────────────────────────────────
alter table public.attendance_amendments enable row level security;

-- owner/manager 看全公司
drop policy if exists amendments_manager_select on public.attendance_amendments;
create policy amendments_manager_select on public.attendance_amendments
  for select using (
    company_id = public.current_company_id()
    and public.is_manager()
  );

-- staff 只看自己
drop policy if exists amendments_staff_select on public.attendance_amendments;
create policy amendments_staff_select on public.attendance_amendments
  for select using (
    company_id = public.current_company_id()
    and employee_id = public.current_employee_id()
  );

-- insert: 員工自己提補卡申請
drop policy if exists amendments_insert on public.attendance_amendments;
create policy amendments_insert on public.attendance_amendments
  for insert with check (
    company_id = public.current_company_id()
    and employee_id = public.current_employee_id()
  );

-- update: manager 核准/駁回
drop policy if exists amendments_update on public.attendance_amendments;
create policy amendments_update on public.attendance_amendments
  for update using (
    company_id = public.current_company_id()
    and public.is_manager()
  ) with check (
    company_id = public.current_company_id()
    and public.is_manager()
  );

-- ────────────────────────────────────────────────────────────
-- Section 6: clock_in() RPC
-- ────────────────────────────────────────────────────────────
create or replace function public.clock_in(
  p_lat numeric,
  p_lng numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp_id       uuid;
  v_company_id   uuid;
  v_shift_id     uuid;
  v_today        date;
  v_now          timestamptz;
  v_company      record;
  v_shift        record;
  v_distance     numeric;
  v_abnormal     boolean := false;
  v_abnormal_reason text;
  v_att_id       uuid;
  v_late_min     integer := 0;
  v_status       text := 'normal';
begin
  -- 取得員工與公司
  v_emp_id := public.current_employee_id();
  v_company_id := public.current_company_id();
  if v_emp_id is null then
    raise exception '無法識別員工身分';
  end if;

  v_today := (now() at time zone 'Asia/Taipei')::date;
  v_now   := now();

  -- 取公司打卡座標
  select lat, lng, clock_radius_m into v_company
  from companies where id = v_company_id;

  -- 取班別（從員工設定）
  select e.shift_id into v_shift_id
  from employees e where e.id = v_emp_id;

  if v_shift_id is not null then
    select * into v_shift from shifts where id = v_shift_id;
  end if;

  -- 後端重算距離
  if v_company.lat is not null and v_company.lng is not null
     and p_lat is not null and p_lng is not null then
    v_distance := public.haversine_m(v_company.lat, v_company.lng, p_lat, p_lng);
    if v_distance > v_company.clock_radius_m then
      v_abnormal := true;
      v_abnormal_reason := format('打卡距離 %sm 超過允許範圍 %sm',
        round(v_distance), v_company.clock_radius_m);
    end if;
  end if;

  -- 遲到判斷
  if v_shift.start_time is not null then
    declare
      v_scheduled timestamptz;
    begin
      v_scheduled := (v_today + v_shift.start_time +
                      (coalesce(v_shift.late_tolerance_minutes, 0) || ' minutes')::interval)
                     at time zone 'Asia/Taipei';
      if v_now > v_scheduled then
        v_late_min := extract(epoch from (v_now - (v_today + v_shift.start_time) at time zone 'Asia/Taipei'))::integer / 60;
        if v_late_min < 0 then v_late_min := 0; end if;
        v_status := 'late';
      end if;
    end;
  end if;

  -- 檢查是否已打過上班卡
  select id into v_att_id
  from attendances
  where employee_id = v_emp_id and work_date = v_today;

  if v_att_id is not null then
    -- 已有記錄，檢查是否已打過上班卡
    perform 1 from attendances
    where id = v_att_id and clock_in_at is not null;
    if found then
      raise exception '今日已打過上班卡';
    end if;
    -- 補上班打卡（可能是先建了空記錄）
    update attendances set
      clock_in_at = v_now,
      clock_in_lat = p_lat,
      clock_in_lng = p_lng,
      clock_in_distance_m = v_distance,
      status = v_status,
      late_minutes = v_late_min,
      is_abnormal_location = v_abnormal,
      abnormal_reason = v_abnormal_reason,
      updated_at = now(),
      updated_by = auth.uid()
    where id = v_att_id;
  else
    -- 建立新出勤記錄
    insert into attendances (
      company_id, employee_id, shift_id, work_date,
      clock_in_at, clock_in_lat, clock_in_lng, clock_in_distance_m,
      status, late_minutes,
      is_abnormal_location, abnormal_reason,
      device_hash, created_by, updated_by
    ) values (
      v_company_id, v_emp_id, v_shift_id, v_today,
      v_now, p_lat, p_lng, v_distance,
      v_status, v_late_min,
      v_abnormal, v_abnormal_reason,
      null, auth.uid(), auth.uid()
    )
    returning id into v_att_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_att_id,
    'clock_in_at', v_now,
    'distance_m', round(v_distance),
    'is_abnormal', v_abnormal,
    'abnormal_reason', v_abnormal_reason,
    'status', v_status,
    'late_minutes', v_late_min
  );
end;
$$;

comment on function public.clock_in(numeric,numeric) is '上班打卡：建立/更新當日出勤，後端重算距離';

-- ────────────────────────────────────────────────────────────
-- Section 7: clock_out() RPC
-- ────────────────────────────────────────────────────────────
create or replace function public.clock_out(
  p_lat numeric,
  p_lng numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_emp_id       uuid;
  v_company_id   uuid;
  v_today        date;
  v_now          timestamptz;
  v_company      record;
  v_shift        record;
  v_att          record;
  v_distance     numeric;
  v_abnormal     boolean := false;
  v_abnormal_reason text;
  v_early_min    integer := 0;
  v_work_min     integer := 0;
  v_status       text;
  v_ot_134       integer := 0;
  v_ot_167       integer := 0;
  v_standard_min integer;
begin
  v_emp_id := public.current_employee_id();
  v_company_id := public.current_company_id();
  if v_emp_id is null then
    raise exception '無法識別員工身分';
  end if;

  v_today := (now() at time zone 'Asia/Taipei')::date;
  v_now   := now();

  -- 取出勤記錄
  select * into v_att from attendances
  where employee_id = v_emp_id and work_date = v_today;

  if v_att.id is null then
    raise exception '今日尚未打上班卡，請先打上班卡';
  end if;
  if v_att.clock_in_at is null then
    raise exception '今日尚未打上班卡，請先打上班卡';
  end if;
  if v_att.clock_out_at is not null then
    raise exception '今日已打過下班卡';
  end if;

  -- 取公司座標
  select lat, lng, clock_radius_m into v_company
  from companies where id = v_company_id;

  -- 後端重算距離
  if v_company.lat is not null and v_company.lng is not null
     and p_lat is not null and p_lng is not null then
    v_distance := public.haversine_m(v_company.lat, v_company.lng, p_lat, p_lng);
    if v_distance > v_company.clock_radius_m then
      v_abnormal := true;
      v_abnormal_reason := format('下班打卡距離 %sm 超過允許範圍 %sm',
        round(v_distance), v_company.clock_radius_m);
    end if;
  end if;

  -- 取班別
  if v_att.shift_id is not null then
    select * into v_shift from shifts where id = v_att.shift_id;
  end if;

  -- 早退判斷
  if v_shift.end_time is not null then
    declare
      v_scheduled_end timestamptz;
    begin
      v_scheduled_end := (v_today + v_shift.end_time) at time zone 'Asia/Taipei';
      if v_now < v_scheduled_end then
        v_early_min := extract(epoch from (v_scheduled_end - v_now))::integer / 60;
      end if;
    end;
  end if;

  -- 工時計算（分鐘）
  v_work_min := extract(epoch from (v_now - v_att.clock_in_at))::integer / 60;
  -- 扣除休息時間
  if v_shift.break_minutes is not null and v_work_min > 0 then
    v_work_min := greatest(v_work_min - v_shift.break_minutes, 0);
  end if;

  -- 加班計算（標準工時 = shift duration - break）
  if v_shift.start_time is not null and v_shift.end_time is not null then
    v_standard_min := extract(epoch from (v_shift.end_time - v_shift.start_time))::integer / 60
                      - coalesce(v_shift.break_minutes, 0);
    if v_work_min > v_standard_min then
      declare
        v_ot_total integer;
      begin
        v_ot_total := v_work_min - v_standard_min;
        -- 前 2 小時 ×1.34，超過 ×1.67
        v_ot_134 := least(v_ot_total, 120);
        v_ot_167 := greatest(v_ot_total - 120, 0);
      end;
    end if;
  end if;

  -- 綜合狀態
  if v_att.late_minutes > 0 and v_early_min > 0 then
    v_status := 'late'; -- 遲到優先
  elsif v_att.late_minutes > 0 then
    v_status := 'late';
  elsif v_early_min > 0 then
    v_status := 'early_leave';
  else
    v_status := 'normal';
  end if;

  -- 合併上班異常
  if v_att.is_abnormal_location then
    v_abnormal := true;
    v_abnormal_reason := coalesce(v_att.abnormal_reason, '') ||
      case when v_abnormal then '; ' || v_abnormal_reason else '' end;
  end if;

  -- 更新
  update attendances set
    clock_out_at = v_now,
    clock_out_lat = p_lat,
    clock_out_lng = p_lng,
    clock_out_distance_m = v_distance,
    status = v_status,
    early_leave_minutes = v_early_min,
    work_minutes = v_work_min,
    ot_minutes_134 = v_ot_134,
    ot_minutes_167 = v_ot_167,
    is_abnormal_location = v_abnormal,
    abnormal_reason = v_abnormal_reason,
    updated_at = now(),
    updated_by = auth.uid()
  where id = v_att.id;

  return jsonb_build_object(
    'success', true,
    'attendance_id', v_att.id,
    'clock_out_at', v_now,
    'distance_m', round(v_distance),
    'is_abnormal', v_abnormal,
    'status', v_status,
    'work_minutes', v_work_min,
    'early_leave_minutes', v_early_min,
    'ot_minutes_134', v_ot_134,
    'ot_minutes_167', v_ot_167
  );
end;
$$;

comment on function public.clock_out(numeric,numeric) is '下班打卡：更新當日出勤，計算工時與加班';

-- ────────────────────────────────────────────────────────────
-- Section 8: approve_amendment() RPC
-- ────────────────────────────────────────────────────────────
create or replace function public.approve_amendment(
  p_amendment_id uuid,
  p_approved     boolean,
  p_note         text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_amd          record;
  v_att          record;
  v_emp_id       uuid;
  v_company_id   uuid;
  v_today        date;
begin
  v_emp_id := public.current_employee_id();
  v_company_id := public.current_company_id();

  -- 驗證 manager 權限
  if not public.is_manager() then
    raise exception '只有主管或老闆可以核准補卡申請';
  end if;

  -- 取補卡申請
  select * into v_amd from attendance_amendments
  where id = p_amendment_id and company_id = v_company_id;

  if v_amd.id is null then
    raise exception '找不到此補卡申請';
  end if;
  if v_amd.status <> 'pending' then
    raise exception '此申請已處理（%）', v_amd.status;
  end if;

  -- 更新申請狀態
  update attendance_amendments set
    status = case when p_approved then 'approved' else 'rejected' end,
    approver_id = v_emp_id,
    approved_at = now(),
    approver_note = p_note,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_amendment_id;

  -- 核准：回寫出勤紀錄
  if p_approved then
    -- 取或建出勤記錄
    v_today := (v_amd.request_time at time zone 'Asia/Taipei')::date;

    select * into v_att from attendances
    where employee_id = v_amd.employee_id and work_date = v_today;

    if v_att.id is null then
      -- 建立出勤紀錄
      insert into attendances (
        company_id, employee_id, shift_id, work_date,
        status, created_by, updated_by
      )
      select
        v_company_id, v_amd.employee_id, e.shift_id, v_today,
        'missing', auth.uid(), auth.uid()
      from employees e where e.id = v_amd.employee_id
      returning * into v_att;
    end if;

    -- 回寫打卡時間
    if v_amd.request_type in ('clock_in', 'both') then
      update attendances set
        clock_in_at = v_amd.request_time,
        status = 'normal',
        updated_at = now(),
        updated_by = auth.uid()
      where id = v_att.id;
    end if;

    if v_amd.request_type in ('clock_out', 'both') then
      declare
        v_out_time timestamptz;
        v_work_min integer := 0;
        v_cin timestamptz;
        v_shift_rec record;
      begin
        v_out_time := case
          when v_amd.request_type = 'both' then coalesce(v_amd.request_time_out, v_amd.request_time)
          else v_amd.request_time
        end;

        -- 重新取得（可能剛更新了 clock_in_at）
        select * into v_att from attendances where id = v_att.id;
        v_cin := v_att.clock_in_at;

        if v_cin is not null then
          v_work_min := extract(epoch from (v_out_time - v_cin))::integer / 60;
          if v_att.shift_id is not null then
            select * into v_shift_rec from shifts where id = v_att.shift_id;
            v_work_min := greatest(v_work_min - coalesce(v_shift_rec.break_minutes, 0), 0);
          end if;
        end if;

        update attendances set
          clock_out_at = v_out_time,
          work_minutes = v_work_min,
          status = case
            when v_att.clock_in_at is not null then 'normal'
            else status
          end,
          updated_at = now(),
          updated_by = auth.uid()
        where id = v_att.id;
      end;
    end if;

    -- 更新 amendment 的 attendance_id
    update attendance_amendments set
      attendance_id = v_att.id
    where id = p_amendment_id and attendance_id is null;
  end if;

  return jsonb_build_object(
    'success', true,
    'amendment_id', p_amendment_id,
    'result', case when p_approved then 'approved' else 'rejected' end
  );
end;
$$;

comment on function public.approve_amendment(uuid,boolean,text) is '核准/駁回補卡申請，核准時回寫出勤紀錄';

-- ────────────────────────────────────────────────────────────
-- Section 9: attendance_monthly_summary VIEW
-- ────────────────────────────────────────────────────────────
create or replace view public.attendance_monthly_summary as
select
  a.company_id,
  a.employee_id,
  e.emp_no,
  e.name as employee_name,
  date_trunc('month', a.work_date)::date as month,
  count(*)                                          as total_days,
  count(*) filter (where a.status = 'normal')       as normal_days,
  count(*) filter (where a.status = 'late')         as late_days,
  count(*) filter (where a.status = 'early_leave')  as early_leave_days,
  count(*) filter (where a.status = 'absent')       as absent_days,
  count(*) filter (where a.status = 'off')          as off_days,
  count(*) filter (where a.status = 'missing')      as missing_days,
  coalesce(sum(a.late_minutes), 0)                  as total_late_minutes,
  coalesce(sum(a.early_leave_minutes), 0)           as total_early_leave_minutes,
  coalesce(sum(a.work_minutes), 0)                  as total_work_minutes,
  coalesce(sum(a.ot_minutes_134), 0)                as total_ot_134,
  coalesce(sum(a.ot_minutes_167), 0)                as total_ot_167,
  coalesce(sum(a.ot_minutes_holiday), 0)            as total_ot_holiday,
  count(*) filter (where a.is_abnormal_location)    as abnormal_count
from attendances a
join employees e on e.id = a.employee_id
where a.status <> 'off'
group by a.company_id, a.employee_id, e.emp_no, e.name, date_trunc('month', a.work_date);

comment on view public.attendance_monthly_summary is '月出勤彙總（記帳士格式：出勤天數、遲到、早退、加班分鐘）';

-- ────────────────────────────────────────────────────────────
-- Section 10: updated_at triggers
-- ────────────────────────────────────────────────────────────
drop trigger if exists set_attendances_updated_at on public.attendances;
create trigger set_attendances_updated_at
  before update on public.attendances
  for each row execute function public.set_updated_at();

drop trigger if exists set_amendments_updated_at on public.attendance_amendments;
create trigger set_amendments_updated_at
  before update on public.attendance_amendments
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Section 11: attendance_daily_report VIEW（前端出勤管理頁用）
-- ────────────────────────────────────────────────────────────
create or replace view public.attendance_daily_report as
select
  a.id,
  a.company_id,
  a.employee_id,
  e.emp_no,
  e.name as employee_name,
  a.work_date,
  s.name as shift_name,
  s.start_time as shift_start,
  s.end_time as shift_end,
  a.clock_in_at,
  a.clock_in_distance_m,
  a.clock_out_at,
  a.clock_out_distance_m,
  a.status,
  a.late_minutes,
  a.early_leave_minutes,
  a.work_minutes,
  a.ot_minutes_134,
  a.ot_minutes_167,
  a.ot_minutes_holiday,
  a.is_abnormal_location,
  a.abnormal_reason,
  -- 補卡狀態
  (select count(*) from attendance_amendments am
   where am.attendance_id = a.id and am.status = 'pending') as pending_amendments
from attendances a
join employees e on e.id = a.employee_id
left join shifts s on s.id = a.shift_id;

comment on view public.attendance_daily_report is '每日出勤明細（含班別、補卡狀態），用於 /attendance 頁';
