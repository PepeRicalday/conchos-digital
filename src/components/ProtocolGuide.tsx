import React from 'react';
import { Waves, CheckCircle2, ShieldCheck, Activity, Search, Droplets, Zap } from 'lucide-react';
import { type SICAEventLog } from '../hooks/useHydricEvents';
import './ProtocolGuide.css';

interface ProtocolStep {
    id: number;
    title: string;
    desc: string;
    icon: any;
    badge?: string;
}

const LLENADO_PROTOCOL: ProtocolStep[] = [
    {
        id: 1,
        title: "Apertura de Presa (Obra de Toma)",
        desc: "Apertura inicial programada. Registro de válvulas, gasto Q solicitado y hora exacta de maniobra.",
        icon: Waves,
        badge: "Válvulas"
    },
    {
        id: 2,
        title: "Tránsito en Río (36 KM)",
        desc: "Seguimiento de la onda en el cauce natural previo a KM 0. Tiempo estimado: ~7-10 horas según Q.",
        icon: Droplets,
        badge: "Río Conchos"
    },
    {
        id: 3,
        title: "Arribo a Boca-Toma (KM 0)",
        desc: "Confirmación visual y registro manual de llegada al canal principal para ajuste de estadística SICA.",
        icon: CheckCircle2,
        badge: "Sincronía"
    },
    {
        id: 4,
        title: "Seguimiento de Predictor",
        desc: "Monitoreo del arribo en escalas de control. Validar tiempos reales vs modelo hidráulico.",
        icon: Activity,
        badge: "Predictor"
    },
    {
        id: 5,
        title: "Balance Hídrico Inicial",
        desc: "Verificación de gasto estabilizado en Hydra Engine vs dotación autorizada a módulos.",
        icon: ShieldCheck,
        badge: "Auditoría"
    }
];

const ESTABILIZACION_PROTOCOL: ProtocolStep[] = [
    {
        id: 1,
        title: "Control de Derivaciones",
        desc: "Ajuste de tomas directas y laterales según programaciones autorizadas.",
        icon: Zap,
        badge: "Operación"
    },
    {
        id: 2,
        title: "Monitoreo de Pérdidas",
        desc: "Vigilancia continua en Monitor de Vulnerabilidad para detección de filtraciones.",
        icon: Droplets,
        badge: "Hydra Engine"
    }
];

const CONTINGENCIA_LLUVIA_PROTOCOL: ProtocolStep[] = [
    {
        id: 1,
        title: "Evaluación de Excedentes",
        desc: "Cálculo de aportaciones pluviales en cuenca propia. Determinar volumen de maniobra.",
        icon: Activity,
        badge: "Hidrometría"
    },
    {
        id: 2,
        title: "Apertura de Desfogue",
        desc: "Maniobras controladas en vertedores y obras de excedencia para mantener bordo libre.",
        icon: Zap,
        badge: "Seguridad"
    }
];

const VACIADO_PROTOCOL: ProtocolStep[] = [
    {
        id: 1,
        title: "Cierre Programado de Toma",
        desc: "Reducción de Q según curva de abatimiento. No exceder 30 cm/día de caída de nivel.",
        icon: Waves,
        badge: "Geotecnia"
    },
    {
        id: 2,
        title: "Inspección de Taludes",
        desc: "Vigilancia de subpresiones y estabilidad de secciones durante el vaciado del canal.",
        icon: Search,
        badge: "Estructural"
    }
];

const ANOMALIA_BAJA_PROTOCOL: ProtocolStep[] = [
    {
        id: 1,
        title: "Identificación de Causa",
        desc: "Verificación de tomas clandestinas, fallas en radiales o colapsos estructurales.",
        icon: Search,
        badge: "Urgente"
    },
    {
        id: 2,
        title: "Notificación CONAGUA",
        desc: "Generación de reporte automático de incidencia para validación de títulos de concesión.",
        icon: ShieldCheck,
        badge: "Legal"
    }
];

const ProtocolGuide: React.FC<{ type: string; eventData?: SICAEventLog }> = ({ type, eventData }) => {
    const getProtocol = () => {
        switch (type) {
            case 'LLENADO': return LLENADO_PROTOCOL;
            case 'ESTABILIZACION': return ESTABILIZACION_PROTOCOL;
            case 'CONTINGENCIA_LLUVIA': return CONTINGENCIA_LLUVIA_PROTOCOL;
            case 'VACIADO': return VACIADO_PROTOCOL;
            case 'ANOMALIA_BAJA': return ANOMALIA_BAJA_PROTOCOL;
            default: return [];
        }
    };

    const protocol = getProtocol();
    if (protocol.length === 0) return null;

    return (
        <div className="protocol-guide">
            <header className="pg-header">
                <div className="pg-icon-ring">
                    {type === 'LLENADO' ? <Waves size={24} /> :
                        type === 'ESTABILIZACION' ? <Droplets size={24} /> :
                            <Activity size={24} />}
                </div>
                <div className="pg-title-group">
                    <h2>Protocolo de {type}</h2>
                    <p>Guía de Operación Estándar (SRL Conchos Digital)</p>
                </div>
                {eventData?.gasto_solicitado_m3s && (
                    <div style={{ marginLeft: 'auto' }}>
                        <div className="pg-step-badge" style={{ 
                            background: eventData.hora_apertura_real ? 'var(--color-primary)' : 'rgba(245,158,11,0.15)', 
                            color: eventData.hora_apertura_real ? 'white' : '#f59e0b',
                            border: eventData.hora_apertura_real ? 'none' : '1px solid rgba(245,158,11,0.3)'
                        }}>
                            {eventData.gasto_solicitado_m3s} m³/s {eventData.hora_apertura_real ? 'Activo' : 'Programado'}
                        </div>
                    </div>
                )}
            </header>

            <div className="pg-steps">
                {protocol.map((step) => (
                    <div key={step.id} className="pg-step-item">
                        <div className="pg-step-number">{step.id}</div>
                        <div className="pg-step-icon-box">
                            <step.icon size={20} />
                        </div>
                        <div className="pg-step-content">
                            <div className="pg-step-title">
                                {step.title}
                                {step.badge && <span className="pg-step-badge">{step.badge}</span>}
                            </div>
                            <p className="pg-step-desc">
                                {step.id === 1 && eventData?.valvulas_activas ? 
                                    `Apertura con válvulas ${eventData.valvulas_activas.join(', ')}.` : 
                                    step.desc}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ProtocolGuide;
