import { memo, useId, useMemo, useState } from 'react';
import { Gauge, Clock, ArrowUp, ArrowDown, Minus, AlertTriangle, Droplets, Activity, Loader, Settings, Waves, Calculator, X, Info, RefreshCw } from 'lucide-react';
import { useControlEscalas } from '../hooks/useControlEscalas';
import { useModalA11y } from '../hooks/useModalA11y';
import { promedioONull, estadoCuentaEnPromedio, resumenCompuertas, porcentajeTubo, maxEjeTubo, type EstadoNivel } from '../utils/controlEscalas';
import type { ScaleReading, Zone } from '../utils/controlEscalasZonas';
import './ControlEscalas.css';

const fm = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'S/D' : v.toFixed(d));
const signo = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

/** Texto corto del estado de la escala (nunca solo color). null = en rango, no se rotula. */
function etiquetaEstado(s: ScaleReading): string | null {
    const map: Record<EstadoNivel, string | null> = {
        sd: 'Sin dato',
        stale: 'Sin telemetría vigente',
        arrastre: `Arrastre de continuidad${s.horaLectura ? ` ${s.horaLectura}` : ''} (no es medición)`,
        referencia: 'Escala de referencia',
        vaciado: 'Canal en vaciado',
        bajo: s.desviacionM != null ? `Bajo el mínimo ${signo(s.desviacionM)} m` : 'Bajo el mínimo',
        alto: s.desviacionM != null ? `Sobre el máximo ${signo(s.desviacionM)} m` : 'Sobre el máximo',
        en_rango: null,
    };
    return map[s.estado];
}

// ─── COMPONENTE: Modal de Cálculo de Radiales ───
const RadialModal = ({ scale, onClose }: { scale: ScaleReading; onClose: () => void }) => {
    const ref = useModalA11y<HTMLDivElement>(true, onClose);
    const titleId = useId();
    const { anchoRadial, altoRadial, currentLevel, nivelAbajo, gasto, aperturas } = scale;
    const totalAperturaXAncho = aperturas.reduce<number>((acc, ap) => acc + (ap != null && ap > 0 ? Math.min(ap, altoRadial) * anchoRadial : 0), 0);
    const cargaH = currentLevel != null && currentLevel > 0 && nivelAbajo !== null ? Math.max(0, currentLevel - nivelAbajo) : null;

    return (
        <div className="radial-modal-overlay" onClick={onClose} style={{
            position: 'fixed', top: 0, left: 'var(--sidebar-w, 0px)', right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '12px'
        }}>
            <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
                className="radial-modal-content" onClick={e => e.stopPropagation()} style={{
                backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '12px',
                width: '100%', maxWidth: '600px', maxHeight: '92dvh', overflowY: 'auto', padding: '24px', position: 'relative',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}>
                <button onClick={onClose} aria-label="Cerrar" style={{ position: 'absolute', top: '8px', right: '8px', minWidth: '44px', minHeight: '44px', color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <X size={20} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #1e293b', paddingBottom: '16px', paddingRight: '40px' }}>
                    <div style={{ padding: '8px', backgroundColor: 'rgba(14, 165, 233, 0.1)', borderRadius: '8px' }}>
                        <Calculator size={24} color="#0ea5e9" />
                    </div>
                    <div>
                        <h3 id={titleId} style={{ margin: 0, color: '#f8fafc', fontSize: '18px' }}>Cálculo Hidráulico de Represo</h3>
                        <p style={{ margin: 0, color: '#94a3b8', fontSize: '12px' }}>{scale.name} — Km {scale.km}</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ backgroundColor: '#1e293b', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>Carga Hidrostática (H)</div>
                        <div style={{ color: cargaH !== null ? '#0ea5e9' : '#94a3b8', fontSize: '24px', fontWeight: 'bold' }}>
                            {cargaH !== null ? <>{cargaH.toFixed(2)} <small style={{ fontSize: '14px' }}>m</small></> : 'S/D'}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                            Tirante arriba ({fm(currentLevel)}m) - Tirante abajo ({nivelAbajo !== null ? `${nivelAbajo.toFixed(2)}m` : 'sin dato'})
                        </div>
                    </div>

                    <div style={{ backgroundColor: '#1e293b', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
                        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>Gasto Total Calculado (Q)</div>
                        <div style={{ color: gasto != null ? '#10b981' : '#94a3b8', fontSize: '24px', fontWeight: 'bold' }}>
                            {gasto != null ? <>{gasto.toFixed(3)} <small style={{ fontSize: '14px' }}>m³/s</small></> : 'S/D'}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>
                            {gasto != null ? 'Calculado con la lectura de campo más reciente' : 'Sin lectura de campo vigente'}
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '16px', color: '#f8fafc', fontSize: '14px', fontWeight: 'bold' }}>
                    Desglose Operativo por Compuerta <span style={{ color: '#0ea5e9', fontWeight: 'normal', fontSize: '12px' }}>({anchoRadial}m x {altoRadial}m)</span>
                </div>

                <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                        <thead style={{ backgroundColor: '#0b1120', color: '#94a3b8' }}>
                            <tr>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Radial</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Apertura (a)</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Área Expuesta (A)</th>
                                <th style={{ padding: '10px 12px', fontWeight: 'bold' }}>Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aperturas.map((ap, i) => {
                                const area = ap != null ? Math.min(ap, altoRadial) * anchoRadial : null;
                                const excede = ap != null && ap > altoRadial && altoRadial > 0;
                                return (
                                    <tr key={i} style={{ borderTop: '1px solid #334155', backgroundColor: ap != null && ap > 0 ? 'rgba(14, 165, 233, 0.05)' : 'transparent' }}>
                                        <td style={{ padding: '10px 12px', color: '#e2e8f0', fontWeight: 'bold' }}>R{i + 1}</td>
                                        <td style={{ padding: '10px 12px', color: ap != null && ap > 0 ? '#38bdf8' : '#94a3b8' }}>{ap != null ? `${ap.toFixed(2)} m` : 'S/D'}</td>
                                        <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>{area != null ? `${area.toFixed(2)} m²` : 'S/D'}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {ap == null ? (
                                                <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 'bold' }}>S/D</span>
                                            ) : ap > 0 ? (
                                                <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', border: '1px solid rgba(16,185,129,0.2)' }}>
                                                    ABIERTA{excede ? ' (apertura > alto: revisar)' : ''}
                                                </span>
                                            ) : (
                                                <span style={{ backgroundColor: 'rgba(100, 116, 139, 0.1)', color: '#94a3b8', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', border: '1px solid rgba(100,116,139,0.2)' }}>CERRADA</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {totalAperturaXAncho > 0 && (
                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.2)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Info size={18} color="#0ea5e9" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }}>
                            Área total de sección destapada: <b style={{ color: '#fff' }}>{totalAperturaXAncho.toFixed(2)} m²</b>.
                            El gasto (<b>Q</b>) depende de la carga hidrostática y del factor de calibración de la escala.
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── COMPONENTE: Mini Diagrama de Radiales (SVG inline) ───
const RadialGateDiagram = ({ scale, onOpenModal }: { scale: ScaleReading; onOpenModal: () => void }) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const { pzasRadiales, anchoRadial, altoRadial, aperturas, currentLevel, nivelAbajo } = scale;
    if (pzasRadiales <= 0) return null;

    const nivel = currentLevel ?? 0;
    const W = 150;
    const H = 80;
    const baseLine = 70;
    const pxPerMeter = 45 / Math.max(altoRadial * 1.3, nivel * 1.3, (nivelAbajo ?? 0) * 1.3, 2);
    const gateAreaW = W - 30; // reserva 20px para franja de aguas abajo
    const gateWidth = gateAreaW / pzasRadiales;
    const pillarW = 4;
    const effectiveGW = gateWidth - pillarW;
    const startX = 10;
    const abajoX = startX + gateAreaW + pillarW + 2;
    const abajoW = W - abajoX - 2;

    const waterY = baseLine - (nivel * pxPerMeter);
    const waterYAbajo = nivelAbajo !== null ? baseLine - (nivelAbajo * pxPerMeter) : null;
    const cargaH = currentLevel != null && nivelAbajo !== null ? Math.max(0, currentLevel - nivelAbajo) : null;

    const comp = resumenCompuertas(aperturas);
    const gArriba = `wGrad${uid}`, gAbajo = `wGradAbajo${uid}`;

    return (
        <button type="button" className="radial-diagram-section hover-effect" onClick={onOpenModal}
            style={{ cursor: 'pointer', transition: 'all 0.2s ease', textAlign: 'inherit', font: 'inherit', color: 'inherit' }}
            aria-label={`Ver cálculo hidráulico de ${scale.name}`}>
            <div className="radial-diagram-header">
                <Settings size={10} />
                <span>{pzasRadiales} Radiales ({anchoRadial}m × {altoRadial}m)</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="radial-svg" role="img" aria-label={`${scale.name}: ${comp.estado === 'S/D' ? 'compuertas sin dato' : `${comp.abiertas} de ${pzasRadiales} compuertas abiertas`}`}>
                <defs>
                    <linearGradient id={gArriba} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#0284c7" stopOpacity="0.5" />
                    </linearGradient>
                    <linearGradient id={gAbajo} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#7e22ce" stopOpacity="0.55" />
                    </linearGradient>
                </defs>

                {currentLevel != null && currentLevel > 0 && (
                    <>
                        <rect x={startX} y={Math.max(8, waterY)} width={gateAreaW + pillarW} height={baseLine - Math.max(8, waterY)} fill={`url(#${gArriba})`} />
                        <line x1={0} y1={waterY} x2={abajoX} y2={waterY} stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 2" opacity={0.5} />
                    </>
                )}

                <line x1={abajoX} y1={12} x2={abajoX} y2={baseLine} stroke="#475569" strokeWidth="1" strokeDasharray="2 2" opacity={0.5} />
                {waterYAbajo !== null && (
                    <>
                        <rect x={abajoX} y={Math.max(8, waterYAbajo)} width={abajoW} height={baseLine - Math.max(8, waterYAbajo)} fill={`url(#${gAbajo})`} />
                        <line x1={abajoX} y1={waterYAbajo} x2={W} y2={waterYAbajo} stroke="#c084fc" strokeWidth="1" strokeDasharray="2 2" opacity={0.8} />
                    </>
                )}

                <line x1={0} y1={baseLine} x2={W} y2={baseLine} stroke="#475569" strokeWidth="2" />

                {Array.from({ length: pzasRadiales + 1 }).map((_, i) => {
                    const px = startX + i * gateWidth;
                    return (
                        <g key={i}>
                            <rect x={px} y={12} width={pillarW} height={baseLine - 12} fill="#334155" stroke="#0f172a" strokeWidth="0.5" />
                            {i < pzasRadiales && (() => {
                                const apRaw = aperturas[i];
                                const ap = apRaw ?? 0;
                                const gx = px + pillarW;
                                const gatePxH = altoRadial * pxPerMeter;
                                const liftPx = ap * pxPerMeter;
                                const isOpen = ap > 0;
                                const sinDato = apRaw == null;

                                return (
                                    <g opacity={sinDato ? 0.45 : 1}>
                                        {isOpen && (
                                            <rect x={gx + 1} y={baseLine - liftPx} width={effectiveGW - 2} height={liftPx} fill="#0ea5e9" opacity="0.7" rx="1" />
                                        )}
                                        <rect
                                            x={gx}
                                            y={baseLine - gatePxH - liftPx}
                                            width={effectiveGW}
                                            height={gatePxH}
                                            fill={isOpen ? '#fbbf24' : '#64748b'}
                                            stroke={isOpen ? '#f59e0b' : '#475569'}
                                            strokeWidth="1"
                                            rx="2"
                                            strokeDasharray={sinDato ? '2 1.5' : undefined}
                                        />
                                        <line x1={gx} y1={baseLine - gatePxH - liftPx} x2={gx + effectiveGW} y2={baseLine - liftPx} stroke="#0f172a" strokeWidth="0.5" opacity="0.3" />
                                        {pzasRadiales <= 6 && (
                                            <text x={gx + effectiveGW / 2} y={baseLine - gatePxH - liftPx + gatePxH / 2 + 3} textAnchor="middle" fill={isOpen ? '#0f172a' : '#94a3b8'} fontSize="7" fontWeight="bold">
                                                R{i + 1}
                                            </text>
                                        )}
                                        {isOpen && pzasRadiales <= 6 && (
                                            <text x={gx + effectiveGW / 2} y={baseLine - liftPx / 2 + 3} textAnchor="middle" fill="#fff" fontSize="6" fontWeight="bold">
                                                {ap.toFixed(2)}
                                            </text>
                                        )}
                                    </g>
                                );
                            })()}
                        </g>
                    );
                })}
            </svg>
            <div className="radial-status-row">
                <span className={`radial-badge ${comp.estado === 'ABIERTAS' ? 'open' : 'closed'}`}>
                    {comp.estado === 'S/D' ? 'Compuertas S/D'
                        : comp.estado === 'ABIERTAS' ? `${comp.abiertas}/${pzasRadiales} Abiertas` : 'Todas Cerradas'}
                </span>
                <span className="radial-badge carga" title="Carga hidrostática = nivel arriba - nivel abajo">
                    H {cargaH !== null ? `${cargaH.toFixed(2)}m` : 'S/D'}
                </span>
            </div>
        </button>
    );
};

// ─── COMPONENTE: Barra de Gasto / Volumen en Caja ───
const GastoVolumeBar = ({ scale, eje }: { scale: ScaleReading; eje: number }) => {
    const pct = porcentajeTubo(scale.currentLevel, eje);
    const isHigh = scale.estado === 'alto';
    const isLow = scale.estado === 'bajo';

    return (
        <div className="gasto-volume-section">
            <div className="gasto-row">
                <Waves size={12} />
                <span className="gasto-label">Q =</span>
                <span className="gasto-value">{scale.gasto != null ? scale.gasto.toFixed(3) : 'S/D'}</span>
                {scale.gasto != null && <span className="gasto-unit">m³/s</span>}
            </div>
            <div className="nivel-abajo-row">
                <ArrowDown size={10} />
                <span>Aguas abajo: {scale.nivelAbajo !== null ? `${scale.nivelAbajo.toFixed(2)}m` : 'S/D'}</span>
            </div>
            <div className="volume-bar-container" title="Nivel respecto al eje de la escala (no es volumen almacenado)">
                <div className="volume-bar-track">
                    <div
                        className={`volume-bar-fill ${isHigh ? 'high' : isLow ? 'low' : 'normal'}`}
                        style={{ width: `${pct ?? 0}%` }}
                    />
                </div>
                <span className="volume-percent">{pct != null ? `${pct.toFixed(0)}%` : 'S/D'}</span>
            </div>
        </div>
    );
};

// ─── COMPONENTE: Scale Gauge (Vertical) ───
const ScaleGauge = memo(({ scale, zoneColor, onOpenModal }: { scale: ScaleReading; zoneColor: string; onOpenModal: (scale: ScaleReading) => void }) => {
    const eje = maxEjeTubo(scale.maxOperational, scale.currentLevel);
    const levelPercent = porcentajeTubo(scale.currentLevel, eje);
    const minPercent = porcentajeTubo(scale.minOperational, eje);
    const maxPercent = porcentajeTubo(scale.maxOperational, eje);
    const marcas = Array.from({ length: Math.floor(eje) + 1 }, (_, i) => Math.floor(eje) - i);

    const delta = scale.deltaM;
    const isRising = delta != null && delta > 0.02;
    const isFalling = delta != null && delta < -0.02;

    const hasRadiales = scale.pzasRadiales > 0;
    const etiqueta = etiquetaEstado(scale);
    const dimmed = scale.estado === 'arrastre' || scale.estado === 'stale';

    return (
        <div className={`scale-gauge-card ${scale.alerta ? 'warning' : ''} ${hasRadiales ? 'has-radiales' : ''}`}>
            <div className="gauge-header">
                <span className="gauge-name">{scale.name}</span>
                <span className="gauge-km">Km {scale.km}</span>
            </div>

            <div className="gauge-body-row">
                <div className="gauge-container">
                    <div className="gauge-bar">
                        {minPercent != null && maxPercent != null && (
                            <div
                                className="gauge-zone operational"
                                style={{ bottom: `${minPercent}%`, height: `${maxPercent - minPercent}%`, backgroundColor: `${zoneColor}20` }}
                            />
                        )}
                        {minPercent != null && (
                            <div className="gauge-marker min" style={{ bottom: `${minPercent}%` }}>
                                <span>Min {fm(scale.minOperational, 1)}</span>
                            </div>
                        )}
                        {maxPercent != null && (
                            <div className="gauge-marker max" style={{ bottom: `${maxPercent}%` }}>
                                <span>Max {fm(scale.maxOperational, 1)}</span>
                            </div>
                        )}

                        {levelPercent != null && (
                            <div
                                className="gauge-fill"
                                style={{ height: `${levelPercent}%`, backgroundColor: scale.alerta ? '#ef4444' : zoneColor, opacity: dimmed ? 0.4 : 1 }}
                            />
                        )}

                        <div
                            className="level-indicator"
                            style={{ bottom: `${Math.min(Math.max(levelPercent ?? 0, 8), 92)}%`, borderColor: zoneColor }}
                        >
                            <span className="level-value">{scale.currentLevel != null ? `${scale.currentLevel.toFixed(2)}m` : 'S/D'}</span>
                        </div>
                    </div>

                    <div className="gauge-scale">
                        {marcas.map(m => (
                            <div key={m} className="scale-tick">
                                <span>{m}m</span>
                            </div>
                        ))}
                    </div>
                </div>

                {hasRadiales && <RadialGateDiagram scale={scale} onOpenModal={() => onOpenModal(scale)} />}
            </div>

            {hasRadiales && <GastoVolumeBar scale={scale} eje={eje} />}

            <div className="movement-section">
                <div className="reading-row">
                    <Clock size={12} className="text-slate-500" />
                    <span className="reading-label">AM{scale.horaAm ? ` ${scale.horaAm}` : ''}</span>
                    <span className="reading-value">{fm(scale.amReading)}{scale.amReading != null ? 'm' : ''}</span>
                </div>
                <div className="reading-row">
                    <Clock size={12} className="text-slate-500" />
                    <span className="reading-label">PM{scale.horaPm ? ` ${scale.horaPm}` : ''}</span>
                    <span className="reading-value">{fm(scale.pmReading)}{scale.pmReading != null ? 'm' : ''}</span>
                </div>
                <div className={`delta-row ${isRising ? 'rising' : isFalling ? 'falling' : 'stable'}`}>
                    {isRising ? <ArrowUp size={14} /> : isFalling ? <ArrowDown size={14} /> : <Minus size={14} />}
                    <span>{delta == null ? 'Δ S/D (falta una lectura)' : `Δ ${signo(delta)}m`}</span>
                </div>
            </div>

            {etiqueta && (
                scale.alerta ? (
                    <div className="warning-badge">
                        <AlertTriangle size={12} />
                        <span>{etiqueta}</span>
                    </div>
                ) : (
                    <div className="ce-estado-badge" data-estado={scale.estado}>{etiqueta}</div>
                )
            )}
        </div>
    );
});

// Component: Zone Card
const ZoneCard = memo(({ zone, onOpenModal }: { zone: Zone; onOpenModal: (scale: ScaleReading) => void }) => {
    const avgLevel = promedioONull(zone.scales.filter(s => estadoCuentaEnPromedio(s.estado)).map(s => s.currentLevel));
    const hasWarning = zone.scales.some(s => s.alerta);
    // Q de zona = gasto de la escala de cabecera (menor km). Las escalas de una zona están en serie sobre el
    // mismo cauce: sumar sus gastos mediría la misma agua varias veces. El balance tramo a tramo vive en BalanceHidraulico.tsx.
    const qCabecera = zone.scales[0]?.gasto ?? null;
    const radialScales = zone.scales.filter(s => s.pzasRadiales > 0);

    return (
        <div className="zone-card" style={{ borderColor: zone.color }}>
            <div className="zone-header" style={{ backgroundColor: `${zone.color}15` }}>
                <div className="zone-title">
                    <div className="zone-dot" style={{ backgroundColor: zone.color }} />
                    <h3>{zone.name}</h3>
                    <span className="zone-count">{zone.scales.length} escalas</span>
                    {radialScales.length > 0 && (
                        <span className="zone-radial-count">
                            <Settings size={12} />
                            {radialScales.length} represos
                        </span>
                    )}
                </div>
                <div className="zone-summary">
                    <div className="summary-stat" title="Promedio de escalas con medición vigente (sin arrastres ni referencias)">
                        <Droplets size={16} style={{ color: zone.color }} />
                        <span className="stat-value">{avgLevel != null ? `${avgLevel.toFixed(2)}m` : 'S/D'}</span>
                        <span className="stat-label">Promedio</span>
                    </div>
                    {qCabecera != null && qCabecera > 0 && (
                        <div className="summary-stat" title={`Gasto medido en ${zone.scales[0]?.name} (cabecera de zona, Km ${zone.scales[0]?.km})`}>
                            <Waves size={16} style={{ color: '#0ea5e9' }} />
                            <span className="stat-value" style={{ color: '#0ea5e9' }}>{qCabecera.toFixed(2)}</span>
                            <span className="stat-label">m³/s Cabecera</span>
                        </div>
                    )}
                    {hasWarning && (
                        <div className="zone-warning" role="img" aria-label="Hay escalas fuera de rango">
                            <AlertTriangle size={14} />
                        </div>
                    )}
                </div>
            </div>

            <div className="zone-gauges">
                {zone.scales.map(scale => (
                    <ScaleGauge key={scale.id} scale={scale} zoneColor={zone.color} onOpenModal={onOpenModal} />
                ))}
            </div>
        </div>
    );
});

const EJE_PROMEDIO_M = 4;

// Main Component
const ControlEscalas = () => {
    const { zones, cargado, error, avisos, actualizadoMs, vaciado, esHoy, recargar } = useControlEscalas();
    const [selectedScaleModal, setSelectedScaleModal] = useState<ScaleReading | null>(null);

    const resumen = useMemo(() => {
        const all = zones.flatMap(z => z.scales);
        const contables = all.filter(s => estadoCuentaEnPromedio(s.estado));
        const conDelta = all.filter(s => s.deltaM != null);
        const cabecera = zones[0]?.scales[0];
        return {
            total: all.length,
            alertas: all.filter(s => s.alerta).length,
            sinMedicion: all.filter(s => s.estado === 'sd' || s.estado === 'stale' || s.estado === 'arrastre').length,
            promedio: promedioONull(contables.map(s => s.currentLevel)),
            avgDelta: promedioONull(conDelta.map(s => s.deltaM)),
            represos: all.filter(s => s.pzasRadiales > 0).length,
            cabecera,
        };
    }, [zones]);

    if (!cargado) {
        return (
            <div className="escalas-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }} role="status" aria-label="Cargando niveles">
                <Loader size={32} className="spin" style={{ color: 'var(--color-primary)' }} />
            </div>
        );
    }

    if (error && zones.length === 0) {
        return (
            <div className="escalas-container" style={{ textAlign: 'center', padding: '3rem' }}>
                <AlertTriangle size={32} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                <p style={{ color: '#ef4444' }}>No se pudieron leer las escalas: {error}</p>
                <button type="button" className="ce-reintentar" onClick={() => { void recargar(); }}><RefreshCw size={14} /> Reintentar</button>
            </div>
        );
    }

    const { total, alertas, sinMedicion, promedio, avgDelta, represos, cabecera } = resumen;
    const qCabeceraCanal = cabecera?.gasto ?? null;
    const horaActualizado = actualizadoMs != null
        ? new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' }).format(actualizadoMs)
        : null;

    return (
        <div className="escalas-container">
            <header className="page-header">
                <div>
                    <h2 className="text-2xl font-bold text-white">Control de Niveles y Represos</h2>
                    <p className="text-slate-400 text-sm">Monitoreo de Niveles Operativos y Compuertas Radiales (Km 0 - Km 104)</p>
                </div>

                <div className="header-stats">
                    <div className="stat-chip">
                        <Gauge size={16} />
                        <span>{total} Escalas</span>
                    </div>
                    <div className="stat-chip" style={{ color: '#0ea5e9', borderColor: 'rgba(14,165,233,0.3)', backgroundColor: 'rgba(14,165,233,0.1)' }}>
                        <Settings size={16} />
                        <span>{represos} Represos</span>
                    </div>
                    <div className={`stat-chip ${alertas > 0 ? 'warning' : vaciado ? '' : 'success'}`}>
                        <Activity size={16} />
                        <span>{vaciado ? 'Alertas de riego suspendidas' : `${alertas} Alertas`}</span>
                    </div>
                    {sinMedicion > 0 && (
                        <div className="stat-chip" title="Escalas sin lectura de campo vigente (sin dato, vencida o solo arrastre de continuidad)">
                            <Minus size={16} />
                            <span>{sinMedicion} sin medición vigente</span>
                        </div>
                    )}
                    <div className={`stat-chip ${avgDelta == null ? '' : avgDelta >= 0 ? 'rising' : 'falling'}`}>
                        {avgDelta == null ? <Minus size={16} /> : avgDelta >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                        <span>{avgDelta == null ? 'Δ S/D (12h)' : `Δ ${signo(avgDelta)}m (12h)`}</span>
                    </div>
                    {qCabeceraCanal != null && qCabeceraCanal > 0 && (
                        <div className="stat-chip" style={{ color: '#0ea5e9', borderColor: 'rgba(14,165,233,0.3)', backgroundColor: 'rgba(14,165,233,0.1)' }} title={`Gasto medido en ${cabecera?.name} (cabecera del canal, Km ${cabecera?.km})`}>
                            <Waves size={16} />
                            <span>Q Cabecera: {qCabeceraCanal.toFixed(2)} m³/s</span>
                        </div>
                    )}
                </div>
            </header>

            {vaciado && esHoy && (
                <div className="ce-aviso" role="status">
                    <Info size={16} />
                    <span>Canal en <b>VACIADO</b>: el rango operativo de riego (mín–máx) no aplica y no se generan alertas por nivel bajo.</span>
                </div>
            )}
            {(avisos.length > 0 || error) && (
                <div className="ce-aviso ce-aviso-crit" role="alert">
                    <AlertTriangle size={16} />
                    <span>Datos incompletos{avisos.length ? `: no se pudo leer ${avisos.join(' y ')}` : `: ${error}`}. Lo mostrado puede estar desactualizado.</span>
                    <button type="button" className="ce-reintentar" onClick={() => { void recargar(); }}><RefreshCw size={14} /> Reintentar</button>
                </div>
            )}
            {horaActualizado && (
                <p className="ce-actualizado"><Clock size={12} /> Datos al corte de {horaActualizado} (hora de Chihuahua); se refrescan solos.</p>
            )}

            <section className="overall-indicator">
                <div className="indicator-header">
                    <h3>Nivel Promedio General del Canal</h3>
                    <p>Escalas de control con medición vigente, Km 0 - Km 104 (sin referencias ni arrastres)</p>
                </div>

                <div className="indicator-content">
                    <div className="main-gauge">
                        <div className="gauge-visual">
                            <div className="gauge-track">
                                {[1, 2, 3, 4].map(m => (
                                    <div key={m} className="gauge-segment" style={{ left: `${(m / EJE_PROMEDIO_M) * 100}%` }}>
                                        <span>{m}m</span>
                                    </div>
                                ))}
                                {promedio != null && (
                                    <div
                                        className="gauge-pointer"
                                        style={{
                                            left: `${Math.min(100, (promedio / EJE_PROMEDIO_M) * 100)}%`,
                                            backgroundColor: alertas > 0 ? '#f59e0b' : '#10b981'
                                        }}
                                    />
                                )}
                            </div>
                            <div className="gauge-value-display">
                                <span className="value">{promedio != null ? promedio.toFixed(2) : 'S/D'}</span>
                                {promedio != null && <span className="unit">m</span>}
                            </div>
                        </div>
                    </div>

                    <div className="zone-averages-strip">
                        {zones.map(zone => {
                            const zoneAvg = promedioONull(zone.scales.filter(s => estadoCuentaEnPromedio(s.estado)).map(s => s.currentLevel));
                            return (
                                <div key={zone.id} className="zone-avg-chip" style={{ borderColor: zone.color }}>
                                    <div className="chip-dot" style={{ backgroundColor: zone.color }} />
                                    <span className="chip-name">{zone.name}</span>
                                    <span className="chip-value" style={{ color: zone.color }}>{zoneAvg != null ? `${zoneAvg.toFixed(2)}m` : 'S/D'}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <div className="zones-grid">
                {zones.map(zone => (
                    <ZoneCard key={zone.id} zone={zone} onOpenModal={setSelectedScaleModal} />
                ))}
            </div>

            {zones.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                    <Gauge size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                    <p>No hay escalas configuradas.</p>
                </div>
            )}

            {selectedScaleModal && (
                <RadialModal scale={selectedScaleModal} onClose={() => setSelectedScaleModal(null)} />
            )}
        </div>
    );
};

export default ControlEscalas;
