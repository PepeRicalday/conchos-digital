import { memo, useEffect, useRef, useState } from 'react';
import type { PuntoSerie, ScaleReading, Zone } from '../../utils/controlEscalasZonas';

/** Ancho real del contenedor (ResizeObserver); el SVG se dibuja a 1:1 para que el texto no se encoja. */
function useAncho(inicial = 720): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement | null>(null);
    const [w, setW] = useState(inicial);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const medir = () => {
            const a = Math.round(el.getBoundingClientRect().width);
            if (a > 0) setW(prev => (Math.abs(prev - a) > 1 ? a : prev));
        };
        medir();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

const fm = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'S/D' : v.toFixed(d));

// ─── Perfil longitudinal del canal: nivel por km con su banda operativa ───
interface PerfilProps {
    zones: Zone[];
    vaciado: boolean;
    onSeleccionar: (id: string) => void;
}

const ESTADO_COLOR: Record<string, string> = {
    en_rango: 'var(--sc-ok)', bajo: 'var(--sc-crit)', alto: 'var(--sc-crit)', vaciado: 'var(--sc-sky)',
    referencia: 'var(--sc-violet)', stale: 'var(--sc-warn)', arrastre: 'var(--sc-t3)', sd: 'var(--sc-t3)',
};

export const PerfilNiveles = memo(function PerfilNiveles({ zones, vaciado, onSeleccionar }: PerfilProps) {
    const [ref, w] = useAncho();
    const escalas = zones.flatMap(z => z.scales);
    const H = w < 520 ? 210 : 250;
    const L = 40, R = 26, T = 14, B = 34;
    const iw = Math.max(80, w - L - R), ih = H - T - B;
    const kmMax = Math.max(104, ...escalas.map(s => s.km));
    const maxOp = Math.max(0, ...escalas.map(s => s.maxOperational ?? 0));
    const minOp = escalas.map(s => s.minOperational).filter((v): v is number => v != null);
    const yMax = Math.max(4, Math.ceil(Math.max(maxOp, ...escalas.map(s => s.currentLevel ?? 0)) * 1.1));
    const x = (km: number) => L + (km / kmMax) * iw;
    const y = (v: number) => T + ih - (Math.min(Math.max(v, 0), yMax) / yMax) * ih;
    const bandaMin = minOp.length ? Math.min(...minOp) : null;

    // Con 14 escalas en ~270 px (teléfono) los puntos quedan a pocos píxeles: el toque elige el MÁS CERCANO en x,
    // en vez de depender de que el dedo caiga exactamente sobre un marcador de 12 px.
    const seleccionarCercano = (e: React.MouseEvent<SVGSVGElement>) => {
        const caja = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - caja.left;
        const cerca = escalas.reduce<ScaleReading | null>((m, s) => (m == null || Math.abs(x(s.km) - px) < Math.abs(x(m.km) - px) ? s : m), null);
        if (cerca) onSeleccionar(cerca.id);
    };

    // Etiquetas de Km: una por kilómetro redondeado y separadas ≥ 26 px (en teléfono 62/64/68 quedaban encimadas).
    const etiquetasKm = escalas.reduce<ScaleReading[]>((acc, s) => {
        const prev = acc[acc.length - 1];
        return !prev || (Math.round(s.km) !== Math.round(prev.km) && x(s.km) - x(prev.km) >= 26) ? [...acc, s] : acc;
    }, []);

    const conNivel = escalas.filter(s => s.currentLevel != null);
    const linea = conNivel.map((s, i) => `${i ? 'L' : 'M'}${x(s.km).toFixed(1)},${y(s.currentLevel as number).toFixed(1)}`).join(' ');
    const resumen = `Perfil longitudinal del canal, Km 0 a ${kmMax}: ${conNivel.length} de ${escalas.length} escalas con nivel`;

    return (
        <div ref={ref} className="ce-perfil">
            <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="group" aria-label={resumen} onClick={seleccionarCercano}>
                {/* fondo por zona */}
                {zones.map((z, i) => {
                    const k0 = z.scales[0]?.km ?? 0;
                    const k1 = zones[i + 1]?.scales[0]?.km ?? kmMax;
                    return (
                        <g key={z.id}>
                            <rect x={x(k0)} y={T} width={Math.max(0, x(k1) - x(k0))} height={ih} fill={i % 2 ? 'rgba(255,255,255,0.025)' : 'transparent'} />
                            <text x={x(k0) + 4} y={T + 11} className="ce-perfil-zona">{`Z${i + 1}`}</text>
                        </g>
                    );
                })}
                {/* rejilla horizontal */}
                {Array.from({ length: yMax + 1 }, (_, v) => (
                    <g key={v}>
                        <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} className="ce-perfil-rejilla" />
                        <text x={L - 6} y={y(v) + 4} textAnchor="end" className="ce-perfil-eje">{v} m</text>
                    </g>
                ))}
                {/* banda operativa de riego (no aplica en vaciado) */}
                {bandaMin != null && maxOp > 0 && (
                    <g>
                        <rect x={L} y={y(maxOp)} width={iw} height={Math.max(0, y(bandaMin) - y(maxOp))} className={vaciado ? 'ce-perfil-banda ce-perfil-banda-off' : 'ce-perfil-banda'} />
                        <text x={w - R - 4} y={y(maxOp) - 4} textAnchor="end" className="ce-perfil-eje">{vaciado ? 'Rango de riego (no aplica en vaciado)' : `Rango operativo ${fm(bandaMin, 1)}–${fm(maxOp, 1)} m`}</text>
                    </g>
                )}
                {/* línea del nivel (solo une escalas con nivel; S/D deja hueco visible por falta de marcador) */}
                {linea && <path d={linea} className="ce-perfil-linea" />}
                {/* eje x */}
                {etiquetasKm.map(s => (
                    <text key={`k${s.id}`} x={x(s.km)} y={H - 8} textAnchor="middle" className="ce-perfil-eje">{Math.round(s.km)}</text>
                ))}
                <text x={L} y={H - 22} className="ce-perfil-eje">Km</text>
                {/* puntos */}
                {escalas.map(s => {
                    const color = ESTADO_COLOR[s.estado] ?? 'var(--sc-t3)';
                    const cx = x(s.km);
                    const etiqueta = `${s.name}, Km ${s.km}: ${s.currentLevel != null ? `${s.currentLevel.toFixed(2)} m` : 'sin dato'}`;
                    const activar = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeleccionar(s.id); } };
                    return (
                        <g key={s.id} role="button" tabIndex={0} aria-label={`${etiqueta}. Ir a la tarjeta`} className="ce-perfil-punto"
                            onKeyDown={activar}>
                            <title>{etiqueta}</title>
                            <rect x={cx - 23} y={T} width={46} height={ih} fill="transparent" pointerEvents="none" />
                            {s.currentLevel == null ? (
                                <text x={cx} y={y(0) - 4} textAnchor="middle" className="ce-perfil-sd">S/D</text>
                            ) : s.estado === 'arrastre' ? (
                                <circle cx={cx} cy={y(s.currentLevel)} r={5} fill="none" stroke={color} strokeWidth={2} strokeDasharray="2 2" />
                            ) : s.referencia ? (
                                <rect x={cx - 5} y={y(s.currentLevel) - 5} width={10} height={10} transform={`rotate(45 ${cx} ${y(s.currentLevel)})`} fill={color} />
                            ) : (
                                <circle cx={cx} cy={y(s.currentLevel)} r={6} fill={color} stroke="#020a14" strokeWidth={1.5} />
                            )}
                        </g>
                    );
                })}
            </svg>
            <ul className="sc-leyenda" aria-label="Leyenda del perfil">
                <li><i style={{ background: 'var(--sc-ok)', borderRadius: '50%' }} />En rango</li>
                <li><i style={{ background: 'var(--sc-crit)', borderRadius: '50%' }} />Fuera de rango</li>
                <li><i style={{ background: 'var(--sc-sky)', borderRadius: '50%' }} />Vaciado</li>
                <li><i style={{ border: '2px dashed var(--sc-t3)', borderRadius: '50%', background: 'transparent' }} />Arrastre (no es medición)</li>
                <li><i style={{ background: 'var(--sc-violet)', transform: 'rotate(45deg) scale(0.8)' }} />Referencia</li>
            </ul>
        </div>
    );
});

const etiquetaVentana = (h: number) => (h >= 48 ? `${Math.round(h / 24)} días` : `${h} h`);

// ─── Sparkline de niveles medidos (por omisión 7 días) ───
interface SparkProps { serie: PuntoSerie[]; ahoraMs: number; horas?: number; minOp: number | null; maxOp: number | null; mostrarBanda: boolean; nombre: string }

export const Sparkline = memo(function Sparkline({ serie, ahoraMs, horas = 168, minOp, maxOp, mostrarBanda, nombre }: SparkProps) {
    if (serie.length < 2) {
        return <p className="ce-spark-vacio">Sin lecturas de campo suficientes en {etiquetaVentana(horas)} para graficar.</p>;
    }
    const W = 240, H = 44, P = 4;
    const t0 = ahoraMs - horas * 3_600_000;
    const ys = serie.map(p => p.y);
    const banda = mostrarBanda && minOp != null && maxOp != null;
    const lo = Math.min(...ys, ...(banda ? [minOp as number] : []));
    const hi = Math.max(...ys, ...(banda ? [maxOp as number] : []));
    const span = Math.max(hi - lo, 0.2);
    const x = (t: number) => P + ((t - t0) / (ahoraMs - t0)) * (W - 2 * P);
    const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
    const d = serie.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    const ult = serie[serie.length - 1];
    const cambio = ult.y - serie[0].y;
    return (
        <div className="ce-spark">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
                aria-label={`${nombre}: ${serie.length} lecturas de campo en ${etiquetaVentana(horas)}, de ${serie[0].y.toFixed(2)} a ${ult.y.toFixed(2)} m`}>
                {banda && <rect x={P} y={y(maxOp as number)} width={W - 2 * P} height={Math.max(0, y(minOp as number) - y(maxOp as number))} className="ce-spark-banda" />}
                <path d={d} className="ce-spark-linea" />
                {serie.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.y)} r={i === serie.length - 1 ? 3 : 1.8} className="ce-spark-pt" />)}
            </svg>
            <span className="ce-spark-pie">{etiquetaVentana(horas)} · {cambio >= 0 ? '+' : '−'}{Math.abs(cambio).toFixed(2)} m</span>
        </div>
    );
});

export type { ScaleReading };
