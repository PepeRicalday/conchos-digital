/**
 * CanalReport.tsx — Reporte gerencial de estado del canal (ESTABILIZACIÓN)
 * Imprime / exporta PDF: IEC, balance hídrico, FGV, telemetría crítica.
 *
 * Impresión: abre una ventana nueva con el contenido + CSS embebido para evitar
 * el freeze que ocurre al llamar window.print() dentro de un modal React.
 */
import React, { useRef, useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import type { IECBreakdown } from '../utils/canalIndex';
import './CanalReport.css';

// ── Tipos ────────────────────────────────────────────────────────────────────
interface CoherenciaCanal {
    qPresa: number;
    qK0Medido: number;
    qFinal: number;
    eficiencia: number | null;
    perdidaRio: number | null;
    perdidaCanal: number | null;
    nCoherentes: number;
    totalPuntos: number;
}

interface EscalaRow {
    id: string;
    nombre: string;
    km: number;
    nivel_actual?: number | null;
    nivel_max_operativo?: number | null;
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    delta_12h?: number | null;
    ultima_telemetria?: number | null;
}

interface FGVSummary {
    q_entrada: number;
    q_salida: number;
    eficiencia_conduccion: number | null;
    transit_time_h: number;
    alertas: { km: number; y: number; pct_bordo: number }[];
    criticos: { km: number; y: number }[];
}

export interface CanalReportProps {
    coherencia: CoherenciaCanal;
    iec: IECBreakdown;
    escalas: EscalaRow[];
    fgv?: FGVSummary | null;
    onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const N = (v: number | null | undefined, dec = 2, fb = '—') =>
    v != null && isFinite(v) ? v.toFixed(dec) : fb;

const semColor = (s: string) =>
    s === 'VERDE' ? '#16a34a' : s === 'AMARILLO' ? '#d97706' : '#dc2626';

function formatTs(ts?: number | null): string {
    if (!ts) return 'Sin datos';
    const min = (Date.now() - ts) / 60_000;
    if (min < 1)    return 'Hace < 1 min';
    if (min < 60)   return `Hace ${Math.floor(min)} min`;
    if (min < 1440) return `Hace ${Math.floor(min / 60)}h ${Math.floor(min % 60)}min`;
    return 'Más de 1 día';
}

// ── Componente ───────────────────────────────────────────────────────────────
const CanalReport: React.FC<CanalReportProps> = ({
    coherencia, iec, escalas, fgv, onClose,
}) => {
    const ref    = useRef<HTMLDivElement>(null);
    const iecRef = useRef<HTMLDivElement>(null);

    // CSS custom properties para IEC (colores + anchos de barra dinámicos)
    useEffect(() => {
        const el = iecRef.current;
        if (!el) return;
        const c = semColor(iec.semaforo);
        el.style.setProperty('--sem-color', c);
        el.style.setProperty('--iec-pef',   `${(iec.p_eficiencia / 30) * 100}%`);
        el.style.setProperty('--iec-pcoh',  `${(iec.p_coherencia / 25) * 100}%`);
        el.style.setProperty('--iec-pfug',  `${(iec.p_fugas      / 25) * 100}%`);
        el.style.setProperty('--iec-pcrit', `${(iec.p_criticos   / 20) * 100}%`);
    }, [iec]);

    // Abre el contenido del reporte en una ventana nueva y llama window.print() ahí.
    // Esto evita el freeze causado por llamar print() dentro del modal de React,
    // que bloquea el thread JS y deja la UI congelada sin poder cerrar el diálogo.
    const handlePrint = () => {
        const bodyEl = ref.current;
        if (!bodyEl) return;

        const semC = semColor(iec.semaforo);
        const pef   = `${(iec.p_eficiencia / 30) * 100}%`;
        const pcoh  = `${(iec.p_coherencia / 25) * 100}%`;
        const pfug  = `${(iec.p_fugas      / 25) * 100}%`;
        const pcrit = `${(iec.p_criticos   / 20) * 100}%`;

        const logoUrl = `${window.location.origin}/logos/logo-srl.png`;
        const html = bodyEl.innerHTML.replace('/logos/logo-srl.png', logoUrl);

        const win = window.open('', '_blank', 'width=920,height=780,scrollbars=yes');
        if (!win) {
            alert('El navegador bloqueó la ventana emergente. Permite ventanas emergentes para este sitio e intenta de nuevo.');
            return;
        }

        win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>SICA_Canal_${new Date().toLocaleDateString('en-CA')}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; font-size: 10pt; color: #0f172a; background: #fff; padding: 28px 36px; }
  /* ── Header ── */
  .rpt-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid #0f172a; margin-bottom: 18px; gap: 12px; }
  .rpt-header-brand { display: flex; align-items: center; gap: 12px; }
  .rpt-logo { height: 42px; width: auto; }
  .rpt-title { font-size: 13pt; font-weight: 700; color: #0f172a; letter-spacing: .4px; font-family: Arial, sans-serif; }
  .rpt-subtitle { font-size: 8pt; color: #475569; font-family: Arial, sans-serif; margin-top: 2px; }
  .rpt-header-meta { text-align: right; }
  .rpt-meta-date { font-size: 8pt; color: #475569; font-family: Arial, sans-serif; }
  .rpt-meta-mode { font-size: 7pt; font-weight: 700; color: #0284c7; letter-spacing: 1px; font-family: Arial, sans-serif; margin-top: 3px; }
  /* ── Sections ── */
  .rpt-section { margin-bottom: 20px; page-break-inside: avoid; }
  .rpt-section-title { font-size: 7.5pt; font-weight: 800; letter-spacing: 1.2px; color: #475569; font-family: Arial, sans-serif; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 10px; }
  /* ── IEC ── */
  .rpt-iec-row { display: flex; gap: 18px; align-items: flex-start; }
  .rpt-iec-score { min-width: 96px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 3px solid ${semC}; border-radius: 10px; padding: 10px 14px; text-align: center; }
  .rpt-iec-num { font-size: 30pt; font-weight: 900; font-family: Arial, sans-serif; line-height: 1; color: ${semC}; }
  .rpt-iec-den { font-size: 9pt; color: #64748b; font-family: Arial, sans-serif; }
  .rpt-iec-sem { font-size: 7pt; font-weight: 800; letter-spacing: 1px; font-family: Arial, sans-serif; color: ${semC}; margin-top: 4px; }
  .rpt-iec-components { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .rpt-iec-comp { display: grid; grid-template-columns: 150px 1fr 50px 60px; align-items: center; gap: 8px; font-family: Arial, sans-serif; }
  .rpt-iec-comp-label { font-size: 8.5pt; color: #334155; }
  .rpt-iec-comp-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .rpt-iec-comp-fill { height: 100%; border-radius: 4px; background: ${semC}; }
  .iec-fill-ef   { width: ${pef};   }
  .iec-fill-coh  { width: ${pcoh};  }
  .iec-fill-fug  { width: ${pfug};  }
  .iec-fill-crit { width: ${pcrit}; }
  .rpt-iec-comp-pts { font-size: 8.5pt; font-weight: 700; font-family: Arial, sans-serif; text-align: right; }
  .rpt-iec-comp-raw { font-size: 7.5pt; color: #64748b; font-family: Arial, sans-serif; }
  .rpt-iec-texto { font-size: 8pt; color: #64748b; font-style: italic; margin-top: 8px; font-family: Arial, sans-serif; }
  .rpt-val-crit { color: #dc2626 !important; }
  /* ── Balance ── */
  .rpt-balance-chain { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .rpt-bc-node { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 16px; text-align: center; min-width: 100px; }
  .rpt-bc-label { font-size: 7pt; font-weight: 700; color: #64748b; font-family: Arial, sans-serif; letter-spacing: .5px; text-transform: uppercase; }
  .rpt-bc-val { font-size: 13pt; font-weight: 800; color: #0f172a; font-family: Arial, sans-serif; }
  .rpt-bc-arrow { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; min-width: 60px; }
  .rpt-bc-loss { font-size: 9pt; font-weight: 700; color: #dc2626; font-family: Arial, sans-serif; }
  .rpt-bc-dist { font-size: 7pt; color: #94a3b8; font-family: Arial, sans-serif; }
  .rpt-balance-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .rpt-bkpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 3px; }
  .rpt-bkpi span { font-size: 7pt; color: #64748b; font-family: Arial, sans-serif; }
  .rpt-bkpi b { font-size: 11pt; font-weight: 800; color: #0f172a; font-family: Arial, sans-serif; }
  /* ── Tables ── */
  .rpt-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; font-family: Arial, sans-serif; }
  .rpt-table th { background: #0f172a; color: #fff; padding: 5px 8px; text-align: left; font-weight: 700; font-size: 7.5pt; }
  .rpt-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  .rpt-table tr:nth-child(even) td { background: #f8fafc; }
  .rpt-row-crit td { background: #fff1f2 !important; color: #991b1b !important; font-weight: 600; }
  .rpt-row-alert td { background: #fffbeb !important; color: #92400e !important; }
  .rpt-mt { margin-top: 10px; }
  /* ── Footer ── */
  .rpt-footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; font-size: 7pt; color: #94a3b8; font-family: Arial, sans-serif; }
</style>
</head>
<body>
${html}
</body>
</html>`);

        win.document.close();

        // Espera a que cargue la imagen del logo antes de imprimir
        const img = win.document.querySelector('img');
        const doPrint = () => { win.focus(); win.print(); win.close(); };
        if (img) {
            img.onload  = doPrint;
            img.onerror = doPrint; // imprimir igualmente si falla la imagen
            // Timeout de seguridad: si la imagen tarda más de 2s, imprimir de todas formas
            setTimeout(doPrint, 2000);
        } else {
            setTimeout(doPrint, 300);
        }
    };

    const fecha = new Date().toLocaleString('es-MX', {
        timeZone: 'America/Chihuahua',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    const alertasTop = [...escalas]
        .filter(e => e.km >= 0 && e.nivel_actual != null && e.nivel_max_operativo != null)
        .map(e => ({
            ...e,
            pct: ((e.nivel_actual! / e.nivel_max_operativo!) * 100),
        }))
        .filter(e => e.pct >= 80)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 8);

    const incoherentes = [...escalas]
        .filter(e => e.km >= 0 && e.gasto_actual != null)
        .filter((e, i, arr) => {
            if (i === 0) return false;
            const prev = arr[i - 1];
            const delta = prev.gasto_actual! > 0
                ? ((e.gasto_actual! - prev.gasto_actual!) / prev.gasto_actual!) * 100
                : 0;
            return delta > 15;
        });

    return (
        <div className="rpt-overlay" onClick={onClose}>
            <div className="rpt-dialog" onClick={e => e.stopPropagation()}>
                {/* Toolbar */}
                <div className="rpt-toolbar">
                    <span className="rpt-toolbar-title">REPORTE GERENCIAL — CANAL CONCHOS</span>
                    <div className="rpt-toolbar-actions">
                        <button type="button" className="rpt-btn-print" onClick={() => handlePrint()}>
                            <Printer size={14} /> Imprimir / PDF
                        </button>
                        <button type="button" className="rpt-btn-close" onClick={onClose} title="Cerrar reporte" aria-label="Cerrar reporte">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Contenido imprimible */}
                <div className="rpt-body" ref={ref}>
                    {/* Encabezado */}
                    <div className="rpt-header">
                        <div className="rpt-header-brand">
                            <img src="/logos/logo-srl.png" alt="SRL" className="rpt-logo" />
                            <div>
                                <div className="rpt-title">REPORTE DE ESTADO HIDRÁULICO</div>
                                <div className="rpt-subtitle">CANAL PRINCIPAL CONCHOS — DISTRITO 005</div>
                            </div>
                        </div>
                        <div className="rpt-header-meta">
                            <div className="rpt-meta-date">{fecha}</div>
                            <div className="rpt-meta-mode">MODO ESTABILIZACIÓN</div>
                        </div>
                    </div>

                    {/* IEC Scorecard */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">ÍNDICE DE ESTADO DEL CANAL (IEC)</h2>
                        <div className="rpt-iec-row" ref={iecRef} data-sem={iec.semaforo}>
                            <div className="rpt-iec-score">
                                <span className="rpt-iec-num">{iec.iec}</span>
                                <span className="rpt-iec-den">/100</span>
                                <span className="rpt-iec-sem">{iec.semaforo}</span>
                            </div>
                            <div className="rpt-iec-components">
                                {([
                                    ['Eficiencia hidráulica', 'ef',   iec.p_eficiencia, 30, iec.inputs.eficiencia_pct],
                                    ['Coherencia de escalas', 'coh',  iec.p_coherencia, 25, iec.inputs.coherencia_pct],
                                    ['Ausencia de fugas',     'fug',  iec.p_fugas,      25, iec.inputs.fuga_pct],
                                    ['Niveles operativos',    'crit', iec.p_criticos,   20, iec.inputs.criticos_pct],
                                ] as [string, string, number, number, number | null][]).map(([label, key, pts, max, raw]) => (
                                    <div key={key} className="rpt-iec-comp">
                                        <span className="rpt-iec-comp-label">{label}</span>
                                        <div className="rpt-iec-comp-bar">
                                            <div className={`rpt-iec-comp-fill iec-fill-${key}`} />
                                        </div>
                                        <span className="rpt-iec-comp-pts">{pts}/{max}</span>
                                        {raw != null && <span className="rpt-iec-comp-raw">({raw.toFixed(1)}%)</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <p className="rpt-iec-texto">{iec.texto}</p>
                    </section>

                    {/* Balance hídrico */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">BALANCE HÍDRICO</h2>
                        <div className="rpt-balance-chain">
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">PRESA</div>
                                <div className="rpt-bc-val">{N(coherencia.qPresa, 2)} m³/s</div>
                            </div>
                            <div className="rpt-bc-arrow">
                                <div className="rpt-bc-loss">−{N(coherencia.perdidaRio, 2)}</div>
                                <div className="rpt-bc-dist">36 km río</div>
                            </div>
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">K0+000</div>
                                <div className="rpt-bc-val">{N(coherencia.qK0Medido, 2)} m³/s</div>
                            </div>
                            <div className="rpt-bc-arrow">
                                <div className="rpt-bc-loss">−{N(coherencia.perdidaCanal, 2)}</div>
                                <div className="rpt-bc-dist">104 km canal</div>
                            </div>
                            <div className="rpt-bc-node">
                                <div className="rpt-bc-label">K104</div>
                                <div className="rpt-bc-val">{N(coherencia.qFinal, 2)} m³/s</div>
                            </div>
                        </div>
                        <div className="rpt-balance-kpis">
                            <div className="rpt-bkpi">
                                <span>Eficiencia canal</span>
                                <b>{N(coherencia.eficiencia, 1)}%</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Coherencia de escalas</span>
                                <b>{coherencia.nCoherentes}/{coherencia.totalPuntos} puntos</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Pérdida río (36 km)</span>
                                <b>{N(coherencia.perdidaRio, 2)} m³/s</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Pérdida canal (104 km)</span>
                                <b>{N(coherencia.perdidaCanal, 2)} m³/s</b>
                            </div>
                        </div>
                    </section>

                    {/* FGV (si disponible) */}
                    {fgv && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">MODELACIÓN HIDRÁULICA FGV</h2>
                            <div className="rpt-balance-kpis">
                                <div className="rpt-bkpi"><span>Q entrada simulado</span><b>{N(fgv.q_entrada, 2)} m³/s</b></div>
                                <div className="rpt-bkpi"><span>Q salida simulado</span><b>{N(fgv.q_salida, 2)} m³/s</b></div>
                                <div className="rpt-bkpi"><span>Eficiencia conducción FGV</span><b>{N(fgv.eficiencia_conduccion, 1)}%</b></div>
                                <div className="rpt-bkpi"><span>Tiempo de tránsito</span><b>{N(fgv.transit_time_h, 1)} h</b></div>
                                <div className="rpt-bkpi"><span>Puntos de alerta FGV</span><b>{fgv.alertas.length}</b></div>
                                <div className="rpt-bkpi"><span>Puntos críticos FGV</span><b className={fgv.criticos.length > 0 ? 'rpt-val-crit' : ''}>{fgv.criticos.length}</b></div>
                            </div>
                            {fgv.criticos.length > 0 && (
                                <table className="rpt-table rpt-mt">
                                    <thead>
                                        <tr><th>KM</th><th>Tirante (m)</th><th>Estado</th></tr>
                                    </thead>
                                    <tbody>
                                        {fgv.criticos.map((c, i) => (
                                            <tr key={i} className="rpt-row-crit">
                                                <td>K{c.km.toFixed(1)}</td>
                                                <td>{c.y.toFixed(3)} m</td>
                                                <td>CRÍTICO</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    )}

                    {/* Escalas en alerta */}
                    {alertasTop.length > 0 && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">ESCALAS EN ZONA DE ALERTA / CRÍTICO</h2>
                            <table className="rpt-table">
                                <thead>
                                    <tr><th>Nombre</th><th>KM</th><th>Nivel (m)</th><th>Nivel Máx (m)</th><th>% Bordo</th><th>Gasto (m³/s)</th><th>Último dato</th></tr>
                                </thead>
                                <tbody>
                                    {alertasTop.map(e => (
                                        <tr key={e.id} className={e.pct >= 92 ? 'rpt-row-crit' : 'rpt-row-alert'}>
                                            <td>{e.nombre}</td>
                                            <td>{e.km.toFixed(1)}</td>
                                            <td>{N(e.nivel_actual, 3)}</td>
                                            <td>{N(e.nivel_max_operativo, 2)}</td>
                                            <td>{e.pct.toFixed(1)}%</td>
                                            <td>{N(e.gasto_actual, 3)}</td>
                                            <td>{formatTs(e.ultima_telemetria)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {/* Incoherencias */}
                    {incoherentes.length > 0 && (
                        <section className="rpt-section">
                            <h2 className="rpt-section-title">PUNTOS CON INCOHERENCIA HIDRÁULICA</h2>
                            <table className="rpt-table">
                                <thead>
                                    <tr><th>Nombre</th><th>KM</th><th>Gasto (m³/s)</th><th>Observación</th></tr>
                                </thead>
                                <tbody>
                                    {incoherentes.map(e => (
                                        <tr key={e.id} className="rpt-row-alert">
                                            <td>{e.nombre}</td>
                                            <td>{e.km.toFixed(1)}</td>
                                            <td>{N(e.gasto_actual, 3)}</td>
                                            <td>Incremento anómalo aguas abajo</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {/* Footer */}
                    <div className="rpt-footer">
                        <span>SICA 005 — Conchos Digital · Generado automáticamente</span>
                        <span>{fecha}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CanalReport;
