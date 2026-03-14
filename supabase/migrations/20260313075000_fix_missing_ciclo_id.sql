
-- Fix: Asegurar columna ciclo_id en sica_llenado_seguimiento
-- Fecha: 2026-03-13
-- Esta migración corrige el error de "ciclo_id column not found in schema cache"

ALTER TABLE public.sica_llenado_seguimiento 
ADD COLUMN IF NOT EXISTS ciclo_id TEXT REFERENCES public.ciclos_agricolas(id);

CREATE INDEX IF NOT EXISTS idx_llenado_seg_ciclo ON public.sica_llenado_seguimiento(ciclo_id, km);
