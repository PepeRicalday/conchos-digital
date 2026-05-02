-- ============================================================
-- Control Operativo por Zona y Módulo — Canal Principal Conchos
-- Volumen Base + Adicional por Consumo Capturado
-- ============================================================

-- ── 1. ZONAS DEL CANAL ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zonas_canal (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canal_id            UUID REFERENCES public.canales(id) ON DELETE SET NULL,
    nombre              TEXT NOT NULL,
    codigo              TEXT NOT NULL UNIQUE,   -- 'Z1'..'Z4'
    km_inicio           NUMERIC(8,3) NOT NULL,
    km_fin              NUMERIC(8,3) NOT NULL,
    escala_entrada_id   UUID REFERENCES public.escalas(id) ON DELETE SET NULL,
    escala_salida_id    UUID REFERENCES public.escalas(id) ON DELETE SET NULL,
    color               TEXT DEFAULT '#3b82f6',
    activa              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsqueda por código
CREATE INDEX IF NOT EXISTS idx_zonas_canal_codigo ON public.zonas_canal(codigo);

-- RLS
ALTER TABLE public.zonas_canal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zonas_canal_select" ON public.zonas_canal FOR SELECT USING (TRUE);
CREATE POLICY "zonas_canal_srl_all"  ON public.zonas_canal FOR ALL
    USING ((SELECT rol FROM public.perfiles WHERE id = auth.uid()) = 'SRL');

-- Seed: 4 zonas del Canal Principal Conchos
-- Las escalas de referencia se vinculan por nombre (UPDATE post-INSERT)
INSERT INTO public.zonas_canal (nombre, codigo, km_inicio, km_fin, color)
VALUES
    ('Zona 1 — K-23 a K-29',      'Z1', 23.000, 29.000, '#3b82f6'),
    ('Zona 2 — K-34 a K-44',      'Z2', 34.000, 44.000, '#10b981'),
    ('Zona 3 — K-54 a K-68',      'Z3', 54.000, 68.000, '#f59e0b'),
    ('Zona 4 — K-79 a K-94+057',  'Z4', 79.000, 94.057, '#ef4444')
ON CONFLICT (codigo) DO NOTHING;

-- Vincular escalas por km (tolerancia ±0.5 km)
UPDATE public.zonas_canal z
SET escala_entrada_id = e.id
FROM public.escalas e
WHERE ABS(e.km - z.km_inicio) <= 0.5;

UPDATE public.zonas_canal z
SET escala_salida_id = e.id
FROM public.escalas e
WHERE ABS(e.km - z.km_fin) <= 0.5
  AND e.id <> COALESCE(z.escala_entrada_id, gen_random_uuid());


-- ── 2. COLUMNA zona_id EN MÓDULOS ───────────────────────────
ALTER TABLE public.modulos
    ADD COLUMN IF NOT EXISTS zona_id UUID REFERENCES public.zonas_canal(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_modulos_zona ON public.modulos(zona_id);


-- ── 3. ENTREGAS POR MÓDULO (captura diaria campo) ───────────
CREATE TABLE IF NOT EXISTS public.entregas_modulo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha               DATE NOT NULL,
    modulo_id           UUID NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
    zona_id             UUID REFERENCES public.zonas_canal(id) ON DELETE SET NULL,
    ciclo_id            UUID REFERENCES public.ciclos_agricolas(id) ON DELETE SET NULL,

    -- Operación
    hora_inicio         TIME,
    hora_fin            TIME,
    -- horas_operacion se calcula en app (evita generated column con restricciones en cloud)

    -- Gasto y volumen
    gasto_lps           NUMERIC(10,2) NOT NULL CHECK (gasto_lps >= 0),
    gasto_m3s           NUMERIC(10,4) GENERATED ALWAYS AS (gasto_lps / 1000.0) STORED,
    volumen_m3          NUMERIC(14,2) NOT NULL CHECK (volumen_m3 >= 0),

    -- Tipo: base (dotación) o adicional (consumo extra autorizado por perfil)
    tipo_entrega        TEXT NOT NULL DEFAULT 'base'
                            CHECK (tipo_entrega IN ('base', 'adicional')),
    motivo_adicional    TEXT,   -- requerido cuando tipo_entrega = 'adicional'

    -- Auditoría
    capturador_id       UUID REFERENCES public.perfiles(id) ON DELETE SET NULL,
    notas               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    -- Un registro base Y uno adicional por módulo por día
    CONSTRAINT entregas_modulo_fecha_tipo_uq UNIQUE (fecha, modulo_id, tipo_entrega),

    -- El motivo es obligatorio para adicionales
    CONSTRAINT adicional_requiere_motivo
        CHECK (tipo_entrega = 'base' OR motivo_adicional IS NOT NULL)
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_entregas_modulo_fecha     ON public.entregas_modulo(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_entregas_modulo_modulo    ON public.entregas_modulo(modulo_id);
CREATE INDEX IF NOT EXISTS idx_entregas_modulo_ciclo     ON public.entregas_modulo(ciclo_id);
CREATE INDEX IF NOT EXISTS idx_entregas_modulo_zona      ON public.entregas_modulo(zona_id);
CREATE INDEX IF NOT EXISTS idx_entregas_modulo_tipo      ON public.entregas_modulo(tipo_entrega);

-- Trigger: updated_at automático
CREATE OR REPLACE FUNCTION update_entregas_modulo_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_entregas_modulo_updated
    BEFORE UPDATE ON public.entregas_modulo
    FOR EACH ROW EXECUTE FUNCTION update_entregas_modulo_ts();

-- RLS
ALTER TABLE public.entregas_modulo ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier autenticado ve sus datos de módulo; SRL ve todos
CREATE POLICY "entregas_select_own" ON public.entregas_modulo
    FOR SELECT USING (
        capturador_id = auth.uid()
        OR modulo_id = (SELECT modulo_id FROM public.perfiles WHERE id = auth.uid())
        OR (SELECT rol FROM public.perfiles WHERE id = auth.uid()) IN ('SRL', 'AUDITORIA')
    );

-- INSERT/UPDATE: ACU solo su módulo; SRL cualquier módulo
CREATE POLICY "entregas_insert_actu" ON public.entregas_modulo
    FOR INSERT WITH CHECK (
        modulo_id = (SELECT modulo_id FROM public.perfiles WHERE id = auth.uid())
        OR (SELECT rol FROM public.perfiles WHERE id = auth.uid()) = 'SRL'
    );

CREATE POLICY "entregas_update_actu" ON public.entregas_modulo
    FOR UPDATE USING (
        modulo_id = (SELECT modulo_id FROM public.perfiles WHERE id = auth.uid())
        OR (SELECT rol FROM public.perfiles WHERE id = auth.uid()) = 'SRL'
    );

CREATE POLICY "entregas_delete_srl" ON public.entregas_modulo
    FOR DELETE USING (
        (SELECT rol FROM public.perfiles WHERE id = auth.uid()) = 'SRL'
    );


-- ── 4. VISTA: BALANCE DE VOLUMEN POR MÓDULO ─────────────────
CREATE OR REPLACE VIEW public.balance_volumen_modulo AS
WITH base_auth AS (
    SELECT modulo_id, ciclo_id, vol_autorizado AS vol_base_m3
    FROM public.autorizaciones_ciclo
),
consumo AS (
    SELECT
        modulo_id,
        ciclo_id,
        SUM(volumen_m3) FILTER (WHERE tipo_entrega = 'base')      AS vol_base_consumido_m3,
        SUM(volumen_m3) FILTER (WHERE tipo_entrega = 'adicional') AS vol_adicional_consumido_m3,
        SUM(volumen_m3)                                            AS vol_total_consumido_m3,
        MAX(fecha) FILTER (WHERE tipo_entrega = 'adicional')       AS ultimo_adicional_fecha,
        MIN(capturador_id) FILTER (WHERE tipo_entrega = 'adicional'
            AND fecha = (SELECT MAX(fecha) FROM public.entregas_modulo e2
                        WHERE e2.modulo_id = entregas_modulo.modulo_id
                          AND e2.tipo_entrega = 'adicional'))       AS ultimo_adicional_capturador
    FROM public.entregas_modulo
    GROUP BY modulo_id, ciclo_id
),
ciclo_activo AS (
    SELECT id FROM public.ciclos_agricolas WHERE activo = TRUE LIMIT 1
)
SELECT
    m.id                                                        AS modulo_id,
    m.nombre                                                    AS modulo_nombre,
    m.codigo_corto,
    m.zona_id,
    zc.codigo                                                   AS zona_codigo,
    zc.nombre                                                   AS zona_nombre,
    ba.ciclo_id,

    -- Autorizaciones
    ba.vol_base_m3,

    -- Consumo desglosado
    COALESCE(c.vol_base_consumido_m3,      0)                  AS vol_base_consumido_m3,
    COALESCE(c.vol_adicional_consumido_m3, 0)                  AS vol_adicional_consumido_m3,
    COALESCE(c.vol_total_consumido_m3,     0)                  AS vol_total_consumido_m3,

    -- Disponible base
    ba.vol_base_m3 - COALESCE(c.vol_base_consumido_m3, 0)      AS vol_base_disponible_m3,

    -- Porcentaje
    ROUND(
        COALESCE(c.vol_base_consumido_m3, 0) /
        NULLIF(ba.vol_base_m3, 0) * 100, 1
    )                                                           AS pct_base_consumido,

    -- Último adicional
    c.ultimo_adicional_fecha,

    -- Estado semáforo
    CASE
        WHEN COALESCE(c.vol_base_consumido_m3, 0) >= ba.vol_base_m3
            THEN 'base_agotado'
        WHEN COALESCE(c.vol_base_consumido_m3, 0) >= ba.vol_base_m3 * 0.85
            THEN 'alerta_base'
        ELSE 'normal'
    END                                                         AS estado_volumen

FROM base_auth ba
JOIN public.modulos m       ON ba.modulo_id = m.id
LEFT JOIN public.zonas_canal zc ON m.zona_id = zc.id
LEFT JOIN consumo c         ON c.modulo_id = ba.modulo_id AND c.ciclo_id = ba.ciclo_id
WHERE ba.ciclo_id = (SELECT id FROM ciclo_activo);


-- ── 5. VISTA: VOLÚMENES DIARIOS POR ZONA ────────────────────
CREATE OR REPLACE VIEW public.volumenes_zona_diarios AS
SELECT
    em.fecha,
    zc.id                                           AS zona_id,
    zc.codigo,
    zc.nombre                                       AS zona_nombre,
    COUNT(DISTINCT em.modulo_id)                    AS modulos_activos,
    SUM(em.gasto_m3s)                               AS gasto_total_m3s,
    SUM(em.volumen_m3)                              AS volumen_total_m3,
    SUM(em.volumen_m3) FILTER
        (WHERE em.tipo_entrega = 'base')            AS vol_base_m3,
    SUM(em.volumen_m3) FILTER
        (WHERE em.tipo_entrega = 'adicional')       AS vol_adicional_m3
FROM public.entregas_modulo em
JOIN public.zonas_canal zc ON em.zona_id = zc.id
GROUP BY em.fecha, zc.id, zc.codigo, zc.nombre;


-- ── 6. VISTA: VOLUMEN DIARIO TOTAL DEL CANAL ────────────────
CREATE OR REPLACE VIEW public.volumenes_canal_diarios AS
SELECT
    fecha,
    SUM(volumen_total_m3)   AS vol_total_m3,
    SUM(vol_base_m3)        AS vol_base_m3,
    SUM(vol_adicional_m3)   AS vol_adicional_m3,
    SUM(gasto_total_m3s)    AS gasto_total_m3s
FROM public.volumenes_zona_diarios
GROUP BY fecha;


-- ── 7. PERMISOS DE VISTAS ────────────────────────────────────
GRANT SELECT ON public.balance_volumen_modulo    TO authenticated;
GRANT SELECT ON public.volumenes_zona_diarios    TO authenticated;
GRANT SELECT ON public.volumenes_canal_diarios   TO authenticated;
GRANT SELECT ON public.zonas_canal               TO authenticated, anon;
