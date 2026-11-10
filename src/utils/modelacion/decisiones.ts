import { getTodayString } from '../dateHelpers';
import type { CPTelemetry, DataStatus, DeliveryData } from '../modelingTypes';
import type { CPResult, EventType } from './hidraulicaCanal';
import { G, getOpLimits } from './hidraulicaCanal';

// ── FASE 3: MOTOR DE DECISIÓN HIDRÁULICA ────────────────────────────────
type DecisionPrioridad = 'URGENTE' | 'ALERTA' | 'INFO';

export type DecisionTipo      = 'APERTURA' | 'CIERRE' | 'CAUDAL_PRESA' | 'MONITOREO' | 'OPERATIVO';

export interface Decision {
  prioridad:     DecisionPrioridad;
  tipo:          DecisionTipo;
  punto:         string;
  km:            number;
  accion:        string;
  detalle:       string;
  valor_actual:  string;
  valor_meta:    string;
}

/** Antigüedad de la lectura de nivel que sirve de base. Sin lectura real el simulador usa un nivel sintético: se avisa. */
export function edadLectura(fecha: string | undefined, nivelReal: number | undefined): { texto: string; color: string; title: string } | null {
  if (!(nivelReal && nivelReal > 0.05)) {
    return { texto: 'sin lectura · nivel estimado', color: '#f59e0b', title: 'No hay lectura de nivel para esta escala: el simulador usa un valor sintético como base.' };
  }
  if (!fecha) return null;
  const dias = Math.round((new Date(getTodayString() + 'T12:00:00').getTime() - new Date(fecha + 'T12:00:00').getTime()) / 86400000);
  if (!(dias >= 0)) return null;
  if (dias === 0) return null; // lo normal no se rotula: solo se avisa la excepción
  return {
    texto: dias === 1 ? 'lectura de ayer' : `lectura de hace ${dias} d`,
    color: '#f59e0b',
    title: `La lectura base tiene ${dias} día(s) (${fecha}): el nivel mostrado puede no ser vigente.`,
  };
}

export type ModoOperativo = 'RIEGO' | 'LLENADO' | 'VACIADO' | 'SIN_ENTRADA';

/** Por debajo de este gasto de presa se considera que el canal no recibe entrada de riego. */
export const Q_MIN_ENTRADA_M3S = 2;

export function decisionModoOperativo(modo: ModoOperativo, qDam: number): Decision {
  const vaciado = modo === 'VACIADO';
  return {
    prioridad: 'INFO', tipo: 'OPERATIVO',
    punto: 'Canal', km: 0,
    accion: vaciado ? 'Canal en VACIADO — reglas de riego suspendidas' : 'Sin entrada de agua — reglas de riego suspendidas',
    detalle: (vaciado
      ? 'Presa cerrada y canal en remanente: el motor no recomienda abrir compuertas ni evalúa los mínimos deseables de servicio.'
      : `Gasto de presa bajo ${Q_MIN_ENTRADA_M3S} m³/s: el motor no recomienda abrir compuertas ni evalúa mínimos de servicio.`)
      + ' Vigilar el descenso de nivel (protocolo de vaciado: máx. 30 cm/día).',
    valor_actual: `Q presa ${qDam.toFixed(1)} m³/s`,
    valor_meta:   'Descenso ≤ 30 cm/día',
  };
}

export function generateDecisions(
  simResults:     CPResult[],
  qDam:           number,
  qBase:          number,
  gateBase:       Record<string, number>,
  cpTelemetry:    Record<string, CPTelemetry>,
  dataStatus:     DataStatus,
  eventType:      EventType,
  deliveryPoints: DeliveryData[],
): Decision[] {
  const decisions: Decision[] = [];
  const deltaQ = qDam - qBase;

  // R1: Sin telemetría de presa — incertidumbre en la base de simulación
  if (!dataStatus.dam) {
    decisions.push({
      prioridad: 'INFO', tipo: 'MONITOREO',
      punto: 'Sistema', km: 0,
      accion: 'Sin telemetría de Presa Boquilla',
      detalle: 'Simulación basada en estimados de escala K-0. Verificar conexión de datos.',
      valor_actual: dataStatus.damFuente, valor_meta: 'movimientos_presas',
    });
  }

  // R10: Coherencia Q presa ↔ Q medido en K-0 (AFORO SICA)
  // El tramo río Presa Boquilla → K-0 (~36 km) absorbe 5–15% del caudal en condiciones normales.
  // Si la diferencia supera 35%, hay anomalía: compuerta K-0 cerrada, calibración SICA errónea,
  // o evento extraordinario (avenida, ruptura). Se notifica para verificación de campo.
  if (simResults.length > 0 && dataStatus.dam) {
    const r0 = simResults[0];
    if (r0.q_gate_m3s !== null && r0.gate_source === 'AFORO' && qBase > 0) {
      const qPresa = qBase;
      const qK0    = r0.q_gate_m3s;
      const diff   = Math.abs(qPresa - qK0);
      const umbralPct = 0.35; // >35% de diferencia es anomalía
      if (diff > qPresa * umbralPct && diff > 4) {
        const sentido = qK0 < qPresa ? 'menos de lo esperado' : 'más de lo esperado';
        decisions.push({
          prioridad: 'ALERTA', tipo: 'MONITOREO',
          punto: r0.nombre, km: r0.km,
          accion: `Inconsistencia Q Presa ↔ ${r0.nombre}`,
          detalle: `Presa: ${qPresa.toFixed(1)} m³/s · K-0 SICA: ${qK0.toFixed(1)} m³/s · diferencia ${diff.toFixed(1)} m³/s (${(diff/qPresa*100).toFixed(0)}%) — K-0 recibe ${sentido}. Verificar compuerta K-0 o calibración SICA.`,
          valor_actual: `K-0: ${qK0.toFixed(1)} m³/s`,
          valor_meta:   `Presa ±35%: ${(qPresa*0.65).toFixed(1)}–${(qPresa*1.15).toFixed(1)} m³/s`,
        });
      }
    }
  }

  // R11: Tomas sin reporte activo — extracciones invisibles para el simulador
  // Caso A: ningún reporte del día cargado → Q extraído = 0 en toda la simulación
  // Caso B: tomas activas con caudal_m3s = 0 (apertura registrada sin medición de gasto)
  if (!dataStatus.deliveries) {
    decisions.push({
      prioridad: 'INFO', tipo: 'MONITOREO',
      punto: 'Tomas Canal', km: 0,
      accion: 'Sin reportes de tomas hoy — extracciones no contabilizadas',
      detalle: 'reportes_diarios sin datos del día. El simulador propaga Q sin descontar extracciones laterales — Q en secciones aguas abajo puede estar sobreestimado.',
      valor_actual: 'Sin reportes', valor_meta: 'reportes_diarios del día',
    });
  } else {
    // Tomas activas (estado abierto) pero sin caudal reportado
    const tomasSinCaudal = deliveryPoints.filter(
      dp => dp.is_active && dp.caudal_m3s <= 0,
    );
    if (tomasSinCaudal.length > 0) {
      decisions.push({
        prioridad: 'INFO', tipo: 'MONITOREO',
        punto: 'Tomas Canal', km: 0,
        accion: `${tomasSinCaudal.length} toma(s) activa(s) sin gasto reportado`,
        detalle: `Tomas abiertas sin medición: ${tomasSinCaudal.slice(0, 4).map(t => t.nombre).join(', ')}${tomasSinCaudal.length > 4 ? ` y ${tomasSinCaudal.length - 4} más` : ''}. El Q extraído en esos tramos es 0 en la simulación.`,
        valor_actual: `${tomasSinCaudal.length} sin gasto`,
        valor_meta:   '0 sin gasto',
      });
    }
  }

  // R12: Restricciones de nivel por tramo — evaluación de condicionantes hidráulicas
  //
  // v2.7.3 — textos diferenciados por contexto operativo:
  //   • isDeltaActive+isIncrement+controlFijo → "AJUSTE DE NIVEL — escala fija X.XX m"
  //     con Δapertura en cm/pieza y horario de maniobra preparatoria.
  //   • isDeltaActive+isIncrement (sin controlFijo) → mensajes de tránsito de ola.
  //   • isDeltaActive+isDecrement → mensajes de descenso.
  //   • Base state (!isDeltaActive) → mensajes conservadores de monitoreo.
  //
  // controlFijo: el operador igualó mín ≈ máx (|max−min| < 0.05 m) en el panel de
  //   condicionantes — indica control de nivel constante en ese punto de control.
  const isDeltaActive = Math.abs(deltaQ) > 0.5;
  const isIncrement   = deltaQ >  0.5;
  const isDecrement   = deltaQ < -0.5;

  simResults.forEach(r => {
    const ev = r.evaluacion_nivel;
    if (!ev || ev.estado === 'operacion_aceptable') return;
    // No duplicar con R2 (nivel CRITICO ya emite URGENTE para el mismo punto)
    if (r.status === 'CRITICO') return;

    const metaMax = ev.nivel_max_m != null ? `≤ ${ev.nivel_max_m.toFixed(2)} m` : '—';
    const metaMin = ev.nivel_min_m != null ? `≥ ${ev.nivel_min_m.toFixed(2)} m` : '—';
    const tipoAccion: DecisionTipo = ev.exceso_sobre_max_m > 0 ? 'CIERRE' : 'APERTURA';
    const prioManiobra: DecisionPrioridad = isDeltaActive ? 'URGENTE' : 'ALERTA';

    // Control de nivel fijo: el operador configuró mín ≈ máx en el panel (objetivo de escala fija)
    const controlFijo = ev.nivel_min_m !== null
      && Math.abs(ev.nivel_max_m - ev.nivel_min_m) < 0.05;
    const nivelFijoStr = (ev.nivel_min_m ?? ev.nivel_max_m).toFixed(2);
    const aperDeltaCm  = Math.abs(r.delta_apertura * 100).toFixed(1);
    const aperDir      = r.delta_apertura >= 0 ? 'ABRIR' : 'CERRAR';
    const deltaQStr    = `${deltaQ > 0 ? '+' : ''}${deltaQ.toFixed(1)}`;

    // ── requiere_maniobra_preventiva ──────────────────────────────────────
    if (ev.estado === 'requiere_maniobra_preventiva') {
      let accionLabel: string;
      let detalleLabel: string;
      let valorMeta: string;

      if (isDeltaActive && isIncrement && ev.exceso_sobre_max_m > 0) {
        // Ola de incremento supera el techo → cerrar para frenar remanso
        accionLabel  = `MANIOBRA PREVENTIVA — rebase máximo · ${ev.tramo_id}`;
        detalleLabel = `${ev.mensaje} · Maniobra anticipada: ${r.maniobra_time}.`;
        valorMeta    = metaMax;
      } else if (isDeltaActive && isIncrement && controlFijo) {
        // Escala fija con límite duro: ajuste de apertura para sostener nivel en tránsito
        accionLabel  = `AJUSTE DE NIVEL — escala fija ${nivelFijoStr} m · ${ev.tramo_id}`;
        detalleLabel = `Apertura insuficiente para sostener escala en ${nivelFijoStr} m con Q${deltaQStr} m³/s. ${aperDir} ~${aperDeltaCm} cm/pieza. Maniobra preparatoria: ${r.maniobra_time}.`;
        valorMeta    = `= ${nivelFijoStr} m`;
      } else if (isDeltaActive && isIncrement) {
        // Incremento genera déficit genuino por debajo del mínimo duro
        accionLabel  = `NIVEL INSUFICIENTE EN TRÁNSITO — ${ev.tramo_id}`;
        detalleLabel = `${ev.mensaje} · Maniobra anticipada en ${r.maniobra_time}.`;
        valorMeta    = metaMin;
      } else if (isDeltaActive && isDecrement && ev.exceso_sobre_max_m > 0) {
        // Descenso con nivel aún por encima del máximo → maniobra para bajar
        accionLabel  = `MANIOBRA PREVENTIVA — nivel alto en descenso · ${ev.tramo_id}`;
        detalleLabel = `${ev.mensaje} · Maniobra anticipada en ${r.maniobra_time}.`;
        valorMeta    = metaMax;
      } else {
        // Base state o cualquier otro caso
        accionLabel  = `${isDeltaActive ? 'MANIOBRA PREVENTIVA' : 'NIVEL FUERA DE RANGO'} — ${ev.tramo_id}`;
        detalleLabel = ev.mensaje;
        valorMeta    = ev.exceso_sobre_max_m > 0 ? metaMax : metaMin;
      }

      decisions.push({
        prioridad: prioManiobra, tipo: tipoAccion,
        punto: r.nombre, km: r.km,
        accion:       accionLabel,
        detalle:      detalleLabel,
        valor_actual: `${ev.nivel_proyectado_m.toFixed(2)} m`,
        valor_meta:   valorMeta,
      });

    // ── alerta_operativa (blando dentro de tolerancia) ────────────────────
    } else if (ev.estado === 'alerta_operativa') {
      const accionLabel = (isDeltaActive && isIncrement && controlFijo)
        ? `ESCALA EN RANGO — ajuste menor requerido · ${ev.tramo_id}`
        : (isDeltaActive && isIncrement)
          ? `NIVEL EN TOLERANCIA — vigilar durante tránsito · ${ev.tramo_id}`
          : `NIVEL EN TOLERANCIA — ${ev.tramo_id}`;
      const detalleLabel = (isDeltaActive && isIncrement && controlFijo)
        ? `Escala próxima al límite configurado (${ev.nivel_max_m.toFixed(2)} m). Preparar ${aperDir} ~${aperDeltaCm} cm/pieza antes de llegada de ola (${r.arrival_time}).`
        : ev.mensaje;

      decisions.push({
        prioridad: 'ALERTA', tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion:       accionLabel,
        detalle:      detalleLabel,
        valor_actual: `${ev.nivel_proyectado_m.toFixed(2)} m`,
        valor_meta:   metaMax,
      });

    // ── riesgo_insuficiencia_operativa (bajo mínimo deseable) ─────────────
    } else if (ev.estado === 'riesgo_insuficiencia_operativa') {
      let accionLabel: string;
      let detalleLabel: string;

      if (isDeltaActive && isIncrement && controlFijo) {
        // Caso principal del usuario: escala fija + incremento activo
        accionLabel  = `AJUSTE DE NIVEL — escala fija ${nivelFijoStr} m · ${ev.tramo_id}`;
        detalleLabel = `${aperDir} ~${aperDeltaCm} cm/pieza para sostener escala en ${nivelFijoStr} m con Q${deltaQStr} m³/s. Ola llega: ${r.arrival_time}. Maniobra preparatoria: ${r.maniobra_time}.`;
      } else if (isDeltaActive && isIncrement) {
        accionLabel  = `NIVEL BAJO EN TRÁNSITO — ${ev.tramo_id}`;
        detalleLabel = `${ev.mensaje} · Verificar con SICA cuando llegue la ola: ${r.arrival_time}.`;
      } else if (isDeltaActive && isDecrement) {
        accionLabel  = `NIVEL BAJO EN DESCENSO — ${ev.tramo_id}`;
        detalleLabel = `${ev.mensaje} · Monitorear continuamente durante el descenso.`;
      } else {
        // Base state
        accionLabel  = `NIVEL BAJO MÍNIMO DESEABLE — ${ev.tramo_id}`;
        detalleLabel = ev.mensaje;
      }

      decisions.push({
        prioridad: 'ALERTA', tipo: 'APERTURA',
        punto: r.nombre, km: r.km,
        accion:       accionLabel,
        detalle:      detalleLabel,
        valor_actual: `${ev.nivel_proyectado_m.toFixed(2)} m`,
        valor_meta:   metaMin,
      });
    }
  });

  // R8: CORTE total — alerta de ola negativa (prioridad máxima, va primero)
  if (eventType === 'CORTE' && qDam < 5) {
    decisions.push({
      prioridad: 'URGENTE', tipo: 'OPERATIVO',
      punto: 'Canal completo', km: 0,
      accion: 'CORTE TOTAL — ola negativa en tránsito',
      detalle: 'Cerrar gradualmente todas las tomas de cabeza a cola para evitar daño en estructuras.',
      valor_actual: `${qDam.toFixed(1)} m³/s`,
      valor_meta: 'Cierre escalonado',
    });
  }

  simResults.forEach((r, idx) => {
    const gateActual = gateBase[r.id] ?? r.h_radial;
    const aperReq    = Math.min(3.0, Math.max(0.1, r.apertura_requerida));
    const aperDelta  = r.delta_apertura ?? (aperReq - gateActual);
    const tel        = cpTelemetry[r.id];

    // R2: Nivel CRÍTICO — acción inmediata
    if (r.status === 'CRITICO') {
      decisions.push({
        prioridad: 'URGENTE', tipo: deltaQ > 0 ? 'CAUDAL_PRESA' : 'APERTURA',
        punto: r.nombre, km: r.km,
        accion: deltaQ > 0
          ? `REDUCIR gasto o ABRIR ${r.nombre}`
          : `ABRIR compuerta ${r.nombre}`,
        detalle: `Tirante al ${r.bordo_libre_pct.toFixed(0)}% de la profundidad total — margen al desborde ${(r.canal_depth_m - r.y_sim).toFixed(2)} m`,
        valor_actual: `${r.y_sim.toFixed(2)} m`,
        valor_meta:   `< ${(r.canal_depth_m * 0.75).toFixed(2)} m`,
      });
    }

    // R3: Nivel ALERTA — solo cuando la alerta NO proviene de una restricción
    // de nivel (esos casos ya emiten mensaje específico en R12)
    else if (r.status === 'ALERTA'
      && (r.evaluacion_nivel == null || r.evaluacion_nivel.estado === 'operacion_aceptable')) {
      decisions.push({
        prioridad: 'ALERTA', tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Vigilar escala ${r.nombre}`,
        detalle: `Tirante al ${r.bordo_libre_pct.toFixed(0)}% de la profundidad total — tendencia ${r.delta_y > 0 ? 'ascendente' : 'descendente'}`,
        valor_actual: `${r.y_sim.toFixed(2)} m`,
        valor_meta:   `< ${(r.canal_depth_m * 0.75).toFixed(2)} m`,
      });
    }

    // R4: Ajuste de apertura — lógica diferenciada por DIRECCIÓN DEL CAMBIO
    // ─────────────────────────────────────────────────────────────────────
    // INCREMENTO: llega más volumen. El operador debe facilitar el paso aguas abajo.
    //   Señal 1 — ORIFICIO ancló el Q: la apertura física ya está limitando el caudal.
    //             El ancla ORIFICIO significa que la compuerta NO puede pasar q_sim.
    //   Señal 2 — Capacidad teórica: Cd·A·√(2g·y_base) < q_sim × 0.90
    //             Usa y_base (nivel real medido) en lugar de y_sim (Manning/piso),
    //             ya que el canal opera en régimen M1 y y_base es el nivel real.
    //   NUNCA emitir CIERRE durante INCREMENTO.
    //
    // DECREMENTO / CORTE: llega menos volumen, nivel puede caer.
    //   - Posible cierre para sostener carga mínima en tomas laterales.
    //   - apertura_requerida vs apertura_base es válido aquí.
    if (Math.abs(deltaQ) > 0.5) {
      const isIncrement = deltaQ > 0;

      if (isIncrement) {
        // Señal 1: ORIFICIO ancló el caudal → apertura física limita el Q proyectado
        const ancladaPorOrificio = r.gate_anchored && r.gate_source === 'ORIFICIO';

        // Señal 1.5: AFORO SICA disponible en escenario delta.
        // En régimen M1 las compuertas operan sumergidas: ΔH efectivo ≈ 0.02–0.05 m.
        // La fórmula libre Q = Cd·A·√(2g·y) sobreestima la capacidad real ×5–×15.
        // El aforo medido por SICA ES la capacidad operativa real bajo esas condiciones.
        // Si q_aforo < q_sim × 90% → la compuerta real no puede pasar el nuevo gasto.
        const aforo_ref = !r.gate_anchored
          && r.gate_source === 'AFORO'
          && r.q_gate_m3s !== null
          && r.q_gate_m3s > 0.5;
        const cuelloSubmerso = aforo_ref && r.q_gate_m3s! < r.q_sim * 0.90;

        if (ancladaPorOrificio && r.q_gate_m3s !== null) {
          decisions.push({
            prioridad: 'ALERTA', tipo: 'APERTURA',
            punto: r.nombre, km: r.km,
            accion: `ABRIR radiales ${r.nombre} — apertura limita a ${r.q_gate_m3s.toFixed(1)} m³/s`,
            detalle: `Capacidad ORIFICIO actual: ${r.q_gate_m3s.toFixed(1)} m³/s · Q proyectado: ${r.q_sim.toFixed(1)} m³/s — la apertura impide el paso del incremento`,
            valor_actual: `${gateActual.toFixed(2)} m`,
            valor_meta:   `${aperReq.toFixed(2)} m`,
          });
        } else if (cuelloSubmerso) {
          // Capacidad real (submersa M1) < Q proyectado → ABRIR
          // Apertura estimada por proporcionalidad (Q ∝ apertura a ΔH ≈ cte)
          const aperReqSubm = Math.min(3.0, gateActual * (r.q_sim / r.q_gate_m3s!));
          const deltaSubm   = aperReqSubm - gateActual;
          decisions.push({
            prioridad: isDeltaActive ? 'URGENTE' : 'ALERTA', tipo: 'APERTURA',
            punto: r.nombre, km: r.km,
            accion: `ABRIR radiales ${r.nombre} — capacidad real M1 insuficiente`,
            detalle: `Compuerta submersa (régimen M1): aforo real SICA ${r.q_gate_m3s!.toFixed(1)} m³/s < Q proyectado ${r.q_sim.toFixed(1)} m³/s. Apertura proporcional requerida: ~${aperReqSubm.toFixed(2)} m/pieza (+${deltaSubm.toFixed(2)} m). Maniobra: ${r.maniobra_time}.`,
            valor_actual: `${gateActual.toFixed(2)} m (aforo: ${r.q_gate_m3s!.toFixed(1)} m³/s)`,
            valor_meta:   `~${aperReqSubm.toFixed(2)} m`,
          });
        } else if (!aforo_ref) {
          // Señal 2: sin aforo disponible → capacidad teórica libre (último recurso)
          const qCapacidad = r.cd_used * r.area_gate
            * Math.sqrt(2 * G * Math.max(0.01, r.y_base));
          const cuelloBottella = qCapacidad < r.q_sim * 0.90 && r.q_sim > 1;
          if (cuelloBottella) {
            decisions.push({
              prioridad: 'ALERTA', tipo: 'APERTURA',
              punto: r.nombre, km: r.km,
              accion: `ABRIR radiales ${r.nombre} — compuerta cuello de botella`,
              detalle: `Capacidad teórica: ${qCapacidad.toFixed(1)} m³/s · Q proyectado: ${r.q_sim.toFixed(1)} m³/s — apertura insuficiente para el incremento`,
              valor_actual: `${gateActual.toFixed(2)} m`,
              valor_meta:   `${aperReq.toFixed(2)} m`,
            });
          }
        }
        // Si aforo_ref y no cuelloSubmerso (q_aforo ≥ q_sim×90%): capacidad suficiente.
        // Si Señal 2 sin cuello de botella: compuerta ya pasa el volumen.
        // En ambos casos: no se emite CIERRE durante INCREMENTO.
      } else {
        // DECREMENTO / CORTE: ajuste para sostener nivel de servicio
        if (Math.abs(aperDelta) > 0.05) {
          // Límites efectivos: restricción del tramo (si existe) > genéricos
          const yMin = r.evaluacion_nivel?.nivel_min_m ?? getOpLimits(r.km).yMin;
          const yMax = r.evaluacion_nivel?.nivel_max_m ?? getOpLimits(r.km).yMax;
          decisions.push({
            prioridad: Math.abs(aperDelta) > 0.40 ? 'ALERTA' : 'INFO',
            tipo:      aperDelta > 0 ? 'APERTURA' : 'CIERRE',
            punto: r.nombre, km: r.km,
            accion: `${aperDelta > 0 ? 'ABRIR' : 'CERRAR'} radiales ${r.nombre}`,
            detalle: `Sostener escala en ${(r.y_target ?? r.y_base).toFixed(2)} m [${yMin.toFixed(2)}–${yMax.toFixed(2)}] con Q = ${r.q_sim.toFixed(1)} m³/s`,
            valor_actual: `${gateActual.toFixed(2)} m`,
            valor_meta:   `${aperReq.toFixed(2)} m (${aperDelta > 0 ? '+' : ''}${aperDelta.toFixed(2)} m)`,
          });
        }
      }
    }

    // R5: Tendencia 12h creciente sin incremento de presa
    if (tel?.delta_12h != null && tel.delta_12h > 0.025 && deltaQ <= 0) {
      decisions.push({
        prioridad: 'ALERTA', tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Escala en ascenso — ${r.nombre}`,
        detalle: `+${(tel.delta_12h * 100).toFixed(0)} cm en 12h sin incremento de gasto — posible restricción aguas abajo`,
        valor_actual: `+${(tel.delta_12h * 100).toFixed(0)} cm/12h`,
        valor_meta:   '< 1 cm/12h',
      });
    }

    // R6: Número de Froude elevado
    if (r.froude_n > 0.70) {
      decisions.push({
        prioridad: r.froude_n > 0.90 ? 'ALERTA' : 'INFO',
        tipo: 'MONITOREO',
        punto: r.nombre, km: r.km,
        accion: `Flujo acelerado en ${r.nombre}`,
        detalle: `Fr = ${r.froude_n.toFixed(3)} — riesgo de resalto hidráulico aguas abajo`,
        valor_actual: `Fr ${r.froude_n.toFixed(3)}`,
        valor_meta:   'Fr < 0.70',
      });
    }

    // R7: Pérdida excesiva entre tramos consecutivos
    if (idx > 0) {
      const prev     = simResults[idx - 1];
      const loss     = prev.q_sim - r.q_sim;
      const lossPct  = prev.q_sim > 0 ? loss / prev.q_sim : 0;
      if (lossPct > 0.20 && loss > 3) {
        decisions.push({
          prioridad: 'ALERTA', tipo: 'MONITOREO',
          punto: `K${prev.km}–K${r.km}`, km: r.km,
          accion: `Pérdida elevada tramo K${prev.km}–K${r.km}`,
          detalle: `−${loss.toFixed(1)} m³/s (${(lossPct * 100).toFixed(0)}%) — verificar tomas no reportadas o infiltración`,
          valor_actual: `−${(lossPct * 100).toFixed(0)}%`,
          valor_meta:   '< 20%',
        });
      }
    }
  });

  // R9: Sin decisiones — confirmar estabilidad del sistema
  if (decisions.length === 0) {
    decisions.push({
      prioridad: 'INFO', tipo: 'OPERATIVO',
      punto: 'Sistema', km: 0,
      accion: 'Sistema hidráulico estable',
      detalle: `Q = ${qDam.toFixed(1)} m³/s · Todos los puntos dentro de parámetros normales`,
      valor_actual: 'ESTABLE', valor_meta: 'ESTABLE',
    });
  }

  // Ordenar: URGENTE → ALERTA → INFO, luego por km
  const order: Record<DecisionPrioridad, number> = { URGENTE: 0, ALERTA: 1, INFO: 2 };
  decisions.sort((a, b) => order[a.prioridad] - order[b.prioridad] || a.km - b.km);
  return decisions;
}
