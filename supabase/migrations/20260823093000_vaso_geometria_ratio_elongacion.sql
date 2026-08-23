-- ═══════════════════════════════════════════════════════════════════════════
-- MANEJO DE VASO — ratio_elongacion (KPI legible) — SICA-005
-- Fecha: 2026-08-23
--
-- Añade a vaso_geometria_historico (creada en 20260823090000) un segundo KPI
-- de forma junto a indice_compacidad: el índice de Polsby-Popper (0.0166 para
-- La Boquilla) es el estándar de morfometría pero no se lee de forma
-- intuitiva. ratio_elongacion es el mismo dato expresado como "cuántas veces
-- más perímetro tiene el vaso respecto al círculo de su misma área" —
-- 7.8x para La Boquilla, legible sin entrenamiento previo.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vaso_geometria_historico
  ADD COLUMN IF NOT EXISTS ratio_elongacion NUMERIC;

COMMENT ON COLUMN public.vaso_geometria_historico.ratio_elongacion IS
  'perímetro_real / perímetro_de_un_círculo_de_igual_área. Lectura intuitiva del mismo dato que indice_compacidad — 1.0=compacto, sube con forma dendrítica/alargada.';
