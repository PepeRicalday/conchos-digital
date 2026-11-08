-- Elevación real (DEM Copernicus GLO-90 vía Open-Meteo, scripts/cuenca_dem_grid.mjs) de las estaciones JCAS sincronizadas.
-- La altitud que reporta JCAS no es confiable (Balleza: 2,902 m vs 1,570 m del DEM; Satevó y San Juanito no la traen):
-- todo ajuste por altitud usa elevacion_dem_m. altitud_discrepante = JCAS ausente o a más de 300 m del DEM.
ALTER TABLE public.jcas_estaciones ADD COLUMN IF NOT EXISTS elevacion_dem_m numeric;
ALTER TABLE public.jcas_estaciones ADD COLUMN IF NOT EXISTS altitud_discrepante boolean NOT NULL DEFAULT false;
UPDATE public.jcas_estaciones e SET elevacion_dem_m = v.m FROM (VALUES (2, 1415), (3, 1387), (4, 1522), (5, 1226), (6, 1761), (7, 1343), (8, 1380), (9, 1570), (13, 1466), (18, 1274), (19, 1217), (25, 2402), (28, 1652), (30, 801), (31, 1423), (33, 1663), (38, 1655), (44, 1420)) AS v(id, m) WHERE e.id_jcas = v.id;
UPDATE public.jcas_estaciones SET altitud_discrepante = (elevacion_dem_m IS NOT NULL AND (altitud_m IS NULL OR abs(altitud_m - elevacion_dem_m) > 300));
