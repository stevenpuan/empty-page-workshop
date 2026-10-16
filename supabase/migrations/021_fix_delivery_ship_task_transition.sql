-- 021：出貨單自動完成出貨站工序時，pending→done 會被 trg_task_transition_check 擋下
-- 改為先轉 in_progress 再轉 done（019 檔案內容已同步為修正後版本；此檔供已套用 019 的環境補丁）
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.create_delivery_note(uuid,date,text,text,text)'::regprocedure);
  if position('依狀態機先轉進行中' in v_def) > 0 then return; end if;
  v_def := replace(v_def,
$a$  update order_tasks set status = 'done', done_at = now(), updated_at = now()
   where order_id = p_order_id and status not in ('done', 'skipped', 'outsourced')
     and station_id in (select id from work_stations where code in ('SHIP', 'QCSHIP'));$a$,
$b$  -- 出貨站工序：依狀態機先轉進行中再完成
  update order_tasks set status = 'in_progress', updated_at = now()
   where order_id = p_order_id and status in ('pending', 'assigned', 'blocked', 'waiting_customer')
     and station_id in (select id from work_stations where code in ('SHIP', 'QCSHIP'));
  update order_tasks set status = 'done', done_at = now(), updated_at = now()
   where order_id = p_order_id and status = 'in_progress'
     and station_id in (select id from work_stations where code in ('SHIP', 'QCSHIP'));$b$);
  if position('依狀態機先轉進行中' in v_def) = 0 then raise exception 'patch failed'; end if;
  execute v_def;
end $$;
