# INFORME TÉCNICO-GERENCIAL
## Mejoras al Modelo Hidráulico SICA — Brechas hacia Modelo Adaptativo
### DR-005 Delicias | Canal Principal Conchos | v3.6b → v4.0 Roadmap
**Fecha:** 28/04/2026 | **Versión:** 1.0 | **Clasificación:** Uso interno Gerencia Técnica

---

## RESUMEN EJECUTIVO

El modelo hidráulico SICA v3.6b opera correctamente como sistema de **monitoreo y cálculo en tiempo real**: calcula gastos con M1 calibrado, genera balances tramo a tramo y alerta sobre niveles críticos. La calibración del 27/04/2026 elevó la eficiencia estimada del canal de 86.8% a 96.8% al corregir el ancla K-0.

Sin embargo, el modelo actual es **estático y determinístico**: produce un número sin margen de error, no aprende de operaciones sucesivas, no propaga incertidumbre y no integra el comportamiento del canal a lo largo del tiempo. Esto limita la capacidad de la Gerencia para tomar decisiones con base en pronóstico, no solo en observación.

Este informe analiza cuatro brechas críticas — **manejo de incertidumbre, retroalimentación automática, aprendizaje dinámico de parámetros y la integración temporal continua** — y propone una ruta de implementación priorizada, técnicamente rigurosa y ejecutable con la infraestructura existente (Supabase, React/TypeScript, Node.js).

El impacto esperado es la transición del sistema de **monitoreo reactivo** a **control adaptativo predictivo**, reduciendo el error de estimación de Q en checkpoints críticos de ±8.6% (K-23 actual) a menos de ±3.0%, con horizon de pronóstico de 36 horas.

---

## I. DIAGNÓSTICO DE ESTADO ACTUAL

### I.1 Indicadores de Calidad del Modelo v3.6b

| Componente | Estado | Confianza | Limitación Crítica |
|---|---|---|---|
| Fórmulas Q (orificio/vertedor) | Implementado | 85% | Cd/Cv fijos, no actualizan |
| Factores M1 | Calibrado 27/04 | 60-90% | Estáticos entre aforos |
| Pérdidas lineales λ | 0.00703 m³/s·km⁻¹ | 65% | Un solo punto de calibración |
| Celeridad de onda c | 0.80 m/s | 40% | Un solo evento observado |
| Factor de atenuación F_aten | 0.27 (km>40) | 45% | Un evento; km<40 sin calibrar |
| Balance hídrico | Tiempo real | 70% | Sin bandas de incertidumbre |
| Pronóstico temporal | **Ausente** | — | No existe horizon predictivo |
| Retroalimentación automática | **Ausente** | — | Recalibración totalmente manual |

### I.2 Gap entre Sistema Actual y Sistema Objetivo

```
MONITOREO REACTIVO (v3.6b)          CONTROL ADAPTATIVO (v4.0)
─────────────────────────           ────────────────────────────
Q = número exacto                   Q = valor ± intervalo confianza
M1 se actualiza: manualmente        M1 se actualiza: automático post-aforo
λ = constante 0.00703               λ(t) = EWMA de observaciones diarias
c = 0.80 m/s fijo                   c(t) = Kalman filtrado con eventos
Estado: instantáneo                 Estado: series de tiempo integradas
Pronóstico: ninguno                 Pronóstico: 36h por tramo
Falla detectada: cuando ocurre      Falla predicha: horas antes
```

---

## II. BRECHA 1 — MANEJO DE INCERTIDUMBRE

### II.1 Análisis Técnico del Problema

El modelo calcula `Q = Cd × (b × ap) × √(2g × Δh) × M1` como valor exacto. En realidad, cada variable porta incertidumbre instrumental y de modelo:

**Fuentes de incertidumbre por variable:**

| Variable | Incertidumbre | Fuente |
|---|---|---|
| Cd = 0.62 | σ_Cd = ±0.020 (3.2%) | Variación hidráulica del orificio |
| ap (apertura) | σ_ap = ±0.010 m | Resolución sensor + juego mecánico |
| Δh (diferencial) | σ_Δh = ±0.005 m | Precisión limnimétrica |
| M1 | σ_M1 variable por punto | Antigüedad y método de calibración |

**Propagación de incertidumbre (primer orden, cuadrática):**

```
(σ_Q/Q)² = (σ_Cd/Cd)² + (σ_ap/ap)² + (σ_M1/M1)² + (½ × σ_Δh/Δh)²
```

**Cálculo por checkpoint con condiciones actuales (28/04/2026):**

| Punto | ap_rep(m) | Δh(m) | σ_M1/M1 | σ_Q/Q | σ_Q (m³/s) | IC 95% |
|---|---|---|---|---|---|---|
| K-0 | 1.450 | 1.130 | 3.4% | **4.7%** | ±1.26 | [24.3, 29.4] |
| K-23 | 0.750 | 0.500 | 8.0% | **9.1%** | ±2.47 | [22.2, 32.1] |
| K-34 | 0.875 | 1.000 | 7.5% | **8.7%** | ±2.02 | [19.1, 27.2] |
| K-44 | 1.225 | 0.750 | 5.0% | **6.3%** | ±1.38 | [19.1, 23.7] |
| K-54 | 1.150 | 0.770 | 4.5% | **5.8%** | ±1.18 | [17.8, 22.4] |
| K-68 | 0.840 | 1.590 | 4.5% | **5.8%** | ±0.78 | [12.0, 14.8] |
| K-79 | 0.800 | 0.790 | 12.0% | **13.1%** | ±1.62 | [9.2, 14.7] |

> **K-79 es el punto más incierto del canal** (M1=1.5824, previamente era 2.8549 — corrección mayor pendiente de validación). La estimación de 12.36 m³/s tiene IC95% de ±3.24 m³/s.

**Incertidumbre del balance global:**
```
σ_perdidas² = σ_Q0² + σ_Q104² + Σ σ_Qzona²
σ_perdidas = √(1.26² + 0.80² + ... ) ≈ ±2.1 m³/s
```
Las "pérdidas" actuales (0.869 m³/s) están dentro del ruido del instrumento. La eficiencia reportada de 96.8% tiene un rango real de [88%, 100%].

### II.2 Impacto Operativo

- Decisiones de apertura/cierre basadas en número puntual que puede estar fuera ±2.5 m³/s.
- IEC score calculado con Q inciertos: el score de eficiencia puede ser ±4 puntos.
- Alertas de NIVEL CRÍTICO en K-54 (Q=20.376 m³/s) pueden ser falsas positivas si σ_Q = ±1.18.
- Sin bandas, el modelo reporta **certeza falsa** a la Gerencia.

### II.3 Solución Técnica Óptima

**Nivel 1 (inmediato, sin infraestructura nueva):** Añadir `σ_M1` por checkpoint en `M1_FACTORS` y calcular `σ_Q` en el mismo `calcRadialFlow`. Mostrar `Q ± σ` en DATOS tab.

```typescript
// En hydraulics.ts — añadir campo sigma_pct a M1_FACTORS
export const M1_FACTORS: M1Entry[] = [
  { nombre: 'K-0+000',  km: 0,      m1: 0.8923, sigma_pct: 3.4 },
  { nombre: 'K-23',     km: 23,     m1: 1.9031, sigma_pct: 8.0 },
  { nombre: 'K-34',     km: 34,     m1: 1.5199, sigma_pct: 7.5 },
  { nombre: 'K-44',     km: 44,     m1: 1.0119, sigma_pct: 5.0 },
  { nombre: 'K-54',     km: 54,     m1: 1.0066, sigma_pct: 4.5 },
  { nombre: 'K-68',     km: 68,     m1: 1.0398, sigma_pct: 4.5 },
  { nombre: 'K-79+025', km: 79.025, m1: 1.5824, sigma_pct: 12.0 },
  // ...
];

// calcRadialFlow retorna { q: number, sigma: number }
export function calcRadialFlowWithUncertainty(params) {
  const q = calcRadialFlow(params);
  const { sigma_ap = 0.010, sigma_dh = 0.005 } = params;
  const { m1, sigma_pct } = getM1FactorEntry(params.nombre, params.km);
  const relSq = 
    Math.pow(0.020 / 0.62, 2) +          // Cd
    Math.pow(sigma_ap / params.ap, 2) +   // apertura
    Math.pow(sigma_pct / 100, 2) +        // M1
    Math.pow(0.5 * sigma_dh / params.dh, 2); // Δh
  return { q, sigma: q * Math.sqrt(relSq) };
}
```

**Nivel 2 (semana 2-4):** Monte Carlo con 1000 muestras para propagación no lineal, especialmente en régimen de remanso extremo (Opción A) donde la aproximación lineal falla.

```typescript
function monteCarloQ(params, N = 1000): { q50: number, q05: number, q95: number } {
  const samples = Array.from({ length: N }, () => {
    const Cd_s = 0.62   + gaussRandom() * 0.020;
    const ap_s = params.ap + gaussRandom() * 0.010;
    const dh_s = Math.max(0.01, params.dh + gaussRandom() * 0.005);
    const M1_s = params.m1 * (1 + gaussRandom() * params.sigma_pct / 100);
    return Cd_s * (params.ancho * ap_s) * Math.sqrt(2 * 9.81 * dh_s) * M1_s;
  }).sort((a, b) => a - b);
  return { q50: samples[500], q05: samples[50], q95: samples[950] };
}
```

---

## III. BRECHA 2 — RETROALIMENTACIÓN AUTOMÁTICA

### III.1 Análisis Técnico del Problema

El flujo actual de retroalimentación requiere intervención manual en 3 pasos:
1. Identificar visualmente una anomalía en Monitor Público
2. Decidir ejecutar `node generar_skill_v36.mjs`
3. Copiar el JSON resultante al modelo Claude

Esto introduce latencia de horas a días entre la aparición de una desviación y su corrección en el modelo.

**Métricas de deriva detectables automáticamente:**

```
Deriva_Q(punto, t) = |Q_calculado(t) - Q_esperado_balance(t)| / Q_esperado_balance(t)

Si Deriva_Q > 0.08 (8%) sostenida por N lecturas consecutivas:
  → Flag "POSIBLE DRIFT M1 — revisar aforo"
  
Si Deriva_Q > 0.15 durante 2+ horas:
  → Alerta automática: "RECALIBRACIÓN REQUERIDA en [punto]"
```

**Drift acumulado detectado (snapshot 28/04/2026):**

| Punto | Q_calc | Q_esperado_bal | Deriva | Estado |
|---|---|---|---|---|
| K-23 | 27.163 | 24.088* | +12.8% | **⚠ Posible sobreestimación** |
| K-29 | 23.797 | 21.688* | +9.7% | ⚠ Monitorear |
| K-44 | 21.900 | 18.938* | +15.6% | **⚠ Recalibrar próximo aforo** |
| K-79 | 12.360 | 9.204* | +34.3% | **🚨 Alta prioridad** |

*Q_esperado = Q0 - λ×km - Σzonas previas

> K-23 y K-79 muestran derives superiores al 12% y 34% respectivamente, indicando que M1 v3.6b ya tiene desviación respecto al balance de masa actual.

### III.2 Solución Técnica Óptima

**Arquitectura de retroalimentación automática:**

```
Supabase lecturas_escalas INSERT
        ↓
Edge Function: calc_drift_monitor
        ↓
Calcula Q para cada punto con M1 actual
Calcula Q_esperado por balance
Compara: deriva(%) = |Q_calc - Q_esp| / Q_esp
        ↓
Si deriva > 8%  → INSERT en tabla 'drift_alerts'
Si deriva > 15% → INSERT + notificación push
        ↓
PublicMonitor Realtime subscription a drift_alerts
        ↓
Badge rojo en pestaña DATOS con "3 puntos con drift"
```

**Schema SQL para tabla de drift:**

```sql
CREATE TABLE drift_alerts (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  punto       TEXT NOT NULL,
  km          NUMERIC NOT NULL,
  q_calculado NUMERIC NOT NULL,
  q_esperado  NUMERIC NOT NULL,
  deriva_pct  NUMERIC NOT NULL,
  m1_actual   NUMERIC NOT NULL,
  m1_sugerido NUMERIC,          -- M1_actual × (Q_esp / Q_calc)
  resuelto    BOOLEAN DEFAULT FALSE,
  resuelto_at TIMESTAMPTZ
);
```

**Edge Function (Supabase Deno):**

```typescript
// supabase/functions/calc-drift-monitor/index.ts
const LAMBDA = 0.00703;
const ZONAS = [
  { km_ini: 23, km_fin: 29, q: 2.400 },
  { km_ini: 34, km_fin: 44, q: 2.750 },
  { km_ini: 54, km_fin: 68, q: 4.635 },
  { km_ini: 79, km_fin: 94, q: 4.200 },
];
const DRIFT_WARN  = 0.08;  // 8%
const DRIFT_ALERT = 0.15;  // 15%

function qEsperada(q0: number, km: number): number {
  let q = q0 - LAMBDA * km;
  for (const z of ZONAS) {
    if (km > z.km_fin) q -= z.q;
    else if (km > z.km_ini) q -= z.q * (km - z.km_ini) / (z.km_fin - z.km_ini);
  }
  return Math.max(0, q);
}

Deno.serve(async (req) => {
  const { record } = await req.json();   // lecturas_escalas row
  const escalas = await fetchAllEscalas(supabase);
  const q0 = escalas.find(e => e.km === 0)?.gasto_actual ?? 0;
  
  for (const e of escalas.filter(e => e.km > 0 && e.km <= 104)) {
    const qCalc = e.gasto_actual ?? 0;
    const qEsp  = qEsperada(q0, e.km);
    if (qEsp === 0) continue;
    const derivaPct = Math.abs(qCalc - qEsp) / qEsp;
    
    if (derivaPct > DRIFT_WARN) {
      const m1Sug = e.m1_actual * (qEsp / qCalc);
      await supabase.from('drift_alerts').upsert({
        punto: e.nombre, km: e.km,
        q_calculado: qCalc, q_esperado: qEsp,
        deriva_pct: derivaPct,
        m1_actual: e.m1_actual, m1_sugerido: m1Sug,
      }, { onConflict: 'punto', ignoreDuplicates: false });
    }
  }
  return new Response('ok');
});
```

**UI en PublicMonitor:** Badge con conteo de puntos con drift en pestaña DATOS. Al hacer clic, tabla expandible con M1_actual, M1_sugerido y botón "Aprobar corrección" (requiere confirmación gerencial).

---

## IV. BRECHA 3 — APRENDIZAJE DINÁMICO DE λ, c Y F_aten

### IV.1 Situación Actual

Los tres parámetros físicos del canal tienen una sola calibración estática:

| Parámetro | Valor v3.6b | Calibraciones | Variación esperada |
|---|---|---|---|
| λ (pérdidas lineales) | 0.00703 m³/s·km⁻¹ | 1 (27/04/2026) | ±40% estacional (evapotranspiración, infiltración) |
| c (celeridad onda) | 0.80 m/s | 1 evento | ±20% según tirante (c = √(g·y_n) para onda de gravedad) |
| F_aten (km>40) | 0.27 | 1 evento | ±15% según forma del pulso |

Estas variaciones **no son ruido — son señal física**. En verano, λ puede llegar a 0.012 m³/s·km⁻¹ por evapotranspiración; con tirantes altos, c puede aumentar a 0.95 m/s.

### IV.2 Modelo de Aprendizaje para λ

**Estimación diaria de λ:**
```
λ_diario(t) = [Q0(t) - Q104(t) - Σ_zonas] / 104 km

Condición de validez: Q0 > 5 m³/s  AND  |Q0 - Q104| < 25 m³/s
Rechazar outliers: |λ_diario - λ_EWMA| > 3σ_λ
```

**EWMA (Exponentially Weighted Moving Average):**
```
λ_EWMA(t) = α × λ_diario(t) + (1 - α) × λ_EWMA(t-1)

α = 0.10  → half-life ≈ 6.6 días (responde a cambios en ~1 semana)
```

**Modelo estacional (ciclo 365 días):**
```
λ_base(mes) = λ_historico_promedio(mes)  [construir con 1 año de datos]

Índice estacional: IS(t) = λ_EWMA(t) / λ_base(mes_t)
Útil para anticipar: "Entrando a mayo, esperar λ ≈ 0.009 m³/s·km⁻¹"
```

**Schema SQL:**
```sql
CREATE TABLE lambda_historico (
  fecha       DATE PRIMARY KEY,
  lambda_diario   NUMERIC,
  lambda_ewma     NUMERIC,
  q0          NUMERIC,
  q104        NUMERIC,
  q_zonas     NUMERIC,
  valido      BOOLEAN
);
```

### IV.3 Filtro de Kalman para c y F_aten

Cada evento de onda observable (cambio en Boquilla → detectable en K-94/K-104) proporciona dos observaciones: `T_tránsito` y `ΔQ_ratio`.

**Estado:**
```
x = [c, F_aten]^T    (vector de estado 2×1)
```

**Modelo de observación para un evento K-0 → K-104 (104 km):**
```
T_obs = 104,000 m / c / 60 s       →  z1 = T_obs
ΔQ_ratio_obs = ΔQ_K104 / ΔQ_K0    →  z2 = ΔQ_ratio_obs

Jacobiano H (linealización):
H = [ -104000/(c²×60)   0    ]    (∂T/∂c)
    [       0          -1    ]    (∂ratio/∂F_aten)
```

**Actualización Kalman:**
```
P_prior = P_posterior + Q_proceso
          donde Q_proceso = diag(0.001², 0.005²)  [ruido de proceso pequeño — parámetros físicos]

K = P_prior × H^T × (H × P_prior × H^T + R)^(-1)
    donde R = diag(10², 0.05²)  [incertidumbre timestamp ±10min, ΔQ ratio ±5%]

x_posterior = x_prior + K × (z_obs - H × x_prior)
P_posterior = (I - K × H) × P_prior
```

**Convergencia esperada:**

| Evento | σ_c (m/s) | σ_F_aten |
|---|---|---|
| Actual (1 evento) | ±0.16 | ±0.085 |
| 3 eventos | ±0.09 | ±0.049 |
| 8 eventos | ±0.05 | ±0.027 |
| 20 eventos | ±0.03 | ±0.015 |

Con 8 eventos (≈ 2 meses de operación normal), la celeridad convergerá a precisión operativa.

**Actualización teórica de c basada en tirante:**
```
c_teorica = √(g × y_n_media)    [onda cinemática en canal rectangular]

Para tirante normal y_n ≈ 2.5 m:  c_teo = √(9.81 × 2.5) = 4.95 m/s  [demasiado rápido]
Para onda difusiva real:           c ≈ 0.5 × V_flujo + 0.5 × c_teo × factor

Nota: c=0.80 m/s calibrado sugiere onda de difusión, no cinemática pura.
Usar Kalman como estimador empírico, no derivación teórica.
```

### IV.4 Trigger de Detección de Evento de Onda

Para alimentar el Kalman automáticamente, se necesita detectar eventos:

```typescript
// En Edge Function post-insert lecturas_escalas:

function detectWaveEvent(lecturas: TimeSeries, checkpoint: string): WaveEvent | null {
  // Serie: últimas 4h de Q en el checkpoint
  const dQ = diff(lecturas.map(l => l.q));
  const maxDQ = Math.max(...dQ.map(Math.abs));
  
  if (maxDQ > 1.0) {  // cambio > 1.0 m³/s en una lectura
    const t_event = lecturas[dQ.indexOf(dQ.find(d => Math.abs(d) === maxDQ))].timestamp;
    return { checkpoint, t_event, delta_q: maxDQ };
  }
  return null;
}

// Si se detecta evento en K-0 → registrar
// Si se detecta evento en K-104 con ~2167 min de delay → calcular c = 104000/(T_obs×60)
// → Actualizar Kalman → persistir c_kalman en tabla parametros_dinamicos
```

---

## V. BRECHA 4 — INTEGRACIÓN TEMPORAL CONTINUA

### V.1 Análisis del Problema

El modelo actual produce un **estado instantáneo**: snapshot de Q, H, alertas en t=ahora. No existe:
- Registro histórico consultable de series de tiempo de Q por checkpoint
- Cálculo de volumen acumulado entregado por zona
- Balance hídrico integrado (m³ totales, no solo m³/s)
- Pronóstico de Q futuro basado en posición actual de ondas

**Consecuencia operativa:** No se puede responder a preguntas como:
- "¿Cuántos m³ ha recibido Z3 hoy?"
- "¿A qué hora llegará el pulso de Boquilla a K-68?"
- "¿El tirante en K-44 seguirá subiendo en las próximas 3 horas?"

### V.2 Balance Hídrico Integrado

**Ecuación de continuidad discreta por tramo:**
```
ΔV_tramo(t) = [Q_entrada(t) + Q_entrada(t-1)] / 2 × Δt
            - [Q_salida(t)  + Q_salida(t-1)]  / 2 × Δt

donde Δt = intervalo entre lecturas (típico: 15 min = 900 s)
```

**Volumen entregado a zona Z_i en periodo [t1, t2]:**
```
V_Zi = Σ_{t=t1}^{t2} [Q_entrada_zona(t) + Q_entrada_zona(t+1)] / 2 × Δt

Para Z3 (K-54 a K-68, Q extracción 4.635 m³/s nominal):
V_Z3_diario = 4.635 × 86400 = 400,464 m³/día ≈ 0.40 Mm³/día (nominal)
```

**Eficiencia de entrega Z_i:**
```
η_Zi(periodo) = V_entregado_real(periodo) / V_entregado_nominal(periodo)
```

**Schema SQL para series de tiempo:**
```sql
CREATE TABLE q_timeseries (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,
  punto       TEXT NOT NULL,
  km          NUMERIC NOT NULL,
  q           NUMERIC,
  h_arr       NUMERIC,
  h_aba       NUMERIC,
  m1_usado    NUMERIC,
  UNIQUE(ts, punto)
);

CREATE INDEX q_ts_idx ON q_timeseries (punto, ts DESC);

-- Vista: volumen diario por zona
CREATE VIEW vol_diario_zonas AS
SELECT
  date_trunc('day', ts) AS dia,
  SUM(CASE WHEN km BETWEEN 23 AND 29 THEN q * 900 ELSE 0 END) / 1e6 AS vol_z1_Mm3,
  SUM(CASE WHEN km BETWEEN 34 AND 44 THEN q * 900 ELSE 0 END) / 1e6 AS vol_z2_Mm3,
  SUM(CASE WHEN km BETWEEN 54 AND 68 THEN q * 900 ELSE 0 END) / 1e6 AS vol_z3_Mm3,
  SUM(CASE WHEN km BETWEEN 79 AND 94 THEN q * 900 ELSE 0 END) / 1e6 AS vol_z4_Mm3
FROM q_timeseries
GROUP BY 1;
```

### V.3 Motor de Pronóstico de 36 Horas

**Principio:** La posición de una onda en tránsito es determinista dado c y F_aten. Si se detecta un cambio ΔQ en K-0 en t=T₀, se puede calcular cuándo y cuánto llegará a cada checkpoint.

```typescript
interface WaveFront {
  origin_km: number;
  origin_t: Date;
  delta_q_origin: number;
}

function propagateWave(wave: WaveFront, c: number, F_aten: number, checkpoints: Checkpoint[]) {
  return checkpoints
    .filter(cp => cp.km > wave.origin_km)
    .map(cp => {
      const dist_m = (cp.km - wave.origin_km) * 1000;
      const T_min  = dist_m / c / 60;
      const arrive = new Date(wave.origin_t.getTime() + T_min * 60_000);
      const aten   = cp.km > 40 ? (1 - F_aten) : 0.55;  // F_aten 0-40km pendiente
      const dQ_arr = wave.delta_q_origin * aten;
      return { punto: cp.nombre, km: cp.km, arrive_at: arrive,
               delta_q: +dQ_arr.toFixed(3), T_min: Math.round(T_min) };
    });
}
```

**Tabla de pronóstico ejemplo (evento Boquilla +2.0 m³/s en T₀):**

| Checkpoint | T llegada | ΔQ esperado | Q proyectado |
|---|---|---|---|
| K-23 | T₀ + 7h 59m | +1.46 m³/s | 28.62 m³/s |
| K-34 | T₀ + 13h 27m | +1.46 m³/s | 24.63 m³/s |
| K-44 | T₀ + 16h 55m | +1.46 m³/s | 23.36 m³/s |
| K-54 | T₀ + 20h 23m | +1.46 m³/s | 21.84 m³/s |
| K-68 | T₀ + 25h 15m | +1.46 m³/s | 14.99 m³/s |
| K-79 | T₀ + 29h 05m | +1.46 m³/s | 13.82 m³/s |
| K-104 | T₀ + 36h 07m | +1.46 m³/s | 13.45 m³/s |

> Verificar bordo libre antes de que la onda llegue: ΔH_approx = ΔQ / (Cv × b_espejo) ≈ 1.46 / (1.84 × 12) ≈ **+0.066 m** en K-44, que con BL actual de -0.050 m → nivel **-0.116 m** sobre nivel máximo operativo → **ALERTA PREVIA DE DESBORDAMIENTO**.

---

## VI. ROADMAP DE IMPLEMENTACIÓN

### VI.1 Priorización (Impacto vs. Esfuerzo)

```
         IMPACTO OPERATIVO
         Alto  │  [3] Kalman c,F    [1] Drift auto
               │
               │  [4] Pronóstico    [2] λ EWMA
         Bajo  └────────────────────────────────
                    Bajo             Alto
                         ESFUERZO
```

| # | Mejora | Fase | Semanas | Impacto | Responsable |
|---|---|---|---|---|---|
| 1 | Drift automático + alertas | 1 | 1–2 | Alto | Backend / Edge Functions |
| 2 | Bandas de incertidumbre en UI | 1 | 1–2 | Alto | Frontend |
| 3 | λ EWMA (tabla + cálculo diario) | 2 | 3–4 | Medio-Alto | Backend |
| 4 | Series de tiempo Q (tabla histórica) | 2 | 3–5 | Alto | Backend + Supabase |
| 5 | Volumen integrado por zona | 3 | 5–7 | Alto | Backend + UI |
| 6 | Kalman c y F_aten | 3 | 6–9 | Medio | Algoritmo |
| 7 | Motor pronóstico 36h | 4 | 8–12 | Alto | Algoritmo + UI |
| 8 | Monte Carlo Q (1000 muestras) | 4 | 9–12 | Medio | Algoritmo |

### VI.2 Detalle de Fases

#### FASE 1 — Observabilidad Inmediata (Semanas 1–2)
**Objetivo:** El sistema detecta y avisa sin intervención humana.

- [ ] `hydraulics.ts` — añadir `sigma_pct` a `M1_FACTORS`
- [ ] `calcRadialFlow` retorna `{ q, sigma }` para mostrar `Q ± σ` en DATOS tab
- [ ] Tabla SQL `drift_alerts` + Edge Function `calc-drift-monitor`
- [ ] Badge de drift en UI (PublicMonitor DATOS tab)
- [ ] Retención: trigger automático en lecturas_escalas INSERT → detectar deriva

**Entregable:** Monitor muestra `26.84 ± 1.26 m³/s` en K-0 y badge "2 puntos con drift > 8%"

#### FASE 2 — Memoria del Sistema (Semanas 3–5)
**Objetivo:** El sistema recuerda su historia y aprende λ.

- [ ] Tabla SQL `q_timeseries` — insertar Q calculado con cada lectura nueva
- [ ] Tabla SQL `lambda_historico` — cálculo diario programado (pg_cron o Edge Function)
- [ ] EWMA λ — actualización automática, valor visible en DATOS tab
- [ ] Dashboard básico de series de tiempo (últimas 24h por checkpoint)

**Entregable:** Gráfica de Q(t) por checkpoint + λ_EWMA en tiempo real

#### FASE 3 — Integración Volumétrica (Semanas 5–8)
**Objetivo:** Responder "¿cuántos m³ se han entregado?"

- [ ] Vista SQL `vol_diario_zonas`
- [ ] API endpoint `/api/volumenes?desde=2026-04-01&hasta=2026-04-28`
- [ ] Panel de volúmenes en Monitor Público: m³ del día, m³ del mes
- [ ] Comparativo nominal vs. real por zona
- [ ] Kalman básico c/F_aten (2 parámetros, sin UI — solo persistencia)

**Entregable:** "Z3 lleva 1.82 Mm³ del mes (92.3% de nominal)"

#### FASE 4 — Pronóstico (Semanas 8–12)
**Objetivo:** Anticipar 36h antes de que ocurran problemas.

- [ ] Detector de eventos de onda en K-0 (cambio > 1.0 m³/s)
- [ ] `propagateWave()` con c_kalman, F_aten_kalman
- [ ] Panel "PRONÓSTICO" en dock — tabla de llegadas esperadas con alertas de BL
- [ ] Monte Carlo de incertidumbre en pronóstico
- [ ] Integración con SICA Capture: aforo manual → trigger recalibración M1 automática

**Entregable:** "Onda de +2.0 m³/s detectada en K-0. Llegará a K-68 en 25h 15m. ⚠ Revisar bordo libre K-54 antes de T₀+20h 23m."

---

## VII. MÉTRICAS DE ÉXITO (KPIs)

| KPI | Baseline v3.6b | Meta v4.0 | Medición |
|---|---|---|---|
| Error estimación Q promedio | ±7.3% | ±3.0% | MAE Q_calc vs Q_aforo |
| Latencia detección drift | Manual (horas) | <15 min automático | Edge Function lag |
| Cobertura incertidumbre | 0% puntos con σ | 100% puntos con σ | Campos completados |
| Precisión λ estacional | ±40% variación no capturada | ±10% EWMA tracking | Residuos diarios |
| Confianza celeridad c | 40% (1 evento) | ≥80% (8+ eventos) | σ_c Kalman |
| Horizon pronóstico | 0 horas | 36 horas | T_max propagación |
| Tiempo recalibración M1 | 2-8 horas (manual) | <30 min post-aforo | Timestamp aforo → DB |
| Volumen entregado trackeado | No | Sí (m³ diario/mensual) | Registros tabla |

---

## VIII. ANÁLISIS COSTO-BENEFICIO GERENCIAL

### VIII.1 Costos de Implementación (estimados)

| Fase | Horas técnicas | Recursos adicionales |
|---|---|---|
| Fase 1 (Drift + σ) | 20–30 h | Supabase Edge Functions (tier actual) |
| Fase 2 (Series tiempo + λ) | 30–40 h | Supabase storage adicional (~5GB/año) |
| Fase 3 (Volúmenes + Kalman) | 40–60 h | pg_cron o similar |
| Fase 4 (Pronóstico + Monte Carlo) | 60–80 h | Ninguno adicional |
| **Total** | **150–210 h** | **~$50 USD/mes adicional en Supabase** |

### VIII.2 Beneficios Cuantificables

| Beneficio | Estimación |
|---|---|
| Reducción incidentes por niveles críticos | 1 evento/mes → 0.2 (con pronóstico 36h previo) |
| Precisión de balance hídrico | ±0.87 m³/s actual → ±0.30 m³/s |
| Volumen adicional distribuible (mejor control) | 0.5–1.5% eficiencia → 250,000–750,000 m³/ciclo |
| Reducción tiempo de análisis Gerencia Técnica | 3–4 h/semana → <1 h/semana |
| Calibraciones de campo necesarias | 8 por ciclo (actual) → 3 (modelo guía prioridad) |

### VIII.3 Riesgo de No Implementar

El riesgo de mantener el modelo estático es proporcional al tiempo transcurrido desde la última calibración. Con λ, c y F_aten fijos:
- En 60 días, λ puede derivar ±0.003 m³/s·km⁻¹ (+43%) por condiciones estacionales
- Un evento de onda mal pronosticado puede inundar terrenos adyacentes (BL actual ya negativo en 5 de 14 puntos)
- Sin series de tiempo, no hay posibilidad de auditoría de volúmenes ante reclamos de usuarios

---

## IX. RECOMENDACIÓN GERENCIAL

**Implementar en secuencia estricta Fase 1 → 2 → 3 → 4, sin saltarse pasos.**

La Fase 1 es la más crítica y la menos costosa: el sistema ya tiene toda la infraestructura necesaria (Supabase, lecturas_escalas, PublicMonitor con Realtime). Solo requiere añadir lógica de comparación automática y los campos `sigma_pct` en M1_FACTORS. Esto es ejecutable en 1–2 semanas de trabajo y elimina el riesgo de que la Gerencia tome decisiones sobre estimaciones de Q con ±13% de incertidumbre no reportada.

Las Fases 2–4 construyen sobre la base de datos acumulada de la Fase 1 y 2. El Kalman necesita eventos observados (Fase 2 los registra). El pronóstico necesita c confiable (Fase 3 lo estabiliza). El sistema crece orgánicamente con cada operación del canal — no requiere inversión de golpe.

**El objetivo final es un modelo que mejora con el uso**: cada maniobra registrada refina λ, cada evento de onda confirma c, cada aforo de campo actualiza M1 sin intervención manual.

---

*SICA — Sistema de Información y Control de Agua | DR-005 Delicias*
*Elaborado: 28/04/2026 | Para: Gerencia Técnica DR-005*
*Referencia: Skill Hidráulica v3.6b, Calibración 27/04/2026*
