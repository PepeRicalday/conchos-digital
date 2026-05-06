-- ═══════════════════════════════════════════════════════════════════════
-- FIX balance_volumen_modulo — zona_id NULL en entregas adicionales
--
-- Problema: entregas_modulo capturadas sin zona_id (zona_id IS NULL)
--   quedan en un "bucket" separado (modulo_id, NULL, ciclo_id) dentro de
--   consumo_por_zona, que nunca une con la fila de la vista porque:
--     LEFT JOIN consumo_por_zona c ON c.zona_id = mz.zona_id
--       → NULL = <uuid> es UNKNOWN → sin match → ADIC queda en 0
--
-- Causa raíz: EntregaForm no forzaba zona_id para módulos de zona única
--   cuando SRL capturaba sin seleccionar zona explícita.
--   (Fix en sica-capture: auto-asignar zona primaria si módulo es unizona)
--
-- Solución aquí:
--   1. Backfill: actualizar zona_id NULL a zona primaria del módulo.
--   2. Vista: COALESCE(em.zona_id, zona_primaria) en consumo_por_zona
--      para absorber cualquier registro futuro con zona_id NULL.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Backfill: asignar zona primaria a registros sin zona ──────────
UPDATE public.entregas_modulo em
SET zona_id = (
    SELECT mz.zona_id
    FROM public.modulo_zonas mz
    WHERE mz.modulo_id = em.modulo_id
      AND mz.es_primaria = TRUE
    LIMIT 1
)
WHERE em.zona_id IS NULL;


-- ── 2. Vista actualizada: COALESCE zona_id → zona primaria ───────────
CREATE OR REPLACE VIEW public.balance_volumen_modulo AS
WITH base_auth AS (
    SELECT modulo_id, ciclo_id, vol_autorizado * 1000.0 AS vol_base_m3
    FROM public.autorizaciones_ciclo
),
zona_primaria AS (
    SELECT modulo_id, zona_id AS zona_primaria_id
    FROM public.modulo_zonas
    WHERE es_primaria = TRUE
),
consumo_por_zona AS (
    SELECT
        em.modulo_id,
        -- Registros sin zona_id se atribuyen a la zona primaria del módulo
        COALESCE(em.zona_id, zp.zona_primaria_id)          AS zona_id,
        em.ciclo_id,
        SUM(em.volumen_m3) FILTER (WHERE em.tipo_entrega = 'base')      AS vol_base_consumido_m3,
        SUM(em.volumen_m3) FILTER (WHERE em.tipo_entrega = 'adicional') AS vol_adicional_consumido_m3,
        SUM(em.volumen_m3)                                               AS vol_total_consumido_m3,
        MAX(em.fecha)      FILTER (WHERE em.tipo_entrega = 'adicional') AS ultimo_adicional_fecha
    FROM public.entregas_modulo em
    LEFT JOIN zona_primaria zp ON zp.modulo_id = em.modulo_id
    GROUP BY
        em.modulo_id,
        COALESCE(em.zona_id, zp.zona_primaria_id),
        em.ciclo_id
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

    -- Semáforo (comparación en m³ vs m³)
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
-- Verificar que adicional de M3 y M5 ahora aparece:
--
-- SELECT modulo_id, zona_codigo, es_primaria,
--        ROUND(vol_base_consumido_m3/1e6,4)      AS usado_Mm3,
--        ROUND(vol_adicional_consumido_m3/1e6,4) AS adic_Mm3,
--        estado_volumen
-- FROM balance_volumen_modulo
-- ORDER BY modulo_id, es_primaria DESC;
