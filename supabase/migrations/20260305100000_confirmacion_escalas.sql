-- Migración: Confirmación de Escalas (Hidro-Sincronía Digital)
-- Objetivo: Rastrear si una lectura de escala proviene de campo o es autogenerada.

-- 1. Agregar columna confirmada a lecturas_escalas
ALTER TABLE public.lecturas_escalas 
ADD COLUMN IF NOT EXISTS confirmada BOOLEAN DEFAULT TRUE;

-- 2. Actualizar función de continuidad para marcar como no confirmadas
CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    fecha_ayer DATE := (timezone('America/Chihuahua'::text, now()) - INTERVAL '1 day')::date;
    fecha_hoy DATE := timezone('America/Chihuahua'::text, now())::date;
    midnight_at TIMESTAMP WITH TIME ZONE := date_trunc('day', timezone('America/Chihuahua'::text, now()));
BEGIN
    -- A. CONTINUIDAD DE TOMAS (reportes_operacion)
    FOR r IN 
        SELECT punto_id, caudal_promedio, volumen_acumulado, ciclo_id
        FROM public.reportes_operacion
        WHERE fecha = fecha_ayer 
          AND estado::text NOT IN ('cierre', 'suspension') 
          AND caudal_promedio > 0
    LOOP
        UPDATE public.reportes_operacion
        SET estado = 'cierre',
            hora_cierre = midnight_at,
            actualizado_en = timezone('utc'::text, now())
        WHERE punto_id = r.punto_id AND fecha = fecha_ayer;

        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, caudal_promedio, num_mediciones, hora_apertura, volumen_acumulado, ciclo_id
        ) VALUES (
            r.punto_id, fecha_hoy, 'continua', r.caudal_promedio, 1, midnight_at, 0, r.ciclo_id
        ) ON CONFLICT (punto_id, fecha) DO NOTHING;

        INSERT INTO public.mediciones (punto_id, valor_q, fecha_hora, notas) 
        VALUES (r.punto_id, r.caudal_promedio, midnight_at, 'Evento automático: Continuidad de medianoche (Rollover)');
    END LOOP;

    -- B. CONTINUIDAD DE ESCALAS (lecturas_escalas)
    FOR r IN 
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = fecha_ayer
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id, confirmada
        ) VALUES (
            gen_random_uuid(),
            r.escala_id,
            fecha_hoy,
            'am',
            r.nivel_m,
            '00:00:00',
            'SICA Chronos',
            'Autogenerado (Continuidad de Medianoche)',
            r.ciclo_id,
            FALSE -- <--- MARCAR COMO NO CONFIRMADA
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
