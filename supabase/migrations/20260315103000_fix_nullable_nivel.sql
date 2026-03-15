-- Migración: Permitir niveles nulos en lecturas_escalas para registros de solo arribo
-- Fecha: 2026-03-15

ALTER TABLE public.lecturas_escalas 
ALTER COLUMN nivel_m DROP NOT NULL;

COMMENT ON COLUMN public.lecturas_escalas.nivel_m IS 
'Nivel de la escala en metros. Puede ser NULL para registros de solo arribo visual o notas de campo.';
