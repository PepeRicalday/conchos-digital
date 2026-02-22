-- 1. Rename Tables (Espanolizacion)
DO $$ BEGIN
    ALTER TABLE IF EXISTS modules RENAME TO modulos;
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE IF EXISTS delivery_points RENAME TO puntos_entrega;
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE IF EXISTS measurements RENAME TO mediciones;
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE IF EXISTS dams RENAME TO presas;
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

-- 2. Rename Columns (modulos)
DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN acu_name TO nombre_acu;
    ALTER TABLE modulos RENAME COLUMN short_code TO codigo_corto;
    ALTER TABLE modulos RENAME COLUMN authorized_vol TO vol_autorizado;
    ALTER TABLE modulos RENAME COLUMN accumulated_vol TO vol_acumulado;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

-- 3. Rename Columns (puntos_entrega)
DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN module_id TO modulo_id;
    ALTER TABLE puntos_entrega RENAME COLUMN capacity_max TO capacidad_max;
    ALTER TABLE puntos_entrega RENAME COLUMN coordinates_x TO coords_x;
    ALTER TABLE puntos_entrega RENAME COLUMN coordinates_y TO coords_y;
    ALTER TABLE puntos_entrega RENAME COLUMN type TO tipo;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

-- 4. Rename Columns (mediciones)
DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN value_q TO valor_q;
    ALTER TABLE mediciones RENAME COLUMN value_vol TO valor_vol;
    ALTER TABLE mediciones RENAME COLUMN location_id TO punto_id;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

-- 5. Create Secciones Table
CREATE TABLE IF NOT EXISTS secciones (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    nombre TEXT NOT NULL,
    km_inicio NUMERIC NOT NULL,
    km_fin NUMERIC NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. Add Relation to Puntos de Entrega
DO $$ BEGIN
    ALTER TABLE puntos_entrega ADD COLUMN IF NOT EXISTS seccion_id UUID REFERENCES secciones(id);
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- 7. Seed Default Sections
INSERT INTO secciones (nombre, km_inicio, km_fin, color) 
SELECT 'Sección 1: La Boquilla - Km 25', 0, 25, '#3b82f6'
WHERE NOT EXISTS (SELECT 1 FROM secciones WHERE km_inicio = 0);

INSERT INTO secciones (nombre, km_inicio, km_fin, color) 
SELECT 'Sección 2: Km 25 - Km 50', 25, 50, '#10b981'
WHERE NOT EXISTS (SELECT 1 FROM secciones WHERE km_inicio = 25);

INSERT INTO secciones (nombre, km_inicio, km_fin, color) 
SELECT 'Sección 3: Km 50 - Km 75', 50, 75, '#f59e0b'
WHERE NOT EXISTS (SELECT 1 FROM secciones WHERE km_inicio = 50);

INSERT INTO secciones (nombre, km_inicio, km_fin, color) 
SELECT 'Sección 4: Km 75 - Fin (Km 104)', 75, 104, '#ef4444'
WHERE NOT EXISTS (SELECT 1 FROM secciones WHERE km_inicio = 75);

-- 8. Auto-Assign Sections to existing Points based on Km
UPDATE puntos_entrega 
SET seccion_id = s.id
FROM secciones s 
WHERE puntos_entrega.km >= s.km_inicio AND puntos_entrega.km < s.km_fin;

-- 9. Update Trigger Function for Spanish Names
CREATE OR REPLACE FUNCTION public.validate_flow_capacity()
RETURNS trigger AS $$
DECLARE
  max_cap numeric;
BEGIN
  SELECT capacidad_max INTO max_cap
  FROM public.puntos_entrega
  WHERE id = NEW.punto_id;

  IF NEW.valor_q > max_cap THEN
    RAISE EXCEPTION 'Violación de Hidráulica: El gasto ingresado (% m3/s) excede la capacidad de diseño (% m3/s) de la estructura.', NEW.valor_q, max_cap;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
