import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, X, Sparkles, ChevronRight } from 'lucide-react';
import './HydraAI.css';

interface Message {
  id: string;
  type: 'bot' | 'user';
  text: string;
  timestamp: Date;
  action?: {
    type: 'SET_FLOW' | 'TOGGLE_RIVER';
    value: any;
    label: string;
  };
}

interface HydraAIProps {
  onUpdateParams: (params: { q?: number; river?: boolean }) => void;
  simData: any[];
}

const HydraAI: React.FC<HydraAIProps> = ({ onUpdateParams, simData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      text: '¡Hola! Soy Hydra AI. Puedo ayudarte a manejar las variables del canal. ¿Qué deseas simular?',
      timestamp: new Date()
    }
  ]);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      type: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    processCommand(input.toLowerCase());
    setInput('');
  };

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-MX';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const processCommand = (cmd: string) => {
    setTimeout(() => {
      let botResponse = "No entiendo ese comando, pero puedo ajustar el gasto o analizar el sistema. Prueba con: 'Escanea el canal' o 'Sube el gasto'.";
      let action: any = undefined;

      // Current State reference for relative math and information retrieval
      const lastRes = simData[simData.length - 1];
      const currentFlow = lastRes ? lastRes.q : 15;

      // 1. INFORMATION QUERIES (Handling natural questions: "Dame", "Dime", "Cual es", etc.)
      const isQuestion = cmd.includes('cuanto') || cmd.includes('dame') || cmd.includes('dime') || 
                        cmd.includes('ver') || cmd.includes('que') || cmd.includes('cual') || 
                        cmd.includes('cuál') || cmd.includes('muestrame') || cmd.includes('muéstrame');

      if (isQuestion) {
        if (cmd.includes('gasto') || cmd.includes('caudal') || cmd.includes('flujo')) {
          botResponse = `El gasto actual configurado en el modelo de simulación es de ${currentFlow.toFixed(1)} m³/s.`;
          return finalizeResponse(botResponse);
        }
        if (cmd.includes('nivel') || cmd.includes('escala')) {
          const target = (cmd.includes('k0') || cmd.includes('k-0')) ? 'K0000' : 
                         (cmd.includes('k23') || cmd.includes('k-23')) ? 'K23' : 
                         (cmd.includes('k29') || cmd.includes('k-29')) ? 'K29' : 'K23';
          
          const point = simData.find(d => d.nombre.toUpperCase().replace(/[^A-Z0-9]/g, '') === target.replace(/[^A-Z0-9]/g, ''));
          
          if (!point) {
            botResponse = `No encuentro datos para la ubicación especificada. ¿Te refieres a KM 0 o KM 23?`;
          } else {
            const hasBase = point.y_base !== undefined;
            botResponse = `[ESTADO ACTUAL - ${point.nombre}]: Telemetría real indica ${hasBase ? point.y_base.toFixed(2) : '—'} metros. \n\n[PROYECCIÓN HYDRA]: El nivel simulado para este escenario es de ${point.y_up.toFixed(2)} metros (escala).`;
          }
          return finalizeResponse(botResponse);
        }
      }

      // 2. SCAN Power (Smart Diagnostics)
      if (cmd.includes('escanea') || cmd.includes('analiza') || cmd.includes('diagnostico')) {
        const anomalies = simData.filter(d => d.status === 'REMANSO');
        if (anomalies.length > 0) {
          const suggestedQ = currentFlow + 2; 
          botResponse = `He detectado ${anomalies.length} anomalías críticas por remanso. Recomiendo incrementar el gasto a ${suggestedQ} m³/s para estabilizar el tirante. ¿Deseas aplicar esta maniobra?`;
          action = { type: 'SET_FLOW', value: suggestedQ, label: `Optimizar a ${suggestedQ} m³/s` };
        } else {
          botResponse = "Sistema estable. El perfil hidráulico se encuentra en régimen normal con flujo subcrítico controlado.";
        }
      }

      // 3. Gasto Parsing (Explicit 'pon' or 'sube a')
      const explicitFlowMatch = cmd.match(/(?:pon|fija|ajusta|gasto a|sube a|baja a) (\d+(?:\.\d+)?)/i);
      if (explicitFlowMatch) {
        const val = parseFloat(explicitFlowMatch[1]);
        botResponse = `Procedo a ajustar el escenario de extracción a ${val} m³/s. El balance hídrico se actualizará automáticamente.`;
        action = { type: 'SET_FLOW', value: val, label: `Ejecutar Maniobra (${val} m³/s)` };
      }

      // 4. Relative Gasto Parsing (sube 5, baja 2)
      const relativeFlowMatch = cmd.match(/(?:sube|incrementa|aumenta|baja|disminuye|resta) (\d+(?:\.\d+)?)/i);
      if (relativeFlowMatch && !cmd.includes(' a ')) { 
        const delta = parseFloat(relativeFlowMatch[1]);
        const isIncrease = cmd.includes('sube') || cmd.includes('incrementa') || cmd.includes('aumenta');
        const newVal = isIncrease ? currentFlow + delta : Math.max(0, currentFlow - delta);
        
        botResponse = `Calculando maniobra de ${isIncrease ? '+' : '-'}${delta} m³/s. El nuevo gasto proyectado es ${newVal.toFixed(1)} m³/s.`;
        action = { type: 'SET_FLOW', value: newVal, label: `Confirmar ${newVal.toFixed(1)} m³/s` };
      }

      // 5. Río Parsing
      if (cmd.includes('río') || cmd.includes('rio') || cmd.includes('presa') || cmd.includes('transito')) {
        if (cmd.includes('activa') || cmd.includes('pon') || cmd.includes('si')) {
          botResponse = "Entendido. Activando lag de río (36km). La llegada a K-0 se retrasará ~283 minutos según el modelo hidráulico.";
          action = { type: 'TOGGLE_RIVER', value: true, label: 'Activar Tránsito Río' };
        } else if (cmd.includes('no') || cmd.includes('quita') || cmd.includes('desactiva')) {
          botResponse = "Desactivando tránsito de río para simulación directa desde KM 0.";
          action = { type: 'TOGGLE_RIVER', value: false, label: 'Desactivar Río' };
        }
      }

      finalizeResponse(botResponse, action);
    }, 600);
  };

  const finalizeResponse = (text: string, action?: any) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      type: 'bot',
      text,
      timestamp: new Date(),
      action
    }]);
    speak(text);
  };

  const executeAction = (action: any) => {
    if (action.type === 'SET_FLOW') onUpdateParams({ q: action.value });
    if (action.type === 'TOGGLE_RIVER') onUpdateParams({ river: action.value });
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      type: 'bot',
      text: `✅ Cambios aplicados con éxito.`,
      timestamp: new Date()
    }]);
  };

  return (
    <>
      <button 
        className={`hydra-ai-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Hydra AI Assistant"
      >
        {isOpen ? <X size={24} /> : <Bot size={24} className="animate-pulse" />}
        {!isOpen && <div className="trigger-badge">3</div>}
      </button>

      {isOpen && (
        <div className="hydra-ai-window ring-1 ring-cyan-500/30">
          <div className="hydra-ai-header">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-cyan-900/50 rounded-lg">
                <Sparkles size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-[0.7rem] font-black tracking-widest text-white uppercase">Hydra Assistant</div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                  <span className="text-[0.55rem] text-slate-400">Motor de Modelación Activo</span>
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} title="Cerrar Asistente"><X size={14} className="text-slate-500" /></button>
          </div>

          <div className="hydra-ai-chat" ref={scrollRef}>
            {messages.map(msg => (
              <div key={msg.id} className={`msg-container ${msg.type}`}>
                <div className="msg-bubble shadow-xl">
                  {msg.text}
                  {msg.action && (
                    <button 
                      onClick={() => executeAction(msg.action)}
                      className="mt-2 w-full p-2 bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-500/30 rounded flex items-center justify-between text-[0.6rem] font-bold text-cyan-300 transition-all uppercase"
                    >
                      <span>{msg.action.label}</span>
                      <ChevronRight size={12} />
                    </button>
                  )}
                </div>
                <div className="msg-time">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
          </div>

          <div className="hydra-ai-footer group focus-within:ring-1 focus-within:ring-cyan-500/50">
            <input 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Pregunta o ajusta variables..."
              className="chat-input"
            />
            <button onClick={handleSend} className="send-btn ring-offset-black transition-transform active:scale-95" title="Enviar Mensaje">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default HydraAI;
