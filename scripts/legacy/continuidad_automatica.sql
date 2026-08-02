-- AUTOMATIZACIÓN DE CONTINUIDAD HIDRÁULICA Y REGLAS DE ARRASTRE
-- Este script crea (o actualiza) la función que se ejecuta automáticamente a la medianoche.
-- Se asegura de arrastrar tomas abiertas y las últimas lecturas de escalas.

CREATE OR REPLACE FUNCTION public.fn_mantenimiento_diario_continuidad()
RETURNS void AS $$
DECLARE
    fecha_ayer DATE;
    fecha_hoy DATE;
    v_reporte_id UUID;
    r RECORD;
    l RECORD;
BEGIN
    -- Definimos las fechas
    fecha_hoy := current_date;
    fecha_ayer := fecha_hoy - interval '1 day';

    ---------------------------------------------------------------------------
    -- 1. ARRASTRE DE CONTINUIDAD DE TOMAS (Puntos de Entrega)
    -- Si una toma se quedó abierta (inicio, continua, reabierto, modificacion) ayer,
    -- HOY automáticamente amanece como "continua" con el mismo gasto.
    ---------------------------------------------------------------------------
    FOR r IN (
        SELECT ro.* 
        FROM reportes_operacion ro
        INNER JOIN (
            -- Buscamos el último estado de cada toma en el día de ayer
            SELECT punto_id, MAX(hora_apertura) as max_hora
            FROM reportes_operacion
            WHERE fecha = fecha_ayer
            GROUP BY punto_id
        ) ultimos ON ro.punto_id = ultimos.punto_id AND ro.hora_apertura = ultimos.max_hora
        WHERE ro.fecha = fecha_ayer 
          AND ro.estado IN ('inicio', 'continua', 'reabierto', 'modificacion')
    ) LOOP
        -- Insertamos si no existe un registro ya para hoy de este punto
        IF NOT EXISTS (
            SELECT 1 FROM reportes_operacion 
            WHERE punto_id = r.punto_id AND fecha = fecha_hoy
        ) THEN
            INSERT INTO reportes_operacion (
                id, punto_id, ciclo_id, fecha, hora_apertura, 
                estado, caudal_promedio, notas, creado_en, actualizado_en
            ) VALUES (
                gen_random_uuid(),
                r.punto_id,
                r.ciclo_id,
                fecha_hoy,
                '00:00:00',
                'continua',
                r.caudal_promedio,
                'Arrastre automático de continuidad (Día anterior)',
                current_timestamp,
                current_timestamp
            );
        END IF;
    END LOOP;

    ---------------------------------------------------------------------------
    -- 2. ARRASTRE DE CONTINUIDAD DE ESCALAS
    -- Toma la última lectura de cada escala activa de ayer, y la inyecta hoy
    -- a las 00:00 como lectura base (para arrancar el día sin escalas vacías).
    ---------------------------------------------------------------------------
    FOR l IN (
        SELECT le.*
        FROM lecturas_escalas le
        INNER JOIN (
            -- Buscamos la última hora de ayer para cada escala
            SELECT escala_id, MAX(hora_lectura) as max_hora
            FROM lecturas_escalas
            WHERE fecha = fecha_ayer
            GROUP BY escala_id
        ) ultimos ON le.escala_id = ultimos.escala_id AND le.hora_lectura = ultimos.max_hora
        WHERE le.fecha = fecha_ayer
    ) LOOP
        -- Insertamos si no se ha inyectado ya algo hoy
        IF NOT EXISTS (
            SELECT 1 FROM lecturas_escalas 
            WHERE escala_id = l.escala_id AND fecha = fecha_hoy AND hora_lectura = '00:00:00'
        ) THEN
            INSERT INTO lecturas_escalas (
                id, escala_id, fecha, nivel_m, radiales_json,
                apertura_radiales_m, gasto_calculado_m3s, hora_lectura, turno,
                responsable, notas, creado_en, actualizado_en
            ) VALUES (
                gen_random_uuid(),
                l.escala_id,
                fecha_hoy,
                l.nivel_m,
                l.radiales_json,
                l.apertura_radiales_m,
                l.gasto_calculado_m3s,
                '00:00:00',
                'am',
                'Sistema Automático',
                'Arranque por continuidad de ayer',
                current_timestamp,
                current_timestamp
            );
        END IF;
    END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
