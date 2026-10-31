import { memo } from 'react';
import type { BandaHistorica } from '../../utils/suficiencia';

const W = 240, H = 64, N = 365;

/** Camino con segmentos continuos (un null corta la línea: S/D es hueco, nunca 0). */
function camino(serie: (number | null)[], x: (d: number) => number, y: (v: number) => number, hasta = serie.length - 1): string {
    let d = '', abierto = false;
    for (let i = 0; i <= Math.min(hasta, serie.length - 1); i++) {
        const v = serie[i];
        if (v == null) { abierto = false; continue; }
        d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
        abierto = true;
    }
    return d;
}

/**
 * Banda histórica por día del ciclo (1-oct → 30-sep): envolvente mín–máx de los ciclos pasados, mediana punteada,
 * el ciclo en curso en línea sólida y una marca en "hoy". Escala común; los huecos no se rellenan.
 */
export const BandaCiclos = memo(function BandaCiclos({ banda }: { banda: BandaHistorica }) {
    const todos = [...banda.min, ...banda.max, ...banda.actual].filter((v): v is number => v != null);
    if (todos.length === 0) return <div className="kp-banda kp-banda-sd" role="img" aria-label="Banda histórica: sin dato">Sin banda histórica</div>;
    const lo = Math.min(...todos), hi = Math.max(...todos), rango = hi - lo || 1;
    const x = (d: number) => (d / N) * W;
    const y = (v: number) => 4 + (1 - (v - lo) / rango) * (H - 8);
    // polígono de la envolvente: ida por el máximo y vuelta por el mínimo, por tramos con ambos extremos presentes
    const tramos: string[] = [];
    let ini = -1;
    for (let d = 0; d <= N + 1; d++) {
        const ok = d <= N && banda.min[d] != null && banda.max[d] != null;
        if (ok && ini < 0) ini = d;
        if (!ok && ini >= 0) {
            const idx = Array.from({ length: d - ini }, (_, k) => ini + k);
            tramos.push(`M${idx.map((i) => `${x(i).toFixed(1)} ${y(banda.max[i] as number).toFixed(1)}`).join(' L')} L${[...idx].reverse().map((i) => `${x(i).toFixed(1)} ${y(banda.min[i] as number).toFixed(1)}`).join(' L')} Z`);
            ini = -1;
        }
    }
    let ultimo = -1;
    for (let d = Math.min(banda.diaHoy, banda.actual.length - 1); d >= 0; d--) if (banda.actual[d] != null) { ultimo = d; break; }
    const pos = banda.posicion;
    return (
        <div className="kp-banda" role="img" aria-label={`Volumen de las presas por día del ciclo: banda de ${banda.ciclosUsados} ciclos anteriores (${banda.etiquetas.join(', ')}), mediana y ciclo actual${pos ? `; hoy es el número ${pos.posicion} de ${pos.de} desde el más bajo` : ''}${banda.vsMedianaPct != null ? `, ${banda.vsMedianaPct.toFixed(0)} por ciento de la mediana` : ''}`}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                {tramos.map((d, i) => <path key={i} d={d} className="kp-bc-env" />)}
                <path d={camino(banda.mediana, x, y)} className="kp-bc-med" fill="none" vectorEffect="non-scaling-stroke" />
                <path d={camino(banda.actual, x, y, banda.diaHoy)} className="kp-bc-act" fill="none" vectorEffect="non-scaling-stroke" />
                <line x1={x(banda.diaHoy)} x2={x(banda.diaHoy)} y1={0} y2={H} className="kp-bc-hoy" vectorEffect="non-scaling-stroke" />
                {ultimo >= 0 && <line x1={x(ultimo)} x2={x(ultimo)} y1={y(banda.actual[ultimo] as number)} y2={y(banda.actual[ultimo] as number)} className="kp-bc-pto" vectorEffect="non-scaling-stroke" />}
            </svg>
            <div className="kp-pron-ejes"><span>1-oct</span><span>hoy</span><span>30-sep</span></div>
        </div>
    );
});
