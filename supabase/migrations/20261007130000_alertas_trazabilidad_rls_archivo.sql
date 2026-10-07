-- Alertas · auditoría 2026-10-07. Aplicada por SQL (apply_migration), NO por db push (drift).
-- 1) Trazabilidad de la resolución: quién y cómo (el ATENDER enviaba `resuelto_por`, columna inexistente → fallaba en silencio).
-- 2) RLS: INSERT/UPDATE dejan de estar abiertos a `anon`. Los generadores (triggers y fn_clima_*) son SECURITY DEFINER y las
--    edge functions usan service_role, así que no dependen de estas políticas. La lectura pública se conserva.
-- 3) Archivo de las 21 alertas de más de 14 días (20 "Tensión en Red" de marzo con valores absurdos + 1 NDWI de agosto).
--    Reversible: resolucion_tipo='archivada' las distingue de las atendidas por una persona.

alter table public.registro_alertas
    add column if not exists resuelto_por text,
    add column if not exists resolucion_tipo text;

alter table public.registro_alertas drop constraint if exists registro_alertas_resolucion_tipo_check;
alter table public.registro_alertas add constraint registro_alertas_resolucion_tipo_check
    check (resolucion_tipo is null or resolucion_tipo in ('manual', 'auto', 'archivada'));

comment on column public.registro_alertas.resuelto_por is 'Quién cerró la alerta (nombre del usuario, o "Sistema" si fue automático/archivo).';
comment on column public.registro_alertas.resolucion_tipo is 'manual = la atendió una persona · auto = se cerró sola · archivada = depuración de pendientes antiguos.';

drop policy if exists "Inserción de alertas (Triggers/Backend)" on public.registro_alertas;
drop policy if exists "Actualización de resolucion" on public.registro_alertas;
create policy registro_alertas_insert_auth on public.registro_alertas for insert to authenticated with check (true);
create policy registro_alertas_update_auth on public.registro_alertas for update to authenticated using (true) with check (true);

update public.registro_alertas
   set resuelta = true,
       fecha_resolucion = now(),
       resolucion_tipo = 'archivada',
       resuelto_por = 'Sistema (archivo 2026-10-07)'
 where resuelta = false
   and fecha_deteccion < now() - interval '14 days';
