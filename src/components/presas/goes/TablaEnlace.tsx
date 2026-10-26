import {
    colorEstacion, estadoEnlace, fechaHoraLocal, fmt, saludEnlace, textoEdad, tiraEnlace, ultimoBueno,
    type EstacionHidro, type MensajeHidro,
} from '../../../utils/hidroEstaciones';
import { GLIFO_ENLACE } from './TarjetaEstacion';

interface Props { estaciones: EstacionHidro[]; mensajes: MensajeHidro[]; ahora: number }

const ROTULO = { bueno: 'mensaje bueno', falla: 'mensaje con falla', sin: 'sin mensaje' } as const;

/** Salud del enlace satelital: mensajes buenos vs con falla en 24 h, señal y una celda por hora. */
export default function TablaEnlace({ estaciones, mensajes, ahora }: Props) {
    return (
        <div className="goes-tabla-wrap">
            <table className="goes-tabla goes-tabla--enlace">
                <caption>Cada estación transmite un mensaje por hora. Código G = mensaje bueno.</caption>
                <thead>
                    <tr>
                        <th scope="col">Estación</th><th scope="col">Estado</th><th scope="col">Buenos / falla</th>
                        <th scope="col">Señal</th><th scope="col">Último bueno</th><th scope="col">Últimas 24 h</th>
                    </tr>
                </thead>
                <tbody>
                    {estaciones.map(e => {
                        const ub = ultimoBueno(mensajes, e.id);
                        const enl = estadoEnlace(ub, ahora);
                        const s = saludEnlace(mensajes, e.id, ahora - 24 * 3600000);
                        const tira = tiraEnlace(mensajes, e.id, ahora, 24);
                        return (
                            <tr key={e.id}>
                                <th scope="row"><i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{e.nombre}</th>
                                <td data-label="Estado"><span className={`goes-sello goes-sello--${enl.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[enl.clave]}</span> {enl.etiqueta}</span></td>
                                <td data-label="Buenos / con falla (24 h)">{s.total ? `${s.buenos} / ${s.conFalla}` : 'S/D'}</td>
                                <td data-label="Señal">{s.senalDbm == null ? 'S/D' : `${fmt(s.senalDbm, 0)} dBm`}</td>
                                <td data-label="Último bueno">{ub ? <>{fechaHoraLocal(ub)}<small>{textoEdad(enl.edadMin)}</small></> : 'S/D'}</td>
                                <td data-label="Últimas 24 h">
                                    <span className="goes-tira" role="img" aria-label={`Mensajes por hora de ${e.nombre}: ${tira.filter(c => c === 'bueno').length} buenos, ${tira.filter(c => c === 'falla').length} con falla, ${tira.filter(c => c === 'sin').length} horas sin mensaje`}>
                                        {tira.map((c, i) => <i key={i} className={`goes-celda goes-celda--${c}`} title={`${ROTULO[c]}`} />)}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <ul className="goes-leyenda" aria-label="Leyenda de la tira">
                <li><i className="goes-celda goes-celda--bueno" /> Mensaje bueno</li>
                <li><i className="goes-celda goes-celda--falla" /> Con falla</li>
                <li><i className="goes-celda goes-celda--sin" /> Sin mensaje</li>
            </ul>
        </div>
    );
}
