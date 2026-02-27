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

    // Fetch all conversations
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
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Fetch messages for a conversation
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

    // Select a conversation
    const selectConversation = useCallback(async (conversationId: string) => {
        setActiveConversationId(conversationId);
        await fetchMessages(conversationId);
    }, [fetchMessages]);

    // Start new conversation
    const startNewConversation = useCallback(() => {
        setActiveConversationId(null);
        setMessages([]);
        setError(null);
    }, []);

    // Send a message
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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('No hay sesión activa');

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hydric-chat`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                    },
                    body: JSON.stringify({
                        message: content,
                        conversation_id: activeConversationId,
                        contexto: contexto || 'general',
                    }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Error de conexión' }));
                throw new Error(errData.error || `Error ${response.status}`);
            }

            const result: SendMessageResult = await response.json();

            // If new conversation was created, update state
            if (!activeConversationId) {
                setActiveConversationId(result.conversation_id);
                // Refresh conversations list
                fetchConversations();
            }

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
    }, [activeConversationId, isSending, fetchConversations]);

    // Delete conversation
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

    // Load conversations on mount
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
