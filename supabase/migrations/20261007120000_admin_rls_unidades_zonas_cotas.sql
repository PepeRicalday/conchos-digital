-- Administración · Fase 2 (auditoría 2026-10-07). Aplicada por SQL (apply_migration), NO por db push (drift).
-- 1) RLS de puntos_entrega apuntaba a la tabla legacy `perfiles` (0 filas) → nadie podía escribir. Se alinea a perfiles_usuario.rol='SRL'.
-- 2) Escrituras de ciclos_agricolas y aforos_principales_diarios solo SRL (eran cualquier authenticated / ALL abierto).
-- 3) DELETE de lecturas_presas y clima_presas solo SRL (INSERT/UPDATE se conservan para authenticated: sica-capture los usa).
-- 4) sica_eventos_log: INSERT/UPDATE dejan de estar abiertos a `anon`; solo usuarios autenticados.
-- 5) puntos_entrega.capacidad_max está en L/s (rótulo m³/s era erróneo): se rellena capacidad_max_lps (0 = sin dato → NULL).
-- 6) zona normalizada a 'ZONA #1'..'ZONA #4' + CHECK.
-- 7) presas.namo_msnm / name_msnm (antes fijas en cotasPresas.ts / ImportReport).

begin;

-- ── 1. puntos_entrega ───────────────────────────────────────────────────────────
drop policy if exists puntos_entrega_insert on public.puntos_entrega;
drop policy if exists puntos_entrega_update on public.puntos_entrega;
drop policy if exists puntos_entrega_delete on public.puntos_entrega;

create policy puntos_entrega_insert on public.puntos_entrega for insert to authenticated
    with check ((select public.auth_rol()) = 'SRL');
create policy puntos_entrega_update on public.puntos_entrega for update to authenticated
    using ((select public.auth_rol()) = 'SRL') with check ((select public.auth_rol()) = 'SRL');
create policy puntos_entrega_delete on public.puntos_entrega for delete to authenticated
    using ((select public.auth_rol()) = 'SRL');

-- ── 2. ciclos_agricolas ─────────────────────────────────────────────────────────
drop policy if exists ciclos_insert on public.ciclos_agricolas;
drop policy if exists ciclos_update on public.ciclos_agricolas;
create policy ciclos_insert on public.ciclos_agricolas for insert to authenticated
    with check ((select public.auth_rol()) = 'SRL');
create policy ciclos_update on public.ciclos_agricolas for update to authenticated
    using ((select public.auth_rol()) = 'SRL') with check ((select public.auth_rol()) = 'SRL');

-- ── 2b. aforos_principales_diarios (ALL abierto a public) ───────────────────────
drop policy if exists "Aforos Diarios: SELECT for all, write for authenticated" on public.aforos_principales_diarios;
create policy aforos_pd_select on public.aforos_principales_diarios for select to public using (true);
create policy aforos_pd_insert on public.aforos_principales_diarios for insert to authenticated
    with check ((select public.auth_rol()) = 'SRL');
create policy aforos_pd_update on public.aforos_principales_diarios for update to authenticated
    using ((select public.auth_rol()) = 'SRL') with check ((select public.auth_rol()) = 'SRL');
create policy aforos_pd_delete on public.aforos_principales_diarios for delete to authenticated
    using ((select public.auth_rol()) = 'SRL');

-- ── 3. DELETE solo SRL en lecturas/clima de presas ──────────────────────────────
drop policy if exists lecturas_presas_delete on public.lecturas_presas;
create policy lecturas_presas_delete on public.lecturas_presas for delete to authenticated
    using ((select public.auth_rol()) = 'SRL');
drop policy if exists clima_presas_delete on public.clima_presas;
create policy clima_presas_delete on public.clima_presas for delete to authenticated
    using ((select public.auth_rol()) = 'SRL');

-- ── 4. sica_eventos_log: fuera `anon` ───────────────────────────────────────────
drop policy if exists "Inserción de protocolos por usuarios" on public.sica_eventos_log;
drop policy if exists "Actualización de protocolos por usuarios" on public.sica_eventos_log;
-- Se conserva "Usuarios autenticados pueden dictar eventos" (INSERT, auth.role()='authenticated').
create policy sica_eventos_update_auth on public.sica_eventos_log for update to authenticated
    using (true) with check (true);

-- ── 5. capacidad en L/s ─────────────────────────────────────────────────────────
update public.puntos_entrega
   set capacidad_max_lps = capacidad_max
 where capacidad_max_lps is null and capacidad_max > 0;
comment on column public.puntos_entrega.capacidad_max is 'LEGADO: valor en L/s (no m³/s). Usar capacidad_max_lps; NULL = sin dato.';
comment on column public.puntos_entrega.capacidad_max_lps is 'Capacidad de diseño en litros por segundo. NULL = sin dato (nunca 0).';

-- ── 6. zona normalizada ─────────────────────────────────────────────────────────
update public.puntos_entrega
   set zona = 'ZONA #' || substring(zona from '([0-9]+)')
 where zona is not null and zona !~ '^ZONA #[1-4]$' and zona ~ '[1-4]';
alter table public.puntos_entrega drop constraint if exists puntos_entrega_zona_check;
alter table public.puntos_entrega add constraint puntos_entrega_zona_check
    check (zona is null or zona in ('ZONA #1','ZONA #2','ZONA #3','ZONA #4'));

-- ── 7. cotas de presa ───────────────────────────────────────────────────────────
alter table public.presas add column if not exists namo_msnm numeric, add column if not exists name_msnm numeric;
update public.presas set namo_msnm = 1317.0,  name_msnm = 1319.1  where id = 'PRE-001' and namo_msnm is null;
update public.presas set namo_msnm = 1239.3,  name_msnm = 1242.56 where id = 'PRE-002' and namo_msnm is null;
comment on column public.presas.namo_msnm is 'Nivel de aguas máximas ordinarias (msnm). Fuente única; antes fija en el front.';
comment on column public.presas.name_msnm is 'Nivel de aguas máximas extraordinarias (msnm).';

commit;
