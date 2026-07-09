-- fn_monitor_snapshot: consolida en UNA llamada las 6 queries del fetchData
-- del Monitor Público (escalas, lecturas_presas+presas, delta diario,
-- lecturas_escalas, movimientos+presas, seguimiento de llenado).
-- Motivación (auditoría 2026-07-09): la carga inicial hacía ~6 requests por
-- refresh; con esta RPC baja a 1. El front detecta si la función existe y cae
-- al camino de queries paralelas si no (cero regresión).
--
-- Los sub-selects replican EXACTAMENTE columnas, orden y límites del front
-- (PublicMonitor.tsx fetchData). Si cambias uno, cambia el otro.

create or replace function public.fn_monitor_snapshot(
  p_event_start timestamptz default null,
  p_evento_id   uuid        default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(

    -- 1) Catálogo de escalas (mismas columnas que el select del front)
    'escalas', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.km), '[]'::jsonb)
      from (
        select id, nombre, km, latitud, longitud, pzas_radiales, ancho, alto,
               nivel_max_operativo, capacidad_max
        from escalas
      ) e
    ),

    -- 2) Lecturas de presas con la presa embebida (presas:presa_id (nombre, nombre_corto))
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

    -- 3) delta_12h del resumen diario de HOY (zona horaria del canal)
    'resumen_delta', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'escala_id', r.escala_id, 'delta_12h', r.delta_12h)), '[]'::jsonb)
      from resumen_escalas_diario r
      where r.fecha = (now() at time zone 'America/Chihuahua')::date
    ),

    -- 4) Lecturas de escalas desde el inicio del evento (o medianoche de hoy)
    'lecturas_escalas', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.creado_en desc), '[]'::jsonb)
      from (
        select escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura,
               apertura_radiales_m, radiales_json, gasto_calculado_m3s,
               gasto_metodo, creado_en
        from lecturas_escalas
        where creado_en >= coalesce(
          p_event_start,
          ((now() at time zone 'America/Chihuahua')::date)::timestamptz
        )
        order by creado_en desc
        limit 500
      ) l
    ),

    -- 5) Últimos 5 movimientos de presas con nombre corto embebido
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

    -- 6) Seguimiento de llenado (solo si hay evento LLENADO activo)
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
