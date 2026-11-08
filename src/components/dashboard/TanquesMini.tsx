import { memo } from 'react';
import { anchoTanque, alturaRelleno } from '../../utils/cuencaViz';
import type { CuencaCompacta } from '../../utils/aqwpCuenca';

const COLOR: Record<string, string> = { ok: 'var(--sc-ok, #34d399)', warn: 'var(--sc-warn, #fbbf24)', crit: 'var(--sc-crit, #f87171)', sd: 'var(--sc-t3, #8396ad)' };
const ALTO = 16;

/**
 * Las presas de la cuenca como tanques en miniatura, EN LÍNEA con el texto de la tarjeta Presas (no agrega líneas): ancho ∝
 * √capacidad, relleno = % del NAMO, trama si la lectura está sin actualizar y trama gris si no hay dato (nunca 0 %).
 * Es decorativo (aria-hidden): las cifras ya están en el texto de al lado.
 */
function TanquesMiniBase({ presas }: { presas: CuencaCompacta['presas'] }) {
    if (presas.length === 0) return null;
    const maxNamo = Math.max(0, ...presas.map((p) => p.namoMm3 ?? 0));
    const anchos = presas.map((p) => Math.round(anchoTanque(p.namoMm3, maxNamo, 7, 26)));
    const total = anchos.reduce((a, w) => a + w, 0) + 3 * (presas.length - 1);
    let x = 0;
    return (
        <svg className="kp-tq-mini" width={total} height={ALTO} viewBox={`0 0 ${total} ${ALTO}`} aria-hidden="true" focusable="false">
            <defs>
                <pattern id="kp-tq-trama" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#0b1b36" strokeOpacity="0.7" strokeWidth="1.5" />
                </pattern>
            </defs>
            {presas.map((p, i) => {
                const w = anchos[i], x0 = x;
                x += w + 3;
                const h = ((ALTO - 2) * alturaRelleno(p.pct)) / 100;
                return (
                    <g key={p.ubicacionId}>
                        <title>{`${p.etiqueta}: ${p.pct == null ? 'S/D' : `${p.pct.toFixed(0)} %`}${p.sinActualizar ? ' (sin actualizar)' : ''}`}</title>
                        <rect x={x0 + 0.5} y="0.5" width={w - 1} height={ALTO - 1} rx="2" fill="none" stroke="currentColor" strokeOpacity="0.55" />
                        {p.pct != null
                            ? <>
                                <rect x={x0 + 1} y={ALTO - 1 - h} width={w - 2} height={h} fill={COLOR[p.estado] ?? COLOR.sd} />
                                {p.sinActualizar && <rect x={x0 + 1} y={ALTO - 1 - h} width={w - 2} height={h} fill="url(#kp-tq-trama)" />}
                            </>
                            : <rect x={x0 + 1} y="1" width={w - 2} height={ALTO - 2} fill="currentColor" fillOpacity="0.18" />}
                    </g>
                );
            })}
        </svg>
    );
}

export default memo(TanquesMiniBase);
