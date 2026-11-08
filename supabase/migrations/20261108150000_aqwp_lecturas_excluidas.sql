-- Lecturas de ALMACENAMIENTO que se excluyen de toda estadística (vista de climatología y percentiles).
-- Son los 5 casos que detecta la regla de src/utils/aqwpCalidad.ts (filtrarAtipicos) sobre TODO el histórico, sin falsos
-- positivos (la regla se probó en SQL antes de sembrar):
--   · 2020-09-08: fila mezclada entre presas (Luis L. León 655.4 entre 100.5 y 101.0; Boquilla 216.7 entre 899.8 y 888.5;
--     Madero 1385.5 entre 116.7 y 113.1).
--   · 2023-05-31 Pico del Águila 21.7 (entre 36.7 y 31.5) y 2026-04-06 Madero 319.5 (entre 229.3 y 228.8).
-- La tabla es la FUENTE ÚNICA para SQL; el TS aplica la misma regla en vivo. Si se agrega un caso nuevo, va aquí.
-- No se borra nada de aqwp_lecturas_diarias: el dato original se conserva y solo se excluye del cálculo.
CREATE TABLE IF NOT EXISTS public.aqwp_lecturas_excluidas (
  ubicacion_id integer NOT NULL REFERENCES public.aqwp_ubicaciones (id_number) ON DELETE CASCADE,
  fecha        date    NOT NULL,
  valor_mm3    numeric,
  motivo       text    NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ubicacion_id, fecha)
);

ALTER TABLE public.aqwp_lecturas_excluidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read AQWP excluidas" ON public.aqwp_lecturas_excluidas;
CREATE POLICY "Public Read AQWP excluidas" ON public.aqwp_lecturas_excluidas FOR SELECT USING (true);

INSERT INTO public.aqwp_lecturas_excluidas (ubicacion_id, fecha, valor_mm3, motivo) VALUES
  (526, '2020-09-08',  655.411011, 'pico_aislado: fila mezclada entre presas (vecinos 100.459 y 100.967)'),
  (536, '2020-09-08',  216.660995, 'pico_aislado: fila mezclada entre presas (vecinos 899.839 y 888.506)'),
  (537, '2020-09-08', 1385.480957, 'pico_aislado: fila mezclada entre presas (vecinos 116.675 y 113.065; NAMO 333.3)'),
  (540, '2023-05-31',   21.727,    'pico_aislado (vecinos 36.716 y 31.516)'),
  (537, '2026-04-06',  319.462,    'pico_aislado (vecinos 229.343 y 228.808)')
ON CONFLICT (ubicacion_id, fecha) DO NOTHING;
