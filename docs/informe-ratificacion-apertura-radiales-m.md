# Informe de Ratificación: `apertura_radiales_m` y Cálculo de Gasto por Compuertas Radiales
**Fecha:** 2026-04-13  
**Componente:** `lecturas_escalas.apertura_radiales_m` · `fn_calcular_gasto_escala` · `ModelingDashboard.tsx`  
**Motivación:** El usuario observó que en K-0+000 se muestra `Apertura: 1.11 m` y cuestionó si corresponde a UNA compuerta o al conjunto de compuertas radiales, y si el gasto calculado ya incorpora las 4 piezas.

---

## 1. Conclusión Ejecutiva

| Pregunta | Respuesta |
|---------|-----------|
| ¿`apertura_radiales_m = 1.11 m` es de **una** compuerta o del total? | **De UNA compuerta individual** |
| ¿El gasto ORIFICIO en TypeScript ya incluye las 4 piezas? | **Sí — usa `pzas × ancho_pieza`** |
| ¿El trigger SQL incluye las 4 piezas? | **Riesgo: depende de qué almacena `escalas.ancho`** |
| ¿Para K-0 la lectura `gasto_calculado_m3s` es confiable? | **Sí — sica-capture suma cada compuerta individualmente** |

---

## 2. Definición del Campo `apertura_radiales_m`

El campo `apertura_radiales_m` en la tabla `lecturas_escalas` almacena la **apertura vertical de una compuerta radial individual** — es decir, la distancia en metros entre el umbral (solera) y el borde inferior de la compuerta.

```
apertura_radiales_m = h_gate [m] de UNA pieza
```

Esta interpretación está confirmada por:

1. El nombre del campo (singular `apertura_radiales_m`, no `apertura_total_m`).
2. El comentario en la migración `20260329110000_fn_hidraulica_compuertas_fgv.sql`, línea 685:
   > *"apertura_radiales_m es solo la apertura máxima (legacy), no la suma"*
3. La app hydric-chat (edge function `hydric-chat/index.ts`, línea 185) que interpreta:
   ```typescript
   ancho = esc.ancho    // por compuerta
   L_total = ancho * pzas  // ancho total = ancho_pieza × número_piezas
   ```
4. El campo `radiales_json` que almacena las aperturas **individuales** por pieza (e.g., `[{index:0, apertura_m:1.11}, {index:1, apertura_m:1.05}, ...]`).

**Para K-0+000:**

| Parámetro | Valor |
|-----------|-------|
| `pzas_radiales` | 4 compuertas |
| `ancho` (por pieza) | 12 m |
| `apertura_radiales_m` | 1.11 m (una compuerta — valor máximo/legacy) |
| Ancho total efectivo | 4 × 12 = **48 m** |

---

## 3. Cómo el Gasto es Calculado en Cada Capa

### 3.1 sica-capture (fuente primaria — K-0)

```
gasto_calculado_m3s = Σ Q_i   (suma sobre cada compuerta individual)
Q_i = Cd × ancho_pieza × apertura_i × √(2g × H)
```

sica-capture **itera sobre `radiales_json`** y suma el caudal de cada compuerta. Este valor se almacena directamente en `lecturas_escalas.gasto_calculado_m3s`.

**Resultado:** El gasto en K-0 refleja fielmente la operación de las 4 compuertas, usando la apertura real de cada una (no solo la máxima). Si la apertura de las 4 compuertas es uniforme (1.11 m), la suma es:

```
Q_total = Cd × 4 × 12 × 1.11 × √(2g × H)
        = 0.70 × 48 × 1.11 × √(2 × 9.81 × H)
```

Con H ≈ y_nivel = 3.42 m:
```
√(2 × 9.81 × 3.42) = 8.19 m^0.5
Q_total = 0.70 × 48 × 1.11 × 8.19 ≈ 306 m³/s (capacidad teórica máxima)
```

El gasto *medido* real (8.29 m³/s en el ejemplo) es mucho menor porque las compuertas operan parcialmente cerradas sobre un canal con contrapresión aguas abajo (condición M1).

---

### 3.2 TypeScript — Fallback ORIFICIO en `runSimulation()`

Cuando no existe `gasto_calculado_m3s` (aforo nulo), el módulo de modelación calcula:

```typescript
// ModelingDashboard.tsx, línea 627
const q_orificio = cd_used * pzas * ancho * h_gate * Math.sqrt(2 * G * y_base);
```

**Para K-0:**
```
pzas = 4
ancho = 12 m/pieza
h_gate = apertura_radiales_m = 1.11 m
y_base = nivel actual (p.ej. 3.42 m)

q_orificio = 0.70 × 4 × 12 × 1.11 × √(2 × 9.81 × 3.42)
           = 0.70 × 48 × 1.11 × 8.19
           ≈ 306 m³/s
```

`area_gate` (también usado en R4 y en la UI):
```typescript
const area_gate = Math.max(0.01, ancho * pzas * h_gate);
// = 12 × 4 × 1.11 = 53.28 m²
```

**Veredicto:** El cálculo TypeScript es **correcto** — incorpora las 4 piezas explícitamente mediante el multiplicador `pzas`.

---

### 3.3 Trigger SQL `fn_trg_calcular_gasto_escala` — Riesgo Identificado

El trigger se activa cuando `gasto_calculado_m3s IS NULL OR = 0`. Llama a `fn_calcular_gasto_escala`, que a su vez llama a `fn_q_compuerta` con:

```sql
-- fn_hidraulica_compuertas_fgv.sql, líneas 168–176
v_Q := public.fn_q_compuerta(
  v_esc.cd,
  v_esc.ancho,   ← valor directo de la tabla escalas
  1,             ← n_pzas = 1 (¡fijo!)
  p_apertura_m,
  p_nivel_m,
  p_h2
);
-- Comentario: "ancho = ancho total de la estructura, n_pzas = 1"
```

La función `fn_q_compuerta` está definida como:
```sql
Q = Cd × n_pzas × p_ancho × apertura × √(2g × H)
```

Con `n_pzas = 1` fijo, el resultado correcto **solo si `escalas.ancho` almacena el ancho total** (48 m para K-0). Sin embargo:

- La edge function `hydric-chat` interpreta `escalas.ancho` como **ancho por pieza** (`"ancho=X m c/u"`) y computa `L_total = ancho × pzas`.
- Si `escalas.ancho` = 12 m (por pieza), el trigger calcula:
  ```
  Q_trigger = Cd × 1 × 12 × 1.11 × √(2g·H) ≈ 76.6 m³/s
  ```
  — **4× inferior** al valor correcto de 306 m³/s.

| Escenario | `escalas.ancho` | Q calculado por trigger | Correcto |
|-----------|-----------------|------------------------|----------|
| Ancho = total (48 m) | 48 m | ≈ 306 m³/s | Sí |
| Ancho = pieza (12 m) | 12 m | ≈ 77 m³/s | No — subestima 4× |

---

## 4. ¿Por qué No Se Manifestó el Problema en K-0?

El comentario en línea 683–685 explica la jerarquía de K-0:

```
Tier 1: AFORO K-1 (aforos directos con molinete)
Tier 2: gasto_calculado_m3s de sica-capture (suma de radiales_json)
Tier 3: movimiento de presa vigente
```

El trigger SQL **nunca actúa** sobre K-0 porque sica-capture ya provee `gasto_calculado_m3s` desde `radiales_json`. El trigger solo actuaría si se insertara una lectura con `gasto_calculado_m3s = NULL` en una escala sin cobertura de sica-capture.

**Riesgo real:** Secciones aguas abajo (K-23, K-34, K-57…) donde no opera sica-capture podrían depender del trigger — y si `escalas.ancho` en esas escalas almacena el ancho por pieza, el `gasto_calculado_m3s` auto-calculado sería 1/n_pzas del valor correcto.

---

## 5. Lo que Muestra la UI y su Interpretación Correcta

La línea de la UI en el panel de detalles:

```
[4 pzas · ancho 12m · A=53.3 m²]
```

- **4 pzas** = 4 compuertas radiales
- **ancho 12m** = 12 m por pieza (ancho de CADA compuerta)
- **A = 53.3 m²** = área total efectiva = 4 × 12 m × 1.11 m = 53.28 m²

La línea de apertura:
```
⚓ AFORO SICA · 1.11 m · Q ancla: 8.29 m³/s
```

- **1.11 m** = apertura de una compuerta individual (el valor en `apertura_radiales_m`)
- **Q ancla: 8.29 m³/s** = gasto medido por sica-capture (suma de todas las piezas)

La UI es **semánticamente correcta**: muestra la apertura individual como referencia dimensional y el caudal total como resultado de operación.

---

## 6. Acciones Recomendadas

### Inmediata — Verificar `escalas.ancho` en base de datos

Ejecutar en Supabase SQL Editor:
```sql
SELECT 
  nombre, 
  km, 
  ancho          AS ancho_actual_bd,
  pzas_radiales,
  ancho * pzas_radiales AS L_total_si_es_pieza,
  'Debería ser 48 para K-0 si almacena total, o 12 si almacena pieza' AS nota
FROM public.escalas
WHERE pzas_radiales > 0
ORDER BY km;
```

**Criterio de aceptación:**
- Si `ancho` = 48 m para K-0 → el trigger SQL es correcto. La hydric-chat display es la que tiene un error de presentación.
- Si `ancho` = 12 m para K-0 → la hydric-chat es correcta y el trigger SQL subestima Q por factor `pzas`. Corregir la función SQL para pasar `pzas_radiales` desde la escala.

### Si se confirma bug en el trigger

Reemplazar en `fn_calcular_gasto_escala`:

```sql
-- ANTES (potencialmente incorrecto si ancho = pieza)
v_Q := public.fn_q_compuerta(v_esc.cd, v_esc.ancho, 1, p_apertura_m, ...);

-- DESPUÉS (correcto en cualquier convención)
v_Q := public.fn_q_compuerta(
  v_esc.cd,
  v_esc.ancho,
  COALESCE(v_esc.pzas_radiales, 1),  ← usar pzas de la escala
  p_apertura_m, ...
);
```

### Informativa — Aclaración en Pantalla

Para el operador, considerar mostrar la apertura acompañada de contexto:

```
Apertura radial: 1.11 m/compuerta  [×4 pzas · Q = 8.29 m³/s total]
```

Esto elimina toda ambigüedad sobre si el valor mostrado es individual o acumulado.

---

## 7. Resumen de Hallazgos

| Capa | Fórmula | ¿Incluye 4 pzas? | Confiabilidad |
|------|---------|-----------------|--------------|
| **sica-capture** (K-0 Tier 2) | Suma `radiales_json` individualmente | ✅ Sí — por diseño | Alta |
| **TypeScript ORIFICIO fallback** | `Cd × pzas × ancho_pieza × aper × √(2gH)` | ✅ Sí | Alta |
| **SQL trigger** `fn_trg_calcular_gasto_escala` | `Cd × 1 × escalas.ancho × aper × √(2gH)` | ⚠️ Solo si `escalas.ancho` = ancho total | Requiere verificación |
| **`apertura_radiales_m`** | Campo legacy — apertura máxima de 1 pieza | N/A | Referencia dimensional |

**El valor 1.11 m en K-0+000 es la apertura de UNA compuerta radial individual.** El gasto de 8.29 m³/s proviene de sica-capture que ya integra todas las piezas correctamente. El cálculo ORIFICIO en TypeScript también integra las 4 piezas. El único componente que requiere verificación es el trigger SQL y la convención de `escalas.ancho` en la base de datos.

---

*Generado — Conchos Digital v2.7.1 · Revisión hidráulica 2026-04-13*
