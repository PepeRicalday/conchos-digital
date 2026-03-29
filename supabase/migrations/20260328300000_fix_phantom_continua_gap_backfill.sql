-- ============================================================
-- Migración: Fix CONTINUA Fantasma + Backfill de Días Faltantes
-- Fecha: 2026-03-28
--
-- Problemas corregidos:
--   BUG-3: CONTINUA después de CIERRE sin nuevo INICIO/REABIERTO
--           → registros fantasma creados por backfill R8, luego con caudal
--             asignado por PARTE 1 de migración 20260328100000.
--           → Directa K-58+600: CIERRE 24-mar, CONTINUA 25/26/27-mar (incorrecto)
--
--   BUG-4: Días faltantes en cadena de continuidad (cron no ejecutó)
--           → GRANJA K-0+541: INICIO 24-mar, salto a 27-mar (falta 25/26-mar)
--           → Aplica backfill genérico para cualquier punto con gaps.
--
--   BUG-5: fn_generar_continuidad_diaria COALESCE sin límite de ciclo
--           → la subquery p.fecha <= fecha_ayer podía encontrar caudal de
--             ANTES de un CIERRE pasado, propagando valores de ciclos muertos.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1: ELIMINAR CONTINUA FANTASMA DESPUÉS DE CIERRE
-- ════════════════════════════════════════════════════════════
-- Un CONTINUA es fantasma si el último evento no-continua anterior a él
-- es un CIERRE o SUSPENSIÓN (sin nuevo INICIO/REABIERTO que lo reabra).

-- Paso 1a: Marcar las mediciones virtuales de medianoche correspondientes
-- a esos días fantasma para poder borrarlas en cascada si hace falta.
-- (solo las mediciones con estado_evento='continua' e inserted by cron)

-- Paso 1b: Borrar los reportes_operacion fantasma
DELETE FROM public.reportes_operacion ro
WHERE ro.estado = 'continua'
  AND (
      SELECT prev.estado
      FROM public.reportes_operacion prev
      WHERE prev.punto_id = ro.punto_id
        AND prev.fecha < ro.fecha
        AND prev.estado::text NOT IN ('continua')
      ORDER BY prev.fecha DESC, prev.hora_apertura DESC NULLS LAST
      LIMIT 1
  )::text IN ('cierre', 'suspension');


-- Paso 1c: Borrar mediciones virtuales de medianoche para días que ya no
-- tienen reporte (las generó el mismo cron con notas='Rollover' y q = valor previo).
-- Solo borramos las del cron (notas contiene 'Continuidad de medianoche').
DELETE FROM public.mediciones m
WHERE m.estado_evento = 'continua'
  AND m.notas ILIKE '%Continuidad de medianoche%'
  AND NOT EXISTS (
      SELECT 1 FROM public.reportes_operacion ro
      WHERE ro.punto_id = m.punto_id
        AND ro.fecha = (m.fecha_hora AT TIME ZONE 'America/Chihuahua')::date
  );


-- ════════════════════════════════════════════════════════════
-- PARTE 2: BACKFILL — DÍAS FALTANTES EN CADENA ABIERTA
-- ════════════════════════════════════════════════════════════
-- Para cada punto con un ciclo abierto, detecta días sin reporte donde
-- el día anterior tenía un reporte abierto. Crea CONTINUA retroactivo.

DO $$
DECLARE
    r            RECORD;
    gap_date     DATE;
    prev_rec     RECORD;
    midnight_at  TIMESTAMP WITH TIME ZONE;
    cycle_start  DATE;
    caudal_real  NUMERIC;
BEGIN
    -- Iterar sobre puntos que tienen al menos un reporte abierto en los
    -- últimos 30 días (para no procesar puntos inactivos)
    FOR r IN
        SELECT DISTINCT punto_id
        FROM public.reportes_operacion
        WHERE fecha >= CURRENT_DATE - 30
          AND estado::text NOT IN ('cierre', 'suspension')
        ORDER BY punto_id
    LOOP
        -- Buscar el inicio del ciclo actual (último INICIO o REABIERTO)
        SELECT fecha INTO cycle_start
        FROM public.reportes_operacion
        WHERE punto_id = r.punto_id
          AND estado::text IN ('inicio', 'reabierto')
        ORDER BY fecha DESC, hora_apertura DESC NULLS LAST
        LIMIT 1;

        IF cycle_start IS NULL THEN
            CONTINUE;
        END IF;

        -- Recorrer todos los días desde cycle_start hasta ayer
        FOR gap_date IN
            SELECT d::date
            FROM generate_series(cycle_start, CURRENT_DATE - 1, '1 day'::interval) d
        LOOP
            -- Saltar si ya existe un reporte ese día
            IF EXISTS (
                SELECT 1 FROM public.reportes_operacion
                WHERE punto_id = r.punto_id AND fecha = gap_date
            ) THEN
                CONTINUE;
            END IF;

            -- Buscar el reporte abierto del día anterior
            SELECT * INTO prev_rec
            FROM public.reportes_operacion
            WHERE punto_id = r.punto_id
              AND fecha = gap_date - 1
              AND estado::text NOT IN ('cierre', 'suspension');

            IF NOT FOUND THEN
                CONTINUE; -- cadena rota, no propagar
            END IF;

            -- Usar el último caudal real del ciclo actual
            SELECT caudal_promedio INTO caudal_real
            FROM public.reportes_operacion
            WHERE punto_id = r.punto_id
              AND caudal_promedio > 0
              AND fecha >= cycle_start
              AND fecha <= gap_date
            ORDER BY fecha DESC, hora_apertura DESC NULLS LAST
            LIMIT 1;

            IF caudal_real IS NULL OR caudal_real = 0 THEN
                CONTINUE; -- sin caudal real, no crear fantasma
            END IF;

            midnight_at := gap_date AT TIME ZONE 'America/Chihuahua';

            -- Insertar CONTINUA retroactivo
            INSERT INTO public.reportes_operacion (
                punto_id, fecha, estado, caudal_promedio,
                num_mediciones, hora_apertura, volumen_acumulado,
                ciclo_id, origen
            ) VALUES (
                r.punto_id,
                gap_date,
                'continua',
                caudal_real,
                1,
                midnight_at,
                0,
                prev_rec.ciclo_id,
                'cron'
            ) ON CONFLICT (punto_id, fecha) DO NOTHING;

            -- Inyectar medición virtual de medianoche (solo si no existe ya)
            INSERT INTO public.mediciones (
                punto_id, valor_q, fecha_hora, estado_evento, notas
            ) VALUES (
                r.punto_id,
                caudal_real,
                midnight_at,
                'continua',
                'Evento automático: Continuidad de medianoche (Rollover) [backfill]'
            ) ON CONFLICT DO NOTHING;

        END LOOP;
    END LOOP;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- PARTE 3: FIX fn_generar_continuidad_diaria — COALESCE CON LÍMITE DE CICLO
-- ════════════════════════════════════════════════════════════
-- La subquery COALESCE buscaba caudal_promedio > 0 en cualquier fecha
-- anterior al día de ayer, cruzando ciclos pasados (CIERRE → nuevo INICIO).
-- Ahora se acota a fechas >= último INICIO/REABIERTO del mismo punto.

CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    local_now   TIMESTAMP := timezone('America/Chihuahua'::text, now());
    fecha_ayer  DATE      := (local_now - INTERVAL '1 day')::date;
    fecha_hoy   DATE      := local_now::date;
    midnight_at TIMESTAMP WITH TIME ZONE := fecha_hoy AT TIME ZONE 'America/Chihuahua';
BEGIN
    -- ── A. CONTINUIDAD DE TOMAS (reportes_operacion) ──────────────────────────
    FOR r IN
        SELECT
            ro.punto_id,
            COALESCE(
                NULLIF(ro.caudal_promedio, 0),
                (
                    -- Buscar último caudal real DENTRO DEL CICLO ACTUAL
                    -- (no cruzar hacia ciclos anteriores al último INICIO/REABIERTO)
                    SELECT p.caudal_promedio
                    FROM public.reportes_operacion p
                    WHERE p.punto_id = ro.punto_id
                      AND p.caudal_promedio > 0
                      AND p.fecha <= fecha_ayer
                      AND p.fecha >= COALESCE(
                          (
                              SELECT MAX(q.fecha)
                              FROM public.reportes_operacion q
                              WHERE q.punto_id = ro.punto_id
                                AND q.estado::text IN ('inicio', 'reabierto')
                                AND q.fecha <= fecha_ayer
                          ),
                          '2000-01-01'::date
                      )
                    ORDER BY p.fecha DESC, p.hora_apertura DESC NULLS LAST
                    LIMIT 1
                )
            ) AS caudal_promedio,
            ro.ciclo_id
        FROM public.reportes_operacion ro
        WHERE ro.fecha = fecha_ayer
          AND ro.estado::text NOT IN ('cierre', 'suspension')
          AND (
              ro.caudal_promedio > 0
              OR EXISTS (
                  SELECT 1 FROM public.reportes_operacion p
                  WHERE p.punto_id = ro.punto_id
                    AND p.caudal_promedio > 0
                    AND p.fecha <= fecha_ayer
                    AND p.fecha >= COALESCE(
                        (
                            SELECT MAX(q.fecha)
                            FROM public.reportes_operacion q
                            WHERE q.punto_id = ro.punto_id
                              AND q.estado::text IN ('inicio', 'reabierto')
                              AND q.fecha <= fecha_ayer
                        ),
                        '2000-01-01'::date
                    )
              )
          )
    LOOP
        IF r.caudal_promedio IS NULL OR r.caudal_promedio = 0 THEN
            CONTINUE;
        END IF;

        -- 1. Cerrar reporte de Ayer
        UPDATE public.reportes_operacion
        SET estado         = 'cierre',
            hora_cierre    = midnight_at,
            actualizado_en = timezone('utc'::text, now())
        WHERE punto_id = r.punto_id
          AND fecha    = fecha_ayer
          AND estado::text NOT IN ('cierre', 'suspension');

        -- 2. Crear reporte de Hoy (Continua)
        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, caudal_promedio,
            num_mediciones, hora_apertura, volumen_acumulado, ciclo_id, origen
        ) VALUES (
            r.punto_id,
            fecha_hoy,
            'continua',
            r.caudal_promedio,
            1,
            midnight_at,
            0,
            r.ciclo_id,
            'cron'
        ) ON CONFLICT (punto_id, fecha) DO UPDATE
            SET caudal_promedio = CASE
                    WHEN public.reportes_operacion.caudal_promedio = 0
                    THEN EXCLUDED.caudal_promedio
                    ELSE public.reportes_operacion.caudal_promedio
                END,
                origen = CASE
                    WHEN public.reportes_operacion.origen = 'operador'
                    THEN 'operador'
                    ELSE 'cron'
                END;

        -- 3. Inyectar medición virtual de medianoche
        INSERT INTO public.mediciones (
            punto_id, valor_q, fecha_hora, estado_evento, notas
        ) VALUES (
            r.punto_id,
            r.caudal_promedio,
            midnight_at,
            'continua',
            'Evento automático: Continuidad de medianoche (Rollover)'
        ) ON CONFLICT DO NOTHING;
    END LOOP;

    -- ── B. CONTINUIDAD DE ESCALAS (lecturas_escalas) ──────────────────────────
    FOR r IN
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = fecha_ayer
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id
        ) VALUES (
            gen_random_uuid(),
            r.escala_id,
            fecha_hoy,
            'am',
            r.nivel_m,
            '00:00:00',
            'SICA Chronos',
            'Autogenerado (Continuidad de Medianoche)',
            r.ciclo_id
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ════════════════════════════════════════════════════════════

-- 1. Verificar que no quedan CONTINUA después de CIERRE sin INICIO
SELECT
    ro.punto_id,
    ro.fecha,
    ro.estado,
    ro.caudal_promedio,
    (
        SELECT prev.estado
        FROM public.reportes_operacion prev
        WHERE prev.punto_id = ro.punto_id
          AND prev.fecha < ro.fecha
          AND prev.estado::text != 'continua'
        ORDER BY prev.fecha DESC LIMIT 1
    ) AS estado_previo
FROM public.reportes_operacion ro
WHERE ro.estado = 'continua'
  AND (
      SELECT prev.estado
      FROM public.reportes_operacion prev
      WHERE prev.punto_id = ro.punto_id
        AND prev.fecha < ro.fecha
        AND prev.estado::text != 'continua'
      ORDER BY prev.fecha DESC LIMIT 1
  )::text IN ('cierre', 'suspension')
ORDER BY ro.punto_id, ro.fecha;

-- 2. Verificar días llenos para Directa K-58+600 y GRANJA K-0+541
SELECT punto_id, fecha, estado, caudal_promedio, origen
FROM public.reportes_operacion
WHERE punto_id IN (
    SELECT id FROM public.puntos_entrega
    WHERE nombre ILIKE '%K-58+600%' OR nombre ILIKE '%GRANJA%'
)
ORDER BY punto_id, fecha DESC
LIMIT 30;
