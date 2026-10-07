import { NDVI_RANGO, colorNdvi } from '../../utils/ndviRampa';

interface Props {
    /** Serie cronológica (null = S/D: deja hueco, no se dibuja como 0). */
    valores: (number | null)[];
    etiqueta: string;
}

const W = 72, H = 26, PAD = 4;

/** Tendencia mensual mínima. Misma escala vertical (0–0.8) en todos los módulos para que sean comparables. */
export function SparklineNdvi({ valores, etiqueta }: Props) {
    const n = valores.length;
    if (n < 2 || valores.every((v) => v == null)) return <span className="ndvi-spark-sd" aria-hidden="true">sin serie</span>;
    const [lo, hi] = NDVI_RANGO;
    const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
    const y = (v: number) => H - PAD - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 2 * PAD);
    let d = '';
    let pen = false;
    valores.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
        pen = true;
    });
    const ultimo = [...valores].reverse().find((v) => v != null) ?? null;
    const iUlt = ultimo != null ? valores.lastIndexOf(ultimo) : -1;
    return (
        <svg className="ndvi-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={etiqueta}>
            <path d={d} fill="none" stroke="#9fb3c8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            {iUlt >= 0 && ultimo != null && <circle cx={x(iUlt)} cy={y(ultimo)} r="3" fill={colorNdvi(ultimo)} stroke="#e8eef6" strokeWidth="1.2" />}
        </svg>
    );
}
