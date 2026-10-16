-- =====================================================================
-- 027：UAT 後續修正
--  1. 「未打上班卡」掃描：只對有登入帳號的員工、週末與假日不提醒
--  2. 外包連結記錄雙方單號（兩家互相看不到對方訂單，畫面原本顯示「—」）
-- =====================================================================

-- 1. clock_in_missing
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.notify_scan_all()'::regprocedure);
  if position('-- guard:027' in v_def) > 0 then return; end if;
  v_new := replace(v_def,
$a$     where e.is_active
       and sh.is_active
       and (v_now at time zone 'Asia/Taipei')::time > (sh.start_time + (sh.late_tolerance_minutes || ' minutes')::interval)$a$,
$b$     where e.is_active
       and sh.is_active
       -- guard:027 沒有登入帳號的員工不會打卡；週末、國定假日／公司休假不提醒
       and e.user_id is not null
       and extract(isodow from v_today) < 6
       and not exists (select 1 from holidays h
                        where h.company_id = e.company_id and h.holiday_date = v_today
                          and h.kind in ('national', 'company'))
       and (v_now at time zone 'Asia/Taipei')::time > (sh.start_time + (sh.late_tolerance_minutes || ' minutes')::interval)$b$);
  if v_new = v_def then raise exception 'clock_in_missing block not found'; end if;
  execute v_new;
end $$;

-- 2. 外包連結雙方單號
alter table public.cross_company_links add column if not exists from_order_no text;
alter table public.cross_company_links add column if not exists to_order_no text;

create or replace function public.trg_link_order_nos_fn()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.from_order_id is not null then
    select order_no into new.from_order_no from orders where id = new.from_order_id;
  end if;
  if new.to_order_id is not null then
    select order_no into new.to_order_no from orders where id = new.to_order_id;
  end if;
  return new;
end $$;
create trigger trg_link_order_nos before insert or update of from_order_id, to_order_id
  on public.cross_company_links for each row execute function public.trg_link_order_nos_fn();
revoke execute on function public.trg_link_order_nos_fn() from public, anon, authenticated;

update public.cross_company_links l
   set from_order_no = (select order_no from public.orders where id = l.from_order_id),
       to_order_no   = (select order_no from public.orders where id = l.to_order_id)
 where l.from_order_no is null or l.to_order_no is null;
