-- Migración: Actualización Crítica de Sistemas (Sincronía Maestro-Radiales)
-- Fecha: 2026-03-15 (Revision 4)
-- Objetivo: Forzar a todos los dispositivos a la versión 1.7.6 / 1.5.6 para asegurar la sincronía de aperturas radiales y velocidades calibradas.

-- 1. Actualizar Dashboard (conchos-digital)
UPDATE public.app_versions 
SET 
  version = '1.7.6',
  min_supported_version = '1.7.6',
  actualizado_en = now(),
  release_notes = 'HIDRO-SYNC V2: Sincronización robusta de compuertas radiales y calibración dinámica de velocidad.'
WHERE app_id = 'control-digital';

-- 2. Actualizar Capture (sica-capture)
UPDATE public.app_versions 
SET 
  version = '1.5.6', 
  min_supported_version = '1.5.6',
  actualizado_en = now(),
  release_notes = 'COMPATIBILIDAD V2: Reporte de aperturas mejorado para telemetría en tiempo real.'
WHERE app_id = 'capture';
