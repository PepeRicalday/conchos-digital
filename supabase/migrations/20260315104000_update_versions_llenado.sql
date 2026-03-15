-- Migración: Actualización de Sistemas (Vercel & App Sync)
-- Fecha: 2026-03-15 (Revision 2)
-- Objetivo: Incrementar la versión para forzar actualización con lógica de 'Arribo Único'.

-- 1. Actualizar Dashboard (conchos-digital)
UPDATE public.app_versions 
SET 
  version = '1.7.0',
  min_supported_version = '1.6.0', -- Tolerancia
  actualizado_en = now() 
WHERE app_id = 'control-digital';

-- 2. Actualizar Capture (sica-capture)
UPDATE public.app_versions 
SET 
  version = '1.5.1', 
  min_supported_version = '1.4.0', -- Permitir 1.4.8 mientras se propaga
  actualizado_en = now() 
WHERE app_id = 'capture';
