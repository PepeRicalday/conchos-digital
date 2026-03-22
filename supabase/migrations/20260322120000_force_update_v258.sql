-- Migración: Forzar actualización a v2.5.8 en todos los dispositivos
-- Objetivo: Incrementar min_supported_version para activar el banner de actualización
-- en dispositivos que aún ejecutan versiones anteriores (v2.4.x, v2.5.0, etc.)

-- Dashboard (conchos-digital)
UPDATE public.app_versions
SET
  version = '2.5.8',
  min_supported_version = '2.5.8',
  build_hash = 'v2.5.8',
  release_notes = 'Actualización obligatoria: correcciones de zona horaria, tipos Supabase y mejoras de estabilidad.',
  actualizado_en = now()
WHERE app_id = 'control-digital';

-- Capture (sica-capture)
UPDATE public.app_versions
SET
  version = '2.5.8',
  min_supported_version = '2.5.8',
  build_hash = 'v2.5.8',
  release_notes = 'Actualización obligatoria: ruta /nuke corregida, sincronización de versiones.',
  actualizado_en = now()
WHERE app_id = 'capture';
