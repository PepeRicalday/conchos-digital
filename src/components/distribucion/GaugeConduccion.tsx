import { memo } from 'react';
import { Zap } from 'lucide-react';
import type { ClasificacionConduccion, EstadoVisual } from '../../utils/eficienciaCanal';

const COLOR: Record<EstadoVisual, string> = { ok: '#34d399', warn: '#fbbf24', crit: '#f87171', info: '#38bdf8', sd: '#8396ad' };
const R = 74;
const ARCO = Math.PI * R; // longitud del semicírculo

interface Props { valor: number | null; clasificacion: ClasificacionConduccion; qEntrada: number | null; qSalida: number | null }

/**
 * Eficiencia de conducción K-0→K-104 como semicírculo. Con S/D o dato inconsistente el arco queda vacío y NO se
 * muestra "0 %" ni "¡ALERTA DE FUGAS!": el aviso de fuga solo aparece con tramo completo bajo el corte de alerta.
 */
export const GaugeConduccion = memo(function GaugeConduccion({ valor, clasificacion, qEntrada, qSalida }: Props) {
    const mostrar = clasificacion.nivel !== 'sd' && clasificacion.nivel !== 'inconsistente' && valor != null;
    const frac = mostrar ? Math.min(Math.max(valor!, 0), 100) / 100 : 0;
    const color = COLOR[clasificacion.estado];
    return (
        <section className="sc-card dc-gauge" aria-labelledby="dc-gauge-t">
            <span className="sc-kicker"><Zap size={12} aria-hidden="true" /> Conducción K-0 → K-104</span>
            <h3 id="dc-gauge-t">Eficiencia</h3>
            <div className="dc-gauge-svg" role="img" aria-label={clasificacion.descripcion}>
                <svg viewBox="0 0 180 100" width="100%" aria-hidden="true">
                    <path d={`M 16 90 A ${R} ${R} 0 0 1 164 90`} fill="none" stroke="rgba(148,163,184,.22)" strokeWidth="14" strokeLinecap="round" />
                    {frac > 0 && <path d={`M 16 90 A ${R} ${R} 0 0 1 164 90`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${ARCO * frac} ${ARCO}`} />}
                </svg>
                <div className="dc-gauge-valor">
                    {mostrar ? <span className="sc-num">{valor!.toFixed(1)}<small>%</small></span> : <span className="sc-num sc-num-sd">S/D</span>}
                </div>
            </div>
            <div style={{ textAlign: 'center' }}>
                <span className={`sc-estado sc-estado-${clasificacion.estado}`}>{clasificacion.hayFuga ? 'Pérdida real: revisar tramo' : clasificacion.etiqueta}</span>
            </div>
            <p className="sc-fresco" style={{ textAlign: 'center' }}>
                Entrada {qEntrada != null ? `${qEntrada.toFixed(2)} m³/s` : 'S/D'} · Salida {qSalida != null ? `${qSalida.toFixed(2)} m³/s` : 'S/D'}
            </p>
        </section>
    );
});
