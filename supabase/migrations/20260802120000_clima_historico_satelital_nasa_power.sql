-- ═══════════════════════════════════════════════════════════════════════════
-- CLIMA HISTÓRICO SATELITAL — NASA POWER — SICA-005
-- Fecha: 2026-08-02
--
-- Añade una fuente de clima histórico/casi-tiempo-real por coordenada exacta,
-- sin depender de estación física. Distinta en naturaleza de
-- clima_pronostico_horario (pronóstico de corto plazo, horizonte 48 h): NASA
-- POWER tiene rezago de días y sirve para calibración de sensores, relleno de
-- huecos y clima en puntos del canal sin estación instalada — no para
-- operación día a día. Por eso vive en tabla propia.
--
-- Grano diario (POWER community=AG). Igual patrón de RLS y de "sufijos de
-- procedencia" que 20260718140000_clima_nubosidad_qaqc.sql: _sat = satelital.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clima_historico_satelital (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estacion_id         UUID REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
    -- Punto exacto consultado. Redundante con estacion_id.latitud/longitud a
    -- propósito: permite consultar puntos del canal sin estación asociada
    -- (estacion_id NULL) sin romper la referencia geográfica del registro.
    latitud             NUMERIC NOT NULL,
    longitud            NUMERIC NOT NULL,
    -- Procedencia
    proveedor           TEXT NOT NULL DEFAULT 'nasa-power',
    comunidad           TEXT,                        -- perfil POWER, p. ej. 'AG'
    obtenido_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Grano diario
    fecha               DATE NOT NULL,
    -- Variables agroclimáticas (mismo set conceptual que clima_pronostico_horario,
    -- para poder comparar/calibrar directamente contra Open-Meteo y WeatherLink)
    rad_solar_sat_wm2   NUMERIC,   -- ALLSKY_SFC_SW_DWN, convertida de MJ/m²/día
    temp_sat_c          NUMERIC,   -- T2M
    hum_rel_sat_pct     NUMERIC,   -- RH2M
    viento_sat_ms       NUMERIC,   -- WS2M
    precip_sat_mm       NUMERIC,   -- PRECTOTCORR
    eto_sat_mm          NUMERIC,   -- ET0 (perfil AG)
    payload             JSONB,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Una fila por punto/fecha/proveedor: una resincronización sobrescribe
    -- (POWER revisa sus valores "casi-tiempo-real" hasta ~3 meses después).
    UNIQUE (latitud, longitud, fecha, proveedor)
);

COMMENT ON TABLE public.clima_historico_satelital IS
  'Clima histórico/casi-tiempo-real por coordenada (NASA POWER). Rezago de días: calibración y relleno de huecos, NO pronóstico operativo.';
COMMENT ON COLUMN public.clima_historico_satelital.estacion_id IS
  'NULL cuando el punto consultado no corresponde a una estación física (p. ej. un KM del canal sin sensor).';
COMMENT ON COLUMN public.clima_historico_satelital.eto_sat_mm IS
  'ET0 diaria del perfil agrícola de POWER (Penman-Monteith), para contraste contra el ETo local FAO-56 de WeatherLink.';

CREATE INDEX IF NOT EXISTS idx_clima_sat_estacion_fecha
  ON public.clima_historico_satelital (estacion_id, fecha);
CREATE INDEX IF NOT EXISTS idx_clima_sat_fecha
  ON public.clima_historico_satelital (fecha);

-- RLS: mismo patrón del proyecto — lectura pública, escritura autenticada.
ALTER TABLE public.clima_historico_satelital ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Clima Historico Satelital" ON public.clima_historico_satelital;
CREATE POLICY "Public Read Clima Historico Satelital" ON public.clima_historico_satelital
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Clima Historico Satelital" ON public.clima_historico_satelital;
CREATE POLICY "Auth Write Clima Historico Satelital" ON public.clima_historico_satelital
  FOR ALL USING (true) WITH CHECK (true);
