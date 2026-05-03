-- ── Fix: RLS infinite recursion en perfiles ──────────────────────────
-- Las políticas de zonas_canal y modulo_zonas usaban subqueries inline
-- (SELECT rol FROM perfiles WHERE id = auth.uid()), lo que dispara la
-- política recursiva existente en la tabla perfiles.
--
-- Solución: reemplazar subqueries con funciones SECURITY DEFINER que
-- consultan perfiles como el dueño (postgres), sin pasar por RLS.

-- ── 1. Funciones helper SECURITY DEFINER ─────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM public.perfiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_modulo_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT modulo_id::text FROM public.perfiles WHERE id = auth.uid();
$$;

-- ── 2. Políticas de zonas_canal ───────────────────────────────────────

DROP POLICY IF EXISTS "zonas_canal_srl_all" ON public.zonas_canal;

CREATE POLICY "zonas_canal_srl_all" ON public.zonas_canal
    FOR ALL
    USING (public.auth_rol() = 'SRL');

-- ── 3. Políticas de modulo_zonas ─────────────────────────────────────

DROP POLICY IF EXISTS "modulo_zonas_srl_all" ON public.modulo_zonas;

CREATE POLICY "modulo_zonas_srl_all" ON public.modulo_zonas
    FOR ALL
    USING (public.auth_rol() = 'SRL');

-- ── 4. Políticas de entregas_modulo ──────────────────────────────────

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

-- ── Grants para las funciones helper ─────────────────────────────────
GRANT EXECUTE ON FUNCTION public.auth_rol()       TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auth_modulo_id() TO authenticated, anon;
