-- ═══════════════════════════════════════════════════════════════════════════
-- NDVI MENSUAL POR MÓDULO — fracción de cobertura vegetal activa
-- Fecha: 2026-08-30
--
-- Agrega la columna que alimenta el IEHP (Índice de Eficiencia Hídrica
-- Productiva, src/utils/indicesSrl.ts): qué fracción del polígono del módulo
-- tiene NDVI ≥ 0.30 (umbral estándar de "cobertura vegetal activa" en
-- teledetección agrícola, distingue vegetación real de suelo desnudo/agua/
-- infraestructura). sentinel-ndvi-modulo-sync la calcula agregando un
-- segundo output binario al evalscript (1 si NDVI≥0.30, 0 si no) — el "mean"
-- que la Statistical API ya calcula sobre ese output ES la fracción de
-- píxeles activos, sin necesitar histograma con bins.
--
-- NULL para las filas ya existentes (marzo-agosto 2026, calculadas antes de
-- este cambio) — se completa re-corriendo el backfill de esos meses.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ndvi_modulo_historico
    ADD COLUMN IF NOT EXISTS fraccion_cobertura_activa NUMERIC;

COMMENT ON COLUMN public.ndvi_modulo_historico.fraccion_cobertura_activa IS
  'Fracción (0-1) de píxeles del polígono del módulo con NDVI≥0.30 (cobertura vegetal activa). Base de ha_activas = superficie_ha × esta fracción, usado por IEHP en src/utils/indicesSrl.ts.';
