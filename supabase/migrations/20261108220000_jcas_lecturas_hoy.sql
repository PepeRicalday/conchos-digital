-- JCAS: lectura del DÍA EN CURSO (parcial). jcas_lecturas_diarias guarda solo días COMPLETOS y alimenta la verificación del pronóstico;
-- el día en curso va aparte para que nunca contamine esa comparación. Una fila por estación (se sobrescribe en cada corrida).
-- S/D = NULL, nunca 0. Dato provisional y PARCIAL: la lluvia es lo acumulado hasta `actualizado_en`, la temperatura/humedad/viento son medias del día hasta ese momento.

CREATE TABLE IF NOT EXISTS public.jcas_lecturas_hoy (
  estacion_id    integer PRIMARY KEY REFERENCES public.jcas_estaciones(id_jcas) ON DELETE CASCADE,
  fecha          date NOT NULL,                  -- día local de la estación al que pertenece la lectura parcial
  temp_c         numeric, hum_pct numeric, viento_kmh numeric,
  lluvia_mm      numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.jcas_lecturas_hoy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jcas_hoy_lectura ON public.jcas_lecturas_hoy;
CREATE POLICY jcas_hoy_lectura ON public.jcas_lecturas_hoy FOR SELECT USING (true);

-- Cron: una corrida ligera cada 2 h (solo el día en curso). Misma cortesía que el resto: 1 página por estación, pausa de 1 s.
-- PENDIENTE DE APLICAR el cron solo después de desplegar la nueva versión de jcas-sync (requiere visto bueno del usuario).
SELECT cron.unschedule('jcas-sync-hoy') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jcas-sync-hoy');
SELECT cron.schedule('jcas-sync-hoy', '35 */2 * * *', $f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/jcas-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'jcas_sync')),
    body    := '{"modo":"hoy"}'::jsonb,
    timeout_milliseconds := 140000
  );$f$);
