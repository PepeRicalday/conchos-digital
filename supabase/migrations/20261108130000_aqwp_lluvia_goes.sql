-- Lluvia GOES (CONAGUA vía USIBWC AQWP): 3 pluviómetros vivos de la cuenca del Conchos.
-- El portal publica "Precip Total", un ACUMULADO de pluviómetro cada 10–15 min con ruido y reinicios; aqwp-sync lo
-- convierte a mm por día (suma de incrementos positivos, ver precipitacionDiaria) y lo guarda en aqwp_lecturas_diarias
-- con magnitud 'precipitacion_dia'. valor NULL = día sin cobertura suficiente (S/D); 0 = día seco medido.
--
-- NO se ingesta el nivel/almacenamiento GOES de Luis L. León: está congelado (elevación 1025.43 m de mayo a septiembre,
-- 1018.78 m desde fines de septiembre; almacenamiento 117.5 Mm³ contra 57 Mm³ de CONAGUA diario). Babisas, Peguis y
-- Boca del Río están muertos en el portal (última transmisión 2022-2025 / sin rango).
INSERT INTO public.aqwp_ubicaciones (id_number, codigo, nombre, tipo, presa_id) VALUES
  (551, '08-VILLALBA-CONAGUA', 'Villalba (Río San Pedro)', 'precipitacion', NULL),
  (549, '08-LLNCH-Below-CONAGUA', 'Bajo Luis L. León', 'precipitacion', NULL)
ON CONFLICT (id_number) DO UPDATE SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo;

INSERT INTO public.aqwp_datasets (id_number, ubicacion_id, titulo, magnitud, unidad, desde) VALUES
  (13178, 551, 'Precip Total.GOES-Telemetry-CONAGUA@08-VILLALBA-CONAGUA',    'precipitacion_dia', 'mm', '2021-09-04'),
  (13170, 526, 'Precip Total.GOES-Telemetry-CONAGUA@08-LLNCH-CONAGUA',       'precipitacion_dia', 'mm', '2021-11-20'),
  (13172, 549, 'Precip Total.GOES-Telemetry-CONAGUA@08-LLNCH-Below-CONAGUA', 'precipitacion_dia', 'mm', '2021-09-04')
ON CONFLICT (id_number) DO UPDATE SET titulo = EXCLUDED.titulo, magnitud = EXCLUDED.magnitud, unidad = EXCLUDED.unidad, desde = EXCLUDED.desde;
