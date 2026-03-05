import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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

/**
 * Obtiene el token de acceso de la sesión actual.
 * Si el usuario puede ver el dashboard, tiene una sesión válida.
 */
async function getFreshAccessToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
        return session.access_token;
    }
    // Si no hay sesión cacheada, intentar refresh una vez
    const { data } = await supabase.auth.refreshSession();
    if (data.session?.access_token) {
        return data.session.access_token;
    }
    throw new Error('No hay sesión activa. Inicia sesión.');
}

/**
 * Traduce códigos HTTP a mensajes amigables para el usuario
 */
function friendlyErrorMessage(status: number, serverMsg?: string): string {
    switch (status) {
        case 401:
            return 'Tu sesión expiró. Refresca la página o vuelve a iniciar sesión.';
        case 403:
            return serverMsg || 'No tienes permisos para usar el Asistente Hídrico (solo rol SRL).';
        case 429:
            return 'El servicio de IA está saturado. Espera 15 segundos e intenta de nuevo.';
        case 500:
            return serverMsg || 'Error interno del servidor. Verifica que la Edge Function esté desplegada y los secrets configurados.';
        case 502:
        case 503:
        case 504:
            return 'El servicio de IA está temporalmente fuera de línea. Intenta en unos segundos.';
        default:
            return serverMsg || `Error inesperado (${status}). Intenta de nuevo.`;
    }
}

export function useHydricChat() {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ─── Fetch all conversations ─────────────────────
    const fetchConversations = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('chat_conversations')
                .select('*')
                .order('updated_at', { ascending: false });

            if (fetchError) throw fetchError;
            setConversations(data || []);
        } catch (err: any) {
            console.error('Error fetching conversations:', err);
            // No mostrar error ruidoso si la tabla no existe aún
            if (!err.message?.includes('does not exist')) {
                setError(err.message);
            }
        } finally {
            setIsLoading(false);
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
            setError(err.message);
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

    // ─── Core: call Edge Function with retry ─────────
    const callEdgeFunction = useCallback(async (
        accessToken: string,
        body: Record<string, any>
    ): Promise<Response> => {
        return fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hydric-chat`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                },
                body: JSON.stringify(body),
            }
        );
    }, []);

    // ─── Send a message (with auto-retry on 401) ────
    const sendMessage = useCallback(async (content: string, contexto?: string): Promise<void> => {
        if (!content.trim() || isSending) return;

        setIsSending(true);
        setError(null);

        // Optimistic UI: add user message immediately
        const optimisticUserMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticUserMsg]);

        try {
            let accessToken = await getFreshAccessToken();

            const requestBody = {
                message: content,
                conversation_id: activeConversationId,
                contexto: contexto || 'general',
            };

            let response = await callEdgeFunction(accessToken, requestBody);

            // ─── Auto-retry: si da 401, refrescar token y reintentar ───
            if (response.status === 401) {
                console.warn('Token rechazado (401). Refrescando sesión y reintentando...');
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                if (refreshError || !refreshData.session) {
                    throw new Error('Tu sesión ha expirado. Cierra sesión e inicia de nuevo.');
                }
                accessToken = refreshData.session.access_token;
                response = await callEdgeFunction(accessToken, requestBody);
            }

            // ─── Manejar errores finales ───
            if (!response.ok) {
                let serverMsg: string | undefined;
                try {
                    const errData = await response.json();
                    serverMsg = errData.error;
                } catch {
                    // response body wasn't JSON
                }
                throw new Error(friendlyErrorMessage(response.status, serverMsg));
            }

            const result: SendMessageResult = await response.json();

            // If new conversation was created, update state
            if (!activeConversationId) {
                setActiveConversationId(result.conversation_id);
            }

            // Refrescar lista de conversaciones
            fetchConversations();

            // Add assistant response
            const assistantMsg: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: result.message,
                metadata: result.metadata,
                created_at: new Date().toISOString(),
            };
            setMessages(prev => [...prev, assistantMsg]);

        } catch (err: any) {
            console.error('Error sending message:', err);
            setError(err.message);
            // Remove optimistic message on failure
            setMessages(prev => prev.filter(m => m.id !== optimisticUserMsg.id));
        } finally {
            setIsSending(false);
        }
    }, [activeConversationId, isSending, fetchConversations, callEdgeFunction]);

    // ─── Delete conversation ─────────────────────────
    const deleteConversation = useCallback(async (conversationId: string) => {
        try {
            const { error: deleteError } = await supabase
                .from('chat_conversations')
                .delete()
                .eq('id', conversationId);

            if (deleteError) throw deleteError;

            setConversations(prev => prev.filter(c => c.id !== conversationId));
            if (activeConversationId === conversationId) {
                startNewConversation();
            }
        } catch (err: any) {
            console.error('Error deleting conversation:', err);
            setError(err.message);
        }
    }, [activeConversationId, startNewConversation]);

    // ─── Load conversations on mount ─────────────────
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
        sendMessage,
        selectConversation,
        startNewConversation,
        deleteConversation,
        clearError: () => setError(null),
    };
}
