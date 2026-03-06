-- LIMPIEZA DE DATOS INCORRECTOS (Eliminaremos los generados erróneamente con UTC como 6pm)
DELETE FROM public.mediciones 
WHERE notas LIKE '%Sincronía%' AND EXTRACT(HOUR FROM fecha_hora AT TIME ZONE 'UTC') = 0;

DELETE FROM public.lecturas_escalas
WHERE notas LIKE '%Sincronía%' AND hora_lectura = '00:00:00';
