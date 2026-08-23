-- ═══════════════════════════════════════════════════════════════════════════
-- REFERENCIA HISTÓRICA DE MÁXIMA EXTENSIÓN — vaso_geometria_historico
-- Fecha: 2026-08-23
--
-- Agrega es_referencia_historica: distingue filas del ciclo agrícola actual
-- (marzo→agosto 2026, cron mensual) de registros de referencia puntual como
-- la máxima extensión histórica del vaso (~1-sep-2017, la fecha más cercana
-- con escena Sentinel-2 utilizable se resuelve en la invocación de
-- sentinel-ndwi-vaso-sync con { fecha_referencia: "2017-09-01" }).
--
-- Por qué NO se mezcla con el ciclo actual: pct_del_maximo_ciclo y
-- delta_area_km2/delta_perimetro_km de las filas 2026 se calculan contra el
-- histórico de ESE ciclo — mezclar un registro de 2017 (área mucho mayor)
-- rompería esa semántica sin aportar nada útil a la tendencia mensual. La
-- fila de referencia se guarda con delta_area_km2, delta_perimetro_km y
-- pct_del_maximo_ciclo en NULL (no aplican) y se consume aparte en el
-- frontend, no dentro de opcionesSerieMensual.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vaso_geometria_historico
  ADD COLUMN IF NOT EXISTS es_referencia_historica BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vaso_geometria_historico.es_referencia_historica IS
  'true = registro de referencia puntual (ej. máxima extensión histórica), excluido de la serie/tendencia del ciclo agrícola actual y de pct_del_maximo_ciclo/delta_*.';

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT fecha_escena, area_km2, es_referencia_historica FROM vaso_geometria_historico
-- WHERE presa_id='PRE-001' ORDER BY fecha_escena;
