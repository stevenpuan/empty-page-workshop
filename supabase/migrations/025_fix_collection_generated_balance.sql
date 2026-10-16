-- 025：收款沖帳／作廢收款一律失敗——receivables.balance 是 generated column，函式卻直接寫入 balance
-- 移除兩支函式中的 balance = ... 指派（2026-10-16 UAT 模擬資料時發現）
do $$
declare f text; v_def text; v_new text;
begin
  foreach f in array array['public.allocate_collection(uuid,uuid,date,text,numeric,jsonb,text,text,date,text,uuid)', 'public.void_collection(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := regexp_replace(v_def, '\n\s*balance\s*=[^\n]*,', '', 'g');
    if v_new = v_def then continue; end if;
    if v_new ~* 'balance\s*=' then raise exception 'balance assignment still present in %', f; end if;
    execute v_new;
  end loop;
end $$;
