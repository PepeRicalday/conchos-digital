-- 1. Insert missed records manually because the script deleted `EXTRACT(HOUR) = 0` which might have included our good ones if we miscalculated local offset
INSERT INTO public.mediciones (
    punto_id, 
    valor_q, 
    fecha_hora, 
    estado_evento, 
    tipo_ubicacion, 
    notas
)
SELECT 
    punto_id, 
    caudal_promedio, 
    (fecha::timestamp AT TIME ZONE 'America/Chihuahua') AT TIME ZONE 'America/Chihuahua', -- esto da las 12am locales guardadas correctamente (06:00 UTC)
    'continua',
    'canal',
    'Autogenerado (Continuidad de Medianoche)'
FROM public.reportes_operacion
WHERE fecha = '2026-03-05' 
  AND estado = 'continua' 
  AND caudal_promedio > 0
ON CONFLICT DO NOTHING;
