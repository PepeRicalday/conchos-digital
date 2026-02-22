-- Final Spanish Polish
-- modulos
DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN name TO nombre;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN target_flow TO caudal_objetivo;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- puntos_entrega
DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN name TO nombre;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN zone TO zona;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN section TO seccion_texto;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- mediciones
DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN location_type TO tipo_ubicacion;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN notes TO notas;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- presas
DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN name TO nombre;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN code TO codigo;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN capacity_max TO capacidad_max;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN capacity_current TO capacidad_actual;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN level_current TO nivel_actual;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE presas RENAME COLUMN extraction_rate TO tasa_extraccion;
EXCEPTION WHEN undefined_column THEN NULL; END $$;
