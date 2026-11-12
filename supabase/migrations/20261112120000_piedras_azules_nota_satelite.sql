-- Piedras Azules (CA-PAZCH): nota con el hallazgo satelital. Ya aplicada vía SQL el 2026-11-12 (sin db push: hay drift).
-- El SINA repetía 6.25 Mm³ desde feb-2023 y se detuvo el 2025-04-23; Sentinel-2 y color real (2026-09-20) muestran el vaso seco.
UPDATE public.cuerpos_agua SET nota =
  'Sin serie en AQWP: almacenamiento S/D desde mayo de 2025 (el portal SINA dejó de actualizarse el 2025-04-23; su último valor, 6.25 Mm³, llevaba 26 meses idéntico y no es una medición). Sentinel-2 (abr–sep 2026) mide un espejo de 0.006–0.021 km² frente a 2.05 km² del vaso a NAMO (<1 %) y la imagen de color real del 20-sep-2026 muestra el vaso seco: no hay volumen medido, pero hoy está prácticamente vacío. Pendiente: lectura de escala de CONAGUA/CILA/ACU.'
WHERE id = 'CA-PAZCH';
