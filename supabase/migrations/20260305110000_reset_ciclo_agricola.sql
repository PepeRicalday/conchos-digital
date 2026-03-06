-- 🚨 SICA: SCRIPT DE REINICIO DE CICLO AGRÍCOLA 🚨
-- Este script vacía las tablas transaccionales y reinicia los contadores.
-- Versión: 2025-Reset-v1
-- Fecha de Ejecución Planeada: 2026-03-05

BEGIN;

-- 1. Vaciar Tablas de Operación (Distribución de Agua)
TRUNCATE TABLE public.mediciones CASCADE;
TRUNCATE TABLE public.reportes_operacion CASCADE;
TRUNCATE TABLE public.reportes_diarios CASCADE;

-- 2. Vaciar Tablas de Escalas y Represos
TRUNCATE TABLE public.lecturas_escalas CASCADE;
TRUNCATE TABLE public.resumen_escalas_diario CASCADE;

-- 3. Vaciar Tablas de Hidrometría y Presas
TRUNCATE TABLE public.aforos CASCADE;
TRUNCATE TABLE public.lecturas_presas CASCADE;

-- 4. Reiniciar Contadores de Módulos (Volumen Acumulado a 0)
UPDATE public.modulos 
SET vol_acumulado = 0,
    actualizado_en = now();

-- 5. Registro de Auditoría (Opcional si existe tabla de logs)
-- INSERT INTO logs_sistema (evento, descripcion) VALUES ('RESET_CICLO', 'Reinicio completo de datos para el ciclo 2025-2026');

COMMIT;

-- Nota: Después de correr este script, los canales aparecerán "vacíos" en el Geo-Monitor 
-- y las escalas requerirán su primera lectura manual.
