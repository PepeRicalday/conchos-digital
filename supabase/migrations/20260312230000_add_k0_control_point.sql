-- Migración: Agregar Punto de Control Kilómetro 0.000 (Origen Canal Principal)
-- Objetivo: Facilitar el control de inicio del proceso de llenado.

INSERT INTO public.escalas (
    id, 
    nombre, 
    km, 
    seccion_id, 
    canal_id, 
    latitud, 
    longitud, 
    activa, 
    nivel_min_operativo, 
    nivel_max_operativo, 
    capacidad_max, 
    ancho, 
    alto, 
    pzas_radiales,
    coeficiente_descarga,
    exponente_n
) VALUES (
    'ESC-000', 
    'Kilometro 0.000', 
    0.000, 
    'SEC-001', -- Siguiendo la solicitud del usuario
    'CAN-001', 
    27.667993, 
    -105.209855, 
    true, 
    2.7, -- Valores base para control de inicio
    3.2, 
    70.4, -- Capacidad de diseño a la entrada
    13.3, -- Plantilla m
    4.0, 
    0, 
    0,
    0
) ON CONFLICT (id) DO UPDATE SET 
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    seccion_id = EXCLUDED.seccion_id,
    latitud = EXCLUDED.latitud,
    longitud = EXCLUDED.longitud;
