# SKILL HIDRÁULICA — Canal Principal Conchos (DR-005 Delicias)
## Modelo Paralelo para Modelación de Eventos — v3.7
**Generado:** 2026-06-02 | **Calibración K-0:** 01/06/2026 | **Sistema:** SICA v2.6.2

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

**Metodología:** M1_nuevo = Q_aforo / Q_formula(M1=1.0)

**Historial calibración K-0+000:**
```
24/03/2026  Q_aforo = 29.161 m³/s  (aforo K1+000, escala 2.56)
06/04/2026  Q_aforo = 24.030 m³/s  (aforo K1+000, escala 2.28)
15/04/2026  Q_aforo = 22.801 m³/s  (aforo K1+000, escala 2.19)
27/04/2026  Q_aforo = 26.488 m³/s
04/05/2026  Q_aforo = 29.497 m³/s
14/05/2026  M1 = 1.2547  (gastos_actuales.mjs · Q_aforo=31.377 — ⚠ posible sobreestimación)
18/05/2026  Q_aforo = 27.825 m³/s  →  M1 = 1.1855  (−5.5% vs 14/05)
01/06/2026  Q_aforo = 28.217 m³/s  →  M1 = 1.2022  (+1.4% vs 18/05)
08/06/2026  Q_aforo = 31.260 m³/s  →  M1 = 1.2593  (Q_base=24.824 · cond. 06–10/jun estables 1.234–1.275)
```

**M1 vigente = 1.2365** — promedio ponderado 01/06 (0.4) + 08/06 (0.6).
Se pondera para no sobreajustar a un solo aforo de Q alto (lección del 14/05).
Δ vs aforo individual 08/06 = −1.8% · Δ vs 01/06 = +2.9% (ambos < umbral 5%).

**Q_base sin M1 (geométrica fija K-0+000):** 23.471 m³/s
(Cd=0.62 · 12 compuertas · ancho=1.55 m · condiciones aforo 18/05 como ancla)

| Punto | KM | M1 v3.7 | M1 v3.6f | Fuente |
|---|---|---|---|---|
| K-0+000 | 0 | **1.2365** | 1.1855 | Aforo molinete K1+000 — pond. 01/06 (28.217) + 08/06 (31.260) |
| K-23 | 23 | **1.9031** | 1.9031 | CONGELADO — sifón, fórmula radial no aplica |
| K-29 | 29 | **1.2379** | 1.2379 | Sin cambio |
| K-34 | 34 | **1.5199** | 1.5199 | Sin cambio |
| K-44 | 44 | **1.0119** | 1.0119 | Sin cambio |
| K-54 | 54 | **1.0066** | 1.0066 | Sin cambio |
| K-62 | 62 | **1.0537** | 1.0537 | Sin cambio |
| K-64 | 64 | 1.3305 | 1.3305 | Escala referencia (Q=0) |
| K-68 | 68 | **1.0398** | 1.0398 | Sin cambio |
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

> Fuente autoritativa: base de datos Supabase (tabla `escalas`). Los valores de pzas y ancho corresponden a los datos reales del sistema.

| Punto | KM | Tipo | Pzas | Ancho (m) | Alto máx (m) | N_max_op (m) |
|---|---|---|---|---|---|---|
| K-0+000 | 0 | radiales | **12** | **1.55** | 1.84 | 3.60 |
| K-23 | 23 | radiales | **4** | **3.50** | 3.50 | 3.40 |
| K-29 | 29 | radiales | **4** | **3.50** | 3.50 | 3.40 |
| K-34 | 34 | radiales | **4** | **3.00** | 3.50 | 3.40 |
| K-44 | 44 | radiales | **4** | **3.50** | 3.50 | 3.40 |
| K-54 | 54 | radiales | **4** | **3.50** | 3.50 | 3.40 |
| K-62 | 62 | radiales | **4** | **3.50** | 3.50 | 3.40 |
| K-64 | 64 | referencia | 0 | 0 | — | 3.40 |
| K-68 | 68 | radiales | **4** | **4.00** | 3.50 | 3.40 |
| K-79+025 | 79.025 | radiales | **2** | **4.00** | 3.50 | 3.20 |
| K-87+549 | 87.549 | radiales | **4** | **3.40** | 3.50 | 3.10 |
| K-94+057 | 94.057 | radiales | **4** | **3.90** | 3.50 | 3.00 |
| K-94+200 | 94.200 | referencia | 0 | 0 | — | 3.00 |
| K-104 | 104 | radiales | **4** | **3.50** | 3.50 | 2.80 |

**Estructura mixta K-68** (vertedor de sobrepaso):
```
Q_total = Q_compuertas(M1) + Q_sobrepaso   cuando H_arriba > H_crit
Q_sobrepaso = Cw × L × (H_arriba − H_crit)^1.5
H_crit = 3.56 m · Cw = 2.1 · L = 10.80 m (2 vertedores × 5.40 m, campo 07/05/2026)
M1 K-68 se CONGELA al valor calibrado cuando H_arriba > H_crit
```

**Sifón K-23** (propagación desde K-0, no fórmula radial):
```
Q_K23 = Q_K0 − ΔSIFON
ΔSIFON = 0.650 m³/s  (entregas K-0→K-23, cal. 07/05/2026 bal. Z1)
```

---

## MÓDULO 4: BALANCE HÍDRICO

### 4.1 Ecuación de continuidad por tramo
```
Q_salida = Q_entrada − Q_extracciones_zona − Q_pérdidas_lineales
```

### 4.2 Pérdidas lineales
```
λ  (dinámica — se recalcula en cada snapshot)
λ = (Q0 − Q104 − Q_zonas_real) / 104   [m³/s·km⁻¹]
Q_pérdidas(km) = km × λ
```
Referencia histórica: λ ≈ 0.00703 m³/s·km⁻¹ (v3.6b, antes corrección K-0)

### 4.3 Entregas por zona

> Q_real_zona = Q(escala_inicio_zona) − Q(escala_fin_zona) — calculado de lecturas en tiempo real.

| Zona | Escalas medición | Q objetivo (m³/s) |
|---|---|---|
| Z1 | K-23 → K-29 | 2.400 |
| Z2 | K-34 → K-44 | 2.750 |
| Z3 | K-54 → K-68 | 4.635 |
| Z4 | K-79+025 → K-94+057 | 4.200 |
| **Total** | — | **13.985** |

### 4.4 Q esperada en punto KM por balance
```
Q_esp(km) = Q0 − λ×km − Σ(extracciones de zonas completadas antes de km)
Para zonas parcialmente recorridas: extraer proporción lineal.
```

### 4.5 Recalibración M1
```
M1_nuevo = M1_actual × (Q_esperada(km) / Q_calculada_con_M1_actual)
```
Solo aplicar cuando: hay aperturas registradas, H↑ y H↓ disponibles, y Q_calculada > 0.

### 4.6 Reconciliación módulos vs escalas
```
Para cada zona Z:
  Q_real_zona  = Q(escala_inicio_Z) − Q(escala_fin_Z)
  Q_modulos_Z  = Σ(gastos de módulos asignados a Z)
  brecha_Z     = Q_real_zona − Q_modulos_Z

Si |brecha_Z| > 0.5 m³/s  →  ALERTA RECONCILIACIÓN
```

---

## MÓDULO 5: PROPAGACIÓN DE ONDA

### 5.1 Parámetros calibrados

| Parámetro | Valor | Confianza | Fuente |
|---|---|---|---|
| Celeridad c | **v = 4.5 × Q^0.15 km/h** | 75% | BC-07 reconciliado — anclas K-23 (~180 min) y K-104 (~820 min) |
| F_aten > 40 km | **0.27** | 45% | BC-06 — evento 24-25/04/2026 |
| F_aten 0–40 km | **0.55** (teórico) | 15% | BC-01 — pendiente calibración con evento real |

### 5.2 Fórmulas de propagación

**Celeridad de onda (Q-dependiente):**
```
c(Q) = 4.5 × Q^0.15  [km/h]
Ancla: Q=28 → c = 7.42 km/h → K-23 en ~186 min  (obs. ~180 min ✓)
               canal completo K-0→K-104 en ~882 min  (obs. ~820 min ✓)
```

**Tiempo de tránsito por segmento:**
```
T_seg (min) = dist_km × 60 / c(Q_seg)
```

**ΔQ esperado aguas abajo:**
```
dist ≤ 40 km  (K-23, K-29, K-34):
  ΔQ_destino = ΔQ_origen × 0.45   [BC-01, teórico, conf. 15%]

dist > 40 km  (K-44 en adelante):
  ΔQ_destino = ΔQ_origen × 0.73   [BC-06, calibrado, conf. 45%]
```

### 5.3 Tabla de tránsito (v = 4.5 × Q^0.15 km/h)

| Tramo | Dist (km) | Q típico (m³/s) | c (km/h) | T (min) | T (h:mm) |
|---|---|---|---|---|---|
| K-0+000 → K-23 | 23.000 | 28 | 7.42 | 186 | 3:06 |
| K-23 → K-29 | 6.000 | 26 | 7.34 | 49 | 0:49 |
| K-29 → K-34 | 5.000 | 25 | 7.29 | 41 | 0:41 |
| K-34 → K-44 | 10.000 | 23 | 7.20 | 83 | 1:23 |
| K-44 → K-54 | 10.000 | 22 | 7.15 | 84 | 1:24 |
| K-54 → K-68 | 14.000 | 19 | 7.00 | 120 | 2:00 |
| K-68 → K-79+025 | 11.025 | 18 | 6.94 | 95 | 1:35 |
| K-79+025 → K-87+549 | 8.524 | 16 | 6.82 | 75 | 1:15 |
| K-87+549 → K-94+057 | 6.508 | 15 | 6.76 | 58 | 0:58 |
| K-94+057 → K-104 | 9.943 | 12 | 6.53 | 91 | 1:31 |
| **K-0 → K-104 total** | **104** | — | — | **882** | **14:42** |

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

**Manning para tirante normal (Newton-Raphson):**
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

> El estado en tiempo real se inyecta desde Conchos-Digital (skillSnapshot) en cada sesión.
> Este módulo es referencia estructural — no contiene datos estáticos de nivel/gasto.

**Variables de entrada requeridas por checkpoint:**
- `H_arriba` (m), `H_abajo` (m), `aperturas[]` (m por compuerta)

**Variables calculadas:**
- `Q` (m³/s) via Módulo 1 + M1 del Módulo 2
- `BL` = N_max_op − H_arriba (bordo libre)
- `Alerta` si BL < 0

**Variables globales del snapshot:**
- `Q0`, `Q104`, `Q_zonas_real`, `λ`, `eficiencia_global`, `vol_total_Mm3`

---

## MÓDULO 8: LÓGICA DE DIAGNÓSTICO

### 8.1 Coherencia tramo a tramo
```
Si Q_downstream > Q_upstream + 0.5 m³/s  →  ANOMALÍA GANANCIA (revisar M1 o aportación lateral)
Si (Q_upstream − Q_downstream) / Q_upstream > 0.45  →  PÉRDIDA CRÍTICA (>45%)
Si (Q_upstream − Q_downstream) / Q_upstream > 0.20  →  PÉRDIDA ELEVADA (>20%)
```

### 8.2 Alertas de nivel
```
Si H_arriba > N_max_op           →  NIVEL CRÍTICO (BC-05)
Si H_arriba > N_max_op × 0.95   →  PRECAUCIÓN bordo libre
```

### 8.3 Verificación capacidad
```
Si Q > capacidad_max  →  EXCEDE CAPACIDAD DISEÑO
```

### 8.4 Datos faltantes
```
Si pzas_radiales > 0 Y aperturas = vacías  →  SIN DATOS (Q=0, no confiable)
Si pzas_radiales > 0 Y H_abajo = null      →  COMPLETAR H_abajo
```

### 8.5 Alerta depleción ciclo agrícola
```
pct_consumido = vol_base_consumido_m3 / vol_autorizado_m3 × 100

Si pct_consumido ≥ 100%  →  BASE AGOTADO
Si pct_consumido ≥ 85%   →  ALERTA BASE (coordinar dotación final)
```

---

## MÓDULO 9: MODELACIÓN DE EVENTOS

### 9.1 Protocolo — cambio en Presa Boquilla
Dado ΔQ_presa a tiempo T₀:

1. **ΔQ en K-0:** T₀ + ~60 min (tránsito presa→K-0, no calibrado)
2. **ΔQ en checkpoints aguas abajo:**
   ```
   dist ≤ 40 km  →  ΔQ_llegada = ΔQ_K0 × 0.45   [BC-01, teórico]
   dist > 40 km  →  ΔQ_llegada = ΔQ_K0 × 0.73   [BC-06, calibrado]
   T_llegada(cp) = T₀ + T_K0→cp (tabla tránsito Módulo 5)
   ```
3. `Q_nuevo(cp, t) = Q_actual(cp) + ΔQ_llegada`
4. Verificar bordo libre: `ΔH ≈ ΔQ / (Cv × ancho_espejo)` — alerta si H_nuevo > N_max_op

### 9.2 Protocolo — cambio de apertura en checkpoint K_i
1. Calcular ΔQ en K_i: Q_nuevo − Q_actual
2. Propagar ΔQ aguas abajo con tabla tránsito
3. Actualizar balance tramos afectados

### 9.3 Protocolo — calibración M1 en campo
```
TRIGGER: aforo molinete disponible en checkpoint K_i
1. Q_aforo = valor medido (m³/s)
2. Q_formula = calcQ(hA, hB, aperturas, ancho, pzas, M1=1.0)
3. M1_nuevo(K_i) = Q_aforo / Q_formula
4. Escalar checkpoints aguas abajo si el cambio afecta el balance:
   M1_nuevo(K_j) = M1_actual(K_j) × (Q_esp_nuevo(K_j) / Q_esp_viejo(K_j))
5. Actualizar skill_hidraulica_vXX.md y snapshot JSON
6. Commit + push a ambos repos (sica-capture + conchos-digital)
```

---

## MÓDULO 10: BRECHAS DE CALIBRACIÓN PENDIENTES

| ID | Parámetro | Valor actual | Confianza | Acción requerida |
|---|---|---|---|---|
| BC-01 ⚠ PRIORITARIO | F_aten 0–40 km | 0.55 (teórico) | 15% | Medir ΔQ K-23/K-34 durante próximo incremento Boquilla |
| BC-02 | T K-94→K-104 | 91 min (modelo) | 50% | Verificar con apertura controlada |
| BC-03 | F_hid compuertas radiales | absorbido en M1 | — | Apertura aislada +5cm en K-44, K-68, K-87 para verificar |
| BC-04 | Q extracción por zona | 13.985 m³/s (campo) | 65% | Aforo directo en temporada riego 2026 |
| BC-05 | Bordo libre real K-54/K-62/K-68 | 0.60 m (diseño) | 20% | Inspección física URGENTE antes de maniobras |
| BC-06 | F_aten > 40 km | 0.27 | 45% | Confirmar con 2+ eventos adicionales |
| BC-07 ✓ | Celeridad c | v = 4.5×Q^0.15 km/h | 75% | Reconciliado — error <2% vs anclas K-23/K-104 |
| BC-08 | Volumen real K-94→K-104 | estimado | 50% | Batimetría ADCP |
| BC-09 ⚠ | Anomalía ganancia K-87+549 | Q_K87 > Q_K79 (+1.063 m³/s) | — | Sin diagnóstico — investigar: aportación lateral, error M1, retro-flujo |

---

## MÓDULO 11: INSTRUCCIONES DE USO PARA MODELACIÓN

Cuando el usuario proporcione:
- **Lecturas de escala** (H↑, H↓, aperturas): calcular Q con fórmulas Módulo 1 + M1 del Módulo 2
- **Balance global**: usar Q_K0 y Q_K104 como anclas, λ dinámica (Módulo 4.2), zonas del Módulo 4.3
- **Evento de onda**: aplicar tabla tránsito + F_aten del Módulo 5
- **Recalibración M1**: seguir protocolo Módulo 9.3
- **Volumen almacenado**: usar perfil Módulo 6 + fórmula prismatoide
- **Diagnóstico coherencia**: aplicar reglas Módulo 8

**Unidades siempre:** m (metros), m³/s (gasto), m³ o Mm³ (volumen), min (tiempo tránsito)

**Precisión de reporte:** gastos a 3 decimales, M1 a 4 decimales, volúmenes a 4 decimales Mm³

---

## REGISTRO DE VERSIONES

| Versión | Fecha | Cambios principales |
|---|---|---|
| v3.6b | 27/04/2026 | M1 K-0=0.8923 (aforo 27/04 Q=26.488) |
| v3.6c | 04/05/2026 | M1 K-0=0.9099 (aforo 04/05 Q=29.497) |
| v3.6e | 05/05/2026 | Recalibración multipunto · λ dinámica · tránsito reconciliado |
| v3.6f | 18/05/2026 | M1 K-0=1.1855 (aforo 18/05 Q=27.825) · BC-07 cerrado |
| **v3.7** | **01/06/2026** | M1 K-0=**1.2022** (aforo 01/06 Q=28.217) · Catálogo pzas/ancho corregido desde DB · Snapshot estático eliminado · Inconsistencias v3.6f resueltas |

---
*SICA — Sistema de Información y Control de Agua | DR-005 Delicias | Uso interno Gerencia Técnica*
*Calibración: 01/06/2026 (v3.7) | Ing. Sergio E. Ogaz Navarrete*
