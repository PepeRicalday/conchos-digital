-- Cron duplicado: 'midnight-rollover' (jobid 2) y 'sica-midnight-rollover' (jobid 4) ejecutan lo MISMO
-- (SELECT public.fn_generar_continuidad_diaria();) a las 06:00 UTC = 00:00 Chihuahua.
-- Se conserva 'sica-midnight-rollover' (es el que documenta la migración 20260325100000) y se retira el duplicado
-- 'midnight-rollover'. Se borra por nombre solo si su comando coincide con el del job que se conserva.
-- Pegar en el editor SQL de Supabase (NO db push).

DO $$
DECLARE
  v_dup  text;
  v_keep text;
BEGIN
  SELECT regexp_replace(command, '\s+', ' ', 'g') INTO v_dup  FROM cron.job WHERE jobname = 'midnight-rollover';
  SELECT regexp_replace(command, '\s+', ' ', 'g') INTO v_keep FROM cron.job WHERE jobname = 'sica-midnight-rollover';
  IF v_keep IS NULL THEN
    RAISE EXCEPTION 'No existe sica-midnight-rollover: no se retira nada.';
  END IF;
  IF v_dup IS NOT NULL AND btrim(v_dup) = btrim(v_keep) THEN
    PERFORM cron.unschedule('midnight-rollover');
  END IF;
END $$;

-- Verificación (debe quedar solo sica-midnight-rollover):
-- select jobid, jobname, schedule, active from cron.job where command ilike '%fn_generar_continuidad_diaria%';
