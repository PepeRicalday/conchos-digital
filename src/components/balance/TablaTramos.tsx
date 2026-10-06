import { memo } from 'react';
import { estadoTramo, perdidaMaterial, type TramoBalance } from '../../utils/balanceTramos';
import { fmt } from '../../utils/formato';

const CLASE = { ok: 'sc-estado-ok', warn: 'sc-estado-warn', crit: 'sc-estado-crit', sd: 'sc-estado-sd', info: 'sc-estado-info' } as const;

/**
 * Balance de masa por tramo. La columna de porcentaje se llama "Cobertura del balance" ((Qs+Qtomas)/Qe) para no
 * confundirla con la eficiencia de conducción global. Tramos sin dato muestran S/D, jamás ceros fabricados.
 */
export const TablaTramos = memo(function TablaTramos({ tramos, noVigentes }: { tramos: TramoBalance[]; noVigentes?: Set<string> }) {
    // Tramo cuyo extremo no tiene lectura vigente (> 4 h): su estado describe el último dato del día, no el momento actual.
    const desactualizado = (b: TramoBalance) => !!noVigentes && b.seccion_nombre.split(' → ').some((n) => noVigentes.has(n));
    return (
        <section className="sc-card" aria-labelledby="bal-tabla-t">
            <span className="sc-kicker">Balance de masa · entre escalas consecutivas</span>
            <h3 id="bal-tabla-t">Balance por tramo</h3>
            {tramos.length === 0 ? (
                <p className="sc-vacio">No hay suficientes escalas con datos del día elegido (se requieren al menos 2).</p>
            ) : (
                <div className="sc-tabla-wrap">
                    <table className="sc-tabla">
                        <caption>Q entrada, salida, tomas y pérdidas por tramo, en m³/s. S/D = sin dato de caudal en una de las escalas.</caption>
                        <thead>
                            <tr>
                                <th scope="col">Tramo</th><th scope="col">Km</th><th scope="col">Q entrada</th><th scope="col">Q salida</th>
                                <th scope="col">Q tomas</th><th scope="col">Pérdidas</th><th scope="col">Cobertura del balance</th><th scope="col">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tramos.map((b) => {
                                const est = estadoTramo(b);
                                const sd = b.sinDato || b.cerrado;
                                return (
                                    <tr key={`${b.km_inicio}-${b.km_fin}`}>
                                        <th scope="row">{b.seccion_nombre}</th>
                                        <td>{fmt(b.km_inicio, 1)} – {fmt(b.km_fin, 1)}</td>
                                        <td>{b.cerrado ? '0.000' : sd ? 'S/D' : fmt(b.q_entrada, 3)}</td>
                                        <td>{sd && !b.cerrado ? 'S/D' : fmt(b.q_salida, 3)}</td>
                                        <td>{sd && !b.cerrado ? 'S/D' : fmt(b.q_tomas, 3)}</td>
                                        <td className={perdidaMaterial(b.q_perdidas) && !sd && !b.anomalo ? 'bal-perdida' : undefined}>{sd || b.anomalo ? 'S/D' : fmt(b.q_perdidas, 3)}</td>
                                        <td>
                                            {sd ? 'S/D' : (
                                                <span className="bal-cobertura" title={b.anomalo ? 'Salida + tomas supera a la entrada: error de medición o aportación lateral' : undefined}>
                                                    <span className="sc-barra" role="progressbar" aria-label={`Cobertura del balance ${b.seccion_nombre}`} aria-valuemin={0} aria-valuemax={100}
                                                        aria-valuenow={Math.round(b.eficiencia)} aria-valuetext={`${b.eficiencia.toFixed(1)} por ciento`}>
                                                        <i style={{ width: `${Math.min(100, b.eficiencia)}%` }} />
                                                    </span>
                                                    {b.eficiencia.toFixed(1)} %
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`sc-estado ${CLASE[est.tipo]}`}>{est.texto}</span>
                                            {!sd && desactualizado(b) && <div className="sc-fresco sc-viejo">lectura &gt; 4 h</div>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="sc-fresco">Cobertura = (Q salida + Q tomas) ÷ Q entrada. Ordenado por urgencia; sin dato y cerrados al final.</p>
        </section>
    );
});
