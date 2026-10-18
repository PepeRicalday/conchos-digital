-- Seguridad: registro_alertas ya no admite escritura anónima (pendiente del 2026-10-06; analizado 2026-10-14).
-- Hallazgos (leídos de la BD viva): políticas INSERT y UPDATE con rol `public` (incluye anon) y `true`; anon tenía
-- INSERT/UPDATE/DELETE/TRUNCATE concedidos. Cualquiera con la clave anon (va en el bundle) podía crear o marcar como
-- resueltas alertas.
-- Quién escribe de verdad (verificado):
--   * Funciones/triggers en BD: check_dam_critical_level, check_desviacion_vaso_ndwi, check_module_overdraft,
--     fn_clima_alertas_agro, fn_clima_vigilar_red -> TODAS SECURITY DEFINER: no dependen de estas políticas.
--   * Edge function presas-cila-sync -> service role: ignora RLS.
--   * Front: Alertas (marcar resuelta) y Modelación (persistir decisiones URGENTE) -> usuario autenticado
--     (rutas con ProtectedRoute).
-- Se mantiene la lectura pública (Monitor Público). Pegar en el editor SQL de Supabase (NO db push).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'registro_alertas' AND cmd IN ('INSERT', 'UPDATE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.registro_alertas', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "alertas_insert_autenticados" ON public.registro_alertas
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "alertas_update_autenticados" ON public.registro_alertas
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.registro_alertas FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.registro_alertas FROM authenticated;

-- Verificación (debe mostrar solo SELECT para anon, y 2 políticas nuevas + la de lectura):
-- select grantee, privilege_type from information_schema.role_table_grants where table_name='registro_alertas' and grantee='anon';
-- select policyname, cmd, roles from pg_policies where tablename='registro_alertas';
