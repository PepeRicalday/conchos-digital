import { useMemo } from 'react';
import './ReservoirViz.css';

interface ReservoirVizProps {
    percent: number;      // 0–100 (% llenado NAMO)
    storageMm3: number;   // Almacenamiento actual Mm³
    maxStorageMm3: number; // Capacidad NAMO Mm³
    areaHa?: number;      // Área actual ha
    elevationMsnm?: number;
    damName: string;
}

/**
 * SVG path of the La Boquilla reservoir shape at 100% capacity.
 * Artistic interpretation based on satellite imagery.
 * The path is designed in a 800×400 viewBox with the dam wall on the right.
 */
const BOQUILLA_FULL_PATH =
    'M 50,200 ' +
    'C 60,180 75,160 100,155 ' +      // Western arm starts
    'C 130,148 150,140 170,130 ' +     // NW branch up
    'C 185,122 195,118 210,120 ' +     // NW branch peak
    'C 225,125 230,135 240,142 ' +     // Back down from NW
    'C 255,152 270,148 290,140 ' +     // Central north bulge
    'C 320,128 350,120 380,115 ' +     // North shore runs east
    'C 420,108 460,100 500,95 ' +      // Approaching main body
    'C 540,88 570,82 600,80 ' +        // Widest north point
    'C 630,78 660,82 680,88 ' +        // NE arm
    'C 700,94 720,105 730,115 ' +      // NE arm bends
    'C 740,128 745,140 750,155 ' +     // East end approaches dam
    'L 760,175 ' +                      // Dam wall top
    'L 760,225 ' +                      // Dam wall bottom
    'C 750,245 745,260 730,275 ' +     // SE arm
    'C 720,288 700,295 680,300 ' +     // SE arm continues
    'C 660,308 630,312 600,310 ' +     // South shore wide
    'C 570,308 540,302 500,295 ' +     // South shore runs west
    'C 460,285 420,280 380,275 ' +     // Approaching SW
    'C 350,268 320,262 290,255 ' +     // Central south
    'C 270,248 255,245 240,250 ' +     // SW indent
    'C 225,258 210,265 195,270 ' +     // SW branch
    'C 180,278 165,275 150,268 ' +     // SW branch peak
    'C 130,258 110,250 100,242 ' +     // Back toward west
    'C 75,232 60,220 50,200 Z';        // Close west tip

/**
 * Generates concentric paths for lower water levels.
 * At lower %, the reservoir contracts from the shallow edges inward.
 */
function getWaterPath(percent: number): string {
    if (percent >= 95) return BOQUILLA_FULL_PATH;

    // Calculate contraction factor: at 0% everything contracts to center
    const t = Math.max(0, Math.min(100, percent)) / 100;

    // Center of the reservoir (approximate)
    const cx = 420, cy = 200;

    // Scale factor: at 100% = 1.0, at 0% = 0.15 (tiny puddle)
    const scale = 0.15 + t * 0.85;

    // Also shift the vertical center down slightly at low levels
    // (water settles into the deepest channel)
    const yShift = (1 - t) * 30;

    return `${BOQUILLA_FULL_PATH.replace(/Z$/, '')} Z`.replace(
        /(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/g,
        (_, xStr, yStr) => {
            const x = parseFloat(xStr);
            const y = parseFloat(yStr);
            const nx = cx + (x - cx) * scale;
            const ny = cy + (y - cy) * scale + yShift;
            return `${nx.toFixed(1)},${ny.toFixed(1)}`;
        }
    );
}

const ReservoirViz = ({
    percent,
    storageMm3,
    maxStorageMm3,
    areaHa,
    elevationMsnm,
    damName,
}: ReservoirVizProps) => {
    const clampedPercent = Math.max(0, Math.min(100, percent));

    const waterPath = useMemo(() => getWaterPath(clampedPercent), [clampedPercent]);

    // Color ramps based on percentage
    const waterColor = useMemo(() => {
        if (clampedPercent >= 70) return '#1e40af';     // Deep blue — healthy
        if (clampedPercent >= 50) return '#2563eb';     // Medium blue
        if (clampedPercent >= 30) return '#3b82f6';     // Light blue — caution
        return '#60a5fa';                                // Very light — critical
    }, [clampedPercent]);

    const statusLabel = useMemo(() => {
        if (clampedPercent >= 80) return { text: 'Nivel Óptimo', color: '#10b981' };
        if (clampedPercent >= 60) return { text: 'Nivel Adecuado', color: '#3b82f6' };
        if (clampedPercent >= 40) return { text: 'Nivel Moderado', color: '#f59e0b' };
        if (clampedPercent >= 20) return { text: 'Nivel Bajo', color: '#f97316' };
        return { text: 'Nivel Crítico', color: '#ef4444' };
    }, [clampedPercent]);

    return (
        <div className="reservoir-viz">
            <div className="reservoir-header">
                <h3>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                    </svg>
                    Superficie del Embalse — {damName}
                </h3>
                <div className="reservoir-status" style={{ color: statusLabel.color }}>
                    <span className="status-dot" style={{ backgroundColor: statusLabel.color }} />
                    {statusLabel.text}
                </div>
            </div>

            <div className="reservoir-svg-container">
                <svg viewBox="0 0 810 400" className="reservoir-svg">
                    <defs>
                        {/* Terrain gradient */}
                        <radialGradient id="terrainGrad" cx="50%" cy="50%" r="60%">
                            <stop offset="0%" stopColor="#374151" />
                            <stop offset="60%" stopColor="#1f2937" />
                            <stop offset="100%" stopColor="#111827" />
                        </radialGradient>

                        {/* Water gradient */}
                        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={waterColor} stopOpacity={0.9} />
                            <stop offset="100%" stopColor={waterColor} stopOpacity={0.6} />
                        </linearGradient>

                        {/* Exposed lakebed */}
                        <linearGradient id="driedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#d946ef" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#a855f7" stopOpacity={0.15} />
                        </linearGradient>

                        {/* Water shimmer animation */}
                        <filter id="waterShimmer">
                            <feTurbulence type="fractalNoise" baseFrequency="0.015 0.06" numOctaves="3" seed="3">
                                <animate attributeName="seed" from="0" to="100" dur="12s" repeatCount="indefinite" />
                            </feTurbulence>
                            <feDisplacementMap in="SourceGraphic" scale="4" />
                        </filter>

                        {/* Glow effect */}
                        <filter id="waterGlow">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Background terrain */}
                    <rect x="0" y="0" width="810" height="400" fill="url(#terrainGrad)" rx="12" />

                    {/* Terrain texture dots (deterministic) */}
                    {Array.from({ length: 40 }, (_, i) => {
                        const seed = i * 137.5;
                        const cx = 30 + (seed * 7.3 % 750);
                        const cy = 20 + (seed * 3.7 % 360);
                        const r = 1 + (seed * 1.1 % 2);
                        return (
                            <circle
                                key={`t${i}`}
                                cx={cx}
                                cy={cy}
                                r={r}
                                fill="#4b5563"
                                opacity={0.3}
                            />
                        );
                    })}

                    {/* Max capacity outline (exposed lakebed when below 100%) */}
                    {clampedPercent < 95 && (
                        <path
                            d={BOQUILLA_FULL_PATH}
                            fill="url(#driedGrad)"
                            stroke="#d946ef"
                            strokeWidth="1"
                            strokeDasharray="4 3"
                            opacity={0.6}
                        />
                    )}

                    {/* Water surface — dynamic */}
                    <path
                        d={waterPath}
                        fill="url(#waterGrad)"
                        filter="url(#waterShimmer)"
                        className="water-surface"
                    />

                    {/* Water surface outline glow */}
                    <path
                        d={waterPath}
                        fill="none"
                        stroke={waterColor}
                        strokeWidth="1.5"
                        filter="url(#waterGlow)"
                        opacity={0.7}
                    />

                    {/* Dam wall indicator */}
                    <line x1="760" y1="160" x2="760" y2="240" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
                    <text x="772" y="205" fill="#94a3b8" fontSize="8" fontFamily="monospace">CORTINA</text>

                    {/* West label */}
                    <text x="25" y="200" fill="#6b7280" fontSize="8" fontFamily="monospace" textAnchor="start">W</text>

                    {/* Percentage overlay */}
                    <text
                        x="420" y="195"
                        fill="white" fontSize="42" fontWeight="700" fontFamily="monospace"
                        textAnchor="middle" dominantBaseline="central"
                        opacity={0.9}
                    >
                        {clampedPercent.toFixed(1)}%
                    </text>
                    <text
                        x="420" y="230"
                        fill="rgba(255,255,255,0.5)" fontSize="11"
                        textAnchor="middle" fontFamily="sans-serif"
                    >
                        Capacidad NAMO
                    </text>
                </svg>
            </div>

            {/* Stats row */}
            <div className="reservoir-stats">
                <div className="res-stat">
                    <span className="res-stat-label">Almacenamiento</span>
                    <span className="res-stat-value">{storageMm3.toLocaleString('es-MX', { maximumFractionDigits: 1 })}</span>
                    <span className="res-stat-unit">Mm³</span>
                </div>
                <div className="res-stat-divider" />
                <div className="res-stat">
                    <span className="res-stat-label">Cap. NAMO</span>
                    <span className="res-stat-value">{maxStorageMm3.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
                    <span className="res-stat-unit">Mm³</span>
                </div>
                {areaHa && (
                    <>
                        <div className="res-stat-divider" />
                        <div className="res-stat">
                            <span className="res-stat-label">Área Espejo</span>
                            <span className="res-stat-value">{areaHa.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</span>
                            <span className="res-stat-unit">ha</span>
                        </div>
                    </>
                )}
                {elevationMsnm && (
                    <>
                        <div className="res-stat-divider" />
                        <div className="res-stat">
                            <span className="res-stat-label">Elevación</span>
                            <span className="res-stat-value">{elevationMsnm.toFixed(2)}</span>
                            <span className="res-stat-unit">msnm</span>
                        </div>
                    </>
                )}
            </div>

            {/* Legend */}
            <div className="reservoir-legend">
                <div className="legend-item">
                    <span className="legend-swatch" style={{ background: waterColor }} />
                    <span>Superficie actual</span>
                </div>
                {clampedPercent < 95 && (
                    <div className="legend-item">
                        <span className="legend-swatch dried" />
                        <span>Área expuesta</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReservoirViz;
