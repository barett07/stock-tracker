CREATE OR REPLACE FUNCTION public.get_distinct_weeks()
RETURNS TABLE (week_end date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT h.week_end
  FROM public.st_holdings AS h
  ORDER BY h.week_end DESC;
$$;

REVOKE ALL ON FUNCTION public.get_distinct_weeks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_distinct_weeks() TO anon;
GRANT EXECUTE ON FUNCTION public.get_distinct_weeks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_distinct_weeks() TO service_role;
