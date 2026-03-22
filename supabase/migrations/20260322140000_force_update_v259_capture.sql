-- Migración: Forzar actualización a v2.5.9 para sica-capture
-- Objetivo: Activar banner de actualización en dispositivos con v2.5.8 o anterior
-- Correcciones incluidas en v2.5.9:
--   - Monitor: datos no aparecían en versión cloud tras login (race condition con auth)
--   - Distribución: gasto en L/s se mantenía como referencia tras guardar
--   - App.tsx: downloadCatalogs(true) se llama al establecer sesión de auth

-- Capture (sica-capture)
UPDATE public.app_versions
SET
  version = '2.5.9',
  min_supported_version = '2.5.9',
  build_hash = 'v2.5.9',
  release_notes = 'Corrección crítica: Monitor mostraba 0 en versión cloud. Gasto queda como referencia en Distribución.',
  actualizado_en = now()
WHERE app_id = 'capture';
