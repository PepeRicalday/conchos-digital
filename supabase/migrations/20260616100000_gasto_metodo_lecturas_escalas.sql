-- Columna real para el método de cálculo del gasto en lecturas_escalas.
-- Antes se anexaba como texto libre dentro de notas ("[gasto: curva nivel-gasto]"),
-- lo que impedía que PublicMonitor.tsx supiera cuándo debía respetar
-- gasto_calculado_m3s en vez de recalcular con calcRadialFlow (fórmula de
-- compuertas), causando sobreestimación en escalas con compuertas taponadas
-- (ej. K-0+000: curva 21.314 m³/s vs. compuertas recalculadas 46.077 m³/s).

ALTER TABLE lecturas_escalas
    ADD COLUMN IF NOT EXISTS gasto_metodo text
        CHECK (gasto_metodo IN ('compuertas_m1', 'curva_nivel'));

COMMENT ON COLUMN lecturas_escalas.gasto_metodo IS
    'Método usado para gasto_calculado_m3s: compuertas_m1 (fórmula de orificio/radiales) o curva_nivel (curva nivel-gasto aforada, robusta ante compuertas taponadas). Cuando es curva_nivel, el dashboard debe respetar gasto_calculado_m3s en vez de recalcular.';
