-- ACTUALIZACIÓN DE VERSIONES EN LA NUBE
-- SICA v2.3.0
-- Este script sincroniza las versiones mostradas en el Dashboard con el despliegue actual.

UPDATE app_versions 
SET version = '2.3.0', actualizado_en = now() 
WHERE app_id IN ('control-digital', 'capture');
