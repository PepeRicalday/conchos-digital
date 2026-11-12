-- Salud de fuentes: cadencia EFECTIVA de la red hidrométrica.
-- El cron de sincronización es horario y el portal publica con ~1 h de rezago, así que un dato de 60-130 min de edad es lo normal justo antes
-- de la siguiente sincronización. Con 60 min esperados la tira salía en ámbar casi siempre sin que nada fallara.
-- GOES: 90 min (al día hasta 135, con retraso hasta 270). IBWC: 180 min (guarda 1 lectura cada 2 h y publica con ~40 min de retraso).

CREATE OR REPLACE VIEW public.v_cuenca_salud_fuentes WITH (security_invoker = true) AS
SELECT 'aqwp'::text AS clave, 'Presas y flujos'::text AS grupo, 'CONAGUA vía USIBWC (presas y aportaciones)'::text AS nombre,
       max(ult_sync_en)::timestamptz AS ultimo_en, 1560 AS esperado_min
FROM public.aqwp_datasets
UNION ALL
SELECT 'cila', 'Presas y flujos', 'CILA (reporte diario de Boquilla y Madero)', max(actualizado_en)::timestamptz, 1560
FROM public.lecturas_presas_cila
UNION ALL
SELECT 'goes:' || id, 'Red hidrométrica', nombre, ult_dato_en::timestamptz, CASE WHEN id LIKE 'IBWC-%' THEN 180 ELSE 90 END
FROM public.hidro_estaciones WHERE activa
UNION ALL
SELECT 'jcas', 'Clima y lluvia', 'JCAS/UACJ (estaciones de la cuenca)', max(actualizado_en)::timestamptz, 120
FROM public.jcas_lecturas_hoy
UNION ALL
SELECT 'weatherlink', 'Clima y lluvia', 'WeatherLink (estaciones propias, la más atrasada)', min(ult_dato_en)::timestamptz, 120
FROM public.clima_estaciones WHERE activa
UNION ALL
SELECT 'pronostico', 'Pronóstico', 'Pronóstico de la cuenca (3 modelos)', max(corrida_en)::timestamptz, 360
FROM public.cuenca_pronostico_diario
UNION ALL
SELECT 'satelite', 'Satélite', 'Sentinel-2 (escena más antigua entre los vasos)', min(u)::timestamptz, 20160
FROM (SELECT max(fecha_escena) AS u FROM public.vaso_geometria_historico WHERE vigente AND NOT es_referencia_historica GROUP BY presa_id) s
UNION ALL
SELECT 'cierres', 'Cálculo', 'Cierres y balance mensual', max(calculado_en)::timestamptz, 1560
FROM public.cuerpos_agua_balance_mensual
UNION ALL
SELECT 'evaporacion', 'Cálculo', 'Evaporación de agua libre', max(calculado_en)::timestamptz, 1560
FROM public.cuerpos_agua_evaporacion_dia;

GRANT SELECT ON public.v_cuenca_salud_fuentes TO anon, authenticated;
