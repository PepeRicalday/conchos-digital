-- Babisas, Boca del Rio y Madero-Virgenes mandan 3 lecturas por mensaje horario separadas 20 min
-- (no 15): en la frontera entre mensajes, temperatura y viento cambian igual que dentro del mensaje
-- (razon 0.94-1.10), lo que solo ocurre con espaciado uniforme. Ojinaga (4 lecturas) si es de 15 min.
-- Tras este cambio se borraron y recargaron 30 dias de esas tres estaciones con goes-dcp-sync.
UPDATE public.hidro_estaciones SET intervalo_min = 20
WHERE id IN ('C63009B2', 'C6301416', 'C6301AC4') AND intervalo_min <> 20;
