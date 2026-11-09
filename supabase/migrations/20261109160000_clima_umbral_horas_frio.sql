-- Umbral de «hora frío» editable junto al resto de los umbrales climáticos. aviso = temperatura (°C) por debajo de la cual una hora cuenta como hora frío
-- (7.2 °C, definición clásica); critico = hora de helada (0 °C). Ninguna alerta lo usa todavía: solo lo lee fn_cuenca_horas_frio vía el cliente (p_umbral).
INSERT INTO public.clima_umbrales (clave, etiqueta, comparador, aviso, critico, unidad, accion, activo)
VALUES ('horas_frio', 'Hora frío (T ≤ aviso) y hora de helada (T ≤ crítico)', 'menor', 7.2, 0, '°C',
        'Acumular horas frío para frutales y nogal; proteger de heladas.', true)
ON CONFLICT (clave) DO NOTHING;
