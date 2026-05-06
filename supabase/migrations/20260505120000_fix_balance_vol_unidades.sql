-- ═══════════════════════════════════════════════════════════════════════
-- FIX balance_volumen_modulo — CONVERSIÓN DE UNIDADES
--
-- Problema: autorizaciones_ciclo.vol_autorizado está almacenado en
--   MILES DE m³ (p.ej. 34,008.57 = 34,008,570 m³ = 34.009 Mm³)
-- pero la vista lo comparaba directamente contra vol_base_consumido_m3
--   que está en M³, dando siempre "base_agotado":
--   159,707 m³  >= 34,008.57  → TRUE  (incorrecto)
--   159,707 m³  >= 34,008,570 → FALSE (correcto — 0.47%)
--
-- Solución: en base_auth, convertir vol_autorizado × 1000 → m³.
-- La UI usa fmtM3() que formatea automáticamente a Mm³ cuando ≥ 1,000,000.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.balance_volumen_modulo AS
WITH base_auth AS (
    SELECT
        modulo_id,
        ciclo_id,
        -- vol_autorizado está en miles de m³ → convertir a m³
        vol_autorizado * 1000.0 AS vol_base_m3
    FROM public.autorizaciones_ciclo
),
consumo_por_zona AS (
    SELECT
        modulo_id,
        zona_id,
        ciclo_id,
        SUM(volumen_m3) FILTER (WHERE tipo_entrega = 'base')      AS vol_base_consumido_m3,
        SUM(volumen_m3) FILTER (WHERE tipo_entrega = 'adicional') AS vol_adicional_consumido_m3,
        SUM(volumen_m3)                                            AS vol_total_consumido_m3,
        MAX(fecha)      FILTER (WHERE tipo_entrega = 'adicional') AS ultimo_adicional_fecha
    FROM public.entregas_modulo
    GROUP BY modulo_id, zona_id, ciclo_id
),
ciclo_activo AS (
    SELECT id FROM public.ciclos_agricolas WHERE activo = TRUE LIMIT 1
)
SELECT
    m.id                                                            AS modulo_id,
    m.nombre                                                        AS modulo_nombre,
    m.codigo_corto,
    mz.zona_id,
    mz.es_primaria,
    zc.codigo                                                       AS zona_codigo,
    zc.nombre                                                       AS zona_nombre,
    ba.ciclo_id,

    -- Autorización base en m³ (solo zona primaria)
    CASE WHEN mz.es_primaria THEN ba.vol_base_m3 ELSE NULL END      AS vol_base_m3,

    -- Consumo desglosado por zona (en m³)
    COALESCE(c.vol_base_consumido_m3,      0)                      AS vol_base_consumido_m3,
    COALESCE(c.vol_adicional_consumido_m3, 0)                      AS vol_adicional_consumido_m3,
    COALESCE(c.vol_total_consumido_m3,     0)                      AS vol_total_consumido_m3,

    -- Disponible base en m³ (solo zona primaria)
    CASE WHEN mz.es_primaria
        THEN ba.vol_base_m3 - COALESCE(c.vol_base_consumido_m3, 0)
        ELSE NULL
    END                                                             AS vol_base_disponible_m3,

    -- Porcentaje consumido (solo zona primaria)
    CASE WHEN mz.es_primaria
        THEN ROUND(
            COALESCE(c.vol_base_consumido_m3, 0) /
            NULLIF(ba.vol_base_m3, 0) * 100, 2)
        ELSE NULL
    END                                                             AS pct_base_consumido,

    c.ultimo_adicional_fecha,

    -- Semáforo (comparación ahora en unidades consistentes: m³ vs m³)
    CASE
        WHEN NOT mz.es_primaria THEN
            CASE WHEN COALESCE(c.vol_adicional_consumido_m3, 0) > 0
                THEN 'adicional_activo' ELSE 'normal' END
        WHEN COALESCE(c.vol_base_consumido_m3, 0) >= ba.vol_base_m3
            THEN 'base_agotado'
        WHEN COALESCE(c.vol_base_consumido_m3, 0) >= ba.vol_base_m3 * 0.85
            THEN 'alerta_base'
        ELSE 'normal'
    END                                                             AS estado_volumen

FROM base_auth ba
JOIN public.modulos m          ON ba.modulo_id = m.id
JOIN public.modulo_zonas mz    ON mz.modulo_id = m.id
JOIN public.zonas_canal zc     ON mz.zona_id   = zc.id
LEFT JOIN consumo_por_zona c
    ON  c.modulo_id = ba.modulo_id
    AND c.zona_id   = mz.zona_id
    AND c.ciclo_id  = ba.ciclo_id
WHERE ba.ciclo_id = (SELECT id FROM ciclo_activo);


GRANT SELECT ON public.balance_volumen_modulo TO authenticated;


-- ── Validación ────────────────────────────────────────────────────────
-- Verificar que MOD-001 ya no aparece como base_agotado:
--
-- SELECT modulo_id, modulo_nombre, zona_codigo, es_primaria,
--        ROUND(vol_base_m3/1e6,3)          AS dotacion_Mm3,
--        ROUND(vol_base_consumido_m3/1e6,4) AS consumido_Mm3,
--        pct_base_consumido,
--        estado_volumen
-- FROM balance_volumen_modulo
-- ORDER BY modulo_id, es_primaria DESC;
--
-- Resultado esperado MOD-001:
--   dotacion_Mm3 = 34.009   consumido_Mm3 = 0.160   pct = 0.47%   normal
