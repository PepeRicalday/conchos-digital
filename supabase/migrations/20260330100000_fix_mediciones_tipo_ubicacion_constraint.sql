-- ============================================================
-- Fix: ampliar constraint tipo_ubicacion en mediciones
-- Problema: measurements_location_type_check solo permitia
--   'canal' y 'dam' (valores del schema original en ingles).
--   puntos_entrega.tipo puede ser 'toma', 'lateral' o 'carcamo',
--   causando error al sincronizar desde SICA Capture.
-- Solucion: reemplazar el CHECK con valores completos.
-- ============================================================

-- Eliminar constraint antigua (nombre del tiempo en que la tabla
-- se llamaba 'measurements' y la columna 'location_type')
ALTER TABLE public.mediciones
  DROP CONSTRAINT IF EXISTS measurements_location_type_check;

-- Recrear con todos los valores validos del dominio actual
ALTER TABLE public.mediciones
  ADD CONSTRAINT mediciones_tipo_ubicacion_check
  CHECK (tipo_ubicacion IN ('toma', 'lateral', 'carcamo', 'canal', 'dam'));

COMMENT ON CONSTRAINT mediciones_tipo_ubicacion_check ON public.mediciones IS
  'Valores validos para tipo_ubicacion: toma, lateral, carcamo (puntos_entrega.tipo) '
  'y canal, dam (ubicaciones de escala/presa).';
