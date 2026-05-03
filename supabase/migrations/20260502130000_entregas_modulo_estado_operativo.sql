-- ── Continuidad de entregas: estado_operativo ────────────────────────
-- Las entregas siguen el mismo modelo que las tomas: flujo abierto
-- hasta modificación o cierre manual explícito.
-- El campo estado_operativo registra el ciclo de vida de cada fila.

ALTER TABLE public.entregas_modulo
    ADD COLUMN IF NOT EXISTS estado_operativo TEXT DEFAULT 'inicio'
    CHECK (estado_operativo IN ('inicio', 'continua', 'modificacion', 'cierre'));

-- Índice para que la vista de balance y los reportes filtren por estado rápido
CREATE INDEX IF NOT EXISTS idx_entregas_estado
    ON public.entregas_modulo (modulo_id, tipo_entrega, estado_operativo);
