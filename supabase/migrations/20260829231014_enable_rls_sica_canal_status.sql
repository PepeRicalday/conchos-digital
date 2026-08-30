-- Activa RLS en sica_canal_status (tabla huérfana sin consumidor en frontend hoy,
-- pero conservada por si se reactiva). Detectada sin RLS por el advisor de seguridad
-- de Supabase (rls_disabled_in_public, ERROR, exposición externa vía anon key).
--
-- Sigue el mismo patrón de sica_llenado_snapshots: lectura pública, escritura
-- restringida a usuarios autenticados.

ALTER TABLE public.sica_canal_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sica_canal_status_select"
ON public.sica_canal_status
FOR SELECT
TO public
USING (true);

CREATE POLICY "sica_canal_status_write"
ON public.sica_canal_status
FOR ALL
TO public
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');
