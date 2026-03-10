import React from 'react';
import { Waves, Clock, ShieldCheck, Activity, Search, Droplets, Zap } from 'lucide-react';
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
        title: "Apertura de Obra de Toma",
        desc: "Incremeto progresivo del gasto Q en pasos de 5 m³/s cada 30 min. No exceder 60 m³/s de diseño.",
        icon: Waves,
        badge: "Gasto Q"
    },
    {
        id: 2,
        title: "Sincronización de Aforos",
        desc: "Sincronizar relojes con SICA Capture. Registro de carga estática inicial en escala principal.",
        icon: Clock,
        badge: "SICA Sync"
    },
    {
        id: 3,
        title: "Seguimiento de Onda Positiva",
        desc: "Monitoreo del arribo en puntos de control (KM 23, KM 29, KM 34, KM 44) según predictor.",
        icon: Activity,
        badge: "Predictor"
    },
    {
        id: 4,
        title: "Inspección de Bordo Libre",
        desc: "Verificación visual de filtraciones y niveles de revancha en taludes del tramo inicial.",
        icon: Search,
        badge: "Seguridad"
    },
    {
        id: 5,
        title: "Validación de Balance Hídrico",
        desc: "Cierre de bitácora en Hydra Engine con cálculo de flujo estabilizado vs solicitado.",
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

const ProtocolGuide: React.FC<{ type: string }> = ({ type }) => {
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
                <div style={{ marginLeft: 'auto' }}>
                    <div className="pg-step-badge" style={{ background: '#3b82f6', color: 'white' }}>Oficial</div>
                </div>
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
                            <p className="pg-step-desc">{step.desc}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ProtocolGuide;
