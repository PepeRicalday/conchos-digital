import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { aplicaEvento, ErrorStream, estadoInicial, separaEventos, type EstadoStream } from '../utils/sseChat';

const isJwtError = (msg: string) =>
    /algorithm|JWT|token.*invalid|invalid.*token|unauthorized|expired/i.test(msg ?? '');

const HYDRIC_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hydric-chat`;

// El servidor ya limita (6/min, 60/h); este piso solo evita dobles envíos accidentales.
const SEND_COOLDOWN_MS = 2000;

// ─── Tipos del chat ─────────────────────────────────────────────────────────────────────────────────────────────
/** Tabla estructurada que calcula el servidor (presas, escalas, balance…). Valores null = S/D. */
export interface Tarjeta {
    kind: string;
    titulo: string;
    columnas: string[];
    filas: Array<Array<string | number | null>>;
    nota?: string;
}
export interface FuenteRag { documento: string; similitud: number }

export interface MetaMensaje {
    tarjetas?: Tarjeta[];
    fuentes?: FuenteRag[];
    proveedor?: string;
    modelo?: string | null;
    truncada?: boolean;
    abortada?: boolean;
    persistido?: boolean;
    rechazada?: boolean;
    datos_incompletos?: string[];
    [k: string]: unknown;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: MetaMensaje | null;
    created_at: string;
}

export interface ChatConversation {
    id: string;
    titulo: string;
    contexto: string | null;
    created_at: string;
    updated_at: string;
}

export interface MotorIA { proveedor: string; modelo: string | null }
export interface PasoActual { estado: string | null; pensando: string }
export interface EnvioFallido { texto: string; contexto: string; clientMsgId: string }

interface ErrorHttp extends Error { status?: number; code?: string; convId?: string | null; parcial?: boolean }

const DETENIDA_SIN_TEXTO = 'Respuesta detenida antes de generar texto.';

const nuevoClientMsgId = () => `m_${crypto.randomUUID()}`;

export function useHydricChat() {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const [paso, setPaso] = useState<PasoActual>({ estado: null, pensando: '' });
    const [motor, setMotor] = useState<MotorIA | null>(null);
    const [fallido, setFallido] = useState<EnvioFallido | null>(null);
    const lastSendAtRef = useRef(0);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeIdRef = useRef<string | null>(null);
    useEffect(() => { activeIdRef.current = activeConversationId; }, [activeConversationId]);

    // error → fallos de envío/borrado (banner); historialJwtError → fallo del historial (nota discreta, sin banner)
    const [error, setError] = useState<string | null>(null);
    const [historialJwtError, setHistorialJwtError] = useState(false);

    // ─── Historial de conversaciones ──────────────────────────────────────────────────────────────────────────────
    const fetchConversations = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_conversations')
                .select('*')
                .order('updated_at', { ascending: false });
            if (fetchError) throw fetchError;
            setConversations((data as ChatConversation[]) || []);
            setHistorialJwtError(false);
        } catch (err) {
            const msg: string = (err as Error)?.message ?? '';
            if (msg.includes('does not exist') || silent) return;
            if (isJwtError(msg)) {
                const { error: refreshErr } = await supabase.auth.refreshSession();
                if (!refreshErr) {
                    const { data: retry, error: retryErr } = await supabase
                        .from('chat_conversations').select('*').order('updated_at', { ascending: false });
                    if (retryErr) setHistorialJwtError(true);
                    else { setConversations((retry as ChatConversation[]) || []); setHistorialJwtError(false); }
                } else setHistorialJwtError(true);
            } else {
                console.warn('[useHydricChat] fetchConversations error:', msg);
                setHistorialJwtError(true);
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    // ─── Mensajes de una conversación ─────────────────────────────────────────────────────────────────────────────
    const fetchMessages = useCallback(async (conversationId: string) => {
        setIsLoadingMessages(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });
            if (fetchError) throw fetchError;
            // Si el usuario cambió de conversación mientras cargaba, no pisar la actual.
            if (activeIdRef.current === conversationId) setMessages((data as ChatMessage[]) || []);
        } catch (err) {
            console.error('Error fetching messages:', err);
            const msg = (err as Error)?.message ?? '';
            if (!isJwtError(msg)) setError(msg || 'Error al cargar mensajes');
        } finally {
            setIsLoadingMessages(false);
        }
    }, []);

    const detener = useCallback(() => { abortRef.current?.abort('usuario'); }, []);

    const selectConversation = useCallback(async (conversationId: string) => {
        if (conversationId === activeIdRef.current) return;     // tocar la conversación actual no debe cortar su respuesta
        abortRef.current?.abort('navegacion');
        setFallido(null);
        setActiveConversationId(conversationId);
        activeIdRef.current = conversationId;
        setMessages([]);
        await fetchMessages(conversationId);
    }, [fetchMessages]);

    const startNewConversation = useCallback(() => {
        abortRef.current?.abort('navegacion');
        setActiveConversationId(null);
        activeIdRef.current = null;
        setMessages([]);
        setError(null);
        setFallido(null);
    }, []);

    // ─── Envío por streaming (SSE) ────────────────────────────────────────────────────────────────────────────────
    const streamChat = useCallback(async (
        content: string, contexto: string, assistantMsgId: string, clientMsgId: string, signal: AbortSignal,
    ) => {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.');

        const res = await fetch(HYDRIC_CHAT_URL, {
            method: 'POST',
            signal,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                message: content,
                conversation_id: activeIdRef.current,
                contexto: contexto || 'general',
                client_msg_id: clientMsgId,
            }),
        });

        if (!res.ok || !res.body) {
            let msg = `Error del servidor (${res.status})`;
            let code: string | undefined;
            try {
                const body = await res.json();
                msg = body?.message || body?.error || msg;
                code = body?.code;
            } catch { /* respuesta no-JSON: mensaje genérico */ }
            const err: ErrorHttp = new Error(msg);
            err.status = res.status;
            err.code = code;
            throw err;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const convInicial = activeIdRef.current;
        let est: EstadoStream = estadoInicial(convInicial);
        let pendiente = false;

        // Los deltas llegan por decenas por segundo: se aplican una vez por fotograma, no en cada token.
        const aplica = () => {
            pendiente = false;
            const contenido = est.texto || (est.meta.abortada ? DETENIDA_SIN_TEXTO : '');
            setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: contenido, metadata: { ...est.meta } } : m));
        };
        const programa = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(aplica); } };

        // El destino final (conversación nueva, historial) se resuelve igual al terminar o al ser detenido.
        const cierra = () => {
            // Solo se adopta si el usuario sigue donde empezó (si navegó, no se le devuelve a la conversación anterior).
            if (est.convId && !activeIdRef.current && convInicial === null) { activeIdRef.current = est.convId; setActiveConversationId(est.convId); }
            fetchConversations(true);
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const { eventos, resto } = separaEventos(buffer);
                buffer = resto;
                for (const ev of eventos) {
                    const antes = est;
                    est = aplicaEvento(est, ev);            // un evento `error` lanza ErrorStream
                    if (est.motor !== antes.motor && est.motor) setMotor(est.motor);
                    if (est.estado !== antes.estado || est.pensando !== antes.pensando) setPaso({ estado: est.estado, pensando: est.pensando });
                    if (est.meta !== antes.meta || est.texto !== antes.texto) programa();
                    if (est.hecho && !antes.hecho) cierra();
                }
            }
        } catch (err) {
            if (signal.aborted) {
                if (signal.reason !== 'usuario') return;     // navegó a otra conversación: no se toca el estado
                // Detenido por el usuario: se conserva lo que ya se escribió (el servidor también lo persiste).
                est = { ...est, meta: { ...est.meta, abortada: true } };
                aplica();
                cierra();
                return;
            }
            if (err instanceof ErrorStream) {
                const e: ErrorHttp = new Error(err.message);
                e.code = err.code;
                e.convId = est.convId;
                e.parcial = !!est.texto;
                throw e;
            }
            throw err;
        }
        aplica();
        if (!est.texto) throw new Error('No se recibió respuesta del asistente.');
    }, [fetchConversations]);

    /** Devuelve true si el mensaje se envió y respondió; false si falló (el texto queda en `fallido` para reintentar). */
    const sendMessage = useCallback(async (content: string, contexto?: string, reintento?: EnvioFallido): Promise<boolean> => {
        const texto = content.trim();
        if (!texto || isSending) return false;

        const elapsed = Date.now() - lastSendAtRef.current;
        if (elapsed < SEND_COOLDOWN_MS) { setCooldownUntil(lastSendAtRef.current + SEND_COOLDOWN_MS); return false; }
        lastSendAtRef.current = Date.now();
        setCooldownUntil(Date.now() + SEND_COOLDOWN_MS);
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = setTimeout(() => setCooldownUntil(null), SEND_COOLDOWN_MS + 50);   // sin reloj eterno en la interfaz

        const ctx = contexto || reintento?.contexto || 'general';
        const clientMsgId = reintento?.clientMsgId ?? nuevoClientMsgId();
        const ac = new AbortController();
        abortRef.current = ac;

        setIsSending(true);
        setError(null);
        setFallido(null);
        setPaso({ estado: null, pensando: '' });

        const stamp = Date.now();
        const optimisticUserMsg: ChatMessage = { id: `temp-${stamp}`, role: 'user', content: texto, created_at: new Date().toISOString() };
        const assistantMsgId = `assistant-${stamp}`;
        const placeholder: ChatMessage = { id: assistantMsgId, role: 'assistant', content: '', created_at: new Date().toISOString() };
        setMessages(prev => [...prev, optimisticUserMsg, placeholder]);

        try {
            try {
                await streamChat(texto, ctx, assistantMsgId, clientMsgId, ac.signal);
            } catch (err) {
                const e = err as ErrorHttp;
                // 401 = sesión de Supabase vencida (el servidor ya no confunde esto con errores del motor de IA).
                if (e.status === 401 && !ac.signal.aborted) {
                    const { error: refreshErr } = await supabase.auth.refreshSession();
                    if (refreshErr) throw new Error('Tu sesión ha expirado. Inicia sesión de nuevo.');
                    await streamChat(texto, ctx, assistantMsgId, clientMsgId, ac.signal);   // mismo client_msg_id: no se duplica
                } else {
                    throw err;
                }
            }
            return true;
        } catch (err) {
            if (ac.signal.aborted) {
                // Detenido por el usuario antes de la respuesta (o ya resuelto en streamChat). Si fue por navegación, nada que mostrar.
                if (ac.signal.reason === 'usuario') {
                    setMessages(prev => prev.map(m => m.id === assistantMsgId && !m.content ? { ...m, content: DETENIDA_SIN_TEXTO, metadata: { abortada: true } } : m));
                }
                return true;
            }
            console.error('Error sending message:', err);
            const e = err as ErrorHttp;
            // Si el servidor ya había creado la conversación, se adopta (si no, reintentar crearía una segunda).
            if (e.convId && activeIdRef.current === null) { activeIdRef.current = e.convId; setActiveConversationId(e.convId); }
            if (e.convId) fetchConversations(true);
            // La pregunta ya fue respondida/guardada: se recarga en vez de mostrar un error sin salida.
            if (e.code === 'duplicado' && activeIdRef.current) {
                void fetchMessages(activeIdRef.current);
                return true;
            }
            // Respuesta a medias (el servidor la guardó): se conserva, marcada incompleta; se ofrece "Continuar", no "Reintentar".
            if (e.parcial) {
                setError(`${e.message || 'La respuesta se interrumpió'}. Lo generado se conservó; puedes pedir que continúe.`);
                setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, metadata: { ...m.metadata, truncada: true } } : m));
                return true;     // la consulta quedó guardada: no hay nada que devolver al campo de texto
            }
            let msg = e.message || 'Error desconocido';
            if (e.code === undefined && /JWT|unauthorized|expired/i.test(msg)) msg = 'Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.';
            setError(msg);
            // El texto NO se pierde: se conserva para reintentar con el mismo client_msg_id.
            setFallido({ texto, contexto: ctx, clientMsgId });
            setMessages(prev => prev.filter(m => m.id !== optimisticUserMsg.id && m.id !== assistantMsgId));
            return false;
        } finally {
            setIsSending(false);
            setPaso({ estado: null, pensando: '' });
            if (abortRef.current === ac) abortRef.current = null;
        }
    }, [isSending, streamChat, fetchConversations, fetchMessages]);

    // ─── Renombrar y eliminar (verificando que la BD realmente lo hizo) ──────────────────────────────────────────────
    const renameConversation = useCallback(async (conversationId: string, titulo: string) => {
        const t = titulo.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!t) return;
        const { data, error: upErr } = await supabase.from('chat_conversations').update({ titulo: t }).eq('id', conversationId).select('id');
        if (upErr || !data?.length) { setError(upErr?.message || 'No se pudo renombrar la conversación.'); return; }
        setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, titulo: t } : c));
    }, []);

    const deleteConversation = useCallback(async (conversationId: string) => {
        try {
            const { data, error: deleteError } = await supabase
                .from('chat_conversations').delete().eq('id', conversationId).select('id');
            if (deleteError) throw deleteError;
            // Un DELETE sin política que lo permita afecta 0 filas SIN error: no se puede dar por borrado.
            if (!data?.length) throw new Error('No se pudo eliminar la conversación (sin permiso o ya no existe).');
            setConversations(prev => prev.filter(c => c.id !== conversationId));
            if (activeIdRef.current === conversationId) startNewConversation();
        } catch (err) {
            console.error('Error deleting conversation:', err);
            const msg = (err as Error)?.message ?? '';
            if (!isJwtError(msg)) setError(msg);
        }
    }, [startNewConversation]);

    useEffect(() => { fetchConversations(); }, [fetchConversations]);
    useEffect(() => () => { abortRef.current?.abort('navegacion'); if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current); }, []);

    return {
        conversations,
        activeConversationId,
        messages,
        isLoading,
        isLoadingMessages,
        isSending,
        cooldownUntil,
        error,
        historialJwtError,
        paso,
        motor,
        fallido,
        sendMessage,
        detener,
        selectConversation,
        startNewConversation,
        renameConversation,
        deleteConversation,
        clearError: () => setError(null),
        clearFallido: () => setFallido(null),
    };
}
