-- Enable public read access for critical telemetry tables
-- This allows the Public Monitor to function without authentication

-- 1. sica_eventos_log
ALTER TABLE public.sica_eventos_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access for hydric events" ON public.sica_eventos_log;
CREATE POLICY "Public read access for hydric events"
ON public.sica_eventos_log
FOR SELECT
TO anon
USING (true);

-- 2. escalas
ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access for escalas" ON public.escalas;
CREATE POLICY "Public read access for escalas"
ON public.escalas
FOR SELECT
TO anon
USING (true);

-- 3. lecturas_escalas
ALTER TABLE public.lecturas_escalas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access for readings" ON public.lecturas_escalas;
CREATE POLICY "Public read access for readings"
ON public.lecturas_escalas
FOR SELECT
TO anon
USING (true);

-- 4. sica_llenado_seguimiento
ALTER TABLE public.sica_llenado_seguimiento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read access for tracking" ON public.sica_llenado_seguimiento;
CREATE POLICY "Public read access for tracking"
ON public.sica_llenado_seguimiento
FOR SELECT
TO anon
USING (true); (true);
