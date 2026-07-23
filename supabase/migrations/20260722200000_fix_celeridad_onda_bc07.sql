-- ═══════════════════════════════════════════════════════════════════════
-- Fix: fn_celeridad_onda_ms desalineada con calibración BC-07 reconciliada
--
-- La migración 20260515110000_celeridad_onda_dinamica.sql dejó fijo
-- v_onda = 5.3 × Q^0.15 km/h (calibración de campo 23/04/2026, error
-- histórico ±12% en K-23 y K-104).
--
-- El skill hidráulico v3.7 (public/datos/skill_hidraulica_v37.md §5.1,
-- BC-07) documenta una reconciliación posterior con las mismas anclas
-- de campo que redujo el error a <2%:
--   v_onda = 4.5 × Q^0.15 km/h   (confianza 75%)
--   Ancla Q=28 → c=7.42 km/h → K-23 en ~186 min (obs. ~180 min ✓)
--                            → K-0→K-104 en ~882 min (obs. ~820 min ✓)
--
-- El frontend (src/pages/PublicMonitor.tsx) ya fue corregido a 4.5 el
-- 22/07/2026. Esta migración alinea la función de BD equivalente para
-- que vw_prediccion_arribo_escalas / vw_prediccion_arribo_tomas usen
-- la misma calibración vigente.
--
-- NO aplicar sin validar contra el ancla real vigente en campo — ver
-- memoria de proyecto "NUNCA db push sin verificar drift".
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_celeridad_onda_ms(p_q_m3s NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
    SELECT GREATEST(0.50, LEAST(3.50,
        (4.5 * POWER(GREATEST(p_q_m3s, 0.5), 0.15)) / 3.6
    ));
$$;

COMMENT ON FUNCTION public.fn_celeridad_onda_ms(NUMERIC) IS
    'Celeridad de onda de avenida en m/s. Modelo A, BC-07 reconciliado (skill v3.7 §5.1). '
    'v = 4.5 × Q^0.15 km/h (error <2% vs anclas K-23 y K-104). '
    'Dominio: [0.50, 3.50] m/s para Q en [5, 60] m³/s.';

-- ── Validación (ejecutar después del deploy) ──────────────────────────
-- SELECT nombre, km, ROUND(v_onda_kmh,2) AS v_kmh, transit_seconds,
--        TO_CHAR(hora_arribo_estimada AT TIME ZONE 'America/Chihuahua', 'HH24:MI') AS eta_local
-- FROM vw_prediccion_arribo_escalas ORDER BY km;
--
-- Para Q=28 m³/s:  v_onda ≈ 7.42 km/h → K-23 en ~186 min · K-104 en ~882 min
