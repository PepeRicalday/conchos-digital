import { memo } from 'react';

export interface ExtremoEsquema { gasto: number | null; vigente: boolean; edadTexto: string | null }
interface Props { k0: ExtremoEsquema; k104: ExtremoEsquema; perdidaPct: number | null }

const MAXQ = 40; // m³/s con el que se normaliza el grosor del tubo (capacidad típica del canal principal)
const grosor = (q: number | null) => 6 + Math.min(Math.max(q ?? 0, 0), MAXQ) / MAXQ * 12;
const f = (v: number | null) => (v == null ? 'S/D' : v.toFixed(1));

/**
 * Esquemático K-0 → K-104: tubo cuya altura sigue el gasto en cada extremo (la cuña es la pérdida). El flujo se anima a velocidad
 * constante (no codifica el gasto). Con una lectura vieja el tubo pasa a gris rayado, sin animación, y la edad va como texto.
 */
export const EsquemaCanal = memo(function EsquemaCanal({ k0, k104, perdidaPct }: Props) {
    const ok = k0.vigente && k104.vigente && k0.gasto != null && k104.gasto != null;
    const a = ok ? grosor(k0.gasto) : 10, b = ok ? grosor(k104.gasto) : 10;
    const cy = 22;
    const d = `M 14 ${cy - a / 2} L 186 ${cy - b / 2} L 186 ${cy + b / 2} L 14 ${cy + a / 2} Z`;
    const txt = (e: ExtremoEsquema) => (e.vigente ? f(e.gasto) : `S/D${e.edadTexto ? ` · ${e.edadTexto}` : ''}`);
    return (
        <div className="kp-esq" role="img" aria-label={`Canal K-0 a K-104. K-0: ${e0(k0)}. K-104: ${e0(k104)}.${perdidaPct != null && ok ? ` Pérdida ${perdidaPct.toFixed(0)} por ciento.` : ''}`}>
            <svg viewBox="0 0 200 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true" className={ok ? '' : 'kp-esq-off'}>
                <path d={d} className="kp-tubo" />
                {ok && <path d={`M 14 ${cy} L 186 ${cy}`} className="kp-flujo" />}
                <circle cx={14} cy={cy} r={5} className={`kp-nodo ${k0.vigente ? '' : 'kp-nodo-off'}`} />
                <circle cx={186} cy={cy} r={5} className={`kp-nodo ${k104.vigente ? '' : 'kp-nodo-off'}`} />
                {!k0.vigente && <path d="M 14 17 v 5 l 3 2" className="kp-reloj" />}
                {!k104.vigente && <path d="M 186 17 v 5 l 3 2" className="kp-reloj" />}
            </svg>
            <div className="kp-esq-etq"><span><small>K-0</small><b>{txt(k0)}</b></span><span className="kp-esq-der"><small>K-104</small><b>{txt(k104)}</b></span></div>
        </div>
    );
});
function e0(e: ExtremoEsquema) { return e.vigente ? `${f(e.gasto)} metros cúbicos por segundo` : `sin lectura vigente${e.edadTexto ? `, ${e.edadTexto}` : ''}`; }
