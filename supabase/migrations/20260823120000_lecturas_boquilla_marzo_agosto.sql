-- ═══════════════════════════════════════════════════════════════════════════
-- LECTURAS DE CAMPO — PRESA LA BOQUILLA (PRE-001)
-- Fecha: 2026-08-23
--
-- Dos reportes de escala/almacenamiento compartidos por el usuario para
-- anclar la nueva estructura de Manejo de Vaso a lecturas de campo reales:
--
--   7-mar-2026  (apertura del ciclo agrícola, reporte visual del operador)
--     Escala 1,302.60 msnm · Almacenamiento 1,083.212 Mm³
--
--   19-ago-2026 (reporte más reciente al momento de esta migración)
--     Escala 1,296.01 msnm · Almacenamiento 646.69 Mm³
--
-- El % de llenado reportado originalmente por el usuario (38.05% / 22.72%)
-- estaba calculado contra el capacidad_max VIEJO de la presa (2846.780 Mm³,
-- valor sin fuente clara, reemplazado en la migración anterior
-- 20260823110000 por el NAMO oficial CONAGUA 2893.571 Mm³). Para que el %
-- guardado aquí cuadre con el nuevo capacidad_max en toda la UI (que relee
-- almacenamiento/capacidad_total dinámicamente), se recalculó contra el
-- NAMO oficial: 1083.212/2893.571 = 37.44% · 646.69/2893.571 = 22.35%.
--
-- Se insertan solo si la fecha no existe ya para PRE-001 (ON CONFLICT no
-- aplica por no haber UNIQUE(presa_id, fecha) en lecturas_presas — se
-- verifica con NOT EXISTS para no duplicar si ya se capturaron por otra vía
-- entre la fecha de esta migración y su aplicación).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.lecturas_presas (id, presa_id, fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado, notas)
SELECT gen_random_uuid(), 'PRE-001', '2026-03-07', 1302.60, 1083.212, 37.44,
       'Reporte de apertura de ciclo agrícola — carga retroactiva para Manejo de Vaso (informe institucional). % recalculado vs. NAMO oficial 2893.571 Mm³ (reporte original: 38.05% contra capacidad_max previa 2846.780).'
WHERE NOT EXISTS (
    SELECT 1 FROM public.lecturas_presas WHERE presa_id = 'PRE-001' AND fecha = '2026-03-07'
);

INSERT INTO public.lecturas_presas (id, presa_id, fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado, notas)
SELECT gen_random_uuid(), 'PRE-001', '2026-08-19', 1296.01, 646.69, 22.35,
       'Reporte más reciente al 19-ago-2026 — carga retroactiva para Manejo de Vaso (informe institucional). % recalculado vs. NAMO oficial 2893.571 Mm³ (reporte original: 22.72% contra capacidad_max previa 2846.780).'
WHERE NOT EXISTS (
    SELECT 1 FROM public.lecturas_presas WHERE presa_id = 'PRE-001' AND fecha = '2026-08-19'
);

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT fecha, escala_msnm, almacenamiento_mm3, porcentaje_llenado, notas
-- FROM lecturas_presas WHERE presa_id='PRE-001' AND fecha IN ('2026-03-07','2026-08-19')
-- ORDER BY fecha;
