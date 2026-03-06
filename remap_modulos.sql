
-- RE-MAPEO DE MÓDULOS (ALINEACIÓN ID vs NOMBRE)
-- M1: MOD-001 (Correcto)
-- M12: MOD-002 -> MOD-012
-- M2: MOD-003 -> MOD-002
-- M3: MOD-004 -> MOD-003
-- M4: MOD-005 -> MOD-004
-- M5: MOD-006 -> MOD-005

BEGIN;

-- 1. Mover Módulo 12 de MOD-002 a temp y luego a MOD-012 (para liberar MOD-002)
UPDATE modulos SET id = 'TEMP-12' WHERE id = 'MOD-002';
UPDATE puntos_entrega SET modulo_id = 'TEMP-12' WHERE modulo_id = 'MOD-002';
UPDATE perfiles_usuario SET modulo_id = 'TEMP-12' WHERE modulo_id = 'MOD-002';
UPDATE autorizaciones_ciclo SET modulo_id = 'TEMP-12' WHERE modulo_id = 'MOD-002';
UPDATE modulos_ciclos SET modulo_id = 'TEMP-12' WHERE modulo_id = 'MOD-002';

-- 2. Mover Módulo 2 de MOD-003 a MOD-002
UPDATE modulos SET id = 'MOD-002' WHERE id = 'MOD-003';
UPDATE puntos_entrega SET modulo_id = 'MOD-002' WHERE modulo_id = 'MOD-003';
UPDATE perfiles_usuario SET modulo_id = 'MOD-002' WHERE modulo_id = 'MOD-003';
UPDATE autorizaciones_ciclo SET modulo_id = 'MOD-002' WHERE modulo_id = 'MOD-003';
UPDATE modulos_ciclos SET modulo_id = 'MOD-002' WHERE modulo_id = 'MOD-003';

-- 3. Mover Módulo 3 de MOD-004 a MOD-003
UPDATE modulos SET id = 'MOD-003' WHERE id = 'MOD-004';
UPDATE puntos_entrega SET modulo_id = 'MOD-003' WHERE modulo_id = 'MOD-004';
UPDATE perfiles_usuario SET modulo_id = 'MOD-003' WHERE modulo_id = 'MOD-004';
UPDATE autorizaciones_ciclo SET modulo_id = 'MOD-003' WHERE modulo_id = 'MOD-004';
UPDATE modulos_ciclos SET modulo_id = 'MOD-003' WHERE modulo_id = 'MOD-004';

-- 4. Mover Módulo 4 de MOD-005 a MOD-004
UPDATE modulos SET id = 'MOD-004' WHERE id = 'MOD-005';
UPDATE puntos_entrega SET modulo_id = 'MOD-004' WHERE modulo_id = 'MOD-005';
UPDATE perfiles_usuario SET modulo_id = 'MOD-004' WHERE modulo_id = 'MOD-005';
UPDATE autorizaciones_ciclo SET modulo_id = 'MOD-004' WHERE modulo_id = 'MOD-005';
UPDATE modulos_ciclos SET modulo_id = 'MOD-004' WHERE modulo_id = 'MOD-005';

-- 5. Mover Módulo 5 de MOD-006 a MOD-005
UPDATE modulos SET id = 'MOD-005' WHERE id = 'MOD-006';
UPDATE puntos_entrega SET modulo_id = 'MOD-005' WHERE modulo_id = 'MOD-006';
UPDATE perfiles_usuario SET modulo_id = 'MOD-005' WHERE modulo_id = 'MOD-006';
UPDATE autorizaciones_ciclo SET modulo_id = 'MOD-005' WHERE modulo_id = 'MOD-006';
UPDATE modulos_ciclos SET modulo_id = 'MOD-005' WHERE modulo_id = 'MOD-006';

-- 6. Finalmente mover Módulo 12 a su ID definitivo MOD-012
UPDATE modulos SET id = 'MOD-012' WHERE id = 'TEMP-12';
UPDATE puntos_entrega SET modulo_id = 'MOD-012' WHERE modulo_id = 'TEMP-12';
UPDATE perfiles_usuario SET modulo_id = 'MOD-012' WHERE modulo_id = 'TEMP-12';
UPDATE autorizaciones_ciclo SET modulo_id = 'MOD-012' WHERE modulo_id = 'TEMP-12';
UPDATE modulos_ciclos SET modulo_id = 'MOD-012' WHERE modulo_id = 'TEMP-12';

-- 7. Normalizar nombres y códigos cortos (Módulo X y MX)
UPDATE modulos SET nombre = 'Módulo 1', codigo_corto = 'M1' WHERE id = 'MOD-001';
UPDATE modulos SET nombre = 'Módulo 2', codigo_corto = 'M2' WHERE id = 'MOD-002';
UPDATE modulos SET nombre = 'Módulo 3', codigo_corto = 'M3' WHERE id = 'MOD-003';
UPDATE modulos SET nombre = 'Módulo 4', codigo_corto = 'M4' WHERE id = 'MOD-004';
UPDATE modulos SET nombre = 'Módulo 5', codigo_corto = 'M5' WHERE id = 'MOD-005';
UPDATE modulos SET nombre = 'Módulo 12', codigo_corto = 'M12' WHERE id = 'MOD-012';

COMMIT;
