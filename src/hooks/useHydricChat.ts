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
            setError(err.message || 'Error al cargar mensajes');
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

    // ─── Send a message (Using Supabase Invoke) ─────
    const sendMessage = useCallback(async (content: string, contexto?: string): Promise<void> => {
        if (!content.trim() || isSending) return;

        setIsSending(true);
        setError(null);

        // Optimistic UI
        const optimisticUserMsg: ChatMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimisticUserMsg]);

        try {
            // Invocamos la función de forma nativa
            const { data, error: invokeError } = await supabase.functions.invoke('hydric-chat', {
                body: {
                    message: content,
                    conversation_id: activeConversationId,
                    contexto: contexto || 'general',
                }
            });

            if (invokeError) {
                console.error('Invoke error details:', invokeError);
                // Si es un error de JWT expirado, intentamos forzar un refresh
                if (invokeError.message?.toLowerCase().includes('expired') || invokeError.message?.toLowerCase().includes('unauthorized')) {
                    const { error: refreshErr } = await supabase.auth.refreshSession();
                    if (refreshErr) throw new Error('Tu sesión ha expirado totalmente. Inicia sesión de nuevo.');
                    // Reintentar una vez tras el refresh
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
                fetchConversations();

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
            let msg = err.message || 'Error desconocido';
            if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('expired')) {
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
            setError(err.message);
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
        sendMessage,
        selectConversation,
        startNewConversation,
        deleteConversation,
        clearError: () => setError(null),
    };

}
