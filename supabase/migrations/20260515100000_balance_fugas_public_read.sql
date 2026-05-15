-- ═══════════════════════════════════════════════════════════════════════
-- FIX: Acceso público (anon) a fn_balance_hidrico_tramos y vol_interescalas
--
-- PublicMonitor usa la anon key. Las funciones hydraulicas solo tenian
-- GRANT TO authenticated. Esta migración habilita lectura pública para
-- las vistas y funciones que alimentan el panel de Modelación Hidráulica.
-- ═══════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION public.fn_balance_hidrico_tramos(date)
    TO anon;

GRANT EXECUTE ON FUNCTION public.fn_nivel_escala(text)
    TO anon;

GRANT EXECUTE ON FUNCTION public.fn_vol_interescala(numeric, numeric, numeric, numeric)
    TO anon;

GRANT SELECT ON public.vol_interescalas TO anon;
GRANT SELECT ON public.vol_zonas        TO anon;

-- fn_perfil_canal_completo (Phase 1B — se expone ahora, se cablea en siguiente iteracion)
GRANT EXECUTE ON FUNCTION public.fn_perfil_canal_completo(date, numeric, jsonb)
    TO authenticated;
