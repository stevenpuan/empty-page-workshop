-- =====================================================================
-- 018_fix_outsource_rejected_notify.sql
-- 「外包被拒接」通知從未觸發
-- 原 trigger 掛在 order_tasks、條件是 status = 'rejected'，但 order_tasks 沒有這個狀態；
-- reject_outsource 實際是把 cross_company_links.status 改成 'rejected'、祥興工序退回 pending。
-- 改為在 cross_company_links 轉為 rejected 時通知發包方（舊 trigger 永遠不會觸發，保留不動）。
-- 相依：011_notification_engine、014_security_fixes
-- =====================================================================
create or replace function public.trg_notify_outsource_rejected_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignee uuid;
  v_order_no text;
  v_station  text;
  v_reason   text;
begin
  select t.assignee_id, o.order_no, s.name
    into v_assignee, v_order_no, v_station
    from public.order_tasks t
    join public.orders o on o.id = t.order_id
    left join public.work_stations s on s.id = t.station_id
   where t.id = new.from_task_id;

  select e.payload->>'reason' into v_reason
    from public.cross_company_events e
   where e.link_id = new.id and e.event = 'reject'
   order by e.created_at desc limit 1;

  perform public.emit_notification(
    new.from_company_id, 'outsource_rejected', 'order_task', new.from_task_id, v_assignee,
    '外包被拒接',
    coalesce(v_order_no, '-') || ' 的外包工序「' || coalesce(v_station, '-') || '」被對方拒接'
      || coalesce('（原因：' || nullif(v_reason, '') || '）', '') || '，請重新安排',
    '', new.to_company_id);
  return new;
end;
$$;

revoke all on function public.trg_notify_outsource_rejected_link() from public, anon, authenticated;
grant execute on function public.trg_notify_outsource_rejected_link() to service_role;

create trigger trg_notify_outsource_rejected_link
  after update on public.cross_company_links
  for each row
  when (new.status = 'rejected' and old.status is distinct from 'rejected')
  execute function public.trg_notify_outsource_rejected_link();
