-- ═══════════════════════════════════════════════════════════════════════
-- RATIFICACIÓN CADENAMIENTOS — Calibración v3.6b (27/04/2026)
--
-- Los km de campo precisos para escalas aguas abajo ya existían en la DB
-- desde la calibración de abril. Esta migración los confirma explícitamente
-- y ajusta los límites de zonas_canal para que coincidan exacto con las
-- posiciones de escala (eliminando la dependencia de la tolerancia ±0.05).
--
-- Efecto en vistas:
--   vol_interescalas — recalcula automáticamente con nuevos km (dinámica)
--   vol_zonas        — captura los mismos tramos de Z4 con mayor exactitud
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Escalas — ratificar km de campo precisos ───────────────────────────────
-- Los tres puntos aguas abajo tienen mediciones con décimas de km:

UPDATE public.escalas SET km = 79.025 WHERE nombre = 'K-79+025' AND km != 79.025;
UPDATE public.escalas SET km = 87.549 WHERE nombre = 'K-87+549' AND km != 87.549;
UPDATE public.escalas SET km = 94.057 WHERE nombre = 'K-94+057' AND km != 94.057;
UPDATE public.escalas SET km = 94.200 WHERE nombre = 'K-94+200' AND km != 94.200;

-- Los puntos con km enteros ya son exactos (campo confirma redondeo):
-- K-0+000=0, K-23=23, K-29=29, K-34=34, K-44=44
-- K-54=54, K-62=62, K-64=64, K-68=68, K-104=104


-- ── 2. zonas_canal — alinear Z4 con el km preciso de K-79+025 ────────────────
-- Antes: km_inicio=79.000, se capturaba con tolerancia ±0.05
-- Ahora: km_inicio=79.025, captura exacta sin depender de tolerancia

UPDATE public.zonas_canal
SET    km_inicio = 79.025
WHERE  codigo = 'Z4'
  AND  km_inicio != 79.025;

-- Z4 km_fin=94.057 ya es correcto (K-94+057) → sin cambio
-- Z1 km 23–29, Z2 km 34–44, Z3 km 54–68 → coinciden exacto con escalas → sin cambio


-- ── 3. Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_z4_km_ini NUMERIC;
    v_esc_79    NUMERIC;
    v_esc_87    NUMERIC;
    v_esc_94    NUMERIC;
BEGIN
    SELECT km_inicio INTO v_z4_km_ini FROM public.zonas_canal WHERE codigo = 'Z4';
    SELECT km INTO v_esc_79  FROM public.escalas WHERE nombre = 'K-79+025';
    SELECT km INTO v_esc_87  FROM public.escalas WHERE nombre = 'K-87+549';
    SELECT km INTO v_esc_94  FROM public.escalas WHERE nombre = 'K-94+057';

    RAISE NOTICE '══ CADENAMIENTOS RATIFICADOS ══';
    RAISE NOTICE 'K-79+025 km  = %  (esperado 79.025)', v_esc_79;
    RAISE NOTICE 'K-87+549 km  = %  (esperado 87.549)', v_esc_87;
    RAISE NOTICE 'K-94+057 km  = %  (esperado 94.057)', v_esc_94;
    RAISE NOTICE 'Z4 km_inicio = %  (esperado 79.025)', v_z4_km_ini;

    IF v_z4_km_ini != 79.025 THEN
        RAISE EXCEPTION 'ERROR: Z4 km_inicio no es 79.025 — valor actual: %', v_z4_km_ini;
    END IF;
    IF v_esc_79 != 79.025 THEN
        RAISE EXCEPTION 'ERROR: K-79+025 km no es 79.025 — valor actual: %', v_esc_79;
    END IF;

    RAISE NOTICE '✓ Verificación OK';
END;
$$;


-- ── 4. Resumen de longitudes de tramo afectadas ───────────────────────────────
-- (informativo — ejecutar en consola Supabase para confirmar)
--
-- Tramo K-68→K-79+025  : 79.025 - 68.000 = 11.025 km  (tránsito, sin zona)
-- Tramo K-79+025→K-87+549: 87.549 - 79.025 = 8.524 km  ← capturado en Z4
-- Tramo K-87+549→K-94+057: 94.057 - 87.549 = 6.508 km  ← capturado en Z4
-- Total longitud Z4      : 8.524 + 6.508 = 15.032 km   (antes 15.057 con km 79.000)
--
-- Diferencia volumen diseño Z4:
--   A_diseño × (15032 m - 15057 m) ≈ A × -25 m → ajuste fino de ~0.2%
--
-- Para ver volúmenes actuales por zona:
-- SELECT codigo, zona_nombre, km_inicio, km_fin, n_tramos,
--        vol_actual_mm3, vol_diseno_m3, pct_llenado, nivel_medio_m
-- FROM vol_zonas ORDER BY km_inicio;
