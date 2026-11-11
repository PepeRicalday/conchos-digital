-- ═══════════════════════════════════════════════════════════════════════════
-- Datos del catálogo que se DERIVAN de las semillas (huellas KMZ y SINA).   Fecha: 2026-11-11
-- Idempotente: se puede volver a correr tras regenerar cualquiera de las dos semillas.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) NAMO / NAME por vigencia según SINA: una fila cada vez que el portal cambió el NAMO.
--    (El NAME de Boquilla y Madero oscila entre dos valores sin cambiar el NAMO: se guarda el del
--    primer mes de cada vigencia; el detalle diario queda en sina_presas_diario.)
INSERT INTO public.cuerpos_agua_caracteristicas
  (cuerpo_id, fuente, vigente_desde, namo_mm3, namo_msnm, name_mm3, name_msnm, corona_msnm, nota)
SELECT c.id, 'SINA', s.fecha, s.namo_mm3, s.namo_msnm, s.name_mm3, s.name_msnm, p.elev_corona_msnm,
       'Primer cierre de mes con este NAMO en el portal SINA'
FROM (
  SELECT d.*, lag(d.namo_mm3) OVER (PARTITION BY d.clave_sih ORDER BY d.fecha) AS namo_previo
  FROM public.sina_presas_diario d
) s
JOIN public.cuerpos_agua c ON c.clave_sih = s.clave_sih
LEFT JOIN public.sina_presas p ON p.clave_sih = s.clave_sih
WHERE s.namo_mm3 IS NOT NULL AND (s.namo_previo IS NULL OR abs(s.namo_mm3 - s.namo_previo) > 0.01)
ON CONFLICT (cuerpo_id, fuente, vigente_desde) DO UPDATE SET
  namo_mm3 = EXCLUDED.namo_mm3, namo_msnm = EXCLUDED.namo_msnm, name_mm3 = EXCLUDED.name_mm3,
  name_msnm = EXCLUDED.name_msnm, corona_msnm = EXCLUDED.corona_msnm;

-- NAMO y volumen muerto vigentes en AQWP (último valor publicado).
INSERT INTO public.cuerpos_agua_caracteristicas (cuerpo_id, fuente, vigente_desde, namo_mm3, muerto_mm3, nota)
SELECT c.id, 'AQWP', e.fecha, e.namo_mm3, e.muerto_mm3, 'Último NAMO publicado en el portal AQUARIUS'
FROM public.v_aqwp_presas_estado e
JOIN public.cuerpos_agua c ON c.aqwp_ubicacion_id = e.ubicacion_id
WHERE e.namo_mm3 IS NOT NULL AND e.fecha IS NOT NULL
ON CONFLICT (cuerpo_id, fuente, vigente_desde) DO UPDATE SET namo_mm3 = EXCLUDED.namo_mm3, muerto_mm3 = EXCLUDED.muerto_mm3;

-- Capacidad operativa del distrito (la que usan las pantallas de Presas).
INSERT INTO public.cuerpos_agua_caracteristicas (cuerpo_id, fuente, vigente_desde, namo_mm3, corona_msnm, nota)
SELECT c.id, 'SRL', DATE '2026-01-01', p.capacidad_max, p.elevacion_corona_msnm, 'presas.capacidad_max (operación del distrito)'
FROM public.presas p JOIN public.cuerpos_agua c ON c.presa_id = p.id
ON CONFLICT (cuerpo_id, fuente, vigente_desde) DO UPDATE SET namo_mm3 = EXCLUDED.namo_mm3, corona_msnm = EXCLUDED.corona_msnm;

-- Área de la huella máxima (KMZ) como característica.
INSERT INTO public.cuerpos_agua_caracteristicas (cuerpo_id, fuente, vigente_desde, nota)
SELECT g.cuerpo_id, 'KMZ', g.creado_en::date,
       'Huella máxima ' || g.area_km2 || ' km² (' || g.num_islas || ' islas, ' || g.area_islas_km2 || ' km² descontados)'
FROM public.cuerpos_agua_geometria g WHERE g.vigente AND g.tipo = 'huella_maxima'
ON CONFLICT (cuerpo_id, fuente, vigente_desde) DO UPDATE SET nota = EXCLUDED.nota;

-- 2) Parámetros del NDWI a partir de la huella: recuadro = envolvente + ~1 km; ancla = cortina (SINA).
--    La Colina no tiene cortina en SINA: su ancla es el centroide del vaso. Las anclas se afinan con dry_run.
--    Boquilla conserva los parámetros de la función (modo escena_max) hasta validar la huella KMZ.
UPDATE public.cuerpos_agua c SET
  ndwi_bbox = jsonb_build_array(
    round(((g.bbox->>0)::numeric - 0.010), 5), round(((g.bbox->>1)::numeric - 0.009), 5),
    round(((g.bbox->>2)::numeric + 0.010), 5), round(((g.bbox->>3)::numeric + 0.009), 5)),
  ndwi_ancla_lon = COALESCE(c.ndwi_ancla_lon, c.longitud, g.centroide_lon),
  ndwi_ancla_lat = COALESCE(c.ndwi_ancla_lat, c.latitud, g.centroide_lat),
  latitud  = COALESCE(c.latitud, g.centroide_lat),
  longitud = COALESCE(c.longitud, g.centroide_lon),
  coordenadas_fuente = COALESCE(c.coordenadas_fuente, 'Centroide del vaso (KMZ)'),
  satelite_activo = true
FROM public.cuerpos_agua_geometria g
WHERE g.cuerpo_id = c.id AND g.vigente AND g.tipo = 'huella_maxima';
