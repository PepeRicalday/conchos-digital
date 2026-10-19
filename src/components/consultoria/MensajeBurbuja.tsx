import { memo, useMemo, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Brain, Check, Copy, Droplets, FileText, ImageDown, Loader2, PlayCircle, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { ChatMessage } from '../../hooks/useHydricChat';
import { formatTime } from '../../utils/dateHelpers';
import { hrefSeguro } from '../../utils/consultoria';
import { TarjetasDatos } from './TarjetasDatos';
import { copiarTexto } from './copiar';

type PropsTabla = ComponentProps<'table'>;
type PropsEnlace = ComponentProps<'a'>;

/** Componentes de markdown ESTABLES (definidos fuera del render): las tablas del modelo se desplazan en lugar de romper la burbuja. */
const COMPONENTES_MD = {
    table: ({ node, ...p }: PropsTabla & { node?: unknown }) => {
        void node;   // react-markdown pasa el nodo del árbol: no debe llegar al DOM
        return <div className="ci-tabla-wrap" tabIndex={0} role="region" aria-label="Tabla de la respuesta"><table className="sc-tabla" {...p} /></div>;
    },
    // Las imágenes del modelo NO se cargan solas (una página del RAG con instrucciones inyectadas podría filtrar datos en la URL).
    img: ({ alt }: { alt?: string }) => <span>[imagen omitida{alt ? `: ${alt}` : ''}]</span>,
    a: ({ node, href, children, ...p }: PropsEnlace & { node?: unknown }) => {
        void node;
        const seguro = hrefSeguro(href);
        return seguro
            ? <a {...p} href={seguro} target="_blank" rel="noopener noreferrer">{children}</a>
            : <span>{children}</span>;     // esquemas peligrosos (javascript:, data:) no son enlaces
    },
};

const etiquetaMotor = (proveedor?: string, modelo?: string | null) => {
    if (!proveedor) return null;
    if (proveedor === 'groq') return 'Motor de respaldo (Groq)';
    return `Claude${modelo ? ` · ${modelo.replace(/^claude-/, '')}` : ''}`;
};

interface Props {
    msg: ChatMessage;
    /** El mensaje se está generando ahora mismo. */
    transmitiendo?: boolean;
    esUltimaRespuesta?: boolean;
    onRegenerar?: () => void;
    onContinuar?: () => void;
    /** Valoración guardada (1 útil, -1 no útil); solo se ofrece cuando la respuesta ya está guardada en el servidor. */
    valoracion?: 1 | -1;
    onValorar?: (id: string, valor: 1 | -1) => void;
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MensajeBurbujaBase({ msg, transmitiendo, esUltimaRespuesta, onRegenerar, onContinuar, valoracion, onValorar }: Props) {
    const [copiado, setCopiado] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [falloExportar, setFalloExportar] = useState(false);
    const esAsistente = msg.role === 'assistant';
    const meta = msg.metadata ?? undefined;
    const motor = useMemo(() => etiquetaMotor(meta?.proveedor, meta?.modelo), [meta?.proveedor, meta?.modelo]);

    const copiar = async () => {
        if (await copiarTexto(msg.content)) { setCopiado(true); window.setTimeout(() => setCopiado(false), 1800); }
    };

    const exportar = async () => {
        setExportando(true); setFalloExportar(false);
        try { (await import('./exportar')).exportarRespuestaPng(msg).catch(() => setFalloExportar(true)).finally(() => setExportando(false)); }
        catch { setFalloExportar(true); setExportando(false); }
    };

    return (
        <div className={`ci-msg ${esAsistente ? 'ci-msg-asistente' : 'ci-msg-usuario'}`}>
            <div className="ci-avatar" aria-hidden="true">{esAsistente ? <Brain size={16} /> : <Droplets size={16} />}</div>
            <div className="ci-cuerpo">
                <span className="sc-sr">{esAsistente ? 'Asistente' : 'Tú'}:</span>
                {esAsistente && meta?.tarjetas && meta.tarjetas.length > 0 && <TarjetasDatos tarjetas={meta.tarjetas} />}
                <div className="ci-burbuja">
                    {esAsistente
                        ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES_MD}>{msg.content}</ReactMarkdown>
                        : msg.content}
                    {transmitiendo && <span className="ci-cursor" aria-hidden="true" />}
                </div>

                {esAsistente && meta?.fuentes && meta.fuentes.length > 0 && (
                    <ul className="ci-fuentes" aria-label="Fuentes consultadas">
                        {meta.fuentes.map((f) => (
                            <li key={f.documento} className="ci-fuente" title={`${f.documento} · similitud ${(f.similitud * 100).toFixed(0)} %`}>
                                <FileText size={12} aria-hidden="true" />
                                <span>{f.documento}</span>
                                <span>{(f.similitud * 100).toFixed(0)} %</span>
                            </li>
                        ))}
                    </ul>
                )}

                {esAsistente && !transmitiendo && (meta?.persistido === false || (meta?.datos_incompletos?.length ?? 0) > 0) && (
                    <div className="ci-aviso-fila" role="note">
                        {meta?.datos_incompletos && meta.datos_incompletos.length > 0 && (
                            <span className="sc-estado sc-estado-warn"><AlertTriangle size={12} aria-hidden="true" /> Datos incompletos: {meta.datos_incompletos.join(', ')}</span>
                        )}
                        {meta?.persistido === false && (
                            <span className="sc-estado sc-estado-warn"><AlertTriangle size={12} aria-hidden="true" /> No se guardó en el historial</span>
                        )}
                    </div>
                )}

                {esAsistente && !transmitiendo && (meta?.truncada || meta?.abortada) && (
                    <div className="ci-aviso-fila">
                        <span className="sc-estado sc-estado-warn"><AlertTriangle size={12} aria-hidden="true" /> {meta.abortada ? 'Respuesta detenida' : 'Respuesta incompleta'}</span>
                        {onContinuar && esUltimaRespuesta && (
                            <button type="button" className="ci-accion" onClick={onContinuar}><PlayCircle size={14} aria-hidden="true" /> Continuar</button>
                        )}
                    </div>
                )}

                <div className="ci-meta">
                    <time dateTime={msg.created_at}>{formatTime(msg.created_at)}</time>
                    {esAsistente && motor && <span>{motor}</span>}
                </div>

                {esAsistente && !transmitiendo && msg.content && (
                    <div className="ci-acciones">
                        <button type="button" className="ci-accion" onClick={copiar} aria-label="Copiar la respuesta">
                            {copiado ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copiado ? 'Copiada' : 'Copiar'}
                        </button>
                        <button type="button" className="ci-accion" onClick={() => void exportar()} disabled={exportando} aria-label="Guardar la respuesta como imagen">
                            {exportando ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ImageDown size={14} aria-hidden="true" />} {exportando ? 'Generando…' : 'Imagen'}
                        </button>
                        {falloExportar && <span className="ci-sd" role="alert">No se pudo generar la imagen</span>}
                        {onValorar && ES_UUID.test(msg.id) && (
                            <span className="ci-valorar" role="group" aria-label="¿Fue útil la respuesta?">
                                <button type="button" className="ci-accion" aria-pressed={valoracion === 1} onClick={() => onValorar(msg.id, 1)} aria-label="Útil"><ThumbsUp size={14} aria-hidden="true" /></button>
                                <button type="button" className="ci-accion" aria-pressed={valoracion === -1} onClick={() => onValorar(msg.id, -1)} aria-label="No útil"><ThumbsDown size={14} aria-hidden="true" /></button>
                            </span>
                        )}
                        {onRegenerar && esUltimaRespuesta && (
                            <button type="button" className="ci-accion" onClick={onRegenerar}><RefreshCw size={14} aria-hidden="true" /> Regenerar</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Memoizado: durante el streaming solo se vuelve a renderizar (y re-parsear el markdown de) el mensaje que cambia. */
export const MensajeBurbuja = memo(MensajeBurbujaBase);
