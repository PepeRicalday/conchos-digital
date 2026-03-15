-- Fix RLS for tracking table to ensure Public Monitor can see field reports
ALTER TABLE public.sica_llenado_seguimiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access for tracking" ON public.sica_llenado_seguimiento;
CREATE POLICY "Public read access for tracking"
ON public.sica_llenado_seguimiento
FOR SELECT
TO anon
USING (true);

-- Also allow anon to update if needed for local testing (optional but helpful)
-- GRANT ALL ON public.sica_llenado_seguimiento TO anon; 
