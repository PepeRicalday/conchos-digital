import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, Brain, History, Loader2, Plus, RefreshCw, Send, Square } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ChatMessage, EnvioFallido, PasoActual } from '../../hooks/useHydricChat';
import { sugerencias, type ContextoChat } from '../../utils/consultoria';
import { useAhora } from '../../hooks/useAhora';
import { MensajeBurbuja } from './MensajeBurbuja';

const MAX_MENSAJE = 4000;
const AVISO_LARGO = 3500;

interface Props {
    mensajes: ChatMessage[];
    cargandoMensajes: boolean;
    enviando: boolean;
    paso: PasoActual;
    error: string | null;
    fallido: EnvioFallido | null;
    cooldownUntil: number | null;
    eventoTipo: string | null | undefined;
    onEnviar: (texto: string, contexto?: ContextoChat) => Promise<boolean>;
    onReintentar: (f: EnvioFallido) => void;
    onDetener: () => void;
    onNueva: () => void;
    onAbrirHistorial: () => void;
    onCerrarError: () => void;
}

const esErrorSesion = (m: string) => /sesi[oó]n|JWT|token|expir/i.test(m);

export function ChatPanel(p: Props) {
    const [texto, setTexto] = useState('');
    const [pegado, setPegado] = useState(true);      // el usuario está leyendo lo último: se sigue el final
    const logRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const lista = useMemo(() => sugerencias(p.eventoTipo), [p.eventoTipo]);

    // Cuenta regresiva del enfriamiento (solo feedback: el hook ya bloquea el envío).
    const ahora = useAhora(250, p.cooldownUntil != null);
    const segundos = p.cooldownUntil && ahora ? Math.max(0, Math.ceil((p.cooldownUntil - ahora) / 1000)) : 0;

    // El mensaje que falló vuelve al campo de texto: no se pierde lo que se escribió (estado derivado de la prop, sin efecto).
    const [fallidoVisto, setFallidoVisto] = useState<EnvioFallido | null>(null);
    if (p.fallido && p.fallido !== fallidoVisto) {
        setFallidoVisto(p.fallido);
        setTexto((t) => (t.trim() ? t : p.fallido!.texto));
    }

    const ajustaAlto = useCallback(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
        ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden';   // sin flechas de scroll mientras cabe
    }, []);
    useEffect(ajustaAlto, [texto, ajustaAlto]);

    // Auto-scroll solo si el usuario sigue en el final (antes arrebataba el scroll a quien subía a leer).
    const alFinal = useCallback((suave: boolean) => {
        const el = logRef.current;
        if (!el) return;
        const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollTo({ top: el.scrollHeight, behavior: suave && !reducido ? 'smooth' : 'auto' });
    }, []);
    useEffect(() => { if (pegado) alFinal(!p.enviando); }, [p.mensajes, p.paso, pegado, p.enviando, alFinal]);
    const alScroll = () => {
        const el = logRef.current;
        if (el) setPegado(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    };

    const enfriando = p.cooldownUntil != null;     // el hook limpia el enfriamiento solo a los ~2 s
    const enviar = async (t = texto, ctx?: ContextoChat) => {
        const limpio = t.trim();
        if (!limpio || p.enviando || enfriando) return;      // en enfriamiento no se toca el campo: nada se borra sin enviarse
        setTexto('');
        setPegado(true);
        const ok = await p.onEnviar(limpio, ctx);
        if (!ok) setTexto((actual) => (actual.trim() ? actual : limpio));      // no se envió: el texto vuelve al campo
        taRef.current?.focus();      // el foco vuelve al campo (antes se perdía al deshabilitarse el textarea)
    };

    const alTeclear = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); }
    };

    const ultimaAsistente = [...p.mensajes].reverse().find((m) => m.role === 'assistant' && m.content);
    const ultimoUsuario = [...p.mensajes].reverse().find((m) => m.role === 'user');
    const visibles = p.mensajes.filter((m) => m.role !== 'assistant' || m.content);
    const ultimo = p.mensajes[p.mensajes.length - 1];
    const esperandoPrimerToken = p.enviando && ultimo?.role === 'assistant' && !ultimo.content;
    const transmitiendoId = p.enviando && ultimo?.role === 'assistant' && ultimo.content ? ultimo.id : null;
    const cooldown = segundos > 0 && !p.enviando;     // solo cuenta regresiva visual
    const sesion = !!p.error && esErrorSesion(p.error);

    const renovarSesion = async () => {
        const { error } = await supabase.auth.refreshSession();
        if (error) { await supabase.auth.signOut(); window.location.href = '/'; } else window.location.reload();
    };

    return (
        <div className="ci-main">
            <div className="ci-chat-cab">
                <h2>Asistente hídrico</h2>
                <div className="ci-chat-cab-acc">
                    <button type="button" className="sc-btn ci-btn-historial" onClick={p.onAbrirHistorial}><History size={16} aria-hidden="true" /> Historial</button>
                    <button type="button" className="sc-btn" onClick={p.onNueva}><Plus size={16} aria-hidden="true" /> Nueva consulta</button>
                </div>
            </div>

            {p.mensajes.length === 0 && !p.cargandoMensajes ? (
                <div className="ci-bienvenida">
                    <div className="ci-bienvenida-icono" aria-hidden="true"><Brain size={30} /></div>
                    <h2>Asistente de inteligencia hídrica</h2>
                    <p>Consulta el estado real del Distrito de Riego 005: presas, escalas del canal, balance por tramo, módulos y tránsito. Lo que no tenga medición vigente se informa como S/D; nunca se rellena con ceros.</p>
                    <div className="ci-sugerencias">
                        {lista.map((s) => (
                            <button key={s.texto} type="button" className="ci-sugerencia" disabled={p.enviando} onClick={() => void enviar(s.texto, s.contexto)}>
                                <Brain size={16} aria-hidden="true" /><span>{s.texto}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div ref={logRef} className="ci-mensajes" role="log" aria-label="Conversación" aria-live={p.enviando ? 'off' : 'polite'} aria-busy={p.enviando} tabIndex={0} onScroll={alScroll}>
                    {p.cargandoMensajes && <p className="ci-vacio" role="status"><Loader2 size={20} className="spin" aria-hidden="true" /> Cargando la conversación…</p>}
                    {visibles.map((m) => (
                        <MensajeBurbuja key={m.id} msg={m} transmitiendo={m.id === transmitiendoId}
                            esUltimaRespuesta={m.id === ultimaAsistente?.id && !p.enviando}
                            // Solo la última respuesta recibe acciones: las demás conservan props estables y el memo evita re-parsear su markdown.
                            onRegenerar={m.id === ultimaAsistente?.id && ultimoUsuario ? () => void enviar(ultimoUsuario.content) : undefined}
                            onContinuar={m.id === ultimaAsistente?.id ? () => void enviar('Continúa exactamente donde te quedaste, sin repetir lo anterior.') : undefined} />
                    ))}
                    {!p.enviando && ultimo?.role === 'assistant' && ultimo.content && <span className="sc-sr" role="status">Respuesta completa del asistente.</span>}
                    {esperandoPrimerToken && (
                        <div className="ci-paso" role="status">
                            <div className="ci-paso-linea"><span className="ci-puntos" aria-hidden="true"><i /><i /><i /></span><span>{p.paso.estado ?? 'Analizando datos del sistema…'}</span></div>
                            {p.paso.pensando && <p className="ci-paso-pensando">{p.paso.pensando}</p>}
                        </div>
                    )}
                </div>
            )}

            {!pegado && p.mensajes.length > 0 && (
                <button type="button" className="sc-btn ci-ir-final" onClick={() => { setPegado(true); alFinal(true); }}><ArrowDown size={16} aria-hidden="true" /> Ir al final</button>
            )}

            {p.error && (
                <div className="sc-aviso sc-aviso-crit ci-error" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ flex: 1 }}>{p.error}</span>
                    {p.fallido && !sesion && <button type="button" className="sc-btn" onClick={() => { setTexto(''); p.onReintentar(p.fallido!); }}><RefreshCw size={14} aria-hidden="true" /> Reintentar</button>}
                    {sesion && <button type="button" className="sc-btn" onClick={renovarSesion}>Renovar sesión</button>}
                    <button type="button" className="sc-btn" onClick={p.onCerrarError}>Cerrar</button>
                </div>
            )}

            <div className="ci-entrada">
                <div className="ci-entrada-fila">
                    <label className="sc-sr" htmlFor="ci-texto">Escribe tu consulta</label>
                    <textarea id="ci-texto" ref={taRef} value={texto} rows={1} maxLength={MAX_MENSAJE} enterKeyHint="send"
                        onChange={(e) => setTexto(e.target.value)} onKeyDown={alTeclear}
                        placeholder="Pregunta sobre presas, escalas, balance, módulos o tránsito…" />
                    {p.enviando ? (
                        <button type="button" className="ci-enviar ci-detener" onClick={p.onDetener} aria-label="Detener la respuesta"><Square size={18} aria-hidden="true" /></button>
                    ) : (
                        <button type="button" className="ci-enviar" onClick={() => void enviar()} disabled={!texto.trim() || cooldown}
                            aria-label={cooldown ? `Espera ${segundos} s para enviar otra consulta` : 'Enviar consulta'}>
                            {cooldown ? segundos : <Send size={18} aria-hidden="true" />}
                        </button>
                    )}
                </div>
                <div className="ci-entrada-pie">
                    <span>Enter envía · Mayús+Enter salto de línea</span>
                    {texto.length >= AVISO_LARGO && <span className="ci-contador-alto" role="status">{texto.length.toLocaleString('es-MX')} / {MAX_MENSAJE.toLocaleString('es-MX')}</span>}
                </div>
            </div>
        </div>
    );
}
