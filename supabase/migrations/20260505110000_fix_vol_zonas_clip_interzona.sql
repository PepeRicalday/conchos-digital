-- ═══════════════════════════════════════════════════════════════════════
-- FIX vol_zonas — CLIP PROPORCIONAL EN LÍMITES INTER-ZONA
--
-- Problema: zonas_canal tiene cadenamientos (48.420, 67.320, 71.912 km)
-- que NO coinciden con ninguna escala. La vista anterior requería que
-- AMBOS extremos del tramo estuvieran dentro de la zona (con ±0.05 km),
-- por lo que descartaba tramos que cruzaban el límite de zona:
--
--   K-44→K-54 cruza Z1/Z2 en km 48.420  →  antes: descartado
--   K-64→K-68 cruza Z2/Z3 en km 67.320  →  antes: descartado
--   K-68→K-79 cruza Z3/gap en km 71.912 →  antes: descartado
--
-- Solución: intersectar cada tramo con cada zona usando GREATEST/LEAST,
-- interpolar el tirante en los puntos de clip e invocar fn_vol_interescala
-- con los km clipeados. Esto asigna el volumen proporcional exacto de
-- cada tramo a la zona correcta sin perder ningún segmento del canal.
-- ═══════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.vol_zonas;

CREATE VIEW public.vol_zonas AS
WITH

-- ── 1. Todos los tramos con volumen disponible ────────────────────────
tramos AS (
    SELECT
        vi.esc_up_id,
        vi.esc_up,
        vi.km_up,
        vi.esc_down_id,
        vi.esc_down,
        vi.km_down,
        vi.longitud_km,
        vi.nivel_up_m,
        vi.nivel_down_m
    FROM public.vol_interescalas vi
    WHERE vi.nivel_up_m IS NOT NULL
      AND vi.nivel_down_m IS NOT NULL
      AND vi.km_down > vi.km_up
),

-- ── 2. Intersección tramo × zona ─────────────────────────────────────
-- Incluye tramos que solapan PARCIALMENTE con la zona (clip de km).
-- Reemplaza el antiguo JOIN con tolerancia ±0.05 que excluía tramos
-- cuyos extremos cruzaban el límite de la zona.
tramos_zona AS (
    SELECT
        z.id          AS zona_id,
        z.codigo,
        z.nombre      AS zona_nombre,
        z.km_inicio,
        z.km_fin,
        z.color,
        t.esc_up_id,
        t.esc_up,
        t.esc_down,
        t.km_up,
        t.km_down,
        t.longitud_km,
        t.nivel_up_m,
        t.nivel_down_m,
        -- Clip del tramo a los límites de la zona
        GREATEST(t.km_up,   z.km_inicio) AS clip_km_up,
        LEAST   (t.km_down, z.km_fin   ) AS clip_km_down
    FROM public.zonas_canal z
    JOIN tramos t
      ON  t.km_up   < z.km_fin          -- tramo empieza antes del fin de zona
      AND t.km_down > z.km_inicio       -- tramo termina después del inicio de zona
),

-- ── 3. Niveles interpolados en los puntos de clip ─────────────────────
-- El tirante se interpola linealmente entre los dos extremos del tramo.
-- Luego fn_vol_interescala integra con la geometría real del perfil.
tramos_clip AS (
    SELECT
        tz.*,
        tz.clip_km_down - tz.clip_km_up  AS clip_longitud_km,
        -- Tirante en clip_km_up
        GREATEST(
            tz.nivel_up_m
            + (tz.nivel_down_m - tz.nivel_up_m)
              * (tz.clip_km_up - tz.km_up)
              / NULLIF(tz.longitud_km, 0),
            0.0
        )                                AS nivel_clip_up_m,
        -- Tirante en clip_km_down
        GREATEST(
            tz.nivel_up_m
            + (tz.nivel_down_m - tz.nivel_up_m)
              * (tz.clip_km_down - tz.km_up)
              / NULLIF(tz.longitud_km, 0),
            0.0
        )                                AS nivel_clip_down_m
    FROM tramos_zona tz
    WHERE tz.clip_km_down > tz.clip_km_up   -- longitud clipeada positiva
),

-- ── 4. Volumen en el segmento clipeado ───────────────────────────────
-- fn_vol_interescala usa la geometría real del perfil hidráulico
-- recortada a [clip_km_up, clip_km_down].
vol_clips AS (
    SELECT
        tc.zona_id,
        tc.codigo,
        tc.zona_nombre,
        tc.km_inicio,
        tc.km_fin,
        tc.color,
        tc.esc_up_id,
        tc.esc_up,
        tc.esc_down,
        tc.clip_km_up,
        tc.clip_km_down,
        tc.clip_longitud_km,
        tc.nivel_clip_up_m,
        tc.nivel_clip_down_m,
        public.fn_vol_interescala(
            tc.clip_km_up,
            tc.clip_km_down,
            tc.nivel_clip_up_m,
            tc.nivel_clip_down_m
        ) AS vol_clip_m3
    FROM tramos_clip tc
),

-- ── 5. Perfil de diseño en km central de cada zona ───────────────────
-- DISTINCT ON para evitar duplicados si el centroide cae en un límite
-- de segmento. Se elige el segmento con mayor km_inicio (más aguas abajo).
capacidad AS (
    SELECT DISTINCT ON (z.id)
        z.id                                                                      AS zona_id,
        phc.tirante_diseno_m,
        COALESCE(phc.bordo_libre_m, 0.0)                                          AS bordo_libre_m,
        phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0.0)                  AS y_capacidad_m,
        (phc.plantilla_m + phc.talud_z * phc.tirante_diseno_m)
            * phc.tirante_diseno_m                                                 AS area_diseno_m2,
        (phc.plantilla_m
            + phc.talud_z * (phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0.0)))
            * (phc.tirante_diseno_m + COALESCE(phc.bordo_libre_m, 0.0))           AS area_capacidad_m2
    FROM public.zonas_canal z
    JOIN public.perfil_hidraulico_canal phc
      ON  phc.km_inicio <  (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_fin    >  (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_inicio <  phc.km_fin
    ORDER BY z.id, phc.km_inicio DESC
)

SELECT
    vc.zona_id,
    vc.codigo,
    vc.zona_nombre,
    vc.km_inicio,
    vc.km_fin,
    vc.color,

    -- ── Volumetría real ──────────────────────────────────────────────
    COUNT(vc.esc_up_id)                                                            AS n_tramos,
    SUM(vc.vol_clip_m3)                                                            AS vol_actual_m3,
    ROUND(SUM(vc.vol_clip_m3) / 1e6, 4)                                           AS vol_actual_mm3,

    -- Tirante medio ponderado por la longitud clipeada de cada segmento
    ROUND(
        SUM((vc.nivel_clip_up_m + vc.nivel_clip_down_m) / 2.0 * vc.clip_longitud_km)
        / NULLIF(SUM(vc.clip_longitud_km), 0),
        3
    )                                                                              AS nivel_medio_m,

    -- ── Referencias de diseño (perfil en km central de la zona) ──────
    c.tirante_diseno_m,
    c.bordo_libre_m,
    c.y_capacidad_m,
    ROUND(c.area_diseno_m2    * (vc.km_fin - vc.km_inicio) * 1000.0)              AS vol_diseno_m3,
    ROUND(c.area_capacidad_m2 * (vc.km_fin - vc.km_inicio) * 1000.0)              AS vol_capacidad_m3,
    ROUND(
        SUM(vc.vol_clip_m3)
        / NULLIF(c.area_capacidad_m2 * (vc.km_fin - vc.km_inicio) * 1000.0, 0)
        * 100.0, 1
    )                                                                              AS pct_llenado

FROM vol_clips vc
JOIN capacidad c ON c.zona_id = vc.zona_id
WHERE vc.vol_clip_m3 IS NOT NULL
GROUP BY
    vc.zona_id, vc.codigo, vc.zona_nombre, vc.km_inicio, vc.km_fin, vc.color,
    c.tirante_diseno_m, c.bordo_libre_m, c.y_capacidad_m,
    c.area_diseno_m2, c.area_capacidad_m2;


GRANT SELECT ON public.vol_zonas TO authenticated;


-- ── Test de validación ────────────────────────────────────────────────
-- Debe mostrar n_tramos > 0 para TODAS las zonas (Z1–Z4).
-- Antes de este fix: Z2, Z3 podían retornar 0 tramos si los límites de
-- zona no coincidían con escalas.
--
-- SELECT codigo, zona_nombre,
--        km_inicio, km_fin,
--        n_tramos,
--        nivel_medio_m,
--        ROUND(vol_actual_mm3,4)           AS vol_actual_mm3,
--        ROUND(vol_diseno_m3 /1e6,4)      AS vol_diseno_mm3,
--        ROUND(vol_capacidad_m3/1e6,4)    AS vol_cap_mm3,
--        pct_llenado
-- FROM vol_zonas ORDER BY km_inicio;
