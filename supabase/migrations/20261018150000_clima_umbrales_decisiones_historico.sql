-- ═══════════════════════════════════════════════════════════════════════════
-- Clima: decisiones de umbrales (2026-10-18) + histórico de corridas del pronóstico
--
-- Calibrado con lecturas jul-oct 2026 (auditoría técnica):
--  · Calor: 36 °C se superaba casi a diario de julio a septiembre en Módulos 1/3/5 → aviso 38, crítico 42.
--  · Helada: la helada dañina es ≤0 °C a 1.5-2 m (≤2 °C era demasiado holgado como crítico) → crítico 0.
--  · Viento: Boquilla y Las Vírgenes (zona abierta) superan 6 m/s en ~45 de 90 días: es su régimen normal
--    → umbral propio para presas (8 / 12 m/s). Módulos siguen en 6 / 10 (riego por aspersión).
--  · Lluvia: la etiqueta declara la nueva regla (medido 24 h; pronóstico solo con prob. ≥60 %).
--  · Cambio brusco: "crítico" solo cuando es un frente (ver vista); acción neutral.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.clima_umbrales SET aviso = 38, critico = 42, actualizado_en = now() WHERE clave = 'calor';
UPDATE public.clima_umbrales SET critico = 0, actualizado_en = now() WHERE clave = 'helada';
UPDATE public.clima_umbrales
   SET etiqueta = 'Lluvia intensa (medida en 24 h, o pronóstico 24 h con probabilidad ≥ 60 %)', actualizado_en = now()
 WHERE clave = 'lluvia';
UPDATE public.clima_umbrales
   SET accion = 'Proteger cultivos sensibles al frío y revisar la programación de riegos y aspersión. Si es un enfriamiento por tormenta (presión estable), se normaliza en 1-2 días.',
       actualizado_en = now()
 WHERE clave = 'descenso';

INSERT INTO public.clima_umbrales (clave, etiqueta, comparador, aviso, critico, unidad, accion) VALUES
  ('viento_presa', 'Viento fuerte en presas (lectura actual o pronóstico 48 h)', 'mayor', 8, 12, 'm/s',
   'Vigilar maniobras y embarcaciones en el vaso; revisar infraestructura expuesta.')
ON CONFLICT (clave) DO NOTHING;

-- ── Histórico de corridas del pronóstico ────────────────────────────────────
-- clima_pronostico_horario guarda UNA fila por hora (upsert): las horas pasadas quedan como "análisis" y no se puede
-- medir cuánta anticipación dio el modelo. Cada vez que el sync actualiza una hora con una corrida nueva, se conserva
-- la corrida anterior aquí. Retención 120 días (~20 MB/mes con 6 estaciones x 48 h x 24 corridas/día).
CREATE TABLE IF NOT EXISTS public.clima_pronostico_corridas (
  estacion_id         uuid        NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  proveedor           text        NOT NULL,
  corrida_en          timestamptz NOT NULL,
  valido_en           timestamptz NOT NULL,
  horizonte_h         integer,
  temp_c              numeric,
  precip_prob_pct     numeric,
  precip_mm           numeric,
  viento_ms           numeric,
  viento_rafaga_ms    numeric,
  hum_rel_pct         numeric,
  nubosidad_total_pct numeric,
  PRIMARY KEY (estacion_id, proveedor, valido_en, corrida_en)
);
CREATE INDEX IF NOT EXISTS clima_pronostico_corridas_valido_idx ON public.clima_pronostico_corridas (valido_en);
CREATE INDEX IF NOT EXISTS clima_pronostico_corridas_corrida_idx ON public.clima_pronostico_corridas (corrida_en);

ALTER TABLE public.clima_pronostico_corridas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "corridas_pronostico_lectura" ON public.clima_pronostico_corridas;
CREATE POLICY "corridas_pronostico_lectura" ON public.clima_pronostico_corridas FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.fn_clima_guarda_corrida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.clima_pronostico_corridas
    (estacion_id, proveedor, corrida_en, valido_en, horizonte_h, temp_c, precip_prob_pct, precip_mm, viento_ms, viento_rafaga_ms, hum_rel_pct, nubosidad_total_pct)
  VALUES
    (NEW.estacion_id, NEW.proveedor, COALESCE(NEW.corrida_en, NEW.obtenido_en, now()), NEW.valido_en, NEW.horizonte_h, NEW.temp_c, NEW.precip_prob_pct, NEW.precip_mm,
     NEW.viento_ms, NEW.viento_rafaga_ms, NEW.hum_rel_pct, NEW.nubosidad_total_pct)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clima_guarda_corrida_ins ON public.clima_pronostico_horario;
CREATE TRIGGER trg_clima_guarda_corrida_ins AFTER INSERT ON public.clima_pronostico_horario
  FOR EACH ROW EXECUTE FUNCTION public.fn_clima_guarda_corrida();
DROP TRIGGER IF EXISTS trg_clima_guarda_corrida_upd ON public.clima_pronostico_horario;
CREATE TRIGGER trg_clima_guarda_corrida_upd AFTER UPDATE ON public.clima_pronostico_horario
  FOR EACH ROW WHEN (NEW.corrida_en IS DISTINCT FROM OLD.corrida_en)
  EXECUTE FUNCTION public.fn_clima_guarda_corrida();

-- Siembra con lo que hay hoy (la última corrida de cada hora ya almacenada).
INSERT INTO public.clima_pronostico_corridas
  (estacion_id, proveedor, corrida_en, valido_en, horizonte_h, temp_c, precip_prob_pct, precip_mm, viento_ms, viento_rafaga_ms, hum_rel_pct, nubosidad_total_pct)
SELECT estacion_id, proveedor, COALESCE(corrida_en, obtenido_en, now()), valido_en, horizonte_h, temp_c, precip_prob_pct, precip_mm, viento_ms, viento_rafaga_ms, hum_rel_pct, nubosidad_total_pct
  FROM public.clima_pronostico_horario
ON CONFLICT DO NOTHING;

-- Purga diaria (retención 120 días), 04:40 UTC.
SELECT cron.schedule('clima-corridas-purga-1d', '40 4 * * *',
  $$DELETE FROM public.clima_pronostico_corridas WHERE valido_en < now() - interval '120 days'$$);
