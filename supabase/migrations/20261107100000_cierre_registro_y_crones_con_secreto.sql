-- Cierre del registro abierto y crones con x-cron-secret.
-- Aplicada en producción el 2026-11-07 con execute_sql (los secretos se generan al ejecutarse, por eso
-- este archivo es idempotente y NO contiene valores).
--
-- 1) handle_new_user() ya no da rol SRL: todo usuario nuevo de Auth nace INVITADO e INACTIVO.
--    Para dar acceso real: UPDATE public.perfiles_usuario SET rol='SRL'|'ACU', activo=true WHERE id=...;
--    (la edge function admin-invitados activa a los invitados que crea un SRL).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  INSERT INTO public.perfiles_usuario (id, rol, nombre, activo)
  VALUES (new.id, 'INVITADO', new.raw_user_meta_data->>'nombre', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$;

-- 2) Un secreto por función disparada por cron.
INSERT INTO public.cron_secretos (nombre, valor)
SELECT n, encode(extensions.gen_random_bytes(32), 'hex')
FROM unnest(ARRAY['weatherlink_sync','clima_pronostico','clima_pronostico_alterno','clima_historico_satelital',
                  'presas_cila_sync','recalibra_curva','truecolor_terreno']) AS n
ON CONFLICT DO NOTHING;
-- Los jobs (weatherlink-sync-2h, clima-pronostico-1h, clima-historico-satelital-1d, recalibra-curva-batimetrica-mensual,
-- presas-cila-sync-*, sentinel-truecolor-terreno-mensual, clima-pronostico-alterno) añadieron la cabecera
--   'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = '<secreto>')
-- tras 'Authorization' mediante cron.alter_job. Las funciones lo exigen con exigirRol() de _shared/auth.ts.
