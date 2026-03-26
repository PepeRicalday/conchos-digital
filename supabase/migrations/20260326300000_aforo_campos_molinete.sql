-- ============================================================
-- Migración: Campos extendidos para Aforos por Molinete
-- Fecha: 2026-03-26
-- ============================================================

ALTER TABLE public.aforos
  -- Columnas ya enviadas por sync.ts (pueden o no existir en BD)
  ADD COLUMN IF NOT EXISTS plantilla_m           NUMERIC,
  ADD COLUMN IF NOT EXISTS talud_z               NUMERIC,
  ADD COLUMN IF NOT EXISTS tirante_calculo_m     NUMERIC,
  ADD COLUMN IF NOT EXISTS area_hidraulica_m2    NUMERIC,
  ADD COLUMN IF NOT EXISTS velocidad_media_ms    NUMERIC,
  ADD COLUMN IF NOT EXISTS froude                NUMERIC,

  -- Nuevas columnas para registro por molinete
  ADD COLUMN IF NOT EXISTS molinete_modelo       TEXT,
  ADD COLUMN IF NOT EXISTS molinete_serie        TEXT,
  ADD COLUMN IF NOT EXISTS aforador              TEXT,
  ADD COLUMN IF NOT EXISTS tirante_m             NUMERIC;

-- ------------------------------------------------------------
-- Comentarios en columnas existentes (sync.ts)
-- ------------------------------------------------------------
COMMENT ON COLUMN public.aforos.plantilla_m
  IS 'Ancho de plantilla de la sección trapezoidal (m)';

COMMENT ON COLUMN public.aforos.talud_z
  IS 'Talud lateral de la sección trapezoidal (z:1, adimensional)';

COMMENT ON COLUMN public.aforos.tirante_calculo_m
  IS 'Tirante hidráulico utilizado en el cálculo de gasto (m)';

COMMENT ON COLUMN public.aforos.area_hidraulica_m2
  IS 'Área hidráulica de la sección transversal (m²)';

COMMENT ON COLUMN public.aforos.velocidad_media_ms
  IS 'Velocidad media de la corriente en la sección (m/s)';

COMMENT ON COLUMN public.aforos.froude
  IS 'Número de Froude adimensional (Fr = V / sqrt(g·y))';

-- ------------------------------------------------------------
-- Comentarios en columnas nuevas (molinete)
-- ------------------------------------------------------------
COMMENT ON COLUMN public.aforos.molinete_modelo
  IS 'Modelo del molinete hidrométrico utilizado, p. ej. "ROSSBACH_PRICE"';

COMMENT ON COLUMN public.aforos.molinete_serie
  IS 'Número de serie del molinete hidrométrico, p. ej. "7320"';

COMMENT ON COLUMN public.aforos.aforador
  IS 'Nombre del ingeniero o técnico que realizó el aforo';

COMMENT ON COLUMN public.aforos.tirante_m
  IS 'Tirante y medido en campo (profundidad del agua, m)';

-- ------------------------------------------------------------
-- Verificación: columnas actuales de la tabla aforos
-- ------------------------------------------------------------
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'aforos'
ORDER BY ordinal_position;
