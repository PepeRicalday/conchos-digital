import { memo } from 'react';
import type { PuntoHora } from '../../utils/dashboardExtra';

const W = 192, H = 64, BASE = 62;

/** 48 h: barras de lluvia, línea de temperatura y banda de probabilidad. Las horas sin dato quedan en blanco. */
export const PronosticoBarras = memo(function PronosticoBarras({ horas }: { horas: PuntoHora[] }) {
    if (horas.length === 0) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Pronóstico 48 horas: sin dato">Pronóstico no disponible</div>;
    const paso = W / 48;
    const t0 = horas[0].t;
    const x = (t: number) => Math.min(W - paso, Math.max(0, ((t - t0) / 3_600_000) * paso));
    const lluvias = horas.map((h) => h.lluviaMm).filter((v): v is number => v != null);
    const maxLl = Math.max(2, ...lluvias);
    const temps = horas.map((h) => h.tempC).filter((v): v is number => v != null);
    const tMin = temps.length ? Math.min(...temps) : 0, tMax = temps.length ? Math.max(...temps) : 1;
    const yT = (v: number) => 8 + (1 - (v - tMin) / (tMax - tMin || 1)) * 34;
    const linea = horas.filter((h) => h.tempC != null).map((h) => `${(x(h.t) + paso / 2).toFixed(1)},${yT(h.tempC as number).toFixed(1)}`).join(' ');
    const totalLl = lluvias.length ? lluvias.reduce((a, b) => a + b, 0) : null;
    const probMax = Math.max(0, ...horas.map((h) => h.probPct ?? 0));
    return (
        <div className="kp-pron" role="img" aria-label={`Pronóstico 48 horas: lluvia total ${totalLl == null ? 'sin dato' : `${totalLl.toFixed(1)} milímetros`}, probabilidad máxima ${probMax.toFixed(0)} por ciento, temperatura de ${tMin.toFixed(0)} a ${tMax.toFixed(0)} grados`}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                {horas.map((h, i) => h.probPct != null && h.probPct > 0 && <rect key={`p${i}`} x={x(h.t)} y={0} width={paso} height={BASE} className="kp-pron-prob" style={{ opacity: Math.min(0.5, h.probPct / 100 * 0.5) }} />)}
                {horas.map((h, i) => h.lluviaMm != null && h.lluviaMm > 0 && <rect key={`l${i}`} x={x(h.t) + 0.5} y={BASE - (Math.min(h.lluviaMm, maxLl) / maxLl) * 30} width={Math.max(1, paso - 1)} height={(Math.min(h.lluviaMm, maxLl) / maxLl) * 30} className="kp-pron-lluvia" />)}
                {linea && <polyline points={linea} className="kp-pron-temp" fill="none" vectorEffect="non-scaling-stroke" />}
                <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-pron-base" />
            </svg>
            <div className="kp-pron-ejes"><span>ahora</span><span>+24 h</span><span>+48 h</span></div>
        </div>
    );
});
