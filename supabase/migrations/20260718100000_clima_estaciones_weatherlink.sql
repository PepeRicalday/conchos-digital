-- ═══════════════════════════════════════════════════════════════════════════
-- INTEGRACIÓN DE ESTACIONES CLIMÁTICAS WeatherLink (Davis) — SICA-005
-- Fecha: 2026-07-18
--
-- Adapta datos agroclimáticos de estaciones Davis/WeatherLink de la cuenta
-- Chihuahua2024 (Kosmos Scientific). De las 36 estaciones de la cuenta se
-- SELECCIONAN solo las relevantes y con datos en vivo (varias están caídas):
--   · BOQUILLA      (239961) → Presa cabecera del sistema (PRE-001)
--   · Las Vírgenes  (242154) → zona de canal / campamento
--   · Modulo3       (241461) → Módulo 3 de riego
--   · Modulo5       (241474) → Módulo 5 de riego
--
-- Dos tablas: catálogo/config (clima_estaciones) + serie de lecturas ya
-- convertidas a métrico (clima_estacion_lecturas). El Edge Function
-- weatherlink-sync consulta la API v2 y hace upsert aquí y en clima_presas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Catálogo de estaciones seleccionadas ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clima_estaciones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identidad WeatherLink
    station_id      BIGINT NOT NULL UNIQUE,          -- id numérico WeatherLink v2
    station_uuid    TEXT,                            -- station_id_uuid
    nombre          TEXT NOT NULL,                   -- nombre para mostrar (p.ej. "Boquilla")
    -- Ubicación (para el mapa)
    latitud         NUMERIC NOT NULL,
    longitud        NUMERIC NOT NULL,
    elevacion_msnm  NUMERIC,                         -- ya convertida a metros
    ciudad          TEXT,
    -- Vínculo con el modelo del distrito (cualquiera puede ser NULL)
    presa_id        TEXT REFERENCES public.presas(id),        -- si es estación de presa
    modulo_id       TEXT,                                     -- MOD-00X si es de módulo
    zona_id         UUID,                                     -- zona de riego asociada
    rol             TEXT NOT NULL DEFAULT 'canal',            -- 'presa' | 'modulo' | 'canal'
    -- Estado / gestión
    activa          BOOLEAN NOT NULL DEFAULT true,   -- incluida en la sincronización
    prioridad       INT NOT NULL DEFAULT 100,        -- orden de despliegue (menor = primero)
    ult_sync_en     TIMESTAMPTZ,                     -- último sync exitoso
    ult_dato_en     TIMESTAMPTZ,                     -- ts de la última lectura de la estación
    notas           TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clima_estaciones IS
  'Estaciones WeatherLink seleccionadas para SICA-005 (config + vínculo a presa/módulo/zona).';

-- ── 2. Serie de lecturas por estación (ya en métrico) ───────────────────────
CREATE TABLE IF NOT EXISTS public.clima_estacion_lecturas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id         UUID NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
    station_id          BIGINT NOT NULL,                 -- redundante para joins rápidos
    fecha               DATE NOT NULL,                   -- fecha local (America/Chihuahua)
    ts                  TIMESTAMPTZ NOT NULL,            -- instante de la lectura (UTC)
    -- Variables convertidas a MÉTRICO
    temp_c              NUMERIC,                         -- temperatura del aire (°C)
    temp_max_c          NUMERIC,                         -- máx del día
    temp_min_c          NUMERIC,                         -- mín del día
    hum_rel_pct         NUMERIC,                         -- humedad relativa (%)
    punto_rocio_c       NUMERIC,                         -- dew point (°C)
    presion_hpa         NUMERIC,                         -- barométrica nivel del mar (hPa)
    viento_ms           NUMERIC,                         -- velocidad viento (m/s)
    viento_dir_deg      NUMERIC,                         -- dirección (0-360°)
    viento_rafaga_ms    NUMERIC,                         -- ráfaga máx (m/s)
    lluvia_dia_mm       NUMERIC,                         -- acumulada del día (mm)
    lluvia_24h_mm       NUMERIC,                         -- últimas 24 h (mm)
    lluvia_mes_mm       NUMERIC,
    lluvia_anio_mm      NUMERIC,
    rad_solar_wm2       NUMERIC,                         -- radiación solar (W/m²)
    uv_index            NUMERIC,
    et_dia_mm           NUMERIC,                         -- evapotranspiración del día (mm) — de la estación
    et_mes_mm           NUMERIC,
    -- Estimaciones/modelos derivados (calculados en el sync)
    eto_mm              NUMERIC,                         -- ETo de referencia (mm/día)
    gdd                 NUMERIC,                         -- grados-día base 10°C
    -- Trazabilidad
    payload             JSONB,                           -- lectura cruda (respaldo/depuración)
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(estacion_id, ts)
);

COMMENT ON TABLE public.clima_estacion_lecturas IS
  'Lecturas de estaciones WeatherLink convertidas a métrico + ETo/GDD calculados.';

CREATE INDEX IF NOT EXISTS idx_clima_lect_estacion_fecha
  ON public.clima_estacion_lecturas (estacion_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_clima_lect_fecha
  ON public.clima_estacion_lecturas (fecha DESC);

-- ── 3. RLS (patrón del proyecto: lectura pública, escritura autenticada) ─────
ALTER TABLE public.clima_estaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clima_estacion_lecturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Clima Estaciones" ON public.clima_estaciones;
CREATE POLICY "Public Read Clima Estaciones" ON public.clima_estaciones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Clima Estaciones" ON public.clima_estaciones;
CREATE POLICY "Auth Write Clima Estaciones" ON public.clima_estaciones FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Read Clima Lecturas" ON public.clima_estacion_lecturas;
CREATE POLICY "Public Read Clima Lecturas" ON public.clima_estacion_lecturas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Clima Lecturas" ON public.clima_estacion_lecturas;
CREATE POLICY "Auth Write Clima Lecturas" ON public.clima_estacion_lecturas FOR ALL USING (true) WITH CHECK (true);

-- ── 4. Seed de las 4 estaciones seleccionadas ───────────────────────────────
-- presa_id de Boquilla = PRE-001 (Presa La "Boquilla"). Los módulos usan
-- modulo_id MOD-003/MOD-005; zona_id se puede completar luego desde modulo_zonas.
-- NOTA elevación: el campo `elevation` de estas estaciones (gateway 6313) viene
-- corrupto en la API (~4000 m, imposible para la zona Delicias/Conchos ≈1200 m);
-- se usan elevaciones geográficas reales, relevantes para la presión en el ETo.
INSERT INTO public.clima_estaciones
  (station_id, station_uuid, nombre, latitud, longitud, elevacion_msnm, ciudad, presa_id, modulo_id, rol, prioridad)
VALUES
  (239961, '47045aab-0a5e-487f-adcf-63c90d7c5edd', 'Boquilla',      27.544687, -105.41395, 1300, 'Boquilla de Babisas',      'PRE-001', NULL,      'presa',  10),
  (242154, 'f8c02aaf-c5b8-4fc4-89c4-fa464ff0b6e3', 'Las Vírgenes',  28.166483, -105.62861, 1210, 'Campamento las Vírgenes',  NULL,      NULL,      'canal',  20),
  (241461, 'f5d524c0-6d2c-4821-8faa-afe9cf796a57', 'Módulo 3',      28.204453, -105.38325, 1200, 'Colonia las Virginias',    NULL,      'MOD-003', 'modulo', 30),
  (241474, '67c28754-2e0b-4640-ba3c-281f3a4ea066', 'Módulo 5',      28.156738, -105.51014, 1190, 'La Estancia',              NULL,      'MOD-005', 'modulo', 40)
ON CONFLICT (station_id) DO UPDATE SET
  nombre = EXCLUDED.nombre, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  elevacion_msnm = EXCLUDED.elevacion_msnm, ciudad = EXCLUDED.ciudad,
  presa_id = EXCLUDED.presa_id, modulo_id = EXCLUDED.modulo_id, rol = EXCLUDED.rol,
  prioridad = EXCLUDED.prioridad, actualizado_en = now();

-- Completa zona_id de las estaciones de módulo desde modulo_zonas (zona primaria).
UPDATE public.clima_estaciones ce
SET zona_id = mz.zona_id
FROM public.modulo_zonas mz
WHERE ce.modulo_id = mz.modulo_id AND mz.es_primaria = true AND ce.zona_id IS NULL;
