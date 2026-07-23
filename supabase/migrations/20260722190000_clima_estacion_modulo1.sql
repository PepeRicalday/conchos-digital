-- ═══════════════════════════════════════════════════════════════════════════
-- ALTA DE ESTACIÓN CLIMÁTICA "Modulo1" (WeatherLink) — SICA-005
-- Fecha: 2026-07-22
--
-- Quinta estación de la red WeatherLink incorporada al Centro de Inteligencia
-- Agroclimática, cubriendo el Módulo 1 (Zona 1) del Distrito de Riego 005.
--
--   · Modulo1 (station_id 242657) → Módulo 1 de riego, Estación Conchos
--
-- NOTA — existe una segunda entrada en la cuenta WeatherLink llamada
-- "MODULO 1 CONCHOS" (station_id 241555) que corresponde a un logger sin
-- conexión (recording_interval=0, sin firmware reportado): NO se usa. La
-- estación viva y con datos en tiempo real es station_id 242657 ("Modulo1").
--
-- NOTA elevación: igual que Boquilla/Módulo 3/Módulo 5, el campo `elevation`
-- que reporta la API para este gateway (6313) viene corrupto (13081 m, valor
-- imposible en la zona Delicias/Conchos ≈1200 m). Se usa una elevación
-- geográfica real, coherente con Módulo 3 (1200 m) y Módulo 5 (1190 m), ambos
-- muy próximos a Estación Conchos.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.clima_estaciones
  (station_id, station_uuid, nombre, latitud, longitud, elevacion_msnm, ciudad, presa_id, modulo_id, rol, prioridad)
VALUES
  (242657, 'fa6592b4-814f-4525-a9ef-f8653d11098e', 'Módulo 1', 27.976192, -105.28642, 1195, 'Estación Conchos', NULL, 'MOD-001', 'modulo', 25)
ON CONFLICT (station_id) DO UPDATE SET
  nombre = EXCLUDED.nombre, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  elevacion_msnm = EXCLUDED.elevacion_msnm, ciudad = EXCLUDED.ciudad,
  presa_id = EXCLUDED.presa_id, modulo_id = EXCLUDED.modulo_id, rol = EXCLUDED.rol,
  prioridad = EXCLUDED.prioridad, actualizado_en = now();

-- Completa zona_id de la nueva estación desde modulo_zonas (zona primaria: MOD-001 → Z1).
UPDATE public.clima_estaciones ce
SET zona_id = mz.zona_id
FROM public.modulo_zonas mz
WHERE ce.modulo_id = mz.modulo_id AND mz.es_primaria = true AND ce.zona_id IS NULL;
