-- ============================================================
-- Migración: Capa 3 + Capa 2 — Hidráulica de Compuertas y Perfil FGV
-- Fecha: 2026-03-29
--
-- CAPA 3 — Hidráulica de Estructuras de Control:
--   fn_q_compuerta          — Gasto por compuerta radial (libre/sumergida)
--   fn_apertura_requerida   — Apertura necesaria para un gasto dado
--   fn_calcular_gasto_escala — Q desde lecturas (nivel + apertura)
--   trg_gasto_escala_auto   — Trigger: calcula gasto_calculado_m3s al insertar
--
-- CAPA 2 — Perfil de Flujo Gradualmente Variado (FGV):
--   fn_y_desde_energia      — Tirante desde energía específica (Newton-Raphson)
--   fn_paso_estandar_sub    — Un paso del Método del Paso Estándar (aguas arriba)
--   fn_perfil_fgv_tramo     — Perfil FGV completo en un tramo
--   fn_perfil_canal_completo — Perfil integrado K-0 → K-104 con compuertas + FGV
--
-- Por qué el FGV es necesario:
--   Con Manning uniforme, K-54 con Q=35 m³/s daría y≈2.8m.
--   Si hay una compuerta en K-57, el remanso aguas arriba puede elevar
--   el tirante a 4.42m → la escala lo mide correctamente y el modelo
--   lo reproduce con el Paso Estándar.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- CAPA 3A: GASTO POR COMPUERTA RADIAL
-- ════════════════════════════════════════════════════════════
-- Compuerta radial operando como orificio sumergido:
--   Q = Cd × n_pzas × ancho × apertura × √(2g × ΔH)
-- Si h_aguas_abajo < apertura: orificio libre
--   Q = Cd × n_pzas × ancho × apertura × √(2g × h1)

CREATE OR REPLACE FUNCTION public.fn_q_compuerta(
  p_Cd NUMERIC
  , -- Coeficiente de descarga (típico 0.60–0.70)
    p_ancho NUMERIC
  , -- Ancho de cada compuerta (m)
    p_n_pzas INTEGER
  , -- Número de piezas (compuertas)
    p_apertura NUMERIC
  , -- Apertura de la compuerta (m)
    p_h1 NUMERIC
  , -- Tirante aguas arriba (m)
    p_h2 NUMERIC DEFAULT 0 -- Tirante aguas abajo (m), 0 = libre
)
RETURNS NUMERIC AS $$
DECLARE v_delta_h NUMERIC;
v_Q NUMERIC;
BEGIN
  IF
    p_apertura <= 0
    OR p_ancho <= 0
    OR p_n_pzas <= 0
  THEN
    RETURN 0;
  END IF;

  -- Régimen libre: aguas abajo < apertura (no hay sumergencia)
  IF p_h2 <= p_apertura THEN
    -- Orificio libre: Q = Cd × L × a × √(2g × h1)
    v_Q := p_Cd * p_n_pzas * p_ancho * p_apertura * SQRT(2.0 * 9.81 * GREATEST(p_h1, 0.001));
  ELSE
    -- Orificio sumergido: Q = Cd × L × a × √(2g × (h1 - h2))
    v_delta_h := GREATEST(p_h1 - p_h2, 0.001);

    v_Q := p_Cd * p_n_pzas * p_ancho * p_apertura * SQRT(2.0 * 9.81 * v_delta_h);
  END IF;

  RETURN ROUND(GREATEST(v_Q, 0)::numeric, 4);
END;
$$
LANGUAGE plpgsql IMMUTABLE;


-- ════════════════════════════════════════════════════════════
-- CAPA 3B: APERTURA REQUERIDA PARA UN GASTO DADO
-- ════════════════════════════════════════════════════════════
-- Despejando apertura de Q = Cd × n × L × a × √(2g × h):
--   a = Q / (Cd × n × L × √(2g × h))

CREATE OR REPLACE FUNCTION public.fn_apertura_requerida(
  p_Q NUMERIC
  , -- Gasto deseado (m³/s)
    p_Cd NUMERIC
  , -- Coeficiente de descarga
    p_ancho NUMERIC
  , -- Ancho por compuerta (m)
    p_n_pzas INTEGER
  , -- Número de piezas
    p_h NUMERIC -- Tirante aguas arriba (m)
)
RETURNS NUMERIC AS $$
DECLARE v_denominador NUMERIC;
v_apertura NUMERIC;
BEGIN
  v_denominador := p_Cd * p_n_pzas * p_ancho * SQRT(2.0 * 9.81 * GREATEST(p_h, 0.01));
  IF v_denominador <= 0 THEN
    RETURN NULL;
  END IF;
  v_apertura := p_Q / v_denominador;
  -- Limitar a rango físico razonable (0.05m – 3.5m)
  RETURN ROUND(LEAST(GREATEST(v_apertura, 0.05), 3.5)::numeric, 3);
END;
$$
LANGUAGE plpgsql IMMUTABLE;


-- ════════════════════════════════════════════════════════════
-- CAPA 3C: CALCULAR GASTO DESDE LECTURA DE ESCALA
-- ════════════════════════════════════════════════════════════
-- Jerarquía de cálculo:
--   1. Si apertura_radiales_m > 0: usa ecuación de compuerta
--   2. Si no: usa Manning directo (nivel → Q)
-- Este es el puente entre lectura de campo y modelo hidráulico.

CREATE OR REPLACE FUNCTION public.fn_calcular_gasto_escala(
  p_escala_id TEXT
  , p_nivel_m NUMERIC
  , p_apertura_m NUMERIC DEFAULT 0
  , p_h2 NUMERIC DEFAULT 0 -- Tirante aguas abajo (para sumergencia)
)
RETURNS NUMERIC AS $$
DECLARE v_esc RECORD;
v_perf RECORD;
v_Q NUMERIC;
BEGIN
  -- Parámetros de la escala
  SELECT
    e.km
    , e.ancho
    , COALESCE(e.coeficiente_descarga, 0.62) AS cd
  INTO
    v_esc
  FROM
    public.escalas e
  WHERE
    e.id = p_escala_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Geometría del tramo
  SELECT
    phc.plantilla_m
    , phc.talud_z
    , COALESCE(phc.rugosidad_n, 0.014) AS n
    , phc.pendiente_s0
  INTO
    v_perf
  FROM
    public.perfil_hidraulico_canal phc
  WHERE
    v_esc.km >= phc.km_inicio
    AND v_esc.km < phc.km_fin
  LIMIT
    1;

  IF v_perf IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── Calcular Q según disponibilidad de datos ───────────────────────────────
  IF
    p_apertura_m > 0
    AND COALESCE(v_esc.ancho, 0) > 0
  THEN
    -- Ruta 1: Ecuación de compuerta (ancho = ancho total de la estructura, n_pzas = 1)
    v_Q := public.fn_q_compuerta(
      v_esc.cd
      , v_esc.ancho
      , 1
      , -- n_pzas: ancho ya es el total
        p_apertura_m
      , p_nivel_m
      , p_h2
    );
  ELSE
    -- Ruta 2: Manning directo desde nivel (flujo uniforme)
    v_Q := public.fn_q_manning(
      p_nivel_m
      , v_perf.plantilla_m
      , v_perf.talud_z
      , v_perf.n
      , v_perf.pendiente_s0
    );
  END IF;

  RETURN ROUND(GREATEST(v_Q, 0)::numeric, 4);
END;
$$
LANGUAGE plpgsql STABLE;


-- ════════════════════════════════════════════════════════════
-- CAPA 3D: TRIGGER — AUTO-CALCULAR gasto_calculado_m3s
-- ════════════════════════════════════════════════════════════
-- Se dispara en INSERT/UPDATE de lecturas_escalas.
-- Si gasto_calculado_m3s es NULL o 0, lo calcula automáticamente.
-- Si el operador lo ingresó manualmente (> 0), lo respeta.

CREATE OR REPLACE FUNCTION public.fn_trg_calcular_gasto_escala()
RETURNS trigger AS $$
BEGIN
  -- Solo calcular si no fue ingresado manualmente
  IF
    NEW.gasto_calculado_m3s IS NULL
    OR
    NEW.gasto_calculado_m3s = 0
  THEN
    NEW.gasto_calculado_m3s := public.fn_calcular_gasto_escala(
      NEW.escala_id
      , NEW.nivel_m
      , COALESCE(
        NEW.apertura_radiales_m
        , 0
      )
      , 0 -- h2: se asume descarga libre si no hay dato aguas abajo
    );
  END IF;
  RETURN
  NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER
IF
  EXISTS trg_gasto_escala_auto
  ON public.lecturas_escalas;
  CREATE TRIGGER trg_gasto_escala_auto
  BEFORE INSERT
  OR
  UPDATE
  ON public.lecturas_escalas
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_calcular_gasto_escala();

  -- Backfill: calcular gasto para lecturas existentes con gasto_calculado_m3s = NULL/0
  UPDATE
    public.lecturas_escalas le
  SET gasto_calculado_m3s = public.fn_calcular_gasto_escala(
    le.escala_id
    , le.nivel_m
    , COALESCE(le.apertura_radiales_m, 0)
    , 0
  )
  WHERE
    (
      le.gasto_calculado_m3s IS NULL
      OR le.gasto_calculado_m3s = 0
    )
    AND le.nivel_m > 0;


  -- ════════════════════════════════════════════════════════════
  -- CAPA 2A: TIRANTE DESDE ENERGÍA ESPECÍFICA
  -- ════════════════════════════════════════════════════════════
  -- Resuelve: E = y + Q²/(2g·A(y)²) para y dado E y Q
  -- Usado como sub-paso del Método del Paso Estándar.
  -- Solución subcrítica (y > y_critico).

  CREATE OR REPLACE FUNCTION public.fn_y_desde_energia(
    p_E NUMERIC
    , -- Energía específica objetivo (m)
      p_Q NUMERIC
    , -- Gasto (m³/s)
      p_b NUMERIC
    , -- Plantilla (m)
      p_z NUMERIC -- Talud
  )
  RETURNS NUMERIC AS $$
  DECLARE v_y NUMERIC;
  v_A NUMERIC;
  v_T NUMERIC;
  v_E_calc NUMERIC;
  v_dE NUMERIC;
  v_f NUMERIC;
  v_iter INTEGER := 0;
  v_y_c NUMERIC; -- Tirante crítico (estimado)
  BEGIN
    IF
      p_E <= 0
      OR p_Q <= 0
    THEN
      RETURN 0;
    END IF;

    -- Estimación inicial: solución subcrítica y ≈ 0.85 × E
    v_y := 0.85 * p_E;
    IF v_y <= 0.01 THEN
      v_y := 0.5;
    END IF;

    LOOP
      v_A := (p_b + p_z * v_y) * v_y;
      v_T := p_b + 2.0 * p_z * v_y;
      v_E_calc := v_y + (p_Q * p_Q) / (2.0 * 9.81 * GREATEST(v_A * v_A, 0.0001));

      v_f := v_E_calc - p_E;
      EXIT
      WHEN
        ABS(v_f) < 0.0001;
        EXIT
      WHEN
        v_iter > 60;

        -- dE/dy = 1 - Q²·T / (g·A³)   (positivo en subcrítico)
        v_dE := 1.0 - (p_Q * p_Q * v_T) / (9.81 * POWER(GREATEST(v_A, 0.001), 3));

        -- Evitar división por cero cerca del crítico
        IF ABS(v_dE) < 0.001 THEN
          v_dE := 0.1 * SIGN(v_dE);
        END IF;

        v_y := v_y - v_f / v_dE;
        -- Limitar para mantenerse en zona subcrítica
        v_y := GREATEST(v_y, 0.01);

        v_iter := v_iter + 1;
    END LOOP;

    RETURN ROUND(GREATEST(v_y, 0.01)::numeric, 4);
  END;
  $$
  LANGUAGE plpgsql IMMUTABLE;


  -- ════════════════════════════════════════════════════════════
  -- CAPA 2B: UN PASO DEL MÉTODO DEL PASO ESTÁNDAR (AGUAS ARRIBA)
  -- ════════════════════════════════════════════════════════════
  -- Dado el tirante en la sección aguas abajo (y2), calcula el tirante
  -- en la sección aguas arriba (y1) a una distancia dx.
  --
  -- Ecuación de energía (flujo subcrítico, de aguas abajo a aguas arriba):
  --   E1 = E2 + (Sf_prom - S0) × dx
  -- Donde Sf_prom = (Sf1 + Sf2) / 2  (pendiente de fricción promedio)
  --
  -- Resultado: curvas M1 (remanso) o M2 (aceleración) según Q vs Q_normal.

  CREATE OR REPLACE FUNCTION public.fn_paso_estandar_sub(
    p_y2 NUMERIC
    , -- Tirante conocido aguas abajo (m)
      p_Q NUMERIC
    , -- Gasto (m³/s)
      p_dx NUMERIC
    , -- Longitud del paso (m, positivo)
      p_b NUMERIC
    , -- Plantilla (m)
      p_z NUMERIC
    , -- Talud
      p_n NUMERIC
    , -- Manning n
      p_S0 NUMERIC -- Pendiente (m/m)
  )
  RETURNS NUMERIC AS $$
  DECLARE v_A2 NUMERIC;
  v_P2 NUMERIC;
  v_R2 NUMERIC;
  v_V2 NUMERIC;
  v_E2 NUMERIC;
  v_Sf2 NUMERIC;
  v_y1 NUMERIC;
  v_A1 NUMERIC;
  v_P1 NUMERIC;
  v_R1 NUMERIC;
  v_V1 NUMERIC;
  v_Sf1 NUMERIC;
  v_Sfprom NUMERIC;
  v_E_obj NUMERIC;
  v_iter INTEGER := 0;
  BEGIN
    IF
      p_y2 <= 0
      OR p_Q <= 0
    THEN
      RETURN p_y2;
    END IF;

    -- ── Condiciones sección 2 (aguas abajo, conocida) ─────────────────────────
    v_A2 := (p_b + p_z * p_y2) * p_y2;
    v_P2 := p_b + 2.0 * p_y2 * SQRT(1.0 + p_z * p_z);
    v_R2 := v_A2 / GREATEST(v_P2, 0.001);
    v_V2 := p_Q / GREATEST(v_A2, 0.001);
    v_E2 := p_y2 + v_V2 * v_V2 / (2.0 * 9.81);
    v_Sf2 := POWER(p_n * v_V2 / POWER(GREATEST(v_R2, 0.001), 2.0 / 3.0), 2);

    -- ── Iteración: predictor-corrector ────────────────────────────────────────
    -- Estimación inicial y1: tirante normal (flujo uniforme)
    v_y1 := public.fn_tirante_normal(p_Q, p_b, p_z, p_n, p_S0);

    LOOP
      v_A1 := (p_b + p_z * v_y1) * v_y1;
      v_P1 := p_b + 2.0 * v_y1 * SQRT(1.0 + p_z * p_z);
      v_R1 := v_A1 / GREATEST(v_P1, 0.001);
      v_V1 := p_Q / GREATEST(v_A1, 0.001);
      v_Sf1 := POWER(p_n * v_V1 / POWER(GREATEST(v_R1, 0.001), 2.0 / 3.0), 2);

      -- Pendiente de fricción promedio
      v_Sfprom := (v_Sf1 + v_Sf2) / 2.0;

      -- Energía objetivo en sección 1:
      -- E1 = E2 + (Sf_prom - S0) × dx
      -- Nota: aguas arriba la cota del fondo sube S0×dx → E aumenta por S0×dx
      -- La fricción consume energía → E disminuye por Sf×dx
      -- Neto: ΔE = (Sf_prom - S0) × dx
      -- Para M1 (y > yn): Sf < S0 → ΔE negativo → E1 < E2 + S0×dx (coherente con curva elevada)
      v_E_obj := v_E2 + (v_Sfprom - p_S0) * p_dx;

      -- Resolver y1 desde E_objetivo
      v_y1 := public.fn_y_desde_energia(v_E_obj, p_Q, p_b, p_z);

      EXIT
      WHEN
        v_iter > 10; -- Converge rápido con predictor-corrector
        v_iter := v_iter + 1;
    END LOOP;

    RETURN v_y1;
  END;
  $$
  LANGUAGE plpgsql IMMUTABLE;


  -- ════════════════════════════════════════════════════════════
  -- CAPA 2C: PERFIL FGV COMPLETO EN UN TRAMO
  -- ════════════════════════════════════════════════════════════
  -- Calcula el perfil de agua desde km_fin (condición de frontera conocida)
  -- hasta km_inicio, usando el Método del Paso Estándar.
  -- La geometría viene de perfil_hidraulico_canal (puede cambiar por tramo).
  -- Devuelve una fila por segmento del perfil.

  CREATE OR REPLACE FUNCTION public.fn_perfil_fgv_tramo(
    p_km_inicio NUMERIC
    , -- Km inicio del tramo (aguas arriba)
      p_km_fin NUMERIC
    , -- Km fin del tramo (aguas abajo)
      p_Q NUMERIC
    , -- Gasto en el tramo (m³/s)
      p_y_km_fin NUMERIC -- Tirante conocido en km_fin (condición de frontera)
  )
  RETURNS TABLE (
    km NUMERIC
    , -- Posición km (inicio de cada segmento)
      y_m NUMERIC
    , -- Tirante calculado (m)
      y_normal_m NUMERIC
    , -- Tirante normal Manning (m) — referencia
      tipo_curva TEXT
    , -- 'M1' | 'M2' | 'UNIFORME'
      V_ms NUMERIC
    , -- Velocidad (m/s)
      Fr NUMERIC
    , -- Número de Froude
      E_m NUMERIC
    , -- Energía específica (m)
      Sf NUMERIC
    , -- Pendiente de fricción
      b_m NUMERIC
    , z NUMERIC
  ) AS $$
  DECLARE v_seg RECORD;
  v_y NUMERIC := p_y_km_fin;
  v_y_n NUMERIC;
  v_dx_m NUMERIC;
  v_A NUMERIC;
  v_T NUMERIC;
  v_V NUMERIC;
  v_Fr NUMERIC;
  v_E NUMERIC;
  v_Sf NUMERIC;
  v_P NUMERIC;
  v_R NUMERIC;
  BEGIN
    IF
      p_Q <= 0
      OR p_y_km_fin <= 0
    THEN
      RETURN;
    END IF;

    -- Recorrer segmentos de aguas abajo a aguas arriba (DESC por km_inicio)
    FOR v_seg IN
    SELECT
      phc.km_inicio
      , phc.km_fin
      , phc.plantilla_m AS b
      , phc.talud_z AS z_val
      , COALESCE(phc.rugosidad_n, 0.014) AS n_val
      , phc.pendiente_s0 AS S0
    FROM
      public.perfil_hidraulico_canal phc
    WHERE
      phc.km_inicio >= p_km_inicio
      AND phc.km_fin <= p_km_fin + 0.1
    ORDER BY
      phc.km_inicio DESC -- Caminar aguas arriba
    LOOP
      v_dx_m := (v_seg.km_fin - v_seg.km_inicio) * 1000.0;

      -- Tirante normal de referencia (flujo uniforme)
      v_y_n := public.fn_tirante_normal(p_Q, v_seg.b, v_seg.z_val, v_seg.n_val, v_seg.S0);

      -- Aplicar Paso Estándar para obtener tirante aguas arriba del segmento
      v_y := public.fn_paso_estandar_sub(
        v_y
        , p_Q
        , v_dx_m
        , v_seg.b
        , v_seg.z_val
        , v_seg.n_val
        , v_seg.S0
      );

      -- Propiedades hidráulicas en el punto calculado
      v_A := (v_seg.b + v_seg.z_val * v_y) * v_y;
      v_T := v_seg.b + 2.0 * v_seg.z_val * v_y;
      v_P := v_seg.b + 2.0 * v_y * SQRT(1.0 + v_seg.z_val * v_seg.z_val);
      v_R := v_A / GREATEST(v_P, 0.001);
      v_V := p_Q / GREATEST(v_A, 0.001);
      v_Fr := CASE
        WHEN v_A > 0.001 THEN
          v_V / GREATEST(SQRT(9.81 * v_A / GREATEST(v_T, 0.001)), 0.001)
        ELSE 0
      END;
      v_E := v_y + v_V * v_V / (2.0 * 9.81);
      v_Sf := POWER(
        v_seg.n_val * v_V / POWER(GREATEST(v_R, 0.001), 2.0 / 3.0)
        , 2
      );

      -- Emitir fila
      km := v_seg.km_inicio;
      y_m := v_y;
      y_normal_m := v_y_n;
      tipo_curva := CASE
        WHEN ABS(v_y - v_y_n) < 0.05 THEN 'UNIFORME'
        WHEN v_y > v_y_n THEN 'M1'
        ELSE 'M2'
      END;
      V_ms := ROUND(v_V::numeric, 3);
      Fr := ROUND(v_Fr::numeric, 3);
      E_m := ROUND(v_E::numeric, 4);
      Sf := ROUND(v_Sf::numeric, 7);
      b_m := v_seg.b;
      z := v_seg.z_val;
      RETURN NEXT;
    END LOOP;
  END;
  $$
  LANGUAGE plpgsql STABLE;


  -- ════════════════════════════════════════════════════════════
  -- CAPA 2D: PERFIL COMPLETO DEL CANAL K-0 → K-104
  -- ════════════════════════════════════════════════════════════
  -- Integra compuertas + FGV para producir el perfil real de agua
  -- a lo largo de todo el canal, incluyendo curvas de remanso.
  --
  -- Algoritmo:
  --   1. Identificar estructuras de control (escalas con pzas_radiales > 0)
  --      ordenadas aguas abajo → aguas arriba
  --   2. Para cada tramo entre estructuras:
  --      a. Q en la estructura aguas abajo: desde compuerta o lectura
  --      b. y en la estructura: desde nivel medido (lecturas_escalas)
  --      c. Perfil FGV upstream hasta la siguiente estructura
  --   3. Si no hay lectura: fallback a tirante normal (Manning)

  -- DROP necesario porque cambiamos RETURNS TABLE (nuevas columnas)
  DROP FUNCTION
  IF
    EXISTS public.fn_perfil_canal_completo(date, numeric, jsonb);

    CREATE OR REPLACE FUNCTION public.fn_perfil_canal_completo(
      p_fecha DATE DEFAULT CURRENT_DATE
      , p_q_entrada_m3s NUMERIC DEFAULT NULL
      , p_modificaciones JSONB DEFAULT '[]'::jsonb
    )
    RETURNS TABLE (
      km_ref NUMERIC
      , nombre_tramo TEXT
      , q_m3s NUMERIC
      , -- Gasto en este punto
        y_m NUMERIC
      , -- Tirante calculado (FGV o Manning)
        y_normal_m NUMERIC
      , -- Tirante normal Manning (referencia)
        tipo_curva TEXT
      , -- 'M1' | 'M2' | 'UNIFORME' | 'MANNING'
        V_ms NUMERIC
      , Fr NUMERIC
      , -- Comparativa con lectura real
        escala_id TEXT
      , nivel_real_m NUMERIC
      , delta_real_cm NUMERIC
      , -- (calculado - real) en cm
        estado_lectura TEXT
      , -- 'CONSISTENTE' | 'DESBORDAMIENTO' | 'EXCEDENTE' | 'DÉFICIT'
        fecha_lectura DATE
      , -- Fecha de la lectura de escala (NULL = sin lectura hoy)
      -- Estado de la apertura de compuertas
      estado_apertura TEXT
      , -- 'NO APLICA' | 'SIN LECTURA' | '⚠ SIN APERTURA' | 'COMPUERTA CERRADA' | 'APERTURA: Xm'
        apertura_m NUMERIC
      , -- Apertura reportada (NULL si no aplica o no reportada)
      -- Frescura de reportes operativos en el tramo
      puntos_tramo INT
      , -- Total de puntos de entrega en el tramo
        puntos_con_reporte INT
      , -- Puntos con reporte del día
        alerta_tomas TEXT
      , -- '✓ AL DÍA' | '⚠ SIN REPORTE HOY' | '⚠ PARCIAL X/Y' | 'SIN PUNTOS'
      -- Fuente del gasto de entrada
      fuente_q_entrada TEXT
      , -- 'AFORO K-1' | 'COMPUERTA K-0' | 'PRESA' | 'LECTURAS PRESA' | 'FALLBACK'
      -- Tiempo tránsito
      tiempo_acum_h NUMERIC
      , hora_arribo TEXT
    ) AS $$
    DECLARE v_tramo RECORD;
    v_escala_id TEXT;
    v_nivel NUMERIC;
    v_apertura NUMERIC; -- COALESCE(apertura_radiales_m, 0) para cálculos
    v_apertura_raw NUMERIC; -- Valor crudo: NULL = no reportado, 0 = cerrada
    v_ancho_escala NUMERIC; -- Ancho de compuerta (>0 indica estructura con compuerta)
    v_fecha_lectura DATE; -- Fecha de la última lectura_escala en el tramo
    v_puntos_total INT; -- Total puntos_entrega en el tramo
    v_puntos_hoy INT; -- Puntos con reporte del día
    v_fuente_q TEXT; -- Fuente del Q de entrada (para auditoría)
    v_q_acum NUMERIC;
    v_q_ext NUMERIC;
    v_y_fgv NUMERIC;
    v_y_n NUMERIC;
    v_A NUMERIC;
    v_T NUMERIC;
    v_V NUMERIC;
    v_Fr NUMERIC;
    v_tiempo_acum_s NUMERIC := 0;
    v_hora_inicio TIMESTAMP WITH TIME ZONE := now();
    v_nivel_max NUMERIC;
    BEGIN
      -- ── OBTENER GASTO DE ENTRADA K-0 ──────────────────────────────────────────
      -- El Q en K-0 viene del río. Cascada de prioridad:
      --   1. Aforo de campo K-1+000 (medición directa del día)
      --   2. Compuerta K-0: nivel_arriba + nivel_abajo + apertura → fn_calcular_gasto_escala
      --   3. Último movimiento de presa (vigente hasta nuevo movimiento, no solo hoy)
      --   4. Última lectura_presas disponible
      --   5. Fallback 37 m³/s (gasto base del sistema)
      IF
        p_q_entrada_m3s IS NOT NULL
        AND p_q_entrada_m3s > 0
      THEN
        v_q_acum := p_q_entrada_m3s;
        v_fuente_q := 'MANUAL';
      ELSE
        -- Tier 1: Aforo medido en K-1+000 del día
        SELECT
          af.gasto_calculado_m3s
        INTO
          v_q_acum
        FROM
          public.aforos af
          JOIN public.puntos_entrega pe
        ON pe.id = af.punto_control_id
        WHERE
          af.fecha = p_fecha
          AND pe.km BETWEEN 0 AND 2.0
        ORDER BY
          af.hora_inicio DESC
        LIMIT
          1;
        IF
          v_q_acum IS NOT NULL
          AND v_q_acum > 0
        THEN
          v_fuente_q := 'AFORO K-1';
        ELSE
          v_q_acum := NULL;
        END IF;

        -- Tier 2: Compuerta K-0 con nivel arriba + abajo + apertura
        IF v_q_acum IS NULL THEN
          SELECT
            public.fn_calcular_gasto_escala(
              le.escala_id
              , le.nivel_m
              , COALESCE(le.apertura_radiales_m, 0)
              , COALESCE(le.nivel_abajo_m, 0)
            )
          INTO
            v_q_acum
          FROM
            public.lecturas_escalas le
            JOIN public.escalas e
          ON e.id = le.escala_id
          WHERE
            e.km BETWEEN 0 AND 1.5
            AND le.fecha = p_fecha
            AND le.apertura_radiales_m > 0
            AND e.activa = true
          ORDER BY
            le.hora_lectura DESC
          LIMIT
            1;
          IF
            v_q_acum IS NOT NULL
            AND v_q_acum > 0
          THEN
            v_fuente_q := 'COMPUERTA K-0';
          ELSE
            v_q_acum := NULL;
          END IF;
        END IF;

        -- Tier 3: Último movimiento de presa vigente (comportamiento "continua")
        -- No expira por día: si no hay nuevo movimiento, el último sigue vigente
        IF v_q_acum IS NULL THEN
          SELECT
            gasto_m3s
          INTO
            v_q_acum
          FROM
            public.movimientos_presas
          WHERE
            fecha_hora::date <= p_fecha
            AND gasto_m3s IS NOT NULL
            AND gasto_m3s > 0
          ORDER BY
            fecha_hora DESC
          LIMIT
            1;
          IF
            v_q_acum IS NOT NULL
            AND v_q_acum > 0
          THEN
            v_fuente_q := 'PRESA';
          ELSE
            v_q_acum := NULL;
          END IF;
        END IF;

        -- Tier 4: Última lectura_presas disponible (extraccion_total como proxy)
        IF v_q_acum IS NULL THEN
          SELECT
            extraccion_total_m3s
          INTO
            v_q_acum
          FROM
            public.lecturas_presas
          WHERE
            fecha <= p_fecha
            AND extraccion_total_m3s IS NOT NULL
            AND extraccion_total_m3s > 0
          ORDER BY
            fecha DESC
          LIMIT
            1;
          IF
            v_q_acum IS NOT NULL
            AND v_q_acum > 0
          THEN
            v_fuente_q := 'LECTURAS PRESA';
          ELSE
            v_q_acum := NULL;
          END IF;
        END IF;

        -- Sin datos reales: no usar número arbitrario — señalar ausencia de datos
        IF v_q_acum IS NULL THEN
          v_q_acum := 0;
          v_fuente_q := '⚠ SIN DATOS';
        END IF;
      END IF;

      -- Recorrer tramos del perfil hidráulico
      FOR v_tramo IN
      SELECT
        phc.km_inicio
        , phc.km_fin
        , phc.nombre_tramo
        , phc.plantilla_m AS b
        , phc.talud_z AS z_val
        , COALESCE(phc.rugosidad_n, 0.014) AS n_val
        , phc.pendiente_s0 AS S0
        , phc.tirante_diseno_m
        , COALESCE(phc.bordo_libre_m, 0.6) AS bordo_libre
      FROM
        public.perfil_hidraulico_canal phc
      WHERE
        phc.nombre_tramo = 'CANAL PRINCIPAL CONCHOS'
        AND phc.km_fin > phc.km_inicio  -- excluir tramos con datos inválidos
      ORDER BY
        phc.km_inicio ASC
      LOOP
        -- ── Extracciones del día + conteo de frescura de reportes ────────────────
        -- Gasto extraído por tomas activas hoy + cuántas reportaron
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN
                  ro.estado::text NOT IN ('cierre', 'suspension')
                THEN CASE
                  WHEN (
                    p_modificaciones @> jsonb_build_array(jsonb_build_object('punto_id', ro.punto_id::text))
                  )
                  THEN (
                    SELECT
                      (elem ->> 'nuevo_caudal_m3s')::numeric
                    FROM
                      jsonb_array_elements(p_modificaciones) elem
                    WHERE
                      elem ->> 'punto_id' = ro.punto_id::text
                    LIMIT
                      1
                  )
                  ELSE COALESCE(ro.caudal_promedio, 0)
                END
                ELSE 0
              END
            )
            , 0
          )
          , COUNT(DISTINCT ro.punto_id) -- puntos con cualquier reporte hoy
        INTO
          v_q_ext
          , v_puntos_hoy
        FROM
          public.reportes_operacion ro
          JOIN public.puntos_entrega pe
        ON pe.id = ro.punto_id
        WHERE
          pe.km >= v_tramo.km_inicio
          AND pe.km < v_tramo.km_fin
          AND ro.fecha = p_fecha;

        -- Total de puntos de entrega registrados en el tramo
        SELECT
          COUNT(*)
        INTO
          v_puntos_total
        FROM
          public.puntos_entrega pe
        WHERE
          pe.km >= v_tramo.km_inicio
          AND pe.km < v_tramo.km_fin;

        v_q_acum := GREATEST(v_q_acum - v_q_ext, 0);

        -- Tirante normal (Manning, referencia)
        v_y_n := public.fn_tirante_normal(
          v_q_acum
          , v_tramo.b
          , v_tramo.z_val
          , v_tramo.n_val
          , v_tramo.S0
        );

        -- Buscar escala en este tramo con lectura del día
        -- K0+000 (entrada del canal): nivel_m es carga del río (aguas arriba de la compuerta).
        --   → usar nivel_abajo_m como nivel real del canal (aguas abajo).
        -- Resto del canal: nivel_m es directamente el nivel en el canal.
        -- apertura_radiales_m sin COALESCE para distinguir NULL (no reportado) de 0 (cerrada)
        SELECT
          e.id
          , CASE
              WHEN e.km < 1.0 AND le.nivel_abajo_m IS NOT NULL
                THEN le.nivel_abajo_m  -- K0+000: nivel en el canal (aguas abajo de la compuerta)
              ELSE le.nivel_m           -- resto del canal: nivel directo
            END
          , le.apertura_radiales_m
          , -- raw: NULL = sin reporte, 0 = cerrada explícita
            e.nivel_max_operativo
          , e.ancho
          , -- >0 indica estructura con compuerta radial
            le.fecha -- fecha real de la lectura (puede ser NULL si no hay)
        INTO
          v_escala_id
          , v_nivel
          , v_apertura_raw
          , v_nivel_max
          , v_ancho_escala
          , v_fecha_lectura
        FROM
          public.escalas e
          LEFT JOIN public.lecturas_escalas le
        ON le.escala_id = e.id
        AND le.fecha = p_fecha
        WHERE
          e.km >= v_tramo.km_inicio
          AND e.km < v_tramo.km_fin
          AND e.activa = true
        ORDER BY
          le.hora_lectura DESC NULLS LAST
        LIMIT
          1;

        -- Para cálculos hidráulicos usar 0 cuando no se reportó apertura
        v_apertura := COALESCE(v_apertura_raw, 0);

        -- Determinar tirante a usar: FGV desde lectura real si existe, sino Manning
        v_nivel_max := COALESCE(
          v_nivel_max
          , v_tramo.tirante_diseno_m + v_tramo.bordo_libre
          , 3.8
        );

        IF
          v_nivel IS NOT NULL
          AND v_nivel > 0
          AND v_nivel <= v_nivel_max
        THEN
          -- Hay lectura real dentro del cajón → usar como condición de frontera
          v_y_fgv := v_nivel;
        ELSE
          -- Sin lectura: usar tirante normal (Manning uniforme)
          v_y_fgv := v_y_n;
        END IF;

        -- Propiedades hidráulicas
        v_A := (v_tramo.b + v_tramo.z_val * v_y_fgv) * v_y_fgv;
        v_T := v_tramo.b + 2.0 * v_tramo.z_val * v_y_fgv;
        v_V := v_q_acum / GREATEST(v_A, 0.001);
        v_Fr := CASE
          WHEN v_A > 0.001 THEN
            v_V / GREATEST(SQRT(9.81 * v_A / GREATEST(v_T, 0.001)), 0.001)
          ELSE 0
        END;

        -- Tiempo tránsito
        v_tiempo_acum_s := v_tiempo_acum_s + CASE
          WHEN v_V > 0 THEN
            (v_tramo.km_fin - v_tramo.km_inicio) * 1000.0 / v_V
          ELSE 0
        END;

        -- Estado de la lectura
        km_ref := ROUND(v_tramo.km_fin::numeric, 4);
        nombre_tramo := v_tramo.nombre_tramo || ' Km ' || v_tramo.km_inicio || '–' || v_tramo.km_fin;
        q_m3s := ROUND(v_q_acum::numeric, 3);
        y_m := v_y_fgv;
        y_normal_m := v_y_n;
        tipo_curva := CASE
          WHEN v_nivel IS NULL THEN 'MANNING'
          WHEN ABS(v_y_fgv - v_y_n) < 0.05 THEN 'UNIFORME'
          WHEN v_y_fgv > v_y_n THEN 'M1'
          ELSE 'M2'
        END;
        V_ms := ROUND(v_V::numeric, 3);
        Fr := ROUND(v_Fr::numeric, 3);
        escala_id := v_escala_id;
        nivel_real_m := v_nivel;
        delta_real_cm := CASE
          WHEN v_nivel IS NOT NULL THEN ROUND(((v_y_fgv - v_nivel) * 100)::numeric
          , 1
        )
        ELSE NULL
      END;
      estado_lectura := CASE
        WHEN v_nivel IS NULL THEN 'SIN LECTURA'
        WHEN v_nivel > v_nivel_max THEN '⚠ DESBORDAMIENTO'
        WHEN ABS(v_y_fgv - v_nivel) <= 0.05 THEN 'CONSISTENTE'
        WHEN v_y_fgv > v_nivel THEN 'EXCEDENTE'
        ELSE 'DÉFICIT'
      END;
      -- Estado de compuerta radial:
      --   NO APLICA       → escala sin estructura de compuerta (ancho = 0 / NULL)
      --   SIN LECTURA     → no hay lectura del día para esta escala
      --   ⚠ SIN APERTURA  → hay nivel_m pero operador no reportó apertura (falta de reporte)
      --   COMPUERTA CERRADA → apertura explícitamente = 0
      --   APERTURA: X.XXm → operando con apertura medida
      estado_apertura := CASE
        WHEN COALESCE(v_ancho_escala, 0) = 0 THEN 'NO APLICA'
        WHEN v_nivel IS NULL THEN 'SIN LECTURA'
        WHEN v_apertura_raw IS NULL THEN '⚠ SIN APERTURA'
        WHEN v_apertura_raw = 0 THEN 'COMPUERTA CERRADA'
        ELSE
          'APERTURA: ' || ROUND(v_apertura_raw::numeric, 2) || 'm'
      END;
      apertura_m := CASE
        WHEN COALESCE(v_ancho_escala, 0) > 0 THEN v_apertura_raw
        ELSE NULL
      END;
      -- Fecha de lectura de escala
      fecha_lectura := v_fecha_lectura;
      -- Alertas de frescura de reportes operativos
      puntos_tramo := v_puntos_total;
      puntos_con_reporte := COALESCE(v_puntos_hoy, 0);
      alerta_tomas := CASE
        WHEN COALESCE(v_puntos_total, 0) = 0 THEN 'SIN PUNTOS'
        WHEN COALESCE(v_puntos_hoy, 0) = 0 THEN '⚠ SIN REPORTE HOY'
        WHEN v_puntos_hoy < v_puntos_total THEN
          '⚠ PARCIAL ' || v_puntos_hoy || '/' || v_puntos_total
        ELSE '✓ AL DÍA'
      END;
      fuente_q_entrada := v_fuente_q;
      tiempo_acum_h := ROUND((v_tiempo_acum_s / 3600.0)::numeric, 2);
      hora_arribo := TO_CHAR(
        (
          v_hora_inicio + make_interval(secs => v_tiempo_acum_s::float8)
        ) AT TIME ZONE 'America/Chihuahua'
        , 'HH24:MI'
      );
      RETURN NEXT;

      v_escala_id := NULL;
      v_nivel := NULL;
      v_apertura := 0;
      v_apertura_raw := NULL;
      v_ancho_escala := NULL;
      v_fecha_lectura := NULL;
      v_puntos_total := 0;
      v_puntos_hoy := 0;
    END LOOP;
  END;
  $$
  LANGUAGE plpgsql STABLE;


  -- ════════════════════════════════════════════════════════════
  -- VERIFICACIÓN
  -- ════════════════════════════════════════════════════════════

  -- 1. Trigger activo — confirmar backfill de gasto_calculado_m3s
  SELECT
    escala_id
    , fecha
    , nivel_m
    , apertura_radiales_m
    , gasto_calculado_m3s
  FROM
    public.lecturas_escalas
  WHERE
    fecha >= CURRENT_DATE - 7
  ORDER BY
    fecha DESC
    , escala_id
  LIMIT
    20;

  -- 2. Perfil completo con FGV + compuertas + frescura de datos
  -- SELECT km_ref, nombre_tramo, q_m3s, y_m, y_normal_m, tipo_curva,
  --        escala_id, nivel_real_m, fecha_lectura, delta_real_cm, estado_lectura,
  --        estado_apertura, apertura_m,
  --        puntos_tramo, puntos_con_reporte, alerta_tomas,
  --        tiempo_acum_h, hora_arribo
  -- FROM fn_perfil_canal_completo()
  -- ORDER BY km_ref;

  -- 3. Verificar K-54 con FGV (ahora coherente con remanso M1)
  -- SELECT * FROM fn_verificar_escala_km(54, 4.42, CURRENT_DATE);

  -- 4. Apertura requerida en una estructura para un gasto dado
  -- SELECT fn_apertura_requerida(35.0, 0.62, 13.3, 3, 4.42) AS apertura_m;