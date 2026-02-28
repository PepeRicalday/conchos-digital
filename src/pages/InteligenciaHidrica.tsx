import { useState, useRef, useEffect } from 'react';
import {
    Brain, Send, Plus, MessageSquare, Trash2,
    Droplets, BarChart3, TrendingUp, Shield,
    AlertTriangle, ShieldOff, Sparkles, Waves
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHydricChat, type ChatMessage } from '../hooks/useHydricChat';
import './HydricChat.css';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const QUICK_SUGGESTIONS = [
    {
        icon: Waves,
        text: '¿Cuál es el estado actual de almacenamiento de las presas?',
        contexto: 'presas',
    },
    {
        icon: BarChart3,
        text: 'Analiza la eficiencia de distribución por módulo',
        contexto: 'eficiencia',
    },
    {
        icon: TrendingUp,
        text: 'Genera una proyección del volumen disponible para este ciclo',
        contexto: 'escenario',
    },
    {
        icon: Shield,
        text: '¿Se cumplen los indicadores para el reporte CONAGUA?',
        contexto: 'general',
    },
];

const InteligenciaHidrica = () => {
    const { profile } = useAuth();
    const {
        conversations,
        activeConversationId,
        messages,
        isSending,
        error,
        sendMessage,
        selectConversation,
        startNewConversation,
        deleteConversation,
        clearError,
    } = useHydricChat();

    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isSending]);

    // Access guard: only SRL
    if (profile?.rol !== 'SRL') {
        return (
            <div className="ih-access-denied">
                <div className="ih-access-denied-icon">
                    <ShieldOff size={36} />
                </div>
                <h2>Acceso Restringido</h2>
                <p>
                    El módulo de Inteligencia Hídrica está disponible exclusivamente para
                    usuarios con rol de Gerente (SRL).
                </p>
            </div>
        );
    }

    // Auto-resize textarea
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        const ta = e.target;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    };

    const handleSend = async () => {
        if (!inputValue.trim() || isSending) return;
        const msg = inputValue;
        setInputValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        await sendMessage(msg);
    };

    const handleSuggestion = async (text: string, contexto: string) => {
        setInputValue('');
        await sendMessage(text, contexto);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const renderMessage = (msg: ChatMessage) => (
        <div key={msg.id} className={`ih-msg ${msg.role}`}>
            <div className="msg-avatar">
                {msg.role === 'user' ? (
                    <Droplets size={14} />
                ) : (
                    <Brain size={14} />
                )}
            </div>
            <div>
                <div className="msg-bubble">
                    {msg.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                        </ReactMarkdown>
                    ) : (
                        msg.content
                    )}
                </div>
                <div className="msg-time">{formatTime(msg.created_at)}</div>
            </div>
        </div>
    );

    return (
        <div className="page-transition">
            {/* Page Header */}
            <div className="ih-page-header">
                <div className="header-left">
                    <div className="header-icon">
                        <Brain size={22} />
                    </div>
                    <div>
                        <h1 className="text-gradient">Inteligencia Hídrica</h1>
                        <p className="header-subtitle">
                            Asistente IA especialista en hidrometría y modelado — DR-005 Delicias
                        </p>
                    </div>
                </div>
                <div className="header-badge">
                    <Sparkles size={12} />
                    Gemini AI
                </div>
            </div>

            {/* Main Layout */}
            <div className="ih-container">
                {/* Sidebar — Conversation History */}
                <div className="ih-sidebar">
                    <div className="ih-sidebar-header">
                        <h3>Historial</h3>
                        <button
                            className="ih-new-chat-btn"
                            onClick={startNewConversation}
                            title="Nueva conversación"
                        >
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="ih-conversations">
                        {conversations.length === 0 ? (
                            <div className="ih-empty-state">
                                <MessageSquare size={28} />
                                <p>Tus consultas aparecerán aquí</p>
                            </div>
                        ) : (
                            conversations.map(conv => (
                                <div
                                    key={conv.id}
                                    className={`ih-conv-item ${activeConversationId === conv.id ? 'active' : ''}`}
                                    onClick={() => selectConversation(conv.id)}
                                >
                                    <div className="conv-icon">
                                        <MessageSquare size={13} />
                                    </div>
                                    <div className="conv-text">
                                        <div className="conv-title">{conv.titulo}</div>
                                        <div className="conv-date">{formatDate(conv.created_at)}</div>
                                    </div>
                                    <button
                                        className="conv-delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteConversation(conv.id);
                                        }}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Main Chat Area */}
                <div className="ih-main">
                    {/* Chat Header */}
                    <div className="ih-chat-header">
                        <div className="header-avatar">
                            <Brain size={20} />
                        </div>
                        <div className="header-info">
                            <h2>Asistente Hídrico</h2>
                            <p>
                                <span className="status-dot-live" />
                                Conectado — Datos en tiempo real
                            </p>
                        </div>
                    </div>

                    {/* Messages or Welcome */}
                    {messages.length === 0 ? (
                        <div className="ih-welcome">
                            <div className="ih-welcome-icon">
                                <Brain size={32} />
                            </div>
                            <h2>Asistente de Inteligencia Hídrica</h2>
                            <p>
                                Especialista en hidrometría, análisis de datos y modelado de escenarios
                                para el Distrito de Riego 005 Delicias.
                                Consulta el estado real del sistema, genera tendencias y proyecciones.
                            </p>

                            <div className="ih-suggestions">
                                {QUICK_SUGGESTIONS.map((s, i) => (
                                    <button
                                        key={i}
                                        className="ih-suggestion-btn"
                                        onClick={() => handleSuggestion(s.text, s.contexto)}
                                        disabled={isSending}
                                    >
                                        <s.icon size={16} />
                                        <span>{s.text}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="ih-messages">
                            {messages.map(renderMessage)}

                            {isSending && (
                                <div className="ih-typing">
                                    <div className="typing-dots">
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                    </div>
                                    <span className="ih-typing-text">Analizando datos del sistema...</span>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="ih-error">
                            <AlertTriangle size={14} />
                            <span>{error}</span>
                            <button onClick={clearError}>Cerrar</button>
                        </div>
                    )}

                    {/* Input */}
                    <div className="ih-input-area">
                        <div className="ih-input-wrapper">
                            <textarea
                                ref={textareaRef}
                                value={inputValue}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder="Consulta sobre hidrometría, eficiencias, proyecciones..."
                                rows={1}
                                disabled={isSending}
                            />
                            <button
                                className={`ih-send-btn ${isSending ? 'sending' : ''}`}
                                onClick={handleSend}
                                disabled={!inputValue.trim() || isSending}
                                title="Enviar consulta"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InteligenciaHidrica;
