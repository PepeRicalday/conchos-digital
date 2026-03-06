-- Migración: Hidro-Sincronía Digital - Continuidad Diaria y Automatización de Reportes
-- Archivo: 20260305_reparar_continuidad_reportes.sql
-- Objetivo: Crear la función RPC faltante fn_generar_continuidad_diaria y corregir el trigger de rollover.

-- 1. Asegurar que los tipos existen
DO $$ BEGIN
    CREATE TYPE estado_reporte AS ENUM ('inicio', 'suspension', 'reabierto', 'cierre', 'continua', 'modificacion');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Función de Continuidad Diaria (Midnight Rollover)
-- Corregida para soportar IDs de texto (PE-xxx, ESC-xxx) y escalas.
CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    fecha_ayer DATE := (timezone('America/Chihuahua'::text, now()) - INTERVAL '1 day')::date;
    fecha_hoy DATE := timezone('America/Chihuahua'::text, now())::date;
    midnight_at TIMESTAMP WITH TIME ZONE := date_trunc('day', timezone('America/Chihuahua'::text, now()));
BEGIN
    -- A. CONTINUIDAD DE TOMAS (reportes_operacion)
    -- Buscamos reportes que terminaron abiertos ayer
    FOR r IN 
        SELECT punto_id, caudal_promedio, volumen_acumulado, ciclo_id
        FROM public.reportes_operacion
        WHERE fecha = fecha_ayer 
          AND estado::text NOT IN ('cierre', 'suspension') 
          AND caudal_promedio > 0
    LOOP
        -- 1. Cerrar reporte de Ayer
        UPDATE public.reportes_operacion
        SET estado = 'cierre',
            hora_cierre = midnight_at,
            actualizado_en = timezone('utc'::text, now())
        WHERE punto_id = r.punto_id AND fecha = fecha_ayer;

        -- 2. Crear reporte de Hoy (Continua)
        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, caudal_promedio, num_mediciones, hora_apertura, volumen_acumulado, ciclo_id
        ) VALUES (
            r.punto_id,
            fecha_hoy,
            'continua',
            r.caudal_promedio,
            1,
            midnight_at,
            0, -- Empieza en 0 el acumulado de hoy
            r.ciclo_id
        ) ON CONFLICT (punto_id, fecha) DO NOTHING;

        -- 3. Inyectar medición virtual de medianoche
        -- Nota: Eliminamos cast ::uuid porque los IDs en este DB son TEXTO
        INSERT INTO public.mediciones (
            punto_id, valor_q, fecha_hora, notas
        ) VALUES (
            r.punto_id,
            r.caudal_promedio,
            midnight_at,
            'Evento automático: Continuidad de medianoche (Rollover)'
        );
    END LOOP;

    -- B. CONTINUIDAD DE ESCALAS (lecturas_escalas)
    -- Buscamos la última lectura de ayer para cada escala
    FOR r IN 
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = fecha_ayer
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id
        ) VALUES (
            gen_random_uuid(), -- Usar UUID para evitar colisiones con el contador LE-xxx si está desincronizado
            r.escala_id,
            fecha_hoy,
            'am',
            r.nivel_m,
            '00:00:00',
            'SICA Chronos',
            'Autogenerado (Continuidad de Medianoche - Última lectura del ' || fecha_ayer || ')',
            r.ciclo_id
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Actualizar gestionar_evento_riego (Soporte TEXT IDs)
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
    fecha_hoy := NEW.fecha_hora::date;

    -- Localizar la medición anterior
    SELECT * INTO prev_medicion
    FROM public.mediciones
    WHERE punto_id = NEW.punto_id 
      AND id != NEW.id
      AND fecha_hora < NEW.fecha_hora
    ORDER BY fecha_hora DESC
    LIMIT 1;

    -- Cálculo de volúmenes repartidos
    IF FOUND AND prev_medicion.valor_q > 0 THEN
        fecha_prev := prev_medicion.fecha_hora::date;
        
        IF fecha_prev = fecha_hoy THEN
            vol_hoy_m3 := COALESCE(NEW.valor_vol, 0);
        ELSE
            -- Cruce de medianoche
            midnight_timestamp := date_trunc('day', NEW.fecha_hora);
            
            -- Volumen para Ayer
            delta_t_segundos := EXTRACT(EPOCH FROM (midnight_timestamp - prev_medicion.fecha_hora));
            IF delta_t_segundos > 0 THEN
                vol_prev_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;
            
            -- Volumen para Hoy
            delta_t_segundos := EXTRACT(EPOCH FROM (NEW.fecha_hora - midnight_timestamp));
            IF delta_t_segundos > 0 THEN
                vol_hoy_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;
        END IF;
    ELSE
        vol_hoy_m3 := 0;
    END IF;

    -- 1. Actualizar reporte de Ayer
    IF vol_prev_m3 > 0 THEN
        UPDATE public.reportes_operacion
        SET volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_prev_m3 / 1000000.0),
            estado = 'cierre',
            hora_cierre = midnight_timestamp
        WHERE punto_id = NEW.punto_id AND fecha = fecha_prev;
    END IF;

    -- 2. Manejar reporte de Hoy
    SELECT id::text, caudal_promedio INTO report_id, q_anterior 
    FROM public.reportes_operacion 
    WHERE punto_id = NEW.punto_id AND fecha = fecha_hoy;

    IF report_id IS NULL THEN
        -- Crear reporte nuevo
        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones, hora_apertura
        ) VALUES (
            NEW.punto_id, 
            fecha_hoy, 
            CASE WHEN NEW.valor_q > 0 THEN 'inicio' ELSE 'suspension' END, 
            (vol_hoy_m3 / 1000000.0), 
            NEW.valor_q, 
            1,
            NEW.fecha_hora
        );
    ELSE
        -- Actualizar reporte existente
        UPDATE public.reportes_operacion
        SET 
            volumen_acumulado = COALESCE(volumen_acumulado, 0) + (vol_hoy_m3 / 1000000.0),
            caudal_promedio = NEW.valor_q,
            num_mediciones = num_mediciones + 1,
            estado = CASE 
                WHEN NEW.valor_q = 0 THEN 'suspension'
                WHEN NEW.valor_q != q_anterior THEN 'modificacion'
                ELSE estado 
            END
        WHERE id::text = report_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Asegurar disparadores
DROP TRIGGER IF EXISTS trigger_registrar_evento_riego ON public.mediciones;
CREATE TRIGGER trigger_registrar_evento_riego
AFTER INSERT ON public.mediciones
FOR EACH ROW
EXECUTE FUNCTION public.gestionar_evento_riego();

-- Ejecutar continuidad manualmente para el día de hoy
SELECT public.fn_generar_continuidad_diaria();


