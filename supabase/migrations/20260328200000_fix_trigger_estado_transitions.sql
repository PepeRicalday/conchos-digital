-- ============================================================
-- Migración: Fix transiciones de estado en gestionar_evento_riego
-- Fecha: 2026-03-28
--
-- Bugs corregidos:
--   BUG-1: UPDATE ignoraba estado_evento='reabierto' e 'inicio'
--          → quedaba como 'modificacion' al comparar valor_q
--   BUG-2: 'cierre'/'suspension' → INSERT sin reporte previo
--          solo se crea si el estado tiene sentido de apertura
-- ============================================================

CREATE OR REPLACE FUNCTION public.gestionar_evento_riego()
RETURNS trigger AS $$
DECLARE
    prev_medicion       RECORD;
    delta_t_segundos    NUMERIC;
    vol_prev_m3         NUMERIC := 0;
    vol_hoy_m3          NUMERIC := 0;
    fecha_prev          DATE;
    fecha_hoy           DATE;
    midnight_timestamp  TIMESTAMP WITH TIME ZONE;
    report_id           TEXT;
    q_anterior          NUMERIC;
    estado_actual       estado_reporte;
BEGIN
    fecha_hoy := (NEW.fecha_hora AT TIME ZONE 'America/Chihuahua')::date;

    -- Buscar la medición anterior del mismo punto
    SELECT * INTO prev_medicion
    FROM public.mediciones
    WHERE punto_id  = NEW.punto_id
      AND id       != NEW.id
      AND fecha_hora < NEW.fecha_hora
    ORDER BY fecha_hora DESC
    LIMIT 1;

    -- ── Cálculo de volúmenes repartidos entre días ────────────────────────────
    IF FOUND AND prev_medicion.valor_q > 0 THEN
        fecha_prev := (prev_medicion.fecha_hora AT TIME ZONE 'America/Chihuahua')::date;

        IF fecha_prev = fecha_hoy THEN
            vol_hoy_m3 := COALESCE(NEW.valor_vol, 0);
        ELSE
            -- Cruce de medianoche local Chihuahua
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
    END IF;

    -- Cerrar reporte de día anterior si hubo cruce de medianoche
    IF vol_prev_m3 > 0 THEN
        UPDATE public.reportes_operacion
        SET volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_prev_m3 / 1000000.0),
            estado            = 'cierre',
            hora_cierre       = midnight_timestamp,
            actualizado_en    = timezone('utc'::text, now())
        WHERE punto_id = NEW.punto_id AND fecha = fecha_prev;
    END IF;

    -- Obtener reporte de hoy (si existe)
    SELECT id::text, caudal_promedio, estado
    INTO report_id, q_anterior, estado_actual
    FROM public.reportes_operacion
    WHERE punto_id = NEW.punto_id AND fecha = fecha_hoy;

    IF report_id IS NULL THEN
        -- ── INSERT: primer evento del día ─────────────────────────────────────
        -- Solo crear si el estado tiene sentido como apertura.
        -- Si llega 'cierre'/'suspension' sin reporte previo hoy:
        --   → solo insertar si ya existe un reporte abierto de días anteriores
        --     (cruce de medianoche tardío). De lo contrario, ignorar silenciosamente
        --     para evitar cierre huérfano.
        IF NEW.estado_evento IN ('cierre', 'suspension') AND NOT EXISTS (
            SELECT 1 FROM public.reportes_operacion
            WHERE punto_id = NEW.punto_id
              AND fecha     < fecha_hoy
              AND estado   NOT IN ('cierre', 'suspension')
        ) THEN
            RETURN NEW; -- no crear reporte fantasma
        END IF;

        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones, hora_apertura
        ) VALUES (
            NEW.punto_id,
            fecha_hoy,
            CASE
                WHEN NEW.estado_evento IS NOT NULL THEN NEW.estado_evento::estado_reporte
                WHEN NEW.valor_q > 0              THEN 'inicio'::estado_reporte
                ELSE                                   'suspension'::estado_reporte
            END,
            (vol_hoy_m3 / 1000000.0),
            NEW.valor_q,
            1,
            NEW.fecha_hora
        );

    ELSE
        -- ── UPDATE: evento sobre reporte existente ────────────────────────────
        UPDATE public.reportes_operacion
        SET
            volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_hoy_m3 / 1000000.0),
            caudal_promedio   = NEW.valor_q,
            num_mediciones    = num_mediciones + 1,
            actualizado_en    = timezone('utc'::text, now()),
            estado = CASE
                -- Estados explícitos de apertura/cierre (mayor prioridad)
                WHEN NEW.estado_evento = 'cierre'      THEN 'cierre'::estado_reporte
                WHEN NEW.estado_evento = 'suspension'  THEN 'suspension'::estado_reporte
                WHEN NEW.estado_evento = 'reabierto'   THEN 'reabierto'::estado_reporte
                WHEN NEW.estado_evento = 'inicio'      THEN 'inicio'::estado_reporte
                -- Sin estado explícito → derivar por valor
                WHEN NEW.valor_q = 0                   THEN 'suspension'::estado_reporte
                WHEN NEW.valor_q != q_anterior         THEN 'modificacion'::estado_reporte
                ELSE estado
            END,
            -- Si llega 'reabierto' o 'inicio', limpiar hora_cierre (se estaba reabriendo)
            hora_cierre = CASE
                WHEN NEW.estado_evento IN ('reabierto', 'inicio') THEN NULL
                WHEN NEW.estado_evento = 'cierre'
                     THEN COALESCE(hora_cierre, NEW.fecha_hora)
                ELSE hora_cierre
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
