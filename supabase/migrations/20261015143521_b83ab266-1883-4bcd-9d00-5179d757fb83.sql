-- 1. Pin search_path on 6 SECURITY DEFINER functions
ALTER FUNCTION public.complete_outsource(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_task_status_log_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.dispatch_outsource(uuid, uuid, numeric, date, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.reject_outsource(uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_outsource(uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_auto_complete_outsource_fn() SET search_path = public, pg_temp;

-- 2. Tighten tautological INSERT policies to company scope
DROP POLICY payables_insert_system ON public.payables;
CREATE POLICY payables_insert_system ON public.payables
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY receivables_insert_system ON public.receivables;
CREATE POLICY receivables_insert_system ON public.receivables
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY cce_insert_system ON public.cross_company_events;
CREATE POLICY cce_insert_system ON public.cross_company_events
  FOR INSERT TO authenticated
  WITH CHECK (actor_company_id = public.current_company_id());