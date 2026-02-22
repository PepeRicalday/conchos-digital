-- 1. Create Enum (If not exists)
DO $$ BEGIN
    CREATE TYPE estado_reporte AS ENUM ('inicio', 'suspension', 'reabierto', 'cierre');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create Table (If not exists)
CREATE TABLE IF NOT EXISTS reportes_diarios (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    punto_id UUID REFERENCES puntos_entrega(id) NOT NULL,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    estado estado_reporte DEFAULT 'inicio',
    volumen_acumulado NUMERIC DEFAULT 0,
    caudal_promedio NUMERIC DEFAULT 0,
    num_mediciones INTEGER DEFAULT 0,
    hora_apertura TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    hora_cierre TIMESTAMP WITH TIME ZONE,
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(punto_id, fecha)
);

-- 3. Trigger Function: Auto-Generate Today & Auto-Close Yesterday ("Lazy Close")
CREATE OR REPLACE FUNCTION public.actualizar_reporte_diario()
RETURNS trigger AS $$
DECLARE
    reporte_diario_id UUID;
BEGIN
    -- 1. Buscar Reporte de HOY
    SELECT id INTO reporte_diario_id
    FROM reportes_diarios
    WHERE punto_id = NEW.punto_id AND fecha = CURRENT_DATE;

    -- 2. Si NO existe (Es la primera medición del día)
    IF reporte_diario_id IS NULL THEN
        -- A) Cerrar Reporte de AYER (Lazy Close)
        -- Si ayer quedó "inicio" o "reabierto", lo cerramos automáticamente al iniciar hoy.
        UPDATE reportes_diarios
        SET 
            estado = 'cierre', 
            hora_cierre = timezone('utc'::text, now()),
            updated_at = timezone('utc'::text, now())
        WHERE punto_id = NEW.punto_id 
          AND fecha = (CURRENT_DATE - INTERVAL '1 day')
          AND estado != 'cierre';

        -- B) Crear Reporte de HOY
        INSERT INTO reportes_diarios (punto_id, fecha, estado, volumen_acumulado, caudal_promedio, num_mediciones, hora_apertura)
        VALUES (
            NEW.punto_id, 
            CURRENT_DATE, 
            'inicio', 
            COALESCE(NEW.valor_vol, 0), -- Asegurar no nulos
            COALESCE(NEW.valor_q, 0), 
            1,
            timezone('utc'::text, now())
        );
    ELSE
        -- 3. Si YA existe, Actualizar Acumulados
        UPDATE reportes_diarios
        SET 
            volumen_acumulado = volumen_acumulado + COALESCE(NEW.valor_vol, 0),
            caudal_promedio = (caudal_promedio * num_mediciones + COALESCE(NEW.valor_q, 0)) / (num_mediciones + 1),
            num_mediciones = num_mediciones + 1,
            updated_at = timezone('utc'::text, now()),
            -- Si estaba cerrado y llega nueva data, se reabre
            estado = CASE WHEN estado = 'cierre' THEN 'reabierto'::estado_reporte ELSE estado END
        WHERE id = reporte_diario_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach Trigger
DROP TRIGGER IF EXISTS trigger_actualizar_reporte ON mediciones;
CREATE TRIGGER trigger_actualizar_reporte
AFTER INSERT ON mediciones
FOR EACH ROW
EXECUTE FUNCTION actualizar_reporte_diario();
