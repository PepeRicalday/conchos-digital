-- ============================================================
-- SICA 005 — Migración de Seguridad, Rendimiento y Limpieza
-- 2026-02-17
-- ============================================================

-- ============================================================
-- SECCIÓN 1: Habilitar RLS en tablas desprotegidas
-- ============================================================

ALTER TABLE public.presas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secciones ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública para datos de referencia
CREATE POLICY "Lectura publica presas"
  ON public.presas FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Lectura publica canals"
  ON public.canals FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Lectura publica secciones"
  ON public.secciones FOR SELECT
  TO public
  USING (true);

-- Políticas de escritura solo para admin/operator
CREATE POLICY "Admin/Operator pueden modificar presas"
  ON public.presas FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );

CREATE POLICY "Admin/Operator pueden modificar canals"
  ON public.canals FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );

CREATE POLICY "Admin/Operator pueden modificar secciones"
  ON public.secciones FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );

-- Eliminar política huérfana de presas (creada sin RLS activo)
DROP POLICY IF EXISTS "Admins can update dams" ON public.presas;

-- ============================================================
-- SECCIÓN 2: Eliminar políticas duplicadas
-- ============================================================

-- modulos: eliminar "Public read modules" (conservar "Public/Global Read...")
DROP POLICY IF EXISTS "Public read modules" ON public.modulos;

-- puntos_entrega: eliminar genérica (conservar la que respeta módulo)
DROP POLICY IF EXISTS "Public read points" ON public.puntos_entrega;

-- profiles: eliminar ambas duplicadas y crear una unificada
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view entire roster" ON public.profiles;

CREATE POLICY "Ver perfiles autorizados"
  ON public.profiles FOR SELECT
  TO public
  USING (
    id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (select auth.uid())
        AND p.role IN ('admin', 'operator')
    )
  );

-- ============================================================
-- SECCIÓN 3: Corregir vistas SECURITY DEFINER → INVOKER
-- ============================================================

DROP VIEW IF EXISTS public.volumenes_diarios_modulo;
CREATE VIEW public.volumenes_diarios_modulo
WITH (security_invoker = true)
AS
SELECT m.id AS modulo_id,
    m.nombre AS modulo_nombre,
    m.codigo_corto,
    date((med."timestamp" AT TIME ZONE 'America/Chihuahua'::text)) AS fecha,
    count(DISTINCT pe.id) AS puntos_activos,
    count(med.id) AS total_mediciones,
    (avg(med.valor_q) * (1000)::numeric) AS caudal_promedio_lps,
    sum(med.valor_vol) AS volumen_dia_mm3,
    m.vol_acumulado AS volumen_acumulado_mm3,
    m.vol_autorizado AS volumen_autorizado_mm3,
    CASE
        WHEN (m.vol_autorizado > (0)::numeric) THEN round(((m.vol_acumulado / m.vol_autorizado) * (100)::numeric), 2)
        ELSE (0)::numeric
    END AS porcentaje_consumido
FROM ((modulos m
    LEFT JOIN puntos_entrega pe ON ((pe.modulo_id = m.id)))
    LEFT JOIN mediciones med ON ((med.punto_id = pe.id)))
GROUP BY m.id, m.nombre, m.codigo_corto, m.vol_acumulado, m.vol_autorizado, (date((med."timestamp" AT TIME ZONE 'America/Chihuahua'::text)));

DROP VIEW IF EXISTS public.reportes_diarios;
CREATE VIEW public.reportes_diarios
WITH (security_invoker = true)
AS
SELECT ro.id,
    ro.punto_id,
    pe.nombre AS punto_nombre,
    m.id AS modulo_id,
    m.nombre AS modulo_nombre,
    ro.fecha,
    ro.estado,
    ro.hora_apertura,
    ro.hora_cierre,
    ro.caudal_promedio AS caudal_promedio_m3s,
    (ro.caudal_promedio * (1000)::numeric) AS caudal_promedio_lps,
    ro.caudal_maximo,
    ro.volumen_acumulado AS volumen_total_mm3,
    ro.num_mediciones,
    ro.notas
FROM ((reportes_operacion ro
    JOIN puntos_entrega pe ON ((ro.punto_id = pe.id)))
    JOIN modulos m ON ((pe.modulo_id = m.id)));

-- Otorgar acceso a las vistas
GRANT SELECT ON public.volumenes_diarios_modulo TO anon, authenticated;
GRANT SELECT ON public.reportes_diarios TO anon, authenticated;

-- ============================================================
-- SECCIÓN 4: Fijar search_path en todas las funciones
-- ============================================================

ALTER FUNCTION public.check_user_access(uuid) SET search_path = public;
ALTER FUNCTION public.calculate_volume() SET search_path = public;
ALTER FUNCTION public.check_capacity_limit() SET search_path = public;
ALTER FUNCTION public.fn_update_modulo_vol() SET search_path = public;
ALTER FUNCTION public.fn_refresh_vol_acumulado() SET search_path = public;
ALTER FUNCTION public.gestionar_evento_riego() SET search_path = public;
ALTER FUNCTION public.fn_cerrar_reporte(uuid, date, text) SET search_path = public;

-- ============================================================
-- SECCIÓN 5: Crear índices en foreign keys sin cobertura
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_mediciones_punto_id
  ON public.mediciones(punto_id);

CREATE INDEX IF NOT EXISTS idx_mediciones_user_id
  ON public.mediciones(user_id);

CREATE INDEX IF NOT EXISTS idx_puntos_entrega_modulo_id
  ON public.puntos_entrega(modulo_id);

CREATE INDEX IF NOT EXISTS idx_puntos_entrega_seccion_id
  ON public.puntos_entrega(seccion_id);

-- ============================================================
-- SECCIÓN 6: Eliminar función muerta y trigger duplicado
-- ============================================================

-- Función muerta (intenta INSERT/UPDATE en vista reportes_diarios)
DROP FUNCTION IF EXISTS public.actualizar_reporte_diario() CASCADE;

-- Trigger duplicado de validación de capacidad
DROP TRIGGER IF EXISTS check_flow_capacity_trigger ON public.mediciones;
DROP FUNCTION IF EXISTS public.validate_flow_capacity() CASCADE;
