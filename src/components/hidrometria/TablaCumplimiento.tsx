import { memo, useEffect, useRef } from 'react';
import { ETIQUETA_CUMPLIMIENTO, type EstadoCumplimiento, type FilaSemana } from '../../utils/hidrometria';
import { fmt, fmtPct } from '../../utils/formato';

const CLASE: Record<EstadoCumplimiento, string> = {
    cumple: 'sc-estado-ok', bajo: 'sc-estado-crit', sobre: 'sc-estado-warn', sin_dato: 'sc-estado-sd', sin_solicitud: 'sc-estado-sd', futura: 'sc-estado-info',
};

export interface FilaConCiclo extends FilaSemana { avanceCicloPct: number | null }

/** Cumplimiento por módulo (más desviado primero). El estado va siempre en texto, no solo en color. */
export const TablaCumplimiento = memo(function TablaCumplimiento({ filas, resaltarId }: { filas: FilaConCiclo[]; resaltarId?: string | null }) {
    const filaRef = useRef<HTMLTableRowElement>(null);
    // Llegada desde el Dashboard (?modulo=): se lleva la fila a la vista.
    useEffect(() => { if (resaltarId) filaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [resaltarId, filas.length]);
    return (
        <section className="sc-card" aria-labelledby="hid-tabla-t">
            <span className="sc-kicker">Cumplimiento por módulo</span>
            <h3 id="hid-tabla-t">Programado contra entregado</h3>
            <div className="sc-tabla-wrap">
                <table className="sc-tabla">
                    <caption>Volumen semanal programado y entregado por módulo, en Mm³. S/D = sin solicitud o sin captura.</caption>
                    <thead>
                        <tr>
                            <th scope="col">Módulo</th>
                            <th scope="col">Programado</th>
                            <th scope="col">Entregado</th>
                            <th scope="col">Cumpl.</th>
                            <th scope="col">Ciclo</th>
                            <th scope="col">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((f) => (
                            <tr key={f.moduloId} ref={f.moduloId === resaltarId ? filaRef : undefined} aria-current={f.moduloId === resaltarId ? 'true' : undefined}
                                style={f.moduloId === resaltarId ? { background: 'rgba(63, 178, 243, 0.14)', boxShadow: 'inset 3px 0 0 var(--sc-sky)' } : undefined}>
                                <th scope="row">{f.nombre}</th>
                                <td>{fmt(f.programadoMm3, 3)}</td>
                                <td>{fmt(f.entregadoMm3, 3)}</td>
                                <td>{fmtPct(f.cumplimientoPct)}</td>
                                <td title="Volumen entregado del ciclo contra el autorizado">{fmtPct(f.avanceCicloPct)}</td>
                                <td><span className={`sc-estado ${CLASE[f.estado]}`}>{ETIQUETA_CUMPLIMIENTO[f.estado]}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="sc-fresco">Cumpl. = entregado ÷ programado prorrateado a los días transcurridos de la semana. Ciclo = volumen entregado del ciclo ÷ autorizado.</p>
        </section>
    );
});
