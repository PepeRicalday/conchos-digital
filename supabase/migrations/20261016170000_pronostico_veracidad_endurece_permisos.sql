-- Endurece 20261016160000 (revision de seguridad automatica del commit 3e36586):
--  1) fn_clima_snapshot_pronostico (SECURITY DEFINER, escribe/borra) solo la ejecuta pg_cron (postgres).
--  2) fn_clima_skill_variables / fn_clima_skill_lluvia_dia: SECURITY INVOKER (las tablas ya son legibles por RLS
--     para anon) y p_dias acotado a 1-60 para que una llamada publica no fuerce un escaneo ilimitado.
-- Aplicada con apply_migration (el cuerpo de las funciones es el de 20261016160000 con LEAST(GREATEST(p_dias,1),60)).
REVOKE ALL ON FUNCTION public.fn_clima_snapshot_pronostico() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.fn_clima_skill_variables(integer) SECURITY INVOKER;
ALTER FUNCTION public.fn_clima_skill_lluvia_dia(integer) SECURITY INVOKER;
-- Tope de p_dias: ver las definiciones vigentes en la base (pg_get_functiondef); aqui queda el registro del cambio.
