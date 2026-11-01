-- fn_monitor_snapshot: agrega responsable/notas/confirmada a lecturas_escalas
-- para que el Monitor Público descarte las filas de arrastre que SICA Chronos
-- inserta a las 00:00 (copia del último nivel, no es lectura de campo).
-- Además excluye esas filas en el SQL (no consumen el limit 500).
-- Cambio aditivo: mismas columnas previas + 3 nuevas. Resto idéntico a
-- 20260709100000_fn_monitor_snapshot.sql (verificado contra la definición viva
-- el 2026-11-01 antes de aplicar).

create or replace function public.fn_monitor_snapshot(
  p_event_start timestamptz default null,
  p_evento_id   uuid        default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'escalas', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.km), '[]'::jsonb)
      from (
        select id, nombre, km, latitud, longitud, pzas_radiales, ancho, alto,
               nivel_max_operativo, capacidad_max
        from escalas
      ) e
    ),
    'lecturas_presas', (
      select coalesce(jsonb_agg(
               to_jsonb(lp) || jsonb_build_object(
                 'presas', jsonb_build_object('nombre', pr.nombre, 'nombre_corto', pr.nombre_corto)
               )
               order by lp.fecha desc, lp.creado_en desc), '[]'::jsonb)
      from (
        select * from lecturas_presas
        order by fecha desc, creado_en desc
        limit 200
      ) lp
      left join presas pr on pr.id = lp.presa_id
    ),
    'resumen_delta', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'escala_id', r.escala_id, 'delta_12h', r.delta_12h)), '[]'::jsonb)
      from resumen_escalas_diario r
      where r.fecha = (now() at time zone 'America/Chihuahua')::date
    ),
    'lecturas_escalas', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.creado_en desc), '[]'::jsonb)
      from (
        select escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura,
               apertura_radiales_m, radiales_json, gasto_calculado_m3s,
               gasto_metodo, creado_en, responsable, notas, confirmada
        from lecturas_escalas
        where creado_en >= coalesce(
          p_event_start,
          ((now() at time zone 'America/Chihuahua')::date)::timestamptz
        )
          -- sin arrastres de medianoche: no consumen el límite de 500
          and coalesce(responsable, '') !~* 'chronos'
        order by creado_en desc
        limit 500
      ) l
    ),
    'movimientos', (
      select coalesce(jsonb_agg(
               to_jsonb(m) || jsonb_build_object(
                 'presas', jsonb_build_object('nombre_corto', pr2.nombre_corto)
               )
               order by m.fecha_hora desc), '[]'::jsonb)
      from (
        select * from movimientos_presas
        order by fecha_hora desc
        limit 5
      ) m
      left join presas pr2 on pr2.id = m.presa_id
    ),
    'llenado_seguimiento', case
      when p_evento_id is null then null
      else (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'km', s.km, 'hora_real', s.hora_real) order by s.km desc), '[]'::jsonb)
        from sica_llenado_seguimiento s
        where s.evento_id = p_evento_id and s.hora_real is not null
      )
    end
  );
$$;

grant execute on function public.fn_monitor_snapshot(timestamptz, uuid) to anon, authenticated;
