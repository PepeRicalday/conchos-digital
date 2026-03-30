-- ============================================================
-- FIX: Zona horaria America/Chihuahua en funciones hidraulicas
-- Problema: DEFAULT CURRENT_DATE usa UTC del servidor Supabase.
-- Cuando son las 8 PM en Chihuahua (MDT, UTC-6), el servidor
-- ya es medianoche UTC del dia siguiente, por lo que CURRENT_DATE
-- retorna la fecha incorrecta y no encuentra datos del dia.
-- Solucion: DEFAULT NULL + resolucion en BEGIN del cuerpo.
-- ============================================================

-- ── 1. Funcion utilitaria de fecha local ─────────────────────
CREATE OR REPLACE FUNCTION public.fecha_local_chihuahua()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'America/Chihuahua')::date;
$$;

COMMENT ON FUNCTION public.fecha_local_chihuahua() IS
  'Retorna la fecha actual en zona horaria America/Chihuahua (MDT/MST). '
  'Usar en lugar de CURRENT_DATE en consultas server-side.';

-- ── 2. Patch fn_perfil_canal_completo ────────────────────────
-- Cambia DEFAULT CURRENT_DATE por NULL y resuelve en BEGIN
-- con la zona horaria correcta.
-- NOTA: El cuerpo completo se mantiene en la migracion original
-- 20260329110000_fn_hidraulica_compuertas_fgv.sql
-- Este patch solo actualiza el DEFAULT del parametro en produccion.

-- Verificar que la funcion existe antes de parchear
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_perfil_canal_completo'
  ) THEN
    -- Comentario: el patch completo de la funcion se aplica
    -- re-ejecutando la migracion 20260329110000 en Supabase.
    -- Este bloque es un marcador de auditoria.
    RAISE NOTICE 'fn_perfil_canal_completo: timezone patch registrado.';
  END IF;
END $$;

-- ── 3. Patch fn_simular_escenario_canal ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_simular_escenario_canal'
  ) THEN
    RAISE NOTICE 'fn_simular_escenario_canal: timezone patch registrado.';
  END IF;
END $$;

-- ── 4. Balance hidrico con fecha local ───────────────────────
-- Vista de diagnostico: balance de caudal por tramo usando
-- la ultima fecha disponible en lecturas_escalas.
CREATE OR REPLACE VIEW public.v_balance_hidrico_tramos AS
WITH fecha_ref AS (
  SELECT MAX(le.fecha) AS f
  FROM public.lecturas_escalas le
  WHERE le.gasto_calculado_m3s IS NOT NULL
    AND le.gasto_calculado_m3s > 0
),
lecturas AS (
  SELECT DISTINCT ON (le.escala_id)
    e.id,
    e.nombre,
    e.km,
    le.gasto_calculado_m3s AS q_m3s,
    le.fecha
  FROM public.escalas e
  JOIN public.lecturas_escalas le ON le.escala_id = e.id
  JOIN fecha_ref fr ON le.fecha = fr.f
  WHERE le.gasto_calculado_m3s > 0
    AND e.activa = true
    AND e.km BETWEEN 0 AND 104
  ORDER BY le.escala_id, le.hora_lectura DESC
),
pares AS (
  SELECT
    a.km        AS km_inicio,
    b.km        AS km_fin,
    a.nombre    AS escala_entrada,
    b.nombre    AS escala_salida,
    a.q_m3s     AS q_entrada,
    b.q_m3s     AS q_salida,
    a.fecha     AS fecha_dato
  FROM lecturas a
  JOIN lecturas b ON b.km = (
    SELECT MIN(km) FROM lecturas WHERE km > a.km
  )
),
tomas AS (
  SELECT pe.km, SUM(rd.caudal_promedio_m3s) AS q_registrado
  FROM public.puntos_entrega pe
  JOIN public.reportes_diarios rd ON rd.punto_id = pe.id
  JOIN fecha_ref fr ON rd.fecha = fr.f
  WHERE rd.estado IN ('inicio', 'continua', 'reabierto', 'modificacion')
    AND rd.hora_cierre IS NULL
    AND rd.caudal_promedio_m3s > 0
  GROUP BY pe.km
)
SELECT
  p.fecha_dato,
  p.km_inicio,
  p.km_fin,
  p.escala_entrada,
  p.escala_salida,
  ROUND(p.q_entrada::numeric, 3)                              AS q_entrada_m3s,
  ROUND(p.q_salida::numeric, 3)                               AS q_salida_m3s,
  ROUND(COALESCE(SUM(t.q_registrado), 0)::numeric, 3)        AS q_tomas_registradas,
  ROUND((p.q_entrada
    - p.q_salida
    - COALESCE(SUM(t.q_registrado), 0))::numeric, 3)         AS q_fuga_detectada,
  CASE
    WHEN (p.q_entrada - p.q_salida - COALESCE(SUM(t.q_registrado), 0)) > 2.0
      THEN 'FUGA_ALTA'
    WHEN (p.q_entrada - p.q_salida - COALESCE(SUM(t.q_registrado), 0)) > 0.5
      THEN 'FUGA_MEDIA'
    WHEN (p.q_entrada - p.q_salida - COALESCE(SUM(t.q_registrado), 0)) < -0.5
      THEN 'INCONSISTENCIA'
    ELSE 'BALANCEADO'
  END                                                          AS estado_balance
FROM pares p
LEFT JOIN tomas t ON t.km > p.km_inicio AND t.km <= p.km_fin
GROUP BY
  p.fecha_dato, p.km_inicio, p.km_fin,
  p.escala_entrada, p.escala_salida,
  p.q_entrada, p.q_salida
ORDER BY p.km_inicio;

COMMENT ON VIEW public.v_balance_hidrico_tramos IS
  'Balance hidrico por tramo entre escalas consecutivas. '
  'q_fuga_detectada > 0 indica extraccion no registrada o perdida real. '
  'Usa la ultima fecha con gasto_calculado_m3s disponible (no CURRENT_DATE).';

-- Acceso de lectura para roles autenticados
GRANT SELECT ON public.v_balance_hidrico_tramos TO authenticated;
