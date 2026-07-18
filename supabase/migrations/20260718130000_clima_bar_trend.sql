-- Añade la tendencia barométrica (predictor de tiempo) a las lecturas de clima.
-- bar_trend de Davis (inHg/3h) convertido a hPa/3h: >0 sube (estable/mejora),
-- <0 baja (probable deterioro/lluvia). Base para el nowcasting a 24 h.
ALTER TABLE public.clima_estacion_lecturas
  ADD COLUMN IF NOT EXISTS bar_trend_hpa NUMERIC;

COMMENT ON COLUMN public.clima_estacion_lecturas.bar_trend_hpa IS
  'Tendencia barométrica (hPa/3h): >0 estable/mejora, <0 probable lluvia. Predictor nowcasting 24h.';
