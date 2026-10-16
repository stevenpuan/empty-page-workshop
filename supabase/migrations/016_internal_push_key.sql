-- =====================================================================
-- 016_internal_push_key.sql
-- DB → Edge Function 內部呼叫金鑰
-- call_edge_function() 從 vault 讀 INTERNAL_PUSH_KEY 帶在 Bearer；原本 vault 沒有這把金鑰，推播一律 401。
-- 這裡在 vault 產生隨機金鑰（不經過任何人手），並提供只給 service_role 的驗證函式，
-- line-push 用它比對 Bearer，不必再手動設定 Edge Function secret。
-- 相依：011_notification_engine、014_security_fixes
-- =====================================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'INTERNAL_PUSH_KEY') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'INTERNAL_PUSH_KEY',
                                'DB → Edge Function 內部呼叫金鑰（016）');
  end if;
end $$;

create or replace function public.verify_internal_push_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_key, '') <> ''
     and exists (select 1 from vault.decrypted_secrets
                  where name = 'INTERNAL_PUSH_KEY' and decrypted_secret = p_key);
$$;

revoke all on function public.verify_internal_push_key(text) from public, anon, authenticated;
grant execute on function public.verify_internal_push_key(text) to service_role;
