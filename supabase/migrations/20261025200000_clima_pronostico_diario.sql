-- Pronóstico diario a 7 días por estación (orientativo: la precisión cae después del día 3).
-- Tabla APARTE de clima_pronostico_horario: el resto de SICA asume 48 h horarias y no debe verse afectado.
-- Lo llena clima-pronostico-alterno-sync (2 veces al día). Solo el último pronóstico por (estación, fecha).

CREATE TABLE IF NOT EXISTS public.clima_pronostico_diario (
  estacion_id      uuid NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  fecha            date NOT NULL,                -- día local America/Chihuahua
  temp_max_c       numeric,
  temp_min_c       numeric,
  precip_mm        numeric,
  precip_prob_pct  numeric,
  viento_max_ms    numeric,
  rafaga_max_ms    numeric,
  eto_mm           numeric,
  obtenido_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, fecha)
);
ALTER TABLE public.clima_pronostico_diario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clima_pron_diario_lectura ON public.clima_pronostico_diario;
CREATE POLICY clima_pron_diario_lectura ON public.clima_pronostico_diario FOR SELECT USING (true);
