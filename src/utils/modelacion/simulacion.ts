import type { ControlPoint, DeliveryData, TramoGeom, BalanceTramo } from '../modelingTypes';
import { safeFloat, CD_GATE } from '../modelingTypes';
import type { RestriccionNivelTramo, CPResult, RemansoType, CPStatus } from './hidraulicaCanal';
import { RIVER_KM, findTramo, normalDepth, waveCelerity, G, findRestriccion, getOpLimits, evaluarRestriccionNivelTramo, fmtTime } from './hidraulicaCanal';

// ── MOTOR DE SIMULACIÓN PURO (reutilizable para multi-escenario) ─────────
// currentTimeMin: hora actual del sistema en minutos desde medianoche
// simBaseMin: hora del ÚLTIMO movimiento de presa (no la hora del sistema)
export function runSimulation(
  controlPoints:     ControlPoint[],
  qDamInit:          number,
  qBaseInit:         number,
  baseReadings:      Record<string, number>,
  gateOverrides:     Record<string, number>,
  gastoMedido:       Record<string, number>,
  deliveryPoints:    DeliveryData[],
  tramoGeom:         TramoGeom[],
  riverTransit:      boolean,
  simBaseMin:        number,
  currentTimeMin:    number,
  balanceTramos:     BalanceTramo[],
  restricciones:     RestriccionNivelTramo[],   // lista activa (default + overrides temporales)
): CPResult[] {
  let qCur     = qDamInit,  cumMin = 0;
  let qBaseCur = qBaseInit;

  // Minutos transcurridos desde el movimiento de presa hasta hora actual
  const elapsedMin = ((currentTimeMin - simBaseMin) + 1440) % 1440;

  if (riverTransit) {
    const vRio = 0.5 * Math.pow(Math.max(qDamInit, 1), 0.4) + 0.5;
    cumMin += (RIVER_KM * 1000 / vRio) / 60;
  }

  // Margen de anticipación para maniobra (minutos antes del arribo)
  const MANIOBRA_MARGEN_MIN = 30;

  return controlPoints.map((cp, idx) => {
    const kmCp   = safeFloat(cp.km, idx * 17);
    const kmPrev = idx === 0 ? 0 : safeFloat(controlPoints[idx - 1].km, (idx - 1) * 17);
    const dist   = Math.max(1, idx === 0 ? kmCp : kmCp - kmPrev);

    const kmMid    = idx === 0 ? kmCp : (kmPrev + kmCp) / 2;
    const tramo    = findTramo(kmMid, tramoGeom);
    const b_tramo  = tramo.plantilla_m;
    const z_tramo  = tramo.talud_z;
    const n_tramo  = tramo.rugosidad_n;
    const s_tramo  = tramo.pendiente_s0;
    const fb_tramo = tramo.bordo_libre_m;
    const qdis     = tramo.capacidad_diseno_m3s;

    const y_base = (baseReadings[cp.id] && baseReadings[cp.id] > 0.05)
      ? baseReadings[cp.id]
      : Math.max(0.3, 2.2 - idx * 0.04);

    // Cálculos hidráulicos con Q nuevo (estado final)
    const y_n   = normalDepth(qCur, s_tramo, b_tramo, z_tramo, n_tramo);
    const c     = waveCelerity(y_n, b_tramo, z_tramo);
    const A_n   = (b_tramo + z_tramo * y_n) * y_n;
    const v_n   = A_n > 0 ? qCur / A_n : 0;
    const Fr    = v_n / Math.max(0.001, Math.sqrt(G * Math.max(0.01, y_n)));

    // ── VELOCIDAD DE PROPAGACIÓN CALIBRADA EMPÍRICAMENTE ────────────────
    // En un canal regulado con compuertas cada ~10-20 km, la onda de maniobra
    // NO viaja a la velocidad cinemática teórica (v + c ≈ 5-6 m/s).
    // Las compuertas, cambios de sección y rugosidad frenan la propagación.
    // Calibración unificada 06/05/2026 (reconciliación BC-07):
    //   Anclas: K-0→K-23 ~180 min, K-0→K-104 ~820 min (Q=28 m³/s)
    //   Constante 5.3 → 4.5 reduce error K-23 de -12% a -2%  y K-104 de -13% a +1%
    //   v_onda(Q=28) = 4.5 × 28^0.15 ≈ 7.8 km/h → K-23 en 2h 57min ✓
    //   v_onda(Q=34) = 4.5 × 34^0.15 ≈ 8.0 km/h → K-23 en 2h 52min
    const V_WAVE_BASE_KMH = 4.5;
    const v_wave_kmh = V_WAVE_BASE_KMH * Math.pow(Math.max(qCur, 1), 0.15);
    const travelSpd  = v_wave_kmh / 3.6; // convertir km/h → m/s
    const transit_min = (dist * 1000) / travelSpd / 60;

    const cd_used   = safeFloat(cp.coeficiente_descarga, CD_GATE) || CD_GATE;
    const pzas      = Math.max(1, safeFloat(cp.pzas_radiales, 1));
    const ancho     = Math.max(1, safeFloat(cp.ancho, 8));
    const has_real_gate = safeFloat(gateOverrides[cp.id], 0) > 0;
    const h_gate    = has_real_gate
      ? safeFloat(gateOverrides[cp.id], 1.25)
      : Math.max(0.3, pzas > 0 ? 1.25 : 1.0);
    const area_gate = Math.max(0.01, ancho * pzas * h_gate);

    // ── RESOLUCIÓN DE CAUDAL EN COMPUERTA ──────────────────────────────
    // Cascada de prioridad para anclar el flujo en cada sección:
    //   1º AFORO: gasto_calculado_m3s de SICA Capture (medición directa)
    //   2º ORIFICIO: Q = Cd × n × b × apertura × √(2g·y_base) si hay apertura real
    //   3º Propagación libre desde upstream (sin ancla)
    // El orificio sustituye al aforo SÓLO cuando no existe medición directa;
    // provee un ancla física más precisa que dejar fluir qDam sin verificación.
    const gm = safeFloat(gastoMedido[cp.id], 0);
    let q_gate_m3s: number | null = (gm > 0) ? +gm.toFixed(3) : null;
    let gate_source: 'AFORO' | 'ORIFICIO' | null = q_gate_m3s !== null ? 'AFORO' : null;

    if (q_gate_m3s === null && has_real_gate && h_gate > 0 && y_base > 0.1) {
      // Sin aforo directo pero apertura real conocida → calcular por fórmula de orificio
      const q_orificio = cd_used * pzas * ancho * h_gate * Math.sqrt(2 * G * y_base);
      if (q_orificio > 0.1) {
        q_gate_m3s = +q_orificio.toFixed(3);
        gate_source = 'ORIFICIO';
      }
    }

    const head_base  = Math.pow(Math.max(qBaseCur, 0.1) / (cd_used * area_gate), 2) / (2 * G);
    const head_sim   = Math.pow(Math.max(qCur,     0.1) / (cd_used * area_gate), 2) / (2 * G);
    const head_delta = head_sim - head_base;

    const td_tramo   = tramo.tirante_diseno_m;
    const canal_depth = td_tramo + fb_tramo;

    // ── LÍMITES OPERATIVOS EFECTIVOS: restricción del tramo > genéricos ────
    // Un override del operador en el panel de condicionantes mueve también
    // el piso de servicio y el nivel objetivo del motor (antes solo la
    // evaluación usaba la restricción y el motor seguía con getOpLimits).
    const restriccion = findRestriccion(kmCp, restricciones);
    const yMinOp = restriccion?.nivel_min_deseable_m ?? getOpLimits(kmCp).yMin;
    const yMaxOp = restriccion?.nivel_max_permitido_m ?? getOpLimits(kmCp).yMax;

    // ── MODELO PERTURBACIONAL ──────────────────────────────────────────────
    // El canal opera en régimen M1 (remanso por compuertas): Manning uniforme
    // NO reproduce el nivel real medido. La escala observada ES el estado base;
    // Manning solo aporta la VARIACIÓN entre el Q base y el Q simulado:
    //   y_sim = y_base + [y_n(Q_sim) − y_n(Q_base)]
    // Con ΔQ = 0 los términos se cancelan → y_sim = y_base (sin descensos
    // ficticios por el sesgo Manning-vs-remanso).
    const y_n_base  = normalDepth(qBaseCur, s_tramo, b_tramo, z_tramo, n_tramo);
    const y_sim_raw = y_base + (y_n - y_n_base);

    // ── PISO DE SERVICIO: la escala simulada NO puede caer más del 10% de la
    // escala actual (continuidad de servicio a tomas altas y laterales). Si la
    // escala real ya está bajo el mínimo operativo, el piso no puede fabricar
    // un ascenso: se limita al 90% del nivel real.
    const y_floor = y_base >= yMinOp
      ? Math.max(yMinOp, y_base * 0.90)
      : y_base * 0.90;

    const y_sim_capped = Math.max(y_floor, Math.min(y_sim_raw, canal_depth - 0.08));
    const y_sim_final = Math.max(0.1, Math.min(y_sim_capped, Math.max(y_base, yMaxOp)));

    // ── APERTURA REQUERIDA para MANTENER la escala estabilizada ──────────
    const y_target       = Math.max(y_floor, Math.min(yMaxOp, y_base));
    const sqrtHead       = Math.sqrt(2 * G * Math.max(0.01, y_target));
    const apertura_base  = has_real_gate ? h_gate : Math.max(0.3, h_gate);

    // ── CONDICIÓN SUBMERSA M1: el aforo SICA es la referencia real de capacidad ──
    // En régimen M1 (remanso), el nivel aguas abajo también es alto. La compuerta opera
    // en condición submersa (ΔH efectivo ≈ 0.02–0.05 m, no y_upstream ≈ 3.5 m).
    // La fórmula libre Q = Cd·A·√(2g·y_upstream) SOBREESTIMA la capacidad real ×5–×15.
    // Cuando hay aforo SICA disponible (q_gate_m3s > 0) y estamos en delta simulación,
    // el aforo ES la capacidad real medida. Apertura requerida ∝ Q (Q ∝ apertura a ΔH ≈ cte).
    const isDeltaSimLocal = Math.abs(qDamInit - qBaseInit) > 0.5;
    const aforo_disponible = gate_source === 'AFORO' && q_gate_m3s !== null && q_gate_m3s > 0.5;
    let apertura_requerida_raw: number;
    if (isDeltaSimLocal && aforo_disponible) {
      // Proporcional submerso: apertura_req = apertura_actual × (Q_nuevo / Q_aforo_real)
      apertura_requerida_raw = h_gate * (qCur / q_gate_m3s!);
    } else {
      apertura_requerida_raw = qCur / Math.max(0.001, cd_used * ancho * pzas * sqrtHead);
    }
    const apertura_requerida = Math.max(0.05, Math.min(3.5, apertura_requerida_raw));
    const delta_apertura = apertura_requerida - apertura_base;

    cumMin += transit_min;

    // ── PROPAGACIÓN TEMPORAL: frente de onda ────────────────────────────
    const wave_arrived = cumMin <= elapsedMin;
    let wave_pct: number;
    if (wave_arrived) {
      wave_pct = 1.0;
    } else if (elapsedMin >= (cumMin - transit_min)) {
      wave_pct = Math.max(0, (elapsedMin - (cumMin - transit_min)) / Math.max(1, transit_min));
    } else {
      wave_pct = 0;
    }

    // y_sim = nivel estabilizado con piso de servicio (no Manning puro)
    const y_sim = y_sim_final;

    const delta_y      = y_sim - y_base;
    const remanso_type: RemansoType = delta_y > 0.08 ? 'M1' : delta_y < -0.08 ? 'M2' : 'NORMAL';
    const pct          = y_sim / canal_depth;

    // ── RESTRICCIÓN DE NIVEL: evaluar y_sim contra límites del tramo ────────
    const evaluacion_nivel = restriccion
      ? evaluarRestriccionNivelTramo(restriccion, y_sim)
      : null;

    // ── STATUS EXPANDIDO: estado FINAL (lo que sucederá), no estado actual ──
    // pct > 92% de la profundidad total = riesgo físico de desborde → CRITICO.
    // Con restricción definida, el semáforo sigue las condicionantes del tramo:
    // el umbral genérico 75% queda por debajo del rango operativo normal
    // (2.80–3.50 m) y marcaba ALERTA permanente en operación aceptable.
    let status: CPStatus;
    if (pct > 0.92) {
      status = 'CRITICO';
    } else if (evaluacion_nivel) {
      status = evaluacion_nivel.estado !== 'operacion_aceptable' || Math.abs(delta_y) > 0.50
        ? 'ALERTA'
        : 'ESTABLE';
    } else if (pct > 0.75) {
      status = 'ALERTA';
    } else if (Math.abs(delta_y) > 0.50) {
      // Cambio grande (>50cm) incluso si el tirante final no es alto → ALERTA
      // porque un descenso de >50cm deja tomas sin carga hidráulica
      status = 'ALERTA';
    } else {
      status = 'ESTABLE';
    }

    // Hora sugerida de maniobra: arribo - margen de seguridad
    const maniobraMin = Math.max(0, cumMin - MANIOBRA_MARGEN_MIN);
    const maniobra_time = idx === 0 ? 'ORIGEN' : fmtTime(simBaseMin, maniobraMin);

    const hasDelivData = deliveryPoints.length > 0;

    // ── CONDUCCIÓN: factor de pérdida por tramo ──────────────────────────
    // Prioridad 1: balance hídrico real (fn_balance_hidrico_tramos) — usa fugas
    //              medidas entre escalas consecutivas. Más preciso que constante.
    // Prioridad 2: constante calibrada empíricamente (fallback si sin balance).
    const balanceTramo = balanceTramos.find(
      bt => kmMid >= bt.km_inicio && kmMid <= bt.km_fin,
    );
    let conductionK: number;
    let conductionFloor: number;
    if (balanceTramo && balanceTramo.q_entrada_m3s > 0.5) {
      // Fuga detectada como fracción del Q entrada, distribuida por km del tramo
      const tramoDist = Math.max(1, balanceTramo.km_fin - balanceTramo.km_inicio);
      const fugaFrac  = Math.max(0, Math.min(0.30,
        balanceTramo.q_fuga_detectada / balanceTramo.q_entrada_m3s,
      ));
      conductionK     = fugaFrac / tramoDist;          // pérdida por km
      conductionFloor = Math.max(0.70, 1 - fugaFrac);  // mínimo 70% llega
    } else {
      // Fallback: constantes calibradas empíricamente
      conductionK     = hasDelivData ? 0.00012 : 0.00038;
      conductionFloor = hasDelivData ? 0.97    : 0.85;
    }
    const conductionFactor = Math.max(conductionFloor, 1 - dist * conductionK);

    const tomasEnTramo = deliveryPoints.filter(
      dp => dp.is_active && dp.caudal_m3s > 0 && dp.km > kmPrev && dp.km <= kmCp,
    );
    const q_extraido      = tomasEnTramo.reduce((s, dp) => s + safeFloat(dp.caudal_m3s, 0), 0);
    const n_tomas_activas = tomasEnTramo.length;

    // q_sim: caudal FINAL que llegará a este punto (para planificación operativa)
    const q_sim_arribo  = qCur;
    const q_base_arribo = qBaseCur;

    qCur     = Math.max(0.1, qCur     * conductionFactor - q_extraido);
    qBaseCur = Math.max(0.1, qBaseCur * conductionFactor - q_extraido);

    // ── ANCLA DE COMPUERTA ────────────────────────────────────────────────
    // AFORO (medición directa SICA): válido SÓLO para describir el estado base actual.
    // En escenario futuro (qDam ≠ qBase), el aforo pertenece al instante presente;
    // aplicarlo al escenario proyectado convierte INCREMENT en DECREMENT (Bug A).
    // ORIFICIO (capacidad física): sí aplica al estado futuro — la compuerta no
    // puede pasar más de lo que su apertura permite, independiente de la hora.
    const isDeltaSim = Math.abs(qDamInit - qBaseInit) > 0.5;
    const anchorApplies = gate_source === 'ORIFICIO' || !isDeltaSim;

    let gate_anchored = false;
    if (anchorApplies && q_gate_m3s !== null && q_gate_m3s < qCur) {
      qCur = Math.max(0.1, q_gate_m3s);
      gate_anchored = true;
    }
    if (gate_anchored && q_gate_m3s !== null) {
      qBaseCur = Math.min(qBaseCur, q_gate_m3s);
    }

    return {
      id: cp.id, nombre: cp.nombre, km: kmCp,
      y_base, q_base: q_base_arribo, y_sim, q_sim: q_sim_arribo,
      delta_y, remanso_type, status,
      transit_min, cumulative_min: cumMin,
      arrival_time: fmtTime(simBaseMin, cumMin),
      celerity_ms: c, velocity_ms: v_n, froude_n: Fr,
      bordo_libre_pct: pct * 100, h_radial: h_gate,
      head_base, head_sim, head_delta, cd_used, area_gate,
      y_target, apertura_base, apertura_requerida, delta_apertura,
      q_extraido, n_tomas_activas,
      plantilla_m: b_tramo,
      tirante_diseno_m: td_tramo,
      bordo_libre_m: fb_tramo,
      canal_depth_m: canal_depth,
      capacidad_diseno_m3s: qdis,
      pct_capacidad_diseno: qdis > 0 ? Math.min(120, (q_sim_arribo / qdis) * 100) : 0,
      q_gate_m3s, gate_anchored, gate_source,
      wave_pct, wave_arrived, maniobra_time,
      evaluacion_nivel,
    };
  });
}
