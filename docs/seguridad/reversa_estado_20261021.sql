-- Estado de seguridad de la BD al 2026-10-21, ANTES de cualquier cierre (Fase 2).
-- Es la REVERSA: para deshacer un cambio, borrar la politica nueva y volver a crear la original.
-- NO se ejecuta como un bloque: aplicar solo la tabla/funcion afectada, con apply_migration revisado.
-- Nota: la tabla "alertas" no devolvio politicas con ese nombre; verificar su nombre real antes de AL-3.

-- ===== Politicas RLS originales =====
CREATE POLICY "Aforos: SELECT for all, write for authenticated" ON public.aforos AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY "Auth Write Curva Correccion" ON public.curva_batimetrica_correccion AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public Read Curva Correccion" ON public.curva_batimetrica_correccion AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Auth Write DEM Terreno" ON public.dem_terreno_presa AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public Read DEM Terreno" ON public.dem_terreno_presa AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Insert Movimientos Presas" ON public.movimientos_presas AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public Read Movimientos Presas" ON public.movimientos_presas AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Admin All Canal Perfil" ON public.perfil_hidraulico_canal AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "Public Access Canal Perfil" ON public.perfil_hidraulico_canal AS PERMISSIVE FOR ALL TO public USING (true);
CREATE POLICY "Public Read Canal Perfil" ON public.perfil_hidraulico_canal AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Auth Write Textura Satelital" ON public.textura_satelital_terreno AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Public Read Textura Satelital" ON public.textura_satelital_terreno AS PERMISSIVE FOR SELECT TO public USING (true);

-- ===== EXECUTE de anon en funciones SECURITY DEFINER (21) =====
GRANT EXECUTE ON FUNCTION public.update_chat_conversation_timestamp() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon;
GRANT EXECUTE ON FUNCTION public.get_perfil_hidraulico(p_km numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.auth_rol() TO anon;
GRANT EXECUTE ON FUNCTION public.auth_modulo_id() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_calcular_gasto_escala() TO anon;
GRANT EXECUTE ON FUNCTION public.check_dam_critical_level() TO anon;
GRANT EXECUTE ON FUNCTION public.check_module_overdraft() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_generar_continuidad_diaria() TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_acceso_usuario(modulo_objetivo_id text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_mantenimiento_diario_continuidad() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_nivel_escala(p_id text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_desviacion_vaso_ndwi() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_recalibra_curva_batimetrica(p_presa_id text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_vol_interescala(p_km_up numeric, p_km_down numeric, p_y_up numeric, p_y_down numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_tiempo_transito_dinamico(p_km_inicio numeric, p_km_fin numeric, p_q_m3s numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_q_actual_k0() TO anon;
GRANT EXECUTE ON FUNCTION public.fn_cron_hydric_doc_estado(p_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_q_actual_escala(p_escala_id text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_cron_weatherlink_estado(p_limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.sync_daily_dam_registry() TO anon;

-- ===== RLS habilitada (todas estas tablas lo estan) =====
ALTER TABLE public.aforos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curva_batimetrica_correccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dem_terreno_presa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_presas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil_hidraulico_canal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.textura_satelital_terreno ENABLE ROW LEVEL SECURITY;
