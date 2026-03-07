import { useMemo, useState } from 'react';
import './ReservoirViz.css';

interface ReservoirVizProps {
    percent: number;      // 0–100 (% llenado NAMO)
    storageMm3: number;   // Almacenamiento actual Mm³
    maxStorageMm3: number; // Capacidad NAMO Mm³
    areaHa?: number;      // Área actual ha
    elevationMsnm?: number;
    damName: string;
    presaId?: string;
}

const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');

/**
 * Silueta técnica detallada de La Boquilla (SICA 005 - 5 Marzo)
 */
const BOQUILLA_TECNICA_PATH =
    'M 35,200 ' +
    'L 60,192 L 95,185 L 130,178 L 175,170 ' +
    'Q 200,145 230,138 L 265,128 ' +
    'Q 295,110 330,120 L 370,135 ' +
    'Q 410,105 455,95 L 505,88 ' +
    'Q 540,75 585,82 L 635,95 ' +
    'L 685,115 L 725,145 L 755,175 ' +
    'L 760,175 L 760,225 ' +
    'L 745,255 L 710,275 L 670,292 L 620,310 ' +
    'Q 580,325 535,308 L 485,295 ' +
    'Q 445,275 405,285 L 360,300 ' +
    'Q 315,315 270,290 L 225,275 ' +
    'L 185,265 L 140,250 L 95,235 L 35,200 Z';


/**
 * Generates concentric paths for lower water levels.
 * At lower %, the reservoir contracts from the shallow edges inward.
 */
function getWaterPath(percent: number): string {
    const PATH_TO_USE = BOQUILLA_TECNICA_PATH;
    if (percent >= 98) return PATH_TO_USE;

    const t = Math.max(0, Math.min(100, percent)) / 100;
    const cx = 450, cy = 200; // Centro de masa hídrica (más hacia el este que antes)
    const scale = 0.2 + t * 0.8;
    const yShift = (1 - t) * 15;

    return `${PATH_TO_USE.replace(/Z$/, '')} Z`.replace(
        /(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/g,
        (_, xStr, yStr) => {
            const x = parseFloat(xStr);
            const y = parseFloat(yStr);
            // La cortina (puntos X > 750) no debe moverse lateralmente
            if (x > 750) {
                const ny = cy + (y - cy) * scale + yShift;
                return `${x},${ny.toFixed(1)}`;
            }
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
    presaId,
}: ReservoirVizProps) => {
    // Estado para simulación interactiva
    const [simPercent, setSimPercent] = useState<number | null>(null);
    const currentPercent = simPercent !== null ? simPercent : percent;

    const clampedPercent = Math.max(0, Math.min(100, currentPercent));

    const waterPath = useMemo(() => getWaterPath(clampedPercent), [clampedPercent]);

    // Cálculo dinámico de almacenamiento basado en el porcentaje simulado
    const displayStorage = useMemo(() => {
        if (simPercent === null) return storageMm3;
        return (clampedPercent / 100) * maxStorageMm3;
    }, [simPercent, clampedPercent, storageMm3, maxStorageMm3]);

    const isBoquilla = presaId === 'PRE-001' || damName.toUpperCase().includes('BOQUILLA');

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

                        {/* Water gradient — Más intenso estilo Digital Twin */}
                        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.85} />
                            <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.7} />
                        </linearGradient>

                        {/* Exposed lakebed — Violeta neón */}
                        <linearGradient id="driedGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#d946ef" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#701a75" stopOpacity={0.2} />
                        </linearGradient>

                        {/* Water shimmer animation */}
                        <filter id="waterShimmer">
                            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.08" numOctaves="3" seed="3">
                                <animate attributeName="seed" from="0" to="100" dur="15s" repeatCount="indefinite" />
                            </feTurbulence>
                            <feDisplacementMap in="SourceGraphic" scale="5" />
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

                    {/* Background terrain or Satellite */}
                    {isBoquilla ? (
                        <image
                            href="/boquilla_5marzo.png"
                            x="0" y="0" width="810" height="400"
                            preserveAspectRatio="xMidYMid slice"
                            style={{ clipPath: 'inset(0% round 12px)' }}
                        />
                    ) : (
                        <rect x="0" y="0" width="810" height="400" fill="url(#terrainGrad)" rx="12" />
                    )}

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
                    {clampedPercent < 98 && (
                        <path
                            d={BOQUILLA_TECNICA_PATH}
                            fill="url(#driedGrad)"
                            stroke="#d946ef"
                            strokeWidth="1.5"
                            strokeDasharray="5 4"
                            opacity={0.7}
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
                        fill="rgba(255,255,255,0.7)" fontSize="11" fontWeight="bold"
                        textAnchor="middle" fontFamily="sans-serif"
                    >
                        {simPercent !== null ? 'SIMULACIÓN DE VOLUMEN' : 'Capacidad NAMO'}
                    </text>
                </svg>
            </div>

            {/* Simulation Slider Control */}
            <div className="reservoir-interactive-panel">
                <div className="sim-slider-wrap">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Ajustar Nivel Interactivo (%):</span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="0.1"
                        value={clampedPercent}
                        onChange={(e) => setSimPercent(parseFloat(e.target.value))}
                        className="sim-slider"
                    />
                    {simPercent !== null && (
                        <button className="reset-sim-btn" onClick={() => setSimPercent(null)}>
                            Reset
                        </button>
                    )}
                </div>
            </div>

            {/* Stats row */}
            <div className="reservoir-stats">
                <div className="res-stat">
                    <span className="res-stat-label">Almacenamiento</span>
                    <span className={clsx("res-stat-value", simPercent !== null && "text-blue-400")}>
                        {displayStorage.toLocaleString('es-MX', { maximumFractionDigits: 1 })}
                    </span>
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
