import {
    colorEstacion, estadoEnlace, fechaHoraLocal, fmt, saludEnlace, textoEdad, tiraEnlace,
    type EstacionHidro, type MensajeHidro,
} from '../../../utils/hidroEstaciones';
import { GLIFO_ENLACE, instanteEnlace } from './enlaceGoes';
import { DataTable } from '../../ui/base';

interface Props { estaciones: EstacionHidro[]; mensajes: MensajeHidro[]; ahora: number }

const ROTULO = { bueno: 'mensaje bueno', falla: 'mensaje con falla', sin: 'sin mensaje' } as const;

/** Salud del enlace satelital: mensajes buenos vs con falla en 24 h, señal y una celda por hora. */
export default function TablaEnlace({ estaciones, mensajes, ahora }: Props) {
    return (
        <DataTable
            captionOculto={false} className="goes-tabla goes-tabla--enlace tap-compact" apilar
            caption="Cada estación transmite un mensaje por hora. Código G = mensaje bueno."
            clave={(e) => String(e.id)} filas={estaciones}
            columnas={[
                { id: 'est', titulo: 'Estación', encabezadoFila: true, render: (e) => <><i className="goes-sw" style={{ background: colorEstacion(e.id) }} aria-hidden="true" />{e.nombre}</> },
                {
                    id: 'estado', titulo: 'Estado',
                    render: (e) => { const enl = estadoEnlace(instanteEnlace(e, mensajes), ahora, e.id); return <span className={`goes-sello goes-sello--${enl.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[enl.clave]}</span> {enl.etiqueta}</span>; },
                },
                { id: 'bf', titulo: 'Buenos / falla', render: (e) => { const s = saludEnlace(mensajes, e.id, ahora - 24 * 3600000); return s.total ? `${s.buenos} / ${s.conFalla}` : 'S/D'; } },
                { id: 'senal', titulo: 'Señal', render: (e) => { const s = saludEnlace(mensajes, e.id, ahora - 24 * 3600000); return s.senalDbm == null ? 'S/D' : `${fmt(s.senalDbm, 0)} dBm`; } },
                {
                    id: 'ub', titulo: 'Último dato bueno',
                    render: (e) => { const ub = instanteEnlace(e, mensajes); const enl = estadoEnlace(ub, ahora, e.id); return ub ? <>{fechaHoraLocal(ub)}<small>{textoEdad(enl.edadMin)}</small></> : 'S/D'; },
                },
                {
                    id: 'tira', titulo: 'Últimas 24 h',
                    render: (e) => {
                        const tira = tiraEnlace(mensajes, e.id, ahora, 24);
                        return (
                            <span className="goes-tira" role="img" aria-label={`Mensajes por hora de ${e.nombre}: ${tira.filter(c => c === 'bueno').length} buenos, ${tira.filter(c => c === 'falla').length} con falla, ${tira.filter(c => c === 'sin').length} horas sin mensaje`}>
                                {tira.map((c, i) => <i key={i} className={`goes-celda goes-celda--${c}`} title={`${ROTULO[c]}`} />)}
                            </span>
                        );
                    },
                },
            ]}
        />
    );
}
