import { useState, useRef, useEffect } from 'react';
import {
    Brain, Send, Plus, MessageSquare, Trash2,
    Droplets, BarChart3, TrendingUp, Shield,
    AlertTriangle, ShieldOff, Sparkles, Waves,
    Library, Upload, FileText, Loader2, Database, Clock,
    CheckCircle2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHydricChat, type ChatMessage } from '../hooks/useHydricChat';
import { useHydricKnowledge } from '../hooks/useHydricKnowledge';
import { useHydricEvents, type HydraulicEvent } from '../hooks/useHydricEvents';
import LlenadoTracker from '../components/LlenadoTracker';
import EstabilizacionTracker from '../components/EstabilizacionTracker';
import ProtocolGuide from '../components/ProtocolGuide';
import { toast } from 'sonner';
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

    const {
        documents,
        isUploading: isUploadingKnowledge,
        uploadDocument,
        deleteDocument,
        error: knowledgeError
    } = useHydricKnowledge();

    const {
        activeEvent,
        isLoading: isLoadingEvents,
        activateEvent,
        updateEvent,
        error: eventError
    } = useHydricEvents();

    const [activeTab, setActiveTab] = useState<'chat' | 'knowledge' | 'control'>('chat');
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // --- Modal de Activación de Protocolo ---
    const [showActivationModal, setShowActivationModal] = useState(false);
    const [pendingEventId, setPendingEventId] = useState<string>('');
    const [pendingEventLabel, setPendingEventLabel] = useState('');
    const [formGasto, setFormGasto] = useState('60');
    const [formApertura, setFormApertura] = useState('100');
    const [formValvulas, setFormValvulas] = useState('V1, V2');
    const [formNotas, setFormNotas] = useState('');
    const [horaAperturaConfirmada, setHoraAperturaConfirmada] = useState<string | null>(null);
    const [showAperturaModal, setShowAperturaModal] = useState(false);
    const [tempAperturaDatetime, setTempAperturaDatetime] = useState('');
    const [isEditingGasto, setIsEditingGasto] = useState(false);
    const [editGastoValue, setEditGastoValue] = useState('');

    // Cargar hora_apertura_real del evento activo si ya existe
    useEffect(() => {
        if (activeEvent?.hora_apertura_real) {
            setHoraAperturaConfirmada(activeEvent.hora_apertura_real);
        } else {
            setHoraAperturaConfirmada(null);
        }
    }, [activeEvent]);

    const openConfirmarApertura = () => {
        // Inicializar con la fecha/hora actual en formato para input datetime-local
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - offset)).toISOString().slice(0, 16);
        setTempAperturaDatetime(localISOTime);
        setShowAperturaModal(true);
    };

    const handleConfirmarApertura = async () => {
        if (!tempAperturaDatetime) return;
        
        const selectedDate = new Date(tempAperturaDatetime);
        const horaFinal = selectedDate.toISOString();
        
        // Guardar en DB
        if (activeEvent) {
            await updateEvent(activeEvent.id, { hora_apertura_real: horaFinal });
            setHoraAperturaConfirmada(horaFinal);
            setShowAperturaModal(false);
        }
    };

    const handleUpdateGasto = async (newValue?: number) => {
        if (!activeEvent) return;
        const newGasto = newValue ?? parseFloat(editGastoValue);
        if (isNaN(newGasto)) return;

        await updateEvent(activeEvent.id, { gasto_solicitado_m3s: newGasto });
        setIsEditingGasto(false);
    };

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

                <div className="ih-view-tools">
                    <button
                        className={`ih-tool-btn ${activeTab === 'chat' ? 'active' : ''}`}
                        onClick={() => setActiveTab('chat')}
                    >
                        <MessageSquare size={14} />
                        Consultoría Chat
                    </button>
                    <button
                        className={`ih-tool-btn ${activeTab === 'knowledge' ? 'active' : ''}`}
                        onClick={() => setActiveTab('knowledge')}
                    >
                        <Library size={14} />
                        Base de Conocimiento
                    </button>
                    <button
                        className={`ih-tool-btn ${activeTab === 'control' ? 'active' : ''}`}
                        onClick={() => setActiveTab('control')}
                    >
                        <Shield size={14} />
                        Control de Mando
                    </button>
                </div>

                <div className="header-badge">
                    <Sparkles size={12} />
                    SICA AI Engine
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
                    {activeTab === 'chat' && (
                        <>
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
                            {(error || knowledgeError) && (
                                <div className="ih-error">
                                    <AlertTriangle size={14} />
                                    <span>{error || knowledgeError}</span>
                                    <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', flexShrink: 0 }}>
                                        <button onClick={clearError}>Cerrar</button>
                                    </div>
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
                        </>
                    )}

                    {activeTab === 'knowledge' && (
                        <div className="ih-knowledge-panel">
                            {/* Knowledge Header */}
                            <div className="ih-chat-header" style={{ margin: '-24px -24px 0 -24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <div className="header-avatar" style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--color-primary)', boxShadow: 'none' }}>
                                    <Database size={20} />
                                </div>
                                <div className="header-info">
                                    <h2>Biblioteca de Referencia Hidráulica</h2>
                                    <p>Sube documentos para ampliar el conocimiento de la IA</p>
                                </div>
                            </div>

                            {/* Dropzone */}
                            <label className={`ih-dropzone ${isUploadingKnowledge ? 'active' : ''}`}>
                                <input
                                    type="file"
                                    hidden
                                    accept=".pdf,.xlsx,.csv,.txt,.docx"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) uploadDocument(file);
                                    }}
                                    disabled={isUploadingKnowledge}
                                />
                                <div className="ih-dropzone-icon">
                                    {isUploadingKnowledge ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                                </div>
                                <h4>{isUploadingKnowledge ? 'Procesando Documento...' : 'Sube archivos técnicos (.pdf, .xlsx)'}</h4>
                                <p>Arrastra un archivo o haz clic para seleccionar</p>
                            </label>

                            {/* Stats */}
                            <div style={{ display: 'flex', gap: '20px', padding: '0 4px' }}>
                                <div className="ih-doc-meta" style={{ fontSize: '0.75rem' }}>
                                    <Shield size={12} className="text-primary" />
                                    <span>Seguridad: Almacenamiento Cifrado</span>
                                </div>
                                <div className="ih-doc-meta" style={{ fontSize: '0.75rem' }}>
                                    <Sparkles size={12} className="text-accent" />
                                    <span>Auto-Indexación: pgvector habilitado</span>
                                </div>
                            </div>

                            {/* Document List */}
                            <div className="ih-docs-grid">
                                {documents.length === 0 ? (
                                    <div className="ih-empty-state" style={{ gridColumn: '1/-1', padding: '40px' }}>
                                        <FileText size={48} />
                                        <h3>Sin documentos</h3>
                                        <p>Agrega manuales, normas técnicas o series estadísticas para mejorar las respuestas de la IA.</p>
                                    </div>
                                ) : (
                                    documents.map(doc => (
                                        <div key={doc.id} className="ih-doc-card">
                                            <div className="ih-doc-icon">
                                                <FileText size={20} />
                                            </div>
                                            <div className="ih-doc-info">
                                                <div className="ih-doc-title" title={doc.titulo}>{doc.titulo}</div>
                                                <div className="ih-doc-meta">
                                                    <span className="ih-doc-status" />
                                                    Ready for RAG
                                                    <span style={{ opacity: 0.3 }}>|</span>
                                                    {(doc.metadata?.size / 1024).toFixed(0)} KB
                                                </div>
                                            </div>
                                            <button
                                                className="ih-doc-delete"
                                                onClick={() => deleteDocument(doc.id, doc.url_storage)}
                                                title="Eliminar documento"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'control' && (
                        <div className="ih-control-panel">
                            <div className="ih-control-header">
                                <h2>Control de Mando Hidráulico (SRL)</h2>
                                <p>Selecciona el evento operativo oficial para sincronizar la IA y las reglas de seguridad.</p>
                            </div>

                            <div className="ih-active-event-card">
                                <div className="event-label">Protocolo Oficial Vigente</div>
                                {activeEvent ? (
                                    <>
                                        <div className="flex items-center justify-center gap-6 mb-4">
                                            {(() => {
                                                const icons: Record<string, any> = {
                                                    LLENADO: Waves,
                                                    ESTABILIZACION: Droplets,
                                                    CONTINGENCIA_LLUVIA: AlertTriangle,
                                                    VACIADO: Shield,
                                                    ANOMALIA_BAJA: AlertTriangle
                                                };
                                                const Icon = icons[activeEvent.evento_tipo] || Waves;
                                                return (
                                                    <div className="p-4 bg-white/5 rounded-full border border-white/10 shadow-2xl">
                                                        <Icon size={40} className={`event-status ${activeEvent.evento_tipo}`} style={{ filter: 'none' }} />
                                                    </div>
                                                );
                                            })()}
                                            <div className={`event-status ${activeEvent.evento_tipo}`}>
                                                {activeEvent.evento_tipo}
                                            </div>
                                        </div>
                                        <div className="event-meta">
                                            Dictado el {formatDate(activeEvent.fecha_inicio)}
                                        </div>
                                        {activeEvent.notas && (
                                            <div className="event-notes">{activeEvent.notas}</div>
                                        )}
                                        {activeEvent.evento_tipo === 'LLENADO' && activeEvent.gasto_solicitado_m3s && (
                                            <div className="event-tech-data mt-4 flex flex-wrap gap-3 justify-center">
                                                <div className="tech-item bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex flex-col items-center group relative">
                                                    <span className="text-[9px] uppercase font-black text-slate-500 opacity-70">Gasto Solicitado</span>
                                                    {isEditingGasto ? (
                                                        <div className="flex items-center gap-1 mt-1">
                                                            <input 
                                                                type="number" 
                                                                value={editGastoValue} 
                                                                onChange={e => setEditGastoValue(e.target.value)}
                                                                className="w-16 bg-slate-800 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white"
                                                                autoFocus
                                                            />
                                                            <button onClick={() => handleUpdateGasto()} className="p-1 bg-emerald-500 rounded hover:bg-emerald-400">
                                                                <CheckCircle2 size={10} className="text-white" />
                                                            </button>
                                                            <button onClick={() => setIsEditingGasto(false)} className="p-1 bg-rose-500 rounded hover:bg-rose-400">
                                                                <Trash2 size={10} className="text-white" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-black text-blue-400">{activeEvent.gasto_solicitado_m3s} m³/s</span>
                                                            {!activeEvent.hora_apertura_real && (
                                                                <button 
                                                                    onClick={() => {
                                                                        setEditGastoValue(activeEvent.gasto_solicitado_m3s?.toString() || '');
                                                                        setIsEditingGasto(true);
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white/10 rounded hover:bg-white/20"
                                                                    title="Editar gasto"
                                                                >
                                                                    <Plus size={10} className="text-blue-400" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="tech-item bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex flex-col items-center">
                                                    <span className="text-[9px] uppercase font-black text-slate-500 opacity-70">Apertura</span>
                                                    <span className="text-sm font-black text-blue-400">{activeEvent.porcentaje_apertura_presa}%</span>
                                                </div>
                                                <div className="tech-item bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 flex flex-col items-center">
                                                    <span className="text-[9px] uppercase font-black text-slate-500 opacity-70">Válvulas</span>
                                                    <span className="text-sm font-black text-blue-400">{activeEvent.valvulas_activas?.join(', ')}</span>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : isLoadingEvents ? (
                                    <div className="flex flex-col items-center gap-4 animate-pulse py-10">
                                        <Loader2 className="animate-spin text-primary" size={40} />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sincronizando estado oficial...</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="event-status ESTABILIZACION">ESTABILIZACION</div>
                                        <div className="event-meta">Sin evento oficial registrado</div>
                                    </>
                                )}
                            </div>

                            {activeEvent && (
                                <div style={{ marginBottom: '32px' }}>
                                    <ProtocolGuide type={activeEvent.evento_tipo} eventData={activeEvent} />
                                </div>
                            )}

                            {activeEvent?.evento_tipo === 'LLENADO' && (
                                <div style={{ marginBottom: '32px' }}>
                                    <LlenadoTracker
                                        eventoId={activeEvent.id}
                                        qSolicitado={activeEvent.gasto_solicitado_m3s || 60}
                                        horaApertura={horaAperturaConfirmada}
                                        onConfirmarApertura={openConfirmarApertura}
                                        onUpdateGasto={(newGasto) => handleUpdateGasto(newGasto)}
                                    />
                                </div>
                            )}

                            {activeEvent?.evento_tipo === 'ESTABILIZACION' && (
                                <div style={{ marginBottom: '32px' }}>
                                    <EstabilizacionTracker />
                                </div>
                            )}

                            <div className="ih-control-grid">
                                {[
                                    { id: 'LLENADO', icon: Waves, label: 'Evento 1: Llenado', color: '#3b82f6', desc: 'Apertura de obra de toma. Seguimiento de onda positiva.' },
                                    { id: 'ESTABILIZACION', icon: Droplets, label: 'Evento 2: Estabilización', color: '#10b981', desc: 'Flujo permanente. Distribución a tomas y laterales.' },
                                    { id: 'CONTINGENCIA_LLUVIA', icon: AlertTriangle, label: 'Evento 3: Contingencia', color: '#f59e0b', desc: 'Maniobras de desfogue y control de excedentes.' },
                                    { id: 'VACIADO', icon: Shield, label: 'Evento 4: Vaciado', color: '#ef4444', desc: 'Cierre de ciclo. Control de subpresiones (máx 30cm/día).' },
                                    { id: 'ANOMALIA_BAJA', icon: AlertTriangle, label: 'Anomalía: Baja súbita', color: '#7c3aed', desc: 'Caída de nivel no programada. Posible robo o falla estructural (CONAGUA).' },
                                ].map((evt) => (
                                    <button
                                        key={evt.id}
                                        className={`protocol-btn group border-2 ${activeEvent?.evento_tipo === evt.id ? 'active scale-[1.02] bg-white/[0.05]' : ''}`}
                                        onClick={() => {
                                            console.log('🖱️ Click en protocolo:', evt.id);
                                            setPendingEventId(evt.id);
                                            setPendingEventLabel(evt.label);
                                            setFormNotas('');
                                            setShowActivationModal(true);
                                        }}
                                        disabled={isLoadingEvents}
                                        style={{
                                            borderColor: activeEvent?.evento_tipo === evt.id ? evt.color : 'transparent',
                                            boxShadow: activeEvent?.evento_tipo === evt.id ? `0 0 30px ${evt.color}22` : 'none'
                                        }}
                                    >
                                        <div className="relative">
                                            <div
                                                className="absolute inset-0 blur-xl opacity-20 group-hover:opacity-40 transition-opacity rounded-full"
                                                style={{ backgroundColor: evt.color }}
                                            />
                                            <div className="p-btn-icon relative z-10 w-14 h-14 rounded-2xl shadow-2xl transition-transform group-hover:scale-110" style={{ backgroundColor: evt.color }}>
                                                <evt.icon size={28} />
                                            </div>
                                        </div>
                                        <div className="p-btn-info">
                                            <div className="p-btn-label text-base font-black tracking-tight">{evt.label}</div>
                                            <div className="p-btn-desc text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1.5 opacity-80">{evt.desc}</div>
                                        </div>
                                        {activeEvent?.evento_tipo === evt.id && (
                                            <div className="absolute top-4 right-4 animate-bounce">
                                                <Sparkles size={14} className="text-white/40" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                            {/* === MODAL DE ACTIVACIÓN DE PROTOCOLO === */}
                            {showActivationModal && (
                                <div style={{
                                    position: 'fixed', inset: 0, zIndex: 9999,
                                    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }} onClick={() => setShowActivationModal(false)}>
                                    <div onClick={e => e.stopPropagation()} style={{
                                        background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '16px', padding: '32px', width: '480px', maxWidth: '95vw',
                                        boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
                                    }}>
                                        <h3 style={{ color: '#22d3ee', fontSize: '1.25rem', fontWeight: 900, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            Activar: {pendingEventLabel}
                                        </h3>
                                        <div style={{ display: 'flex', gap: '8px', padding: '12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', marginBottom: '24px' }}>
                                            <Shield size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                                            <div>
                                                <p style={{ color: '#fca5a5', fontSize: '0.75rem', fontWeight: 800, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    Acción Gerencial (SRL)
                                                </p>
                                                <p style={{ color: '#94a3b8', fontSize: '0.7rem', margin: 0, lineHeight: 1.4 }}>
                                                    Esta maniobra desactivará el protocolo actual y alterará la métrica de toda la cuenca. Operación auditada bajo su firma digital.
                                                </p>
                                            </div>
                                        </div>

                                        {pendingEventId === 'LLENADO' && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                                                <label style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Gasto solicitado (m³/s)
                                                    <input type="number" value={formGasto} onChange={e => setFormGasto(e.target.value)}
                                                        style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '1rem' }} />
                                                </label>
                                                <label style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Apertura de presa (%)
                                                    <input type="number" value={formApertura} onChange={e => setFormApertura(e.target.value)}
                                                        style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '1rem' }} />
                                                </label>
                                                <label style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Válvulas activas
                                                    <input type="text" value={formValvulas} onChange={e => setFormValvulas(e.target.value)}
                                                        style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '1rem' }} />
                                                </label>
                                            </div>
                                        )}

                                        <label style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: '16px' }}>
                                            Notas operativas
                                            <textarea value={formNotas} onChange={e => setFormNotas(e.target.value)}
                                                rows={2} placeholder="Notas adicionales..."
                                                style={{ display: 'block', width: '100%', marginTop: '4px', padding: '10px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem', resize: 'none' }} />
                                        </label>

                                        {eventError && (
                                            <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '10px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.8rem', fontWeight: 600 }}>
                                                ❌ Error: {eventError}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <button
                                                onClick={() => setShowActivationModal(false)}
                                                style={{ flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                disabled={isLoadingEvents}
                                                onClick={async () => {
                                                    console.log('🔥 [Modal] Ejecutando activación...');
                                                    if (pendingEventId === 'LLENADO') {
                                                        await activateEvent('LLENADO', {
                                                            gasto_solicitado_m3s: parseFloat(formGasto) || 60,
                                                            porcentaje_apertura_presa: parseFloat(formApertura) || 100,
                                                            valvulas_activas: formValvulas.split(',').map(s => s.trim()),
                                                            notas: formNotas,
                                                            // hora_apertura_real se confirma DESPUÉS en el LlenadoTracker
                                                            // No cronometrar sin saber si la presa abrió realmente
                                                        });
                                                    } else {
                                                        await activateEvent(pendingEventId as HydraulicEvent, { notas: formNotas });
                                                    }
                                                    setShowActivationModal(false);
                                                }}
                                                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 900, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                                            >
                                                {isLoadingEvents ? '⏳ Procesando...' : '⚡ Activar Protocolo'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* === MODAL DE CONFIRMACIÓN DE APERTURA (DÍA Y HORA) === */}
                            {showAperturaModal && (
                                <div style={{
                                    position: 'fixed', inset: 0, zIndex: 9999,
                                    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }} onClick={() => setShowAperturaModal(false)}>
                                    <div onClick={e => e.stopPropagation()} style={{
                                        background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '20px', padding: '32px', width: '400px', maxWidth: '95vw',
                                        boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
                                        textAlign: 'center'
                                    }}>
                                        <div style={{
                                            width: '64px', height: '64px', background: 'rgba(245,158,11,0.1)',
                                            borderRadius: '50%', display: 'flex', alignItems: 'center',
                                            justifyContent: 'center', margin: '0 auto 20px',
                                            border: '1px solid rgba(245,158,11,0.2)'
                                        }}>
                                            <Clock size={32} style={{ color: '#f59e0b' }} />
                                        </div>
                                        
                                        <h3 style={{ color: '#f1f5f9', fontSize: '1.25rem', fontWeight: 900, marginBottom: '8px' }}>
                                            Confirmar Apertura
                                        </h3>
                                        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '16px' }}>
                                            Establezca el <b>Día y Hora</b> exactos en que se realizó la maniobra en la Obra de Toma.
                                        </p>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', marginBottom: '24px', textAlign: 'left' }}>
                                            <Shield size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                                            <span style={{ color: '#10b981', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                Autorizado por Gerencia SRL
                                            </span>
                                        </div>

                                        <div style={{ marginBottom: '24px', textAlign: 'left' }}>
                                            <label style={{ color: '#e2e8f0', fontSize: '0.75rem', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                                                Fecha y Hora de Apertura
                                            </label>
                                            <input 
                                                type="datetime-local" 
                                                value={tempAperturaDatetime} 
                                                onChange={e => setTempAperturaDatetime(e.target.value)}
                                                style={{ 
                                                    display: 'block', width: '100%', padding: '12px', 
                                                    background: '#1e293b', border: '1px solid #334155', 
                                                    borderRadius: '10px', color: '#f1f5f9', fontSize: '1rem',
                                                    outline: 'none'
                                                }} 
                                            />
                                        </div>

                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <button
                                                onClick={() => setShowAperturaModal(false)}
                                                style={{ flex: 1, padding: '12px', background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleConfirmarApertura}
                                                style={{ 
                                                    flex: 1, padding: '12px', 
                                                    background: 'linear-gradient(135deg, #f59e0b, #d97706)', 
                                                    color: '#0f172a', border: 'none', borderRadius: '12px', 
                                                    cursor: 'pointer', fontWeight: 900, fontSize: '0.9rem', 
                                                    textTransform: 'uppercase', letterSpacing: '0.05em' 
                                                }}
                                            >
                                                Confirmar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InteligenciaHidrica;
