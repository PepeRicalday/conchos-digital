-- ============================================================
-- DIAGNÓSTICO DE INTEGRIDAD LÓGICA — SICA 005
-- Fecha: 2026-03-25
-- Reglas de negocio validadas:
--   R1. Ningún registro puede cerrarse sin estar abierto primero
--   R2. Ningún registro puede tener fecha posterior a hoy
--   R3. hora_cierre no puede ser anterior a hora_apertura
--   R4. Un cierre debe tener hora_cierre; un no-cierre no debe tenerla
--   R5. No pueden existir dos registros abiertos para el mismo punto en el mismo día
--   R6. El primer evento de un ciclo debe ser 'inicio' o 'reabierto'
--   R7. 'continua' o 'modificacion' no pueden existir sin un 'inicio' previo
--   R8. No puede haber brechas en la cadena de continuidad (día N abierto → día N+1 debe existir)
--   R9. Caudal y volumen no pueden ser negativos
--   R10. Mediciones huérfanas (punto_id no registrado en puntos_entrega)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- CHECK 1 — FECHAS FUTURAS
-- Ningún registro puede tener fecha posterior a hoy (CURRENT_DATE)
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R2: Fecha futura' AS regla,
    id::text,
    punto_id,
    fecha::text AS detalle,
    estado::text AS estado
FROM public.reportes_operacion
WHERE fecha > CURRENT_DATE

UNION ALL

SELECT
    'mediciones',
    'R2: Timestamp futuro',
    id::text,
    punto_id,
    fecha_hora::text,
    estado_evento::text
FROM public.mediciones
WHERE fecha_hora > now()

UNION ALL

SELECT
    'reportes_operacion',
    'R2: hora_apertura futura',
    id::text,
    punto_id,
    hora_apertura::text,
    estado::text
FROM public.reportes_operacion
WHERE hora_apertura > now()

UNION ALL

SELECT
    'reportes_operacion',
    'R2: hora_cierre futura',
    id::text,
    punto_id,
    hora_cierre::text,
    estado::text
FROM public.reportes_operacion
WHERE hora_cierre > now();


-- ──────────────────────────────────────────────────────────────
-- CHECK 2 — CIERRE SIN APERTURA PREVIA (por ciclo de punto)
-- Un punto no puede tener su primer evento como 'cierre'
-- ──────────────────────────────────────────────────────────────
WITH primer_evento AS (
    SELECT DISTINCT ON (punto_id)
        punto_id,
        fecha,
        estado,
        hora_apertura,
        id
    FROM public.reportes_operacion
    ORDER BY punto_id, fecha ASC, hora_apertura ASC
)
SELECT
    'reportes_operacion' AS tabla,
    'R1+R6: Primer evento es cierre/suspension sin apertura previa' AS regla,
    pe.id::text,
    pe.punto_id,
    pe.fecha::text AS detalle,
    pe.estado::text AS estado
FROM primer_evento pe
WHERE pe.estado IN ('cierre', 'suspension', 'continua', 'modificacion');


-- ──────────────────────────────────────────────────────────────
-- CHECK 3 — CONTINUA O MODIFICACION SIN INICIO PREVIO
-- Un punto en estado 'continua'/'modificacion' debe tener
-- al menos un 'inicio' o 'reabierto' anterior
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R7: continua/modificacion sin inicio previo' AS regla,
    ro.id::text,
    ro.punto_id,
    ro.fecha::text AS detalle,
    ro.estado::text AS estado
FROM public.reportes_operacion ro
WHERE ro.estado IN ('continua', 'modificacion')
  AND NOT EXISTS (
      SELECT 1 FROM public.reportes_operacion prev
      WHERE prev.punto_id = ro.punto_id
        AND prev.fecha < ro.fecha
        AND prev.estado IN ('inicio', 'reabierto')
  );


-- ──────────────────────────────────────────────────────────────
-- CHECK 4 — HORA_CIERRE ANTERIOR A HORA_APERTURA (inversión lógica)
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R3: hora_cierre < hora_apertura' AS regla,
    id::text,
    punto_id,
    ('apertura: ' || hora_apertura::text || ' | cierre: ' || hora_cierre::text) AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE hora_cierre IS NOT NULL
  AND hora_apertura IS NOT NULL
  AND hora_cierre < hora_apertura;


-- ──────────────────────────────────────────────────────────────
-- CHECK 5 — ESTADO 'CIERRE' SIN hora_cierre
-- Todo registro cerrado debe tener timestamp de cierre
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R4: estado=cierre pero hora_cierre es NULL' AS regla,
    id::text,
    punto_id,
    fecha::text AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE estado = 'cierre'
  AND hora_cierre IS NULL;


-- ──────────────────────────────────────────────────────────────
-- CHECK 6 — REGISTRO ABIERTO CON hora_cierre SETEADA
-- Un registro activo (inicio/continua/modificacion/reabierto)
-- no debería tener hora_cierre
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R4: registro abierto con hora_cierre seteada' AS regla,
    id::text,
    punto_id,
    ('fecha: ' || fecha::text || ' | hora_cierre: ' || hora_cierre::text) AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
  AND hora_cierre IS NOT NULL;


-- ──────────────────────────────────────────────────────────────
-- CHECK 7 — DOS REGISTROS ABIERTOS EN EL MISMO DÍA PARA EL MISMO PUNTO
-- Violación del constraint UNIQUE(punto_id, fecha) de facto
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R5: Múltiples registros abiertos mismo punto+fecha' AS regla,
    punto_id,
    fecha::text AS detalle,
    string_agg(estado::text, ', ' ORDER BY hora_apertura) AS estado,
    count(*)::text AS num_registros
FROM public.reportes_operacion
WHERE estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
GROUP BY punto_id, fecha
HAVING count(*) > 1;


-- ──────────────────────────────────────────────────────────────
-- CHECK 8 — BRECHA EN CADENA DE CONTINUIDAD
-- Un punto con estado abierto en día N pero SIN ningún registro en día N+1
-- indica que el cron falló o hay un hueco en la cadena
-- (Solo para días pasados, excluye el día de hoy)
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R8: Brecha de continuidad — falta registro en día siguiente' AS regla,
    ro.id::text,
    ro.punto_id,
    ('día ' || ro.fecha::text || ' abierto, pero ' || (ro.fecha + 1)::text || ' no existe') AS detalle,
    ro.estado::text
FROM public.reportes_operacion ro
WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
  AND ro.fecha < CURRENT_DATE  -- Solo días pasados
  AND NOT EXISTS (
      SELECT 1 FROM public.reportes_operacion siguiente
      WHERE siguiente.punto_id = ro.punto_id
        AND siguiente.fecha = ro.fecha + 1
  );


-- ──────────────────────────────────────────────────────────────
-- CHECK 9 — VALORES NEGATIVOS (caudal / volumen)
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R9: caudal_promedio negativo' AS regla,
    id::text,
    punto_id,
    caudal_promedio::text AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE caudal_promedio < 0

UNION ALL

SELECT
    'reportes_operacion',
    'R9: volumen_acumulado negativo',
    id::text,
    punto_id,
    volumen_acumulado::text,
    estado::text
FROM public.reportes_operacion
WHERE volumen_acumulado < 0

UNION ALL

SELECT
    'mediciones',
    'R9: valor_q negativo',
    id::text,
    punto_id,
    valor_q::text,
    estado_evento::text
FROM public.mediciones
WHERE valor_q < 0;


-- ──────────────────────────────────────────────────────────────
-- CHECK 10 — REGISTROS HUÉRFANOS (punto_id no existe en puntos_entrega)
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'R10: punto_id huérfano (no existe en puntos_entrega)' AS regla,
    id::text,
    punto_id,
    fecha::text AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE NOT EXISTS (
    SELECT 1 FROM public.puntos_entrega pe WHERE pe.id = punto_id
)

UNION ALL

SELECT
    'mediciones',
    'R10: punto_id huérfano',
    id::text,
    punto_id,
    fecha_hora::text,
    estado_evento::text
FROM public.mediciones
WHERE NOT EXISTS (
    SELECT 1 FROM public.puntos_entrega pe WHERE pe.id = punto_id
);


-- ──────────────────────────────────────────────────────────────
-- CHECK 11 — REGISTRO DE CIERRE CUYA FECHA DIFIERE DEL DÍA
--            EN QUE OCURRIÓ EL CIERRE REAL (hora_cierre)
-- Ej: fecha=2026-03-18 pero hora_cierre corresponde al día 17
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'Timezone mismatch: hora_cierre no corresponde a fecha+1' AS regla,
    id::text,
    punto_id,
    ('fecha: ' || fecha::text || ' | hora_cierre local: '
      || (hora_cierre AT TIME ZONE 'America/Chihuahua')::text) AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE hora_cierre IS NOT NULL
  AND estado = 'cierre'
  AND (hora_cierre AT TIME ZONE 'America/Chihuahua')::date != fecha + 1;


-- ──────────────────────────────────────────────────────────────
-- CHECK 12 — HORA_APERTURA NO COINCIDE CON MEDIANOCHE LOCAL
--            EN REGISTROS AUTOMÁTICOS ('continua')
-- continua debería abrir siempre a las 00:00 Chihuahua
-- ──────────────────────────────────────────────────────────────
SELECT
    'reportes_operacion' AS tabla,
    'Hora apertura de continua no es medianoche local' AS regla,
    id::text,
    punto_id,
    ('apertura UTC: ' || hora_apertura::text || ' → local: '
      || (hora_apertura AT TIME ZONE 'America/Chihuahua')::text) AS detalle,
    estado::text
FROM public.reportes_operacion
WHERE estado = 'continua'
  AND hora_apertura IS NOT NULL
  AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') != 0;


-- ──────────────────────────────────────────────────────────────
-- CHECK 13 — MEDICIÓN CON estado_evento='cierre' PERO EL REPORTE
--            DEL DÍA NO ESTÁ EN 'cierre'
-- Inconsistencia entre la tabla de eventos y el reporte agregado
-- ──────────────────────────────────────────────────────────────
SELECT
    'mediciones' AS tabla,
    'Medición cierre pero reporte del día no cerrado' AS regla,
    m.id::text,
    m.punto_id,
    m.fecha_hora::text AS detalle,
    ro.estado::text AS estado_reporte
FROM public.mediciones m
JOIN public.reportes_operacion ro
    ON ro.punto_id = m.punto_id
    AND ro.fecha = (m.fecha_hora AT TIME ZONE 'America/Chihuahua')::date
WHERE m.estado_evento = 'cierre'
  AND ro.estado != 'cierre';


-- ──────────────────────────────────────────────────────────────
-- RESUMEN EJECUTIVO — Conteo de anomalías por tipo
-- Ejecutar esto último para tener el panorama completo
-- ──────────────────────────────────────────────────────────────
WITH anomalias AS (
    -- R2 Fechas futuras
    SELECT 'R2: Fecha futura en reportes_operacion' AS tipo, count(*) AS total
    FROM public.reportes_operacion WHERE fecha > CURRENT_DATE
    UNION ALL
    SELECT 'R2: Timestamp futuro en mediciones', count(*)
    FROM public.mediciones WHERE fecha_hora > now()
    UNION ALL
    -- R1+R6 Primer evento incorrecto
    SELECT 'R1+R6: Primer evento no es inicio/reabierto', count(*) FROM (
        SELECT DISTINCT ON (punto_id) punto_id, estado
        FROM public.reportes_operacion
        ORDER BY punto_id, fecha ASC, hora_apertura ASC
    ) t WHERE estado IN ('cierre', 'suspension', 'continua', 'modificacion')
    UNION ALL
    -- R7 Sin inicio previo
    SELECT 'R7: continua/modificacion sin inicio previo', count(*)
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('continua', 'modificacion')
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion prev
          WHERE prev.punto_id = ro.punto_id AND prev.fecha < ro.fecha
            AND prev.estado IN ('inicio', 'reabierto')
      )
    UNION ALL
    -- R3 Inversión de timestamps
    SELECT 'R3: hora_cierre < hora_apertura', count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND hora_apertura IS NOT NULL AND hora_cierre < hora_apertura
    UNION ALL
    -- R4a Cierre sin hora_cierre
    SELECT 'R4: estado=cierre sin hora_cierre', count(*)
    FROM public.reportes_operacion WHERE estado = 'cierre' AND hora_cierre IS NULL
    UNION ALL
    -- R4b Abierto con hora_cierre
    SELECT 'R4: abierto con hora_cierre seteada', count(*)
    FROM public.reportes_operacion
    WHERE estado IN ('inicio', 'continua', 'modificacion', 'reabierto') AND hora_cierre IS NOT NULL
    UNION ALL
    -- R8 Brechas de continuidad
    SELECT 'R8: Brechas en cadena de continuidad', count(*)
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
      AND ro.fecha < CURRENT_DATE
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion s
          WHERE s.punto_id = ro.punto_id AND s.fecha = ro.fecha + 1
      )
    UNION ALL
    -- R9 Valores negativos
    SELECT 'R9: Valores negativos (caudal/volumen)', count(*)
    FROM public.reportes_operacion
    WHERE caudal_promedio < 0 OR volumen_acumulado < 0
    UNION ALL
    -- R10 Huérfanos
    SELECT 'R10: Registros huérfanos sin punto_id válido', count(*)
    FROM public.reportes_operacion
    WHERE NOT EXISTS (SELECT 1 FROM public.puntos_entrega pe WHERE pe.id = punto_id)
    UNION ALL
    -- Timezone mismatch
    SELECT 'Mismatch: hora_cierre no coincide con fecha+1', count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND estado = 'cierre'
      AND (hora_cierre AT TIME ZONE 'America/Chihuahua')::date != fecha + 1
    UNION ALL
    -- Continua no a medianoche
    SELECT 'Mismatch: apertura de continua no es medianoche local', count(*)
    FROM public.reportes_operacion
    WHERE estado = 'continua' AND hora_apertura IS NOT NULL
      AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') != 0
)
SELECT tipo, total,
    CASE WHEN total = 0 THEN '✓ OK' ELSE '✗ PROBLEMA' END AS resultado
FROM anomalias
ORDER BY total DESC, tipo;
