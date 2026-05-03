-- ═══════════════════════════════════════════════════════════════════════
-- CORRECCIÓN: auth_rol() y auth_modulo_id() consultaban public.perfiles
-- pero la tabla real del sistema es public.perfiles_usuario.
--
-- Las políticas RLS de entregas_modulo fallaban con:
--   "new row violates row-level security policy for table 'entregas_modulo'"
-- porque auth_modulo_id() devolvía NULL para todos los usuarios ACU.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Corregir funciones helper SECURITY DEFINER ────────────────────

CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM public.perfiles_usuario WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_modulo_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT modulo_id::text FROM public.perfiles_usuario WHERE id = auth.uid();
$$;

-- ── 2. Re-crear políticas de entregas_modulo usando las funciones corregidas ──
-- (Los nombres son los mismos — DROP+CREATE para garantizar refresh)

DROP POLICY IF EXISTS "entregas_select_own"  ON public.entregas_modulo;
DROP POLICY IF EXISTS "entregas_insert_actu" ON public.entregas_modulo;
DROP POLICY IF EXISTS "entregas_update_actu" ON public.entregas_modulo;
DROP POLICY IF EXISTS "entregas_delete_srl"  ON public.entregas_modulo;

CREATE POLICY "entregas_select_own" ON public.entregas_modulo
    FOR SELECT USING (
        capturador_id = auth.uid()
        OR modulo_id = public.auth_modulo_id()
        OR public.auth_rol() IN ('SRL', 'AUDITORIA')
    );

CREATE POLICY "entregas_insert_actu" ON public.entregas_modulo
    FOR INSERT WITH CHECK (
        modulo_id = public.auth_modulo_id()
        OR public.auth_rol() = 'SRL'
    );

CREATE POLICY "entregas_update_actu" ON public.entregas_modulo
    FOR UPDATE USING (
        modulo_id = public.auth_modulo_id()
        OR public.auth_rol() = 'SRL'
    );

CREATE POLICY "entregas_delete_srl" ON public.entregas_modulo
    FOR DELETE USING (
        public.auth_rol() = 'SRL'
    );

-- ── 3. Grants ────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.auth_rol()       TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auth_modulo_id() TO authenticated, anon;


-- ── Test: verificar que devuelve valores reales ───────────────────────
-- SELECT public.auth_rol(), public.auth_modulo_id();
-- (Debe devolver el rol y modulo_id del usuario autenticado, no NULL)
