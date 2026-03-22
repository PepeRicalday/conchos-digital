import { ArrowRight, Droplet, Zap } from 'lucide-react';
import './CanalSchematic.css';

interface DeliveryPoint {
    id: string;
    name: string;
    km: number;
    type: 'toma' | 'lateral' | 'carcamo';
    flow: number;
    isOpen: boolean;
    wasActive?: boolean;
}

interface CanalSchematicProps {
    points: DeliveryPoint[];
    activePointId: string | null;
    onPointClick: (point: DeliveryPoint) => void;
    kmStart?: number;
    kmEnd?: number;
}

const CanalSchematic: React.FC<CanalSchematicProps> = ({ points, activePointId, onPointClick, kmStart = 0, kmEnd = 104 }) => {
    // Sort points by Kilometer
    const sortedPoints = [...points].sort((a, b) => a.km - b.km);
    const rangeLength = kmEnd - kmStart;

    const getPosition = (km: number) => {
        return ((km - kmStart) / rangeLength) * 100;
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'lateral': return <ArrowRight size={12} />;
            case 'carcamo': return <Zap size={12} />;
            default: return <Droplet size={12} />;
        }
    };

    const isFullView = kmStart === 0 && kmEnd === 104;
    const title = isFullView
        ? 'Mapa Lineal del Canal Principal (Km 0 - Km 104)'
        : `Tramo Activo: Km ${kmStart.toFixed(1)} — Km ${kmEnd.toFixed(1)}`;

    return (
        <div className="schematic-container">
            <h3 className="schematic-title">{title}</h3>

            <div className="canal-line-wrapper">
                <div className="canal-line-bg"></div>
                <div className="canal-water-flow"></div>

                {/* Km range markers */}
                <span className="schematic-km-label schematic-km-start">Km {kmStart.toFixed(0)}</span>
                <span className="schematic-km-label schematic-km-end">Km {kmEnd.toFixed(0)}</span>

                {sortedPoints.map((point) => {
                    const isActive = point.id === activePointId;
                    const stateClass = point.isOpen ? 'open' : point.wasActive ? 'was-active' : 'closed';
                    return (
                        <div
                            key={point.id}
                            className={`schematic-point ${point.type} ${stateClass} ${isActive ? 'active-pin' : ''}`}
                            style={{ left: `${getPosition(point.km)}%`, zIndex: isActive ? 10 : 1 } /* dynamic position — cannot be static CSS */}
                            onClick={(e) => {
                                e.stopPropagation();
                                onPointClick(point);
                            }}
                            title={`Km ${point.km}: ${point.name}`}
                        >
                            <div className="point-marker">
                                <div className="pin-head">
                                    {getIcon(point.type)}
                                </div>
                                <div className="pin-line"></div>
                            </div>

                            {isActive && (
                                <div className="point-label visible">
                                    <span className="km-tag">Km {point.km}</span>
                                    <span className="name-tag">{point.name}</span>
                                    {point.isOpen && <span className="flow-tag">{(point.flow * 1000).toFixed(0)} L/s</span>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="schematic-legend">
                <div className="legend-item"><span className="dot lateral"></span> Lateral</div>
                <div className="legend-item"><span className="dot toma"></span> Toma</div>
                <div className="legend-item"><span className="dot carcamo"></span> Cárcamo</div>
                <div className="legend-item"><span className="dot open"></span> Abierta</div>
                <div className="legend-item"><span className="dot was-active"></span> Cerrada (con movimiento)</div>
            </div>
        </div>
    );
};

export default CanalSchematic;
