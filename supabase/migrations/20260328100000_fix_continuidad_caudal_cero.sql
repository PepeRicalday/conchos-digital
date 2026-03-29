-- ============================================================
-- Migración: Fix Continuidad con Caudal Cero
-- Fecha: 2026-03-28
-- Problema: Registros CONTINUA con caudal_promedio=0 por:
--   1. FIX R8 backfill usaba caudal=0 hardcodeado
--   2. fn_generar_continuidad_diaria requiere caudal_promedio > 0
--      → si el día anterior tiene caudal=0 (por backfill), la cadena
--        se rompe permanentemente y el riego parece detenido cuando sigue activo.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- PARTE 1: BACKFILL — Recuperar caudal real en CONTINUA con caudal=0
-- ════════════════════════════════════════════════════════════
-- Para cada registro CONTINUA con caudal=0, busca el último caudal_promedio > 0
-- del mismo punto_id en cualquier fecha anterior. Solo aplica si el punto
-- tiene al menos un registro con caudal real (no rellena puntos que nunca
-- tuvieron flujo real).

UPDATE public.reportes_operacion ro
SET
    caudal_promedio = sub.ultimo_caudal_real,
    origen          = 'cron',
    actualizado_en  = timezone('utc'::text, now())
FROM (
    SELECT
        ro2.id,
        (
            SELECT p.caudal_promedio
            FROM public.reportes_operacion p
            WHERE p.punto_id = ro2.punto_id
              AND p.caudal_promedio > 0
              AND p.fecha <= ro2.fecha
            ORDER BY p.fecha DESC, p.hora_apertura DESC NULLS LAST
            LIMIT 1
        ) AS ultimo_caudal_real
    FROM public.reportes_operacion ro2
    WHERE ro2.estado = 'continua'
      AND ro2.caudal_promedio = 0
) sub
WHERE ro.id = sub.id
  AND sub.ultimo_caudal_real IS NOT NULL
  AND sub.ultimo_caudal_real > 0;


-- ════════════════════════════════════════════════════════════
-- PARTE 2: FIX fn_generar_continuidad_diaria
-- ════════════════════════════════════════════════════════════
-- Cambios:
--   A. Elimina la condición "AND caudal_promedio > 0" que bloqueaba la propagación.
--   B. Usa COALESCE para buscar el último caudal real cuando el de ayer es 0.
--   C. Solo genera continuidad si existe al menos un caudal real previo (evita
--      crear fantasmas para tomas que nunca han tenido flujo real).

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
    -- Busca reportes que terminaron abiertos ayer.
    -- Si caudal_promedio = 0 (backfill), busca el último caudal real del mismo punto.
    FOR r IN
        SELECT
            ro.punto_id,
            COALESCE(
                NULLIF(ro.caudal_promedio, 0),
                (
                    SELECT p.caudal_promedio
                    FROM public.reportes_operacion p
                    WHERE p.punto_id = ro.punto_id
                      AND p.caudal_promedio > 0
                      AND p.fecha <= fecha_ayer
                    ORDER BY p.fecha DESC, p.hora_apertura DESC NULLS LAST
                    LIMIT 1
                )
            ) AS caudal_promedio,
            ro.ciclo_id
        FROM public.reportes_operacion ro
        WHERE ro.fecha = fecha_ayer
          AND ro.estado::text NOT IN ('cierre', 'suspension')
          AND (
              -- Tiene caudal propio, O existe algún caudal real anterior
              ro.caudal_promedio > 0
              OR EXISTS (
                  SELECT 1 FROM public.reportes_operacion p
                  WHERE p.punto_id = ro.punto_id
                    AND p.caudal_promedio > 0
                    AND p.fecha <= fecha_ayer
              )
          )
    LOOP
        -- Solo propagar si se encontró un caudal real (no generar con 0)
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

        -- 2. Crear reporte de Hoy (Continua) con el caudal real recuperado
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
            -- Si ya existe (ej. operador ya capturó hoy), no sobreescribir
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

        -- 3. Inyectar medición virtual de medianoche con etiqueta 'continua'
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
    -- Sin cambios — las escalas no tienen problema de caudal=0
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

-- Cuántos CONTINUA tenían caudal=0 y ahora tienen valor real (post-backfill PARTE 1)
SELECT
    estado,
    origen,
    count(*)                                              AS total,
    count(*) FILTER (WHERE caudal_promedio = 0)           AS caudal_cero,
    count(*) FILTER (WHERE caudal_promedio > 0)           AS caudal_real,
    ROUND(AVG(caudal_promedio)::numeric, 4)               AS caudal_promedio_avg
FROM public.reportes_operacion
WHERE estado = 'continua'
GROUP BY estado, origen
ORDER BY origen;
