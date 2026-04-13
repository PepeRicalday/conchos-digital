# Informe: Motor de Decisión Emite CIERRE Durante INCREMENTO
**Fecha:** 2026-04-13  
**Componente:** `ModelingDashboard.tsx` — `runSimulation()` + `generateDecisions()`  
**Severidad:** Alta — directiva operativa invertida  
**Estado:** CORREGIDO (commit `feat/fix-ancla-aforo-y-r4-incremento`)

---

## 1. Descripción del Problema

Al simular un **INCREMENTO de gasto** (p. ej. de 28 m³/s a 30 m³/s en la presa), el Motor de Decisión (Fase 3) generaba recomendaciones de **CIERRE de compuertas radiales** en las secciones del canal. El comportamiento correcto es no emitir CIERRE durante un incremento, o emitir APERTURA si la compuerta es físicamente el cuello de botella.

El usuario identificó: *"es llegada de volumen, no al contrario"* — cuando más agua va a llegar, las compuertas deben facilitar el paso aguas abajo, no restringirlo.

---

## 2. Causa Raíz — Dos Bugs Independientes

### Bug A — Ancla AFORO en Escenario Futuro (`runSimulation`)

**Archivo:** líneas 683–690 (antes de la corrección)

```typescript
// ANTES — ancla siempre, sin distinguir estado base vs escenario futuro
let gate_anchored = false;
if (q_gate_m3s !== null && q_gate_m3s < qCur) {
  qCur = Math.max(0.1, q_gate_m3s);  // ← aplica aforo presente al Q proyectado
  gate_anchored = true;
}
```

**Mecanismo del fallo:**

| Paso | Valor | Comentario |
|------|-------|-----------|
| qDam (slider) | 30 m³/s | INCREMENT +2 sobre qBase=28 |
| qCur al llegar a K-0 | 30 m³/s | Valor correcto del escenario |
| gasto_calculado_m3s SICA K-0 | 8.29 m³/s | Medición *actual* (no futura) |
| Condición 8.29 < 30 | `true` | Ancla se activa |
| qCur post-ancla | **8.29 m³/s** | Q futuro reemplazado por Q presente |
| qCur enviado a K-23 | ~8.0 m³/s | Canal "viaja" con el Q presente, no con el proyectado |

**Consecuencia:** Todas las secciones aguas abajo recibían el caudal *actual* en lugar del caudal *simulado*. La simulación era funcionalmente idéntica al estado base, haciendo invisible el efecto del incremento.

**Nota adicional:** `y_sim` en cada sección seguía calculándose con qCur=30 (antes del anclaje), pero con Manning normal depth muy inferior a y_base (≈1.4 m vs 3.42 m por backwater) el **piso de servicio** (90% × y_base = 3.08 m) dominaba, haciendo que y_sim mostrara descenso incluso con incremento.

---

### Bug B — R4 Emite CIERRE por Inversión de Lógica (`generateDecisions`)

**Archivo:** líneas 428–438 (antes de la corrección)

```typescript
// ANTES — misma lógica para INCREMENT y DECREMENT
if (Math.abs(deltaQ) > 0.5 && Math.abs(aperDelta) > 0.05) {
  decisions.push({
    tipo: aperDelta > 0 ? 'APERTURA' : 'CIERRE',  // ← sin considerar dirección
    accion: `${aperDelta > 0 ? 'ABRIR' : 'CERRAR'} radiales`,
  });
}
```

**Por qué `aperDelta < 0` en un INCREMENT:**

La fórmula de apertura requerida es:
```
apertura_req = Q_sim / (Cd × n_pzas × ancho × √(2g × y_target))
```

Con los valores del Canal Conchos en K-0:
- Q_sim = 30 m³/s
- Cd = 0.70, n_pzas = 4, ancho = 12 m
- y_target = y_base = 3.42 m → √(2 × 9.81 × 3.42) = 8.19 m^0.5

```
apertura_req = 30 / (0.70 × 4 × 12 × 8.19) = 30 / 275.6 = 0.109 m
```

Apertura base (SICA): **1.11 m**  
→ `delta_apertura = 0.109 - 1.11 = −1.00 m` → **CIERRE**

**El error conceptual:** La fórmula calcula la apertura *mínima física* para pasar Q dado el nivel actual. Con backwater alto (y=3.42m), una pequeña apertura ya genera gran caudal por alta carga hidrostática. Pero esto **no significa que haya que cerrar** durante un incremento — la compuerta ya tiene capacidad más que suficiente (capacidad real: 0.70 × 4×12×1.11 × 8.19 = **305 m³/s**).

La confusión es entre:
- "Qué apertura necesito para pasar Q" (cálculo correcto de equilibrio)
- "Debo cerrar la compuerta porque está sobre-dimensionada" (inferencia incorrecta durante INCREMENT)

---

## 3. Diagnóstico Visual (Captura de Pantalla)

La captura muestra el simulador con qDam=32 m³/s en evento INCREMENTO:

| Sección | y_base (actual) | y_sim (simulado) | Dirección |
|---------|-----------------|-----------------|-----------|
| K-0+000 | 3.42 m | 3.08 m | ↓ DESCENSO |
| K-23    | 3.40 m | 3.06 m | ↓ DESCENSO |
| K-27    | 3.35 m | 3.02 m | ↓ DESCENSO |

El nivel simulado cae debido al piso de servicio (90% × y_base) combinado con Manning normal depth << y_base (backwater). Las decisiones del Motor mostraban CIERRE en múltiples secciones, status ALERTA generalizado.

**Panel derecho visible:**  
`⚓ AFORO SICA · 1.11 m · Q ancla: 8.29 m³/s`  
→ El ancla de aforo estaba limitando el Q simulado al valor presente (8.29) en lugar de dejar propagarse el valor proyectado (30+).

---

## 4. Corrección Implementada

### Fix 1 — Ancla AFORO desactivada en escenario futuro

```typescript
// runSimulation() — después de calcular gate_source:

// AFORO: medición del instante presente → NO válida para estado futuro.
// ORIFICIO: capacidad física de la compuerta → SÍ aplica al estado futuro.
const isDeltaSim = Math.abs(qDamInit - qBaseInit) > 0.5;
const anchorApplies = gate_source === 'ORIFICIO' || !isDeltaSim;

let gate_anchored = false;
if (anchorApplies && q_gate_m3s !== null && q_gate_m3s < qCur) {
  qCur = Math.max(0.1, q_gate_m3s);
  gate_anchored = true;
}
```

**Efecto:** En escenario de INCREMENT/DECREMENT (|ΔQ| > 0.5):
- AFORO SICA no ancla el Q simulado → qCur=30 se propaga correctamente a K-23, K-34...
- ORIFICIO sí ancla (límite físico de la compuerta — apertura fija no puede pasar más)
- Estado base (|ΔQ| ≤ 0.5): ambas anclas activas como antes

### Fix 2 — R4 diferenciado por dirección del cambio

```typescript
// generateDecisions() — R4 reescrito:

if (Math.abs(deltaQ) > 0.5) {
  const isIncrement = deltaQ > 0;

  if (isIncrement) {
    // INCREMENTO: verificar si la compuerta es el cuello de botella físico
    const qCapacidad = r.cd_used * r.area_gate * Math.sqrt(2 * G * r.y_sim);
    const cuelloBottella = qCapacidad < r.q_sim * 0.90;
    if (cuelloBottella) {
      decisions.push({ tipo: 'APERTURA', accion: 'ABRIR — cuello de botella' });
    }
    // Si capacidad suficiente: no emitir CIERRE. El volumen pasa solo.

  } else {
    // DECREMENTO/CORTE: lógica original (apertura_requerida vs apertura_base)
    if (Math.abs(aperDelta) > 0.05) {
      decisions.push({ tipo: aperDelta > 0 ? 'APERTURA' : 'CIERRE', ... });
    }
  }
}
```

**Cambio en comportamiento de salida:**

| Escenario | Antes | Después |
|-----------|-------|---------|
| INCREMENT, gate sobre-dimensionada | CIERRE ✗ | Sin acción (gate suficiente) ✓ |
| INCREMENT, gate cuello de botella | (nunca llegaba) | ABRIR ✓ |
| DECREMENT, gate sobre-dimensionada | CIERRE ✓ | CIERRE ✓ |
| DECREMENT, gate sub-dimensionada | ABRIR ✓ | ABRIR ✓ |

---

## 5. Contexto Hidráulico — Por qué y_sim Sigue Bajando con INCREMENT

Aún después de las correcciones, `y_sim` puede mostrar niveles inferiores a `y_base` durante un INCREMENT. Esto es esperado y correcto:

**Razón:** El canal opera en **curva M1 (remanso ascendente)** — los niveles actuales (3.42m) están significativamente por encima del tirante normal de Manning (≈1.4m para Q=28-30 m³/s con la geometría del Canal Conchos). Esta diferencia es sostenida por compuertas aguas abajo que generan contrapresión.

El **piso de servicio** (90% × y_base) impide que la simulación muestre caídas bruscas que asustarían al operador, pero el tirante final simulado (≈3.08m) no refleja el estado *nuevo de equilibrio* — refleja el límite operativo de cautela.

**Implicación para el operador:** La pantalla informará "el nivel no cambiará más del 10% de caída" para un INCREMENT — lo cual es conservador. El cambio real depende del tiempo de respuesta de las compuertas aguas abajo.

---

## 6. Criterios de Aceptación Post-Corrección

| Condición | Resultado esperado |
|-----------|-------------------|
| qDam > qBase (INCREMENT) | Motor NO emite CIERRE en ninguna sección |
| qDam > qBase, gate capacidad < Q_proyectado | Motor emite ABRIR |
| qDam < qBase (DECREMENT) | Motor puede emitir CIERRE (comportamiento conservado) |
| qDam ≈ qBase (|ΔQ| ≤ 0.5) | Comportamiento sin cambios (ancla AFORO activa) |
| CORTE (eventType=CORTE) | R8 emite CORTE TOTAL (sin cambios) |

---

## 7. Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `src/pages/ModelingDashboard.tsx` | 683–700 | Fix 1: `isDeltaSim` + `anchorApplies` |
| `src/pages/ModelingDashboard.tsx` | 428–470 | Fix 2: R4 bifurcado INCREMENT/DECREMENT |

---

*Generado automáticamente — Conchos Digital v2.7.1*
