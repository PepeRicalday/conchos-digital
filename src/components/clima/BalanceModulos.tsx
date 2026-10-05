import { balanceModulo, type EstadoBalance } from '../../utils/balanceModulo';
import { superficieRiegoHa } from '../../utils/modulosSRL';
import { EFICIENCIA_RODADO, KC_REFERENCIA } from '../../utils/agronomia';

const ETIQUETA: Record<EstadoBalance, string> = { DEFICIT: 'Déficit', EQUILIBRADO: 'Equilibrado', SUPERAVIT: 'Superávit', SD: 'S/D' };
const nf = (v: number | null, d = 0) => (v == null ? 'S/D' : v.toLocaleString('es-MX', { maximumFractionDigits: d, minimumFractionDigits: d }));

export interface FilaBalanceEntrada { modulo: number; nombre: string }

interface Props {
    modulos: FilaBalanceEntrada[];
    etoMm: number | null;
    lluviaMm: number | null;
    entregas: Map<number, number | null>;
    fecha: string;
}

/** Demanda de riego (ETc / eficiencia × ha) contra lo entregado en el día. Sin dato → S/D, nunca 0. */
export function BalanceModulos({ modulos, etoMm, lluviaMm, entregas, fecha }: Props) {
    const filas = modulos.map((m) => {
        const b = balanceModulo({ etoMm, haRiego: superficieRiegoHa(m.modulo), lluviaMm, entregadoM3: entregas.get(m.modulo) ?? null });
        return { ...m, b };
    });
    const maxM3 = Math.max(1, ...filas.flatMap((f) => [f.b.demandaM3 ?? 0, f.b.entregadoM3 ?? 0]));

    return (
        <section className="cl-seccion" aria-labelledby="cl-bal-t">
            <header className="cl-seccion-cab">
                <div>
                    <span className="cl-kicker">Clima ↔ canal · {fecha}</span>
                    <h3 id="cl-bal-t">Demanda de riego vs. entrega</h3>
                </div>
                <div className="cl-seccion-cifra">
                    <b>{etoMm != null ? etoMm.toFixed(1) : 'S/D'}</b>
                    <span>ETₒ mm/día</span>
                </div>
            </header>
            {etoMm == null ? (
                <p className="cl-vacio">Sin ETₒ del día no se puede estimar la demanda de riego.</p>
            ) : (
                <div className="table-scroll">
                    <table className="cl-tabla">
                        <caption className="cl-sr">Demanda de riego y volumen entregado por módulo</caption>
                        <thead>
                            <tr>
                                <th scope="col">Módulo</th>
                                <th scope="col">Superficie (ha)</th>
                                <th scope="col">Demanda (m³)</th>
                                <th scope="col">Entregado (m³)</th>
                                <th scope="col" className="cl-col-barra">Cobertura</th>
                                <th scope="col">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filas.map(({ modulo, nombre, b }) => (
                                <tr key={modulo}>
                                    <th scope="row">{nombre}</th>
                                    <td>{nf(superficieRiegoHa(modulo))}</td>
                                    <td>{nf(b.demandaM3)}</td>
                                    <td>{nf(b.entregadoM3)}</td>
                                    <td className="cl-col-barra">
                                        <div className="cl-barra-par" role="img"
                                            aria-label={`Demanda ${nf(b.demandaM3)} metros cúbicos, entregado ${nf(b.entregadoM3)} metros cúbicos`}>
                                            <span className="cl-barra cl-barra-dem" style={{ width: `${((b.demandaM3 ?? 0) / maxM3) * 100}%` }} />
                                            <span className="cl-barra cl-barra-ent" style={{ width: `${((b.entregadoM3 ?? 0) / maxM3) * 100}%` }} />
                                        </div>
                                        <small>{b.coberturaPct != null ? `${b.coberturaPct.toFixed(0)} %` : 'S/D'}</small>
                                    </td>
                                    <td><span className={`cl-chip cl-bal-${b.estado.toLowerCase()}`}>{ETIQUETA[b.estado]}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="cl-pie">
                Demanda = ETₒ × Kc {KC_REFERENCIA} ÷ eficiencia {Math.round(EFICIENCIA_RODADO * 100)} % × superficie de riego
                {lluviaMm != null && lluviaMm > 0 ? `, menos la lluvia efectiva (${lluviaMm.toFixed(1)} mm)` : ''}.
                Entregado = suma de entregas_modulo del día; S/D cuando no hay registro. Barra superior: demanda; inferior: entregado.
            </p>
        </section>
    );
}
