import { memo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { EstadoChip } from '../ui/EstadoChip';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

interface Props {
    id: string;
    titulo: string;
    icono: ReactNode;
    /** null = S/D. Cuando hay `textoValor` se muestra ese texto en lugar del número. */
    valor: string | null;
    unidad?: string;
    textoValor?: string;
    estado: EstadoKpi;
    /** Una línea de contexto: de dónde sale la cifra o qué significa. */
    contexto: ReactNode;
    /** Infografía; se oculta sola cuando la celda es baja (container query). */
    viz?: ReactNode;
    fresco?: string | null;
    stale?: boolean;
    to?: string;
    aria: string;
    destacado?: 'crit' | 'warn' | null;
    /** Fuente en tiempo real: muestra el punto de "en vivo" (estático y ámbar cuando el dato está viejo). */
    vivo?: boolean;
    /** Controles interactivos (p. ej. selector de vista). Con acciones la tarjeta NO es un enlace (un botón dentro de un
     *  <a> es HTML inválido y navegaría): se vuelve <section> y la navegación a `to` queda en un enlace explícito. */
    acciones?: ReactNode;
    /** Texto del enlace explícito cuando hay acciones (p. ej. "Abrir Clima"). */
    enlaceTexto?: string;
}

/** Celda de KPI: título + estado, cifra grande, infografía, contexto y frescura. Se adapta a la altura que le toque. */
export const KpiTile = memo(function KpiTile({ id, titulo, icono, valor, unidad, textoValor, estado, contexto, viz, fresco, stale, to, aria, destacado, vivo, acciones, enlaceTexto }: Props) {
    const conAcciones = !!acciones;
    const cuerpo = (
        <div className="kp-in">
            <div className="kp-cab"><span className="kp-titulo">{titulo}</span>{vivo && <span className={`kp-vivo ${stale || estado.tipo === 'sd' || estado.tipo === 'crit' ? 'kp-vivo-off' : ''}`} title="Fuente en tiempo real" aria-hidden="true" />}
                {conAcciones && to
                    ? <Link to={to} className="kp-abrir" aria-label={enlaceTexto ?? `Abrir ${titulo}`} title={enlaceTexto ?? `Abrir ${titulo}`}><span className="kp-icono" aria-hidden="true">{icono}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>
                    : <span className="kp-icono" aria-hidden="true">{icono}</span>}</div>
            <div className="kp-cifra-fila">
                {textoValor ? <div className="kp-cifra kp-cifra-texto">{textoValor}</div>
                    : valor == null ? <div className="kp-cifra kp-cifra-sd" aria-label="Sin dato">S/D</div>
                        : <div className="kp-cifra">{valor}{unidad && <small>{unidad}</small>}</div>}
                <EstadoChip estado={estado} />
            </div>
            {conAcciones && <div className="kp-acciones">{acciones}</div>}
            {viz && <div className="kp-viz">{viz}</div>}
            <div className="kp-contexto">{contexto}</div>
            {fresco && <div className={`kp-fresco ${stale ? 'kp-viejo' : ''}`}>{fresco}</div>}
        </div>
    );
    const clase = `kp-tile ${destacado ? `kp-dest-${destacado}` : ''}`;
    return to && !conAcciones
        ? <Link to={to} id={id} className={clase} data-estado={estado.tipo} aria-label={aria}>{cuerpo}</Link>
        : <section id={id} className={clase} data-estado={estado.tipo} aria-label={aria}>{cuerpo}</section>;
});
