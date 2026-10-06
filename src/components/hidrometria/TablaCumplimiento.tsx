import { memo } from 'react';
import { ETIQUETA_CUMPLIMIENTO, type EstadoCumplimiento, type FilaSemana } from '../../utils/hidrometria';
import { fmt, fmtPct } from '../../utils/formato';

const CLASE: Record<EstadoCumplimiento, string> = {
    cumple: 'sc-estado-ok', bajo: 'sc-estado-crit', sobre: 'sc-estado-warn', sin_dato: 'sc-estado-sd', sin_solicitud: 'sc-estado-sd', futura: 'sc-estado-info',
};

export interface FilaConCiclo extends FilaSemana { avanceCicloPct: number | null }

/** Cumplimiento por módulo (más desviado primero). El estado va siempre en texto, no solo en color. */
export const TablaCumplimiento = memo(function TablaCumplimiento({ filas }: { filas: FilaConCiclo[] }) {
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
                            <tr key={f.moduloId}>
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
