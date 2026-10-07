import { memo, useState } from 'react';
import { CheckCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { AlertaActiva } from '../../hooks/useAlertasPantalla';
import { etiquetaCategoria, haceTexto, lugarDeAlerta } from '../../utils/alertasPantalla';
import { SEVERIDAD, sevDe } from './severidad';

const LIMITE_INICIAL = 12;

interface Props {
    alertas: AlertaActiva[];
    ahoraMs: number;
    /** Devuelve null si resolvió o el mensaje de error. */
    onAtender: (id: string) => Promise<string | null>;
    vacioTexto: string;
}

/** Log accionable: severidad, qué, dónde, hace cuánto y acción sugerida; "Atender" pide confirmación y avisa el resultado. */
export const DespachoAlertas = memo(function DespachoAlertas({ alertas, ahoraMs, onAtender, vacioTexto }: Props) {
    const [confirmando, setConfirmando] = useState<string | null>(null);
    const [ocupada, setOcupada] = useState<string | null>(null);
    const [verTodas, setVerTodas] = useState(false);

    if (alertas.length === 0) {
        return (
            <div className="al-vacio" role="status">
                <CheckCircle size={22} aria-hidden="true" />
                <span>{vacioTexto}</span>
            </div>
        );
    }

    const visibles = verTodas ? alertas : alertas.slice(0, LIMITE_INICIAL);

    const resolver = async (a: AlertaActiva) => {
        setOcupada(a.id);
        const err = await onAtender(a.id);
        setOcupada(null);
        setConfirmando(null);
        if (err) toast.error(`No se pudo atender la alerta: ${err}`);
        else toast.success(`Alerta atendida: ${a.titulo}`);
    };

    const copiarId = async (id: string) => {
        try { await navigator.clipboard.writeText(id); toast.success('ID copiado'); }
        catch { toast.error('No se pudo copiar el ID'); }
    };

    return (
        <>
            <ul className="al-lista">
                {visibles.map((a) => {
                    const sev = SEVERIDAD[sevDe(a.tipo_riesgo)];
                    const lugar = lugarDeAlerta(a);
                    const enConfirmacion = confirmando === a.id;
                    return (
                        <li key={a.id} className={`al-fila al-fila-${sev.cls}`}>
                            <span className={`sc-estado sc-estado-${sev.cls} al-sev`}><sev.Icono size={12} aria-hidden="true" /> {sev.etiqueta}</span>
                            <div className="al-fila-txt">
                                <b>{a.titulo}</b>
                                {a.mensaje && <p>{a.mensaje}</p>}
                                {a.accion && !(a.mensaje ?? '').includes(a.accion) && <p className="al-accion"><strong>Acción:</strong> {a.accion}</p>}
                                <small>
                                    {etiquetaCategoria(a.categoria)}{lugar ? ` · ${lugar}` : ''} ·{' '}
                                    <time dateTime={a.fecha_deteccion ?? undefined} title={a.fecha_deteccion ? new Date(a.fecha_deteccion).toLocaleString('es-MX') : ''}>
                                        {haceTexto(a.fecha_deteccion, ahoraMs)}
                                    </time>
                                </small>
                            </div>
                            <div className="al-fila-acciones">
                                {a.origen_id && (
                                    <button type="button" className="sc-btn al-btn-icono" onClick={() => void copiarId(a.origen_id!)}
                                        aria-label={`Copiar identificador técnico de: ${a.titulo}`} title={`ID: ${a.origen_id}`}>
                                        <Copy size={14} aria-hidden="true" />
                                    </button>
                                )}
                                {enConfirmacion ? (
                                    <>
                                        <button type="button" className="sc-btn sc-btn-primario" disabled={ocupada === a.id}
                                            onClick={() => void resolver(a)} aria-label={`Confirmar: marcar como atendida ${a.titulo}`}>
                                            {ocupada === a.id ? 'Guardando…' : 'Confirmar'}
                                        </button>
                                        <button type="button" className="sc-btn" disabled={ocupada === a.id} onClick={() => setConfirmando(null)}>Cancelar</button>
                                    </>
                                ) : (
                                    <button type="button" className="sc-btn" onClick={() => setConfirmando(a.id)} aria-label={`Atender alerta: ${a.titulo}`}>
                                        Atender
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {alertas.length > LIMITE_INICIAL && (
                <button type="button" className="sc-btn al-ver-mas" onClick={() => setVerTodas((v) => !v)}>
                    {verTodas ? 'Ver menos' : `Ver todas (${alertas.length})`}
                </button>
            )}
        </>
    );
});
