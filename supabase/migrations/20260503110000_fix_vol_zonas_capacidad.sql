-- ═══════════════════════════════════════════════════════════════════════
-- CORRECCIÓN: vol_zonas — referencia de capacidad real del canal
--
-- El 100% de llenado corresponde al canal lleno hasta el bordo libre:
--   y_capacidad = tirante_diseno_m + bordo_libre_m
--   A_capacidad = (plantilla + talud × y_capacidad) × y_capacidad
--
-- Antes: se usaba solo tirante_diseno_m como referencia (100%).
-- Ahora: tirante_diseno_m + bordo_libre_m es el 100% real.
--
-- Un canal operando exactamente al tirante de diseño mostrará:
--   pct_llenado ≈ tirante_d / (tirante_d + bordo) × 100 ≈ 75–80%
-- ═══════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.vol_zonas;
CREATE VIEW public.vol_zonas AS
WITH tramos_en_zona AS (
    SELECT
        z.id          AS zona_id,
        z.codigo,
        z.nombre      AS zona_nombre,
        z.km_inicio,
        z.km_fin,
        z.color,
        vi.esc_up_id,
        vi.esc_up,
        vi.km_up,
        vi.esc_down,
        vi.km_down,
        vi.longitud_km,
        vi.nivel_up_m,
        vi.nivel_down_m,
        vi.vol_m3
    FROM public.zonas_canal z
    JOIN public.vol_interescalas vi
      ON  vi.km_up   >= z.km_inicio - 0.05
      AND vi.km_down <= z.km_fin   + 0.05
    WHERE vi.vol_m3 IS NOT NULL
),
-- Ambas referencias al km central de la zona (un solo JOIN al perfil)
capacidad AS (
    SELECT
        z.id                                                            AS zona_id,
        phc.tirante_diseno_m,
        COALESCE(phc.bordo_libre_m, 0)                                 AS bordo_libre_m,
        phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0)         AS y_capacidad_m,
        -- Área al tirante de diseño (referencia hidráulica)
        (phc.plantilla_m + phc.talud_z * phc.tirante_diseno_m)
            * phc.tirante_diseno_m                                      AS area_diseno_m2,
        -- Área a capacidad total: tirante_diseno + bordo_libre (= 100%)
        (phc.plantilla_m
            + phc.talud_z * (phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0)))
            * (phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0)) AS area_capacidad_m2
    FROM public.zonas_canal z
    JOIN public.perfil_hidraulico_canal phc
      ON  phc.km_inicio <= (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_fin    >  (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_inicio <  phc.km_fin
)
SELECT
    tz.zona_id,
    tz.codigo,
    tz.zona_nombre,
    tz.km_inicio,
    tz.km_fin,
    tz.color,

    -- ── Volumetría real ──────────────────────────────────────────────
    COUNT(tz.esc_up_id)                                                AS n_tramos,

    SUM(tz.vol_m3)                                                     AS vol_actual_m3,
    ROUND(SUM(tz.vol_m3) / 1e6, 4)                                    AS vol_actual_mm3,

    -- Tirante medio ponderado por longitud de tramo
    ROUND(
        SUM((tz.nivel_up_m + tz.nivel_down_m) / 2.0 * tz.longitud_km)
        / NULLIF(SUM(tz.longitud_km), 0),
        3
    )                                                                  AS nivel_medio_m,

    -- ── Referencias de diseño (km central de la zona) ────────────────
    c.tirante_diseno_m,
    c.bordo_libre_m,
    c.y_capacidad_m,        -- tirante_diseno + bordo_libre

    -- Volumen al tirante de diseño (operación normal)
    ROUND(c.area_diseno_m2    * (tz.km_fin - tz.km_inicio) * 1000.0) AS vol_diseno_m3,

    -- Volumen a capacidad total (= 100% de llenado)
    ROUND(c.area_capacidad_m2 * (tz.km_fin - tz.km_inicio) * 1000.0) AS vol_capacidad_m3,

    -- % llenado respecto a capacidad total del canal
    ROUND(
        SUM(tz.vol_m3)
        / NULLIF(c.area_capacidad_m2 * (tz.km_fin - tz.km_inicio) * 1000.0, 0)
        * 100.0,
        1
    )                                                                  AS pct_llenado

FROM tramos_en_zona tz
JOIN capacidad c ON c.zona_id = tz.zona_id
GROUP BY
    tz.zona_id, tz.codigo, tz.zona_nombre, tz.km_inicio, tz.km_fin, tz.color,
    c.tirante_diseno_m, c.bordo_libre_m, c.y_capacidad_m,
    c.area_diseno_m2, c.area_capacidad_m2;


GRANT SELECT ON public.vol_zonas TO authenticated;


-- ── Test ─────────────────────────────────────────────────────────────
-- SELECT codigo, zona_nombre,
--        nivel_medio_m,
--        tirante_diseno_m, bordo_libre_m, y_capacidad_m,
--        ROUND(vol_actual_mm3,4)        AS vol_actual_mm3,
--        ROUND(vol_diseno_m3/1e6,4)     AS vol_diseno_mm3,
--        ROUND(vol_capacidad_m3/1e6,4)  AS vol_capacidad_mm3,
--        pct_llenado
-- FROM vol_zonas
-- ORDER BY km_inicio;
