-- ============================================================
-- Módulo-Zonas: relación muchos a muchos
-- Permite que un módulo pertenezca a más de una zona (ej. MOD-002 en Z2 y Z3)
-- ============================================================

-- ── 1. TABLA DE UNIÓN ────────────────────────────────────────
-- NOTA: modulo_id es TEXT porque modulos.id es TEXT ('MOD-001', etc.)
CREATE TABLE IF NOT EXISTS public.modulo_zonas (
    modulo_id   TEXT NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
    zona_id     UUID NOT NULL REFERENCES public.zonas_canal(id) ON DELETE CASCADE,
    es_primaria BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (modulo_id, zona_id)
);

CREATE INDEX IF NOT EXISTS idx_modulo_zonas_modulo ON public.modulo_zonas(modulo_id);
CREATE INDEX IF NOT EXISTS idx_modulo_zonas_zona   ON public.modulo_zonas(zona_id);

ALTER TABLE public.modulo_zonas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modulo_zonas_select"  ON public.modulo_zonas FOR SELECT USING (TRUE);
CREATE POLICY "modulo_zonas_srl_all" ON public.modulo_zonas FOR ALL
    USING ((SELECT rol FROM public.perfiles WHERE id = auth.uid()) = 'SRL');


-- ── 2. SEED: ASIGNACIÓN DE ZONAS POR MÓDULO ──────────────────
-- M1  → Z1 (único)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-001', z.id, TRUE FROM public.zonas_canal z WHERE z.codigo = 'Z1'
ON CONFLICT DO NOTHING;

-- M12 → Z2 (único)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-012', z.id, TRUE FROM public.zonas_canal z WHERE z.codigo = 'Z2'
ON CONFLICT DO NOTHING;

-- M2  → Z2 (primaria) + Z3 (secundaria)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-002', z.id, TRUE  FROM public.zonas_canal z WHERE z.codigo = 'Z2'
ON CONFLICT DO NOTHING;
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-002', z.id, FALSE FROM public.zonas_canal z WHERE z.codigo = 'Z3'
ON CONFLICT DO NOTHING;

-- M3  → Z3 (único)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-003', z.id, TRUE FROM public.zonas_canal z WHERE z.codigo = 'Z3'
ON CONFLICT DO NOTHING;

-- M4  → Z3 (único)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-004', z.id, TRUE FROM public.zonas_canal z WHERE z.codigo = 'Z3'
ON CONFLICT DO NOTHING;

-- M5  → Z4 (único)
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-005', z.id, TRUE FROM public.zonas_canal z WHERE z.codigo = 'Z4'
ON CONFLICT DO NOTHING;


-- ── 3. SINCRONIZAR modulos.zona_id CON ZONA PRIMARIA ─────────
UPDATE public.modulos m
SET zona_id = mz.zona_id
FROM public.modulo_zonas mz
WHERE mz.modulo_id = m.id AND mz.es_primaria = TRUE;


-- ── 4. VISTA BALANCE_VOLUMEN_MODULO — con soporte multizona ──
-- Una fila por (módulo, zona). MOD-002 aparece en Z2 y en Z3.
-- vol_base_m3 solo visible en zona PRIMARIA para no duplicar autorización.
CREATE OR REPLACE VIEW public.balance_volumen_modulo AS
WITH base_auth AS (
    SELECT modulo_id, ciclo_id, vol_autorizado AS vol_base_m3
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
    GROUP BY modulo_id, zona_id, ciclo_id  -- ciclo_id es TEXT en ambas tablas
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

    -- Autorización base: solo en zona primaria
    CASE WHEN mz.es_primaria THEN ba.vol_base_m3 ELSE NULL END      AS vol_base_m3,

    -- Consumo desglosado por zona
    COALESCE(c.vol_base_consumido_m3,      0)                      AS vol_base_consumido_m3,
    COALESCE(c.vol_adicional_consumido_m3, 0)                      AS vol_adicional_consumido_m3,
    COALESCE(c.vol_total_consumido_m3,     0)                      AS vol_total_consumido_m3,

    -- Disponible base (solo zona primaria)
    CASE WHEN mz.es_primaria
        THEN ba.vol_base_m3 - COALESCE(c.vol_base_consumido_m3, 0)
        ELSE NULL
    END                                                             AS vol_base_disponible_m3,

    -- Porcentaje (solo zona primaria)
    CASE WHEN mz.es_primaria
        THEN ROUND(
            COALESCE(c.vol_base_consumido_m3, 0) /
            NULLIF(ba.vol_base_m3, 0) * 100, 1)
        ELSE NULL
    END                                                             AS pct_base_consumido,

    c.ultimo_adicional_fecha,

    -- Semáforo
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


-- ── 5. PERMISOS ───────────────────────────────────────────────
GRANT SELECT ON public.modulo_zonas          TO authenticated, anon;
GRANT SELECT ON public.balance_volumen_modulo TO authenticated;
