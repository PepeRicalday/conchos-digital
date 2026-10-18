-- ═══════════════════════════════════════════════════════════════════════════
-- Clima: sensores no confiables por estación (Riego San Rafael) — 2026-10-18
--
-- Diagnóstico (21 días vs. la mediana de los 3 módulos): temperatura sin relación con la red (correlación −0.04,
-- desviación típica 21 °C, 82 °C y ~25 °C de madrugada), humedad ausente (0 lecturas) y viento siempre 0 (anemómetro sin
-- señal). La presión (corr. 1.00), la radiación/UV (0.94) y la lluvia (0.93 diaria) SÍ coinciden con la red.
-- El dato crudo de WeatherLink trae solo 4 registros: la estación no transmite el conjunto completo de sensores.
--
-- Reparación: se declara qué columnas de esa estación no son confiables y un trigger las guarda como NULL (S/D, nunca 0)
-- tanto al insertar como al actualizar. Lo histórico se conserva en clima_estacion_lecturas_descartadas (reversible).
-- Si el sensor se repara: vaciar clima_estaciones.sensores_no_confiables y restituir desde la tabla de descartes.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.clima_estaciones
  ADD COLUMN IF NOT EXISTS sensores_no_confiables text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.clima_estaciones.sensores_no_confiables IS
  'Columnas de clima_estacion_lecturas que esta estación no mide bien: se guardan como NULL (S/D) por trigger.';

CREATE TABLE IF NOT EXISTS public.clima_estacion_lecturas_descartadas (
  lectura_id    uuid PRIMARY KEY,
  estacion_id   uuid NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  valores       jsonb NOT NULL,
  motivo        text NOT NULL,
  descartado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clima_estacion_lecturas_descartadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "descartadas_lectura" ON public.clima_estacion_lecturas_descartadas;
CREATE POLICY "descartadas_lectura" ON public.clima_estacion_lecturas_descartadas FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.fn_clima_sensores_no_confiables()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE cols text[]; v jsonb; c text;
BEGIN
  SELECT e.sensores_no_confiables INTO cols FROM public.clima_estaciones e WHERE e.id = NEW.estacion_id;
  IF cols IS NULL OR cardinality(cols) = 0 THEN RETURN NEW; END IF;
  v := to_jsonb(NEW);
  FOREACH c IN ARRAY cols LOOP v := jsonb_set(v, ARRAY[c], 'null'::jsonb); END LOOP;
  NEW := jsonb_populate_record(NEW, v);
  IF NOT ('sensor_no_confiable' = ANY (COALESCE(NEW.qa_flags, '{}'::text[]))) THEN
    NEW.qa_flags := array_append(COALESCE(NEW.qa_flags, '{}'::text[]), 'sensor_no_confiable');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clima_sensores_no_confiables ON public.clima_estacion_lecturas;
CREATE TRIGGER trg_clima_sensores_no_confiables BEFORE INSERT OR UPDATE ON public.clima_estacion_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.fn_clima_sensores_no_confiables();

-- Riego San Rafael (WeatherLink 246126): temperatura, humedad, viento y todo lo derivado de ellos.
UPDATE public.clima_estaciones
   SET sensores_no_confiables = ARRAY['temp_c','temp_max_c','temp_min_c','hum_rel_pct','punto_rocio_c',
                                      'viento_ms','viento_dir_deg','viento_rafaga_ms',
                                      'et_dia_mm','et_mes_mm','eto_mm','gdd']
 WHERE station_id = 246126;

-- Respaldo de lo que se descarta (antes de tocar el histórico).
INSERT INTO public.clima_estacion_lecturas_descartadas (lectura_id, estacion_id, ts, valores, motivo)
SELECT l.id, l.estacion_id, l.ts,
       jsonb_build_object('temp_c', l.temp_c, 'temp_max_c', l.temp_max_c, 'temp_min_c', l.temp_min_c, 'hum_rel_pct', l.hum_rel_pct,
                          'punto_rocio_c', l.punto_rocio_c, 'viento_ms', l.viento_ms, 'viento_dir_deg', l.viento_dir_deg,
                          'viento_rafaga_ms', l.viento_rafaga_ms, 'et_dia_mm', l.et_dia_mm, 'et_mes_mm', l.et_mes_mm,
                          'eto_mm', l.eto_mm, 'gdd', l.gdd),
       'Sensores de temperatura/humedad/viento sin relación con la red (2026-10-18)'
  FROM public.clima_estacion_lecturas l
  JOIN public.clima_estaciones e ON e.id = l.estacion_id
 WHERE e.station_id = 246126
ON CONFLICT (lectura_id) DO NOTHING;

-- Histórico: el trigger convierte las columnas no confiables en NULL.
UPDATE public.clima_estacion_lecturas l
   SET qa_flags = l.qa_flags
  FROM public.clima_estaciones e
 WHERE e.id = l.estacion_id AND e.station_id = 246126;
