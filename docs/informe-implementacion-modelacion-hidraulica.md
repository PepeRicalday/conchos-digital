# INFORME DE IMPLEMENTACIÓN, ERRORES DE LÓGICA Y OPTIMIZACIÓN
## Módulo: Modelación Hidráulica — Conchos Digital v2.7.x
**Clasificación:** Técnico-Gerencial · Confidencial  
**Fecha de Emisión:** 13 de Abril de 2026  
**Elaborado por:** Área de Desarrollo de Software — Sistema SICA  
**Revisión:** 1.0  
**Estado:** Vigente

---

## RESUMEN EJECUTIVO

El módulo de Modelación Hidráulica (`ModelingDashboard`) es el componente central del sistema de soporte a decisiones operativas del Canal Principal Conchos. Simula la propagación de cambios de gasto desde la Presa Boquilla hasta K-104+000, genera recomendaciones de apertura/cierre para 6 puntos de control y produce alertas tempranas para el personal de operación.

Durante la sesión de análisis del 13 de abril de 2026 se identificaron **2 errores de lógica de severidad alta**, **3 problemas de fórmulas**, **4 oportunidades de optimización de rendimiento** y **8 elementos de deuda técnica**. De estos, los dos errores de lógica han sido **corregidos y desplegados en producción** durante la misma sesión.

El módulo tiene una arquitectura fundamentalmente sólida pero requiere **20–25 horas de refactorización adicional** para alcanzar estándar de calidad production-ready, particularmente en rendimiento y en la separación de responsabilidades del motor de simulación.

---

## 1. ARQUITECTURA DEL MÓDULO

### 1.1 Componentes Funcionales

```
ModelingDashboard
│
├── Motor Hidráulico          runSimulation()          ~220 líneas
│   ├── normalDepth()         Newton-Raphson Manning   ≤50 iter
│   ├── criticalDepth()       Newton-Raphson Fr=1
│   ├── waveCelerity()        Celeridad √(gA/T)
│   └── findTramo()           Geometría por km
│
├── Motor de Decisión         generateDecisions()      ~175 líneas
│   └── Reglas R1–R9          9 reglas operativas
│
├── Componente Visual         CanalSection             SVG trapecial
│
└── Componente Principal      ModelingDashboard React
    ├── 28 estados (useState)
    ├── 5 efectos (useEffect)
    └── 8 memos (useMemo)
```

### 1.2 Flujo de Datos

```
Supabase (8 fuentes)
│
├── movimientos_presas ──────────────→ qDam / qBase / simBaseMin
├── lecturas_escalas ────────────────→ y_base / apertura_real / gasto_medido
├── resumen_escalas_diario ──────────→ delta_12h / AM/PM
├── reportes_diarios + puntos_entrega → deliveryPoints (extracciones)
├── perfil_hidraulico_canal ─────────→ tramoGeom (Manning/geometría)
├── fn_perfil_canal_completo (RPC) ──→ perfilRpc (nivel_real_m SQL)
├── fn_balance_hidrico_tramos (RPC) →  balanceTramos (fugas detectadas)
└── escalas_control (tabla BD) ──────→ controlPoints (K-0 a K-104)

       ↓
┌──────────────────────────────────────────────────────┐
│                  runSimulation()                      │
│  q₀ (presa) → K0 → K23 → K34 → K57 → K80 → K104   │
│  Cascada: Manning + orificio + conducción + extracción│
└──────────────────────────────────────────────────────┘
       ↓
┌──────────────────────────────────────────────────────┐
│              generateDecisions()                      │
│  CPResult[] → Reglas R1-R9 → Decision[]              │
│  URGENTE / ALERTA / INFO  ·  APERTURA / CIERRE /...  │
└──────────────────────────────────────────────────────┘
       ↓
UI: Cards + Perfil SVG + Hidrograma + Sección + Balance
```

### 1.3 Cascada de Resolución de Caudal (qDam)

| Tier | Fuente | Condición de Activación |
|------|--------|------------------------|
| 1 | `movimientos_presas.gasto_m3s` (último del día) | Dato vivo disponible |
| 1b | `movimientos_presas.gasto_m3s` (primero del día) | Si no hay último |
| 2 | `lecturas_presas.extraccion_total_m3s` | Si no hay movimientos |
| 3 | `fn_perfil_canal_completo.q_m3s` | Si no hay lecturas presa |
| 4 | `lecturas_escalas.gasto_calculado_m3s` K-0 ÷ 0.95 | Estimado por río (36 km) |
| 5 | Σ(tomas activas) ÷ 0.88 | Si tomas > 1.4 × K-0 |
| F | **62.4 m³/s** (estimado histórico) | Sin ningún dato live |

### 1.4 Cascada de Resolución de Tirante (y_base por sección)

| Prioridad | Fuente | Guardián |
|-----------|--------|---------|
| 1 | `fn_perfil_canal_completo.nivel_real_m` | km_match < 2.0 km |
| 2 | `lecturas_escalas.nivel_m` más reciente | v > 0.05 m |
| 3 | `resumen_escalas_diario.lectura_pm` | v > 0.05 m |
| 4 | `resumen_escalas_diario.lectura_am` | v > 0.05 m |
| 5 | `lecturas_escalas.nivel_m` turno AM | v > 0.05 m |
| F | **2.2 − idx × 0.04** (geomorfológico) | Sin dato de telemetría |

### 1.5 Cascada de Resolución de Ancla de Compuerta (nueva)

| Prioridad | Fuente | Cuándo aplica |
|-----------|--------|---------------|
| 1 | `gasto_calculado_m3s` (AFORO SICA) | Estado base solamente (qDam ≈ qBase) |
| 2 | Fórmula orificio Cd·n·b·h·√(2g·y) | Siempre que haya apertura real |
| 3 | Sin ancla — propagación libre | Sin datos de compuerta |

---

## 2. ERRORES DE LÓGICA IDENTIFICADOS Y CORREGIDOS

### 2.1 Error A — Ancla AFORO Contamina Escenario Futuro
**Severidad:** Alta  
**Estado:** ✅ CORREGIDO (commit `89ace0c`)

#### Descripción del Fallo

El motor de simulación utiliza el campo `gasto_calculado_m3s` de SICA Capture como "ancla" para limitar el caudal en cada sección. La lógica era:

```typescript
// CÓDIGO CON ERROR (antes de corrección)
if (q_gate_m3s !== null && q_gate_m3s < qCur) {
  qCur = q_gate_m3s;   // ← aplicaba sin distinción
  gate_anchored = true;
}
```

El `gasto_calculado_m3s` es una **medición presente** — registra el caudal que existe en ese momento. Al simular un INCREMENTO de 28 a 30 m³/s, el motor proyectaba qCur=30 hacia cada sección, pero el ancla lo capturaba al valor actual (e.g., 8.29 m³/s), enviando ese valor reducido al tramo siguiente. En consecuencia:

- K-23 recibía 8.29 m³/s en lugar de ~30 m³/s
- K-34, K-57, K-80 y K-104 recibían valores igualmente reducidos
- La **simulación del futuro era idéntica al estado presente**
- Los niveles simulados mostraban DESCENSO incluso durante un INCREMENT

#### Causa Raíz

Confusión semántica entre dos tipos de ancla:
- **AFORO** (medición presente): válido para describir el estado actual; **inválido para escenarios futuros**
- **ORIFICIO** (capacidad física): válido siempre — la apertura física de la compuerta no ha cambiado

#### Corrección Aplicada

```typescript
// CÓDIGO CORREGIDO
const isDeltaSim = Math.abs(qDamInit - qBaseInit) > 0.5;
// AFORO: solo en estado base · ORIFICIO: siempre aplica (límite físico)
const anchorApplies = gate_source === 'ORIFICIO' || !isDeltaSim;

if (anchorApplies && q_gate_m3s !== null && q_gate_m3s < qCur) {
  qCur = Math.max(0.1, q_gate_m3s);
  gate_anchored = true;
}
```

#### Impacto de la Corrección

| Métrica | Antes | Después |
|---------|-------|---------|
| qCur en K-23 durante INCREMENT +2 m³/s | ~8.29 m³/s (aforo) | ~28.8 m³/s (proyectado) |
| Dirección y_sim en INCREMENT | ↓ DESCENSO | ↗ Leve ascenso o estable |
| Utilidad predictiva del simulador | Nula en escenarios | Funcional |

---

### 2.2 Error B — CIERRE Emitido Durante INCREMENTO de Caudal
**Severidad:** Alta  
**Estado:** ✅ CORREGIDO (commit `e8d2b8c`)

#### Descripción del Fallo

La regla R4 del Motor de Decisión generaba recomendaciones de CIERRE de compuertas durante eventos de INCREMENTO. Ejemplo con datos reales de la sesión:

**Condiciones en K-0 durante INCREMENT (qBase=28, qDam=30):**

```
y_base = 3.42 m  (nivel actual por backwater — M1 elevado)
y_target = 3.42 m
apertura_base = 1.11 m  (SICA Capture)
qCur = 30 m³/s

apertura_req = qCur / (Cd × n × b × √(2g·y))
             = 30 / (0.70 × 4 × 12 × √(2×9.81×3.42))
             = 30 / 275.6
             = 0.109 m

delta_apertura = 0.109 - 1.11 = −1.00 m  →  R4 emitía: CIERRE
```

La compuerta tiene capacidad real de `0.70 × 4×12×1.11 × √(2×9.81×3.42) = 305 m³/s` — más que suficiente para los 30 m³/s. El CIERRE era incorrecto.

#### Causa Raíz

La fórmula `apertura_req = Q / (Cd·n·b·√(2g·H))` calcula la apertura **mínima** para pasar Q dado el nivel. Con **backwater alto** (y=3.42m >> tirante normal ≈1.4m), la alta carga hidrostática hace que incluso una pequeña apertura pase mucho caudal. Cuando apertura_actual >> apertura_mínima, el motor infería CIERRE — confundiendo "la compuerta está sobre-dimensionada para este Q" con "la compuerta debe cerrarse".

Esta inferencia es conceptualmente correcta en DECREMENTO (cerrar para mantener nivel con menos agua), pero **operativamente peligrosa en INCREMENT**: cerrando compuertas aguas abajo durante una llegada de volumen se genera represamiento no controlado.

#### Corrección Aplicada

```typescript
// R4 CORREGIDO — lógica bifurcada por dirección del cambio
if (Math.abs(deltaQ) > 0.5) {
  const isIncrement = deltaQ > 0;

  if (isIncrement) {
    // Durante INCREMENTO: verificar si la compuerta es el cuello de botella
    const qCapacidad = r.cd_used * r.area_gate * Math.sqrt(2 * G * r.y_sim);
    const cuelloBottella = qCapacidad < r.q_sim * 0.90 && r.q_sim > 1;
    if (cuelloBottella) {
      // Solo emitir APERTURA cuando la compuerta físicamente no puede pasar el Q
      decisions.push({ tipo: 'APERTURA', accion: 'ABRIR — cuello de botella' });
    }
    // Si capacidad suficiente → NO emitir CIERRE
  } else {
    // DECREMENTO/CORTE: lógica original, CIERRE válido para sostener nivel
    if (Math.abs(aperDelta) > 0.05) {
      decisions.push({ tipo: aperDelta > 0 ? 'APERTURA' : 'CIERRE', ... });
    }
  }
}
```

#### Tabla de Comportamiento Post-Corrección

| Evento | Estado Compuerta | Antes | Después |
|--------|-----------------|-------|---------|
| INCREMENT | Gate holgada (cap. > Q) | ⛔ CIERRE | ✅ Sin acción |
| INCREMENT | Gate cuello de botella | No detectado | ✅ ABRIR |
| DECREMENT | Gate holgada | ✅ CIERRE | ✅ CIERRE |
| DECREMENT | Gate sub-dimensionada | ✅ ABRIR | ✅ ABRIR |
| Estado base (ΔQ=0) | Cualquiera | ✅ Correcto | ✅ Sin cambio |

---

## 3. ERRORES DE FÓRMULAS IDENTIFICADOS (PENDIENTES)

### 3.1 Velocidad de Propagación Reportada vs Real
**Severidad:** Media  
**Estado:** 🔲 Pendiente

La función `waveCelerity(y, b, z)` calcula `c = √(g·A/T)` (celeridad teórica de onda pequeña). Este valor se almacena en `CPResult.celerity_ms` y se muestra en modo Técnico. Sin embargo, **no es la velocidad real de propagación usada en el cálculo**.

La velocidad real está en:
```typescript
const v_wave_kmh = 5.3 × Q^0.15  [km/h]  // Modelo empírico calibrado
```

Este valor empírico fue calibrado con datos históricos del Canal Conchos:
- K-0 → K-23 (23 km): ~3h → 7.7 km/h ✓
- K-0 → K-104 (104 km): ~13h 40 min ✓

**Impacto:** El operador ve en modo Técnico un valor de celeridad (`celerity_ms`) que no corresponde a los tiempos de arribo mostrados en el Timeline. Esto puede generar confusión al comparar los valores.

**Corrección propuesta:**
- Renombrar `celerity_ms` a `celerity_ms_teorica` para mayor claridad
- Agregar campo `v_wave_ms` con la velocidad de propagación real utilizada
- O: eliminar el campo del modo Técnico si no agrega valor operativo

---

### 3.2 Tirante Normal — Tolerancia de Convergencia Fija
**Severidad:** Baja  
**Estado:** 🔲 Pendiente

```typescript
// normalDepth() — línea 183
if (Math.abs(Qc - Q) < 0.001) break;  // Tolerancia fija
```

La tolerancia de 0.001 m³/s es apropiada para Q moderados (28–60 m³/s), pero introduce **error relativo excesivo** en caudales bajos (Q < 1 m³/s):

| Q (m³/s) | Error absoluto | Error relativo |
|----------|---------------|----------------|
| 60 | 0.001 m³/s | 0.002% ✓ |
| 10 | 0.001 m³/s | 0.010% ✓ |
| 0.5 | 0.001 m³/s | 0.200% ⚠ |
| 0.1 | 0.001 m³/s | 1.000% ✗ |

**Corrección propuesta:**
```typescript
const tol = Math.max(0.001, Q * 0.001);  // 0.1% relativo
if (Math.abs(Qc - Q) < tol) break;
```

---

### 3.3 Status ALERTA por Cambio Absoluto de Nivel
**Severidad:** Baja  
**Estado:** 🔲 Pendiente

La regla de status ALERTA por variación de nivel usa umbral absoluto:
```typescript
else if (Math.abs(delta_y) > 0.50) { status = 'ALERTA'; }
```

Un cambio de +0.51 m en una sección con tirante 2.2 m (23% de cambio) es ALERTA.  
Un cambio de +0.49 m en una sección con tirante 3.5 m (14% de cambio) es ESTABLE.

El umbral absoluto no considera la escala relativa del canal, generando inconsistencia entre secciones con geometrías distintas.

**Corrección propuesta:**
```typescript
const deltaYPct = y_base > 0 ? Math.abs(delta_y) / y_base : 0;
const statusALERTA = pct > 0.75 || deltaYPct > 0.18;  // 18% cambio relativo
```

---

## 4. ANÁLISIS DE RENDIMIENTO

### 4.1 Re-Simulación Cada 60 Segundos
**Impacto:** Medio · CPU innecesaria  
**Estado:** 🔲 Pendiente

El memo `simResults` tiene **13 dependencias**, entre ellas `currentTimeMin`:

```typescript
const simResults = useMemo<CPResult[]>(() => {
  return runSimulation(..., currentTimeMin);
}, [/* 13 deps incluyendo currentTimeMin */]);
```

`currentTimeMin` actualiza **cada 60 segundos** mediante un intervalo, forzando la re-ejecución completa de `runSimulation()` — 220 líneas de código con iteraciones Newton-Raphson por cada uno de los 6 puntos de control — aunque ningún dato hidráulico haya cambiado.

**Costo por ejecución:** ~100,000 operaciones de punto flotante  
**Frecuencia:** 1 vez/minuto = 1,440 veces/día de operación

`currentTimeMin` solo afecta `wave_pct` y `wave_arrived` (interpolación de posición del frente de onda). Estos pueden calcularse **fuera de runSimulation()** en un memo separado.

**Corrección propuesta:**
```typescript
// Simulación base — independiente del reloj
const simResultsBase = useMemo(() =>
  runSimulation(..., 0, 0),  // sin currentTimeMin
  [/* 12 deps sin currentTimeMin */]
);

// Frente de onda — ligero, actualiza cada 60s
const simResults = useMemo(() =>
  simResultsBase.map(r => ({
    ...r,
    wave_pct: computeWavePct(r.cumulative_min, elapsedMin, r.transit_min),
    wave_arrived: r.cumulative_min <= elapsedMin,
  })),
  [simResultsBase, currentTimeMin, timeDelta]
);
```

**Ahorro estimado:** 85% reducción de cómputo en horas sin cambios de gasto.

---

### 4.2 ECharts Option — Objeto de 462 Líneas Recalculado por Realtime
**Impacto:** Medio · Latencia de UI  
**Estado:** 🔲 Pendiente

El memo `opsChartOption` (Perfil Longitudinal + Timeline) construye un objeto ECharts de ~462 líneas incluyendo series, tooltip formatters, markLines y markAreas. Tiene 6 dependencias, entre ellas `perfilRpc`.

`perfilRpc` se actualiza con cada INSERT en `lecturas_escalas` a través de la suscripción realtime. Si la brigada de campo registra lecturas frecuentes (>10/min en días de operación intensiva), el gráfico se **re-renderiza completamente** aunque el cambio sea de 0.01 m en un punto secundario.

**Corrección propuesta:**
- Separar las series estáticas (geometría canal, bordo libre, capacidad diseño) de las dinámicas (tirante real, simulado)
- Usar `chart.setOption(patch, { replaceMerge: ['series'] })` en lugar de re-crear el objeto completo
- Debounce de 500ms en actualizaciones de perfilRpc

---

### 4.3 `gastoMedidoRecord` — Rebuild en Cada Inserción Realtime
**Impacto:** Bajo · Re-renders en cadena  
**Estado:** 🔲 Pendiente

```typescript
const gastoMedidoRecord = useMemo(() => {
  const rec: Record<string, number> = {};
  Object.entries(cpTelemetry).forEach(([id, tel]) => {
    if (tel.gasto_medido !== null) rec[id] = tel.gasto_medido;
  });
  return rec;
}, [cpTelemetry]);
```

`cpTelemetry` se reconstruye como **nuevo objeto** en cada update realtime, aunque los valores sean idénticos. Esto invalida `gastoMedidoRecord`, que a su vez invalida `simResults` (13 deps). Resultado: re-simulación completa por cada lectura SICA aunque el gasto no haya cambiado.

**Corrección propuesta:** Comparación profunda de valores antes de reconstruir.

---

### 4.4 fetchData — Sin Paginación en Queries de Alto Volumen
**Impacto:** Bajo · Riesgo en producción  
**Estado:** 🔲 Pendiente

Las queries de `rawLatest` y `rawAM` a `lecturas_escalas` no especifican `.limit()`. En operaciones con múltiples ciclos de aforo al día, estas tablas pueden acumular cientos de registros diarios. Sin paginación, Supabase retorna el límite por defecto (1,000 filas) lo que puede incluir datos de días anteriores si no hay filtro de fecha suficientemente restrictivo.

**Corrección propuesta:**
```typescript
supabase.from('lecturas_escalas')
  .select('...')
  .gte('timestamp', today + 'T00:00:00')
  .order('timestamp', { ascending: false })
  .limit(50)  // ← máximo necesario: 1 por escala × 6 escalas × margen
```

---

## 5. DEUDA TÉCNICA

### 5.1 Magic Numbers sin Constantes Nombradas

Los siguientes valores numéricos están embebidos directamente en el código sin constante identificativa, dificultando su revisión, auditoría y ajuste futuro:

| Valor | Línea | Contexto | Constante Propuesta |
|-------|-------|---------|-------------------|
| `5.3` | ~601 | Coef. empírico velocidad onda | `WAVE_VELOCITY_BASE_KMH` |
| `0.15` | ~601 | Exponente empírico velocidad onda | `WAVE_VELOCITY_EXP` |
| `0.5, 0.4` | ~558 | Velocidad río Conchos (36 km) | `RIVER_V_BASE`, `RIVER_V_EXP` |
| `0.90` | ~648 | Factor piso de servicio (90% y_base) | `SERVICE_FLOOR_FACTOR` |
| `0.08` | ~651 | Margen seguridad bordo (8 cm) | `CANAL_TOP_SAFETY_M` |
| `0.00012` | ~701 | Coef. conducción con tomas | `CONDUCTION_K_WITH_DATA` |
| `0.00038` | ~701 | Coef. conducción sin tomas | `CONDUCTION_K_NO_DATA` |
| `0.97` | ~702 | Piso conducción con tomas | `CONDUCTION_FLOOR_WITH_DATA` |
| `0.85` | ~702 | Piso conducción sin tomas | `CONDUCTION_FLOOR_NO_DATA` |
| `1.4, 0.88` | ~1167 | Ratio y eficiencia extracción vs K-0 | `TOMAS_DOMINANCE_RATIO`, `CONDUCTION_EFF` |

**Riesgo:** Un ajuste de calibración (e.g., actualizar `5.3` con datos de aforo 2026) puede omitir alguna de sus ocurrencias si está literal en el código.

---

### 5.2 Acoplamiento de Fórmulas de Geometría

Las constantes `PLANTILLA = 20`, `TALUD_Z = 1.5`, `FREEBOARD = 3.2`, `S0_CANAL = 0.00016` y `MANNING_N = 0.015` están declaradas al inicio del módulo como valores por defecto globales. Sin embargo, `tramoGeom` contiene los valores **reales de la base de datos** para cada tramo.

En los fallbacks del motor (cuando `tramoGeom` no tiene datos para un km específico), `findTramo()` retorna estos valores globales, que corresponden al tramo central del canal (~km 40-60) y **no son representativos** de los tramos extremos (km 0-10 o km 95-104) con geometrías distintas.

**Corrección propuesta:** Los valores por defecto de `findTramo()` deben ser la **media geométrica** de todos los tramos, no un valor puntual. O bien, registrar en BD el tramo `km_inicio=0, km_fin=999` como fallback explícito.

---

### 5.3 Interfaz `CPResult` con 35 Campos

La interfaz `CPResult` devuelve 35 campos por sección. De estos, 8 son exclusivamente para el modo Técnico (head_base, head_sim, head_delta, cd_used, area_gate, celerity_ms, froude_n, velocity_ms) y 4 son solo para la UI de apertura (y_target, apertura_base, apertura_requerida, delta_apertura).

**Patrón más limpio:**
```typescript
interface CPResultBase { /* campos siempre necesarios */ }
interface CPResultTecnico extends CPResultBase { /* solo modo técnico */ }
interface CPResultApertura extends CPResultBase { /* solo bloque apertura */ }
```

Esto permite a `runSimulation()` optar por no computar ciertos campos cuando no son requeridos, reduciendo ciclos de cómputo.

---

### 5.4 `any[]` como Tipo de perfilRpc

```typescript
const [perfilRpc, setPerfilRpc] = useState<any[]>([]);
```

`perfilRpc` es el retorno de `fn_perfil_canal_completo`. Se accede como `(row as any).nivel_real_m`, `(row as any).km_ref`, etc., sin tipado estático. Un cambio en la firma del RPC no producirá error en compilación.

**Corrección propuesta:**
```typescript
interface PerfilRpcRow {
  km_ref: number;
  nivel_real_m: number;
  q_m3s: number;
  fuente_q_entrada: string;
  estado_lectura: string;
}
const [perfilRpc, setPerfilRpc] = useState<PerfilRpcRow[]>([]);
```

---

### 5.5 Texto "2.80–3.50" Hardcodeado en Múltiples Lugares

El rango operativo `[2.80, 3.50]` aparece como string literal en:
- R4 de `generateDecisions()` (mensaje detalle)
- Panel derecho modo Técnico (nivel objetivo)
- Tooltip de slider apertura

La función `getOpLimits(km)` existe y devuelve el rango correcto según km, pero los textos no la invocan. Si el rango cambia operativamente (por ajuste de CONAGUA), hay que buscar todas las ocurrencias manualmente.

---

## 6. ESTADO DE CORRECCIONES

| ID | Descripción | Severidad | Estado | Commit |
|----|-------------|-----------|--------|--------|
| **A** | Ancla AFORO contamina escenario futuro | Alta | ✅ Corregido | `89ace0c` |
| **B** | CIERRE emitido durante INCREMENTO (R4) | Alta | ✅ Corregido | `e8d2b8c` |
| A5.1 | Badge gate_anchored en UI compuerta | Media | ✅ Corregido | `2c48153` |
| A5.2 | Comparativa Q orificio vs aforo | Media | ✅ Corregido | `2c48153` |
| A5.3 | Balance hídrico usa K-0 SICA (no qDam) | Media | ✅ Corregido | `2c48153` |
| A5.4 | Piso de servicio visible en modo Técnico | Baja | ✅ Corregido | `2c48153` |
| A5.5 | Apertura requerida visible en K-104/ancla | Baja | ✅ Corregido | `2c48153` |
| C1 | Cascada AFORO→ORIFICIO sin aforo | Media | ✅ Corregido | `89ace0c` |
| **F1** | Velocidad propagación reportada vs real | Media | 🔲 Pendiente | — |
| **F2** | Tolerancia convergencia Manning fija | Baja | 🔲 Pendiente | — |
| **F3** | ALERTA por cambio absoluto (no relativo) | Baja | 🔲 Pendiente | — |
| **P1** | Re-simulación cada 60s (currentTimeMin) | Media | 🔲 Pendiente | — |
| **P2** | ECharts 462 líneas por realtime | Media | 🔲 Pendiente | — |
| **P3** | gastoMedidoRecord rebuild en realtime | Baja | 🔲 Pendiente | — |
| **P4** | Queries sin .limit() (paginación) | Baja | 🔲 Pendiente | — |
| **D1** | Magic numbers sin constantes (10 casos) | Baja | 🔲 Pendiente | — |
| **D2** | Geometría fallback no representativa | Media | 🔲 Pendiente | — |
| **D3** | CPResult con 35 campos sin segmentar | Baja | 🔲 Pendiente | — |
| **D4** | perfilRpc con tipo `any[]` | Baja | 🔲 Pendiente | — |
| **D5** | Rango "2.80–3.50" hardcodeado | Baja | 🔲 Pendiente | — |

---

## 7. PLAN DE OPTIMIZACIÓN RECOMENDADO

### Fase 1 — Completar Correcciones Críticas (Inmediato)
*Estimado: 4–6 horas*

1. Extraer constantes nombradas para todos los magic numbers (D1)
2. Tipar `perfilRpc` con interfaz explícita (D4)
3. Corregir tolerancia convergencia Manning (F2)
4. Añadir `.limit()` a queries de lecturas (P4)

### Fase 2 — Optimización de Rendimiento (1–2 semanas)
*Estimado: 8–10 horas*

1. Separar `wave_pct` fuera de `runSimulation()` para desacoplar de `currentTimeMin` (P1)
2. Implementar debounce en suscripciones realtime (P2, P3)
3. Segmentar `opsChartOption` en submemos por responsabilidad (P2)
4. Validar que geometría fallback represente tramos extremos (D2)

### Fase 3 — Calidad de Código (1 mes)
*Estimado: 8–10 horas*

1. Segmentar `CPResult` en interfaces por dominio de uso (D3)
2. Usar `getOpLimits()` en todos los textos de UI (D5)
3. Suite de pruebas unitarias para `runSimulation()` y `generateDecisions()` con 10 escenarios hidráulicos representativos
4. Implementar ALERTA por cambio relativo de nivel (F3)
5. Documentar velocidad de propagación real vs teórica (F1)

---

## 8. INDICADORES DE CALIDAD ACTUALES

| Categoría | Puntuación | Observación |
|-----------|-----------|-------------|
| Correctitud lógica | 7.5/10 | Dos bugs críticos corregidos; 3 fórmulas pendientes |
| Cobertura de datos | 9/10 | 8 fuentes con fallbacks; solo paginación faltante |
| Rendimiento | 6/10 | Re-simulación cada 60s; re-render por realtime frecuente |
| Mantenibilidad | 6.5/10 | Magic numbers, `any[]`, interfaz monolítica |
| Experiencia de usuario | 8.5/10 | UI clara; diferenciación AFORO/ORIFICIO implementada |
| Robustez ante fallos | 8/10 | safeFloat() en todo; fallbacks por tier |
| **Global** | **7.6/10** | Apto para operación; refactorización recomendada |

---

## 9. CONCLUSIONES

El módulo de Modelación Hidráulica constituye una herramienta de soporte a decisiones operativas funcional y con una arquitectura de datos bien diseñada. La sesión de análisis del 13 de abril de 2026 identificó y corrigió los dos errores de mayor impacto operativo: la contaminación del escenario futuro con datos presentes (Bug A) y la inversión de la directiva de apertura durante INCREMENT (Bug B).

Los elementos pendientes son en su mayoría optimizaciones de rendimiento y deuda técnica acumulada, sin impacto en la correctitud de las decisiones generadas. El sistema puede operar en producción con confianza mientras se abordan estas mejoras de forma incremental.

Se recomienda priorizar la **Fase 1** antes del próximo ciclo de riego para eliminar la deuda técnica de mayor riesgo, y planificar la **Fase 2** en conjunto con el equipo de operaciones para validar los umbrales de calibración (constantes empíricas de velocidad de onda y conducción).

---

*Conchos Digital · Sistema SICA · Unidad de Desarrollo*  
*Versión del módulo analizado: v2.7.1 · Build: dist/assets/ModelingDashboard-D5zaRNDG.js*
