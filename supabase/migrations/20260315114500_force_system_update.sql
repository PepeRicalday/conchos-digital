-- Migración: Actualización Forzada de Sistemas (Calibración Hidráulica)
-- Fecha: 2026-03-15 (Revision 3)
-- Objetivo: Forzar a todos los dispositivos a la versión 1.7.5 / 1.5.5 para asegurar la paridad de datos reales.

-- 1. Actualizar Dashboard (conchos-digital)
UPDATE public.app_versions 
SET 
  version = '1.7.5',
  min_supported_version = '1.7.5', -- Bloqueo de versiones antiguas
  actualizado_en = now(),
  release_notes = 'CALIBRACIÓN HIDRÁULICA: Sincronización de reportes de campo y lógica de tránsito v1.7.5'
WHERE app_id = 'control-digital';

-- 2. Actualizar Capture (sica-capture)
UPDATE public.app_versions 
SET 
  version = '1.5.5', 
  min_supported_version = '1.5.5', -- Forzar actualización inmediata
  actualizado_en = now(),
  release_notes = 'Compatibilidad total con calibración v1.7.5'
WHERE app_id = 'capture';
