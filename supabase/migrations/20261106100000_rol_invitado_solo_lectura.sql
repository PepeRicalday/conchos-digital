-- Rol INVITADO (solo lectura) — Fase 0 (blindaje) + Fase 1 (rol).
-- Aplicar con MCP apply_migration (NO `supabase db push`: hay drift migraciones/BD).
-- Las políticas RESTRICTIVE se combinan con AND sobre las permisivas existentes,
-- por eso no hay que reescribir las ~60 políticas actuales.

-- ───────────────────────── Fase 1: rol y helpers ─────────────────────────
ALTER TABLE public.perfiles_usuario DROP CONSTRAINT IF EXISTS perfiles_usuario_rol_check;
ALTER TABLE public.perfiles_usuario
  ADD CONSTRAINT perfiles_usuario_rol_check
  CHECK (rol = ANY (ARRAY['SRL'::text, 'ACU'::text, 'AUDITORIA'::text, 'INVITADO'::text]));

ALTER TABLE public.perfiles_usuario
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vigente_hasta date,
  ADD COLUMN IF NOT EXISTS creado_por uuid;

CREATE OR REPLACE FUNCTION public.auth_es_invitado()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT rol = 'INVITADO' FROM public.perfiles_usuario WHERE id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.auth_es_invitado() FROM public;
GRANT EXECUTE ON FUNCTION public.auth_es_invitado() TO anon, authenticated;

-- ───────────────── Fase 0.1: cerrar escritura anónima ─────────────────
DROP POLICY IF EXISTS "Insert Movimientos Presas" ON public.movimientos_presas;
CREATE POLICY "Insert Movimientos Presas (autenticados)" ON public.movimientos_presas
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Auth Write Curva Correccion" ON public.curva_batimetrica_correccion;
CREATE POLICY "SRL escribe curva correccion" ON public.curva_batimetrica_correccion
  FOR ALL TO authenticated
  USING (public.auth_rol() = 'SRL') WITH CHECK (public.auth_rol() = 'SRL');

DROP POLICY IF EXISTS "Auth Write Textura Satelital" ON public.textura_satelital_terreno;
CREATE POLICY "SRL escribe textura satelital" ON public.textura_satelital_terreno
  FOR ALL TO authenticated
  USING (public.auth_rol() = 'SRL') WITH CHECK (public.auth_rol() = 'SRL');
-- (las edge functions escriben con service role y no pasan por RLS)

-- ─────── Fase 0.2: INVITADO no escribe en ninguna tabla operativa ───────
DO $$
DECLARE
  t text;
  cmd text;
  tablas text[] := ARRAY[
    'lecturas_presas','clima_presas','lecturas_escalas','escalas','mediciones',
    'reportes_operacion','aforos','aforos_control','aforos_principales_diarios',
    'autorizaciones_ciclo','ciclos_agricolas','modulos_ciclos','registro_alertas',
    'curvas_capacidad','perfil_hidraulico_canal','sica_canal_status',
    'sica_llenado_seguimiento','sica_llenado_snapshots','sica_transiciones_protocolo',
    'sica_eventos_arribos','sica_eventos_log','solicitudes_riego_semanal',
    'canales','presas','secciones','puntos_entrega','movimientos_presas',
    'entregas_modulo','zonas_canal','modulo_zonas','app_versions',
    'curva_batimetrica_correccion','textura_satelital_terreno'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'omitida (no existe): %', t; CONTINUE;
    END IF;
    FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'invitado_sin_' || lower(cmd), t);
      IF cmd = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (NOT public.auth_es_invitado())', 'invitado_sin_insert', t);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s USING (NOT public.auth_es_invitado())', 'invitado_sin_' || lower(cmd), t, cmd);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ─── Fase 0.3: INVITADO no lee datos por módulo / productor / aforos ───
-- Nota: el token ya emitido vive hasta 1 h tras el bloqueo; el frontend además cierra sesión
-- si auth_cuenta_vigente() es false (ver ProtectedRoute).

-- puntos_entrega y reportes_operacion NO se restringen en lectura: alimentan las
-- vistas del balance del canal (operativo general). Su escritura sí está bloqueada arriba.
DO $$
DECLARE
  t text;
  k "char";
  tablas text[] := ARRAY[
    'entregas_modulo','autorizaciones_ciclo','solicitudes_riego_semanal',
    'aforos','aforos_control','aforos_principales_diarios','mediciones','modulos_ciclos',
    'superficie_volumen_anual_modulo','volumen_modulo_mensual_provisional',
    'sica_integrity_log','hydric_knowledge_base'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    SELECT relkind INTO k FROM pg_class WHERE oid = to_regclass('public.' || t);
    IF k IS NULL THEN
      RAISE NOTICE 'omitida (no existe): %', t; CONTINUE;
    ELSIF k NOT IN ('r','p') THEN
      RAISE EXCEPTION 'se esperaba tabla y % es relkind % — revisar la migración', t, k;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'invitado_sin_lectura', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT USING (NOT public.auth_es_invitado())', 'invitado_sin_lectura', t);
  END LOOP;
END $$;

-- Vistas con dueño postgres SIN security_invoker se saltan el RLS de las tablas base
-- y le filtrarían al invitado los datos por módulo. Con security_invoker aplica el RLS
-- del invocador (las tablas base tienen SELECT público, así que no cambia nada para el resto).
-- Verificado en BD viva (2026-11-06): todas leen solo tablas con política SELECT true.
DO $$
DECLARE
  v text;
  vistas text[] := ARRAY[
    'balance_volumen_modulo','resumen_ciclo','volumen_ciclo_modulo','volumenes_zona_diarios',
    'vw_pronostico_agotamiento_modulos','v_balance_hidrico_tramos','v_integridad_reportes',
    'vw_alertas_tomas_varadas','vw_balance_tramos_tiempo_real','vw_prediccion_arribo_tomas'
  ];
BEGIN
  FOREACH v IN ARRAY vistas LOOP
    IF to_regclass('public.' || v) IS NULL THEN
      RAISE EXCEPTION 'vista % no existe — revisar la migración', v;
    END IF;
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- ───────── Caducidad / desactivación de cuentas invitado ─────────
CREATE OR REPLACE FUNCTION public.auth_cuenta_vigente()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT activo AND (vigente_hasta IS NULL OR vigente_hasta >= current_date)
                   FROM public.perfiles_usuario WHERE id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.auth_cuenta_vigente() FROM public;
GRANT EXECUTE ON FUNCTION public.auth_cuenta_vigente() TO authenticated;

-- Bloquea en Auth (no puede iniciar sesión ni renovar token) a invitados vencidos o inactivos.
CREATE OR REPLACE FUNCTION public.fn_invitados_expirar()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE n integer;
BEGIN
  UPDATE auth.users u SET banned_until = 'infinity'
  FROM public.perfiles_usuario p
  WHERE p.id = u.id AND p.rol = 'INVITADO'
    AND (NOT p.activo OR (p.vigente_hasta IS NOT NULL AND p.vigente_hasta < current_date))
    AND (u.banned_until IS NULL OR u.banned_until < now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fn_invitados_expirar() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invitados_expirar() TO service_role;

-- Programar a diario si pg_cron está instalado (si no, lo invoca la edge function admin-invitados).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('invitados_expirar_diario', '5 0 * * *', 'select public.fn_invitados_expirar()');
  END IF;
END $$;
