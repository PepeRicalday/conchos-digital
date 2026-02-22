-- 1. Update Enum with New Statuses
ALTER TYPE estado_reporte ADD VALUE IF NOT EXISTS 'continua';
ALTER TYPE estado_reporte ADD VALUE IF NOT EXISTS 'modificacion';

-- 2. Enhanced Trigger for "Hydra-Continuum" Logic
CREATE OR REPLACE FUNCTION public.gestionar_evento_riego()
RETURNS trigger AS $$
DECLARE
    ultimo_q NUMERIC := 0;
    reporte_ayer_id UUID;
    estado_ayer estado_reporte;
    q_ayer NUMERIC;
    reporte_hoy_id UUID;
BEGIN
    -- A. LOGIC FOR "CONTINUA" (Day Rollover)
    -- Check if this is the first entry of the day or if we need to bridge from yesterday
    
    -- Get yesterday's last status
    SELECT estado, caudal_promedio INTO estado_ayer, q_ayer
    FROM reportes_diarios
    WHERE punto_id = NEW.punto_id AND fecha = (CURRENT_DATE - INTERVAL '1 day');

    -- If yesterday ended OPEN (not closed, not suspended) and today has no report yet...
    IF estado_ayer NOT IN ('cierre', 'suspension') AND q_ayer > 0 THEN
         -- We MUST verify if a "Carry Over" record exists for today at 00:00
         -- Check if we already created the report for today
         SELECT id INTO reporte_hoy_id FROM reportes_diarios WHERE punto_id = NEW.punto_id AND fecha = CURRENT_DATE;
         
         IF reporte_hoy_id IS NULL THEN
            -- Create Today's Report with 'continua' status and a virtual measurement
            INSERT INTO reportes_diarios (punto_id, fecha, estado, caudal_promedio, num_mediciones, hora_apertura)
            VALUES (NEW.punto_id, CURRENT_DATE, 'continua', q_ayer, 1, timezone('utc'::text, now()));
            
            -- OPTIONAL: Insert a virtual measurement at 00:00:00 so the graph is continuous?
            -- For now, we trust the report state.
         END IF;
    END IF;

    -- B. DETERMINE STATUS BASED ON FLOW CHANGE
    -- If New Q > 0 and Old Q = 0 -> 'inicio' or 'reabierto'
    -- If New Q != Old Q -> 'modificacion'
    -- If New Q = 0 -> 'suspension' (logic handled in app usually, but we can tag the report)
    
    -- Create/Update Report Logic (Simplified from previous, but focusing on correct tagging)
    SELECT id INTO reporte_hoy_id FROM reportes_diarios WHERE punto_id = NEW.punto_id AND fecha = CURRENT_DATE;

    IF reporte_hoy_id IS NULL THEN
        -- New Report for Today
        INSERT INTO reportes_diarios (punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones)
        VALUES (
            NEW.punto_id, 
            CURRENT_DATE, 
            CASE WHEN NEW.valor_q > 0 THEN 'inicio'::estado_reporte ELSE 'suspension'::estado_reporte END, 
            0, -- Vol starts at 0, builds up over time
            NEW.valor_q, 
            1
        );
    ELSE
        -- Update Report
        UPDATE reportes_diarios
        SET 
            -- Volume logic: simplistic accumulation for now, but UI should do Integration
            volumen_acumulado = volumen_acumulado + COALESCE(NEW.valor_vol, 0),
            caudal_promedio = NEW.valor_q, -- Set to current Q for "Current State" tracking
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

-- 3. Re-Attach Trigger
DROP TRIGGER IF EXISTS trigger_actualizar_reporte ON mediciones;
CREATE TRIGGER trigger_registrar_evento_riego
AFTER INSERT ON mediciones
FOR EACH ROW
EXECUTE FUNCTION gestionar_evento_riego();
