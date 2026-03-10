-- Migración: Actualización de Sistemas (Vercel & App Sync)
-- Objetivo: Incrementar la versión mínima soportada para forzar el banner de actualización en los clientes.

-- 1. Actualizar Dashboard (conchos-digital)
UPDATE public.app_versions 
SET 
  version = '1.5.1',
  min_supported_version = '1.5.1',
  actualizado_en = now() 
WHERE app_id = 'control-digital';

-- 2. Actualizar Capture (sica-capture)
UPDATE public.app_versions 
SET 
  version = '1.4.1', 
  min_supported_version = '1.4.1',
  actualizado_en = now() 
WHERE app_id = 'capture';

-- NOTA: Si las filas no existen (primera vez o re-instalación), este script puede fallar silenciosamente o no hacer nada.
-- Se asume que la tabla app_versions ya existe en el entorno de producción.
