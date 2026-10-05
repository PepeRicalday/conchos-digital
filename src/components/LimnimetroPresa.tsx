import { useId, useMemo } from 'react';
import { COTAS_OFICIALES, type ConfigCotas, type CotaPresa, type TonoCota } from '../utils/cotasPresas';

/**
 * Escala limnimétrica de una presa — "carta hidrográfica".
 * Muestra el nivel actual contra las cotas oficiales (capacidad muerta, NAMO, NAME) sobre una regla
 * graduada. Si la elevación es una estimación (p. ej. Madero), se dibuja la banda de incertidumbre
 * achurada en lugar de aparentar una medición exacta. Sin nivel → no se dibuja agua (S/D, nunca 0).
 */

const COLOR: Record<TonoCota, string> = {
    muted: '#8aa0b8',
    warn: '#f59e0b',
    alert: '#f87171',
    info: '#38bdf8',
};

interface Props {
    presaId: string;
    /** Elevación actual en msnm; null = S/D. */
    nivel: number | null;
    estimada?: boolean;
    incertidumbreM?: number;
    /** Respaldo si la presa no está en COTAS_OFICIALES. */
    coronaMsnm?: number | null;
    curvaMinMsnm?: number | null;
}

const W = 340;
const TOP = 26;
const BOT = 330;
const TUBE_X = 70;
const TUBE_W = 78;

function pasoNice(rango: number): number {
    for (const p of [1, 2, 5, 10, 20, 50]) if (rango / p <= 9) return p;
    return 50;
}

const f2 = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function LimnimetroPresa({ presaId, nivel, estimada = false, incertidumbreM = 0.5, coronaMsnm, curvaMinMsnm }: Props) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const cfg: ConfigCotas = useMemo(() => {
        const c = COTAS_OFICIALES[presaId];
        if (c) return c;
        const cotas: CotaPresa[] = coronaMsnm ? [{ label: 'Corona', elev: coronaMsnm, tono: 'warn' }] : [];
        return { fondo: curvaMinMsnm ?? (nivel != null ? nivel - 10 : 0), cotas, fuente: 'Curva de capacidad' };
    }, [presaId, coronaMsnm, curvaMinMsnm, nivel]);

    const geom = useMemo(() => {
        const maxCota = Math.max(...cfg.cotas.map(c => c.elev), nivel ?? 0, cfg.fondo + 1);
        const min = cfg.fondo;
        const max = maxCota + Math.max(1, (maxCota - min) * 0.04);
        const y = (e: number) => BOT - ((e - min) / (max - min)) * (BOT - TOP);
        const paso = pasoNice(max - min);
        const ticks: number[] = [];
        for (let t = Math.ceil(min / paso) * paso; t <= max; t += paso) ticks.push(t);

        // Rótulos de la derecha: cotas + nivel, separados verticalmente para no encimarse.
        type Rot = { key: string; y: number; yRot: number; label: string; valor: string; color: string; nivel?: boolean };
        const rots: Rot[] = cfg.cotas.map(c => ({ key: c.label, y: y(c.elev), yRot: y(c.elev), label: c.label, valor: `${f2(c.elev)} m`, color: COLOR[c.tono] }));
        if (nivel != null) {
            rots.push({ key: 'nivel', y: y(nivel), yRot: y(nivel), label: 'NIVEL ACTUAL', valor: `${estimada ? '≈' : ''}${estimada ? nivel.toFixed(1) : f2(nivel)} m`, color: COLOR.info, nivel: true });
        }
        rots.sort((a, b) => a.y - b.y);
        const hueco = (a: Rot, b: Rot) => (a.nivel || b.nivel ? 52 : 34);
        for (let i = 1; i < rots.length; i++) { const g = hueco(rots[i - 1], rots[i]); if (rots[i].yRot - rots[i - 1].yRot < g) rots[i].yRot = rots[i - 1].yRot + g; }
        // si el empuje hacia abajo se pasa del fondo, reacomoda hacia arriba
        for (let i = rots.length - 2; i >= 0; i--) if (rots[i + 1].yRot > BOT + 6) { rots[i + 1].yRot = BOT + 6; const g = hueco(rots[i], rots[i + 1]); if (rots[i].yRot > rots[i + 1].yRot - g) rots[i].yRot = rots[i + 1].yRot - g; }
        return { y, ticks, rots, min, max };
    }, [cfg, nivel, estimada]);

    const { y, ticks, rots } = geom;
    const yNivel = nivel != null ? y(nivel) : null;
    const banda = estimada && nivel != null ? { y1: y(nivel + incertidumbreM), y2: y(nivel - incertidumbreM) } : null;
    const resumen = nivel == null
        ? 'Sin lectura de nivel'
        : `Nivel ${estimada ? 'estimado ' : ''}${nivel.toFixed(2)} msnm${estimada ? `, ±${incertidumbreM} m` : ''}`;

    return (
        <figure className="pr-lim" aria-label={resumen}>
            <svg viewBox={`0 0 ${W} ${BOT + 28}`} className="pr-lim-svg" role="img" aria-label={resumen} preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id={`agua-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="#0b3a5c" stopOpacity="0.95" />
                    </linearGradient>
                    <pattern id={`hatch-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="6" stroke="#e0f2fe" strokeWidth="1.4" strokeOpacity="0.85" />
                    </pattern>
                    <clipPath id={`tubo-${uid}`}>
                        <rect x={TUBE_X} y={TOP} width={TUBE_W} height={BOT - TOP} rx="3" />
                    </clipPath>
                </defs>

                {/* retícula y regla graduada */}
                {ticks.map(t => (
                    <g key={t}>
                        <line x1={TUBE_X - 8} x2={TUBE_X + TUBE_W} y1={y(t)} y2={y(t)} stroke="#1c2b40" strokeWidth="1" />
                        <line x1={TUBE_X - 8} x2={TUBE_X} y1={y(t)} y2={y(t)} stroke="#5b708a" strokeWidth="1.4" />
                        <text x={TUBE_X - 12} y={y(t) + 4} textAnchor="end" className="pr-lim-tick">{t}</text>
                    </g>
                ))}

                {/* tubo */}
                <rect x={TUBE_X} y={TOP} width={TUBE_W} height={BOT - TOP} rx="3" fill="#06111f" stroke="#2a3d57" strokeWidth="1.2" />
                {yNivel != null && (
                    <g clipPath={`url(#tubo-${uid})`}>
                        <rect x={TUBE_X} y={yNivel} width={TUBE_W} height={BOT - yNivel} fill={`url(#agua-${uid})`} className="pr-lim-agua" />
                        {banda && <rect x={TUBE_X} y={banda.y1} width={TUBE_W} height={banda.y2 - banda.y1} fill={`url(#hatch-${uid})`} />}
                    </g>
                )}

                {/* líneas de cota oficiales */}
                {cfg.cotas.map(c => (
                    <line key={c.label} x1={TUBE_X - 8} x2={TUBE_X + TUBE_W + 14} y1={y(c.elev)} y2={y(c.elev)}
                        stroke={COLOR[c.tono]} strokeWidth="1.3" strokeDasharray="5 3" />
                ))}

                {/* línea de nivel */}
                {yNivel != null && (
                    <line x1={TUBE_X - 8} x2={TUBE_X + TUBE_W + 14} y1={yNivel} y2={yNivel} stroke={COLOR.info} strokeWidth="2.2" />
                )}

                {/* rótulos a la derecha */}
                {rots.map(r => (
                    <g key={r.key}>
                        <polyline fill="none" stroke={r.color} strokeWidth="1" strokeOpacity="0.7"
                            points={`${TUBE_X + TUBE_W + 14},${r.y} ${TUBE_X + TUBE_W + 24},${r.yRot} ${TUBE_X + TUBE_W + 30},${r.yRot}`} />
                        <text x={TUBE_X + TUBE_W + 34} y={r.yRot - (r.nivel ? 8 : 2)} className={r.nivel ? 'pr-lim-rot pr-lim-rot--nivel' : 'pr-lim-rot'} fill={r.color}>{r.label}</text>
                        <text x={TUBE_X + TUBE_W + 34} y={r.yRot + (r.nivel ? 22 : 13)} className={r.nivel ? 'pr-lim-val pr-lim-val--nivel' : 'pr-lim-val'} fill={r.nivel ? '#e0f2fe' : '#c3d0e0'}>{r.valor}</text>
                    </g>
                ))}

                {nivel == null && (
                    <text x={TUBE_X + TUBE_W / 2} y={(TOP + BOT) / 2} textAnchor="middle" className="pr-lim-sd">S/D</text>
                )}

                <text x={TUBE_X} y={BOT + 20} className="pr-lim-pie">msnm · {cfg.fuente}</text>
            </svg>
            {estimada && nivel != null && (
                <figcaption className="pr-lim-nota">
                    <span className="pr-lim-hatch" aria-hidden="true" /> Banda achurada: elevación estimada ±{incertidumbreM} m
                </figcaption>
            )}
        </figure>
    );
}
