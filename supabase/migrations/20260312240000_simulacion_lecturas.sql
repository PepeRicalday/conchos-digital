
-- Script para desactivar el trigger problemático que busca la tabla 'dams'
-- Ejecutar MANUALMENTE en el SQL Editor de Supabase
-- Explicación: El sistema está intentando ejecutar 'fn_update_canal_status()' cada vez que insertamos
-- una lectura de escala, pero esta función busca una tabla 'dams' que no existe en esta versión de SICA (usa presas).

-- 1. Desactivar el trigger en lecturas_escalas
DROP TRIGGER IF EXISTS trg_update_canal_status ON public.lecturas_escalas;
-- (O intenta borrar la función directa si no se usa)
-- DROP FUNCTION IF EXISTS public.fn_update_canal_status() CASCADE;

-- 2. Insertar LECTURA ESC-000 (Kilómetro 0.000)
INSERT INTO public.lecturas_escalas (
    escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas
) VALUES (
    'ESC-000', timezone('America/Chihuahua'::text, now())::date,
    'am', 3.10, '08:00:00', 'SICA Bot', 'Lectura inicial'
) ON CONFLICT (escala_id, fecha, turno) DO UPDATE SET nivel_m = EXCLUDED.nivel_m;

-- 3. Insertar LECTURA ESC-001 (K-23)
INSERT INTO public.lecturas_escalas (
    escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas
) VALUES (
    'ESC-001', timezone('America/Chihuahua'::text, now())::date,
    'am', 2.85, '10:00:00', 'SICA Bot', 'Lectura de llegada'
) ON CONFLICT (escala_id, fecha, turno) DO UPDATE SET nivel_m = EXCLUDED.nivel_m;
