import { memo } from 'react';
import { estadoTramo, perdidaMaterial, type TramoBalance } from '../../utils/balanceTramos';
import { fmt } from '../../utils/formato';
import { DataTable, Insignia, type Columna } from '../ui/base';

/**
 * Balance de masa por tramo. La columna de porcentaje se llama "Cobertura del balance" ((Qs+Qtomas)/Qe) para no
 * confundirla con la eficiencia de conducción global. Tramos sin dato muestran S/D, jamás ceros fabricados.
 */
export const TablaTramos = memo(function TablaTramos({ tramos, noVigentes }: { tramos: TramoBalance[]; noVigentes?: Set<string> }) {
    // Tramo cuyo extremo no tiene lectura vigente (> 4 h): su estado describe el último dato del día, no el momento actual.
    const sinDato = (b: TramoBalance) => b.sinDato || b.cerrado;
    const desactualizado = (b: TramoBalance) => !!noVigentes && b.seccion_nombre.split(' → ').some((n) => noVigentes.has(n));
    return (
        <section className="sc-card" aria-labelledby="bal-tabla-t">
            <span className="sc-kicker">Balance de masa · entre escalas consecutivas</span>
            <h3 id="bal-tabla-t">Balance por tramo</h3>
            {tramos.length === 0 ? (
                <p className="sc-vacio">No hay suficientes escalas con datos del día elegido (se requieren al menos 2).</p>
            ) : (
                <DataTable
                    clave={(b) => `${b.km_inicio}-${b.km_fin}`} filas={tramos}
                    caption="Q entrada, salida, tomas y pérdidas por tramo, en m³/s. S/D = sin dato de caudal en una de las escalas."
                    columnas={[
                        { id: 'tramo', titulo: 'Tramo', encabezadoFila: true, render: (b) => b.seccion_nombre },
                        { id: 'km', titulo: 'Km', numerica: true, render: (b) => `${fmt(b.km_inicio, 1)} – ${fmt(b.km_fin, 1)}` },
                        { id: 'qe', titulo: 'Q entrada', numerica: true, render: (b) => b.cerrado ? '0.000' : sinDato(b) ? 'S/D' : fmt(b.q_entrada, 3) },
                        { id: 'qs', titulo: 'Q salida', numerica: true, render: (b) => sinDato(b) && !b.cerrado ? 'S/D' : fmt(b.q_salida, 3) },
                        { id: 'qt', titulo: 'Q tomas', numerica: true, render: (b) => sinDato(b) && !b.cerrado ? 'S/D' : fmt(b.q_tomas, 3) },
                        {
                            id: 'perd', titulo: 'Pérdidas', numerica: true,
                            render: (b) => {
                                const v = sinDato(b) || b.anomalo ? 'S/D' : fmt(b.q_perdidas, 3);
                                return perdidaMaterial(b.q_perdidas) && !sinDato(b) && !b.anomalo ? <span className="bal-perdida">{v}</span> : v;
                            },
                        },
                        {
                            id: 'cob', titulo: 'Cobertura del balance', numerica: true,
                            render: (b) => sinDato(b) ? 'S/D' : (
                                <span className="bal-cobertura" title={b.anomalo ? 'Salida + tomas supera a la entrada: error de medición o aportación lateral' : undefined}>
                                    <span className="sc-barra" role="progressbar" aria-label={`Cobertura del balance ${b.seccion_nombre}`} aria-valuemin={0} aria-valuemax={100}
                                        aria-valuenow={Math.round(b.eficiencia)} aria-valuetext={`${b.eficiencia.toFixed(1)} por ciento`}>
                                        <i style={{ width: `${Math.min(100, b.eficiencia)}%` }} />
                                    </span>
                                    {b.eficiencia.toFixed(1)} %
                                </span>
                            ),
                        },
                        {
                            id: 'estado', titulo: 'Estado', numerica: true,
                            render: (b) => (
                                <>
                                    <Insignia tipo={estadoTramo(b).tipo} sinIcono>{estadoTramo(b).texto}</Insignia>
                                    {!sinDato(b) && desactualizado(b) && <div className="sc-fresco sc-viejo">lectura &gt; 4 h</div>}
                                </>
                            ),
                        },
                    ] satisfies Columna<TramoBalance>[]}
                />
            )}
            <p className="sc-fresco">Cobertura = (Q salida + Q tomas) ÷ Q entrada. Ordenado por urgencia; sin dato y cerrados al final.</p>
        </section>
    );
});
