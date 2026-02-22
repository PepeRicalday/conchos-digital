-- Force Rename Columns (modulos)
DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN acu_name TO nombre_acu;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN short_code TO codigo_corto;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN authorized_vol TO vol_autorizado;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE modulos RENAME COLUMN accumulated_vol TO vol_acumulado;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Force Rename Columns (puntos_entrega)
DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN module_id TO modulo_id;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN capacity TO capacidad_max;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN capacity_max TO capacidad_max;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN coordinates_x TO coords_x;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN coordinates_y TO coords_y;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE puntos_entrega RENAME COLUMN type TO tipo;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Force Rename Columns (mediciones)
DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN value_q TO valor_q;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN value_vol TO valor_vol;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE mediciones RENAME COLUMN location_id TO punto_id;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Update Trigger Function again to be sure
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
