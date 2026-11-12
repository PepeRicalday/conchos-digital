-- Salud de las fuentes de datos de la cuenca — etapa 2 del plan de macromedición.
--
-- Una fila por fuente (o por estación en la red hidrométrica) con la hora de su último dato y cada cuánto se espera uno nuevo.
-- La vista NO decide el estado: el cliente compara con su propio reloj (edad ≤ 1.5 × esperado = al día; ≤ 3 × = con retraso; más = sin actualizar),
-- que son los mismos umbrales que ya usa la red GOES (90 / 180 min con 60 min esperados).
-- Solo lee tablas que la app ya consulta (security_invoker: respeta las políticas de cada tabla). No guarda nada.
--
-- «Satélite» toma la escena MÁS ANTIGUA entre los vasos (el último dato de cada vaso, y de ahí el menor): un vaso atrasado no se esconde detrás de uno al día.
-- «WeatherLink» toma la estación MÁS ATRASADA por la misma razón.

CREATE OR REPLACE VIEW public.v_cuenca_salud_fuentes WITH (security_invoker = true) AS
SELECT 'aqwp'::text AS clave, 'Presas y flujos'::text AS grupo, 'CONAGUA vía USIBWC (presas y aportaciones)'::text AS nombre,
       max(ult_sync_en)::timestamptz AS ultimo_en, 1560 AS esperado_min
FROM public.aqwp_datasets
UNION ALL
SELECT 'cila', 'Presas y flujos', 'CILA (reporte diario de Boquilla y Madero)', max(actualizado_en)::timestamptz, 1560
FROM public.lecturas_presas_cila
UNION ALL
SELECT 'goes:' || id, 'Red hidrométrica', nombre, ult_dato_en::timestamptz, CASE WHEN id LIKE 'IBWC-%' THEN 120 ELSE 60 END
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
COMMENT ON VIEW public.v_cuenca_salud_fuentes IS
  'Último dato de cada fuente de la cuenca y cada cuánto se espera uno nuevo (minutos). El estado lo calcula el cliente con su reloj.';
