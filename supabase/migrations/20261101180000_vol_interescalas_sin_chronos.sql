-- vol_interescalas: excluir los arrastres de medianoche de SICA Chronos.
-- Chronos copia a las 00:00 el último nivel de cada escala (responsable='SICA Chronos');
-- no es lectura de campo. Con ellos, el volumen en canal (y vol_zonas, que lee esta vista)
-- se calculaba con niveles de agua que en VACIADO ya no está. Sin ellos, los tramos sin
-- lectura real en la ventana de 2 días quedan con nivel NULL → vol NULL (vol_zonas ya los
-- excluye) y el front muestra la cobertura (tramos medidos / totales).
-- Único cambio respecto a la definición viva (leída el 2026-11-01): el filtro de responsable.
CREATE OR REPLACE VIEW public.vol_interescalas AS
 WITH ultima_lectura AS (
         SELECT DISTINCT ON (lecturas_escalas.escala_id) lecturas_escalas.escala_id,
            lecturas_escalas.nivel_m,
            lecturas_escalas.nivel_abajo_m,
            lecturas_escalas.creado_en
           FROM lecturas_escalas
          WHERE lecturas_escalas.fecha >= (CURRENT_DATE - '2 days'::interval)
            AND COALESCE(lecturas_escalas.responsable, '') !~* 'chronos'
          ORDER BY lecturas_escalas.escala_id, lecturas_escalas.creado_en DESC
        ), escalas_con_nivel AS (
         SELECT e.id,
            e.nombre,
            e.km,
            ul.nivel_m AS h_arriba,
            ul.nivel_abajo_m AS h_abajo,
            ul.creado_en
           FROM escalas e
             LEFT JOIN ultima_lectura ul ON ul.escala_id = e.id
          WHERE e.activa = true
        ), ancho_canal(esc_up_id, esc_dn_id, ancho_m) AS (
         VALUES ('ESC-000'::text,'ESC-001'::text,19.55), ('ESC-001'::text,'ESC-002'::text,18.91), ('ESC-002'::text,'ESC-003'::text,18.56), ('ESC-003'::text,'ESC-004'::text,17.87), ('ESC-004'::text,'ESC-005'::text,17.43), ('ESC-005'::text,'ESC-007'::text,16.91), ('ESC-007'::text,'ESC-006'::text,16.22), ('ESC-006'::text,'ESC-008'::text,16.12), ('ESC-008'::text,'ESC-009'::text,14.51), ('ESC-009'::text,'ESC-010'::text,13.31), ('ESC-010'::text,'ESC-011'::text,12.54), ('ESC-011'::text,'ESC-012'::text,12.37), ('ESC-012'::text,'ESC-013'::text,11.99)
        ), tramos AS (
         SELECT e_up.id AS esc_up_id,
            e_up.nombre AS esc_up,
            e_up.km AS km_up,
            e_dn.id AS esc_down_id,
            e_dn.nombre AS esc_down,
            e_dn.km AS km_down,
            e_dn.km - e_up.km AS longitud_km,
            (e_dn.km - e_up.km) * 1000.0 AS longitud_m,
            e_up.h_arriba AS nivel_up_m,
            e_dn.h_arriba AS nivel_down_m,
            COALESCE(e_up.h_abajo, e_up.h_arriba) AS nivel_ini_m,
            e_dn.h_arriba AS nivel_fin_m,
            ac.ancho_m
           FROM escalas_con_nivel e_up
             JOIN ancho_canal ac ON ac.esc_up_id = e_up.id
             JOIN escalas_con_nivel e_dn ON e_dn.id = ac.esc_dn_id
        )
 SELECT esc_up_id,
    esc_up,
    km_up,
    esc_down_id,
    esc_down,
    km_down,
    longitud_km,
    round(nivel_up_m, 3) AS nivel_up_m,
    round(nivel_down_m, 3) AS nivel_down_m,
    round(nivel_ini_m, 3) AS nivel_ini_m,
    round(nivel_fin_m, 3) AS nivel_fin_m,
        CASE
            WHEN nivel_ini_m IS NOT NULL AND nivel_fin_m IS NOT NULL AND nivel_ini_m > 0::numeric AND ancho_m > 0::numeric THEN round(longitud_m * ancho_m * (nivel_ini_m + nivel_fin_m) / 2.0, 0)
            ELSE NULL::numeric
        END AS vol_m3,
        CASE
            WHEN nivel_ini_m IS NOT NULL AND nivel_fin_m IS NOT NULL AND nivel_ini_m > 0::numeric AND ancho_m > 0::numeric THEN round(longitud_m * ancho_m * (nivel_ini_m + nivel_fin_m) / 2.0 / '1000000'::numeric, 4)
            ELSE NULL::numeric
        END AS vol_mm3,
    round(ancho_m, 2) AS ancho_canal_m
   FROM tramos t
  ORDER BY km_up;
