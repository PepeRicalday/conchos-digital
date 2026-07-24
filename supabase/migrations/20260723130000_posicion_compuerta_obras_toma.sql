-- Posición de compuerta por obra de toma en movimientos_presas
-- Objetivo: registrar la posición reportada en campo (ej. "1/10", "3/10")
-- junto al gasto en m³/s ya capturado por obra de toma.
--
-- Nota: es un dato de TRAZABILIDAD, no de cálculo — a diferencia de las
-- compuertas radiales de canal (que sí tienen curva calibrada posición→
-- gasto), no existe hoy una curva equivalente para obras de toma de presa.
-- El gasto real sigue viniendo de la medición directa en m³/s.

ALTER TABLE public.movimientos_presas
    ADD COLUMN IF NOT EXISTS posiciones_compuerta JSONB;

COMMENT ON COLUMN public.movimientos_presas.posiciones_compuerta IS
    'Posición de compuerta por obra reportada en campo, ej. {"tomaBaja": "1/10"}. Solo trazabilidad, no deriva el gasto.';
