-- ═══════════════════════════════════════════════════════════════════════════
-- Clima: endurecimiento tras la auditoría final del 2026-10-18
--
-- 1) Seguridad: fn_clima_alertas_agro / fn_clima_vigilar_red (SECURITY DEFINER, escriben en registro_alertas) y la función
--    de trigger fn_clima_guarda_corrida eran invocables por anon vía RPC. Solo las usa el cron (SQL del dueño): se revoca.
-- 2) Tamaño: clima_pronostico_corridas guardaba 24 corridas/día (~245 MB a 120 días, casi triplicaba la base). Basta una
--    corrida cada 6 h (00/06/12/18 UTC) para medir el error por horizonte: ~40 MB a 90 días.
-- 3) ETo del día en la alerta: sumaba solo las horas FUTURAS de hoy (a las 12:40 solo la tarde) y subestimaba contra el
--    umbral de 7 mm/día; ahora suma el día local completo.
-- 4) Vista de alertas con security_invoker (respeta RLS de quien consulta); permisos de escritura de las tablas nuevas.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Funciones de escritura: fuera del alcance de anon / authenticated.
REVOKE EXECUTE ON FUNCTION public.fn_clima_alertas_agro(), public.fn_clima_vigilar_red(), public.fn_clima_guarda_corrida()
  FROM PUBLIC, anon, authenticated;

-- 2) Corridas del pronóstico: una cada 6 h, retención 90 días.
CREATE OR REPLACE FUNCTION public.fn_clima_guarda_corrida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (extract(hour FROM COALESCE(NEW.corrida_en, NEW.obtenido_en, now()) AT TIME ZONE 'UTC'))::int % 6 <> 0 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.clima_pronostico_corridas
    (estacion_id, proveedor, corrida_en, valido_en, horizonte_h, temp_c, precip_prob_pct, precip_mm, viento_ms, viento_rafaga_ms, hum_rel_pct, nubosidad_total_pct)
  VALUES
    (NEW.estacion_id, NEW.proveedor, COALESCE(NEW.corrida_en, NEW.obtenido_en, now()), NEW.valido_en, NEW.horizonte_h, NEW.temp_c, NEW.precip_prob_pct, NEW.precip_mm,
     NEW.viento_ms, NEW.viento_rafaga_ms, NEW.hum_rel_pct, NEW.nubosidad_total_pct)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_clima_guarda_corrida() FROM PUBLIC, anon, authenticated;

DELETE FROM public.clima_pronostico_corridas WHERE (extract(hour FROM corrida_en AT TIME ZONE 'UTC'))::int % 6 <> 0;
DROP INDEX IF EXISTS public.clima_pronostico_corridas_corrida_idx;
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'clima-corridas-purga-1d'),
  command := $$DELETE FROM public.clima_pronostico_corridas WHERE valido_en < now() - interval '90 days'$$);

-- 3) ETo del día completo (horas pasadas y futuras de hoy, hora local) en la vista de alertas.
DO $$
DECLARE def text; nuevo text;
  viejo constant text := $v$sum(clima_pronostico_horario.eto_fc_mm) FILTER (WHERE (clima_pronostico_horario.fecha_local = ((now() AT TIME ZONE 'America/Chihuahua'::text))::date)) AS eto_hoy$v$;
  reemplazo constant text := $v$(SELECT sum(h.eto_fc_mm) FROM clima_pronostico_horario h WHERE h.estacion_id = clima_pronostico_horario.estacion_id AND h.fecha_local = ((now() AT TIME ZONE 'America/Chihuahua'::text))::date) AS eto_hoy$v$;
BEGIN
  def := pg_get_viewdef('public.v_clima_alertas_agro_eval'::regclass);
  IF position(viejo IN def) = 0 THEN RAISE EXCEPTION 'No se encontró la expresión de eto_hoy en la vista; nada se modificó'; END IF;
  nuevo := replace(rtrim(def, E';\n '), viejo, reemplazo);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_clima_alertas_agro_eval AS ' || nuevo;
END $$;

-- 4) Vistas con los permisos de quien consulta; tablas nuevas de solo lectura para la API pública.
ALTER VIEW public.v_clima_alertas_agro_eval SET (security_invoker = on);
ALTER VIEW public.v_clima_estacion_actual SET (security_invoker = on);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clima_pronostico_corridas, public.clima_estacion_lecturas_descartadas FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_clima_lect_desc_estacion ON public.clima_estacion_lecturas_descartadas (estacion_id);
ALTER FUNCTION public.fn_clima_skill_anticipacion(integer) SET search_path = public;
