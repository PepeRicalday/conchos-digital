import type { PuntoHidro } from '../../../utils/hidroEstaciones';

interface Props {
    serie: PuntoHidro[];
    color: string;
    desdeMs: number;
    hastaMs: number;
    /** Un hueco mayor a esto (ms) corta la línea: nunca se une con una recta inventada. */
    huecoMs?: number;
    etiqueta: string;
    /** Texto de la ventana para el lector de pantalla ("24 horas" por omisión). */
    ventanaTxt?: string;
}

const W = 240;
const H = 40;

/**
 * Línea mínima de la ventana con huecos reales. Sin puntos: banda rayada "S/D".
 * Alto fijo por CSS (preserveAspectRatio="none" + trazo no escalable): crece a lo ancho sin crecer a lo alto.
 * El punto del último dato es HTML para que no se deforme en elipse.
 */
export default function Spark({ serie, color, desdeMs, hastaMs, huecoMs = 50 * 60000, etiqueta, ventanaTxt = '24 horas' }: Props) {
    const pts = serie.filter(p => p.t >= desdeMs && p.t <= hastaMs);
    if (pts.length < 2) {
        return (
            <div className="goes-spark-wrap">
                <svg className="goes-spark goes-spark--sd" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${etiqueta}: sin datos`}><rect x="0" y="0" width={W} height={H} fill="url(#goes-sd)" /></svg>
            </div>
        );
    }
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
    // Rango mínimo para que el ruido de medición no parezca una variación.
    const span = Math.max(max - min, Math.abs(max) * 0.02, 1e-6);
    const mid = (max + min) / 2;
    const lo = mid - span / 2;
    const x = (t: number) => ((t - desdeMs) / (hastaMs - desdeMs)) * (W - 6) + 3;
    const y = (v: number) => H - 4 - ((v - lo) / span) * (H - 8);
    const tramos: PuntoHidro[][] = [];
    let actual: PuntoHidro[] = [];
    for (const p of pts) {
        if (actual.length && p.t - actual[actual.length - 1].t > huecoMs) { tramos.push(actual); actual = []; }
        actual.push(p);
    }
    if (actual.length) tramos.push(actual);
    const ult = pts[pts.length - 1];
    return (
        <div className="goes-spark-wrap">
            <svg className="goes-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${etiqueta}: tendencia de ${ventanaTxt}`}>
                {tramos.map((tr, i) => tr.length > 1
                    ? <polyline key={i} points={tr.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                    : <line key={i} x1={x(tr[0].t)} x2={x(tr[0].t)} y1={y(tr[0].v) - 1} y2={y(tr[0].v) + 1} stroke={color} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
            </svg>
            <i className="goes-spark-fin" style={{ left: `${(x(ult.t) / W) * 100}%`, top: `${(y(ult.v) / H) * 100}%`, background: color }} aria-hidden="true" />
        </div>
    );
}

/** Patrón rayado compartido (una sola definición en la página, referenciada como #goes-sd). */
export function DefsGoes() {
    return (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
            <defs>
                <pattern id="goes-sd" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="8" height="8" fill="rgba(148,163,184,0.06)" />
                    <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(148,163,184,0.28)" strokeWidth="2" />
                </pattern>
            </defs>
        </svg>
    );
}
