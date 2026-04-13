# Manual de Usuario — Monitor Hidráulico SICA 005
## Conchos Digital v2.7.0

**Sistema de Integridad y Control de Agua — Distrito de Riego 005**
**Fecha de emisión: 12 de abril de 2026**

---

## Contenido

1. [Introducción y arquitectura del sistema](#1-introducción)
2. [Monitor Público — Vista de Mapa](#2-monitor-público)
3. [Panel de Estabilización (Dock)](#3-panel-de-estabilización)
4. [Índice de Estado del Canal (IEC)](#4-índice-de-estado-del-canal-iec)
5. [Perfil Hidráulico Longitudinal (FGV)](#5-perfil-hidráulico-longitudinal-fgv)
6. [Evento de Llenado — Modo Transit](#6-evento-de-llenado)
7. [Dashboard de Modelación Hidráulica](#7-dashboard-de-modelación)
8. [Registro de Movimientos de Presa](#8-registro-de-movimientos-de-presa)
9. [Tipos de Evento y Simulación](#9-tipos-de-evento-y-simulación)
10. [Motor de Decisión Automático](#10-motor-de-decisión-automático)
11. [Exportación de Datos (PDF y CSV)](#11-exportación-de-datos)
12. [Estados de Telemetría](#12-estados-de-telemetría)
13. [Glosario de Términos Hidráulicos](#13-glosario)

---

## 1. Introducción

### 1.1 ¿Qué es el Monitor Hidráulico?

El Monitor Hidráulico de Conchos Digital es el núcleo operativo del SICA 005. Integra dos módulos principales:

- **Monitor Público** (`/monitor`) — visualización geográfica en tiempo real del estado del canal, frente de agua, escalas y represas.
- **Dashboard de Modelación** (`/modeling`) — simulación hidráulica completa para planificación de maniobras antes de ejecutarlas.

### 1.2 Flujo de datos

```
Presa Boquilla (PLB)
       │
       │ 36 km río (tránsito ~12 h)
       │
    K-0+000  →  K-23  →  K-34  →  K-57  →  K-80  →  K-104
    (Toma)     (Der.)   (Comp)   (S3)     (S4)    (Final)
```

Los datos llegan a la plataforma por dos vías:
- **SICA Capture** (app de campo) — lecturas de escala AM/PM, apertura de compuertas, gasto calculado.
- **Movimientos de presa** — registros manuales o automáticos desde la página de Presas.

El sistema actualiza en tiempo real vía **Supabase Realtime** y tiene un respaldo de polling cada 5 minutos.

### 1.3 Modos de operación

| Modo | Condición | Descripción |
|------|-----------|-------------|
| **LLENADO** | Evento activo tipo LLENADO | Frente de agua avanzando en río y canal |
| **ESTABILIZACIÓN** | Sin evento LLENADO activo | Canal en operación continua, escalas monitoreadas |
| **OPERACIÓN NORMAL** | Sin ningún evento activo | Estado de monitoreo base |

---

## 2. Monitor Público

### 2.1 Acceso

Ruta: `/monitor`
Acceso público — no requiere inicio de sesión.

### 2.2 Elementos del mapa

**Encabezado flotante (barra superior):**

| Campo | Descripción |
|-------|-------------|
| `ESTADO:` | Modo actual del sistema (LLENADO / ESTABILIZACIÓN) |
| `PRESA:` | Gasto actual liberado por Presa Boquilla en m³/s |
| `TOMA KM 0:` | Gasto medido en la Toma Principal (K-0+000) en m³/s |
| Ícono de actividad | Regresa al sistema completo (autenticado) |
| Versión | Versión actual del software |

Si el gasto en TOMA KM 0 supera 70.42 m³/s (capacidad de diseño), aparece una **Bandera de Violación Hidráulica** roja con descripción del riesgo de desbordamiento.

### 2.3 Líneas en el mapa

**Modo LLENADO:**
- **Línea gris** — trayectoria completa (río + canal), de Boquilla a K-104.
- **Línea cyan/azul brillante** — porción hidratada (donde ya llegó el agua).
- **Marcador de pulso** — posición actual del frente de agua (estimado + telemetría).

**Modo ESTABILIZACIÓN:**
- El canal se divide en **segmentos coloreados** según el estado de la escala aguas abajo:
  - Azul cielo (`#38bdf8`) — nivel normal (< 80% del nivel máximo operativo).
  - Naranja (`#f59e0b`) — nivel en alerta (80–92% del nivel máximo).
  - Rojo (`#ef4444`) — nivel crítico (≥ 92% del nivel máximo) o escala incoherente.
  - Gris (`#475569`) — sin datos de telemetría.

### 2.4 Marcadores de escala (puntos de control)

Al hacer clic en un marcador circular en el mapa se abre una **tarjeta de checkpoint** con:

| Dato | Descripción |
|------|-------------|
| Nombre | Nombre de la escala |
| KM | Kilómetro del canal |
| Nivel | Nivel del agua en metros (último reporte) |
| % Bordo | Porcentaje respecto al nivel máximo operativo |
| Gasto | Gasto calculado o medido en m³/s |
| Apertura | Apertura de compuertas radiales en metros |
| Δ 12h | Tendencia de nivel en las últimas 12 horas (▲ sube / ▼ baja) |
| Señal | Estado de telemetría con color y tiempo transcurrido |
| Última lectura | Hace cuántos minutos/horas fue el último dato |

---

## 3. Panel de Estabilización (Dock)

### 3.1 Apertura y cierre

El **dock** es el panel lateral-inferior que muestra el estado completo del canal en modo ESTABILIZACIÓN. Se activa automáticamente en escritorio y debe abrirse manualmente en móvil.

- Botón de apertura: esquina inferior derecha del mapa (ícono `≡` o `Waves`).
- Botón de cierre: `×` en la esquina del dock.

### 3.2 Secciones del dock

#### 3.2.1 Encabezado del dock

Muestra el estado del sistema, el gasto de la presa y el IEC global (ver sección 4).

#### 3.2.2 Perfil longitudinal del canal

Gráfica SVG horizontal que representa el **nivel del agua en cada escala** a lo largo del canal (KM 0 a KM 104):

- **Eje Y:** nivel del tirante en metros (rango 1.5 m – 4.4 m).
- **Eje X:** kilómetro del canal.
- **Zonas coloreadas:**
  - Rojo tenue (> 3.5 m) — zona crítica.
  - Naranja tenue (3.2–3.5 m) — zona de alerta.
  - Verde tenue (2.8–3.2 m) — zona operativa óptima.
  - Azul tenue (< 2.8 m) — nivel bajo.
- **Puntos de escala:** círculos coloreados con el nivel exacto y símbolo de tendencia.
- **Línea FGV (amarilla punteada):** superficie libre calculada por el Motor de Flujo Gradualmente Variado (ver sección 5).

#### 3.2.3 Tabla de escalas

Lista completa de todas las escalas ordenadas por kilómetro, con columnas:

| Columna | Descripción |
|---------|-------------|
| ESCALA | Nombre de la escala |
| KM | Kilómetro |
| NIVEL | Nivel actual del agua (m) |
| % BORDO | Porcentaje de ocupación del bordo |
| GASTO | Gasto actual medido o calculado (m³/s) |
| APERTURA | Apertura de compuertas (m) |
| Δ 12H | Tendencia de nivel últimas 12 horas |
| ESTADO | Señal de telemetría (ver sección 12) |

Filas con fondo rojo: escalas en estado CRÍTICO.
Filas con fondo naranja: escalas en estado ALERTA.

#### 3.2.4 Botones de acción

Al pie del dock (sección ESTABILIZACIÓN):

| Botón | Acción |
|-------|--------|
| **Ver Perfil Hidráulico** | Abre el modal de perfil FGV completo |
| **Reporte PDF** | Genera y descarga el informe gerencial en PDF |
| **Exportar CSV** | Descarga tabla de escalas en formato CSV |

---

## 4. Índice de Estado del Canal (IEC)

### 4.1 Definición

El **IEC** es un índice 0–100 que resume la salud hidráulica del canal en ESTABILIZACIÓN. Se calcula automáticamente a partir de 4 componentes:

| Componente | Peso | Descripción |
|------------|------|-------------|
| **Eficiencia** | 30 pts | % del gasto que llega de K-0 a K-104 |
| **Coherencia** | 25 pts | % de escalas con gasto consistente (±15% entre tramos) |
| **Fugas** | 25 pts | Penalización por pérdidas detectadas entre tramos |
| **Críticos** | 20 pts | Penalización por escalas con nivel ≥ 92% del bordo |

### 4.2 Semáforo

| Rango | Semáforo | Color |
|-------|----------|-------|
| 75–100 | VERDE | `#16a34a` |
| 50–74 | AMARILLO | `#d97706` |
| 0–49 | ROJO | `#dc2626` |

### 4.3 Lectura del IEC en el dock

En el encabezado del dock ESTABILIZACIÓN aparece:

```
IEC  [82] / 100
VERDE ████████░░
```

Debajo del número global, se muestran **4 barras de componentes**:

- `EFICIENCIA` — barra hasta el % de los 30 puntos alcanzados.
- `COHERENCIA` — barra hasta el % de los 25 puntos.
- `FUGAS` — barra hasta el % de los 25 puntos.
- `CRÍTICOS` — barra hasta el % de los 20 puntos.

### 4.4 Historial IEC (Sparkline)

Debajo de la barra de componentes se muestra una minigráfica de los últimos **30 días** de IEC. Los datos se almacenan automáticamente en el navegador (localStorage) una vez por día.

---

## 5. Perfil Hidráulico Longitudinal (FGV)

### 5.1 ¿Qué es el FGV?

El **Flujo Gradualmente Variado (FGV)** calcula la superficie libre del agua en cada kilómetro del canal usando el Método del Paso Estándar (Standard Step), considerando:

- Geometría real del canal (plantilla, talud, rugosidad Manning) por tramo desde la base de datos `perfil_hidraulico_canal`.
- Gasto medido en K-0 como condición de frontera aguas arriba.
- Tomas activas (extracciones) a lo largo del canal como fuentes de flujo espacialmente variado.

### 5.2 Cómo abrir el perfil

1. En el dock ESTABILIZACIÓN, hacer clic en **"Ver Perfil Hidráulico"**.
2. Se muestra el modal de perfil con la línea FGV superpuesta al perfil de escalas.
3. El cálculo se realiza automáticamente al abrir — se muestra "Calculando perfil FGV…" mientras carga.

### 5.3 Interpretación del perfil

**Línea amarilla punteada** — superficie libre FGV (resultado del cálculo hidráulico).
**Puntos de escala** — lecturas reales de campo (puntos de validación).

Si la línea FGV se aleja de los puntos de escala → indica discrepancias entre el modelo y la realidad (posible obstrucción, toma no reportada, o error de lectura).

### 5.4 Tipos de remanso (régimen del flujo)

| Tipo | Símbolo | Condición | Significado |
|------|---------|-----------|-------------|
| M1 | Remanso positivo | `Δy > 8 cm` | Nivel sube aguas abajo (represado) |
| M2 | Remanso negativo | `Δy < −8 cm` | Nivel baja aguas abajo (escurrimiento acelerado) |
| NORMAL | Flujo uniforme | `|Δy| ≤ 8 cm` | Tirante normal de Manning |

### 5.5 Salto Hidráulico

Cuando el perfil FGV transita de M2 → M1 en tramos consecutivos, el sistema detecta un **Salto Hidráulico** y lo marca con una línea vertical naranja con etiqueta `SALTO`. Este fenómeno indica disipación violenta de energía y puede dañar el revestimiento del canal.

### 5.6 Alertas en el perfil

- **Punto naranja** — tramo en alerta (75–92% del bordo libre según FGV).
- **Punto rojo** — tramo crítico (≥ 92% del bordo libre según FGV).

---

## 6. Evento de Llenado

### 6.1 ¿Cuándo aplica?

El modo LLENADO se activa cuando existe un **evento activo** de tipo `LLENADO` en el sistema (registrado por el módulo de Eventos Hídricos). Este modo monitorea el avance del frente de agua desde Presa Boquilla hasta el km 104 del canal.

### 6.2 Panel de Análisis de Tránsito

Para abrirlo, hacer clic en el botón de tránsito en el mapa (visible solo en modo LLENADO).

El panel muestra:

| Campo | Descripción |
|-------|-------------|
| REPORTE DE CAMPO | Último kilómetro confirmado por SICA Capture y hora de confirmación |
| TIEMPO TRANSCURRIDO | Tiempo desde el último ancla de confirmación |
| SIGUIENTE CONTROL | Próxima escala que recibirá el frente de agua |
| DISTANCIA RESTANTE | Kilómetros al siguiente control |
| LLEGADA ESTIMADA | Hora estimada de llegada al siguiente control |

### 6.3 Lógica de avance del frente de agua

El sistema combina dos fuentes para determinar la posición del frente:

**Fuente 1 — Telemetría confirmada (Realidad):**
- Lecturas de escala con nivel > 0 registradas en SICA Capture.
- Reportes de llenado del tracker (`sica_llenado_seguimiento`).

**Fuente 2 — Modelo de propagación (Predicción):**
- Río (Boquilla → K-0): velocidad 3.0 km/h.
- Canal (K-0 → K-104): velocidad 6.0 km/h durante LLENADO.
- Fórmula: `posición = km_ancla + v × tiempo_transcurrido`

El sistema usa la posición **mayor** entre ambas fuentes. El frente nunca puede adelantar a una escala que reporta nivel 0 con telemetría viva.

### 6.4 Espera en KM 0 (Bloqueo Físico)

Si el frente estimado alcanza K-0 pero **no hay apertura de compuertas radiales** reportada en SICA Capture, el sistema muestra una alerta de espera:

```
LLENADO DE RÍO: KM 0+000
Nivel detectado. Esperando reporte de APERTURA DE RADIALES
en SICA Capture para iniciar canal.
```

El frente no avanza en el canal hasta confirmar apertura física en K-0.

### 6.5 Balance Hidráulico durante Llenado

El panel de tránsito incluye una sección de **balance hidráulico técnico**:

| Dato | Descripción |
|------|-------------|
| Gasto Presa (fuente) | Q liberado por Boquilla en m³/s |
| Toma KM 0 (medido) | Q confirmado en K-0 desde SICA Capture |
| Pérdida río (calculada) | Pérdida estimada en los 36 km de río |
| Eficiencia tránsito | % del gasto de presa que llega a K-0 |

---

## 7. Dashboard de Modelación Hidráulica

### 7.1 Acceso

Ruta: `/modeling`
Requiere autenticación como usuario del sistema.

### 7.2 Descripción general

El Dashboard de Modelación permite simular **qué pasará en el canal** cuando se modifique el gasto de la presa, antes de ejecutar la maniobra. Es la herramienta de planificación operativa.

Carga automáticamente:
- Telemetría de movimientos de presa del día (base hidráulica).
- Lecturas AM/PM por escala (niveles base reales).
- Aperturas reales de compuertas desde SICA Capture.
- Puntos de entrega activos con volúmenes del día.
- Geometría real del canal (`perfil_hidraulico_canal`).

### 7.3 Controles superiores

#### 7.3.1 Selector de tipo de evento

```
[INCREMENTO]  [DECREMENTO]  [CORTE]  [LLENADO]
```

Determina qué tipo de maniobra se va a simular (ver sección 9 para detalle).

#### 7.3.2 Control deslizante de gasto (Q Presa)

El control más importante del simulador. Ajusta el gasto de la presa para la simulación.

```
Q Presa:  [========●=======]  34.5 m³/s
           Base: 28.2 m³/s
```

- **Base (Q₀):** gasto del primer movimiento de presa del día = estado inicial del canal.
- **Simulado (Q):** gasto que se quiere probar.
- **Δ Q:** diferencia = `Q simulado − Q base` (verde si es incremento, rojo si es decremento).

Rango válido: 0 – 100 m³/s.

#### 7.3.3 Tránsito por río (toggle)

```
[○] Incluir tránsito por río (36 km ~ 12 h)
```

Cuando se activa:
- Se añaden los tiempos de tránsito del río antes de K-0.
- Velocidad del río: `v = 0.5 × Q^0.4 + 0.5` (m/s), calibrada con datos históricos.
- Útil cuando la presa acaba de liberar y el agua aún no ha llegado al canal.

#### 7.3.4 Hora base (T₀)

```
Hora base maniobra: [07:30]
```

Hora del último movimiento de presa registrado. Determina el punto de partida de todos los tiempos de tránsito. Se llena automáticamente con el dato real. Puede ajustarse manualmente para simular maniobras futuras.

### 7.4 Indicadores de fuente de datos

Panel de estado que muestra qué tan confiable es la simulación:

| Indicador | Verde | Amarillo/Gris |
|-----------|-------|---------------|
| PRESA | Movimientos de presa del día disponibles | Sin datos de presa — usando estimados |
| COMPUERTAS | Aperturas reales de SICA Capture | Sin aperturas reales |
| NIVELES | Lecturas AM/PM del día disponibles | Sin lecturas del día |
| ENTREGAS | Reportes diarios de tomas disponibles | Sin datos de puntos de entrega |

### 7.5 IEC Simulado (sim-kpi)

En la barra de KPIs superior del simulador, el **IEC Simulado** muestra cómo quedaría el índice de estado del canal con el nuevo gasto:

- Número grande coloreado por semáforo.
- 4 mini-barras de componentes (eficiencia, coherencia, fugas, críticos).
- Se recalcula en tiempo real al mover el deslizador.

---

## 8. Registro de Movimientos de Presa

### 8.1 Acceso

Ruta: `/presas`
La sección de registro se encuentra dentro de la página de cada presa, botón **"Nueva Orden de Operación"**.

### 8.2 ¿Qué es un movimiento de presa?

Un **movimiento de presa** es el registro oficial de un cambio en el gasto liberado por una obra de toma (Presa Boquilla u otra). Es la fuente de verdad que alimenta al Monitor Hidráulico y al simulador.

Cuando se registra un movimiento:
1. Se guarda en la tabla `movimientos_presas` con trazabilidad completa.
2. El Monitor Hidráulico lo detecta por Realtime y actualiza la simulación.
3. El gasto del **primer** movimiento del día se convierte en la **base hidráulica (Q₀)**.
4. El gasto del **último** movimiento del día es el **estado actual (Q actual)**.

### 8.3 Modal de Registro de Movimiento

Al abrir el modal, se presenta:

#### Paso 1 — Tipo de Movimiento

Seleccionar uno de los 5 tipos disponibles:

| Tipo | Ícono | Descripción | Gasto |
|------|-------|-------------|-------|
| **INCREMENTO** | ↑ | Aumenta el gasto liberado | Positivo > 0 |
| **DECREMENTO** | ↓ | Reduce el gasto liberado | Positivo > 0 |
| **CORTE** | ✕ | Cierre total de la obra | Se registra como 0.00 m³/s |
| **APERTURA** | ⊙ | Apertura inicial de la obra (primer gasto del día) | Positivo > 0 |
| **AJUSTE** | ≈ | Ajuste operativo menor (corrección) | Positivo > 0 |

**Importante:** Solo se puede registrar gasto = 0 cuando el tipo es CORTE. Para cualquier otro tipo, el gasto debe ser > 0.

#### Paso 2 — Gasto Liberado (Q)

- Ingresar el gasto en **m³/s** con hasta 2 decimales.
- Rango permitido: 0.01 – 100.00 m³/s.
- Se muestra una barra de progreso proporcional al gasto máximo (100 m³/s).
- Si el tipo es CORTE, el campo se bloquea y muestra "0.00" automáticamente.

#### Paso 3 — Fecha y Hora Efectiva

- Por defecto se prelena con la fecha y hora actuales del sistema.
- **Se puede modificar** para registrar un movimiento que ya ocurrió en el campo pero no fue capturado a tiempo.
- Formato: `YYYY-MM-DDTHH:MM` (selector datetime-local).

> **Regla de trazabilidad:** La fecha/hora registrada debe corresponder al momento real en que el operador realizó la maniobra en campo, no a la hora de captura en el sistema.

#### Paso 4 — Responsable

- Campo de texto libre.
- **Requerido** — el sistema rechaza registros sin nombre de responsable.
- Se concatena al campo `notas` con el formato: `[TIPO] Nombre — observaciones`.

#### Paso 5 — Notas adicionales (opcional)

- Observaciones, incidencias o contexto de la maniobra.
- Se añaden automáticamente a las notas del registro.

#### Botón de envío

```
[Guardar Movimiento →]
```

Al guardar:
1. Se validan todos los campos.
2. Se inserta en `movimientos_presas` con `fuente_dato = 'GERENCIA_ADMIN'`.
3. El Monitor Público y el Simulador se actualizan automáticamente (Realtime).
4. Se cierra el modal y se resetean los campos.

### 8.4 Errores comunes al registrar

| Error | Causa | Solución |
|-------|-------|----------|
| "Ingresa un gasto válido (≥ 0)" | Campo vacío o texto no numérico | Ingresar número válido |
| "El gasto no puede superar 100 m³/s" | Gasto fuera del rango de la obra | Verificar el valor con el operador |
| "Gasto 0 solo aplica para CORTE" | Se intentó poner 0 sin seleccionar CORTE | Cambiar tipo a CORTE |
| "El nombre del responsable es requerido" | Campo responsable vacío | Ingresar nombre |
| "Error al registrar. Intenta nuevamente." | Error de red o permisos | Verificar conexión y reintentar |

### 8.5 Historial de movimientos

Debajo del botón de registro, la página de Presas muestra:

- **Streamgraph de 48 horas** — gráfica de área que muestra la evolución del gasto en intervalos de 2 horas durante los últimos 2 días.
- **Color del gráfico** según la fuente del último movimiento:
  - Naranja: `GERENCIA_ADMIN` (captura manual desde el sistema).
  - Verde: `CAMPO` (dato de campo vía SICA Capture).
  - Azul: `AUTOMATICO` (dato automático de sensores).

---

## 9. Tipos de Evento y Simulación

### 9.1 INCREMENTO

**Cuándo usar:** La presa va a aumentar su gasto liberado.

**Efecto en la simulación:**
- El nivel del agua sube en todos los puntos de control (M1: remanso positivo).
- Los puntos con mayor restricción (compuertas más cerradas) muestran mayor incremento.
- Si el nivel simulado supera el 92% del bordo libre → estado CRÍTICO.

**Recomendación operativa generada:**
- Si hay puntos CRÍTICOS → el sistema sugiere `REDUCIR gasto o ABRIR compuertas` en esos puntos.
- Si se requieren ajustes de apertura → `ABRIR radiales` con la cantidad exacta de metros.

**Secuencia de operación recomendada:**
1. Abrir el simulador en `/modeling`.
2. Cambiar tipo de evento a INCREMENTO.
3. Mover el deslizador al Q objetivo.
4. Revisar el estado de cada punto de control (ESTABLE / ALERTA / CRÍTICO).
5. Leer las **Decisiones del Motor** (sección inferior).
6. Ejecutar las maniobras de apertura en campo **antes** de que llegue el frente de onda.
7. Registrar el movimiento de presa en `/presas`.

### 9.2 DECREMENTO

**Cuándo usar:** La presa va a reducir su gasto liberado (ola negativa).

**Efecto en la simulación:**
- El nivel del agua baja en todos los puntos de control (M2: remanso negativo).
- Si el nivel cae más del 10% del nivel actual (`piso de servicio`) → estado ALERTA.
- Las tomas aguas abajo pueden quedar sin carga hidráulica suficiente.

**Recomendación operativa generada:**
- `CERRAR radiales` en puntos donde el nivel simula caer bajo el mínimo operativo (2.80 m).
- `Vigilar escala` en puntos con tendencia descendente de 12h sin causa aparente.

**Secuencia de operación recomendada:**
1. Verificar que las tomas aguas abajo tengan suficiente reserva (nivel > 2.80 m).
2. Simular el decremento y revisar puntos en ALERTA.
3. Preparar operadores en campo para cierre gradual de tomas si el nivel cae.
4. Registrar el movimiento en `/presas`.

### 9.3 CORTE

**Cuándo usar:** La presa va a cerrar completamente (Q = 0).

**Efecto en la simulación:**
- El sistema genera automáticamente una alerta URGENTE al inicio de las decisiones:
  ```
  CORTE TOTAL — ola negativa en tránsito
  Cerrar gradualmente todas las tomas de cabeza a cola
  para evitar daño en estructuras.
  ```
- El nivel en todos los puntos cae hacia cero.
- La velocidad de propagación de la ola negativa es la misma que la positiva.

**Secuencia de operación recomendada:**
1. Notificar a todos los módulos de la inminencia del corte.
2. Iniciar cierre gradual de compuertas de cabeza a cola (K-0 → K-104).
3. No cerrar simultáneamente: el vaciado simultáneo produce presiones negativas que pueden fracturar el revestimiento.
4. Registrar el movimiento tipo CORTE en `/presas`.

### 9.4 LLENADO

**Cuándo usar:** Se va a iniciar un evento de llenado del canal (estaba vacío o en nivel muy bajo).

**Efecto en la simulación:**
- El modo LLENADO en el simulador modela el **avance del frente de agua** como función de tiempo.
- La visualización en el Monitor Público cambia: se muestra el frente de agua avanzando por el mapa.

**Secuencia de operación recomendada:**
1. Verificar que el evento de llenado esté activado en el módulo de Eventos Hídricos.
2. Registrar la apertura de presa como tipo APERTURA en `/presas` con la hora real de la maniobra.
3. El Monitor Público comenzará a mostrar el avance del frente automáticamente.
4. Usar el Panel de Análisis de Tránsito para monitorear la llegada a cada escala.
5. Confirmar la apertura en K-0 vía SICA Capture cuando el frente llegue.

---

## 10. Motor de Decisión Automático

### 10.1 ¿Qué es?

El Motor de Decisión analiza los resultados de la simulación y genera una **lista priorizada de acciones** que el operador debe ejecutar. Se actualiza en tiempo real al cambiar cualquier parámetro del simulador.

### 10.2 Jerarquía de prioridades

| Prioridad | Color | Descripción |
|-----------|-------|-------------|
| URGENTE | Rojo | Acción inmediata requerida — riesgo de daño |
| ALERTA | Naranja | Acción necesaria — vigilancia activa |
| INFO | Azul/Gris | Información operativa — sin acción urgente |

### 10.3 Reglas del motor (R1 – R9)

**R1 — Sin telemetría de presa**
- Prioridad: INFO
- Indica que la simulación se basa en estimados, no en datos reales de la presa.

**R8 — CORTE total (primera en lista)**
- Prioridad: URGENTE
- Solo aplica cuando el tipo de evento es CORTE y Q < 5 m³/s.
- Acción: "Cerrar gradualmente todas las tomas de cabeza a cola."

**R2 — Nivel CRÍTICO en escala**
- Prioridad: URGENTE
- Condición: bordo libre ≥ 92% del canal.
- Acción sugerida: reducir gasto de presa o abrir la escala afectada.

**R3 — Nivel ALERTA en escala**
- Prioridad: ALERTA
- Condición: bordo libre 75–92% del canal.
- Acción sugerida: vigilar la escala.

**R4 — Ajuste de apertura requerido**
- Prioridad: ALERTA (si Δapertura > 40 cm) / INFO (si menor).
- Se calcula la apertura exacta necesaria para mantener la escala en el rango operativo [2.80–3.50 m].
- Muestra: apertura actual, apertura requerida y delta (+/- cm).

**R5 — Tendencia ascendente sin causa aparente**
- Prioridad: ALERTA
- Condición: la escala subió > 2.5 cm en 12h sin que el gasto de presa haya subido.
- Indica posible restricción o bloqueo aguas abajo.

**R6 — Número de Froude elevado**
- Prioridad: ALERTA (si Fr > 0.90) / INFO (si Fr 0.70–0.90).
- Fr > 0.70 indica flujo subcrítico acelerado con riesgo de resalto hidráulico.

**R7 — Pérdida excesiva entre tramos**
- Prioridad: ALERTA
- Condición: pérdida > 20% y > 3 m³/s entre dos puntos de control consecutivos.
- Sugiere verificar tomas no reportadas o infiltración.

**R9 — Sistema estable**
- Prioridad: INFO
- Solo se genera cuando ninguna otra regla aplica.
- Confirma que todos los parámetros están dentro de rangos normales.

### 10.4 Tarjetas de punto de control

Cada escala simulada muestra una **tarjeta expandible** con:

| Dato | Descripción |
|------|-------------|
| Estado | ESTABLE / ALERTA / CRÍTICO (coloreado) |
| Nivel base | Nivel actual real (lectura AM) |
| Nivel simulado | Nivel proyectado con el nuevo Q |
| Δ nivel | Cambio en metros |
| Tipo de remanso | M1 / M2 / NORMAL |
| Arribo | Hora estimada de llegada del frente de onda |
| Maniobra | Hora sugerida para hacer el ajuste (arribo − 30 min) |
| Froude | Número de Froude en el tramo |
| % Capacidad | Porcentaje respecto a la capacidad de diseño del tramo |
| Apertura actual | Apertura real de compuertas (m) desde SICA Capture |
| Apertura requerida | Apertura necesaria para mantener nivel objetivo |
| Δ apertura | Cuánto abrir (+) o cerrar (−) |
| Tomas activas | Número de tomas activas en el tramo |
| Q extraído | Gasto extraído por tomas en el tramo (m³/s) |

**Sección técnica (modo avanzado):**
- Geometría del tramo: plantilla (b), talud (z), bordo libre (H).
- Q de diseño y % de ocupación respecto al diseño.
- Celeridad de onda y velocidad media del flujo.
- Diferencial de carga hidráulica en la compuerta (Δh).

### 10.5 Visualización del frente de onda

En la barra de progreso de cada tarjeta se muestra el **avance de la ola**:

```
K-23  [■■■■■■■░░░]  65%  → Arribo: 14:35
```

- Lleno (azul) = porción recorrida de la onda.
- Vacío (gris) = porción pendiente.
- `Arribo` = hora estimada de llegada al punto.
- `Maniobra` = hora en que el operador debe ajustar la compuerta (30 min antes del arribo).

---

## 11. Exportación de Datos

### 11.1 Reporte PDF Gerencial

**Cómo generarlo:**
1. En el dock ESTABILIZACIÓN, hacer clic en **"Reporte PDF"**.
2. Se abre el modal del reporte con vista previa en pantalla.
3. Hacer clic en **"Imprimir / Guardar PDF"** en la barra superior del modal.
4. El navegador abre el diálogo de impresión → seleccionar "Guardar como PDF".

**Contenido del reporte:**

| Sección | Contenido |
|---------|-----------|
| Encabezado | Logo SRL, título, fecha/hora de generación, modo del sistema |
| IEC Scorecard | Índice global, semáforo y 4 barras de componentes |
| Balance Hídrico | Cadena: Presa → KM 0 → KM 104 con pérdidas por tramo |
| Perfil FGV | Tabla de puntos del perfil hidráulico calculado (si disponible) |
| Alertas | Lista de escalas en estado ALERTA o CRÍTICO |
| Incoherencias | Escalas con gasto incoherente respecto al tramo anterior |
| Pie de página | Versión del sistema y código de generación |

### 11.2 Exportación CSV de Escalas

**Cómo exportar:**
1. En el dock ESTABILIZACIÓN, hacer clic en **"Exportar CSV"**.
2. Se descarga automáticamente un archivo `escalas_YYYY-MM-DD.csv`.

**Columnas del CSV:**

| Columna | Descripción |
|---------|-------------|
| Nombre | Nombre de la escala |
| KM | Kilómetro del canal |
| Nivel (m) | Nivel actual del agua |
| Nivel Máx Op. (m) | Nivel máximo operativo de la escala |
| % Bordo | Porcentaje de ocupación |
| Gasto (m³/s) | Gasto medido o calculado |
| Apertura (m) | Apertura total de compuertas |
| Δ 12h (m) | Tendencia en las últimas 12 horas |
| Último dato | Fecha y hora del último reporte |
| Estado | Estado de telemetría (VIVO / RETRASADO / ALERTA / CRITICO / FUERA_DE_LINEA) |

El archivo incluye BOM UTF-8 para compatibilidad con Excel en español.

---

## 12. Estados de Telemetría

El sistema evalúa el tiempo transcurrido desde la última lectura de cada escala y asigna uno de 5 estados:

| Estado | Tiempo transcurrido | Color | Significado |
|--------|---------------------|-------|-------------|
| **VIVO** | < 30 minutos | Verde pulsante | Dato fresco — escala activa |
| **RETRASADO** | 30 min – 2 horas | Naranja | Lectura tardía — verificar campo |
| **ALERTA** | 2 – 8 horas | Naranja oscuro | Sin señal prolongada |
| **CRÍTICO** | 8 – 24 horas | Rojo | Sin datos por casi un día |
| **FUERA_DE_LINEA** | > 24 horas o sin dato | Gris | Escala desconectada |

El estado VIVO tiene una animación de pulso verde para indicar que la escala está transmitiendo activamente.

En el perfil de canal, los segmentos de escalas FUERA_DE_LINEA se muestran en gris `#475569` independientemente del nivel.

---

## 13. Glosario

| Término | Definición |
|---------|------------|
| **Bordo libre** | Altura del canal sin agua — espacio disponible antes de desbordamiento |
| **Celeridad de onda** | Velocidad de propagación de una perturbación en el canal (m/s) |
| **Cd** | Coeficiente de descarga de la compuerta (típico: 0.60–0.70) |
| **Coherencia** | Propiedad que tiene una serie de gastos si cada uno es menor o igual al anterior más la tolerancia |
| **FGV** | Flujo Gradualmente Variado — régimen no uniforme en canales abiertos |
| **Fr (Froude)** | Número adimensional: `Fr = v / √(g·A/T)`. Fr < 1: subcrítico. Fr > 1: supercrítico |
| **IEC** | Índice de Estado del Canal — indicador 0-100 de salud hidráulica |
| **M1** | Perfil de remanso positivo — agua represada sobre tirante normal |
| **M2** | Perfil de remanso negativo — agua por debajo del tirante normal |
| **Manning (n)** | Coeficiente de rugosidad del canal (concreto revestido: 0.014) |
| **Movimiento de presa** | Registro oficial de cambio de gasto en obra de toma |
| **Piso de servicio** | Límite inferior de caída de nivel (máx. 10% del nivel actual) |
| **Plantilla (b)** | Ancho de la base del canal en metros |
| **Q** | Gasto o caudal en metros cúbicos por segundo (m³/s) |
| **Realtime** | Tecnología de actualización instantánea de datos (Supabase Realtime) |
| **Remanso** | Curva de la superficie libre del agua bajo flujo no uniforme |
| **Salto hidráulico** | Transición abrupta de flujo supercrítico a subcrítico con disipación de energía |
| **S0** | Pendiente del fondo del canal (m/m) |
| **Talud (z)** | Relación horizontal:vertical del talud del canal. z=1.75 significa 1.75H:1V |
| **Tirante (y)** | Profundidad del agua en la sección transversal del canal |
| **Tirante normal** | Profundidad en flujo uniforme calculada por la fórmula de Manning |
| **Tirante crítico** | Profundidad para la cual Fr = 1 |
| **T₀** | Hora del último movimiento de presa — referencia temporal del simulador |
| **Toma** | Punto de extracción lateral del canal hacia módulos o parcelas |

---

*Manual generado para SICA 005 Conchos Digital v2.7.0*
*Sociedad de Responsabilidad Limitada — Distrito de Riego 005, El Fuerte*
