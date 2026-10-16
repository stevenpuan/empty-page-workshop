-- 031：員工沒有設定班別時，上下班打卡失敗（record "v_shift" is not assigned yet，代碼 55000）
--  1. v_shift 改用 shifts%rowtype（沒查到資料時欄位為 null，不會出錯）
--  2. 上班打卡：沒設定班別時，套用公司第一個啟用中的班別（才能判斷遲到；下班打卡沿用上班那筆的班別）
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.clock_in(numeric,numeric)'::regprocedure);
  if position('-- guard:031' in d) = 0 then
    n := regexp_replace(d, 'v_shift(\s+)record;', 'v_shift\1shifts%rowtype; -- guard:031');
    n := regexp_replace(n,
      E'(select e\\.shift_id into v_shift_id\\s+from employees e where e\\.id = v_emp_id;)',
      E'\\1\n\n  if v_shift_id is null then\n    select s.id into v_shift_id from shifts s\n     where s.company_id = v_company_id and s.is_active\n     order by s.created_at limit 1;\n  end if;');
    if position('guard:031' in n) = 0 or position('order by s.created_at limit 1' in n) = 0 then
      raise exception '031 patch failed for clock_in';
    end if;
    execute n;
  end if;

  d := pg_get_functiondef('public.clock_out(numeric,numeric)'::regprocedure);
  if position('-- guard:031' in d) = 0 then
    n := regexp_replace(d, 'v_shift(\s+)record;', 'v_shift\1shifts%rowtype; -- guard:031');
    if position('guard:031' in n) = 0 then raise exception '031 patch failed for clock_out'; end if;
    execute n;
  end if;
end $$;
