-- Evaporación de agua libre de los vasos con estación propia (Boquilla y Las Vírgenes) — etapa 1 del plan de macromedición.
--
-- POR QUÉ: clima_presas.evaporacion_mm NO es evaporación de agua: es la ETo (et_dia_mm) de la estación WeatherLink
-- (correlación 1.000 con clima_estacion_lecturas.et_dia_mm). La ETo es la demanda de un pasto de referencia; un espejo de agua
-- evapora ~30 % más (razón Penman/ETo medida 1.28-1.45 en jul-nov 2026). Las estaciones SÍ miden lo necesario
-- (temperatura, humedad, radiación solar, viento y elevación), así que se calcula Penman de agua libre.
--
-- MÉTODO (por día local de Chihuahua, una media por hora para no sesgar por muestreo irregular; mínimo 11 horas con dato):
--   E = Δ/(Δ+γ) · Rn/λ  +  γ/(Δ+γ) · 2.6 · (1 + 0.536·u) · (es − ea)          [mm/día]   (Penman 1963, forma FAO-56)
--   Rn = (1 − 0.08)·Rs − Rnl     albedo de agua 0.08; Rnl de FAO-56 con Rso = (0.75 + 2e-5·z)·Ra
--   P (presión) se obtiene de la elevación: presion_hpa de WeatherLink está reducida a nivel del mar y NO sirve para γ.
--   u = viento_ms de la estación tal cual (la altura del anemómetro no está documentada).
-- LÍMITES DECLARADOS: se usa la temperatura del AIRE como si fuera la del agua y no hay almacenamiento de calor del vaso
-- (en vasos profundos subestima en otoño y sobreestima en primavera). Rango mensual: bajo = ETo de la estación (coeficiente 1.0,
-- cota inferior: el agua libre evapora más que el pasto) y alto = Penman + 15 % (incertidumbre típica del método).
-- Superficie: curva oficial de capacidad a la cota del día (fn_nivel_presa_en_fecha + fn_area_curva_km2); en Boquilla el espejo
-- satelital sale 18-20 % menor que la curva, así que la cifra es un máximo plausible.
-- NO cierra el balance: la aportación de CONAGUA se deduce de la operación del vaso y ya lleva la evaporación implícita;
-- restarla al residuo daría un error falso. Por eso error_cierre_mm3 se deja S/D. Es una columna informativa.
--
-- Sin estación no hay cifra (S/D): solo PRE-001 y PRE-002. Antes del 2026-07-17 no hay lecturas de estación.

ALTER TABLE public.cuerpos_agua_balance_mensual
  ADD COLUMN IF NOT EXISTS evap_bajo_mm3 numeric,
  ADD COLUMN IF NOT EXISTS evap_alto_mm3 numeric,
  ADD COLUMN IF NOT EXISTS evap_dias     integer,
  ADD COLUMN IF NOT EXISTS evap_lamina_mm numeric;

COMMENT ON COLUMN public.cuerpos_agua_balance_mensual.evap_mm3 IS
  'Evaporación de agua libre (Penman) × superficie de la curva a la cota del día, Mm³. INFORMATIVA: no cierra el balance (la aportación CONAGUA ya la lleva implícita). S/D sin estación o con < 50 % de los días.';

CREATE TABLE IF NOT EXISTS public.cuerpos_agua_evaporacion_dia (
  presa_id      text    NOT NULL,
  fecha         date    NOT NULL,                 -- día local de Chihuahua
  station_id    integer NOT NULL,
  horas         integer NOT NULL,                 -- horas del día con lectura
  evap_mm       numeric NOT NULL,                 -- Penman de agua libre
  eto_mm        numeric,                          -- ETo de la estación (cota inferior)
  nivel_msnm    numeric,
  area_km2      numeric,                          -- curva oficial a ese nivel; S/D si no hay nivel o está fuera de curva
  metodo        text    NOT NULL DEFAULT 'penman_agua_libre_v1',
  calculado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (presa_id, fecha)
);
ALTER TABLE public.cuerpos_agua_evaporacion_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read evaporacion dia" ON public.cuerpos_agua_evaporacion_dia;
CREATE POLICY "Public Read evaporacion dia" ON public.cuerpos_agua_evaporacion_dia FOR SELECT USING (true);

-- ── Evaporación diaria (idempotente) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_evaporacion_dia_recalcular(
  p_desde date DEFAULT DATE '2026-07-01',
  p_hasta date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  p_hasta := COALESCE(p_hasta, (now() AT TIME ZONE 'America/Chihuahua')::date);

  WITH h AS (
    SELECT e.station_id, e.presa_id, e.latitud::float AS lat, e.elevacion_msnm::float AS z,
           (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia,
           extract(hour FROM l.ts AT TIME ZONE 'America/Chihuahua')::int AS hr,
           avg(l.temp_c)::float AS t, avg(l.hum_rel_pct)::float AS rh, avg(l.viento_ms)::float AS u, avg(l.rad_solar_wm2)::float AS rs,
           max(l.temp_max_c)::float AS tmx, min(l.temp_min_c)::float AS tmn, max(l.et_dia_mm)::float AS et
    FROM public.clima_estacion_lecturas l
    JOIN public.clima_estaciones e ON e.id = l.estacion_id
    WHERE e.presa_id IS NOT NULL AND e.rol = 'presa' AND e.activa
      AND (l.ts AT TIME ZONE 'America/Chihuahua')::date BETWEEN p_desde AND p_hasta
      AND l.temp_c IS NOT NULL AND l.hum_rel_pct IS NOT NULL AND l.rad_solar_wm2 IS NOT NULL AND l.viento_ms IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5, 6
  ), d AS (
    SELECT station_id, presa_id, lat, z, dia, count(*)::int AS horas,
           avg(t) AS t, avg(0.6108 * exp(17.27 * t / (t + 237.3))) AS es, avg(0.6108 * exp(17.27 * t / (t + 237.3)) * rh / 100) AS ea,
           avg(u) AS u, avg(rs) * 0.0864 AS rs, max(COALESCE(tmx, t)) AS tmx, min(COALESCE(tmn, t)) AS tmn, max(et) AS et
    FROM h GROUP BY 1, 2, 3, 4, 5 HAVING count(*) >= 11
  ), q AS (
    SELECT d.*, radians(lat) AS phi,
           0.409 * sin(2 * pi() / 365 * extract(doy FROM dia) - 1.39) AS dec,
           1 + 0.033 * cos(2 * pi() / 365 * extract(doy FROM dia)) AS dr
    FROM d
  ), w AS (
    SELECT q.*, acos(greatest(-1, least(1, -tan(phi) * tan(dec)))) AS ws FROM q
  ), x AS (
    SELECT w.*, 24 * 60 / pi() * 0.0820 * dr * (ws * sin(phi) * sin(dec) + cos(phi) * cos(dec) * sin(ws)) AS ra FROM w
  ), y AS (
    SELECT x.*, (0.75 + 2e-5 * z) * ra AS rso, 101.3 * power((293 - 0.0065 * z) / 293, 5.26) AS p FROM x
  ), e2 AS (
    SELECT y.*,
           4.903e-9 * ((power(tmx + 273.16, 4) + power(tmn + 273.16, 4)) / 2) * (0.34 - 0.14 * sqrt(greatest(ea, 0))) * (1.35 * least(rs / rso, 1) - 0.35) AS rnl,
           4098 * 0.6108 * exp(17.27 * t / (t + 237.3)) / power(t + 237.3, 2) AS delta,
           0.000665 * p AS gam,
           2.501 - 0.002361 * t AS lam
    FROM y
  ), f AS (
    SELECT e2.*,
           (delta / (delta + gam)) * ((0.92 * rs - rnl) / lam) + (gam / (delta + gam)) * 2.6 * (1 + 0.536 * u) * (es - ea) AS evap
    FROM e2
  ), nv AS (
    SELECT f.*, n.escala_msnm AS nivel
    FROM f
    LEFT JOIN LATERAL public.fn_nivel_presa_en_fecha(f.presa_id, (f.dia::timestamp AT TIME ZONE 'America/Chihuahua'), 2) n ON true
  )
  INSERT INTO public.cuerpos_agua_evaporacion_dia AS t
    (presa_id, fecha, station_id, horas, evap_mm, eto_mm, nivel_msnm, area_km2, calculado_en)
  SELECT nv.presa_id, nv.dia, nv.station_id, nv.horas, round(nv.evap::numeric, 3), round(nv.et::numeric, 3),
         nv.nivel, public.fn_area_curva_km2(nv.presa_id, nv.nivel), now()
  FROM nv
  WHERE nv.evap IS NOT NULL AND nv.evap >= 0
  ON CONFLICT (presa_id, fecha) DO UPDATE SET
    station_id = EXCLUDED.station_id, horas = EXCLUDED.horas, evap_mm = EXCLUDED.evap_mm, eto_mm = EXCLUDED.eto_mm,
    nivel_msnm = EXCLUDED.nivel_msnm, area_km2 = EXCLUDED.area_km2, calculado_en = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

-- ── Evaporación mensual: rellena SOLO las columnas de evaporación de filas de balance ya existentes ─
-- (fn_balance_mensual_recalcular no toca estas columnas en su ON CONFLICT, así que no se pisan entre sí).
CREATE OR REPLACE FUNCTION public.fn_evaporacion_mensual_recalcular(
  p_desde date DEFAULT DATE '2026-07-01',
  p_hasta date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  p_hasta := COALESCE(p_hasta, (now() AT TIME ZONE 'America/Chihuahua')::date);

  WITH mes AS (
    SELECT c.id AS cuerpo_id, b.mes, b.dias_mes,
           count(d.fecha) FILTER (WHERE d.area_km2 IS NOT NULL)::int AS n,
           sum(d.evap_mm * d.area_km2) / 1000.0 AS e_obs,
           sum(d.eto_mm * d.area_km2) / 1000.0 AS e_eto,
           avg(d.evap_mm) FILTER (WHERE d.area_km2 IS NOT NULL) AS lamina
    FROM public.cuerpos_agua_balance_mensual b
    JOIN public.cuerpos_agua c ON c.id = b.cuerpo_id
    LEFT JOIN public.cuerpos_agua_evaporacion_dia d
           ON d.presa_id = c.id_serie AND d.fecha >= b.mes AND d.fecha < (b.mes + interval '1 month')::date
    WHERE b.mes BETWEEN date_trunc('month', p_desde::timestamp)::date AND p_hasta
    GROUP BY c.id, b.mes, b.dias_mes
  )
  UPDATE public.cuerpos_agua_balance_mensual t SET
    evap_mm3       = CASE WHEN m.n::numeric / m.dias_mes >= 0.5 THEN round(m.e_obs * m.dias_mes / m.n, 3) END,
    evap_bajo_mm3  = CASE WHEN m.n::numeric / m.dias_mes >= 0.5 AND m.e_eto IS NOT NULL THEN round(m.e_eto * m.dias_mes / m.n, 3) END,
    evap_alto_mm3  = CASE WHEN m.n::numeric / m.dias_mes >= 0.5 THEN round(m.e_obs * m.dias_mes / m.n * 1.15, 3) END,
    evap_dias      = m.n,
    evap_lamina_mm = CASE WHEN m.n::numeric / m.dias_mes >= 0.5 THEN round(m.lamina * m.dias_mes, 1) END,
    evap_metodo    = CASE WHEN m.n > 0 THEN 'penman_agua_libre_v1' END
  FROM mes m
  WHERE t.cuerpo_id = m.cuerpo_id AND t.mes = m.mes AND m.n > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_evaporacion_dia_recalcular(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_evaporacion_mensual_recalcular(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_evaporacion_dia_recalcular(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evaporacion_mensual_recalcular(date, date) TO service_role;
COMMENT ON FUNCTION public.fn_evaporacion_dia_recalcular(date, date) IS
  'Penman de agua libre por día con las estaciones de presa (PRE-001, PRE-002). Idempotente. Solo service_role.';
COMMENT ON FUNCTION public.fn_evaporacion_mensual_recalcular(date, date) IS
  'Suma mensual en Mm³ (lámina × superficie a la cota del día) con rango bajo (ETo) y alto (+15 %). Requiere el balance mensual y la evaporación diaria. Solo service_role.';
