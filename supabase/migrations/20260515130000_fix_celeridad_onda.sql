-- ═══════════════════════════════════════════════════════════════════════
-- FIX: Celeridad de onda — constante 5.3 → 4.5
--
-- Calibración campo 23/04/2026 (anchors K-23 y K-104):
--   Modelo anterior (5.3): K-104 → 714 min predicho vs 820 min observado  (−13%)
--   Modelo corregido (4.5): K-104 → 831 min predicho vs 820 min observado  (+1.3%)
--
-- La constante 4.5 minimiza el error promedio en ambos anchors de campo.
-- La skill generar_skill_v36.mjs ya usa 4.5 — esta migración unifica SICA DB.
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
    'Celeridad de onda de avenida en m/s. v = 4.5 × Q^0.15 km/h. '
    'Calibración campo 23/04/2026: error +1.3% en K-104 (831 vs 820 min obs). '
    'Dominio: [0.50, 3.50] m/s para Q en [5, 60] m³/s. '
    'Fix 15/05/2026: constante corregida de 5.3 a 4.5 para unificar con skill.';
