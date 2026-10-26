-- Corrección de sesgo del pronóstico (temperatura y viento medio) por estación.
-- El valor crudo del modelo NUNCA se sobrescribe: se añaden *_corr y la
-- verificación (fn_clima_skill_*) sigue midiendo el crudo.

CREATE TABLE IF NOT EXISTS public.clima_sesgo_vigente (
  estacion_id    uuid NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  variable       text NOT NULL CHECK (variable IN ('temperatura','viento')),
  sesgo          numeric NOT NULL,          -- pronóstico − observado (unidades de la variable)
  n              integer NOT NULL,
  mae_crudo      numeric,
  aplicar        boolean NOT NULL DEFAULT false,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, variable)
);
ALTER TABLE public.clima_sesgo_vigente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clima_sesgo_lectura ON public.clima_sesgo_vigente;
CREATE POLICY clima_sesgo_lectura ON public.clima_sesgo_vigente FOR SELECT USING (true);

ALTER TABLE public.clima_pronostico_horario
  ADD COLUMN IF NOT EXISTS temp_c_corr    numeric,
  ADD COLUMN IF NOT EXISTS viento_ms_corr numeric;

-- Calcula *_corr con el sesgo vigente. Sin sesgo aplicable, corr = crudo.
CREATE OR REPLACE FUNCTION public.fn_clima_aplica_sesgo()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE s_t numeric; s_v numeric;
BEGIN
  SELECT sesgo INTO s_t FROM clima_sesgo_vigente
    WHERE estacion_id = NEW.estacion_id AND variable = 'temperatura' AND aplicar;
  SELECT sesgo INTO s_v FROM clima_sesgo_vigente
    WHERE estacion_id = NEW.estacion_id AND variable = 'viento' AND aplicar;
  NEW.temp_c_corr    := CASE WHEN NEW.temp_c IS NULL THEN NULL ELSE NEW.temp_c - COALESCE(s_t, 0) END;
  NEW.viento_ms_corr := CASE WHEN NEW.viento_ms IS NULL THEN NULL ELSE GREATEST(0, NEW.viento_ms - COALESCE(s_v, 0)) END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clima_aplica_sesgo ON public.clima_pronostico_horario;
CREATE TRIGGER trg_clima_aplica_sesgo
  BEFORE INSERT OR UPDATE ON public.clima_pronostico_horario
  FOR EACH ROW EXECUTE FUNCTION public.fn_clima_aplica_sesgo();

-- Recalcula el sesgo (ventana 30 d, todos los horizontes) y recorrige lo vigente.
-- Se aplica solo con n >= 100 y |sesgo| >= 0.5 °C (temperatura) / 0.8 m/s (viento).
CREATE OR REPLACE FUNCTION public.fn_clima_actualizar_sesgo()
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE filas integer;
BEGIN
  INSERT INTO clima_sesgo_vigente (estacion_id, variable, sesgo, n, mae_crudo, aplicar, actualizado_en)
  SELECT estacion_id, variable,
         round((sum(sesgo * n) / sum(n))::numeric, 2),
         sum(n)::int,
         round((sum(mae * n) / sum(n))::numeric, 2),
         sum(n) >= 100 AND abs(sum(sesgo * n) / sum(n)) >= CASE variable WHEN 'temperatura' THEN 0.5 ELSE 0.8 END,
         now()
  FROM fn_clima_skill_variables(30)
  GROUP BY estacion_id, variable
  ON CONFLICT (estacion_id, variable) DO UPDATE
    SET sesgo = EXCLUDED.sesgo, n = EXCLUDED.n, mae_crudo = EXCLUDED.mae_crudo,
        aplicar = EXCLUDED.aplicar, actualizado_en = EXCLUDED.actualizado_en;
  GET DIAGNOSTICS filas = ROW_COUNT;
  -- Dispara el trigger sobre el pronóstico futuro para refrescar *_corr.
  UPDATE clima_pronostico_horario SET temp_c = temp_c WHERE valido_en >= now() - interval '2 hours';
  RETURN filas;
END $$;

SELECT public.fn_clima_actualizar_sesgo();

-- Backfill de lo ya guardado (histórico dentro de la retención).
UPDATE public.clima_pronostico_horario SET temp_c = temp_c;

SELECT cron.schedule('clima-sesgo-diario', '30 9 * * *', $$SELECT public.fn_clima_actualizar_sesgo()$$);
