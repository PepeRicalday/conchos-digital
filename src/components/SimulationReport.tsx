import React, { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, X } from 'lucide-react';
import './SimulationReport.css';

// ── Tipado del resultado del motor hidráulico ───────────────────────────────
interface CPResult {
  id: string; nombre: string; km: number;
  y_base: number; q_base: number; y_sim: number; q_sim: number;
  delta_y: number; remanso_type: string; status: string;
  transit_min: number; cumulative_min: number; arrival_time: string;
  celerity_ms: number; velocity_ms: number; froude_n: number;
  bordo_libre_pct: number; h_radial: number;
  head_base: number; head_sim: number; head_delta: number;
  cd_used: number; area_gate: number;
  // Límites operativos y aperturas
  y_target?:          number;   // nivel objetivo (clamped a [2.8, 3.5])
  apertura_base?:     number;   // apertura actual SICA
  apertura_requerida: number;   // apertura para mantener y_target
  delta_apertura?:    number;   // requerida - actual (+abrir, -cerrar)
  // Propagación
  wave_pct?: number;
  wave_arrived?: boolean;
  maniobra_time?: string;
}

interface SimulationReportProps {
  scenario: {
    q_base: number;
    q_sim: number;
    isRiver: boolean;
    startTime: string;          // T₀ = hora del movimiento de presa
    movimientoTime?: string;    // Hora del último movimiento de presa (display)
    date: string;
    eventType: string;
    damFuente: string;
    damBaseValue: number;
    damCurrentValue: number;
    damNivel: string;
    totalExtractionM3s: number;
  };
  results: CPResult[];
  gateBase: Record<string, number>;
  deliveryPoints: Array<{
    punto_id: string; nombre: string; km: number; tipo: string;
    caudal_m3s: number; volumen_mm3: number;
    hora_apertura: string | null; estado: string;
    modulo_nombre: string | null; is_active: boolean;
  }>;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const sf = (v: unknown, fb = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fb;
};

// const FREEBOARD = 3.2;
const DEFAULT_CD = 0.70;

function statusClass(s: string) {
  if (s === 'CRITICO') return 'rpt-badge-crit';
  if (s === 'ALERTA')  return 'rpt-badge-alert';
  return 'rpt-badge-ok';
}

function fmtDelta(dy: number): string {
  const cm = Math.round(dy * 100);
  return cm === 0 ? '0 cm' : `${cm > 0 ? '+' : ''}${cm} cm`;
}

function fmtMin(min: number): string {
  if (min < 1) return '< 1 min';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h === 0 ? `${m} min` : `${h}h ${String(m).padStart(2, '0')}min`;
}

// ── Componente Principal ─────────────────────────────────────────────────────
const SimulationReport: React.FC<SimulationReportProps> = ({
  scenario, results, gateBase, deliveryPoints, onClose,
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `SICA_Simulacion_${scenario.date.replace(/\//g, '-')}_${scenario.startTime.replace(':', '')}`,
  });

  if (!results.length) return null;

  const lastCP      = results[results.length - 1];
  const qBase       = sf(scenario.q_base);
  const qSim        = sf(scenario.q_sim);
  const deltaQ      = qSim - qBase;
  const globalEff   = qSim > 0 && lastCP ? (sf(lastCP.q_sim) / qSim) * 100 : 0;
  const qLoss       = qSim - sf(lastCP?.q_sim);
  const totalArrMin = sf(lastCP?.cumulative_min);
  const critCount   = results.filter(r => r.status === 'CRITICO').length;
  const alertCount  = results.filter(r => r.status === 'ALERTA').length;

  // Evento — auto-derive from ΔQ sign in case eventType wasn't set correctly
  const isDecrement = deltaQ < -0.5;
  const isIncrement = deltaQ > 0.5;
  const effectiveEvent = isDecrement ? 'DECREMENTO' : isIncrement ? 'INCREMENTO' : scenario.eventType;
  const eventLabel = effectiveEvent === 'INCREMENTO' ? `▲ INCREMENTO +${Math.abs(deltaQ).toFixed(1)} m³/s`
    : effectiveEvent === 'DECREMENTO' ? `▼ DECREMENTO −${Math.abs(deltaQ).toFixed(1)} m³/s`
    : effectiveEvent === 'CORTE' ? `✂ CORTE DE GASTO (−${Math.abs(deltaQ).toFixed(1)} m³/s)`
    : `◯ LLENADO INICIAL (+${Math.abs(deltaQ).toFixed(1)} m³/s)`;

  // Alertas automáticas por umbral hidráulico
  const alerts: { level: 'CRITICO' | 'ALERTA' | 'INFO'; text: string }[] = [];
  results.forEach(r => {
    if (r.status === 'CRITICO') alerts.push({
      level: 'CRITICO',
      text: `${r.nombre} (K-${r.km}): Tirante simulado ${sf(r.y_sim).toFixed(2)}m — ${sf(r.bordo_libre_pct).toFixed(0)}% del bordo libre. RIESGO DE DESBORDAMIENTO.`,
    });
    else if (r.status === 'ALERTA') alerts.push({
      level: 'ALERTA',
      text: `${r.nombre} (K-${r.km}): Tirante simulado ${sf(r.y_sim).toFixed(2)}m — ${sf(r.bordo_libre_pct).toFixed(0)}% del bordo libre. Monitoreo estrecho requerido.`,
    });
    // Apertura — INCREMENTO: solo alertar si la compuerta es cuello de botella físico.
    // NUNCA emitir alerta de CERRAR durante un INCREMENT (lógica espejo del motor UI R4).
    const G_RPT = 9.81;
    const apSica    = gateBase[r.id] ?? sf(r.h_radial, 1.25);
    const apReq     = Math.min(3.0, Math.max(0.1, sf(r.apertura_requerida)));
    const apDiff    = apReq - apSica;
    const qCapRpt   = sf(r.cd_used, DEFAULT_CD) * sf(r.area_gate)
                      * Math.sqrt(2 * G_RPT * Math.max(0.01, sf(r.y_base)));
    const esCuelloRpt = isIncrement && qCapRpt < sf(r.q_sim) * 0.90;
    if (isIncrement) {
      // Solo alerta si la compuerta es físicamente cuello de botella
      if (esCuelloRpt) {
        alerts.push({
          level: 'ALERTA',
          text: `${r.nombre}: CUELLO DE BOTELLA — capacidad compuerta ${qCapRpt.toFixed(1)} m³/s < Q proyectado ${sf(r.q_sim).toFixed(1)} m³/s. ABRIR de ${apSica.toFixed(2)}m → ${apReq.toFixed(2)}m (+${Math.abs(apDiff).toFixed(2)}m).`,
        });
      }
      // Si no es cuello de botella: sin acción — el volumen incremental pasa sin restricción.
    } else if (Math.abs(apDiff) > 0.05 && Math.abs(deltaQ) > 0.5) {
      alerts.push({
        level: 'INFO',
        text: `${r.nombre}: Para mantener escala en ${sf(r.y_base).toFixed(2)}m se requiere ajustar apertura de ${apSica.toFixed(2)}m → ${apReq.toFixed(2)}m (${apDiff > 0 ? 'ABRIR' : 'CERRAR'} ${Math.abs(apDiff).toFixed(2)}m).`,
      });
    }
  });
  if (sf(globalEff) < 90) alerts.push({
    level: 'ALERTA',
    text: `Eficiencia de conducción proyectada: ${sf(globalEff).toFixed(1)}% — Por debajo del umbral óptimo (90%). Revisar pérdidas en tramos intermedios.`,
  });
  if (alerts.length === 0) alerts.push({ level: 'INFO', text: 'Sistema hidráulico estable. Todos los puntos de control dentro de parámetros operativos.' });

  // Calcular cuántas secciones son cuello de botella en incremento (para recomendaciones)
  const G_REC = 9.81;
  const cuellosBotella = isIncrement ? results.filter(r => {
    const qCap = sf(r.cd_used, DEFAULT_CD) * sf(r.area_gate)
                 * Math.sqrt(2 * G_REC * Math.max(0.01, sf(r.y_base)));
    return qCap < sf(r.q_sim) * 0.90;
  }) : [];

  // Recomendaciones operativas
  const recs: string[] = [];
  if (deltaQ > 0.5) {
    recs.push(`INCREMENTO en régimen M1: la ola de +${Math.abs(deltaQ).toFixed(1)} m³/s se propaga aguas abajo sin acción de compuertas en condiciones normales. El canal absorbe el incremento por su capacidad excedente en backwater.`);
    recs.push(`Monitorear el arribo de la onda al tramo K-23 (estimado ${results.find(r => r.km >= 23)?.arrival_time ?? '—'}). No ejecutar cierres de compuertas — el volumen adicional debe pasar libremente.`);
    if (cuellosBotella.length > 0) {
      recs.push(`ATENCIÓN — ${cuellosBotella.length} sección(es) detectada(s) como cuello de botella físico: ${cuellosBotella.map(r => r.nombre).join(', ')}. ABRIR según columna "Ap. Requerida" ANTES del arribo indicado.`);
    } else {
      recs.push(`No se requieren ajustes de apertura en ninguna sección. La columna "Ajuste Radial" muestra "Sin acción" para todas las estructuras.`);
    }
  }
  if (deltaQ < -0.5) {
    recs.push(`DECREMENTO: Ejecutar cierres de compuertas de cola a cabeza según la columna "Hora Maniobra" del Cuadro. Cada punto debe cerrar ANTES del arribo de la onda de menor gasto.`);
    recs.push(`Verificar tirantes aguas abajo de compuertas. Posible caída de presión de succión en tomas laterales.`);
    recs.push(`Ajustar aperturas según apertura requerida para evitar vaciamiento prematuro del canal en tramos finales.`);
  }
  if (scenario.movimientoTime) {
    recs.push(`Último movimiento de presa registrado a las ${scenario.movimientoTime}. Los tiempos de arribo se calculan desde ese momento.`);
  }
  if (scenario.isRiver) recs.push(`Incluido tránsito de río Conchos (K−36 a K-0). El retardo adicional debe considerarse para la planificación de turnos.`);
  recs.push(`Confirmar lecturas de escala en campo (miras) en las estructuras con estatus ALERTA/CRÍTICO al arribo de la onda.`);
  recs.push(`Registrar cualquier desviación entre lo simulado y lo observado en el libro de maniobras para calibración del modelo.`);

  // SVG Timeline: wave propagation diagram (horizontal, K-0 left, K-104 right)
  const svgW = 520, svgH = 62;
  const PAD = 24;
  const kScale = (km: number) => PAD + (km / 104) * (svgW - 2 * PAD);

  return (
    <div className="sim-report-overlay">
      <div className="report-controls hide-on-print">
        <button onClick={handlePrint} className="rpt-btn-print">
          <Printer size={16} /> IMPRIMIR / GUARDAR PDF
        </button>
        <button onClick={onClose} className="rpt-btn-close">
          <X size={16} /> CERRAR
        </button>
      </div>

      <div className="sim-report-paper" ref={componentRef}>

        {/* ── ENCABEZADO INSTITUCIONAL ───────────────────────────────── */}
        <header className="rpt-header">
          <div className="rpt-header-logo">
            <img src="/logos/conagua_logo.png" alt="CONAGUA"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          </div>
          <div className="rpt-header-center">
            <div className="rpt-org">Comisión Nacional del Agua</div>
            <div className="rpt-sub">Dirección Local Chihuahua · Distrito de Riego No. 005 Delicias</div>
            <div className="rpt-sys">Sistema de Información de Canales Autómatas — SICA 005</div>
          </div>
          <div className="rpt-header-right">
            <div className="rpt-date">{scenario.date}</div>
            <div className="rpt-time">T₀ {scenario.startTime} h</div>
            <div className="rpt-folio">HYDRA ENGINE v1D</div>
          </div>
        </header>

        {/* ── BANDA DE TÍTULO ─────────────────────────────────────────── */}
        <div className="rpt-title-band">
          <div className="rpt-title-main">INFORME TÉCNICO DE SIMULACIÓN HIDRÁULICA</div>
          <div className="rpt-title-sub">Canal Principal Conchos · Saint-Venant 1D · {eventLabel}</div>
        </div>

        {/* ── SECCIÓN 1: PARÁMETROS DE SIMULACIÓN ────────────────────── */}
        <section className="rpt-section">
          <div className="rpt-sec-title">1. Parámetros de Simulación y Estado de Telemetría</div>
          <div className="rpt-kpi-grid rpt-kpi-grid-7">
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Q Base Presa</div>
              <div className="rpt-kpi-val blue">{qBase.toFixed(1)}</div>
              <div className="rpt-kpi-unit">m³/s</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Q Simulado</div>
              <div className="rpt-kpi-val amber">{qSim.toFixed(1)}</div>
              <div className="rpt-kpi-unit">m³/s</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">ΔQ Maniobra</div>
              <div className={`rpt-kpi-val ${deltaQ >= 0 ? 'green' : 'red'}`}>
                {deltaQ >= 0 ? '+' : ''}{deltaQ.toFixed(1)}
              </div>
              <div className="rpt-kpi-unit">m³/s</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Extracción Tomas</div>
              <div className="rpt-kpi-val teal">−{sf(scenario.totalExtractionM3s).toFixed(2)}</div>
              <div className="rpt-kpi-unit">m³/s activo</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Eficiencia Conducción</div>
              <div className={`rpt-kpi-val ${globalEff >= 90 ? 'green' : globalEff >= 85 ? 'amber' : 'red'}`}>
                {sf(globalEff).toFixed(1)}
              </div>
              <div className="rpt-kpi-unit">%</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Pérdida Canal</div>
              <div className="rpt-kpi-val red">−{sf(qLoss).toFixed(2)}</div>
              <div className="rpt-kpi-unit">m³/s</div>
            </div>
            <div className="rpt-kpi-box">
              <div className="rpt-kpi-lbl">Arribo K-104</div>
              <div className="rpt-kpi-val purple">{lastCP?.arrival_time ?? '—'}</div>
              <div className="rpt-kpi-unit">{fmtMin(totalArrMin)}</div>
            </div>
          </div>
          <div className="rpt-meta-row">
            <span><b>Fuente dato:</b> {scenario.damFuente === 'movimientos_presas' ? 'Movimientos Presa BD' : scenario.damFuente === 'lecturas_presas' ? 'Lecturas Presa BD' : 'Estimado (sin telemetría viva)'}</span>
            <span><b>Presa Boquilla:</b> {scenario.damNivel !== '—' ? `${scenario.damNivel} msnm` : 'Sin nivel disponible'}</span>
            <span><b>Secciones:</b> {results.length} nodos · <b>Tomas activas:</b> {deliveryPoints.filter(d => d.is_active).length}/{deliveryPoints.length}</span>
            <span><b>Tránsito de río:</b> {scenario.isRiver ? 'Incluido (Presa → K-0)' : 'No incluido'}</span>
            {critCount > 0 && <span className="rpt-meta-alert-crit">⚠ {critCount} sección(es) CRÍTICA(S)</span>}
            {alertCount > 0 && <span className="rpt-meta-alert-warn">⚡ {alertCount} sección(es) en ALERTA</span>}
          </div>
        </section>

        {/* ── SECCIÓN 2: CUADRO DE MANIOBRA ──────────────────────────── */}
        <section className="rpt-section">
          <div className="rpt-sec-title">2. Cuadro de Maniobra — Resultado Hidráulico por Sección</div>
          <table className="rpt-table">
            <thead>
              <tr>
                <th>Sección / Estructura</th>
                <th className="rpt-th-center">KM</th>
                <th className="rpt-th-center">Escala Base (m)</th>
                <th className="rpt-th-center">Escala Sim. (m)</th>
                <th className="rpt-th-center">Δ Escala</th>
                <th className="rpt-th-center">Ap. Actual (m)</th>
                <th className="rpt-th-center">Ap. Requerida (m)</th>
                <th className="rpt-th-center">Ajuste Radial</th>
                <th className="rpt-th-center">Arribo</th>
                {isDecrement && <th className="rpt-th-center">Hora Maniobra</th>}
                <th className="rpt-th-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                // Usar delta_apertura del motor (ya calculado con límites operativos)
                const apBase = sf(r.apertura_base, sf(gateBase[r.id], sf(r.h_radial, 1.25)));
                const apReq  = sf(r.apertura_requerida);
                const dAp    = sf(r.delta_apertura, apReq - apBase);
                const hasChange = Math.abs(deltaQ) > 0.5;

                // INCREMENTO: evaluar si la compuerta es cuello de botella físico.
                // NUNCA mostrar CERRAR durante INCREMENTO — misma regla que motor UI (R4).
                const G_TBL   = 9.81;
                const qCapTbl = sf(r.cd_used, DEFAULT_CD) * sf(r.area_gate)
                                * Math.sqrt(2 * G_TBL * Math.max(0.01, sf(r.y_base)));
                const esCuelloTbl   = isIncrement && qCapTbl < sf(r.q_sim) * 0.90;
                const esSuficTbl    = isIncrement && !esCuelloTbl;

                // Columna "Ap. Requerida": durante INCREMENT suficiente → no mostrar
                const apReqDisplay = esSuficTbl ? null : apReq;

                // Formato del ajuste operador
                let ajusteLabel = '—';
                if (hasChange) {
                  if (isIncrement) {
                    ajusteLabel = esSuficTbl
                      ? '✓ Sin acción'
                      : `▲ ABRIR ${Math.abs(dAp).toFixed(2)}m`;
                  } else {
                    if (Math.abs(dAp) < 0.03) {
                      ajusteLabel = 'Sin ajuste';
                    } else {
                      ajusteLabel = `${dAp > 0 ? '▲ ABRIR' : '▼ CERRAR'} ${Math.abs(dAp).toFixed(2)}m`;
                    }
                  }
                }
                const wavePct = sf(r.wave_pct, 1);
                const waveArrived = r.wave_arrived !== false;
                const waveIcon = waveArrived ? '✅' : wavePct > 0.1 ? '⏳' : '🕐';
                return (
                  <tr key={r.id} className={i % 2 === 0 ? 'rpt-tr-even' : 'rpt-tr-odd'}>
                    <td className="rpt-td-name">{r.nombre}</td>
                    <td className="rpt-td-center">{sf(r.km).toFixed(0)}</td>
                    <td className="rpt-td-center rpt-td-blue">{sf(r.y_base).toFixed(3)}</td>
                    <td className="rpt-td-center rpt-td-bold"
                      style={{ color: r.status === 'CRITICO' ? '#dc2626' : r.status === 'ALERTA' ? '#d97706' : '#059669' }}>
                      {sf(r.y_sim).toFixed(3)}
                    </td>
                    <td className="rpt-td-center"
                      style={{ color: r.delta_y > 0.01 ? '#b45309' : r.delta_y < -0.01 ? '#1d4ed8' : '#64748b' }}>
                      {fmtDelta(sf(r.delta_y))}
                    </td>
                    <td className="rpt-td-center">{apBase.toFixed(3)}</td>
                    <td className="rpt-td-center rpt-td-bold"
                      style={{ color: Math.abs(dAp) > 0.05 && !esSuficTbl ? '#92400e' : '#374151' }}>
                      {hasChange ? (apReqDisplay != null ? apReqDisplay.toFixed(3) : '—') : '—'}
                    </td>
                    <td className="rpt-td-center rpt-td-adj"
                      style={{ color: dAp > 0.03 ? '#b45309' : dAp < -0.03 ? '#1d4ed8' : '#64748b', fontWeight: Math.abs(dAp) > 0.05 ? 700 : 400 }}>
                      {ajusteLabel}
                    </td>
                    <td className="rpt-td-center">
                      {r.km === 0
                        ? <span className="rpt-origin">ORIGEN</span>
                        : <><b>{r.arrival_time}</b><br /><span className="rpt-td-muted">{waveIcon} {fmtMin(sf(r.cumulative_min))}</span></>}
                    </td>
                    {isDecrement && (
                      <td className="rpt-td-center" style={{ color: '#7c3aed', fontWeight: 600, fontSize: '8px' }}>
                        {r.maniobra_time ?? '—'}
                      </td>
                    )}
                    <td className="rpt-td-center">
                      <span className={`rpt-badge ${statusClass(r.status)}`}>{r.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rpt-table-note">
            * <b>Límites operativos por sección:</b> K-0 a K-80: [2.80m, 3.50m] (servicio de riego) · K-104 cola: [2.40m, 2.55m] (final del canal).
            Apertura Requerida: calculada para mantener el nivel dentro del rango operativo de cada sección.
            Fórmula: h<sub>ap</sub> = Q / (Cd · ancho · pzas · √(2g · y<sub>objetivo</sub>)).
            ✅ Onda llegó · ⏳ En tránsito · 🕐 Pendiente.
          </div>
        </section>

        {/* ── SECCIÓN 3: VOLÚMENES ENTREGADOS — PUNTOS DE ENTREGA ─────── */}
        {deliveryPoints.length > 0 && (
          <section className="rpt-section">
            <div className="rpt-sec-title">
              3. Volúmenes Entregados — Puntos de Entrega del Día
              <span className="rpt-sec-badge">
                {deliveryPoints.filter(d => d.is_active).length} ACTIVAS · −{sf(scenario.totalExtractionM3s).toFixed(3)} m³/s
              </span>
            </div>
            <table className="rpt-table rpt-table-sm">
              <thead>
                <tr>
                  <th>Punto de Entrega</th>
                  <th className="rpt-th-center">KM</th>
                  <th className="rpt-th-center">Tipo</th>
                  <th className="rpt-th-center">Módulo</th>
                  <th className="rpt-th-center">Caudal Promedio<br />(m³/s)</th>
                  <th className="rpt-th-center">Volumen Hoy<br />(Mm³)</th>
                  <th className="rpt-th-center">Apertura</th>
                  <th className="rpt-th-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {deliveryPoints.map((dp, i) => (
                  <tr key={dp.punto_id} className={i % 2 === 0 ? 'rpt-tr-even' : 'rpt-tr-odd'}>
                    <td className="rpt-td-name-sm">{dp.nombre}</td>
                    <td className="rpt-td-center">{sf(dp.km).toFixed(1)}</td>
                    <td className="rpt-td-center">
                      <span className={`rpt-tipo-badge rpt-tipo-${dp.tipo}`}>
                        {dp.tipo.toUpperCase()}
                      </span>
                    </td>
                    <td className="rpt-td-center" style={{ fontSize: '7px', color: '#475569' }}>
                      {dp.modulo_nombre ?? '—'}
                    </td>
                    <td className="rpt-td-center rpt-td-bold"
                      style={{ color: dp.is_active ? '#0d9488' : '#94a3b8' }}>
                      {dp.caudal_m3s > 0 ? dp.caudal_m3s.toFixed(4) : '—'}
                    </td>
                    <td className="rpt-td-center">
                      {dp.volumen_mm3 > 0 ? dp.volumen_mm3.toFixed(4) : '—'}
                    </td>
                    <td className="rpt-td-center" style={{ color: '#64748b', fontSize: '7px' }}>
                      {dp.hora_apertura ?? '—'}
                    </td>
                    <td className="rpt-td-center">
                      <span className={`rpt-badge ${dp.is_active ? 'rpt-badge-ok' : 'rpt-estado-cerrada'}`}>
                        {dp.estado.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
                {/* Fila de totales */}
                <tr className="rpt-tr-total">
                  <td colSpan={4} className="rpt-td-total-lbl">
                    TOTALES DEL DÍA ({deliveryPoints.filter(d => d.is_active).length} tomas activas)
                  </td>
                  <td className="rpt-td-center rpt-td-bold" style={{ color: '#0d9488' }}>
                    {deliveryPoints.filter(d => d.is_active).reduce((s, d) => s + d.caudal_m3s, 0).toFixed(4)}
                  </td>
                  <td className="rpt-td-center rpt-td-bold">
                    {deliveryPoints.reduce((s, d) => s + d.volumen_mm3, 0).toFixed(4)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
            <div className="rpt-table-note">
              * Fuente: <b>reportes_diarios</b> (Supabase) — Solo registros del día {scenario.date}.
              Estados activos: INICIO / CONTINUA / REABIERTO / MODIFICACION sin hora de cierre.
              El caudal extraído se incorpora al motor hidráulico: Q<sub>tramo_siguiente</sub> = Q<sub>entrada</sub> × k<sub>cond</sub> − Σ(Q<sub>tomas_activas</sub>).
            </div>
          </section>
        )}

        {/* ── SECCIÓN 4 (antes 3): PROPAGACIÓN DE ONDA ────────────────── */}
        <section className="rpt-section">
          <div className="rpt-sec-title">4. Diagrama de Propagación de Onda — Canal K-0 a K-104</div>
          <div className="rpt-wave-wrap">
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="rpt-wave-svg" preserveAspectRatio="xMidYMid meet">
              {/* Canal axis */}
              <line x1={PAD} y1={32} x2={svgW - PAD} y2={32} stroke="#cbd5e1" strokeWidth="2" />

              {/* KM labels on top */}
              {[0, 20, 40, 60, 80, 104].map(km => (
                <text key={km} x={kScale(km)} y={12} textAnchor="middle"
                  fontSize="7" fill="#94a3b8" fontFamily="monospace">K-{km}</text>
              ))}
              {/* Tick marks */}
              {[0, 20, 40, 60, 80, 104].map(km => (
                <line key={km} x1={kScale(km)} y1={28} x2={kScale(km)} y2={36}
                  stroke="#94a3b8" strokeWidth="1" />
              ))}

              {/* CP markers + arrival labels */}
              {results.map((r, i) => {
                const x = kScale(sf(r.km));
                const arrived = r.km === 0;
                const clr = r.status === 'CRITICO' ? '#ef4444' : r.status === 'ALERTA' ? '#f59e0b' : '#10b981';
                return (
                  <g key={r.id}>
                    <circle cx={x} cy={32} r={5} fill={clr} stroke="#fff" strokeWidth="1" />
                    <text x={x} y={i % 2 === 0 ? 48 : 58} textAnchor="middle"
                      fontSize="6.5" fill="#1e293b" fontWeight="bold" fontFamily="monospace">
                      {arrived ? 'T₀' : r.arrival_time}
                    </text>
                  </g>
                );
              })}

              {/* Wave line */}
              <polyline
                points={results.map(r => `${kScale(sf(r.km))},32`).join(' ')}
                fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="5,3" opacity="0.5"
              />

              {/* Legend */}
              <circle cx={PAD} cy={svgH - 6} r={4} fill="#10b981" />
              <text x={PAD + 7} y={svgH - 3} fontSize="7" fill="#475569">ESTABLE</text>
              <circle cx={PAD + 55} cy={svgH - 6} r={4} fill="#f59e0b" />
              <text x={PAD + 62} y={svgH - 3} fontSize="7" fill="#475569">ALERTA</text>
              <circle cx={PAD + 110} cy={svgH - 6} r={4} fill="#ef4444" />
              <text x={PAD + 117} y={svgH - 3} fontSize="7" fill="#475569">CRÍTICO</text>
              <text x={svgW - PAD} y={svgH - 3} textAnchor="end"
                fontSize="7" fill="#94a3b8" fontFamily="monospace">
                Tiempo total de propagación: {fmtMin(totalArrMin)}
              </text>
            </svg>
          </div>
        </section>

        {/* ── SECCIÓN 4: PARÁMETROS HIDRÁULICOS DETALLADOS ───────────── */}
        <section className="rpt-section">
          <div className="rpt-sec-title">5. Parámetros Hidráulicos Detallados por Sección</div>
          <table className="rpt-table rpt-table-sm">
            <thead>
              <tr>
                <th>Sección</th>
                <th className="rpt-th-center">Q sección<br />(m³/s)</th>
                <th className="rpt-th-center">y_n normal<br />(m)</th>
                <th className="rpt-th-center">y_sim<br />(m)</th>
                <th className="rpt-th-center">V media<br />(m/s)</th>
                <th className="rpt-th-center">Celeridad c<br />(m/s)</th>
                <th className="rpt-th-center">Fr</th>
                <th className="rpt-th-center">Cd</th>
                <th className="rpt-th-center">Área<br />Comp. (m²)</th>
                <th className="rpt-th-center">Bordo<br />L. %</th>
                <th className="rpt-th-center">Remanso</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'rpt-tr-even' : 'rpt-tr-odd'}>
                  <td className="rpt-td-name-sm">{r.nombre}</td>
                  <td className="rpt-td-center">{sf(r.q_sim).toFixed(2)}</td>
                  <td className="rpt-td-center rpt-td-blue">
                    {/* y_n = Manning normalDepth — no recalculated here, we show y_base as reference */}
                    {sf(r.y_base).toFixed(3)}
                  </td>
                  <td className="rpt-td-center"
                    style={{ color: r.status === 'CRITICO' ? '#dc2626' : r.status === 'ALERTA' ? '#d97706' : '#374151' }}>
                    {sf(r.y_sim).toFixed(3)}
                  </td>
                  <td className="rpt-td-center">{sf(r.velocity_ms).toFixed(3)}</td>
                  <td className="rpt-td-center">{sf(r.celerity_ms).toFixed(3)}</td>
                  <td className="rpt-td-center"
                    style={{ color: sf(r.froude_n) > 1 ? '#dc2626' : '#374151', fontWeight: sf(r.froude_n) > 1 ? 700 : 400 }}>
                    {sf(r.froude_n).toFixed(4)}
                    {sf(r.froude_n) > 1 ? ' ⚠' : ''}
                  </td>
                  <td className="rpt-td-center">{sf(r.cd_used, DEFAULT_CD).toFixed(3)}</td>
                  <td className="rpt-td-center">{sf(r.area_gate).toFixed(2)}</td>
                  <td className="rpt-td-center"
                    style={{ color: sf(r.bordo_libre_pct) > 92 ? '#dc2626' : sf(r.bordo_libre_pct) > 75 ? '#d97706' : '#374151', fontWeight: sf(r.bordo_libre_pct) > 75 ? 700 : 400 }}>
                    {sf(r.bordo_libre_pct).toFixed(1)}%
                  </td>
                  <td className="rpt-td-center">
                    <span className={r.remanso_type === 'M1' ? 'rpt-rtype rpt-m1'
                      : r.remanso_type === 'M2' ? 'rpt-rtype rpt-m2' : 'rpt-rtype rpt-m0'}>
                      {r.remanso_type}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rpt-table-note">
            Fr &lt; 1 = Régimen subcrítico (normal en canal). Fr &gt; 1 = Régimen supercrítico (∞ riesgo de resalto hidráulico). M1 = Remanso positivo (escala sube). M2 = Remanso negativo (escala baja). NORMAL = sin variación significativa (&lt;8cm).
          </div>
        </section>

        {/* ── SECCIÓN 5: BALANCE HÍDRICO ──────────────────────────────── */}
        <section className="rpt-section rpt-section-half">
          <div className="rpt-sec-title">6. Balance Hídrico del Sistema</div>
          <div className="rpt-balance-grid">
            <div className="rpt-bal-row">
              <span className="rpt-bal-lbl">Entrada al canal (Presa Boquilla)</span>
              <span className="rpt-bal-bar-wrap">
                <span className="rpt-bal-bar rpt-bal-blue" style={{ width: '100%' }} />
              </span>
              <span className="rpt-bal-val">{qSim.toFixed(2)} m³/s</span>
            </div>
            <div className="rpt-bal-row">
              <span className="rpt-bal-lbl">Caudal llegada K-104 (final)</span>
              <span className="rpt-bal-bar-wrap">
                <span className="rpt-bal-bar rpt-bal-green" style={{ width: `${Math.min(100, sf(globalEff))}%` }} />
              </span>
              <span className="rpt-bal-val">{sf(lastCP?.q_sim).toFixed(2)} m³/s</span>
            </div>
            <div className="rpt-bal-row">
              <span className="rpt-bal-lbl">Pérdida total en conducción</span>
              <span className="rpt-bal-bar-wrap">
                <span className="rpt-bal-bar rpt-bal-red" style={{ width: `${Math.min(100, (1 - sf(globalEff) / 100) * 100)}%` }} />
              </span>
              <span className="rpt-bal-val">−{sf(qLoss).toFixed(2)} m³/s</span>
            </div>
            <div className="rpt-bal-summary">
              <div className="rpt-bal-eff">
                <span>Eficiencia global</span>
                <strong style={{ color: sf(globalEff) >= 90 ? '#059669' : sf(globalEff) >= 85 ? '#d97706' : '#dc2626' }}>
                  {sf(globalEff).toFixed(1)}%
                </strong>
              </div>
              <div className="rpt-bal-eff">
                <span>Merma diaria estimada</span>
                <strong>{(sf(qLoss) * 86400 / 1e6).toFixed(3)} Mm³/día</strong>
              </div>
              <div className="rpt-bal-eff">
                <span>Merma semanal estimada</span>
                <strong>{(sf(qLoss) * 86400 * 7 / 1e6).toFixed(3)} Mm³/semana</strong>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECCIÓN 6: ALERTAS Y RECOMENDACIONES ────────────────────── */}
        <section className="rpt-section">
          <div className="rpt-sec-title">7. Alertas Operativas y Recomendaciones</div>
          <div className="rpt-alerts">
            {alerts.map((a, i) => (
              <div key={i} className={`rpt-alert-row rpt-alert-${a.level.toLowerCase()}`}>
                <span className="rpt-alert-icon">
                  {a.level === 'CRITICO' ? '⛔' : a.level === 'ALERTA' ? '⚠' : 'ℹ'}
                </span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
          <div className="rpt-recs">
            <div className="rpt-recs-title">Recomendaciones Operativas</div>
            {recs.map((r, i) => (
              <div key={i} className="rpt-rec-row">
                <span className="rpt-rec-num">{i + 1}.</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── NOTA TÉCNICA DEL MODELO ─────────────────────────────────── */}
        <div className="rpt-model-note">
          <b>Nota técnica:</b> Simulación generada con motor hidráulico Saint-Venant 1D (ecuación de onda cinemática + difusión).
          Tirante normal por iteración Newton-Raphson (Manning: n={0.015}, b=20m, z=1.5:1, S₀=1.6×10⁻⁴).
          Tiempos de arribo: celeridad dinámica c=√(gA/T) × 1.3 + V.
          Variación de escala: Δy = ΔH orificio (Δy = Q²/(Cd²·A²·2g) − Q₀²/(Cd²·A²·2g)).
          Base de datos: {scenario.damFuente} · {results.length} nodos de control sincronizados.
        </div>

        {/* ── FIRMAS ──────────────────────────────────────────────────── */}
        <div className="rpt-sigs">
          <div className="rpt-sig-box">
            <div className="rpt-sig-line" />
            <div className="rpt-sig-name">Ingeniero(a) Jefe de Módulo</div>
            <div className="rpt-sig-role">VALIDACIÓN Y AUTORIZACIÓN OPERATIVA</div>
            <div className="rpt-sig-date">Fecha: _____________ Turno: _______</div>
          </div>
          <div className="rpt-sig-box">
            <div className="rpt-sig-line" />
            <div className="rpt-sig-name">Técnico de Canal</div>
            <div className="rpt-sig-role">EJECUCIÓN DE MANIOBRA</div>
            <div className="rpt-sig-date">Fecha: _____________ Turno: _______</div>
          </div>
          <div className="rpt-sig-box">
            <div className="rpt-sig-line" />
            <div className="rpt-sig-name">SICA 005 · Hydra Engine</div>
            <div className="rpt-sig-role">VERIFICACIÓN HIDRODINÁMICA DIGITAL</div>
            <div className="rpt-sig-date">Auto-generado: {scenario.date} {scenario.startTime}</div>
          </div>
        </div>

        <div className="rpt-footer">
          SICA Dashboard DR-005 · Documento generado electrónicamente · Prohibida su alteración sin auditoría de base de datos ·
          Folio: SIM-{scenario.date.replace(/\//g, '')}-{scenario.startTime.replace(':', '')}
        </div>

      </div>
    </div>
  );
};

export default SimulationReport;
