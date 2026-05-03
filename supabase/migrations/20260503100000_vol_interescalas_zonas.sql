-- ═══════════════════════════════════════════════════════════════════════
-- VOLUMETRÍA HIDRÁULICA — CANAL PRINCIPAL CONCHOS DR-005
-- Autor: SRL Unidad Conchos
--
-- Orden de cálculo (de menor a mayor escala):
--   PASO 1 — fn_vol_interescala(): geometría trapezoidal por tramo
--             entre dos represas consecutivas (integración prismática)
--   PASO 2 — vol_interescalas:  vista de los 12 tramos con niveles reales
--   PASO 3 — vol_zonas:         agrega tramos por zona Z1-Z4
--
-- Geometría de sección transversal (canal trapecial):
--   A(y) = (b + z·y) · y
--   donde b = plantilla_m, z = talud_z, y = tirante medido (nivel_m)
--
-- Integración entre represas (prismatoid):
--   V_seg = (A_inicio + A_fin) / 2 × L_metros
--   El tirante se interpola linealmente entre las dos represas del tramo.
-- ═══════════════════════════════════════════════════════════════════════


-- ── PASO 0: Helper — último nivel válido registrado para una escala ───

CREATE OR REPLACE FUNCTION public.fn_nivel_escala(p_id TEXT)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT nivel_m
    FROM   public.lecturas_escalas
    WHERE  escala_id = p_id
      AND  nivel_m   IS NOT NULL
    ORDER  BY fecha DESC, hora_lectura DESC
    LIMIT  1;
$$;


-- ── PASO 1: Función central — volumen m³ entre dos represas ──────────
--
-- Recorre cada segmento del perfil hidráulico que intersecta el tramo
-- [p_km_up, p_km_down], clipea los extremos y aplica la fórmula:
--
--   y(x) = y_up + (y_down - y_up) · (x - km_up) / (km_down - km_up)
--   A(y) = (plantilla + talud · y) · y
--   V    = Σ (A_inicio + A_fin) / 2 · longitud_m
--
-- Retorna NULL si falta cualquier dato de entrada.

CREATE OR REPLACE FUNCTION public.fn_vol_interescala(
    p_km_up   NUMERIC,   -- km de la represa aguas arriba
    p_km_down NUMERIC,   -- km de la represa aguas abajo
    p_y_up    NUMERIC,   -- tirante registrado aguas arriba (m)
    p_y_down  NUMERIC    -- tirante registrado aguas abajo (m)
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total  NUMERIC := 0;
    v_seg    RECORD;
    v_km_a   NUMERIC;   -- inicio efectivo del segmento (clipeado)
    v_km_b   NUMERIC;   -- fin efectivo del segmento (clipeado)
    v_y_a    NUMERIC;   -- tirante interpolado en v_km_a
    v_y_b    NUMERIC;   -- tirante interpolado en v_km_b
    v_A_a    NUMERIC;   -- área sección en v_km_a (m²)
    v_A_b    NUMERIC;   -- área sección en v_km_b (m²)
    v_long_m NUMERIC;   -- longitud del segmento clipeado (m)
    v_rango  NUMERIC;   -- longitud total del tramo (km), para interpolación
BEGIN
    -- Validar entradas
    IF p_km_up   IS NULL OR p_km_down IS NULL
    OR p_y_up    IS NULL OR p_y_down  IS NULL
    OR p_km_down <= p_km_up
    OR p_y_up    < 0     OR p_y_down  < 0
    THEN
        RETURN NULL;
    END IF;

    v_rango := p_km_down - p_km_up;   -- en km

    -- Iterar sobre segmentos del perfil que intersectan el tramo
    FOR v_seg IN
        SELECT km_inicio, km_fin, plantilla_m, talud_z
        FROM   public.perfil_hidraulico_canal
        WHERE  km_inicio <  p_km_down    -- empieza antes del fin
          AND  km_fin    >  p_km_up      -- termina después del inicio
          AND  km_inicio <  km_fin       -- excluir fila inválida (46.5→0)
          AND  plantilla_m > 0
          AND  talud_z     >= 0
        ORDER  BY km_inicio
    LOOP
        -- Clipear extremos del segmento al tramo interescala
        v_km_a := GREATEST(v_seg.km_inicio, p_km_up);
        v_km_b := LEAST(v_seg.km_fin,       p_km_down);

        IF v_km_b <= v_km_a THEN CONTINUE; END IF;

        -- Interpolación lineal del tirante en cada extremo del segmento
        v_y_a := GREATEST(
            p_y_up + (p_y_down - p_y_up) * (v_km_a - p_km_up) / v_rango,
            0.0
        );
        v_y_b := GREATEST(
            p_y_up + (p_y_down - p_y_up) * (v_km_b - p_km_up) / v_rango,
            0.0
        );

        -- Área sección trapecial: A = (b + z·y)·y
        v_A_a := (v_seg.plantilla_m + v_seg.talud_z * v_y_a) * v_y_a;
        v_A_b := (v_seg.plantilla_m + v_seg.talud_z * v_y_b) * v_y_b;

        -- Longitud clipeada en metros
        v_long_m := (v_km_b - v_km_a) * 1000.0;

        -- Volumen del prismatoide: V = (A_a + A_b)/2 × L
        v_total := v_total + (v_A_a + v_A_b) / 2.0 * v_long_m;
    END LOOP;

    RETURN ROUND(v_total);   -- m³ enteros
END;
$$;


-- ── PASO 2: Vista — volumen por tramo entre represas consecutivas ─────
--
-- Columnas clave:
--   esc_up / esc_down   nombre de las represas que delimitan el tramo
--   km_up / km_down     posición kilométrica
--   longitud_km         extensión del tramo
--   nivel_up_m          tirante medido aguas arriba (último registro)
--   nivel_down_m        tirante medido aguas abajo
--   vol_m3              volumen almacenado en tránsito (m³)
--   vol_mm3             ídem en Mm³

CREATE OR REPLACE VIEW public.vol_interescalas AS
WITH
-- 1. Ordenar escalas y vincular con la siguiente (LEAD)
esc_pares AS (
    SELECT
        id,
        nombre,
        km,
        LEAD(id)     OVER (ORDER BY km ASC) AS id_down,
        LEAD(nombre) OVER (ORDER BY km ASC) AS nombre_down,
        LEAD(km)     OVER (ORDER BY km ASC) AS km_down
    FROM public.escalas
    WHERE activa = TRUE
),
-- 2. Leer niveles (una sola vez por escala para evitar llamadas duplicadas)
con_niveles AS (
    SELECT
        e.id,
        e.nombre,
        e.km,
        e.id_down,
        e.nombre_down,
        e.km_down,
        ROUND((e.km_down - e.km)::NUMERIC, 3)         AS longitud_km,
        public.fn_nivel_escala(e.id)                  AS nivel_up_m,
        public.fn_nivel_escala(e.id_down)             AS nivel_down_m
    FROM esc_pares e
    WHERE e.id_down IS NOT NULL
),
-- 3. Calcular volumen (una sola vez — se reusa en vol_mm3)
con_vol AS (
    SELECT
        *,
        public.fn_vol_interescala(km, km_down, nivel_up_m, nivel_down_m) AS vol_m3
    FROM con_niveles
)
SELECT
    id            AS esc_up_id,
    nombre        AS esc_up,
    km            AS km_up,
    id_down       AS esc_down_id,
    nombre_down   AS esc_down,
    km_down,
    longitud_km,
    nivel_up_m,
    nivel_down_m,
    vol_m3,
    ROUND(vol_m3 / 1e6, 4)  AS vol_mm3
FROM con_vol;


-- ── PASO 3: Vista — volumen agregado por zona (Z1–Z4) ────────────────
--
-- Incluye solo los tramos cuya represa upstream e downstream
-- caen dentro de los km de la zona (tolerancia ±50 m para
-- coincidir con escalas como ESC-009 en km 79.025 vs zona km 79).
--
-- Columnas clave:
--   n_tramos          cuántos tramos interescala componen la zona
--   vol_actual_m3/mm3 volumen almacenado hoy
--   nivel_medio_m     tirante medio ponderado por longitud de tramo
--   vol_diseno_m3     capacidad teórica al tirante de diseño (referencia)
--   pct_llenado       % del volumen de diseño que está ocupado

CREATE OR REPLACE VIEW public.vol_zonas AS
WITH tramos_en_zona AS (
    SELECT
        z.id          AS zona_id,
        z.codigo,
        z.nombre      AS zona_nombre,
        z.km_inicio,
        z.km_fin,
        z.color,
        vi.esc_up_id,
        vi.esc_up,
        vi.km_up,
        vi.esc_down,
        vi.km_down,
        vi.longitud_km,
        vi.nivel_up_m,
        vi.nivel_down_m,
        vi.vol_m3
    FROM public.zonas_canal z
    JOIN public.vol_interescalas vi
      ON  vi.km_up   >= z.km_inicio - 0.05   -- tolerancia ±50 m
      AND vi.km_down <= z.km_fin   + 0.05
    WHERE vi.vol_m3 IS NOT NULL
),
-- Capacidad al tirante de diseño: usa primer segmento representativo de cada zona
diseno AS (
    SELECT
        z.id   AS zona_id,
        -- Área trapecial al tirante de diseño en km central de la zona
        (phc.plantilla_m + phc.talud_z * phc.tirante_diseno_m) * phc.tirante_diseno_m
                    AS area_diseno_m2,
        phc.tirante_diseno_m
    FROM public.zonas_canal z
    JOIN public.perfil_hidraulico_canal phc
      ON  phc.km_inicio <= (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_fin    >  (z.km_inicio + z.km_fin) / 2.0
      AND phc.km_inicio < phc.km_fin
)
SELECT
    tz.zona_id,
    tz.codigo,
    tz.zona_nombre,
    tz.km_inicio,
    tz.km_fin,
    tz.color,

    -- ── Volumetría real ──────────────────────────────────────────────
    COUNT(tz.esc_up_id)                                       AS n_tramos,

    SUM(tz.vol_m3)                                            AS vol_actual_m3,
    ROUND(SUM(tz.vol_m3) / 1e6, 4)                           AS vol_actual_mm3,

    -- Tirante medio ponderado por longitud (refleja carga hidráulica promedio)
    ROUND(
        SUM((tz.nivel_up_m + tz.nivel_down_m) / 2.0 * tz.longitud_km)
        / NULLIF(SUM(tz.longitud_km), 0),
        3
    )                                                         AS nivel_medio_m,

    -- ── Referencia de diseño ─────────────────────────────────────────
    ROUND(
        d.area_diseno_m2
        * (tz.km_fin - tz.km_inicio) * 1000.0    -- longitud zona en m
    )                                                         AS vol_diseno_m3,

    d.tirante_diseno_m,

    -- Porcentaje de llenado respecto al volumen de diseño
    ROUND(
        SUM(tz.vol_m3)
        / NULLIF(d.area_diseno_m2 * (tz.km_fin - tz.km_inicio) * 1000.0, 0)
        * 100.0,
        1
    )                                                         AS pct_llenado

FROM tramos_en_zona tz
JOIN diseno d ON d.zona_id = tz.zona_id
GROUP BY
    tz.zona_id, tz.codigo, tz.zona_nombre, tz.km_inicio, tz.km_fin, tz.color,
    d.area_diseno_m2, d.tirante_diseno_m;


-- ── Permisos ──────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_nivel_escala(TEXT)
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.fn_vol_interescala(NUMERIC, NUMERIC, NUMERIC, NUMERIC)
    TO authenticated;

GRANT SELECT ON public.vol_interescalas TO authenticated;
GRANT SELECT ON public.vol_zonas        TO authenticated;


-- ── Test inmediato (ejecutar después del script) ──────────────────────
-- SELECT esc_up, km_up, esc_down, km_down, nivel_up_m, nivel_down_m,
--        vol_m3, vol_mm3
-- FROM vol_interescalas
-- ORDER BY km_up;
--
-- SELECT codigo, zona_nombre, n_tramos, vol_actual_mm3,
--        vol_diseno_m3, pct_llenado
-- FROM vol_zonas
-- ORDER BY km_inicio;
