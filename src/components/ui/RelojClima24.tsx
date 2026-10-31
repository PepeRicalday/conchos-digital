import { memo } from 'react';
import type { PuntoHora24 } from '../../utils/dashboardExtra';
import { VIENTO_VENTANA_MS } from '../../utils/dashboardExtra';

const W = 192, H = 64, SLOT = W / 24, BASE = 50;

/**
 * Reloj lineal de las próximas 24 h: barras de ETo (hacia arriba), lluvia (colgando desde arriba), línea de temperatura y,
 * abajo, una franja de viento cuya ALTURA crece con la intensidad (la forma dice lo que el color refuerza).
 */
export const RelojClima24 = memo(function RelojClima24({ horas, ventanaLibre }: { horas: PuntoHora24[]; ventanaLibre: number | null }) {
    if (horas.length === 0) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Próximas 24 horas: sin pronóstico">Pronóstico no disponible</div>;
    const t0 = horas[0].t;
    const x = (t: number) => Math.min(W - SLOT, Math.max(0, Math.round((t - t0) / 3_600_000) * SLOT));
    const etos = horas.map((h) => h.etoMm).filter((v): v is number => v != null);
    const maxEto = Math.max(0.3, ...etos);
    const temps = horas.map((h) => h.tempC).filter((v): v is number => v != null);
    const tMin = temps.length ? Math.min(...temps) : 0, tMax = temps.length ? Math.max(...temps) : 1;
    const yT = (v: number) => 8 + (1 - (v - tMin) / (tMax - tMin || 1)) * 26;
    const linea = horas.filter((h) => h.tempC != null).map((h) => `${(x(h.t) + SLOT / 2).toFixed(1)},${yT(h.tempC as number).toFixed(1)}`).join(' ');
    const vientos = horas.map((h) => h.vientoMs).filter((v): v is number => v != null);
    const vMax = vientos.length ? Math.max(...vientos) : null;
    const lluviaTot = horas.reduce((a, h) => a + (h.lluviaMm ?? 0), 0);
    return (
        <div className="kp-pron" role="img" aria-label={`Próximas 24 horas (previsión): ETo ${etos.length ? etos.reduce((a, b) => a + b, 0).toFixed(1) : 'sin dato'} milímetros, lluvia ${lluviaTot.toFixed(1)} milímetros, temperatura de ${tMin.toFixed(0)} a ${tMax.toFixed(0)} grados, viento máximo ${vMax == null ? 'sin dato' : `${vMax.toFixed(1)} metros por segundo`}${ventanaLibre != null ? `, ${ventanaLibre} horas libres para regar` : ''}`}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                {horas.map((h, i) => h.etoMm != null && h.etoMm > 0 && <rect key={`e${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={BASE - (h.etoMm / maxEto) * 30} height={(h.etoMm / maxEto) * 30} className="kp-rc-eto" />)}
                {horas.map((h, i) => h.lluviaMm != null && h.lluviaMm > 0 && <rect key={`l${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={0} height={Math.min(h.lluviaMm, 2) / 2 * 22 + 2} className="kp-rc-lluvia" />)}
                {linea && <polyline points={linea} className="kp-rc-temp" fill="none" vectorEffect="non-scaling-stroke" />}
                <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-rc-base" vectorEffect="non-scaling-stroke" />
                {horas.map((h, i) => h.vientoMs != null && <rect key={`v${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={H - (2 + Math.min(h.vientoMs, 10) * 0.9)} height={2 + Math.min(h.vientoMs, 10) * 0.9}
                    className={h.vientoMs <= VIENTO_VENTANA_MS ? 'kp-rc-v-ok' : h.vientoMs <= 6 ? 'kp-rc-v-warn' : 'kp-rc-v-crit'} />)}
            </svg>
            <div className="kp-pron-ejes"><span>ahora</span><span>+12 h</span><span>+24 h</span></div>
        </div>
    );
});
