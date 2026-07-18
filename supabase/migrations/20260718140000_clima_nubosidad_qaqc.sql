-- ═══════════════════════════════════════════════════════════════════════════
-- NUBOSIDAD, PRONÓSTICO Y BANDERAS DE CALIDAD — SICA-005
-- Fecha: 2026-07-18
--
-- Implementa las etapas 1-3 del documento técnico "Implementación del módulo de
-- inteligencia agroclimática": la condición del cielo y la probabilidad de lluvia
-- dejan de ser la misma variable. Antes el informe declaraba "☀️ estable /
-- despejado" a partir de la tendencia barométrica, sin ninguna medición de
-- nubosidad; eso es precisamente lo que el documento prohíbe.
--
-- Tres bloques:
--   1. Columnas derivadas + QA/QC en clima_estacion_lecturas (observación).
--   2. Tabla clima_pronostico_horario (modelo, versionado por corrida).
--   3. Vista de diagnóstico que expone procedencia y edad del dato.
--
-- Regla transversal (§3.1 del documento): sufijos explícitos de procedencia.
--   _obs   = medido por la estación
--   _est   = estimado localmente (p. ej. nubosidad por radiación)
--   _fc    = pronosticado por modelo
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Observación: estimación local de nubosidad + banderas de calidad ─────
ALTER TABLE public.clima_estacion_lecturas
  -- Índice de claridad kt = radiación medida / radiación de cielo despejado.
  -- NULL de noche o con elevación solar < 10°: no es calculable, y un 0 ahí se
  -- leería como "cielo cubierto" cuando en realidad no hay información.
  ADD COLUMN IF NOT EXISTS clearness_index      NUMERIC,
  ADD COLUMN IF NOT EXISTS nubosidad_est_pct    NUMERIC,   -- 0-100, estimada por radiación
  ADD COLUMN IF NOT EXISTS elev_solar_deg       NUMERIC,   -- elevación solar en el instante de la lectura
  -- Estado del cielo derivado SOLO de evidencia local. Cuando no hay evidencia
  -- suficiente vale 'nubosidad_no_determinable' — nunca 'despejado' por defecto.
  ADD COLUMN IF NOT EXISTS sky_state_local      TEXT,
  -- QA/QC (§4): banderas acumulables y veredicto de frescura.
  ADD COLUMN IF NOT EXISTS qa_flags             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qa_status            TEXT,      -- 'valid' | 'stale' | 'expired' | 'suspect'
  ADD COLUMN IF NOT EXISTS edad_min             NUMERIC;   -- minutos entre observación y recepción

COMMENT ON COLUMN public.clima_estacion_lecturas.clearness_index IS
  'kt = rad_solar_wm2 / radiación de cielo despejado. NULL cuando la elevación solar < 10° (no calculable).';
COMMENT ON COLUMN public.clima_estacion_lecturas.nubosidad_est_pct IS
  'Nubosidad ESTIMADA por radiación (100·(1-kt)). Responde también a polvo, humo y suciedad del sensor: no es medición directa.';
COMMENT ON COLUMN public.clima_estacion_lecturas.sky_state_local IS
  'Estado del cielo por evidencia local. ''nubosidad_no_determinable'' cuando no hay radiación utilizable.';
COMMENT ON COLUMN public.clima_estacion_lecturas.qa_flags IS
  'Banderas QA/QC: stale, out_of_range, sensor_stuck, spike, inconsistent, missing.';

-- Frescura (§4): ≤20 min válido · 21-60 min retrasado · >60 min vencido.
ALTER TABLE public.clima_estacion_lecturas
  DROP CONSTRAINT IF EXISTS chk_qa_status;
ALTER TABLE public.clima_estacion_lecturas
  ADD CONSTRAINT chk_qa_status
  CHECK (qa_status IS NULL OR qa_status IN ('valid', 'stale', 'expired', 'suspect'));

ALTER TABLE public.clima_estacion_lecturas
  DROP CONSTRAINT IF EXISTS chk_sky_state_local;
ALTER TABLE public.clima_estacion_lecturas
  ADD CONSTRAINT chk_sky_state_local
  CHECK (sky_state_local IS NULL OR sky_state_local IN (
    'despejado', 'mayormente_despejado', 'parcialmente_nublado',
    'mayormente_nublado', 'cubierto', 'nubosidad_no_determinable'));

-- ── 2. Pronóstico horario por estación (adaptador de modelo) ────────────────
-- Versionado por corrida (§3.1): una misma hora puede reescribirse cuando el
-- modelo publica una corrida nueva; conservamos proveedor y hora de corrida para
-- poder reproducir cualquier informe emitido.
CREATE TABLE IF NOT EXISTS public.clima_pronostico_horario (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id        UUID NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
    -- Procedencia del dato externo
    proveedor          TEXT NOT NULL,               -- 'open-meteo' | ...
    modelo             TEXT,                        -- p. ej. 'best_match', 'gfs_seamless'
    corrida_en         TIMESTAMPTZ,                 -- hora de la corrida del modelo
    obtenido_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Horizonte
    valido_en          TIMESTAMPTZ NOT NULL,        -- instante pronosticado (UTC)
    fecha_local        DATE NOT NULL,               -- fecha America/Chihuahua
    horizonte_h        INT,                         -- horas desde la corrida
    -- Nubosidad por capas (§1.1): el dato que faltaba por completo
    nubosidad_total_pct NUMERIC,
    nubosidad_baja_pct  NUMERIC,
    nubosidad_media_pct NUMERIC,
    nubosidad_alta_pct  NUMERIC,
    -- Precipitación: ESCALA INDEPENDIENTE de la nubosidad (§6)
    precip_prob_pct    NUMERIC,
    precip_mm          NUMERIC,
    weather_code       INT,                         -- código WMO del proveedor
    -- Variables de apoyo
    temp_c             NUMERIC,
    temp_max_c         NUMERIC,
    temp_min_c         NUMERIC,
    hum_rel_pct        NUMERIC,
    viento_ms          NUMERIC,
    viento_rafaga_ms   NUMERIC,
    rad_solar_wm2      NUMERIC,
    eto_fc_mm          NUMERIC,                     -- ETo pronosticada (mm en la hora)
    payload            JSONB,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Una fila por estación/instante/proveedor: la corrida nueva sobrescribe.
    UNIQUE (estacion_id, valido_en, proveedor)
);

COMMENT ON TABLE public.clima_pronostico_horario IS
  'Pronóstico horario por estación (nubosidad por capas, precipitación, ETo). Versionado por corrida para reproducir informes.';
COMMENT ON COLUMN public.clima_pronostico_horario.precip_prob_pct IS
  'Probabilidad de precipitación. NO es la inversa de la nubosidad: 0 % de lluvia es compatible con cielo cubierto.';

CREATE INDEX IF NOT EXISTS idx_clima_fc_estacion_valido
  ON public.clima_pronostico_horario (estacion_id, valido_en);
CREATE INDEX IF NOT EXISTS idx_clima_fc_fecha
  ON public.clima_pronostico_horario (fecha_local);

-- Retención: el pronóstico horario crece rápido y solo se consulta hacia adelante.
-- Purga manual sugerida (no automatizada aquí):
--   DELETE FROM clima_pronostico_horario WHERE valido_en < now() - interval '14 days';

-- ── 3. RLS (patrón del proyecto: lectura pública, escritura autenticada) ────
ALTER TABLE public.clima_pronostico_horario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Clima Pronostico" ON public.clima_pronostico_horario;
CREATE POLICY "Public Read Clima Pronostico" ON public.clima_pronostico_horario
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Clima Pronostico" ON public.clima_pronostico_horario;
CREATE POLICY "Auth Write Clima Pronostico" ON public.clima_pronostico_horario
  FOR ALL USING (true) WITH CHECK (true);

-- ── 4. Vista de diagnóstico: última lectura + pronóstico vigente ────────────
-- Entrega a la app una fila por estación con procedencia y edad explícitas, para
-- que la UI no tenga que recalcular frescura ni adivinar de dónde viene cada valor.
CREATE OR REPLACE VIEW public.v_clima_estacion_actual AS
WITH ult_lectura AS (
    SELECT DISTINCT ON (estacion_id) *
    FROM public.clima_estacion_lecturas
    ORDER BY estacion_id, ts DESC
),
fc_vigente AS (
    SELECT DISTINCT ON (estacion_id) *
    FROM public.clima_pronostico_horario
    WHERE valido_en >= now() - interval '1 hour'
    ORDER BY estacion_id, valido_en ASC
)
SELECT
    e.id                        AS estacion_id,
    e.station_id,
    e.nombre,
    e.latitud,
    e.longitud,
    e.elevacion_msnm,
    e.rol,
    e.activa,
    -- Observado
    l.ts                        AS obs_ts,
    l.temp_c                    AS temp_obs_c,
    l.hum_rel_pct               AS hum_obs_pct,
    l.viento_ms                 AS viento_obs_ms,
    l.lluvia_dia_mm             AS lluvia_obs_mm,
    l.rad_solar_wm2             AS rad_obs_wm2,
    l.eto_mm                    AS eto_obs_mm,
    l.gdd,
    l.bar_trend_hpa,
    -- Estimado localmente
    l.nubosidad_est_pct,
    l.clearness_index,
    l.sky_state_local,
    -- Calidad
    l.qa_status,
    l.qa_flags,
    ROUND(EXTRACT(EPOCH FROM (now() - l.ts)) / 60.0)::NUMERIC AS edad_actual_min,
    -- Pronosticado
    f.proveedor                 AS fc_proveedor,
    f.corrida_en                AS fc_corrida_en,
    f.valido_en                 AS fc_valido_en,
    f.nubosidad_total_pct       AS fc_nubosidad_total_pct,
    f.nubosidad_baja_pct        AS fc_nubosidad_baja_pct,
    f.nubosidad_media_pct       AS fc_nubosidad_media_pct,
    f.nubosidad_alta_pct        AS fc_nubosidad_alta_pct,
    f.precip_prob_pct           AS fc_precip_prob_pct,
    f.precip_mm                 AS fc_precip_mm
FROM public.clima_estaciones e
LEFT JOIN ult_lectura l ON l.estacion_id = e.id
LEFT JOIN fc_vigente  f ON f.estacion_id = e.id
WHERE e.activa = true;

COMMENT ON VIEW public.v_clima_estacion_actual IS
  'Estado agroclimático por estación con procedencia explícita: _obs observado, _est estimado local, fc_ pronosticado.';
