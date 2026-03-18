-- Migración: Corrección de etiquetas y horarios de continuidad (Rollover)
-- Archivo: 20260318010000_fix_continuidad_labels_time.sql

-- 1. Reparar la función de Continuidad Diaria (Midnight Rollover)
-- Corregida para inyectar estado_evento = 'continua' y usar el horario local real de Chihuahua (UTC 06:00 para 00:00 AM)
CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    local_now TIMESTAMP := timezone('America/Chihuahua'::text, now());
    fecha_ayer DATE := (local_now - INTERVAL '1 day')::date;
    fecha_hoy DATE := local_now::date;
    -- Midnight At es las 00:00:00 de hoy en hora local Chihuahua, devuelto como TIMESTAMPTZ (Ej: 06:00 AM UTC)
    midnight_at TIMESTAMP WITH TIME ZONE := fecha_hoy AT TIME ZONE 'America/Chihuahua';
BEGIN
    -- A. CONTINUIDAD DE TOMAS (reportes_operacion)
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
            0,
            r.ciclo_id
        ) ON CONFLICT (punto_id, fecha) DO NOTHING;

        -- 3. Inyectar medición virtual de medianoche (CON ETIQUETA 'continua')
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

    -- B. CONTINUIDAD DE ESCALAS (lecturas_escalas)
    FOR r IN 
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = fecha_ayer
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id
        ) VALUES (
            gen_random_uuid(), -- Usar UUID para evitar colisiones
            r.escala_id,
            fecha_hoy,
            'am',
            r.nivel_m,
            '00:00:00', -- Para el campo hora_lectura TEXT o TIME local
            'SICA Chronos',
            'Autogenerado (Continuidad de Medianoche)',
            r.ciclo_id
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
