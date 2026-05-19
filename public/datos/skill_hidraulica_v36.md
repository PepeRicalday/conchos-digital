# SKILL HIDRÁULICA — Canal Principal Conchos (DR-005 Delicias)
## Modelo Paralelo para Modelación de Eventos — v3.6f
**Generado:** 2026-05-15 08:30 UTC | **Calibración K-0:** 18/05/2026 | **Sistema:** SICA v2.6.2

---

## IDENTIDAD DEL SISTEMA

| Parámetro | Valor |
|---|---|
| Sistema | Canal Principal Conchos |
| Jurisdicción | Distrito de Riego 005 Delicias, Chihuahua, MX |
| Longitud total | 104 km (K-0+000 → K-104) |
| Capacidad diseño K-0 | 32.5 m³/s |
| Sección típica | Trapezoidal, revestida concreto |
| Rugosidad Manning n | 0.015 |
| Fuente aguas | Presa Boquilla → Bocatoma K-0+000 |
| Destino | Red secundaria DR-005, 4 zonas de riego |
| Puntos de control | 14 escalas limnimétricas con SICA |

---

## MÓDULO 1: FÓRMULAS DE GASTO

### 1.1 Compuertas Radiales (uso principal)
Cada compuerta i de un checkpoint tiene apertura `ap_i` (m).

**Régimen orificio** (compuerta parcialmente abierta: ap_i < H_arriba):
```
Q_i = Cd × (ancho × ap_i) × √(2g × Δh_efec) × M1
```

**Régimen vertedor libre** (compuerta alzada sobre nivel: ap_i ≥ H_arriba):
```
Q_i = Cv × ancho × Δh_efec^1.5 × M1
```

**Carga efectiva (Opción A — remanso extremo):**
```
Δh_efec = max(H_arriba - H_abajo, 0)
Si Δh_efec < MIN_H  →  Δh_efec = H_arriba   (presión absoluta aguas abajo ≥ aguas arriba)
```

**Gasto total del checkpoint:**
```
Q_total = Σ Q_i   para i = 1..pzas_radiales
```

### 1.2 Garganta Larga / Vertedor sin Radiales
Aplica cuando pzas_radiales = 0 y ancho > 0:
```
Q = Cd_gl × H_arriba ^ n_gl
```

### 1.3 Escala de Referencia Pura
Aplica cuando pzas_radiales = 0 y ancho = 0 (K-64, K-94+200):
```
Q = 0   (solo mide nivel para referencia hidráulica)
```

### 1.4 Constantes Hidráulicas

| Constante | Valor | Descripción |
|---|---|---|
| Cd | 0.62 | Coef. descarga orificio rectangular |
| Cv | 1.84 | Coef. vertedor libre (Rehbock/Bazin) |
| g | 9.81 m/s² | Gravedad |
| Cd_gl | 1.84 | Coef. garganta larga |
| n_gl | 1.52 | Exponente garganta larga |
| MIN_H | 0.01 m | Diferencial mínimo para flujo |
| n_Manning | 0.015 | Rugosidad canal revestido concreto |

---

## MÓDULO 2: FACTORES DE CORRECCIÓN M1

**Metodología:** M1_nuevo = M1_anterior × (Q_esperado_balance / Q_fórmula_anterior)

**Calibración 05/05/2026 (v3.6e):**
- Ancla entrada: 1er aforo K+1000 = 26.488 m³/s (27/04) → M1_K0 = 0.8923 (v3.6b)
- Ancla entrada: 2do aforo K+1000 = 29.497 m³/s (04/05) → M1_K0 = **0.9099** (+2%, ajuste moderado)
- Ancla salida: K-104 = 0.7714 (sin cambio)
- λ pérdidas lineales: **0.00000 m³/s·km⁻¹** (calculada en tiempo real: Q0−Q104−Q_zonas / 104 km)
- Eficiencia global: **0.0%**
- Aforo K+72008 valida K-68: diferencia 1.5% ✓

**Recalibración K-0+000 — 18/05/2026 (v3.6f):**
- Aforo molinete K 1+000: Q = **27.825 m³/s** · Hora ini 09:30h · Ing. S.E. Ogaz Navarrete
- Lectura SICA 06:00h: H▲=3.140m H▼=2.400m ΔH=0.740m · Σapert=6.41m (5/12 compuertas)
- Q_base (Cd=0.62, M1=1): 23.472 m³/s
- M1 anterior (gastos_actuales 14/05): 1.2547 → sobreestimación +5.5%
- M1 calibrado 18/05: **1.1855** (−5.5% vs 1.2547)
- Rango con tomas K0→K1 (+0.3 m³/s): 1.1855 – 1.1982
- Historial ancla K-0: 27/04=0.8923 · 04/05=0.9099 · 14/05=1.2547 · **18/05=1.1855**
- ⚠ Salto 04/05→14/05 (+38%) pendiente de verificación (posible error en gastos_actuales.mjs)

**Tránsito (v3.6e — 06/05/2026):**
- q_seg K-94+057→K-104: **14→12 m³/s** (fuente: analisis_transito_v2.mjs — q_obs=11.66±2.58 m³/s, n=71 lecturas históricas)
- T_K104 ajustado: 883 min (anterior 880 min, +3 min en último tramo — sin impacto operativo)
- T_K23 = 186 min, T_K104 = 883 min validados contra anclas históricas (errores <7%)

| Punto | KM | M1 v3.6f | M1 v3.6e | Nota |
|---|---|---|---|---|
| K-0+000 | 0 | **1.1855** | 0.9099 | Aforo molinete K1+000=27.825m³/s 18/05/2026 (−5.5% vs 1.2547 de 14/05) |
| K-23 | 23 | **1.9031** | 1.9031 | Sin cambio |
| K-29 | 29 | **1.2379** | 1.2379 | Sin cambio |
| K-34 | 34 | **1.5199** | 1.5199 | Sin cambio |
| K-44 | 44 | **1.0119** | 1.0119 | Sin cambio |
| K-54 | 54 | **1.0066** | 1.0066 | Sin cambio |
| K-62 | 62 | **1.0537** | 1.0537 | Sin cambio |
| K-64 | 64 | 1.3305 | 1.3305 | Escala referencia (Q=0) |
| K-68 | 68 | **1.0398** | 1.0398 | Sin cambio; val. aforo K+72 (Δ=1.5%) |
| K-79+025 | 79.025 | **1.5824** | 1.5824 | Sin cambio |
| K-87+549 | 87.549 | **1.2089** | 1.2089 | Sin cambio |
| K-94+057 | 94.057 | **1.1612** | 1.1612 | Sin cambio |
| K-94+200 | 94.200 | 1.2851 | 1.2851 | Escala referencia (Q=0) |
| K-104 | 104 | 0.7714 | 0.7714 | Ancla salida — sin cambio |

**Regla de búsqueda M1 por nombre:**
1. Coincidencia exacta (trim + mayúsculas)
2. El nombre contiene alguna clave conocida (ej. "Derivadora K-23")
3. KM más cercano dentro de ±2 km
4. Sin coincidencia → M1 = 1.0

---

## MÓDULO 3: CATÁLOGO DE PUNTOS DE CONTROL

| Punto | KM | Tipo | Pzas | Ancho (m) | Alto máx (m) | Cap máx (m³/s) | N_max_op (m) |
|---|---|---|---|---|---|---|---|
| K-0+000 | 0 | radiales | **12** | **1.55** | 1.80 | 70.4 | 3.60 | ← DB real: pzas=12 ancho=1.55m (catálogo anterior tenía pzas=4 ancho=2.20 INCORRECTO) |
| K-23 | 23 | radiales | 3 | 3.50 | 2.00 | 30.0 | 3.60 |
| K-29 | 29 | radiales | 2 | 4.00 | 2.00 | 28.0 | 3.50 |
| K-34 | 34 | radiales | 2 | 4.00 | 2.00 | 28.0 | 3.50 |
| K-44 | 44 | radiales | 2 | 3.80 | 2.00 | 35.0 | 3.40 |
| K-54 | 54 | radiales | 2 | 3.60 | 2.00 | 24.0 | 3.40 |
| K-62 | 62 | radiales | 4 | 2.50 | 1.80 | 24.0 | 3.40 |
| K-64 | 64 | referencia | 0 | 0 | — | — | 3.40 |
| K-68 | 68 | radiales | 2 | 3.40 | 2.00 | 22.0 | 3.40 |
| K-79+025 | 79.025 | radiales | 2 | 3.20 | 1.80 | 20.0 | 3.20 |
| K-87+549 | 87.549 | radiales | 2 | 3.00 | 1.80 | 18.0 | 3.10 |
| K-94+057 | 94.057 | radiales | 2 | 2.80 | 1.80 | 16.0 | 3.00 |
| K-94+200 | 94.200 | referencia | 0 | 0 | — | — | 3.00 |
| K-104 | 104 | radiales | 2 | 2.60 | 1.80 | 15.0 | 2.80 |

---

## MÓDULO 4: BALANCE HÍDRICO

### 4.1 Ecuación de continuidad por tramo
```
Q_salida = Q_entrada − Q_extracciones_zona − Q_pérdidas_lineales
```

### 4.2 Pérdidas lineales
```
λ = 0.00000 m³/s·km⁻¹   (calculada: Q0 − Q104 − Q_zonas / 104 km — dinámica)
Q_pérdidas(km) = km × λ
```

*Nota: λ se recalcula en cada snapshot. Referencia histórica v3.6b: 0.00703 m³/s·km⁻¹ (antes corrección K-0 era 0.02342)*

### 4.3 Entregas por zona — DATOS ACTUALES (2026-05-15 08:30 UTC)

> **Entrega real** = Q(escala inicio zona) − Q(escala fin zona), calculado de lecturas en tiempo real.
> **Objetivo** = módulo Manning calibrado (referencia de planificación).

| Zona | Escalas medición | Q entrega real (m³/s) | Q objetivo (m³/s) | Δ | Vol actual (Mm³) | Llenado (%) | Nivel medio (m) |
|---|---|---|---|---|---|---|---|
| Z1 | K-23 → K-29 | **0.000** | 2.400 | ▼ -2.400 | 3.0337 | 82.6% | 3.281 |
| Z2 | K-34 → K-44 | **0.000** | 2.750 | ▼ -2.750 | 1.1643 | 86.9% | 3.443 |
| Z3 | K-54 → K-68 | **0.000** | 4.635 | ▼ -4.635 | 0.2765 | 86.1% | 3.572 |
| Z4 | K-79+025 → K-94+057 | **0.000** | 4.200 | ▼ -4.200 | 1.0163 | 70.7% | 3.013 |
| **Total** | — | **0.000** | **13.985** | — | — | — | — |

### 4.4 Q esperada en punto KM por balance:
```
Q_esp(km) = Q0 − λ×km − Σ(extracciones de zonas completadas antes de km)
```

Para zonas parcialmente recorridas: extraer proporción lineal.

### 4.5 Recalibración M1
```
M1_nuevo = M1_actual × (Q_esperada(km) / Q_calculada_con_M1_actual)
```

Solo aplicar cuando: hay aperturas registradas, H↑ y H↓ disponibles, y Q_calculada > 0.

---

## MÓDULO 5: PROPAGACIÓN DE ONDA

### 5.1 Parámetros calibrados

| Parámetro | Valor | Confianza | Fuente |
|---|---|---|---|
| Celeridad c | **v = 4.5 × Q^0.15 km/h** | 75% | BC-07 reconciliado 06/05/2026 — anclas K-23/K-104 |
| F_aten > 40 km | **0.27** | 45% | BC-06 — evento 24-25/04/2026 (calibrado) |
| F_aten 0–40 km | **0.55** (teórico) | 15% | BC-01 — pendiente calibración con evento real |

> **BC-07 reconciliado:** C_ONDA=0.80 m/s era 3× más lento que las anclas operativas
> (K-23 observado ~180 min, BC-07 predecía 479 min). Fórmula unificada con ModelingDashboard.

### 5.2 Fórmulas de propagación

**Celeridad de onda (Q-dependiente):**
```
c(Q) = 4.5 × Q^0.15  [km/h]  →  c(Q) / 3.6  [m/s]
Anclas: Q=28 → c = 7.42 km/h → K-23 en ~177 min  (obs. ~180 min ✓)
        Q=28 → canal completo K-104 en ~831 min              (obs. ~820 min ✓)
```

**Tiempo de tránsito por segmento:**
```
T_seg (min) = dist_km × 1000 / c(Q_seg) / 60
```

**ΔQ esperado aguas abajo — segmentado por distancia:**
```
Si dist_origen → destino ≤ 40 km  (Z1–Z2, segmento cercano):
  ΔQ_destino = ΔQ_origen × (1 − 0.55) = ΔQ_origen × 0.45
  [BC-01: solo teórico, conf. 15%]

Si dist_origen → destino > 40 km  (Z3–Z4, segmento largo):
  ΔQ_destino = ΔQ_origen × (1 − 0.27) = ΔQ_origen × 0.73
  [BC-06: calibrado evento 24-25/04/2026, conf. 45%]
```

### 5.3 Tabla de tránsito (v = 4.5 × Q^0.15 km/h, Q típico por segmento)

| Tramo | Dist (km) | Q típico | T (min) | T (h:mm) | Ancla |
|---|---|---|---|---|---|
| K-0+000 → K-23 | 23.000 | 28 | 186 | 3:06 | obs. ~180 min ✓ |
| K-23 → K-29 | 6.000 | 26 | 49 | 0:49 | — |
| K-29 → K-34 | 5.000 | 25 | 41 | 0:41 | — |
| K-34 → K-44 | 10.000 | 23 | 83 | 1:23 | — |
| K-44 → K-54 | 10.000 | 22 | 84 | 1:24 | — |
| K-54 → K-68 | 14.000 | 19 | 120 | 2:00 | — |
| K-68 → K-79+025 | 11.025 | 18 | 95 | 1:35 | — |
| K-79+025 → K-87+549 | 8.524 | 16 | 75 | 1:15 | — |
| K-87+549 → K-94+057 | 6.508 | 15 | 58 | 0:58 | — |
| K-94+057 → K-104 | 9.943 | 12 | 91 | 1:31 | suma→831 min ✓ |
| **K-0 → K-104 total** | **104** | — | **882** | **14:42** | obs. ~820 min ✓ |

---

## MÓDULO 6: PERFIL HIDRÁULICO DEL CANAL

Sección trapezoidal: **A = (b + z·y)·y**, **P = b + 2y·√(1+z²)**, **R = A/P**

| Tramo | b (m) | z | S₀ | n | Cap (m³/s) |
|---|---|---|---|---|---|
| K-0→K-23 | 11.60 | 2.50 | 1.0×10⁻⁴ | 0.015 | 32.5 |
| K-23→K-29 | 13.30 | 1.75 | 8.5×10⁻⁵ | 0.015 | 30.0 |
| K-29→K-34 | 13.30 | 1.75 | 8.5×10⁻⁵ | 0.015 | 30.0 |
| K-34→K-44 | 12.80 | 1.75 | 8.5×10⁻⁵ | 0.015 | 28.0 |
| K-44→K-54 | 12.20 | 1.75 | 8.5×10⁻⁵ | 0.015 | 26.0 |
| K-54→K-62 | 11.75 | 1.75 | 8.5×10⁻⁵ | 0.015 | 24.0 |
| K-62→K-68 | 11.75 | 1.75 | 8.5×10⁻⁵ | 0.015 | 24.0 |
| K-68→K-79 | 9.60 | 1.75 | 9.0×10⁻⁵ | 0.015 | 20.0 |
| K-79→K-87 | 8.50 | 1.75 | 9.0×10⁻⁵ | 0.015 | 18.0 |
| K-87→K-94+057 | 8.50 | 1.75 | 9.0×10⁻⁵ | 0.015 | 18.0 |
| K-94→K-104 | 7.70 | 1.75 | 9.0×10⁻⁵ | 0.015 | 15.0 |

**Manning para tirante normal (método iterativo Newton-Raphson):**
```
Q = (1/n) × A × R^(2/3) × S₀^(1/2)
Yₙ → iterar hasta |ΔY| < 0.0005 m
```

**Volumen almacenado por tramo (prismatoide):**
```
V = (L/6) × [A(y_ini) + 4·A(y_mid) + A(y_fin)]
donde y_ini = H_abajo del checkpoint aguas arriba
      y_fin  = H_arriba del checkpoint aguas abajo
      y_mid  = (y_ini + y_fin) / 2
```

---

## MÓDULO 7: SNAPSHOT DE ESTADO ACTUAL

**Timestamp:** 2026-05-15 08:30 UTC
**Q entrada K-0:** 0.000 m³/s
**Q salida K-104:** 0.000 m³/s
**Q entregas zonas (real):** 0.000 m³/s  ← diferencial Q escalas frontera
**Q entregas zonas (obj.):** 13.985 m³/s  ← Manning referencia
**Pérdidas estimadas:** 0.000 m³/s
**Eficiencia global:** 0.0%
**λ calibrada:** 0.00000 m³/s·km⁻¹

### 7.1 Gastos por Punto de Control

| Punto | KM | H↑(m) | H↓(m) | Δh(m) | Q(m³/s) | M1 | Aperturas | Alerta |
|---|---|---|---|---|---|---|---|---|
| K-0+000 | 0 | 3.430 | 0.000 | 3.430 | **0.000** | 1.1570 | — | ⚠ BL=-0.030m |
| K-23 | 23 | 3.250 | 0.000 | 3.250 | **0.000** | 1.9031 | — | BL=0.150m |
| K-29 | 29 | 3.100 | 0.000 | 3.100 | **0.000** | 1.2379 | — | BL=0.300m |
| K-34 | 34 | 3.200 | 0.000 | 3.200 | **0.000** | 1.5199 | — | BL=0.200m |
| K-44 | 44 | 3.300 | 0.000 | 3.300 | **0.000** | 1.0119 | — | BL=0.100m |
| K-54 | 54 | 3.470 | 0.000 | 3.470 | **0.000** | 1.0066 | — | ⚠ BL=-0.070m |
| K-62 | 62 | 3.470 | 0.000 | 3.470 | **0.000** | 1.0537 | — | ⚠ BL=-0.070m |
| K-64 | 64 | 3.320 | 0.000 | 3.320 | **0.000** | 1.3305 | — | BL=0.080m |
| K-68 | 68 | 3.610 | 0.000 | 3.610 | **0.000** | 1.0398 | — | ⚠ BL=-0.210m |
| K-79+025 | 79.025 | 3.380 | 0.000 | 3.380 | **0.000** | 1.5824 | — | BL=0.020m |
| K-87+549 | 87.549 | 3.240 | 0.000 | 3.240 | **0.000** | 1.2089 | — | BL=0.160m |
| K-94+057 | 94.057 | 2.940 | 0.000 | 2.940 | **0.000** | 1.1612 | — | BL=0.460m |
| K-94+200 | 94.2 | 2.980 | 0.000 | 2.980 | **0.000** | 1.2851 | — | BL=0.020m |
| K-104 | 104 | 2.430 | 0.000 | 2.430 | **0.000** | 0.7714 | — | BL=0.570m |

### 7.2 Volumen Almacenado por Tramo

| Tramo | L (km) | b (m) | z | y_ini(m) | y_fin(m) | Vol (Mm³) |
|---|---|---|---|---|---|---|
| K-0+000→K-23 | 23.000 | 11.6 | 2.5 | 2.744 | 3.250 | 1.3173 |
| K-23→K-29 | 6.000 | 13.3 | 1.75 | 2.600 | 3.100 | 0.3129 |
| K-29→K-34 | 5.000 | 13.3 | 1.75 | 2.480 | 3.200 | 0.2598 |
| K-34→K-44 | 10.000 | 12.8 | 1.75 | 2.560 | 3.300 | 0.5261 |
| K-44→K-54 | 10.000 | 12.2 | 1.75 | 2.640 | 3.470 | 0.5370 |
| K-54→K-62 | 8.000 | 11.75 | 1.75 | 2.776 | 3.470 | 0.4307 |
| K-62→K-64 | 2.000 | 11.75 | 1.75 | 2.776 | 3.320 | 0.1042 |
| K-64→K-68 | 4.000 | 11.75 | 1.75 | 2.656 | 3.610 | 0.2165 |
| K-68→K-79+025 | 11.025 | 9.6 | 1.75 | 2.888 | 3.380 | 0.5216 |
| K-79+025→K-87+549 | 8.524 | 8.5 | 1.75 | 2.704 | 3.240 | 0.3474 |
| K-87+549→K-94+057 | 6.508 | 8.5 | 1.75 | 2.592 | 2.940 | 0.2403 |
| K-94+057→K-94+200 | 0.143 | 7.7 | 1.75 | 2.352 | 2.980 | 0.0047 |
| K-94+200→K-104 | 9.800 | 7.7 | 1.75 | 2.384 | 2.430 | 0.2810 |
| **TOTAL** | **104.0** | — | — | — | — | **5.0996** |

**Por zona:**
- Zona 1 (K-0→K-23): 1.3173 Mm³
- Zona 2 (K-23→K-54): 1.6359 Mm³
- Zona 3 (K-54→K-68): 0.7514 Mm³
- Zona 4 (K-68→K-104): 1.3950 Mm³

---

## MÓDULO 8: LÓGICA DE DIAGNÓSTICO

### 8.1 Coherencia tramo a tramo
```
Si Q_downstream > Q_upstream + 0.5 m³/s  →  ANOMALÍA GANANCIA (revisar M1 o aportación lateral)
Si (Q_upstream - Q_downstream) / Q_upstream > 0.45  →  PÉRDIDA CRÍTICA (>45%)
Si (Q_upstream - Q_downstream) / Q_upstream > 0.20  →  PÉRDIDA ELEVADA (>20%)
```

### 8.2 Alertas de nivel
```
Si H_arriba > nivel_max_operativo  →  NIVEL CRÍTICO (BC-05)
Si H_arriba > nivel_max_operativo × 0.95  →  PRECAUCIÓN bordo libre
```

### 8.3 Verificación capacidad
```
Si Q > capacidad_max  →  EXCEDE CAPACIDAD DISEÑO
```

### 8.4 Datos faltantes
```
Si pzas_radiales > 0 Y aperturas = vacías  →  SIN DATOS (Q=0, no confiable)
Si pzas_radiales > 0 Y H_abajo = null  →  COMPLETAR H_abajo
```

### 8.5 Reconciliación módulos vs escalas
```
Para cada zona Z:
  Q_real_zona = Q(escala_inicio_Z) − Q(escala_fin_Z)           [lecturas actuales]
  Q_modulos_Z = Σ(gastos de módulos asignados a Z)             [del balance de volumetría]
  brecha_Z = Q_real_zona − Q_modulos_Z

Si |brecha_Z| > 0.5 m³/s  →  ALERTA RECONCILIACIÓN
  Posibles causas: módulo no asignado a zona correcta, lectura de escala errónea,
                   entrega no registrada en SICA, pérdida localizada
```

### 8.6 Alerta depleción ciclo agrícola
```
Para cada módulo M con autorizacion_ciclo:
  pct_consumido = vol_base_consumido_m3 / vol_autorizado_m3 × 100

Si pct_consumido ≥ 100%  →  BASE AGOTADO — verificar si hay autorización adicional
Si pct_consumido ≥ 85%   →  ALERTA BASE (≥85% consumido) — coordinar dotación final
```

---

## MÓDULO 9: MODELACIÓN DE EVENTOS

### 9.1 Protocolo para simular cambio en Presa Boquilla
Dado ΔQ_presa a tiempo T₀:

1. **ΔQ en K-0:** llega en T₀ + T_tránsito_presa→K0 (no calibrado, usar ~60 min estimado)
2. **ΔQ en K-23 en adelante (aplicar F_aten por segmento):**
   ```
   Si checkpoint ≤ 40 km desde K-0  (K-23, K-29, K-34):
     ΔQ_llegada = ΔQ_K0 × (1 − 0.55) = ΔQ_K0 × 0.45  [BC-01, teórico]
   Si checkpoint > 40 km desde K-0  (K-44 en adelante):
     ΔQ_llegada = ΔQ_K0 × (1 − 0.27)      = ΔQ_K0 × 0.73  [BC-06, calibrado]
   T_llegada(checkpoint) = T₀ + T_K0→checkpoint (ver tabla tránsito)
   ```
3. **Para cada checkpoint intermedio:**
   ```
   Q_nuevo(checkpoint, t) = Q_actual(checkpoint) + ΔQ_llegada
   ```
4. **Verificar bordo libre:**
   ```
   ΔH ≈ ΔQ / (Cv_vertedor × ancho_espejo)    [aproximación primera iteración]
   Alerta si H_nuevo > nivel_max_operativo
   ```

### 9.2 Protocolo para simular cambio de apertura en checkpoint K_i
Dado Δap en compuerta j del checkpoint K_i:

1. Calcular ΔQ en K_i: Q_nuevo − Q_actual
2. Propagar ΔQ aguas abajo con tabla de tránsito
3. Actualizar balance tramos afectados
4. Recalcular volúmenes si se solicita

### 9.3 Protocolo de calibración M1 en campo
```
TRIGGER: aforo molinete disponible en checkpoint K_i
1. Q_aforo = valor medido (m³/s)
2. Q_formula = calcQ(hA, hB, aperturas, ancho, pzas, M1_actual=1.0)
3. M1_nuevo(K_i) = Q_aforo / Q_formula
4. Escalar M1 de checkpoints aguas abajo:
   Para cada K_j (j > i):
     Q_esp_viejo(K_j) = qEsperada(km_j, Q0_viejo)
     Q_esp_nuevo(K_j) = qEsperada(km_j, Q0_nuevo)
     M1_nuevo(K_j) = M1_actual(K_j) × (Q_esp_nuevo / Q_esp_viejo)
```

---

## MÓDULO 10: BRECHAS DE CALIBRACIÓN PENDIENTES

| ID | Parámetro | Valor actual | Confianza | Acción requerida |
|---|---|---|---|---|
| BC-01 ⚠ PRIORITARIO | F_aten 0–40 km | 0.55 (teórico) | 15% | **Requerido antes de cualquier incremento Boquilla** — medir ΔQ K-23/K-34 durante próximo evento |
| BC-02 | T K-94→K-104 | 207 min (modelo) | 50% | Verificar con apertura 27/04 (pendiente confirmación) |
| BC-03 | F_hid compuertas radiales | 0.70 (estimado) | 35% | Apertura aislada +5cm en K-44, K-68, K-87 |
| BC-04 | Q extracción por zona | 13.985 m³/s (campo) | 65% | Aforo directo en temporada riego 2026 |
| BC-05 | Bordo libre real K-54/K-62/K-68 | 0.60 m (diseño) | 20% | Inspección física URGENTE antes de maniobras |
| BC-06 | F_aten > 40 km | 0.27 | 45% | Confirmar con 2+ eventos adicionales |
| BC-07 ✓ RECONCILIADO | Celeridad c | v = 4.5×Q^0.15 km/h | 75% | Anclas K-23 (~180 min) y K-104 (~820 min) — error < 2% |
| BC-08 | Volumen real tramo K-94→K-104 | estimado | 50% | Batimetría ADCP |
| BC-09 | Anomalía ganancia K-87+549 | Q_K87 > Q_K79 (+1.063 m³/s) | — | Investigar: aportación lateral, error M1, fuga retro-flujo |

---

## MÓDULO 11: INSTRUCCIONES DE USO PARA MODELACIÓN

Cuando el usuario proporcione:
- **Lecturas de escala** (H↑, H↓, aperturas): calcular Q con fórmulas Módulo 1 + M1 del Módulo 2
- **Balance global**: usar Q_K0 y Q_K104 como anclas, λ=0.00000 m³/s·km⁻¹ (Módulo 4.2), zonas del Módulo 4
- **Evento de onda**: aplicar tabla tránsito + F_aten del Módulo 5
- **Recalibración M1**: seguir protocolo Módulo 9.3
- **Volumen almacenado**: usar perfil Módulo 6 + fórmula prismatoide
- **Diagnóstico coherencia**: aplicar reglas Módulo 8

**Unidades siempre:** m (metros), m³/s (gasto), m³ o Mm³ (volumen), min (tiempo tránsito)

**Precisión de reporte:** gastos a 3 decimales, M1 a 4 decimales, volúmenes a 4 decimales Mm³

---
*SICA — Sistema de Información y Control de Agua | DR-005 Delicias | Uso interno Gerencia Técnica*
*Calibración: 05/05/2026 (v3.6e) | Generado: 2026-05-15 08:30*
