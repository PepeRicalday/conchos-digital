import {
    STALE_GOES_MIN, ceroSospechoso, colorEstacion, estadoEnlace, fechaHoraLocal, fmt, fmtDelta, horaLocal,
    saludEnlace, tendencia, textoEdad, ultimoBueno, ultimoPunto,
    type EstacionHidro, type MensajeHidro, type PuntoHidro, type Tendencia,
} from '../../../utils/hidroEstaciones';
import type { SeriesEstacion } from '../../../hooks/useHidroEstaciones';
import Spark from './Spark';

interface Props {
    estacion: EstacionHidro;
    series: SeriesEstacion | undefined;
    mensajes: MensajeHidro[];
    ahora: number;
    /** Presa abierta en la pantalla: la ficha se resalta. */
    destacada?: boolean;
}

export const GLIFO_ENLACE = { en_linea: '●', retraso: '▲', sin_transmision: '■', sd: '◇' } as const;

const FLECHA = { sube: '▲', baja: '▼', estable: '►' } as const;

function Tend({ t, unidad, dec }: { t: Tendencia | null; unidad: string; dec: number }) {
    if (!t) return <span className="goes-tend goes-tend--sd">Tendencia S/D</span>;
    return (
        <span className={`goes-tend goes-tend--${t.dir}`}>
            <span aria-hidden="true">{FLECHA[t.dir]}</span>{' '}
            {t.dir === 'estable' ? `Estable · ${t.horas} h` : `${fmtDelta(t.delta, dec)} ${unidad} · ${t.horas} h`}
        </span>
    );
}

/** Último punto solo si es reciente: un valor viejo no se presenta como actual. */
function vigente(serie: PuntoHidro[] | undefined, ahora: number): PuntoHidro | null {
    const p = serie ? ultimoPunto(serie) : null;
    if (!p || !ahora) return null;
    return (ahora - p.t) / 60000 <= STALE_GOES_MIN ? p : null;
}

export default function TarjetaEstacion({ estacion, series, mensajes, ahora, destacada }: Props) {
    const ultBueno = ultimoBueno(mensajes, estacion.id);
    const ultDato = estacion.ult_dato_en ? Date.parse(estacion.ult_dato_en) : null;
    const enlace = estadoEnlace(ultBueno ?? ultDato, ahora);
    const salud = saludEnlace(mensajes, estacion.id, ahora - 24 * 3600000);
    const apagada = enlace.clave === 'sin_transmision' || enlace.clave === 'sd';

    const sNivel = series?.nivel_m ?? [];
    const sGasto = series?.gasto_m3s ?? [];
    const pNivel = apagada ? null : vigente(sNivel, ahora);
    const pGasto = apagada ? null : vigente(sGasto, ahora);
    const pVel = apagada ? null : vigente(series?.velocidad_ms, ahora);

    const tNivel = pNivel ? tendencia(sNivel, 1, 0.02) : null;
    const tGasto = pGasto ? tendencia(sGasto, 1, Math.max(0.5, Math.abs(pGasto.v) * 0.02)) : null;
    const cero = pGasto != null && ceroSospechoso(estacion.id, pGasto.v, pNivel?.v ?? null);

    const color = colorEstacion(estacion.id);
    const desde = ahora - 24 * 3600000;
    const tieneUbicacion = estacion.latitud != null && estacion.longitud != null;
    const ultTxt = ultDato ?? ultBueno;

    return (
        <article className={`goes-ficha${destacada ? ' is-destacada' : ''}${apagada ? ' is-apagada' : ''}`} style={{ ['--acc' as string]: color }} aria-label={`Estación ${estacion.nombre}`}>
            <header className="goes-ficha-cab">
                <div className="goes-ficha-id">
                    <h4>{estacion.nombre}</h4>
                    <span className="goes-dcp">DCP {estacion.id}</span>
                </div>
                <span className={`goes-sello goes-sello--${enlace.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[enlace.clave]}</span> {enlace.etiqueta}</span>
            </header>

            <div className="goes-medidas">
                <section className="goes-medida" aria-label="Nivel">
                    <span className="goes-k">Nivel</span>
                    <span className={`goes-num${pNivel ? '' : ' is-sd'}`}>{pNivel ? fmt(pNivel.v, 2) : 'S/D'}<small>m</small></span>
                    {apagada ? <span className="goes-tend goes-tend--sd">Sin dato vigente</span> : <Tend t={tNivel} unidad="m" dec={2} />}
                    <Spark serie={apagada ? [] : sNivel} color={color} desdeMs={desde} hastaMs={ahora || desde + 1} etiqueta={`Nivel de ${estacion.nombre}`} />
                </section>
                <section className="goes-medida" aria-label="Gasto">
                    <span className="goes-k">Gasto</span>
                    <span className={`goes-num${pGasto ? '' : ' is-sd'}`}>{pGasto ? fmt(pGasto.v, 2) : 'S/D'}<small>m³/s</small></span>
                    {apagada ? <span className="goes-tend goes-tend--sd">Sin dato vigente</span> : <Tend t={tGasto} unidad="m³/s" dec={2} />}
                    <Spark serie={apagada ? [] : sGasto} color={color} desdeMs={desde} hastaMs={ahora || desde + 1} etiqueta={`Gasto de ${estacion.nombre}`} />
                </section>
            </div>

            {cero && (
                <p className="goes-aviso" role="note">
                    <span aria-hidden="true">◇</span> 0 reportado por la estación — posible corte de curva de gasto (sin confirmar). Se muestra tal cual, con nivel de {fmt(pNivel?.v, 2)} m.
                </p>
            )}
            {pVel && <p className="goes-extra">Velocidad del agua <b>{fmt(pVel.v, 2)} m/s</b></p>}

            <footer className="goes-ficha-pie">
                <span title="Hora de Chihuahua">
                    {apagada
                        ? <>Último dato: <b>{ultTxt ? fechaHoraLocal(ultTxt) : 'S/D'}</b>{enlace.edadMin != null ? ` (${textoEdad(enlace.edadMin)})` : ''}</>
                        : <>Dato de las <b>{horaLocal(ultDato ?? ultBueno)}</b> · {textoEdad(enlace.edadMin)}</>}
                </span>
                <span>Señal <b>{salud.senalDbm == null ? 'S/D' : `${fmt(salud.senalDbm, 0)} dBm`}</b></span>
                <span className="goes-ubic">{tieneUbicacion ? `${fmt(estacion.latitud, 4)}° N, ${fmt(Math.abs(estacion.longitud as number), 4)}° O` : 'Ubicación pendiente'}</span>
            </footer>
        </article>
    );
}
