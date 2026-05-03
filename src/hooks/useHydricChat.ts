import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const isJwtError = (msg: string) =>
    /algorithm|JWT|token.*invalid|invalid.*token|unauthorized|expired/i.test(msg ?? '');

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

interface SendMessageResult {
    conversation_id: string;
    message: string;
    metadata?: Record<string, any>;
}

export function useHydricChat() {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);

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

    // ─── Send a message ──────────────────────────────
    const sendMessage = useCallback(async (content: string, contexto?: string): Promise<void> => {
        if (!content.trim() || isSending) return;

        setIsSending(true);
        setError(null);

        const optimisticUserMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticUserMsg]);

        try {
            const { data, error: invokeError } = await supabase.functions.invoke('hydric-chat', {
                body: {
                    message: content,
                    conversation_id: activeConversationId,
                    contexto: contexto || 'general',
                }
            });

            if (invokeError) {
                console.error('Invoke error details:', invokeError);
                if (isJwtError(invokeError.message ?? '')) {
                    const { error: refreshErr } = await supabase.auth.refreshSession();
                    if (refreshErr) throw new Error('Tu sesión ha expirado. Inicia sesión de nuevo.');
                    const { data: retryData, error: retryError } = await supabase.functions.invoke('hydric-chat', {
                        body: { message: content, conversation_id: activeConversationId, contexto: contexto || 'general' }
                    });
                    if (retryError) throw retryError;
                    handleSuccess(retryData);
                } else {
                    throw invokeError;
                }
            } else {
                handleSuccess(data);
            }

            function handleSuccess(result: SendMessageResult) {
                if (!activeConversationId) {
                    setActiveConversationId(result.conversation_id);
                }
                fetchConversations(true); // Sidebar refresh silencioso

                const assistantMsg: ChatMessage = {
                    id: `assistant-${Date.now()}`,
                    role: 'assistant',
                    content: result.message,
                    metadata: result.metadata,
                    created_at: new Date().toISOString(),
                };
                setMessages(prev => [...prev, assistantMsg]);
            }

        } catch (err: any) {
            console.error('Error sending message:', err);

            let msg = 'Error desconocido';
            if (err.context && typeof err.context === 'object') {
                try {
                    const body = await err.context.json?.() || err.context.message;
                    msg = body?.message || body?.error || err.message || msg;
                } catch {
                    msg = err.message || msg;
                }
            } else {
                msg = err.message || msg;
            }

            const lowerMsg = (msg || '').toLowerCase();
            if ((msg || '').includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('expired')) {
                msg = 'Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.';
            }

            setError(msg);
            setMessages(prev => prev.filter(m => m.id !== optimisticUserMsg.id));
        } finally {
            setIsSending(false);
        }
    }, [activeConversationId, isSending, fetchConversations]);

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
        error,
        historialJwtError,
        sendMessage,
        selectConversation,
        startNewConversation,
        deleteConversation,
        clearError: () => setError(null),
    };
}
