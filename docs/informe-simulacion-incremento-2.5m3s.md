# Informe de Simulación — INCREMENTO +2.5 m³/s
**Escenario:** Q_base = 28.0 m³/s → Q_objetivo = 30.5 m³/s  
**Fecha de análisis:** 2026-04-14  
**Tipo de evento:** INCREMENTO (+8.9 %)  
**Motor:** `runSimulation()` + `generateDecisions()` — Conchos Digital v2.7.1  
**Régimen hidráulico:** M1 remanso ascendente en tramo K-0 a K-80

---

## 1. Parámetros de Propagación de Onda

### Modelo de velocidad de onda calibrado
```
v_onda [km/h] = 5.3 × Q^0.15
```
Con Q = 30.5 m³/s:
```
v_onda = 5.3 × 30.5^0.15 = 5.3 × 1.670 = 8.85 km/h
v_onda = 2.46 m/s  (≈ 147.5 m/min)
```

> **Nota:** El modelo empírico captura la atenuación real que producen las compuertas, cambios de sección y rugosidad del canal. El valor teórico cinemático (v + c ≈ 5-6 m/s) no aplica en un canal regulado con compuertas cada 10-20 km.

---

## 2. Tiempos de Tránsito por Sección — Frente de Onda

| Sección | km | Dist. tramo (km) | Tránsito tramo | Llegada acum. | Maniobra prep. (−30 min) |
|---------|-----|-----------------|---------------|---------------|--------------------------|
| **K-0+000** Presa | 0 | — | — | **ORIGEN** | ORIGEN |
| **K-23** Derivadora | 23 | 23 | 2 h 36 min | **+2 h 36 min** | **+2 h 06 min** |
| **K-34** Compuerta | 34 | 11 | 1 h 15 min | **+3 h 51 min** | **+3 h 21 min** |
| **K-57** Sección S3 | 57 | 23 | 2 h 36 min | **+6 h 26 min** | **+5 h 56 min** |
| **K-80** Sección S4 | 80 | 23 | 2 h 36 min | **+9 h 02 min** | **+8 h 32 min** |
| **K-104** Final Canal | 104 | 24 | 2 h 43 min | **+11 h 45 min** | **+11 h 15 min** |

**Hora de maniobra prep.** = llegada acumulada − 30 min de margen de anticipación.  
El operador debe estar posicionado en cada sección a la hora de preparación.

---

## 3. Análisis de Compuertas — Movimientos Requeridos

### Metodología de evaluación (Motor R4 INCREMENTO)

El Motor de Decisión evalúa dos señales en orden de prioridad:

1. **Señal 1 — Ancla ORIFICIO:** Si la compuerta tiene apertura conocida y su capacidad física (Cd · A · √(2g·y_base)) es menor que Q_proyectado → ABRIR.
2. **Señal 2 — Capacidad teórica:** Q_cap < Q_sim × 0.90 → ABRIR (cuello de botella).
3. **Sin cuello de botella:** El volumen incremental pasa sin restricción → SIN ACCIÓN. **Jamás se emite CERRAR durante INCREMENT.**

### Tabla de análisis por sección

Las columnas usan el régimen M1 actual (niveles reales medidos por SICA):

| Sección | Pzas×Ancho | Cd | y_base (m) | Apertura actual (m) | Q_cap a y_base (m³/s) | Q_sim (m³/s) | Q_cap / Q_sim | DECISIÓN |
|---------|-----------|-----|-----------|---------------------|----------------------|-------------|--------------|---------|
| K-0+000 | 4 × 12 m | 0.70 | 3.42 | 1.11 (SICA) | **305.6** | 30.5 | **1002 %** | ✅ SIN ACCIÓN |
| K-23 | 3 × 10 m | 0.70 | ~3.40 | ~0.163 | ~28.0 | 30.4 | **92 %** | ⚠ Limítrofe |
| K-34 | 3 × 10 m | 0.70 | ~3.35 | ~0.164 | ~27.9 | 30.3 | **92 %** | ⚠ Limítrofe |
| K-57 | 2 × 8 m | 0.70 | ~3.20 | ~0.316 | ~28.1 | 30.2 | **93 %** | ✅ SIN ACCIÓN |
| K-80 | 2 × 8 m | 0.70 | ~3.15 | ~0.318 | ~28.0 | 30.1 | **93 %** | ✅ SIN ACCIÓN |
| K-104 | 1 × 6 m | 0.70 | ~2.50 | ~0.952 | ~28.0 | 28.5 | **98 %** | ✅ SIN ACCIÓN |

> **Umbral de cuello de botella:** Q_cap < Q_sim × 90%. Ninguna sección supera el umbral.

---

### Detalle por sección

#### K-0+000 — Inicio Canal (4 compuertas radiales × 12 m)
```
Apertura SICA:        1.11 m/compuerta
Q aforo SICA:         22.95 m³/s  (medición directa con régimen submerso M1, ΔH≈2 cm)
Q_cap libre (y=3.42m): 305.6 m³/s  (capacidad teórica en descarga libre)
```
- **El AFORO SICA (22.95 m³/s) no limita el escenario futuro** — el ancla AFORO se desactiva en escenario de delta (isDeltaSim=true).
- La compuerta opera en condición submersa (contrapresión aguas abajo). Su capacidad real de tránsito es mucho mayor a 30.5 m³/s.
- **MOVIMIENTO: NINGUNO.**

---

#### K-23 — Derivadora (3 compuertas × 10 m) — ⚠ MONITOREAR
```
Apertura estimada:   ~0.16 m/pieza  (para pasar 28 m³/s en M1 con y=3.40m)
Q_cap:               ~28.0 m³/s     (Cd × 3 × 10 × 0.163 × √(2×9.81×3.40))
Q_sim proyectado:    ~30.4 m³/s
Q_cap / Q_sim:       92 %           (umbral cuello botella: < 90%)
Apertura requerida:  ~0.177 m       (+0.014 m ≈ 1.4 cm respecto a apertura actual)
```
- Apenas por encima del umbral del 90% → Motor NO emite ABRIR.
- **En práctica:** Si la apertura real medida por SICA es ≤ 0.153 m, el motor emitiría **ABRIR**.
- **Recomendación operativa:** Verificar apertura real en SICA. Si Q_SICA K-23 < 27 m³/s con el incremento activo, abrir ~0.02 m adicionales.
- **MOVIMIENTO: CONDICIONAL — verificar con SICA en campo.**

---

#### K-34 — Compuerta (3 compuertas × 10 m)
```
Apertura estimada:   ~0.164 m/pieza
Q_cap:               ~27.9 m³/s
Q_sim proyectado:    ~30.3 m³/s
Q_cap / Q_sim:       92 %
Δapertura requerida: +0.014 m ≈ 1.4 cm
```
- Misma situación que K-23. Dentro del margen operativo.
- **MOVIMIENTO: SIN ACCIÓN** (revisar con SICA si llega ola sin pasar).

---

#### K-57 — Sección S3 (2 compuertas × 8 m)
```
Apertura estimada:   ~0.316 m/pieza
Q_cap:               ~28.1 m³/s
Q_sim proyectado:    ~30.2 m³/s
Δapertura requerida: +0.025 m ≈ 2.5 cm
```
- **MOVIMIENTO: NINGUNO.** Capacidad dentro del umbral de seguridad operativa.

---

#### K-80 — Sección S4 (2 compuertas × 8 m)
```
Apertura estimada:   ~0.318 m/pieza
Q_cap:               ~28.0 m³/s
Q_sim proyectado:    ~30.1 m³/s
Δapertura requerida: +0.024 m ≈ 2.4 cm
```
- **MOVIMIENTO: NINGUNO.**

---

#### K-104 — Final Canal (1 compuerta × 6 m)
```
Apertura estimada:   ~0.952 m       (1 sola pieza para pasar ~26 m³/s)
Q_cap:               ~28.0 m³/s     (Cd × 6 × 0.952 × √(2×9.81×2.50))
Q_sim proyectado:    ~28.5 m³/s     (después de pérdidas de conducción y tomas)
Q_cap / Q_sim:       98 %
Apertura requerida:  ~0.970 m       (+0.018 m ≈ 1.8 cm)
Rango operativo:     [2.40 m, 2.55 m] — nivel actual ~2.50 m ✓
```
- Aunque es el punto más crítico (1 sola compuerta, sección menor, carga menor), el delta requerido es mínimo.
- **MOVIMIENTO: SIN ACCIÓN** — delta < umbral 0.05 m. Monitorear nivel aguas abajo.

---

## 4. Gasto Esperado en K-104

### Balance de conducción

El motor aplica pérdidas por conducción tramo a tramo:

| Tramo | Dist. (km) | Factor conducción | Q entrada | Q tomas | Q salida |
|-------|-----------|-------------------|-----------|---------|---------|
| K-0 → K-23 | 23 | 0.9972 | 30.50 m³/s | ~0.3 m³/s | ~30.11 m³/s |
| K-23 → K-34 | 11 | 0.9987 | 30.11 m³/s | ~0.2 m³/s | ~29.87 m³/s |
| K-34 → K-57 | 23 | 0.9972 | 29.87 m³/s | ~0.4 m³/s | ~29.43 m³/s |
| K-57 → K-80 | 23 | 0.9972 | 29.43 m³/s | ~0.3 m³/s | ~29.09 m³/s |
| K-80 → K-104 | 24 | 0.9971 | 29.09 m³/s | ~0.3 m³/s | **~28.71 m³/s** |

> **Nota:** Los factores de conducción usan el fallback calibrado (0.00012/km con datos de tomas activos). Si `fn_balance_hidrico_tramos` provee datos de fugas reales, los factores pueden variar. Los caudales de tomas son estimados — se requieren reportes_diarios del día para precisión.

### Rango estimado Q en K-104

| Condición | Q esperado K-104 |
|-----------|-----------------|
| Sin tomas activas | ~30.1 m³/s |
| Tomas típicas (~1.5 m³/s total) | **~28.6 m³/s** |
| Tomas máximas (~3.0 m³/s total) | ~27.1 m³/s |

**Estimación central: 28.5 ± 1.0 m³/s llegarán a K-104 aproximadamente 11 horas 45 minutos después del movimiento de presa.**

---

## 5. Resumen Ejecutivo Operativo

### Movimientos de compuerta requeridos

| Sección | Acción | Tiempo de maniobra | Prioridad |
|---------|--------|-------------------|-----------|
| K-0+000 | **SIN MOVIMIENTO** | — | — |
| K-23 | **VERIFICAR SICA** (posible +0.02m si Q < 27 m³/s) | +2 h 06 min | ⚠ MONITOREO |
| K-34 | **SIN MOVIMIENTO** | — | — |
| K-57 | **SIN MOVIMIENTO** | — | — |
| K-80 | **SIN MOVIMIENTO** | — | — |
| K-104 | **SIN MOVIMIENTO** (verificar nivel final) | +11 h 15 min | ⚠ MONITOREO |

### Protocolo de monitoreo recomendado

```
T+0h00min  → Ejecutar incremento en presa: 28.0 → 30.5 m³/s
T+2h06min  → Operador posicionado en K-23. Verificar SICA.
T+2h36min  → Frente de onda llega K-23. Observar nivel y gasto en SICA.
T+3h21min  → Operador posicionado en K-34.
T+3h51min  → Frente de onda llega K-34.
T+5h56min  → Operador listo en K-57.
T+6h26min  → Frente de onda llega K-57.
T+8h32min  → Operador listo en K-80.
T+9h02min  → Frente de onda llega K-80.
T+11h15min → Verificar K-104 — nivel en rango [2.40, 2.55 m].
T+11h45min → Frente de onda llega K-104. Confirmar Q recibido.
```

---

## 6. Notas Técnicas y Limitaciones

### Por qué NO se requieren movimientos de compuerta en INCREMENTO

El canal opera en **régimen M1 (remanso ascendente)** con tirantes de 3.1–3.4 m, muy superiores al tirante normal de Manning (~1.4 m para Q=28-30 m³/s con la geometría del Canal Conchos). En régimen M1:

- La carga hidráulica sobre cada compuerta es de 3.1–3.4 m.
- La capacidad de descarga por orificio es **proporcional a √(2g·y)** = 7.9–8.2 m^0.5.
- Incluso con aperturas pequeñas (0.16–0.95 m), la capacidad supera ampliamente el incremento de 2.5 m³/s.

**Un incremento del 8.9% (2.5 m³/s sobre 28 m³/s) se propaga libremente sin restricción física** en las secciones actuales del canal.

### Sección de sifón K-68+720

La zona entre K-68.72 y K-70.84 corresponde a una **estructura especial (sifón)**. El motor no tiene lógica diferenciada para esta zona. Vigilar que el tirante aguas arriba del sifón no suba por encima del diseño durante el incremento.

### Cómputo de tomas

Los factores de conducción y las extracciones por tomas dependen de `reportes_diarios`. Si no hay reportes del día activos, el simulador puede sobreestimar Q en secciones aguas abajo (R11: "tomas sin reporte"). Confirmar datos de tomas antes de ejecutar el incremento.

### Apertura actual K-23 y K-34 — verificar en SICA

Las aperturas de K-23 y K-34 estimadas (~0.163 m/pieza) se calcularon inversamente a partir de Q=28 m³/s. Si la apertura real medida es inferior a ~0.150 m, el motor emitiría **ABRIR** en esas secciones. Confirmar con SICA antes de iniciar el incremento.

---

## 7. Resumen de Hallazgos

| Parámetro | Valor |
|-----------|-------|
| Q base | 28.0 m³/s |
| Q objetivo | 30.5 m³/s |
| Incremento | +2.5 m³/s (+8.9 %) |
| Velocidad onda | 8.85 km/h (Q=30.5) |
| Tiempo K-0 → K-23 | **2 h 36 min** |
| Tiempo K-0 → K-104 | **11 h 45 min** |
| Compuertas que requieren ABRIR | **0** (ninguna — capacidad suficiente) |
| Compuertas a VERIFICAR | K-23 (limítrofe 92 % capacidad) |
| Q estimado llegada K-104 | **28.5 ± 1.0 m³/s** |
| Nivel K-104 esperado | ~2.50 m (dentro rango [2.40–2.55 m]) |

**Veredicto hidráulico:** El Canal Conchos puede absorber un incremento de +2.5 m³/s sin movimiento de compuertas. La ola llega a K-104 en ~11 h 45 min con ~28.5 m³/s de gasto efectivo. La acción operativa se limita a monitoreo de onda, verificación de K-23 con SICA y confirmación de nivel en K-104 al arribo.

---

*Generado — Conchos Digital v2.7.1 · Simulación hidráulica 2026-04-14*
