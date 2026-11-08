-- v_aqwp_presas_estado: agrega cuántos días lleva igual el último almacenamiento y desde cuándo.
-- Sirve para decir "sin actualizar desde el 22-sep (47 d)" en vez de la etiqueta técnica "estancada".
-- Columnas NUEVAS al final (CREATE OR REPLACE VIEW exige conservar el orden de las existentes).
CREATE OR REPLACE VIEW public.v_aqwp_presas_estado WITH (security_invoker = true) AS
WITH ult AS (
  SELECT DISTINCT ON (d.ubicacion_id, d.magnitud)
         d.ubicacion_id, d.magnitud, l.fecha, l.valor, l.estancada
  FROM public.aqwp_lecturas_diarias l
  JOIN public.aqwp_datasets d ON d.id_number = l.dataset_id
  WHERE l.valor IS NOT NULL
  ORDER BY d.ubicacion_id, d.magnitud, l.fecha DESC
),
runs AS (
  -- islas de valor repetido: cambio = 1 cuando el valor difiere del día anterior; la suma acumulada numera cada tramo.
  -- (Las funciones de ventana no se pueden anidar: lag() va en la subconsulta interna, sum() en la externa.)
  SELECT ubicacion_id, g, min(fecha) AS desde, max(fecha) AS hasta
  FROM (
    SELECT ubicacion_id, fecha, sum(cambio) OVER (PARTITION BY ubicacion_id ORDER BY fecha) AS g
    FROM (
      SELECT d.ubicacion_id, l.fecha,
             (l.valor IS DISTINCT FROM lag(l.valor) OVER (PARTITION BY d.ubicacion_id ORDER BY l.fecha))::int AS cambio
      FROM public.aqwp_lecturas_diarias l
      JOIN public.aqwp_datasets d ON d.id_number = l.dataset_id
      WHERE d.magnitud = 'almacenamiento' AND l.valor IS NOT NULL
    ) a
  ) b
  GROUP BY ubicacion_id, g
),
ultrun AS (
  SELECT DISTINCT ON (ubicacion_id) ubicacion_id, desde, (hasta - desde + 1) AS dias
  FROM runs ORDER BY ubicacion_id, hasta DESC
)
SELECT u.id_number AS ubicacion_id, u.codigo, u.nombre, u.tipo, u.presa_id,
       max(ult.fecha) FILTER (WHERE ult.magnitud = 'almacenamiento')           AS fecha,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'almacenamiento')           AS almacenamiento_mm3,
       bool_or(ult.estancada) FILTER (WHERE ult.magnitud = 'almacenamiento')   AS almacenamiento_estancado,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'namo')                     AS namo_mm3,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'almacenamiento_muerto')    AS muerto_mm3,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'pct_namo')                 AS pct_namo,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'aportacion')               AS aportacion_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'extraccion_total')         AS extraccion_total_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'vertido')                  AS vertido_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'gasto')                    AS gasto_m3s,
       ur.dias::integer                                                        AS almacenamiento_dias_igual,
       ur.desde                                                                AS almacenamiento_igual_desde
FROM public.aqwp_ubicaciones u
LEFT JOIN ult ON ult.ubicacion_id = u.id_number
LEFT JOIN ultrun ur ON ur.ubicacion_id = u.id_number
WHERE u.activa
GROUP BY u.id_number, u.codigo, u.nombre, u.tipo, u.presa_id, ur.dias, ur.desde;
