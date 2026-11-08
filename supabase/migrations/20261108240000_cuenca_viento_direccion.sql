-- Dirección dominante del viento (grados desde donde sopla, convención meteorológica) en el pronóstico de la cuenca. JCAS no entrega dirección,
-- así que solo el pronóstico dibuja flechas. NULL = S/D (nunca 0: 0° es norte).
ALTER TABLE public.cuenca_pronostico_diario ADD COLUMN IF NOT EXISTS viento_dir_deg numeric CHECK (viento_dir_deg IS NULL OR (viento_dir_deg >= 0 AND viento_dir_deg <= 360));

-- La vista usa d.*: se recrea para que incluya la columna nueva.
CREATE OR REPLACE VIEW public.v_cuenca_pronostico_vigente WITH (security_invoker = true) AS
SELECT DISTINCT ON (d.punto_id, d.modelo, d.fecha) d.*
FROM public.cuenca_pronostico_diario d
WHERE d.fecha >= (now() AT TIME ZONE 'America/Chihuahua')::date
ORDER BY d.punto_id, d.modelo, d.fecha, d.corrida_en DESC;
