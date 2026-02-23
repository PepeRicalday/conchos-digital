-- Migración: Hidro-Sincronía Digital - Cálculos de Volumen Exactos vía Trigger
-- Archivo: 20260222_tomas_abiertas_volumen.sql

-- Se reemplaza la función gestionar_evento_riego para que calcule mecánicamente
-- el volumen consumido (V = Q_prev * Delta_T) y modifique NEW.valor_vol antes de la inserción, 
-- pero como necesitamos modificar NEW, debe ser un trigger BEFORE INSERT.
-- Sin embargo, actualizar tablas relacionadas es mejor en AFTER INSERT.
-- Haremos el cálculo en un BEFORE INSERT (para que NEW guarde el valor real calculado),
-- y la actualización de reportes en el AFTER INSERT (gestionar_evento_riego).

-- 1. Trigger BEFORE INSERT para pre-calcular el volumen hidráulico
CREATE OR REPLACE FUNCTION public.calcular_volumen_hidraulico()
RETURNS trigger AS $$
DECLARE
    prev_medicion RECORD;
    delta_t_segundos NUMERIC;
BEGIN
    -- Asegurar que tenga timestamp
    IF NEW.fecha_hora IS NULL THEN
        NEW.fecha_hora := timezone('utc'::text, now());
    END IF;

    -- Obtener la medición anterior en el tiempo
    SELECT * INTO prev_medicion
    FROM mediciones
    WHERE punto_id = NEW.punto_id 
      AND fecha_hora < NEW.fecha_hora
    ORDER BY fecha_hora DESC
    LIMIT 1;

    IF FOUND AND prev_medicion.valor_q > 0 THEN
        delta_t_segundos := EXTRACT(EPOCH FROM (NEW.fecha_hora - prev_medicion.fecha_hora));
        -- Volumen = Q_m3s * delta_T_segundos
        IF delta_t_segundos > 0 THEN
            NEW.valor_vol := prev_medicion.valor_q * delta_t_segundos;
        ELSE
            NEW.valor_vol := 0;
        END IF;
    ELSE
        -- Si no hay flujo previo, no se generó volumen en este lapso
        NEW.valor_vol := 0;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_calcular_volumen ON public.mediciones;
CREATE TRIGGER trigger_calcular_volumen
BEFORE INSERT ON public.mediciones
FOR EACH ROW
EXECUTE FUNCTION public.calcular_volumen_hidraulico();


-- 2. Refactor de gestionar_evento_riego (AFTER INSERT) para agrupar el volumen correctamente
-- Distribuyendo volúmenes si el tiempo transcurrido cruza la medianoche.
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
    reporte_hoy_id UUID;
BEGIN
    fecha_hoy := NEW.fecha_hora::date;

    -- Localizar la medición anterior para saber si cruzamos la medianoche
    SELECT * INTO prev_medicion
    FROM mediciones
    WHERE punto_id = NEW.punto_id 
      AND id != NEW.id
      AND fecha_hora < NEW.fecha_hora
    ORDER BY fecha_hora DESC
    LIMIT 1;

    -- Cálculo de volúmenes para repartir en días
    IF FOUND AND prev_medicion.valor_q > 0 THEN
        fecha_prev := prev_medicion.fecha_hora::date;
        
        IF fecha_prev = fecha_hoy THEN
            -- Todo el volumen generado pertenece a HOY
            vol_hoy_m3 := COALESCE(NEW.valor_vol, 0);
        ELSE
            -- El lapso cruza la medianoche. Repartir.
            midnight_timestamp := date_trunc('day', NEW.fecha_hora);
            
            -- Para Ayer
            delta_t_segundos := EXTRACT(EPOCH FROM (midnight_timestamp - prev_medicion.fecha_hora));
            IF delta_t_segundos > 0 THEN
                vol_prev_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;
            
            -- Para Hoy
            delta_t_segundos := EXTRACT(EPOCH FROM (NEW.fecha_hora - midnight_timestamp));
            IF delta_t_segundos > 0 THEN
                vol_hoy_m3 := prev_medicion.valor_q * delta_t_segundos;
            END IF;
        END IF;
    ELSE
        -- Si no hay previo, o su Q era 0, este "evento" no acumula volumen previo
        -- (A menos que este sea un insert donde el UI de forma legacy mandó un vol)
        vol_hoy_m3 := 0;
    END IF;

    -- 3. Actualizar / Terminar Reporte de Ayer (Si cruzó medianoche)
    IF vol_prev_m3 > 0 THEN
        UPDATE reportes_diarios
        SET volumen_acumulado = COALESCE(volumen_acumulado, 0) + vol_prev_m3,
            estado = 'cierre',
            hora_cierre = midnight_timestamp,
            updated_at = timezone('utc'::text, now())
        WHERE punto_id = NEW.punto_id AND fecha = fecha_prev;
    ELSE 
        -- Lazy Close si estaba abierto ayer y hoy lo están pisando
        UPDATE reportes_diarios
        SET estado = 'cierre',
            hora_cierre = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE punto_id = NEW.punto_id AND fecha = (fecha_hoy - INTERVAL '1 day')::date AND estado != 'cierre';
    END IF;

    -- 4. Actualizar / Crear Reporte de Hoy
    SELECT id INTO reporte_hoy_id FROM reportes_diarios WHERE punto_id = NEW.punto_id AND fecha = fecha_hoy;

    IF reporte_hoy_id IS NULL THEN
        -- Es el primer reporte del día
        INSERT INTO reportes_diarios (punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones, hora_apertura)
        VALUES (
            NEW.punto_id, 
            fecha_hoy, 
            CASE WHEN NEW.valor_q > 0 THEN 'inicio'::estado_reporte ELSE 'suspension'::estado_reporte END, 
            vol_hoy_m3, 
            NEW.valor_q, 
            1,
            NEW.fecha_hora
        );
    ELSE
        -- Actualizar el reporte actual
        UPDATE reportes_diarios
        SET 
            volumen_acumulado = COALESCE(volumen_acumulado, 0) + vol_hoy_m3,
            caudal_promedio = NEW.valor_q, -- O mantener el promedio si se quiere math real
            num_mediciones = num_mediciones + 1,
            updated_at = timezone('utc'::text, now()),
            estado = CASE 
                WHEN NEW.valor_q = 0 THEN 'suspension'::estado_reporte
                WHEN NEW.valor_q != caudal_promedio THEN 'modificacion'::estado_reporte
                ELSE estado 
            END
        WHERE id = reporte_hoy_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
