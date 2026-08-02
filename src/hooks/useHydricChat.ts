import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const isJwtError = (msg: string) =>
    /algorithm|JWT|token.*invalid|invalid.*token|unauthorized|expired/i.test(msg ?? '');

const HYDRIC_CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hydric-chat`;

// Cada mensaje reconstruye ~4,000+ tokens de contexto de sistema — sin este
// piso, un usuario puede ráfaga de mensajes cortos y agotar la cuota de Groq
// para todos. isSending ya bloquea "mientras responde", pero una respuesta
// rápida deja hueco para reenviar de inmediato; este cooldown lo cierra.
const SEND_COOLDOWN_MS = 3000;

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
    created_at: string;
}

export interface ChatConversation {
    id: string;
    titulo: string;
    contexto: string | null;
    created_at: string;
    updated_at: string;
}

export function useHydricChat() {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const lastSendAtRef = useRef(0);

    // error → solo para fallos de sendMessage/deleteConversation (muestra banner)
    // historialJwtError → fallo silencioso del sidebar (nota discreta, sin banner)
    const [error, setError] = useState<string | null>(null);
    const [historialJwtError, setHistorialJwtError] = useState(false);

    // ─── Fetch all conversations ─────────────────────
    // JWT errors del historial NUNCA generan banner — son del sidebar, no del chat.
    const fetchConversations = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_conversations')
                .select('*')
                .order('updated_at', { ascending: false });

            if (fetchError) throw fetchError;
            setConversations(data || []);
            setHistorialJwtError(false);
        } catch (err: any) {
            const msg: string = err.message ?? '';
            if (msg.includes('does not exist')) return;
            if (silent) return;

            if (isJwtError(msg)) {
                // Intentar refresh silencioso
                const { error: refreshErr } = await supabase.auth.refreshSession();
                if (!refreshErr) {
                    // Refresh OK → reintentar una vez
                    try {
                        const { data: retry } = await supabase
                            .from('chat_conversations')
                            .select('*')
                            .order('updated_at', { ascending: false });
                        setConversations(retry || []);
                        setHistorialJwtError(false);
                    } catch {
                        // Retry también falló → marcar historial no disponible, sin banner
                        setHistorialJwtError(true);
                    }
                } else {
                    // Refresh falló → historial no disponible, sin banner
                    setHistorialJwtError(true);
                }
            } else {
                // Error no-JWT del historial → nota discreta, sin banner
                console.warn('[useHydricChat] fetchConversations error:', msg);
                setHistorialJwtError(true);
            }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    // ─── Fetch messages for a conversation ───────────
    const fetchMessages = useCallback(async (conversationId: string) => {
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (fetchError) throw fetchError;
            setMessages(data || []);
        } catch (err: any) {
            console.error('Error fetching messages:', err);
            if (!isJwtError(err.message ?? '')) {
                setError(err.message || 'Error al cargar mensajes');
            }
        }
    }, []);

    // ─── Select a conversation ───────────────────────
    const selectConversation = useCallback(async (conversationId: string) => {
        setActiveConversationId(conversationId);
        await fetchMessages(conversationId);
    }, [fetchMessages]);

    // ─── Start new conversation ──────────────────────
    const startNewConversation = useCallback(() => {
        setActiveConversationId(null);
        setMessages([]);
        setError(null);
    }, []);

    // ─── Send a message (streaming SSE) ──────────────
    // La Edge Function responde con Server-Sent Events: cada línea "data: {...}"
    // trae un delta de texto nuevo. Se pinta incrementalmente en vez de esperar
    // el bloque completo (antes: 8-15s de pantalla en blanco por el prompt de
    // sistema denso + tablas de balance que el modelo debe generar).
    const streamChat = useCallback(async (content: string, contexto: string, assistantMsgId: string) => {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.');

        const res = await fetch(HYDRIC_CHAT_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
                message: content,
                conversation_id: activeConversationId,
                contexto: contexto || 'general',
            }),
        });

        if (!res.ok || !res.body) {
            let msg = `Error del servidor (${res.status})`;
            try {
                const body = await res.json();
                msg = body?.message || body?.error || msg;
            } catch { /* respuesta no-JSON, se usa el mensaje genérico */ }
            const err: any = new Error(msg);
            // res.status es el código HTTP de ESTA función (siempre 400 en el catch
            // de index.ts, ver línea ~796) — nunca el 401 que Groq pudo haber
            // devuelto puertas adentro por cuota/rate-limit agotado. Ese 401 de
            // Groq viaja como TEXTO dentro de `msg` ("Groq API Error: 401 — ..."),
            // no como res.status. Confundirlos hace que un error de créditos de
            // Groq dispare un refreshSession() de Supabase + reintento automático,
            // que vuelve a fallar por el mismo motivo y duplica el gasto de cuota
            // en cada mensaje enviado.
            err.status = res.status;
            err.isGroqError = /groq api error/i.test(msg);
            throw err;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';
        let resolvedConvId: string | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload) continue;
                let json: any;
                try { json = JSON.parse(payload); } catch { continue; }

                if (json.error) {
                    const streamErr: any = new Error(json.message || 'Error de streaming');
                    streamErr.isGroqError = /groq/i.test(json.message ?? '');
                    throw streamErr;
                }
                if (json.conversation_id) resolvedConvId = json.conversation_id;
                if (json.delta) {
                    accumulated += json.delta;
                    setMessages(prev => prev.map(m =>
                        m.id === assistantMsgId ? { ...m, content: accumulated } : m
                    ));
                }
                if (json.done) {
                    if (resolvedConvId && !activeConversationId) setActiveConversationId(resolvedConvId);
                    fetchConversations(true); // Sidebar refresh silencioso
                }
            }
        }

        if (!accumulated) throw new Error('No se recibió respuesta del asistente.');
    }, [activeConversationId, fetchConversations]);

    const sendMessage = useCallback(async (content: string, contexto?: string): Promise<void> => {
        if (!content.trim() || isSending) return;

        const elapsed = Date.now() - lastSendAtRef.current;
        if (elapsed < SEND_COOLDOWN_MS) {
            const remaining = Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000);
            setError(`Espera ${remaining}s antes de enviar otro mensaje — cada consulta reconstruye el contexto completo del sistema.`);
            return;
        }
        lastSendAtRef.current = Date.now();
        setCooldownUntil(Date.now() + SEND_COOLDOWN_MS);

        setIsSending(true);
        setError(null);

        const optimisticUserMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        const assistantMsgId = `assistant-${Date.now()}`;
        const placeholderAssistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticUserMsg, placeholderAssistantMsg]);

        try {
            try {
                await streamChat(content, contexto || 'general', assistantMsgId);
            } catch (err: any) {
                // Un 401/expired de Groq (cuota o rate-limit de la API de IA agotados)
                // NO es una sesión de Supabase vencida — reintentar solo tiene sentido
                // para el JWT de Supabase. Reintentar un error de Groq solo duplica el
                // consumo de la cuota sin arreglar nada.
                if (!err.isGroqError && (isJwtError(err.message ?? '') || err.status === 401)) {
                    const { error: refreshErr } = await supabase.auth.refreshSession();
                    if (refreshErr) throw new Error('Tu sesión ha expirado. Inicia sesión de nuevo.');
                    await streamChat(content, contexto || 'general', assistantMsgId);
                } else {
                    throw err;
                }
            }
        } catch (err: any) {
            console.error('Error sending message:', err);

            let msg = err.message || 'Error desconocido';
            if (err.isGroqError) {
                // Mensaje real de Groq (p.ej. "429 rate limit" o "401 invalid_api_key
                // / insufficient credits") — mostrarlo tal cual, no reescribirlo como
                // si fuera un problema de sesión de Supabase.
                msg = /429|rate.?limit|quota|credit/i.test(msg)
                    ? 'El motor de IA alcanzó su límite de uso (cuota/rate-limit de Groq). Espera unos minutos e intenta de nuevo.'
                    : `Error del motor de IA: ${msg.replace(/^groq api error:\s*/i, '')}`;
            } else {
                const lowerMsg = msg.toLowerCase();
                if (msg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('expired')) {
                    msg = 'Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.';
                }
            }

            setError(msg);
            setMessages(prev => prev.filter(m => m.id !== optimisticUserMsg.id && m.id !== assistantMsgId));
        } finally {
            setIsSending(false);
        }
    }, [isSending, streamChat]);

    // ─── Delete conversation ─────────────────────────
    const deleteConversation = useCallback(async (conversationId: string) => {
        try {
            const { error: deleteError } = await supabase
                .from('chat_conversations')
                .delete()
                .eq('id', conversationId);

            if (deleteError) throw deleteError;
            setConversations(prev => prev.filter(c => c.id !== conversationId));
            if (activeConversationId === conversationId) startNewConversation();
        } catch (err: any) {
            console.error('Error deleting conversation:', err);
            if (!isJwtError(err.message ?? '')) {
                setError(err.message);
            }
        }
    }, [activeConversationId, startNewConversation]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    return {
        conversations,
        activeConversationId,
        messages,
        isLoading,
        isSending,
        cooldownUntil,
        error,
        historialJwtError,
        sendMessage,
        selectConversation,
        startNewConversation,
        deleteConversation,
        clearError: () => setError(null),
    };
}
