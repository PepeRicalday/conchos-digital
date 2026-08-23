-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: % de llenado desalineado en las lecturas de marzo/agosto (PRE-001)
-- Fecha: 2026-08-23
--
-- La migración 20260823120000 se aplicó con una copia anterior del archivo
-- (38.05% / 22.72%, calculados contra el capacidad_max VIEJO 2846.780) en
-- vez de la versión final recalculada contra el NAMO oficial 2893.571 ya
-- aplicado por 20260823110000. Corrige solo porcentaje_llenado — el resto
-- de columnas (escala, almacenamiento) ya eran correctas.
--
--   7-mar-2026:  38.05% → 37.44%  (1083.212 / 2893.571)
--   19-ago-2026: 22.72% → 22.35%  (646.69   / 2893.571)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.lecturas_presas
SET porcentaje_llenado = 37.44,
    notas = 'Reporte de apertura de ciclo agrícola — carga retroactiva para Manejo de Vaso (informe institucional). % recalculado vs. NAMO oficial 2893.571 Mm³ (reporte original: 38.05% contra capacidad_max previa 2846.780).'
WHERE presa_id = 'PRE-001' AND fecha = '2026-03-07';

UPDATE public.lecturas_presas
SET porcentaje_llenado = 22.35,
    notas = 'Reporte más reciente al 19-ago-2026 — carga retroactiva para Manejo de Vaso (informe institucional). % recalculado vs. NAMO oficial 2893.571 Mm³ (reporte original: 22.72% contra capacidad_max previa 2846.780).'
WHERE presa_id = 'PRE-001' AND fecha = '2026-08-19';

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado
-- FROM lecturas_presas WHERE presa_id='PRE-001' AND fecha IN ('2026-03-07','2026-08-19')
-- ORDER BY fecha;
