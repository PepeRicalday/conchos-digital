import { memo } from 'react';
import { Check, X, Minus } from 'lucide-react';
import type { FuenteConfianza } from '../../utils/dashboardKpisEjecutivos';

const R = 38, C = 50;
const pt = (g: number) => ({ x: C + R * Math.cos((g * Math.PI) / 180), y: C + R * Math.sin((g * Math.PI) / 180) });

/** Anillo con un segmento por fuente de datos + leyenda con ✓/✗ (la forma, no solo el color, dice cuál falla). */
export const AnilloSegmentado = memo(function AnilloSegmentado({ fuentes }: { fuentes: FuenteConfianza[] }) {
    const n = Math.max(1, fuentes.length), hueco = 6, paso = 360 / n;
    return (
        <div className="kp-anseg">
            <svg viewBox="0 0 100 100" aria-hidden="true">
                {fuentes.map((f, i) => {
                    const a1 = -90 + i * paso + hueco / 2, a2 = -90 + (i + 1) * paso - hueco / 2;
                    const p1 = pt(a1), p2 = pt(a2);
                    return <path key={f.clave} d={`M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`} fill="none" strokeWidth={9} strokeLinecap="round"
                        className={f.ok === true ? 'kp-seg-ok' : f.ok === false ? 'kp-seg-crit' : 'kp-seg-nd'} />;
                })}
            </svg>
            <ul className="kp-anseg-leyenda" aria-label="Fuentes de datos">
                {fuentes.map((f) => (
                    <li key={f.clave} className={f.ok === true ? 'kp-t-ok' : f.ok === false ? 'kp-t-crit' : 'kp-t-sd'}>
                        {f.ok === true ? <Check size={13} aria-hidden="true" /> : f.ok === false ? <X size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
                        <span>{f.nombre}</span><span className="kp-sr">{f.ok === true ? ' vigente' : f.ok === false ? ' sin datos vigentes' : ' sin saber aún'}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
});
