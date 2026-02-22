import { ArrowRight, Droplet, Zap } from 'lucide-react';
import './CanalSchematic.css';

interface DeliveryPoint {
    id: string;
    name: string;
    km: number;
    type: 'toma' | 'lateral' | 'carcamo';
    flow: number;
    isOpen: boolean;
}

interface CanalSchematicProps {
    points: DeliveryPoint[];
    activePointId: string | null;
    onPointClick: (point: DeliveryPoint) => void;
}

const CanalSchematic: React.FC<CanalSchematicProps> = ({ points, activePointId, onPointClick }) => {
    // Sort points by Kilometer
    const sortedPoints = [...points].sort((a, b) => a.km - b.km);
    const totalLength = 104;

    const getPosition = (km: number) => {
        return (km / totalLength) * 100;
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'lateral': return <ArrowRight size={12} />;
            case 'carcamo': return <Zap size={12} />;
            default: return <Droplet size={12} />;
        }
    };

    return (
        <div className="schematic-container">
            <h3 className="schematic-title">Mapa Lineal del Canal Principal (Km 0 - Km {totalLength})</h3>

            <div className="canal-line-wrapper">
                <div className="canal-line-bg"></div>
                <div className="canal-water-flow"></div>

                {sortedPoints
                    .filter(point => point.isOpen)
                    .map((point) => {
                        const isActive = point.id === activePointId;
                        return (
                            <div
                                key={point.id}
                                className={`schematic-point ${point.type} ${point.isOpen ? 'open' : 'closed'} ${isActive ? 'active-pin' : ''}`}
                                style={{ left: `${getPosition(point.km)}%`, zIndex: isActive ? 10 : 1 }}
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

                                {/* Only show label if active */}
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
                <div className="legend-item"><span className="dot closed"></span> Cerrada</div>
            </div>
        </div>
    );
};

export default CanalSchematic;
