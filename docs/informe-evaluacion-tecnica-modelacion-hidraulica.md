# Evaluación Técnica Integral — Plataforma de Modelación Hidráulica
## Canal Principal Conchos · Conchos Digital v2.7.x

**Fecha:** 2026-04-14  
**Alcance:** Análisis de desempeño lógico, coherencia estructural, brechas de datos y propuestas de mejora  
**Referencia de caso:** Bug CIERRE-durante-INCREMENTO (corregido commit `feat/fix-ancla-aforo-y-r4-incremento`)  
**Clasificación:** Técnico · Administrativo · Operativo

---

## 1. RESUMEN EJECUTIVO

La Plataforma de Modelación Hidráulica es un sistema de simulación hidráulica en tiempo cuasi-real que cubre los 104 km del Canal Principal Conchos. Integra telemetría SICA Capture, datos de movimientos de presa, perfiles geométricos del canal y un motor de decisión de 9 reglas para generar recomendaciones operativas.

La evaluación identifica **4 fortalezas estructurales consolidadas**, **6 vulnerabilidades lógicas activas**, **8 brechas críticas de datos** y presenta **18 propuestas de mejora** clasificadas por dimensión (técnica, administrativa, visual).

El caso de referencia — el motor recomendando CIERRE de compuertas radiales durante un INCREMENTO de gasto — ilustra una falla de coherencia sistémica: cuando los datos de entrada (aforo presente) se aplican a una capa que opera sobre datos futuros (escenario proyectado), la inversión de lógica es inevitable. La corrección implementada fue correcta y documenta el patrón de error para prevención futura.

**Calificación global de madurez del sistema: 6.2 / 10**

| Dimensión | Calificación | Estado |
|-----------|-------------|--------|
| Núcleo hidráulico (cálculos) | 7.5/10 | Funcional con limitaciones |
| Motor de decisión (reglas) | 6.0/10 | Corregido, incompleto |
| Gestión de datos de entrada | 4.5/10 | Brechas significativas |
| Interfaz y comunicación operativa | 7.0/10 | Buena, mejorable |
| Coherencia lógica entre capas | 5.5/10 | Riesgo residual post-corrección |

---

## 2. ARQUITECTURA DEL SISTEMA — MAPA DE CAPAS

```
┌──────────────────────────────────────────────────────────┐
│  CAPA 1 — INGESTA DE DATOS                               │
│  sica-capture → lecturas_escalas → movimientos_presas    │
│  reportes_diarios → puntos_entrega → perfil_hidraulico   │
├──────────────────────────────────────────────────────────┤
│  CAPA 2 — runSimulation()                                │
│  Manning → normal depth → wave celerity                  │
│  Ancla AFORO/ORIFICIO → conducción → extracción tomas    │
├──────────────────────────────────────────────────────────┤
│  CAPA 3 — generateDecisions()                            │
│  R1–R9: Reglas de decisión hidráulica                    │
│  R4 bifurcado INCREMENT/DECREMENT (corrección reciente)  │
├──────────────────────────────────────────────────────────┤
│  CAPA 4 — INTERFAZ OPERATIVA                             │
│  Mapa longitudinal · Panel KPI · Gráfica ECharts         │
│  Panel detalles · Módulo de apertura requerida           │
└──────────────────────────────────────────────────────────┘
```

La separación de capas es correcta conceptualmente. El problema estructural diagnosticado es la **contaminación de capa**: datos del estado presente (AFORO) que cruzaban a la capa de proyección futura (runSimulation en modo δQ). Corregido en Fix 1 con el flag `isDeltaSim`.

---

## 3. ANÁLISIS DEL CASO DE REFERENCIA — CIERRE DURANTE INCREMENTO

### 3.1 Cronología del fallo

```
Estado real:           qBase = 28 m³/s  ──→  qDam = 30 m³/s  (+2 m³/s INCREMENTO)
AFORO K-0 (presente):  gasto_calculado_m3s = 8.29 m³/s  (estado actual del canal)

[BUG A — Ancla AFORO contamina escenario futuro]
  runSimulation recibe qCur = 30 m³/s
  AFORO 8.29 < 30 → ancla activa → qCur = 8.29 m³/s (valor presente reemplaza futuro)
  Canal simula como si hubiera DECREMENTO: 30→8.29 m³/s

[BUG B — R4 invierte lógica apertura]
  apertura_requerida = Q / (Cd × n × b × √(2g × y)) = 30 / 275.6 = 0.109 m
  apertura_base = 1.11 m
  aperDelta = 0.109 - 1.11 = -1.00 m  (negativo)
  Motor emite: CIERRE ← directiva operativa invertida
```

### 3.2 Raíz conceptual del error

El error no fue solo de código — fue una **confusión entre tres conceptos distintos** que el sistema usaba indistintamente:

| Concepto | Definición | Aplicación correcta |
|---------|-----------|-------------------|
| Q_medido (AFORO) | Flujo que pasa *ahora* por la compuerta | Describir estado base. No proyectar. |
| Q_capacidad (ORIFICIO) | Flujo máximo que la compuerta *podría* pasar | Detectar cuello de botella físico |
| apertura_requerida | Apertura para que pase Q dado el nivel H | Solo válido en DECREMENTO (ajuste de nivel) |

En un canal M1 (remanso), la compuerta está sobredimensionada respecto al caudal que pasa. La `apertura_requerida` da un valor pequeño, pero eso no significa que haya que cerrar la compuerta durante un incremento — el agua pasará igual o más. La regla R4 original no distinguía el escenario.

### 3.3 Corrección implementada y evaluación

| Fix | Mecanismo | Efectividad | Riesgo residual |
|-----|-----------|-------------|----------------|
| `isDeltaSim` + `anchorApplies` | AFORO no ancla en escenario futuro | Alta | Bajo — ORIFICIO sigue anclando como límite físico |
| R4 bifurcado INCREMENT/DECREMENT | INCREMENT no emite CIERRE | Alta | Medio — cuello de botella depende de y_sim que puede tener imprecisión |

**Riesgo residual R4:** La detección de cuello de botella usa `q_capacidad = Cd × area_gate × √(2g × y_sim)`. Si `y_sim` es impreciso (Manning vs backwater real), la capacidad calculada puede estar errónea. No hay confirmación por nivel real aguas abajo.

---

## 4. EVALUACIÓN POR COMPONENTE

### 4.1 Motor de Simulación — `runSimulation()`

#### FORTALEZAS
- **Geometría real por tramo:** Usa `perfil_hidraulico_canal` (plantilla, talud, rugosidad, pendiente) en lugar de constantes globales. Correcto y mantenible.
- **Propagación temporal de onda:** Modelo empírico calibrado (`v_onda = 5.3 × Q^0.15 km/h`) con validación K23 en 3h. Más realista que velocidad cinemática teórica.
- **Cascada AFORO→ORIFICIO→libre:** Lógica de prioridad de fuentes bien estructurada con trazabilidad por `gate_source`.
- **Extracción de tomas:** Integra `q_extraido` por tramo desde `reportes_diarios` cuando existe dato.

#### VULNERABILIDADES

**V1 — Manning en régimen M1 (crítico)**
```
Canal Conchos: y_real ≈ 3.42 m  vs  y_Manning ≈ 1.40 m  (diferencia: 2.02 m = 59%)
```
El sistema calcula `y_n` con Manning (flujo uniforme) pero el canal opera en perfil M1 (backwater). El nivel simulado difiere significativamente del nivel real. Toda la lógica de `y_sim` heredada por R4 (detección cuello de botella), bordo libre, piso de servicio y apertura requerida opera sobre un nivel incorrecto.

**Impacto:** Evaluaciones de bordo libre subestimadas, detección de cuello de botella imprecisa.

**V2 — Piso de servicio como parche (importante)**
```typescript
const y_floor = Math.max(yMin_op, 0.90 * y_base);  // 90% del nivel base
y_sim = Math.max(y_floor, y_n_sim);
```
El piso de servicio evita que la UI muestre valores absurdos, pero enmascara el problema de V1. El operador ve valores conservadores, no valores físicamente calculados.

**V3 — ORIFICIO fallback usa y_base como cabeza hidráulica**
```typescript
q_orificio = cd_used * pzas * ancho * h_gate * √(2g × y_base)
// y_base = nivel aguas arriba (m sobre fondo), NO ΔH real
```
Para condición submerged (M1): `y_base = 3.42 m` → Q_capacidad = 306 m³/s (hipotético)  
Medición real sica-capture: Q = 22.95 m³/s  
Diferencia: **13×** el valor real

El fallback ORIFICIO sobreestima la capacidad de forma masiva. Como ancla esto es "seguro" (nunca limita el flujo proyectado), pero produce KPIs engañosos en la UI ("capacidad: 306 m³/s" cuando el canal pasa 23 m³/s).

**V4 — Factor de conducción sin base empírica calibrada**
```typescript
const conductionK = hasDelivData ? 0.00012 : 0.00038;
// Pérdida: 1 - 0.00012 × dist  (puramente estimada)
```
No existe calibración contra datos reales de pérdida por tramo. El `fn_balance_hidrico_tramos` existe en la BD pero los factores del simulador no se ajustan con ese resultado.

**V5 — Tomas abiertas sin dato de apertura real (brecha crítica — ver §5)**

**V6 — `simBaseMin` = hora actual al abrir pantalla, no hora de último movimiento**
```typescript
const [simBaseMin, setSimBaseMin] = useState(
  new Date().getHours() * 60 + new Date().getMinutes()
);
// Solo se actualiza si fetchData detecta un movimiento reciente
```
Si el operador abre la pantalla horas después del último movimiento de presa, `elapsedMin` es incorrecto y los tiempos de arribo estimados están desfasados.

---

### 4.2 Motor de Decisión — `generateDecisions()`

#### Reglas R1–R9 — Estado actual

| Regla | Función | Estado | Observación |
|-------|---------|--------|------------|
| R1 | Sin telemetría de presa | ✅ Funcional | Informativa, no bloquea |
| R2 | Nivel CRÍTICO (bordo libre) | ✅ Funcional | Umbral 75% bordo — correcto |
| R3 | Nivel ALERTA | ✅ Funcional | Monitoreo pasivo |
| R4 | Ajuste apertura compuerta | ⚠️ Corregido pero frágil | Depende de y_sim (V1) |
| R5 | Tendencia ascendente sin incremento | ✅ Funcional | Detecta obstrucción aguas abajo |
| R6 | Froude elevado | ✅ Funcional | Umbral Fr > 0.70 válido |
| R7 | Pérdida excesiva entre tramos | ⚠️ Incompleto | No conoce tomas abiertas (V5) |
| R8 | Corte total | ✅ Funcional | Ola negativa bien manejada |
| R9 | Sistema estable | ✅ Funcional | Fallback correcto |

#### Reglas ausentes (brechas lógicas)

| Regla faltante | Descripción | Impacto |
|---------------|-------------|---------|
| **R10** | Detección de gasto de presa inconsistente con Q en K-0 | Sin esta regla, el sistema no advierte cuando el canal no refleja el movimiento de presa (e.g., compuerta K-0 cerrada) |
| **R11** | Alerta por tomas abiertas sin reporte de caudal | Tomas abiertas sin `reportes_diarios` generan pérdida no contabilizada |
| **R12** | Verificación de coherencia nivel AM↔PM | Si nivel_pm < nivel_am con incremento, hay anomalía no detectada |
| **R13** | Alerta por tiempo de arribo vencido sin cambio de nivel | Si `wave_arrived=true` y nivel no cambió en ±0.05m, hay problema de compuerta |

---

### 4.3 Gestión de Datos de Entrada — Telemetría

```
9 queries paralelas en fetchData():
├── resumen_escalas_diario      ← nivel y gasto diario
├── lecturas_escalas (AM)       ← base hidráulica diurna
├── lecturas_escalas (reciente) ← estado actual
├── movimientos_presas (1º)     ← qBase
├── movimientos_presas (último) ← qDam
├── lecturas_presas             ← respaldo
├── reportes_diarios            ← extracción tomas (BRECHA: solo reportadas)
├── puntos_entrega (km)         ← geolocalización tomas
├── perfil_hidraulico_canal     ← geometría
└── fn_perfil_canal_completo    ← perfil GVF SQL
    fn_balance_hidrico_tramos   ← balance fugas
```

**Dato ausente:** Ninguna query carga el estado operativo de tomas (abiertas/cerradas en tiempo real). `reportes_diarios` solo existe cuando el técnico lo registra — durante el día, antes de los reportes, el campo está vacío.

---

## 5. BRECHAS CRÍTICAS DE DATOS — TOMAS ABIERTAS Y OTROS

### 5.1 Tomas y Laterales Sin Dato de Caudal (CRÍTICA)

**Situación actual:**
El simulador deduce extracción desde `reportes_diarios.caudal_promedio_m3s`. Este reporte se genera **al final del día** o cuando el técnico lo registra manualmente. Durante las horas operativas (6AM–12PM), el campo está típicamente vacío.

**Consecuencia hidráulica:**
- Si hay 15 tomas abiertas en el tramo K-0 a K-57 con Q total = 8 m³/s no reportado:
- El simulador propaga Q = 28 m³/s hasta K-57 sin descuento
- R7 puede no disparar (umbral 20%) si las pérdidas son graduales
- El nivel real en K-57 es mucho más bajo que el simulado
- Las recomendaciones de apertura/cierre de K-57 se basan en un caudal ficticio

**Cuantificación del error:**
```
Q_real_K57 = 28 - 8 (tomas) - pérdidas conducción ≈ 18.5 m³/s
Q_simulado_K57 = 28 × factor_conducción ≈ 26.8 m³/s
Error: +8.3 m³/s (+45%) en Q de referencia de K-57
```

### 5.2 Inventario de Brechas de Datos

| # | Dato faltante | Impacto en simulación | Fuente posible |
|---|--------------|----------------------|----------------|
| **D1** | Apertura real de tomas laterales (momentánea) | R7 no distingue extracción de infiltración | sica-capture + campo |
| **D2** | Estado operativo de compuertas radiales (abierta/cerrada) en tiempo real | R4 recomienda sin saber estado actual de la compuerta | SCADA / campo |
| **D3** | Nivel aguas abajo de cada compuerta (y_aguas_abajo) | ORIFICIO fallback asume descarga libre — error en submerged | Limnígrafo adicional |
| **D4** | Precipitación en cuenca intermedia K-0 a K-104 | Afluencias no contabilizadas (aportaciones laterales) | Estaciones climatológicas |
| **D5** | Temperatura del agua / evapotranspiración en canal | Pérdidas evaporativas no cuantificadas | No medido actualmente |
| **D6** | Caudal de retorno desde drenes de módulos | Aportes laterales que mejoran balance | Medidores en drenes |
| **D7** | Estado de mantenimiento / obstrucciones en tramos | Rugosidad real puede diferir de n=0.015 | Inspección periódica |
| **D8** | Batimetría actualizada de presas intermedias | Curvas H-V desactualizadas afectan cálculo de reserva | Levantamiento topográfico |

### 5.3 Impacto Compuesto de Brechas en Motor de Decisión

```
Escenario: INCREMENTO qDam = 28→35 m³/s, 10 tomas abiertas sin reporte

Sin datos D1, D2, D3:
  └─ runSimulation: Q llega a K-104 = 33.2 m³/s (error: real ≈ 24.5 m³/s)
  └─ R4: No detecta cuello de botella (Q_cap >> Q_sim sobreestimado)
  └─ R7: Pérdida K34-K57 = 0.8 m³/s (3%) → debajo del umbral 20%
  └─ Motor dice: SISTEMA ESTABLE
  └─ Realidad: 3 tomas sin agua, nivel en cola 1.8 m (insuficiente para servicio)
```

---

## 6. EVALUACIÓN DE COHERENCIA LÓGICA ENTRE CAPAS

### 6.1 Mapa de coherencia actual

```
COHERENCIA ENTRE CAPAS (post-corrección)

  AFORO (presente) ──────────────────────────────────────────────────►  y_base ✅
                    │                                                    q_base ✅
                    │ isDeltaSim=true → AFORO NO ancla en futuro ✅
                    ▼
  ORIFICIO (futuro) ──────────────────────────────────────────────────► q_gate_m3s ✅
                    │ usa y_base como H (no ΔH real) ⚠️               (sobreestima)
                    ▼
  runSimulation → y_sim ──────────────────────────────────────────────► MANNING ⚠️
                    │ no es GVF backwater — subestima y_sim real         (V1)
                    ▼
  generateDecisions → R4 ─────────────────────────────────────────────► cuelloBottella?
                    │ usa q_capacidad = Cd × area × √(2g × y_sim) ⚠️   (V1 propaga)
                    ▼
  UI apertura block ───────────────────────────────────────────────────► esSuficiente ✅
                    │ lógica correcta (INCREMENT no muestra CERRAR)
```

**Coherencia crítica verificada:**
- AFORO temporal no contamina escenario futuro ✅ (Fix 1)
- INCREMENT no emite CIERRE ✅ (Fix 2)
- Ancla ORIFICIO solo limita por capacidad física, no por Q presente ✅

**Incoherencias residuales:**
- y_sim Manning ≠ y_real M1 backwater → propaga error a R4 y bordo libre ⚠️
- q_extraido existe solo cuando `reportes_diarios` tiene datos del día ⚠️
- `simBaseMin` puede desincronizarse con la hora real del movimiento ⚠️

---

## 7. PROPUESTAS DE MEJORA

### DIMENSIÓN TÉCNICA

#### T1 — Perfiles GVF para y_sim (ALTA PRIORIDAD)
**Qué:** Reemplazar `normalDepth(Manning)` con resultado de `fn_perfil_canal_completo` para calcular y_sim bajo régimen de flujo gradualmente variado.  
**Cómo:** El RPC ya existe y devuelve perfil GVF. Interpolar `nivel_m` por km para cada punto de control.  
**Impacto:** Elimina V1 — y_sim pasa de Manning (~1.4m) a GVF (~3.4m), corrigiendo todas las evaluaciones derivadas.  
**Esfuerzo:** Medio (3–5 días)

#### T2 — ORIFICIO con ΔH real (MEDIA PRIORIDAD)
**Qué:** Leer `nivel_aguas_abajo` de la escala de aguas abajo en cada compuerta para calcular ΔH = y_arriba - y_abajo en lugar de usar y_base como descarga libre.  
**Cómo:** JOIN adicional en la query de lecturas_escalas filtrando por escala de la compuerta y escala de referencia aguas abajo.  
**Impacto:** El ORIFICIO fallback pasaría de ~306 m³/s (libre) a ~23 m³/s (submerged) — mucho más cercano al AFORO real.  
**Esfuerzo:** Medio (2–3 días) + configuración de pares de escalas

#### T3 — Calibración de `conductionK` contra balance real (MEDIA PRIORIDAD)
**Qué:** Usar resultado de `fn_balance_hidrico_tramos` para ajustar dinámicamente `conductionK` por tramo.  
**Cómo:** Cargar `balanceTramos` (ya existe en estado) y mapear pérdida real a coeficiente de conducción por tramo.  
**Impacto:** Elimina V4 — pérdidas de conducción basadas en datos reales, no constantes arbitrarias.  
**Esfuerzo:** Bajo (1–2 días)

#### T4 — Corrección de `simBaseMin` (BAJA PRIORIDAD)
**Qué:** Al cargar `lastMovPresa`, extraer la hora exacta y calcular `simBaseMin` desde `fecha_hora` del movimiento.  
**Cómo:** `setSimBaseMin(parseHHMM(lastMovPresa.fecha_hora))` en fetchData.  
**Impacto:** Elimina V6 — tiempos de arribo correctos independiente de cuándo se abre la pantalla.  
**Esfuerzo:** Bajo (<1 día)

#### T5 — Regla R10: Coherencia Q presa ↔ Q K-0 (ALTA PRIORIDAD)
**Qué:** Si |Q_presa - gasto_calculado_K0| > 5 m³/s por más de 2 horas, alertar al operador.  
**Cómo:** Comparar `dataStatus.damCurrentValue` con `gastoMedido[k0]` en generateDecisions.  
**Impacto:** Detecta compuerta K-0 parcialmente cerrada sin reportar, daños estructurales, o error de datos.  
**Esfuerzo:** Bajo (<1 día)

#### T6 — Regla R11: Tomas sin reporte activo (ALTA PRIORIDAD)
**Qué:** Si `puntos_entrega.km` existe en tramo y `reportes_diarios` no tiene registro del día, emitir alerta en R7.  
**Cómo:** Cruzar lista de puntos_entrega activos contra reportes_diarios cargados; identificar tomas sin cobertura.  
**Impacto:** Elimina el escenario donde 10 tomas abiertas son invisibles para el simulador.  
**Esfuerzo:** Bajo (1 día)

#### T7 — Campo `estado_operativo` en tomas (ALTA PRIORIDAD — requiere captura de campo)
**Qué:** Agregar a `reportes_diarios` o `aforos_control` un campo `estado_actual: 'ABIERTA' | 'CERRADA' | 'PARCIAL'` con hora de registro.  
**Cómo:** Extensión de sica-capture con módulo de estado de toma; o formulario web simplificado.  
**Impacto:** Alimenta R11 y permite que runSimulation deduzca q_extraido incluso sin reporte de caudal.  
**Esfuerzo:** Alto (1–2 semanas, incluye sica-capture)

#### T8 — Manning variable calibrado por tramo (MEDIA PRIORIDAD)
**Qué:** `perfil_hidraulico_canal.rugosidad_n` ya existe por tramo. Verificar que los valores son calibrados (no todos 0.015).  
**Cómo:** Auditoría de la tabla; actualizar con valores medidos o estimados por condición del canal.  
**Impacto:** Mejora precisión de y_n Manning como estado de referencia.  
**Esfuerzo:** Bajo (técnico), Medio (campo — requiere aforos calibración)

---

### DIMENSIÓN ADMINISTRATIVA

#### A1 — Protocolo de Reporte Mínimo en Tiempo Real (URGENTE)
**Situación:** Los `reportes_diarios` se generan al final del día. Durante las horas operativas, el simulador no tiene datos de extracción.  
**Propuesta:** Establecer protocolo de **reporte parcial a las 8AM y 12PM** con estado de tomas activas. No requiere dato exacto de caudal — solo estado ABIERTA/CERRADA + estimado de apertura.  
**Responsable:** Jefatura de operación de módulos  
**Formato mínimo:** ID toma · Estado · Apertura estimada (m) · Hora  
**Impacto:** Reduce el error de Q_extraido de potencialmente 45% a menos del 15%.

#### A2 — Verificación de `escalas.ancho` — ¿Por pieza o total?
**Situación:** El trigger SQL `fn_trg_calcular_gasto_escala` usa `n_pzas=1` asumiendo que `escalas.ancho` es el ancho total de la estructura. La edge function `hydric-chat` lo trata como ancho por pieza.  
**Propuesta:** Ejecutar query de auditoría (ver informe de ratificación), documentar la convención y estandarizar.  
**Si ancho = por pieza:** Corregir trigger SQL agregando `COALESCE(v_esc.pzas_radiales, 1)` como n_pzas.  
**Impacto:** Si hay bug, `gasto_calculado_m3s` auto-calculado (trigger) es 1/4 del real en K-0, 1/3 en K-23.

#### A3 — Definición de Umbrales Operativos por Estructura
**Situación:** Los límites operativos `yMin=2.80m, yMax=3.50m` son globales para K-0 a K-80. Diferente capacidad de servicio de tomas laterales por km no está diferenciada.  
**Propuesta:** Recabar de cada módulo los tirantes mínimos de servicio → actualizar `getOpLimits()` con valores reales por km.  
**Responsable:** Ingeniería hidráulica + jefaturas de módulo.  
**Esfuerzo:** Bajo (técnico), Medio (coordinación)

#### A4 — Validación Periódica del Modelo de Onda
**Situación:** El modelo de propagación (`v_onda = 5.3 × Q^0.15 km/h`) fue calibrado empíricamente con datos de K-0 a K-23. No está validado para K-23 a K-104.  
**Propuesta:** Registrar en una tabla `calibracion_onda` los tiempos de arribo observados (SICA) vs estimados, y ajustar el modelo mensualmente.  
**Esfuerzo:** Bajo (automatizable con una vista SQL)

#### A5 — Catálogo de Coeficientes de Descarga por Estructura
**Situación:** `coeficiente_descarga` en `escalas` existe como campo pero la mayoría de estructuras usa el global 0.70.  
**Propuesta:** Levantamiento hidráulico de cada estructura para determinar Cd real mediante aforos calibrados. Para estructuras antiguas, usar Cd = 0.62 (USBR) como conservador.  
**Esfuerzo:** Medio (requiere campañas de aforo)

---

### DIMENSIÓN VISUAL / INTERFAZ

#### V1 — Indicador de Confianza del Escenario
**Qué:** Mostrar en la cabecera del panel un semáforo de calidad de datos:
```
Datos: [■■■□□] 3/5  ←  qué fuentes están activas
  ✅ Movimientos presa   ✅ Niveles SICA   ✅ Geometría
  ⚠️  Tomas (0/12 reportadas)   ❌ Niveles aguas abajo compuertas
```
**Impacto:** El operador sabe inmediatamente qué tan confiable es la simulación antes de tomar decisiones.

#### V2 — Diferenciación Visual de Q Medido vs Q Simulado
**Situación:** La gráfica de perfil longitudinal muestra Q simulado como línea continua. Si las tomas no reportadas consumen 8 m³/s, el Q real en cada km es diferente.  
**Propuesta:** Agregar banda de incertidumbre al Q simulado: `[Q_sim - q_tomas_no_reportadas, Q_sim]`.  
**Cómo:** Calcular `q_tomas_sin_dato` como suma de capacidades de tomas activas sin reporte del día.

#### V3 — Timeline de Maniobras Recomendadas
**Qué:** Panel horizontal de línea de tiempo con las maniobras del Motor de Decisión ordenadas por hora de llegada de onda, no por prioridad de regla.
```
06:00   07:30        09:15      11:00
  |──────|────────────|──────────|
  ↑K-0   ↑K-23        ↑K-34     ↑K-57
  Presa  ABRIR K-23   VERIFICAR  CERRAR K-57
         (onda llega) nivel
```
**Impacto:** El operador tiene un plan de acción secuencial, no una lista de alertas.

#### V4 — Indicador de Apertura Efectiva por Compuerta
**Situación:** La UI muestra `apertura: 1.11 m` (una pieza). El operador no distingue si está viendo una o todas.  
**Propuesta:**
```
Apertura K-0+000
  Pieza 1: 1.11 m  Pieza 2: 1.05 m
  Pieza 3: 1.08 m  Pieza 4: 1.13 m
  ─────────────────────────────────
  Total efectivo: 4.37 m  |  Q = 22.95 m³/s
```
Fuente: `radiales_json` de lecturas_escalas más reciente.

#### V5 — Estado de Tomas en Mapa del Canal
**Qué:** En la visualización longitudinal del canal, marcar con íconos:
- 🟢 Toma abierta + reporte de caudal
- 🟡 Toma abierta sin reporte (estimado)
- 🔴 Toma sin dato de estado
- ⚫ Toma cerrada
**Impacto:** El operador identifica inmediatamente dónde hay brechas de información.

#### V6 — Modo "Solo Decisiones Urgentes"
**Qué:** Vista simplificada para operador de turno que muestre solo las acciones pendientes con cuenta regresiva.
```
┌─────────────────────────────────────────────────┐
│  ⚠️ ACCIÓN REQUERIDA — K-23 Derivadora          │
│  ABRIR 0.3 m compuerta radial                   │
│  Ola llega en: 01:45 h  (08:32 a.m.)            │
│  [CONFIRMAR MANIOBRA]  [VER DETALLE]            │
└─────────────────────────────────────────────────┘
```

---

## 8. HOJA DE RUTA — PRIORIZACIÓN

### Fase 1 — Correcciones críticas de coherencia (1–2 semanas)

| ID | Acción | Esfuerzo | Impacto |
|----|--------|----------|---------|
| T4 | Corregir simBaseMin desde fecha_hora del movimiento | <1 día | Tiempos correctos |
| T5 | Regla R10: coherencia Q presa ↔ Q K-0 | <1 día | Detecta compuerta cerrada |
| T6 | Regla R11: tomas sin reporte activo | 1 día | Alerta brecha D1 |
| A2 | Auditoría escalas.ancho y corrección trigger SQL | 1 día | Integridad de gasto_calculado |
| T3 | conductionK desde balance real | 1–2 días | Pérdidas calibradas |

### Fase 2 — Mejoras de modelo (1 mes)

| ID | Acción | Esfuerzo | Impacto |
|----|--------|----------|---------|
| T1 | y_sim desde GVF (fn_perfil_canal_completo) | 3–5 días | Elimina error Manning M1 |
| T2 | ORIFICIO con ΔH real | 2–3 días | Capacidad realista |
| V1 | Indicador de confianza de datos | 1 día | Transparencia operativa |
| V3 | Timeline de maniobras | 2 días | UX operativo |
| A3 | Umbrales por sección desde módulos | Coordinación | Precisión de alertas |

### Fase 3 — Datos de campo (2–3 meses)

| ID | Acción | Esfuerzo | Impacto |
|----|--------|----------|---------|
| T7 | Estado operativo tomas en sica-capture | 1–2 semanas | Elimina D1 (crítico) |
| A1 | Protocolo reporte parcial 8AM/12PM | Administrativo | -30% error Q extraído |
| A4 | Validación modelo de onda K-23 a K-104 | Campaña | Tiempos de arribo reales |
| A5 | Catálogo Cd por estructura | Aforos calibración | Cálculos más precisos |
| V4 | Desglose apertura por pieza desde radiales_json | 2 días | Claridad operativa |
| D3 | Limnígrafo aguas abajo en compuertas principales | Infraestructura | Habilita T2 |

---

## 9. MÉTRICAS DE ÉXITO PROPUESTAS

Una vez implementadas las mejoras, el sistema debe cumplir:

| Métrica | Estado actual | Meta Fase 1 | Meta Fase 2 |
|---------|--------------|-------------|-------------|
| Error en Q por tramo (vs balance real) | ±45% (sin tomas) | ±20% | ±8% |
| Error en y_sim vs y_real | 59% (Manning vs M1) | 59% | <10% (GVF) |
| Cobertura de tomas con estado operativo | 0–20% en horario | 50% | 90% |
| Tiempo de acierto motor de decisión | No medido | Línea base | >80% |
| Detección de compuerta sin movimiento | No existe | R10 activo | Validado |

---

## 10. CONCLUSIÓN

La Plataforma de Modelación Hidráulica tiene una arquitectura correcta y un núcleo funcional bien separado por capas. Las correcciones implementadas en este ciclo (Fix 1 — isDeltaSim, Fix 2 — R4 bifurcado) eliminaron los errores más críticos de coherencia lógica.

Las brechas principales que limitan la utilidad operativa real son:

1. **Modelo hidráulico Manning vs realidad M1** — el canal no opera en flujo uniforme; los niveles calculados difieren hasta 60% del real.
2. **Invisibilidad de tomas abiertas** — sin dato de extracción en tiempo real, el simulador propaga caudal que ya no existe en el canal.
3. **ORIFICIO sin cabeza diferencial** — la capacidad de compuerta sobreestimada 13× no es útil para comparar con el flujo real.

El camino crítico para pasar de un sistema de referencia a un sistema de apoyo a decisiones operativo real es **T1 (GVF)** y **T7 (estado tomas)** — ambos en Fase 1/2. Sin estos, las decisiones del motor operan sobre una representación del canal que difiere significativamente de la realidad.

---

*Evaluación Técnica Integral — Conchos Digital v2.7.x · 2026-04-14*  
*Próxima revisión recomendada: post-Fase 1 (30 días)*
