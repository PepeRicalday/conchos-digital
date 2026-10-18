import { memo, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Calculator, Clock, Droplets, Gauge, Info, Loader, Minus, RefreshCw, Settings, Waves, X } from 'lucide-react';
import { useControlEscalas } from '../hooks/useControlEscalas';
import { useModalA11y } from '../hooks/useModalA11y';
import { PaginaHero } from '../components/ui/PaginaHero';
import { TileCifra } from '../components/ui/TileCifra';
import { PerfilNiveles, Sparkline } from '../components/escalas/NivelesGraficos';
import type { ChipEstado } from '../utils/alertasVivas';
import { promedioONull, estadoCuentaEnPromedio, resumenCompuertas, porcentajeTubo, maxEjeTubo, type EstadoNivel } from '../utils/controlEscalas';
import type { ScaleReading, Zone } from '../utils/controlEscalasZonas';
import '../styles/sala-control.css';
import './ControlEscalas.css';

const fm = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'S/D' : v.toFixed(d));
const signo = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

/** Color de acento por zona (sin rojo: el rojo queda reservado para alertas). */
const ZONA_ACENTOS = ['var(--sc-s1)', 'var(--sc-s3)', 'var(--sc-warn)', 'var(--sc-violet)', 'var(--sc-sky)'];

type FiltroEscalas = 'todas' | 'alertas' | 'represos';
type OrdenEscalas = 'km' | 'desviacion';

interface InfoEstado { clase: string; corto: string; detalle: string | null }

/** Etiqueta del estado de una escala. Siempre texto (nunca solo color). */
function infoEstado(s: ScaleReading): InfoEstado {
    const hora = s.horaLectura ? ` ${s.horaLectura}` : '';
    const map: Record<EstadoNivel, InfoEstado> = {
        sd: { clase: 'sc-estado-sd', corto: 'Sin dato', detalle: 'Sin lectura para esta fecha' },
        stale: { clase: 'sc-estado-warn', corto: 'Sin telemetría', detalle: 'La última lectura de campo ya no está vigente' },
        arrastre: { clase: 'sc-estado-sd', corto: 'Arrastre', detalle: `Continuidad de medianoche${hora}: último nivel conocido, no es una medición` },
        referencia: { clase: 'sc-estado-info', corto: 'Referencia', detalle: 'Escala de referencia: solo aporta nivel, sin gasto ni rango de control' },
        vaciado: { clase: 'sc-estado-info', corto: 'Vaciado', detalle: 'Canal en vaciado: el rango de riego no aplica' },
        bajo: { clase: 'sc-estado-crit', corto: 'Bajo', detalle: s.desviacionM != null ? `Bajo el mínimo operativo ${signo(s.desviacionM)} m` : 'Bajo el mínimo operativo' },
        alto: { clase: 'sc-estado-crit', corto: 'Alto', detalle: s.desviacionM != null ? `Sobre el máximo operativo ${signo(s.desviacionM)} m` : 'Sobre el máximo operativo' },
        en_rango: { clase: 'sc-estado-ok', corto: 'En rango', detalle: null },
    };
    return map[s.estado];
}

// ─── SVG detallado de compuertas (solo dentro del modal) ───
const RadialSvg = ({ scale }: { scale: ScaleReading }) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const { pzasRadiales, altoRadial, aperturas, currentLevel, nivelAbajo } = scale;
    if (pzasRadiales <= 0) return null;

    const nivel = currentLevel ?? 0;
    const W = 150, H = 80, baseLine = 70;
    const pxPerMeter = 45 / Math.max(altoRadial * 1.3, nivel * 1.3, (nivelAbajo ?? 0) * 1.3, 2);
    const gateAreaW = W - 30;
    const gateWidth = gateAreaW / pzasRadiales;
    const pillarW = 4;
    const effectiveGW = gateWidth - pillarW;
    const startX = 10;
    const abajoX = startX + gateAreaW + pillarW + 2;
    const abajoW = W - abajoX - 2;
    const waterY = baseLine - nivel * pxPerMeter;
    const waterYAbajo = nivelAbajo !== null ? baseLine - nivelAbajo * pxPerMeter : null;
    const comp = resumenCompuertas(aperturas);
    const gArriba = `wGrad${uid}`, gAbajo = `wGradAbajo${uid}`;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="ce-radial-svg" role="img"
            aria-label={`${scale.name}: ${comp.estado === 'S/D' ? 'compuertas sin dato' : `${comp.abiertas} de ${pzasRadiales} compuertas abiertas`}`}>
            <defs>
                <linearGradient id={gArriba} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" /><stop offset="100%" stopColor="#0284c7" stopOpacity="0.5" />
                </linearGradient>
                <linearGradient id={gAbajo} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0.2" /><stop offset="100%" stopColor="#7e22ce" stopOpacity="0.55" />
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
                const apRaw = i < pzasRadiales ? aperturas[i] : null;
                const ap = apRaw ?? 0;
                const gx = px + pillarW;
                const gatePxH = altoRadial * pxPerMeter;
                const liftPx = ap * pxPerMeter;
                const isOpen = ap > 0;
                return (
                    <g key={i}>
                        <rect x={px} y={12} width={pillarW} height={baseLine - 12} fill="#334155" stroke="#0f172a" strokeWidth="0.5" />
                        {i < pzasRadiales && (
                            <g opacity={apRaw == null ? 0.45 : 1}>
                                {isOpen && <rect x={gx + 1} y={baseLine - liftPx} width={effectiveGW - 2} height={liftPx} fill="#0ea5e9" opacity="0.7" rx="1" />}
                                <rect x={gx} y={baseLine - gatePxH - liftPx} width={effectiveGW} height={gatePxH}
                                    fill={isOpen ? '#fbbf24' : '#64748b'} stroke={isOpen ? '#f59e0b' : '#475569'} strokeWidth="1" rx="2"
                                    strokeDasharray={apRaw == null ? '2 1.5' : undefined} />
                                {pzasRadiales <= 6 && (
                                    <text x={gx + effectiveGW / 2} y={baseLine - gatePxH - liftPx + gatePxH / 2 + 3} textAnchor="middle" fill={isOpen ? '#0f172a' : '#cbd5e1'} fontSize="7" fontWeight="bold">R{i + 1}</text>
                                )}
                            </g>
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

// ─── Modal de cálculo de radiales ───
const RadialModal = ({ scale, onClose }: { scale: ScaleReading; onClose: () => void }) => {
    const ref = useModalA11y<HTMLDivElement>(true, onClose);
    const titleId = useId();
    const { anchoRadial, altoRadial, currentLevel, nivelAbajo, gasto, aperturas } = scale;
    const totalAperturaXAncho = aperturas.reduce<number>((acc, ap) => acc + (ap != null && ap > 0 ? Math.min(ap, altoRadial) * anchoRadial : 0), 0);
    const cargaH = currentLevel != null && currentLevel > 0 && nivelAbajo !== null ? Math.max(0, currentLevel - nivelAbajo) : null;

    // Portal en <body>: el contenedor de página tiene animación (sc-entra) y ancla los `position: fixed` hijos a sí mismo.
    // `sc-root` en el envoltorio conserva los tokens --sc-* fuera de la página.
    return createPortal(
        <div className="sc-root ce-portal"><div className="ce-modal-fondo" onClick={onClose}>
            <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="ce-modal" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={onClose} aria-label="Cerrar" className="ce-modal-cerrar"><X size={20} /></button>
                <span className="sc-kicker">{scale.name} · Km {scale.km}</span>
                <h2 id={titleId}><Calculator size={22} aria-hidden="true" /> Cálculo hidráulico de represo</h2>

                <div className="ce-modal-cifras">
                    <div className="ce-modal-caja">
                        <span className="sc-kicker">Carga hidrostática (H)</span>
                        <div className="ce-modal-num">{cargaH !== null ? <>{cargaH.toFixed(2)}<small>m</small></> : 'S/D'}</div>
                        <p>Tirante arriba ({fm(currentLevel)} m) − tirante abajo ({nivelAbajo !== null ? `${nivelAbajo.toFixed(2)} m` : 'sin dato'})</p>
                    </div>
                    <div className="ce-modal-caja">
                        <span className="sc-kicker">Gasto calculado (Q)</span>
                        <div className="ce-modal-num">{gasto != null ? <>{gasto.toFixed(3)}<small>m³/s</small></> : 'S/D'}</div>
                        <p>{gasto != null ? 'Con la lectura de campo más reciente' : 'Sin lectura de campo vigente'}</p>
                    </div>
                </div>

                <div className="ce-modal-svg"><RadialSvg scale={scale} /></div>

                <p className="ce-modal-sub">Desglose por compuerta <span>({anchoRadial} m × {altoRadial} m)</span></p>
                <div className="sc-tabla-wrap">
                    <table className="sc-tabla">
                        <thead><tr><th scope="col">Radial</th><th scope="col">Apertura</th><th scope="col">Área expuesta</th><th scope="col">Estado</th></tr></thead>
                        <tbody>
                            {aperturas.map((ap, i) => {
                                const area = ap != null ? Math.min(ap, altoRadial) * anchoRadial : null;
                                const excede = ap != null && altoRadial > 0 && ap > altoRadial;
                                return (
                                    <tr key={i}>
                                        <th scope="row">R{i + 1}</th>
                                        <td>{ap != null ? `${ap.toFixed(2)} m` : 'S/D'}</td>
                                        <td>{area != null ? `${area.toFixed(2)} m²` : 'S/D'}</td>
                                        <td>
                                            {ap == null ? <span className="sc-estado sc-estado-sd">S/D</span>
                                                : ap > 0 ? <span className="sc-estado sc-estado-ok">Abierta{excede ? ' · apertura > alto: revisar' : ''}</span>
                                                    : <span className="sc-estado sc-estado-sd">Cerrada</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {totalAperturaXAncho > 0 && (
                    <p className="sc-aviso" style={{ marginTop: 14 }}>
                        <Info size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span>Área total destapada: <b>{totalAperturaXAncho.toFixed(2)} m²</b>. El gasto depende de la carga hidrostática y del factor de calibración de la escala.</span>
                    </p>
                )}
            </div>
        </div></div>,
        document.body,
    );
};

// ─── Barra de nivel horizontal (bullet) ───
const BarraNivel = ({ scale, eje }: { scale: ScaleReading; eje: number }) => {
    const nivelPct = porcentajeTubo(scale.currentLevel, eje);
    const minPct = porcentajeTubo(scale.minOperational, eje);
    const maxPct = porcentajeTubo(scale.maxOperational, eje);
    const sinDato = nivelPct == null;
    const bandaOff = scale.estado === 'vaciado' || scale.referencia;
    const dimmed = scale.estado === 'arrastre' || scale.estado === 'stale';
    const rango = scale.minOperational != null && scale.maxOperational != null ? `rango operativo ${fm(scale.minOperational, 1)} a ${fm(scale.maxOperational, 1)} m` : 'sin rango operativo';
    return (
        <div>
            <div className={`ce-bullet ${sinDato ? 'sc-sd' : ''}`} role="img"
                aria-label={sinDato ? 'Nivel sin dato' : `Nivel ${fm(scale.currentLevel)} m, ${rango}`}>
                {minPct != null && maxPct != null && (
                    <i className={`ce-banda ${bandaOff ? 'ce-banda-off' : ''}`} style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
                )}
                {nivelPct != null && <i className={`ce-relleno ${scale.alerta ? 'ce-relleno-alerta' : ''} ${dimmed ? 'ce-relleno-tenue' : ''}`} style={{ width: `${nivelPct}%` }} />}
                {nivelPct != null && <i className="ce-marca" style={{ left: `${nivelPct}%` }} />}
            </div>
            <div className="sc-barra-pie">
                <span>0 m</span>
                <span>{scale.minOperational != null && scale.maxOperational != null ? `Rango ${fm(scale.minOperational, 1)}–${fm(scale.maxOperational, 1)} m` : 'Sin rango'}</span>
                <span>{eje} m</span>
            </div>
        </div>
    );
};

// ─── Tira de compuertas (R1..Rn en un vistazo) ───
const TiraCompuertas = ({ scale }: { scale: ScaleReading }) => {
    const comp = resumenCompuertas(scale.aperturas);
    const textoEstado = comp.estado === 'S/D' ? 'Compuertas S/D' : comp.estado === 'ABIERTAS' ? `${comp.abiertas}/${scale.pzasRadiales} abiertas` : 'Todas cerradas';
    return (
        <div className="ce-compuertas">
            <div className="ce-comp-cab">
                <span className="sc-estado sc-estado-sd">{textoEstado}</span>
                <span className="ce-comp-q"><Waves size={12} aria-hidden="true" /> Q {scale.gasto != null ? <b>{scale.gasto.toFixed(3)} m³/s</b> : <b>S/D</b>}</span>
            </div>
            <ul className="ce-celdas" aria-label={`Compuertas de ${scale.name}`}>
                {scale.aperturas.map((ap, i) => {
                    const clase = ap == null ? 'ce-celda-sd' : ap > 0 ? 'ce-celda-abierta' : 'ce-celda-cerrada';
                    const txt = ap == null ? 'sin dato' : ap > 0 ? `abierta ${ap.toFixed(2)} m` : 'cerrada';
                    return <li key={i} className={`ce-celda ${clase}`} title={`R${i + 1}: ${txt}`} aria-label={`R${i + 1} ${txt}`}>{scale.pzasRadiales <= 6 ? `R${i + 1}` : ''}</li>;
                })}
            </ul>
        </div>
    );
};

// ─── Tarjeta por escala ───
const EscalaCard = memo(({ scale, ahoraMs, vaciado, onOpenModal }: { scale: ScaleReading; ahoraMs: number; vaciado: boolean; onOpenModal: (s: ScaleReading) => void }) => {
    const eje = maxEjeTubo(scale.maxOperational, scale.currentLevel);
    const info = infoEstado(scale);
    const delta = scale.deltaM;
    const sube = delta != null && delta > 0.02;
    const baja = delta != null && delta < -0.02;
    const tieneRadiales = scale.pzasRadiales > 0;

    return (
        <article id={`ce-esc-${scale.id}`} tabIndex={-1} className={`ce-escala ${scale.alerta ? 'ce-escala-alerta' : ''}`} aria-label={`Escala ${scale.name}`}>
            <header className="ce-escala-cab">
                <div><h4>{scale.name}</h4><span className="ce-km">Km {scale.km}</span></div>
                <span className={`sc-estado ${info.clase}`}>{info.corto}</span>
            </header>

            <div className="ce-nivel">
                <span className={`ce-nivel-num ${scale.currentLevel == null ? 'ce-sd' : ''}`}>{scale.currentLevel != null ? scale.currentLevel.toFixed(2) : 'S/D'}</span>
                {scale.currentLevel != null && <small>m</small>}
            </div>
            <BarraNivel scale={scale} eje={eje} />
            {info.detalle && <p className={`ce-detalle ${scale.alerta ? 'ce-detalle-alerta' : ''}`}>{info.detalle}</p>}

            <Sparkline serie={scale.serie} ahoraMs={ahoraMs} minOp={scale.minOperational} maxOp={scale.maxOperational}
                mostrarBanda={!vaciado && !scale.referencia} nombre={scale.name} />

            {tieneRadiales && <TiraCompuertas scale={scale} />}

            <dl className="ce-lecturas">
                <div><dt>AM{scale.horaAm ? ` ${scale.horaAm}` : ''}</dt><dd>{fm(scale.amReading)}{scale.amReading != null ? ' m' : ''}</dd></div>
                <div><dt>PM{scale.horaPm ? ` ${scale.horaPm}` : ''}</dt><dd>{fm(scale.pmReading)}{scale.pmReading != null ? ' m' : ''}</dd></div>
                {tieneRadiales && <div><dt>Aguas abajo</dt><dd>{scale.nivelAbajo != null ? `${scale.nivelAbajo.toFixed(2)} m` : 'S/D'}</dd></div>}
                {scale.deltaCentroM != null && (
                    <div title="Nivel menos el centro del rango operativo">
                        <dt>vs centro</dt><dd className={scale.alerta ? 'ce-fuera' : ''}>{signo(scale.deltaCentroM)} m</dd>
                    </div>
                )}
                <div className="ce-delta">
                    <dt>Δ 12 h</dt>
                    <dd>{sube ? <ArrowUp size={14} aria-hidden="true" /> : baja ? <ArrowDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                        {delta == null ? 'S/D' : `${signo(delta)} m`}</dd>
                </div>
            </dl>

            {tieneRadiales && (
                <button type="button" className="sc-btn ce-btn-calculo" onClick={() => onOpenModal(scale)} aria-label={`Ver cálculo hidráulico de ${scale.name}`}>
                    <Calculator size={16} aria-hidden="true" /> Ver cálculo
                </button>
            )}
        </article>
    );
});

// ─── Tarjeta de zona (colapsable) ───
const ZonaSection = memo(({ zone, acento, abierta, escalas, ahoraMs, vaciado, onOpenModal }: { zone: Zone; acento: string; abierta: boolean; escalas: ScaleReading[]; ahoraMs: number; vaciado: boolean; onOpenModal: (s: ScaleReading) => void }) => {
    const avgLevel = promedioONull(zone.scales.filter(s => estadoCuentaEnPromedio(s.estado)).map(s => s.currentLevel));
    const alertas = zone.scales.filter(s => s.alerta).length;
    // Q de zona = gasto de la escala de cabecera (menor km): las escalas están en serie sobre el mismo cauce,
    // sumar sus gastos mediría la misma agua varias veces. El balance tramo a tramo vive en BalanceHidraulico.tsx.
    const qCabecera = zone.scales[0]?.gasto ?? null;
    const represos = zone.scales.filter(s => s.pzasRadiales > 0).length;

    return (
        <details className="sc-card ce-zona" open={abierta} style={{ '--ce-acento': acento } as React.CSSProperties}>
            <summary className="ce-zona-sum">
                <span className="ce-zona-punto" aria-hidden="true" />
                <span className="ce-zona-nombre">{zone.name}</span>
                <span className="ce-zona-meta">{zone.scales.length} escalas{represos > 0 ? ` · ${represos} represos` : ''}</span>
                <span className="ce-zona-cifras">
                    <span title="Promedio de escalas con medición vigente"><Droplets size={14} aria-hidden="true" /> {avgLevel != null ? `${avgLevel.toFixed(2)} m` : 'S/D'}</span>
                    {qCabecera != null && qCabecera > 0 && <span title={`Gasto en ${zone.scales[0]?.name} (cabecera de zona)`}><Waves size={14} aria-hidden="true" /> {qCabecera.toFixed(2)} m³/s</span>}
                    {alertas > 0 && <span className="sc-estado sc-estado-crit"><AlertTriangle size={12} aria-hidden="true" /> {alertas} fuera de rango</span>}
                </span>
            </summary>
            <div className="ce-escalas">
                {escalas.length === 0
                    ? <p className="ce-vacio">Ninguna escala de esta zona coincide con el filtro.</p>
                    : escalas.map(s => <EscalaCard key={s.id} scale={s} ahoraMs={ahoraMs} vaciado={vaciado} onOpenModal={onOpenModal} />)}
            </div>
        </details>
    );
});

const horaChihuahua = (ms: number) => new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' }).format(ms);

// ─── Página ───
const ControlEscalas = () => {
    const { zones, cargado, error, avisos, actualizadoMs, vaciado, esHoy, recargar } = useControlEscalas();
    const [modal, setModal] = useState<ScaleReading | null>(null);
    const [filtro, setFiltro] = useState<FiltroEscalas>('todas');
    const [orden, setOrden] = useState<OrdenEscalas>('km');

    const r = useMemo(() => {
        const all = zones.flatMap(z => z.scales);
        const contables = all.filter(s => estadoCuentaEnPromedio(s.estado));
        const alertasLista = all.filter(s => s.alerta);
        return {
            total: all.length,
            conMedicion: contables.length,
            arrastre: all.filter(s => s.estado === 'arrastre').length,
            sinDato: all.filter(s => s.estado === 'sd' || s.estado === 'stale').length,
            alertas: alertasLista,
            promedio: promedioONull(contables.map(s => s.currentLevel)),
            avgDelta: promedioONull(all.map(s => s.deltaM)),
            represos: all.filter(s => s.pzasRadiales > 0).length,
            cabecera: zones[0]?.scales[0],
        };
    }, [zones]);

    // Del perfil a la tarjeta: abre su zona (si estaba colapsada), la centra y le da el foco.
    const irAEscala = (id: string) => {
        const el = document.getElementById(`ce-esc-${id}`);
        if (!el) { setFiltro('todas'); return; }
        const det = el.closest('details');
        if (det && !det.open) det.open = true;
        el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
        el.classList.add('ce-resalta');
        window.setTimeout(() => el.classList.remove('ce-resalta'), 1800);
    };

    const zonasVista = useMemo(() => zones.map(z => {
        let lista = z.scales.filter(s => filtro === 'alertas' ? s.alerta : filtro === 'represos' ? s.pzasRadiales > 0 : true);
        if (orden === 'desviacion') {
            lista = [...lista].sort((a, b) => Math.abs(b.desviacionM ?? -1) - Math.abs(a.desviacionM ?? -1) || a.km - b.km);
        }
        return { zone: z, lista };
    }).filter(v => filtro === 'todas' || v.lista.length > 0), [zones, filtro, orden]);

    if (!cargado) {
        return (
            <div className="sc-root sc-pagina ce-pagina" role="status" aria-label="Cargando niveles" style={{ minHeight: '50vh', alignItems: 'center', justifyContent: 'center' }}>
                <Loader size={32} className="spin" style={{ color: 'var(--sc-sky)' }} />
            </div>
        );
    }
    if (error && zones.length === 0) {
        return (
            <div className="sc-root sc-pagina ce-pagina" style={{ alignItems: 'center', padding: '3rem 0' }}>
                <p className="sc-aviso sc-aviso-crit" role="alert"><AlertTriangle size={16} aria-hidden="true" /> No se pudieron leer las escalas: {error}</p>
                <button type="button" className="sc-btn" onClick={() => { void recargar(); }}><RefreshCw size={16} aria-hidden="true" /> Reintentar</button>
            </div>
        );
    }

    const { total, conMedicion, arrastre, sinDato, alertas, promedio, avgDelta, represos, cabecera } = r;
    const hayAlertas = alertas.length > 0;

    const chips: ChipEstado[] = [];
    if (vaciado && esHoy) chips.push({ key: 'vaciado', sev: 'info', texto: 'Canal en vaciado · alertas de riego suspendidas' });
    else if (hayAlertas) chips.push({ key: 'alertas', sev: 'crit', texto: `${alertas.length} escala${alertas.length > 1 ? 's' : ''} fuera de rango` });
    else chips.push({ key: 'alertas', sev: 'ok', texto: 'Sin escalas fuera de rango' });
    if (arrastre + sinDato > 0) chips.push({ key: 'sin', sev: 'warn', texto: `${arrastre + sinDato} sin medición vigente` });
    chips.push({ key: 'delta', sev: 'info', texto: avgDelta == null ? 'Δ S/D (12 h)' : `Δ ${signo(avgDelta)} m (12 h)` });
    chips.push({ key: 'rep', sev: 'info', texto: `${represos} represos` });
    if (actualizadoMs != null) chips.push({ key: 'corte', sev: 'info', texto: `Datos al corte de ${horaChihuahua(actualizadoMs)}` });

    const lineasAlerta = alertas.slice(0, 3).map(s => <span key={s.id}><b>{s.name}</b> {s.estado === 'alto' ? 'alto' : 'bajo'} {s.desviacionM != null ? `${signo(s.desviacionM)} m` : ''}</span>);
    const abrirTodas = !hayAlertas || filtro !== 'todas';

    return (
        <div className="sc-root sc-pagina ce-pagina">
            <PaginaHero
                kicker="Tiempo real · Km 0 – Km 104"
                titulo="Control de niveles y represos"
                subtitulo="Niveles operativos y compuertas radiales por escala. Sin lectura de campo vigente se muestra S/D, nunca 0."
                chips={chips}
            />

            {vaciado && esHoy && (
                <p className="sc-aviso" role="status"><Info size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>Canal en <b>VACIADO</b>: el rango operativo de riego (mín–máx) no aplica y no se generan alertas por nivel bajo.</span></p>
            )}
            {(avisos.length > 0 || error) && (
                <div className="sc-aviso sc-aviso-crit" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>Datos incompletos{avisos.length ? `: no se pudo leer ${avisos.join(' y ')}` : `: ${error}`}. Lo mostrado puede estar desactualizado.</span>
                    <button type="button" className="sc-btn ce-reintentar" onClick={() => { void recargar(); }}><RefreshCw size={14} aria-hidden="true" /> Reintentar</button>
                </div>
            )}

            <section className="sc-pulso" aria-label="Resumen del canal">
                <TileCifra
                    etiqueta="Escalas con medición" icono={<Gauge size={16} aria-hidden="true" />} acento="var(--sc-s1)"
                    valor={String(conMedicion)} unidad={`/ ${total}`}
                    lineas={[arrastre > 0 ? `${arrastre} solo arrastre de continuidad` : 'Todas con lectura de campo', sinDato > 0 ? `${sinDato} sin dato o vencidas` : 'Ninguna sin dato']}
                />
                <TileCifra
                    etiqueta="Fuera de rango" icono={<AlertTriangle size={16} aria-hidden="true" />} acento={hayAlertas ? 'var(--sc-crit)' : 'var(--sc-ok)'}
                    valor={vaciado && esHoy ? '—' : String(alertas.length)}
                    estado={vaciado && esHoy ? { texto: 'No aplica en vaciado', tipo: 'info' } : hayAlertas ? { texto: 'Requiere atención', tipo: 'crit' } : { texto: 'En orden', tipo: 'ok' }}
                    lineas={lineaOVacia(lineasAlerta)}
                />
                <TileCifra
                    etiqueta="Nivel promedio" icono={<Droplets size={16} aria-hidden="true" />} acento="var(--sc-sky)"
                    valor={promedio != null ? promedio.toFixed(2) : null} unidad="m"
                    lineas={['Escalas de control con medición vigente', 'Sin referencias ni arrastres']}
                />
                <TileCifra
                    etiqueta="Gasto de cabecera" icono={<Waves size={16} aria-hidden="true" />} acento="var(--sc-s3)"
                    valor={cabecera?.gasto != null ? cabecera.gasto.toFixed(2) : null} unidad="m³/s"
                    lineas={[cabecera ? `Medido en ${cabecera.name} (Km ${cabecera.km})` : 'Sin escala de cabecera']}
                />
            </section>

            <section className="sc-card" aria-labelledby="ce-perfil-t">
                <span className="sc-kicker">Perfil longitudinal</span>
                <h3 id="ce-perfil-t">Nivel por kilómetro</h3>
                <PerfilNiveles zones={zones} vaciado={vaciado && esHoy} onSeleccionar={irAEscala} />
            </section>

            <div className="ce-barra" role="toolbar" aria-label="Filtros y orden">
                <div className="ce-grupo" role="group" aria-label="Filtrar escalas">
                    {([['todas', 'Todas'], ['alertas', 'Solo alertas'], ['represos', 'Solo represos']] as const).map(([k, t]) => (
                        <button key={k} type="button" className={`ce-seg ${filtro === k ? 'ce-seg-on' : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{t}</button>
                    ))}
                </div>
                <div className="ce-grupo" role="group" aria-label="Ordenar escalas">
                    {([['km', 'Por km'], ['desviacion', 'Por desviación']] as const).map(([k, t]) => (
                        <button key={k} type="button" className={`ce-seg ${orden === k ? 'ce-seg-on' : ''}`} aria-pressed={orden === k} onClick={() => setOrden(k)}>{t}</button>
                    ))}
                </div>
            </div>

            {zonasVista.map(({ zone, lista }, i) => (
                <ZonaSection
                    key={`${zone.id}-${abrirTodas || zone.scales.some(s => s.alerta)}`}
                    zone={zone} acento={ZONA_ACENTOS[i % ZONA_ACENTOS.length]} escalas={lista}
                    abierta={abrirTodas || zone.scales.some(s => s.alerta)} ahoraMs={actualizadoMs ?? 0} vaciado={vaciado && esHoy} onOpenModal={setModal}
                />
            ))}

            {zonasVista.length === 0 && (
                <p className="ce-vacio" style={{ textAlign: 'center', padding: '2rem 0' }}>
                    <Settings size={32} aria-hidden="true" style={{ opacity: 0.4 }} /><br />
                    {zones.length === 0 ? 'No hay escalas configuradas.' : 'Ninguna escala coincide con el filtro.'}
                </p>
            )}
            <p className="ce-pie"><Clock size={12} aria-hidden="true" /> Se refresca solo con cada lectura nueva y cada 5 minutos. Hora de Chihuahua.</p>

            {modal && <RadialModal scale={modal} onClose={() => setModal(null)} />}
        </div>
    );
};

function lineaOVacia(l: React.ReactNode[]): React.ReactNode[] {
    return l.length > 0 ? l : ['Ninguna escala fuera de su rango operativo'];
}

export default ControlEscalas;
