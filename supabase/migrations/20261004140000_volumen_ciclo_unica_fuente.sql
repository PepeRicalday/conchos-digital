-- ÚNICA FUENTE de "volumen a entregar vs entregado" por módulo y ciclo.
-- entregado = hoja institucional mensual (volumen_modulo_mensual_provisional)
--           + remanente post-cierre (entregas_modulo, tipo 'adicional', motivo 'Remanente%').
-- resumen_ciclo y balance_volumen_modulo pasan a derivar de esta vista, de modo que
-- Dashboard, Monitor Público, Informe Operativo y sica-capture muestren la MISMA cifra.
-- Aplicado en producción vía SQL (no db push: hay drift de migraciones). 2026-10-04.

CREATE OR REPLACE VIEW public.volumen_ciclo_modulo AS
WITH aut AS (
  SELECT ac.ciclo_id, ac.modulo_id, ac.vol_autorizado AS vol_autorizado_miles_m3,
         ca.nombre AS ciclo_nombre, ca.fecha_inicio, ca.fecha_fin, ca.activo,
         to_char(ca.fecha_inicio, 'YYYY-MM') AS mes_ini, to_char(ca.fecha_fin, 'YYYY-MM') AS mes_fin
  FROM autorizaciones_ciclo ac JOIN ciclos_agricolas ca ON ca.id = ac.ciclo_id
), hoja AS (
  SELECT a.ciclo_id, a.modulo_id,
         sum(vp.volumen_miles_m3) AS vol_hoja_miles_m3,
         count(*) AS meses_con_dato,
         max(vp.mes) AS ultimo_mes_hoja,
         bool_or(vp.es_mes_parcial) AS hoja_mes_parcial
  FROM aut a
  JOIN modulos m ON m.id = a.modulo_id
  JOIN volumen_modulo_mensual_provisional vp
    ON vp.numero_modulo = NULLIF(substring(m.codigo_corto, '^M(\d+)$'), '')::int
   AND vp.mes BETWEEN a.mes_ini AND a.mes_fin
  GROUP BY a.ciclo_id, a.modulo_id
), rem AS (
  SELECT em.ciclo_id, em.modulo_id,
         sum(em.volumen_m3) / 1000.0 AS vol_remanente_miles_m3,
         min(em.fecha) AS remanente_desde, max(em.fecha) AS remanente_hasta
  FROM entregas_modulo em
  WHERE em.tipo_entrega = 'adicional' AND em.motivo_adicional ILIKE 'Remanente%'
  GROUP BY em.ciclo_id, em.modulo_id
)
SELECT a.ciclo_id, a.ciclo_nombre, a.fecha_inicio, a.fecha_fin, a.activo,
       m.id AS modulo_id, m.nombre AS modulo_nombre, m.codigo_corto,
       NULLIF(substring(m.codigo_corto, '^M(\d+)$'), '')::int AS numero_modulo,
       a.vol_autorizado_miles_m3,
       COALESCE(h.vol_hoja_miles_m3, 0)      AS vol_hoja_miles_m3,
       COALESCE(r.vol_remanente_miles_m3, 0) AS vol_remanente_miles_m3,
       COALESCE(h.vol_hoja_miles_m3, 0) + COALESCE(r.vol_remanente_miles_m3, 0) AS vol_entregado_miles_m3,
       a.vol_autorizado_miles_m3 - (COALESCE(h.vol_hoja_miles_m3, 0) + COALESCE(r.vol_remanente_miles_m3, 0)) AS vol_saldo_miles_m3,
       CASE WHEN a.vol_autorizado_miles_m3 > 0
            THEN round(((COALESCE(h.vol_hoja_miles_m3, 0) + COALESCE(r.vol_remanente_miles_m3, 0)) / a.vol_autorizado_miles_m3 * 100)::numeric, 2)
            ELSE NULL END AS pct_entregado,
       (a.vol_autorizado_miles_m3 / 1000.0)  AS vol_autorizado_mm3,
       ((COALESCE(h.vol_hoja_miles_m3, 0) + COALESCE(r.vol_remanente_miles_m3, 0)) / 1000.0) AS vol_entregado_mm3,
       COALESCE(h.meses_con_dato, 0) AS meses_con_dato,
       h.ultimo_mes_hoja, COALESCE(h.hoja_mes_parcial, false) AS hoja_mes_parcial,
       r.remanente_desde, r.remanente_hasta
FROM aut a
JOIN modulos m ON m.id = a.modulo_id
LEFT JOIN hoja h ON h.ciclo_id = a.ciclo_id AND h.modulo_id = a.modulo_id
LEFT JOIN rem  r ON r.ciclo_id = a.ciclo_id AND r.modulo_id = a.modulo_id;

GRANT SELECT ON public.volumen_ciclo_modulo TO anon, authenticated;

-- resumen_ciclo: mismas columnas, ahora derivada de la vista única.
CREATE OR REPLACE VIEW public.resumen_ciclo AS
 SELECT ca.id AS ciclo_id, ca.nombre AS ciclo_nombre, ca.clave AS ciclo_clave,
    ca.fecha_inicio, ca.fecha_fin, ca.activo,
    m.id AS modulo_id, m.nombre AS modulo_nombre, m.codigo_corto,
    COALESCE(ac.vol_autorizado, m.vol_autorizado) AS vol_autorizado_mm3,
    COALESCE(ac.caudal_max, m.caudal_objetivo) AS caudal_max_m3s,
    COALESCE(v.meses_con_dato, 0::bigint) AS total_mediciones,
    COALESCE(v.vol_entregado_mm3, 0::numeric) AS volumen_entregado_mm3,
    NULL::numeric AS caudal_promedio_m3s,
    NULL::numeric AS caudal_maximo_m3s,
    v.meses_con_dato AS dias_operacion,
        CASE
            WHEN COALESCE(ac.vol_autorizado, m.vol_autorizado) > 0::numeric
            THEN round(COALESCE(v.vol_entregado_mm3, 0::numeric) / (COALESCE(ac.vol_autorizado, m.vol_autorizado) / 1000.0) * 100::numeric, 2)
            ELSE 0::numeric
        END AS porcentaje_consumido,
    GREATEST(0, CURRENT_DATE - ca.fecha_inicio) AS dias_transcurridos,
    GREATEST(0, ca.fecha_fin - CURRENT_DATE) AS dias_restantes
   FROM ciclos_agricolas ca
     CROSS JOIN modulos m
     LEFT JOIN autorizaciones_ciclo ac ON ac.ciclo_id = ca.id AND ac.modulo_id = m.id
     LEFT JOIN volumen_ciclo_modulo v ON v.ciclo_id = ca.id AND v.modulo_id = m.id
  ORDER BY ca.fecha_inicio DESC, m.nombre;

-- balance_volumen_modulo: la fila PRIMARIA toma el total del ciclo de volumen_ciclo_modulo;
-- las filas de zonas secundarias siguen siendo captura parcial de la zona (no sumar entre zonas).
CREATE OR REPLACE VIEW public.balance_volumen_modulo AS
 WITH base_auth AS (
         SELECT autorizaciones_ciclo.modulo_id, autorizaciones_ciclo.ciclo_id,
            (autorizaciones_ciclo.vol_autorizado * 1000.0) AS vol_base_m3
           FROM autorizaciones_ciclo
        ), zona_primaria AS (
         SELECT modulo_zonas.modulo_id, modulo_zonas.zona_id AS zona_primaria_id
           FROM modulo_zonas WHERE (modulo_zonas.es_primaria = true)
        ), consumo_por_zona AS (
         SELECT em.modulo_id, COALESCE(em.zona_id, zp.zona_primaria_id) AS zona_id, em.ciclo_id,
            sum(em.volumen_m3) FILTER (WHERE (em.tipo_entrega = 'base'::text)) AS vol_base_consumido_m3,
            sum(em.volumen_m3) FILTER (WHERE (em.tipo_entrega = 'adicional'::text)) AS vol_adicional_consumido_m3,
            sum(em.volumen_m3) AS vol_total_consumido_m3,
            max(em.fecha) FILTER (WHERE (em.tipo_entrega = 'adicional'::text)) AS ultimo_adicional_fecha
           FROM (entregas_modulo em LEFT JOIN zona_primaria zp ON ((zp.modulo_id = em.modulo_id)))
          GROUP BY em.modulo_id, COALESCE(em.zona_id, zp.zona_primaria_id), em.ciclo_id
        ), ciclo_activo AS (
         SELECT ciclos_agricolas.id FROM ciclos_agricolas WHERE (ciclos_agricolas.activo = true) LIMIT 1
        ), cons AS (
         SELECT ba.modulo_id, mz.zona_id, mz.es_primaria, ba.ciclo_id, ba.vol_base_m3,
                COALESCE(c.vol_adicional_consumido_m3, 0::numeric) AS adic,
                COALESCE(c.vol_base_consumido_m3, 0::numeric) AS base_cap,
                COALESCE(c.vol_total_consumido_m3, 0::numeric) AS total_cap,
                c.ultimo_adicional_fecha,
                (v.vol_entregado_miles_m3 * 1000.0) AS total_ciclo_m3
           FROM base_auth ba
             JOIN modulo_zonas mz ON mz.modulo_id = ba.modulo_id
             LEFT JOIN consumo_por_zona c ON c.modulo_id = ba.modulo_id AND c.zona_id = mz.zona_id AND c.ciclo_id = ba.ciclo_id
             LEFT JOIN volumen_ciclo_modulo v ON v.modulo_id = ba.modulo_id AND v.ciclo_id = ba.ciclo_id
          WHERE ba.ciclo_id = (SELECT ciclo_activo.id FROM ciclo_activo)
        ), cons2 AS (
         SELECT cons.*,
                CASE WHEN es_primaria AND total_ciclo_m3 IS NOT NULL THEN total_ciclo_m3 ELSE total_cap END AS tot,
                CASE WHEN es_primaria AND total_ciclo_m3 IS NOT NULL THEN GREATEST(total_ciclo_m3 - adic, 0::numeric) ELSE base_cap END AS bas
           FROM cons
        )
 SELECT m.id AS modulo_id, m.nombre AS modulo_nombre, m.codigo_corto, k.zona_id, k.es_primaria,
    zc.codigo AS zona_codigo, zc.nombre AS zona_nombre, k.ciclo_id,
        CASE WHEN k.es_primaria THEN k.vol_base_m3 ELSE NULL::numeric END AS vol_base_m3,
    k.bas AS vol_base_consumido_m3,
    k.adic AS vol_adicional_consumido_m3,
    k.tot AS vol_total_consumido_m3,
        CASE WHEN k.es_primaria THEN (k.vol_base_m3 - k.bas) ELSE NULL::numeric END AS vol_base_disponible_m3,
        CASE WHEN k.es_primaria THEN round(((k.bas / NULLIF(k.vol_base_m3, (0)::numeric)) * (100)::numeric), 2) ELSE NULL::numeric END AS pct_base_consumido,
    k.ultimo_adicional_fecha,
        CASE
            WHEN (NOT k.es_primaria) THEN
            CASE WHEN (k.adic > (0)::numeric) THEN 'adicional_activo'::text ELSE 'normal'::text END
            WHEN (k.bas >= k.vol_base_m3) THEN 'base_agotado'::text
            WHEN (k.bas >= (k.vol_base_m3 * 0.85)) THEN 'alerta_base'::text
            ELSE 'normal'::text
        END AS estado_volumen
   FROM cons2 k
     JOIN modulos m ON m.id = k.modulo_id
     JOIN zonas_canal zc ON k.zona_id = zc.id;

COMMENT ON VIEW public.volumen_ciclo_modulo IS
'ÚNICA FUENTE de volumen autorizado vs entregado por módulo y ciclo (miles de m³). Todo consumidor debe leer de aquí.';
COMMENT ON VIEW public.resumen_ciclo IS
'Compatibilidad: deriva de volumen_ciclo_modulo. La columna vol_autorizado_mm3 está en MILES de m³ (nombre heredado).';
COMMENT ON VIEW public.volumenes_diarios_modulo IS
'OBSOLETA: lee mediciones (0 filas) y modulos.vol_acumulado (0). Usar volumen_ciclo_modulo.';
COMMENT ON VIEW public.balance_volumen_modulo IS
'Detalle operativo por módulo-zona. Fila PRIMARIA = total del ciclo (volumen_ciclo_modulo); secundarias = captura parcial.';
