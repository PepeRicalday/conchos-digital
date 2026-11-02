import { useMemo } from 'react';
import { Thermometer, Wind, CloudRain, AlertTriangle } from 'lucide-react';
import type { EstacionConLectura } from '../../hooks/useClimaEstaciones';
import type { EstacionSalud } from '../../utils/saludRed';
import { textoEdad } from '../../utils/saludRed';
import { construirRegistroDia, posPct, type ExtremoRed } from '../../utils/registroDiaClima';

const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toFixed(d));

/** `ceroTxt`: para máximos de lluvia/ráfaga, un 0 no tiene "estación ganadora" — se dice que no hubo. */
function Extremo({ icono, etiqueta, ex, unidad, d = 1, ceroTxt }: { icono: React.ReactNode; etiqueta: string; ex: ExtremoRed | null; unidad: string; d?: number; ceroTxt?: string }) {
    const cero = !!ex && !!ceroTxt && ex.valor === 0;
    return (
        <div className="cl-rd-ext">
            <span className="cl-rd-ext-et">{icono}{etiqueta}</span>
            {ex
                ? <b>{ex.valor.toFixed(d)}<small>{unidad}</small></b>
                : <b className="cl-rd-sd">S/D</b>}
            <span className="cl-rd-ext-est">{!ex ? 'sin estaciones con dato' : cero ? ceroTxt : ex.estacion}</span>
        </div>
    );
}

interface Props {
    estaciones: EstacionConLectura[];
    salud: EstacionSalud[];
    /** Fecha local (America/Chihuahua) YYYY-MM-DD. */
    hoy: string;
    onAbrir: (id: string) => void;
}

/**
 * Registro del día: extremos de la red y, por estación, el rango de temperatura del día (barra sobre una escala
 * común, con la lectura actual como punto), ráfaga máxima, lluvia del día y ETo. Solo lecturas del día y de
 * estaciones con señal; lo demás es S/D. La lectura no trae la hora del máximo ni del mínimo.
 */
export function RegistroDia({ estaciones, salud, hoy, onAbrir }: Props) {
    const r = useMemo(() => construirRegistroDia(estaciones, salud, hoy), [estaciones, salud, hoy]);
    const fechaTxt = new Date(`${hoy}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
    const { extremos: x, escala } = r;

    return (
        <section className="cl-seccion cl-rd" aria-labelledby="cl-rd-t">
            <header className="cl-seccion-cab">
                <div>
                    <span className="cl-kicker">Registro del día · {fechaTxt}</span>
                    <h3 id="cl-rd-t">Extremos por estación</h3>
                </div>
                <div className="cl-seccion-cifra">
                    <b>{r.conDato}/{r.filas.length}</b>
                    <span>con dato de hoy</span>
                </div>
            </header>

            <div className="cl-rd-exts">
                <Extremo icono={<Thermometer size={13} aria-hidden="true" />} etiqueta="Máx. red" ex={x.tmax} unidad="°C" />
                <Extremo icono={<Thermometer size={13} aria-hidden="true" />} etiqueta="Mín. red" ex={x.tmin} unidad="°C" />
                <Extremo icono={<Wind size={13} aria-hidden="true" />} etiqueta="Ráfaga máx." ex={x.rafaga} unidad="m/s" ceroTxt="en calma" />
                <Extremo icono={<CloudRain size={13} aria-hidden="true" />} etiqueta="Lluvia máx." ex={x.lluvia} unidad="mm" ceroTxt="sin lluvia" />
            </div>

            <table className="cl-rd-tabla">
                <caption className="cl-sr">Extremos del día por estación: temperatura mínima, actual y máxima, ráfaga, lluvia y ETo</caption>
                <thead>
                    <tr>
                        <th scope="col">Estación</th>
                        <th scope="col" className="cl-rd-col-rango">Temp. hoy °C</th>
                        <th scope="col"><abbr title="Ráfaga máxima">Ráf.</abbr></th>
                        <th scope="col">Lluvia</th>
                        <th scope="col">ETo</th>
                    </tr>
                </thead>
                <tbody>
                    {r.filas.map((f) => {
                        const rango = escala && f.tminC != null && f.tmaxC != null;
                        return (
                            <tr key={f.id} className={f.conDato ? undefined : 'cl-rd-sin'}>
                                <th scope="row">
                                    <button type="button" className="cl-rd-est" onClick={() => onAbrir(f.id)} aria-label={`${f.nombre}: abrir detalle de la estación`}>
                                        {f.nombre}
                                    </button>
                                    <span className="cl-rd-edad">
                                        {f.sospechosa
                                            ? <><AlertTriangle size={11} aria-hidden="true" /> revisar sensor</>
                                            : f.conDato ? textoEdad(f.edadMin) : (f.estado === 'SIN_SEÑAL' ? `sin señal · ${textoEdad(f.edadMin)}` : 'sin lectura de hoy')}
                                    </span>
                                </th>
                                <td className="cl-rd-col-rango">
                                    {rango ? (
                                        <div className="cl-rd-rango" role="img"
                                            aria-label={`Mínima ${f1(f.tminC)} °C, actual ${f1(f.tempC)} °C, máxima ${f1(f.tmaxC)} °C`}>
                                            <span className="cl-rd-num cl-rd-min">{f1(f.tminC)}</span>
                                            <span className="cl-rd-pista">
                                                <span className="cl-rd-barra" style={{ left: `${posPct(f.tminC as number, escala)}%`, right: `${100 - posPct(f.tmaxC as number, escala)}%` }} />
                                                {f.tempC != null && <span className="cl-rd-ahora" style={{ left: `${posPct(f.tempC, escala)}%` }} />}
                                            </span>
                                            <span className="cl-rd-num cl-rd-max">{f1(f.tmaxC)}</span>
                                        </div>
                                    ) : <span className="cl-rd-sd">S/D</span>}
                                </td>
                                <td className={f.rafagaMs != null && x.rafaga && f.rafagaMs === x.rafaga.valor ? 'cl-rd-top' : undefined}>{f1(f.rafagaMs)}</td>
                                <td className={f.lluviaMm != null && f.lluviaMm > 0 ? 'cl-rd-lluvia' : undefined}>{f1(f.lluviaMm)}</td>
                                <td>{f1(f.etoMm, 2)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <p className="cl-pie">
                ETo media de la red: <b>{x.etoMedia != null ? `${x.etoMedia.toFixed(2)} mm` : 'S/D'}</b>.
                {' '}Barra = mínima a máxima del día en escala común{escala ? ` (${escala.min}–${escala.max} °C)` : ''}; punto = lectura actual.
                Ráfaga en m/s, lluvia y ETo en mm. Solo lecturas de hoy de estaciones con señal; las marcadas "revisar sensor" no entran a los extremos.
            </p>
        </section>
    );
}
