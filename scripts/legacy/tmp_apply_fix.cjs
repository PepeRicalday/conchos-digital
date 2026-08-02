const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
function loadEnv() {
    const envPath = path.join(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').map(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let value = parts.slice(1).join('=').trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            env[key] = value;
        }
    }); return env;
}
const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);

async function run() {
    const sql = `
-- 1. Reparar la función de Continuidad Diaria (Midnight Rollover)
CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    local_now TIMESTAMP := timezone('America/Chihuahua'::text, now());
    fecha_ayer DATE := (local_now - INTERVAL '1 day')::date;
    fecha_hoy DATE := local_now::date;
    -- Midnight At es las 00:00:00 de hoy en hora local Chihuahua, devuelto como TIMESTAMPTZ
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

-- 2. Corregir registros de hoy que se crearon con Estado NULL y Hora Errónea
-- Identificamos las mediciones de hoy con el comentario de Rollover
UPDATE public.mediciones
SET estado_evento = 'continua',
    fecha_hora = CURRENT_DATE AT TIME ZONE 'America/Chihuahua',
    notas = 'Evento corregido: Continuidad de medianoche (FIX Label & Time)'
WHERE notas = 'Evento automático: Continuidad de medianoche (Rollover)'
  AND fecha_hora::date = CURRENT_DATE;

-- También corregir reportes operacionales de hoy si fuera necesario
UPDATE public.reportes_operacion
SET estado = 'continua'
WHERE fecha = CURRENT_DATE 
  AND estado::text = 'inicio' 
  AND (punto_id IN (SELECT punto_id FROM public.mediciones WHERE estado_evento = 'continua' AND fecha_hora::date = CURRENT_DATE));
`;

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    if (error) {
        // Fallback if exec_sql rpc doesn't exist (using raw query via anonymous is impossible)
        console.log("Error running SQL via RPC:", error);
    } else {
        console.log("SQL Fix applied successfully.");
    }
}
run();
