-- 023：所有 trigger 函式不開放給前端呼叫；之後新建的函式預設不給 authenticated 執行權（需在 migration 明確 grant）
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype = 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from authenticated;
