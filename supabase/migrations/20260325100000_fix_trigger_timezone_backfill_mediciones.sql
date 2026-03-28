-- ============================================================
-- Migración: Fix Timezone en Trigger + Backfill Mediciones Faltantes
-- Fecha: 2026-03-25
-- Problemas resueltos:
--   1. gestionar_evento_riego usaba date_trunc UTC para midnight_timestamp
--      → hora_cierre en reportes_operacion quedaba 6h adelantada (00:00 UTC ≠ 00:00 Chihuahua)
--   2. fn_generar_continuidad_diaria solo procesaba 1 día hacia atrás
--      → si el cron fallaba una noche, los días sin cobertura no recuperaban su medición
--   3. Backfill: mediciones faltantes para días 2026-03-19 a 2026-03-24
-- ============================================================


-- ── 1. FIX TRIGGER: midnight_timestamp corregido a hora local Chihuahua ──────

CREATE OR REPLACE FUNCTION public.gestionar_evento_riego()
RETURNS trigger AS $$
DECLARE
    prev_medicion RECORD;
    delta_t_segundos NUMERIC;
    vol_prev_m3 NUMERIC := 0;
    vol_hoy_m3 NUMERIC := 0;
    fecha_prev DATE;
    fecha_hoy DATE;
    midnight_timestamp TIMESTAMP WITH TIME ZONE;
    report_id TEXT;
    q_anterior NUMERIC;
BEGIN
    -- Fecha en timezone local Chihuahua para evitar desfase UTC
    fecha_hoy := (NEW.fecha_hora AT TIME ZONE 'America/Chihuahua')::date;

    -- Medición anterior para calcular volumen acumulado
    SELECT * INTO prev_medicion
    FROM public.mediciones
    WHERE punto_id = NEW.punto_id
      AND id != NEW.id
      AND fecha_hora < NEW.fecha_hora
    ORDER BY fecha_hora DESC
    LIMIT 1;

    IF FOUND AND prev_medicion.valor_q > 0 THEN
        fecha_prev := (prev_medicion.fecha_hora AT TIME ZONE 'America/Chihuahua')::date;

        IF fecha_prev = fecha_hoy THEN
            vol_hoy_m3 := COALESCE(NEW.valor_vol, 0);
        ELSE
            -- Cruce de medianoche: midnight en hora local Chihuahua expresado como TIMESTAMPTZ
            midnight_timestamp := fecha_hoy AT TIME ZONE 'America/Chihuahua';

            delta_t_segundos := EXTRACT(EPOCH FROM (midnight_timestamp - prev_medicion.fecha_hora));
            IF delta_t_segundos > 0 THEN
                vol_prev_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;

            delta_t_segundos := EXTRACT(EPOCH FROM (NEW.fecha_hora - midnight_timestamp));
            IF delta_t_segundos > 0 THEN
                vol_hoy_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;
        END IF;
    ELSE
        vol_hoy_m3 := 0;
    END IF;

    -- Cerrar reporte de día anterior si hubo cruce de medianoche
    IF vol_prev_m3 > 0 THEN
        UPDATE public.reportes_operacion
        SET volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_prev_m3 / 1000000.0),
            estado = 'cierre',
            hora_cierre = midnight_timestamp,
            actualizado_en = timezone('utc'::text, now())
        WHERE punto_id = NEW.punto_id AND fecha = fecha_prev;
    END IF;

    -- Crear o actualizar reporte de hoy
    SELECT id::text, caudal_promedio INTO report_id, q_anterior
    FROM public.reportes_operacion
    WHERE punto_id = NEW.punto_id AND fecha = fecha_hoy;

    IF report_id IS NULL THEN
        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones, hora_apertura
        ) VALUES (
            NEW.punto_id,
            fecha_hoy,
            CASE
                WHEN NEW.estado_evento IS NOT NULL THEN NEW.estado_evento::estado_reporte
                WHEN NEW.valor_q > 0 THEN 'inicio'::estado_reporte
                ELSE 'suspension'::estado_reporte
            END,
            (vol_hoy_m3 / 1000000.0),
            NEW.valor_q,
            1,
            NEW.fecha_hora
        );
    ELSE
        UPDATE public.reportes_operacion
        SET
            volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_hoy_m3 / 1000000.0),
            caudal_promedio = NEW.valor_q,
            num_mediciones = num_mediciones + 1,
            actualizado_en = timezone('utc'::text, now()),
            estado = CASE
                WHEN NEW.estado_evento = 'cierre' THEN 'cierre'::estado_reporte
                WHEN NEW.estado_evento = 'suspension' THEN 'suspension'::estado_reporte
                WHEN NEW.valor_q = 0 THEN 'suspension'::estado_reporte
                WHEN NEW.valor_q != q_anterior THEN 'modificacion'::estado_reporte
                ELSE estado
            END
        WHERE id::text = report_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-adjuntar trigger
DROP TRIGGER IF EXISTS trigger_registrar_evento_riego ON public.mediciones;
CREATE TRIGGER trigger_registrar_evento_riego
AFTER INSERT ON public.mediciones
FOR EACH ROW
EXECUTE FUNCTION public.gestionar_evento_riego();


-- ── 2. FIX fn_generar_continuidad_diaria: BACKFILL multi-día ─────────────────
-- Si el cron falla una o más noches, esta versión recupera todos los días
-- faltantes en lugar de solo el día anterior.

CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    d RECORD;
    local_now       TIMESTAMP       := timezone('America/Chihuahua'::text, now());
    fecha_hoy       DATE            := local_now::date;
    midnight_hoy    TIMESTAMPTZ     := fecha_hoy AT TIME ZONE 'America/Chihuahua';
    fecha_iter      DATE;
    midnight_iter   TIMESTAMPTZ;
    q_carry         NUMERIC;
    ciclo_carry     TEXT;
    last_open_fecha DATE;
BEGIN
    -- ── A. CONTINUIDAD DE TOMAS (reportes_operacion) ──────────────────────────
    -- Para cada punto que tenga algún reporte abierto en los últimos 30 días,
    -- verificar si hay brechas y rellenarlas día a día.
    FOR r IN
        SELECT DISTINCT ON (punto_id) punto_id, fecha, estado, caudal_promedio, ciclo_id
        FROM public.reportes_operacion
        WHERE fecha >= (fecha_hoy - INTERVAL '30 days')
          AND estado::text NOT IN ('cierre', 'suspension')
          AND caudal_promedio > 0
        ORDER BY punto_id, fecha DESC
    LOOP
        last_open_fecha := r.fecha;
        q_carry         := r.caudal_promedio;
        ciclo_carry     := r.ciclo_id;

        -- Iterar desde el día siguiente al último reporte abierto hasta hoy
        fecha_iter := last_open_fecha + 1;
        WHILE fecha_iter <= fecha_hoy LOOP
            midnight_iter := fecha_iter AT TIME ZONE 'America/Chihuahua';

            -- 1. Cerrar el día anterior
            UPDATE public.reportes_operacion
            SET estado = 'cierre',
                hora_cierre = midnight_iter,
                actualizado_en = timezone('utc'::text, now())
            WHERE punto_id = r.punto_id AND fecha = (fecha_iter - 1)
              AND estado::text NOT IN ('cierre', 'suspension');

            -- 2. Crear el reporte del día si no existe
            INSERT INTO public.reportes_operacion (
                punto_id, fecha, estado, caudal_promedio, num_mediciones,
                hora_apertura, volumen_acumulado, ciclo_id
            ) VALUES (
                r.punto_id, fecha_iter, 'continua', q_carry, 1,
                midnight_iter, 0, ciclo_carry
            ) ON CONFLICT (punto_id, fecha) DO NOTHING;

            -- 3. Inyectar medición de medianoche con estado_evento = 'continua'
            INSERT INTO public.mediciones (
                punto_id, valor_q, fecha_hora, estado_evento, notas
            ) VALUES (
                r.punto_id, q_carry, midnight_iter, 'continua',
                'Evento automático: Continuidad de medianoche (Rollover)'
            ) ON CONFLICT DO NOTHING;

            fecha_iter := fecha_iter + 1;
        END LOOP;
    END LOOP;

    -- ── B. CONTINUIDAD DE ESCALAS (lecturas_escalas) ──────────────────────────
    FOR r IN
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = (fecha_hoy - 1)
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id
        ) VALUES (
            gen_random_uuid(), r.escala_id, fecha_hoy, 'am', r.nivel_m, '00:00:00',
            'SICA Chronos', 'Autogenerado (Continuidad de Medianoche)', r.ciclo_id
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 3. BACKFILL: Rellenar mediciones faltantes para días ya en reportes_operacion ──
-- Insertar medición de medianoche para cada día que tiene reportes_operacion 'continua'
-- pero NO tiene medición correspondiente en ese timestamp.
DO $$
DECLARE
    rep RECORD;
    midnight_ts TIMESTAMPTZ;
BEGIN
    FOR rep IN
        SELECT ro.punto_id, ro.fecha, ro.caudal_promedio, ro.hora_apertura
        FROM public.reportes_operacion ro
        WHERE ro.fecha BETWEEN '2026-03-19' AND '2026-03-24'
          AND ro.estado::text IN ('continua', 'modificacion')
          AND ro.caudal_promedio > 0
        ORDER BY ro.punto_id, ro.fecha
    LOOP
        -- Usar hora_apertura del reporte como timestamp de la medición (es la medianoche local)
        midnight_ts := COALESCE(rep.hora_apertura, (rep.fecha AT TIME ZONE 'America/Chihuahua'));

        -- Solo insertar si no existe ya una medición en ese minuto exacto para ese punto
        IF NOT EXISTS (
            SELECT 1 FROM public.mediciones
            WHERE punto_id = rep.punto_id
              AND fecha_hora = midnight_ts
        ) THEN
            INSERT INTO public.mediciones (
                punto_id, valor_q, fecha_hora, estado_evento, notas
            ) VALUES (
                rep.punto_id,
                rep.caudal_promedio,
                midnight_ts,
                'continua',
                'Evento automático: Backfill continuidad (Migración 20260325)'
            );
        END IF;
    END LOOP;
END;
$$;


-- ── 4. INSTRUCCIONES: Configurar pg_cron en Supabase Dashboard ────────────────
-- Si pg_cron no está activo, ir a:
--   Supabase Dashboard → Database → Extensions → habilitar "pg_cron"
-- Luego ejecutar UNA VEZ en SQL Editor:
--
-- SELECT cron.schedule(
--   'sica-midnight-rollover',
--   '0 6 * * *',   -- 06:00 UTC = 00:00 Chihuahua (UTC-6)
--   $$
--   SELECT net.http_post(
--     url := current_setting('app.settings.supabase_url') || '/functions/v1/generate-daily-report',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
--
-- Alternativa más simple (llamada directa a la función sin la Edge Function):
-- SELECT cron.schedule(
--   'sica-midnight-rollover',
--   '0 6 * * *',
--   'SELECT public.fn_generar_continuidad_diaria();'
-- );
