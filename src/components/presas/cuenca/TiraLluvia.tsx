import { useMemo } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { LLUVIA_FUERTE_MM, NOMBRE_LLUVIA, type ResumenLluvia } from '../../../utils/aqwpCuenca';
import { anioInicioCiclo, lluviaCiclo, lluviaVsCicloAnterior } from '../../../utils/aqwpEstadistica';

interface Props {
    lluvia: ResumenLluvia;
    serie: { ubicacionId: number; fecha: string; valor: number | null }[];
}

const DIA_MS = 86_400_000;
const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fmtMm = (v: number | null) => (v == null ? 'S/D' : `${formatearNumero(v, 1)} mm`);

/**
 * Lluvia de los pluviómetros GOES: tira de 30 días por pluviómetro (una sola rampa de color: más lluvia = más intensidad) con
 * las cifras en texto. 0 mm = día seco medido (celda vacía con borde); S/D = día sin datos suficientes (trama); los días de
 * ≥ 10 mm llevan su cifra DENTRO de la celda (el color no es el único canal). Con solo 2 ciclos no se habla de "normal": el ciclo
 * se compara únicamente con el anterior (n = 1) y solo si ambos tienen buena cobertura.
 */
export default function TiraLluvia({ lluvia, serie }: Props) {
    const ciclo = useMemo(() => {
        if (!lluvia.hasta) return null;
        const anio = anioInicioCiclo(lluvia.hasta);
        const k = Math.round((ms(lluvia.hasta) - Date.UTC(anio, 9, 1)) / DIA_MS);
        return { anio, k };
    }, [lluvia.hasta]);

    if (lluvia.filas.length === 0 || lluvia.hasta == null || !ciclo) {
        return (
            <section className="an-card" id="cu-lluvia" aria-label="Lluvia en la cuenca">
                <h4 className="an-h">Lluvia en la cuenca · pluviómetros GOES</h4>
                <div className="an-vacio" role="status"><strong>Sin lluvia reciente (S/D)</strong><span>Todavía no hay lluvia diaria cargada de los pluviómetros GOES del portal.</span></div>
            </section>
        );
    }

    return (
        <section className="an-card" aria-label="Lluvia en la cuenca">
            <h4 className="an-h">Lluvia en la cuenca · pluviómetros GOES</h4>
            <p className="an-nota">
                Milímetros por día hasta el {fechaCorta(lluvia.hasta)}; los 30 días más recientes. Más intensidad = más lluvia; los días de {LLUVIA_FUERTE_MM} mm o más muestran su cifra.
                «0» es un día seco medido; la trama es un día sin datos suficientes (S/D). El ciclo agrícola corre del 1-oct al 30-sep.
            </p>
            <div className="cu-tabla-wrap">
                <table className="cu-tabla cu-tabla--lluvia">
                    <thead>
                        <tr>
                            <th scope="col">Pluviómetro</th>
                            <th scope="col">30 días</th>
                            <th scope="col" className="cu-num">7 días</th>
                            <th scope="col" className="cu-num">30 días</th>
                            <th scope="col" className="cu-num">Ciclo {ciclo.anio}-{String(ciclo.anio + 1).slice(2)}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lluvia.filas.map((f) => {
                            const mias = serie.filter((s) => s.ubicacionId === f.ubicacionId);
                            const act = lluviaCiclo(mias, ciclo.anio, ciclo.k);
                            const ant = lluviaCiclo(mias, ciclo.anio - 1, ciclo.k);
                            const vs = lluviaVsCicloAnterior(act, ant);
                            const dias30 = lluvia.serie30.map((s) => ({ fecha: s.fecha, v: (s[String(f.ubicacionId)] as number | null | undefined) ?? null }));
                            const conLluvia = dias30.filter((d) => d.v != null && d.v >= 1).length;
                            const maximo = Math.max(0, ...dias30.map((d) => d.v ?? 0));
                            return (
                                <tr key={f.ubicacionId}>
                                    <th scope="row"><div className="cu-presa"><span className="cu-nombre">{NOMBRE_LLUVIA[f.ubicacionId] ?? f.nombre}</span></div></th>
                                    <td className="cu-tira-td">
                                        <div className="cu-tira" role="img"
                                            aria-label={`${f.nombre}: 30 días, ${conLluvia} con lluvia de 1 mm o más, máximo ${formatearNumero(maximo, 1)} mm`}>
                                            {dias30.map((d) => {
                                                const sd = d.v == null;
                                                const alfa = sd ? 0 : d.v === 0 ? 0 : Math.max(0.28, Math.min(1, d.v! / 25));
                                                return (
                                                    <span key={d.fecha} title={`${fechaCorta(d.fecha)}: ${fmtMm(d.v)}`}
                                                        className={`cu-dia${sd ? ' cu-dia--sd' : d.v === 0 ? ' cu-dia--seco' : ''}${!sd && d.v! >= LLUVIA_FUERTE_MM ? ' cu-dia--fuerte' : ''}`}
                                                        style={sd || d.v === 0 ? undefined : { backgroundColor: `rgba(63, 178, 243, ${alfa})` }}>
                                                        {!sd && d.v! >= LLUVIA_FUERTE_MM && <span className="cu-dia-num">{formatearNumero(d.v!, 0)}</span>}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td className="cu-num">{fmtMm(f.total7.mm)}{f.total7.mm != null && f.total7.conDato < f.total7.ventana && <span className="cu-nota-fila">{f.total7.conDato} de {f.total7.ventana} días con dato</span>}</td>
                                    <td className="cu-num">{fmtMm(f.total30.mm)}{f.total30.mm != null && f.total30.conDato < f.total30.ventana && <span className="cu-nota-fila">{f.total30.conDato} de {f.total30.ventana} días con dato</span>}</td>
                                    <td className="cu-num">
                                        {fmtMm(act.mm)}
                                        {act.mm != null && <span className="cu-nota-fila">{act.diasConLluvia} días con lluvia · máx. {fmtMm(act.maxDiaMm)}</span>}
                                        <span className="cu-nota-fila">
                                            {vs
                                                ? `${vs.difMm > 0 ? '+' : vs.difMm < 0 ? '−' : ''}${formatearNumero(Math.abs(vs.difMm), 1)} mm frente al ciclo anterior (n = 1)`
                                                : act.mm == null ? '' : 'sin comparación: cobertura insuficiente en alguno de los dos ciclos'}
                                        </span>
                                        {vs?.advertencia && <span className="cu-nota-fila cu-nota-fila--aviso">⚠ {vs.advertencia}</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
