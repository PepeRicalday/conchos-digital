# Informe de Coherencia Hidráulica — Sección K-104
## Modelación Hidráulica · SICA 005 · Conchos Digital v2.7.0

**Fecha de análisis:** 13 de abril de 2026
**Sección analizada:** K-104 Final Canal
**Datos de referencia:** Imagen capturada con Q_presa = 28.00 m³/s, SICA K-0 = 22.9 m³/s

---

## 1. Datos Observados

| Variable | Valor mostrado | Fuente |
|----------|---------------|--------|
| Q COMPUERTA K-0 | 22.9 m³/s | SICA Capture (campo) |
| Q Presa simulado | 28.00 m³/s | Deslizador / movimientos_presas |
| Apertura radial | 0.45 m | SICA Capture |
| Piezas radiales | 4 pzas | DB escalas |
| Ancho de puertas | 3.5 m/pza | DB escalas |
| Área de paso (Av) | 6.3 m² | Calculado: 4 × 3.5 × 0.45 |
| Gasto en sección | 11.30 m³/s | Simulación (anclada a SICA) |
| % Bordo libre | 63.2 % | Simulación |
| Tirante simulado | ≈ 2.40 m | Inferido: 63.2% × 3.80m |
| Agua llega en | 13h 26min | Motor de onda |
| Variación de escala | Baja 5 cm | Δy simulado |
| Estado | ESTABLE | Simulación |
| Entrada (Presa) | 28.00 m³/s | Balance — qDam |
| Llegada a sección | 11.30 m³/s | Balance — q_sim K104 |
| Pérdida en tramo | −16.70 m³/s | 28.00 − 11.30 |
| Eficiencia hasta K104 | 40.3 % | 11.30 / 28.00 × 100 |
| Geometría del tramo | b=7.7m · z=1.75 · H≈3.8m | perfil_hidraulico_canal |

---

## 2. Análisis de Coherencia por Variable

### 2.1 INCOHERENCIA CRÍTICA — Balance hídrico usa base incorrecta

**Problema:** El campo "Entrada (Presa)" en el balance muestra **28.00 m³/s** (gasto del deslizador de presa), pero el agua que **realmente entra al canal** en K-0 es **22.9 m³/s** medida por SICA Capture. El balance mezcla dos puntos de referencia distintos:

```
Presa Boquilla  →  36 km río  →  K-0+000  →  104 km canal  →  K-104
   28.00 m³/s      (-5.10)       22.90 m³/s     (-11.60)       11.30 m³/s
```

La "Pérdida en tramo" de −16.70 m³/s **incluye pérdidas del río** (−5.10 m³/s, tránsito Boquilla→K0) que son externas al canal e inevitables. Esto genera una eficiencia artificialmente baja.

| Cálculo | Valor | Representación |
|---------|-------|----------------|
| Eficiencia mostrada (Presa → K104) | **40.3%** | Incorrecta como eficiencia del canal |
| Eficiencia real canal (K0 → K104) | **49.3%** | 11.30 / 22.9 × 100 |
| Pérdida solo en río (Presa → K0) | **−5.10 m³/s (−18.2%)** | Normal en 36 km |
| Pérdida solo en canal (K0 → K104) | **−11.60 m³/s (−50.7%)** | Incluye extracciones de tomas |

**Conclusión:** El balance debe usar K-0 como referencia de "Entrada al canal". Si existen tomas activas que extrajeron ~11.60 m³/s en los 104 km, la eficiencia neta de conducción es razonable, no alarmante.

**Severidad:** MEDIA — el número es matemáticamente correcto pero operativamente engañoso.

---

### 2.2 INCOHERENCIA GRAVE — Gasto de compuerta vs gasto mostrado

**Los cálculos de la compuerta no aparecen en pantalla.** Esto es lo que se puede verificar:

**Cálculo teórico de la compuerta (fórmula de orificio libre):**

```
Q_orificio = Cd × Av × √(2g × h)

Donde:
  Cd = 0.70  (coeficiente de descarga de diseño)
  Av = 6.3 m²  (área neta: 4 pzas × 3.5m × 0.45m)
  h  = y_sim ≈ 2.40m  (tirante simulado / carga hidráulica disponible)

Q_teórico = 0.70 × 6.3 × √(2 × 9.81 × 2.40)
           = 0.70 × 6.3 × √(47.09)
           = 0.70 × 6.3 × 6.863
           = 30.3 m³/s
```

**El sistema muestra 11.30 m³/s pero la compuerta debería descargar 30.3 m³/s con esa apertura y ese nivel.**

| Dato | Valor |
|------|-------|
| Q teórico por orificio (Cd=0.70, Av=6.3m², h=2.40m) | **30.3 m³/s** |
| Q mostrado en sección | **11.30 m³/s** |
| Brecha | **−19.0 m³/s (37.3% del teórico)** |

**Causa raíz — Mecanismo de anclaje (gate_anchored = true):**

El motor hidráulico detecta que `gasto_calculado_m3s` (medido por SICA Capture en K-104) = **11.30 m³/s**, valor menor al propagado por el motor de cascada. Activa entonces el mecanismo de anclaje:

```typescript
// En runSimulation() — ModelingDashboard.tsx línea ~664
if (q_gate_m3s !== null && q_gate_m3s < qCur) {
  qCur = Math.max(0.1, q_gate_m3s);  // ← fuerza qCur = 11.30
  gate_anchored = true;
}
```

La compuerta "limita la cascada": aunque el motor propagaría más gasto, el valor real medido de campo **reemplaza** el cálculo hidráulico. Este comportamiento es correcto operativamente (la medición de campo tiene prioridad), pero **la UI no indica que esto está ocurriendo**, dejando al operador sin entender por qué el flujo es tan bajo.

**La información faltante en pantalla es:**

| Dato faltante | Fuente en CPResult | Importancia |
|---------------|-------------------|-------------|
| Indicador gate_anchored | `r.gate_anchored` | ALTA — avisa que la cascada está limitada |
| Q orificio teórico | Calculado con Cd×Av×√(2g·h) | ALTA — detecta inconsistencia apertura/nivel/gasto |
| Carga hidráulica disponible (h_disp) | `r.y_sim` | ALTA — base del cálculo |
| Carga requerida para Q medido (h_req) | `r.head_sim` | MEDIA — diagnóstico |
| Apertura requerida para Q_sim | `r.apertura_requerida` | ALTA — acción operativa |
| Δ apertura (abrir/cerrar) | `r.delta_apertura` | ALTA — acción operativa |

---

### 2.3 INCOHERENCIA MEDIA — Tirante simulado vs tirante Manning

**El tirante mostrado (≈2.40m) no coincide con Manning al caudal simulado (11.30 m³/s):**

**Cálculo de tirante normal por Manning:**
```
Q = (1/n) × A × R^(2/3) × √S0
n=0.014, b=7.7m, z=1.75, S0=0.0001

Estimación iterativa para Q=11.30 m³/s:
  y_n ≈ 1.35–1.50 m
```

**Comparación:**

| Variable | Valor Manning | Valor Simulado | Diferencia |
|----------|--------------|----------------|------------|
| Tirante normal y_n (Q=11.30 m³/s) | ~1.47 m | **2.40 m** | +93 cm |
| % Bordo libre (y_n Manning) | 38.7% | **63.2%** | +24.5 pp |

**Causa raíz — Piso de servicio (service floor):**

El motor aplica un piso mínimo para proteger la continuidad de servicio a las tomas:

```typescript
const y_floor_service = y_base * 0.90;   // ≤ 10% de caída del nivel actual
const y_floor = Math.max(yMinOp, y_floor_service);
const y_sim_final = Math.max(y_floor, Math.min(y_sim_mn2, Math.max(y_base, yMaxOp)));
```

Si el nivel actual real en K-104 es `y_base = 2.40m`:
- `y_floor = max(2.80, 2.40×0.90) = max(2.80, 2.16) = 2.80m`

Espera — con yMinOp = 2.80m (límite operativo para k<100), el piso debería ser 2.80m. Sin embargo el sistema muestra 2.40m, lo que indica que **K-104 está en la zona `km >= 100` con límites {yMin: 2.40, yMax: 2.55}**:

```typescript
if (km >= 100) return { yMin: 2.40, yMax: 2.55 };  // K-104 final canal
```

Entonces:
- `y_floor = max(2.40, 2.40×0.90) = max(2.40, 2.16) = 2.40m`
- `y_sim_final = max(0.1, min(y_sim_capped, max(y_base=2.40, yMaxOp=2.55)))`

El piso y_sim_final no puede bajar de 2.40m (el nivel base actual) aunque Manning diga 1.47m. **Esto es diseño intencional** (el sistema no permite que el modelo muestre caídas catastróficas que asusten al operador sin base real), pero debe documentarse claramente.

---

### 2.4 INCOHERENCIA LEVE — Tiempo de arribo (13h 26min)

**Verificación del tránsito:**

El motor usa velocidad de onda empírica calibrada: `v_onda = 5.3 × Q^0.15` [km/h]

Como Q decrece a lo largo del canal (de 28 a 11.30 m³/s), la velocidad disminuye:

| Tramo | Q approx | v_onda (km/h) | Tiempo aprox |
|-------|----------|---------------|-------------|
| K-0 → K-23 | 28.0 | 8.73 | 2h 38min |
| K-23 → K-34 | 25.0 | 8.51 | 1h 18min |
| K-34 → K-57 | 22.0 | 8.26 | 2h 47min |
| K-57 → K-80 | 17.0 | 7.90 | 2h 55min |
| K-80 → K-104 | 11.3 | 7.46 | 3h 14min |
| **TOTAL** | | | **≈ 12h 52min** |

El sistema muestra **13h 26min** — diferencia de ~34min. Esta variación es normal dado que el cálculo real acumula fracciones por tramo. **COHERENTE dentro de margen esperado (±5%).**

---

### 2.5 COHERENCIA VERIFICADA — Área de paso Av

```
Av declarado = 6.3 m²
Av calculado = 4 pzas × 3.5m × 0.45m = 6.30 m²  ✓ COHERENTE
```

---

## 3. Diagnóstico de Raíz — ¿Por qué no aparecen los cálculos de compuertas?

El problema tiene **tres componentes:**

### Componente A — gate_anchored oculta el cálculo hidráulico real

Cuando `gate_anchored = true`, el sistema usa 11.30 m³/s (SICA) en lugar de calcular por orificio. El panel de **"Apertura Radial"** solo muestra el valor del slider, no el cálculo de orificio que justifica si ese gasto es físicamente coherente con esa apertura y ese nivel.

### Componente B — Modo Operativo (simpleMode=true) oculta datos técnicos

El botón **"Operativo / Técnico"** en la barra de acciones controla qué datos se muestran. En modo Operativo (por defecto), los campos técnicos (`head_base`, `head_sim`, `head_delta`, `apertura_requerida`, `delta_apertura`) no se despliegan.

### Componente C — El balance usa qDam (presa) en lugar de q_K0 (entrada real al canal)

Las filas del balance:
```typescript
['Entrada (Presa)',  `${qDam.toFixed(2)} m³/s`]  // ← 28.00
['Llegada a sección', `${activeCPResult.q_sim}`]  // ← 11.30
['Pérdida en tramo',  `−${qDam - q_sim}`]         // ← −16.70
```

Deberían usar como referencia el Q medido en K-0 para que la "Pérdida en tramo" represente solo pérdidas **dentro del canal** (no del río).

---

## 4. Tabla Resumen de Coherencia

| # | Variable | Estado | Descripción |
|---|----------|--------|-------------|
| 1 | Av = 4×3.5×0.45 = 6.3 m² | ✅ COHERENTE | Cálculo de área correcto |
| 2 | Q_orificio teórico ≈ 30.3 m³/s vs 11.30 mostrado | ❌ INCOHERENTE | Gate anclada a SICA, sin indicador en UI |
| 3 | Eficiencia 40.3% usando Q_presa como base | ⚠ ENGAÑOSO | Debe usar Q_K0 como referencia de canal |
| 4 | Eficiencia canal real K0→K104 = 49.3% | ℹ INFORMACIÓN | No mostrada actualmente |
| 5 | Tirante sim 2.40m vs Manning 1.47m | ⚠ EXPLICABLE | Piso de servicio intencional — no documentado |
| 6 | % Bordo libre 63.2% coherente con tirante 2.40m | ✅ COHERENTE | 2.40/3.80 = 63.2% ✓ |
| 7 | Tiempo arribo 13h 26min | ✅ COHERENTE | Dentro de ±5% del cálculo manual |
| 8 | gate_anchored no visible en UI | ❌ FALTANTE | Operador no sabe que el gasto está limitado por SICA |
| 9 | head_sim, apertura_requerida no visibles | ❌ FALTANTE | Cálculos hidráulicos de compuerta ocultos |
| 10 | Q_K0 SICA (22.9) vs Q_presa sim (28.0) en balance | ⚠ MIXTO | River transit no se separa visualmente |

---

## 5. Acciones Correctivas Recomendadas

### A5.1 — Añadir indicador de gate_anchored en tarjeta de sección [PRIORIDAD ALTA]

En el bloque de "Apertura Radial", agregar una pastilla visual cuando `r.gate_anchored = true`:

```tsx
{activeCPResult.gate_anchored && (
  <div className="sim-anchored-badge">
    ⚠ ANCLADO A SICA — cascada limitada a {activeCPResult.q_gate_m3s?.toFixed(2)} m³/s
  </div>
)}
```

### A5.2 — Mostrar Q orificio teórico vs Q medido [PRIORIDAD ALTA]

En la sección de Apertura Radial, calcular y mostrar:

```tsx
// Q que la compuerta DEBERÍA descargar con la apertura y nivel actuales
const q_orificio_teorico = 0.70 * area_gate * Math.sqrt(2 * 9.81 * activeCPResult.y_sim);
```

Si `|q_orificio_teorico - q_gate_m3s| > 5 m³/s` → alerta de inconsistencia física.

### A5.3 — Corregir base del balance hídrico [PRIORIDAD ALTA]

Cambiar "Entrada (Presa)" por "Entrada Canal K-0" usando el Q medido real de K-0:

```typescript
// En el render del balance
const qEntradaCanal = dataStatus.qRealK0 ?? qDam;  // Q real K-0 o presa como fallback
['Entrada Canal K-0', `${qEntradaCanal.toFixed(2)} m³/s`, '#38bdf8'],
['Llegada a K-104',   `${(activeCPResult.q_sim ?? 0).toFixed(2)} m³/s`, '#2dd4bf'],
['Extraído en canal', `−${(qEntradaCanal - (activeCPResult.q_sim ?? 0)).toFixed(2)} m³/s`, '#f59e0b'],
// Separar pérdida en río como línea independiente:
['Pérdida en río (36km)', `−${(qDam - qEntradaCanal).toFixed(2)} m³/s`, '#64748b'],
```

### A5.4 — Mostrar tirante Manning real vs tirante con piso [PRIORIDAD MEDIA]

En modo Técnico, agregar fila:

```
y_Manning puro:   1.47 m   (flujo uniforme Q=11.30 m³/s)
y_Simulado final: 2.40 m   (limitado por piso de servicio)
y_Piso activo:    2.40 m   (max(yMin=2.40, y_base×0.90=2.16))
```

Esto permite al operador distinguir entre el estado hidráulico teórico y el estado de servicio protegido.

### A5.5 — Mostrar apertura_requerida y delta_apertura siempre en K-104 [PRIORIDAD MEDIA]

Los campos `apertura_requerida` y `delta_apertura` en el CPResult existen pero solo aparecen en decisiones del motor cuando `|deltaQ| > 0.5 y |delta_apertura| > 0.05`. Para K-104 siempre se deben mostrar ya que es el punto de control final.

---

## 6. Conclusión Ejecutiva

El sistema muestra datos **matemáticamente consistentes entre sí**, pero presenta **tres fuentes de desorientación operativa:**

1. **El balance usa la presa como entrada** (28.00 m³/s) en lugar de K-0 (22.9 m³/s), inflando artificialmente la pérdida de −16.70 m³/s e indicando una eficiencia del 40.3% que en realidad es 49.3% canal-a-canal.

2. **La compuerta está anclada a la medición SICA** (11.30 m³/s) pero la UI no lo indica. La fórmula de orificio con Av=6.3m² y nivel=2.40m daría 30.3 m³/s — diferencia que podría señalar un error de calibración en el sensor de gasto de K-104 o puertas parcialmente abiertas no reportadas.

3. **Los parámetros técnicos de compuerta** (head_sim, apertura_requerida, delta_apertura) están calculados en el motor pero ocultos en modo Operativo. Deben ser accesibles al menos como tooltip o expandible sin cambiar al modo Técnico completo.

---

*Informe generado para SICA 005 — Análisis de coherencia hidráulica K-104*
*Conchos Digital v2.7.0 · 13 de abril de 2026*
