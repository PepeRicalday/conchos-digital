import React from 'react';
import { Activity, Settings2 } from 'lucide-react';

import './ReservoirViz.css';

// Interfaz adaptada a nuestro uso, usaremos propiedades dinámicas en el futuro si se amplía
export interface ScadaProps {
    percent: number;
    storageMm3: number;
    maxStorageMm3: number;
    areaHa: number;
    elevationMsnm: number;
    damName: string;
    presaId: string;
}

const FlowCard = ({ title, flow, pressure, active, isCFE = false }: any) => {
    return (
        <div className="scada-flow-card">
            <div className="scada-fc-header">
                <span className="scada-fc-icon">⚓</span>
                <span className="scada-fc-title">{title}</span>
            </div>
            
            <div className="scada-fc-body">
                {/* Radial Gauge Mock */}
                <div className="scada-fc-gauge-container">
                    <svg viewBox="0 0 100 100" className="scada-gauge-svg">
                        <circle cx="50" cy="50" r="40" className="scada-gauge-bg" />
                        <circle cx="50" cy="50" r="40" className={`scada-gauge-fill ${isCFE ? 'cfe' : 'std'}`} style={{ strokeDashoffset: active ? 280 - (280 * 0.7) : 280 }} />
                        <text x="50" y="47" className="scada-gauge-text">GASTO</text>
                        <text x="50" y="62" className="scada-gauge-unit">m³/s</text>
                    </svg>
                </div>
                
                <div className="scada-fc-stats">
                    <div className="scada-stat-row">
                        <Activity size={14} className="scada-stat-icon" />
                        <span className="scada-stat-val">{flow.toFixed(2)}</span>
                        <span className="scada-stat-u">m³/s</span>
                    </div>
                    <div className="scada-stat-row">
                        <Settings2 size={14} className="scada-stat-icon" />
                        <span className="scada-stat-val">{pressure.toFixed(1)}</span>
                        <span className="scada-stat-u">bar</span>
                    </div>
                </div>
            </div>
            
            <div className="scada-fc-footer">
                <span className="scada-fc-estatus">ESTATUS</span>
                <div className={`scada-fc-toggle ${active ? 'active' : ''}`}>
                    <div className="scada-fc-knob"></div>
                </div>
            </div>
        </div>
    );
};

export const ReservoirViz: React.FC<ScadaProps & { ultimoMovimiento?: any }> = ({
    percent,
    // storageMm3,
    // maxStorageMm3,
    // areaHa,
    // elevationMsnm,
    // damName,
    // presaId,
    ultimoMovimiento
}) => {
    const totalExtraccion = 0.05 + 2.40 + 2.00; // Mock current sum
    const clampedPercent = Math.min(100, Math.max(0, percent || 0));

    return (
        <div className="scada-dashboard-root scada-layout-vertical">
            
            {/* TOP MAIN PANEL (FULL WIDTH) */}
            <div className="scada-main-panel">
                <div className="scada-panel-header">
                    <span>REPRESENTACIÓN DEL VASO DE LA PRESA</span>
                </div>
                
                {/* 3D SCADA Diagram */}
                <div className="scada-diagram-wrapper" style={{ padding: '20px 0' }}>
                    <svg viewBox="0 0 900 600" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: '550px' }}>
                        <defs>
                            <linearGradient id="waterFront" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.9" />
                                <stop offset="100%" stopColor="#1e3a8a" stopOpacity="1" />
                            </linearGradient>
                            
                            <linearGradient id="waterTop" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.8" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
                            </linearGradient>

                            <linearGradient id="concreteFront" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#e2e8f0" stopOpacity="1" />
                                <stop offset="100%" stopColor="#94a3b8" stopOpacity="1" />
                            </linearGradient>

                            <linearGradient id="concreteInner" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#cbd5e1" stopOpacity="1" />
                                <stop offset="100%" stopColor="#64748b" stopOpacity="1" />
                            </linearGradient>

                            <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#854d0e" stopOpacity="1" />
                                <stop offset="100%" stopColor="#422006" stopOpacity="1" />
                            </linearGradient>

                            <linearGradient id="pipeCyan" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#bae6fd" />
                                <stop offset="50%" stopColor="#38b6ff" />
                                <stop offset="100%" stopColor="#0284c7" />
                            </linearGradient>
                            
                            <linearGradient id="pipeBlue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#93c5fd" />
                                <stop offset="50%" stopColor="#2563eb" />
                                <stop offset="100%" stopColor="#1e3a8a" />
                            </linearGradient>

                            {/* Turbine blade pattern */}
                            <g id="turbine">
                                <circle cx="0" cy="0" r="28" fill="#1e3a8a" />
                                <circle cx="0" cy="0" r="22" fill="#172554" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(45)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(90)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(135)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(180)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(225)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(270)" />
                                <path d="M 0,-18 Q 8,-10 0,0 Q -8,-10 0,-18 Z" fill="#60a5fa" transform="rotate(315)" />
                                <circle cx="0" cy="0" r="5" fill="#f8fafc" />
                            </g>
                        </defs>

                        {/* Y AXIS MARKS (Elevations) */}
                        <g className="scada-axis" transform="translate(80, 50)">
                            {[1100, 1110, 1120, 1130, 1140, 1150, 1160, 1170, 1180].reverse().map((elev, i) => (
                                <g key={elev} transform={`translate(0, ${i * 45})`}>
                                    <text x="-15" y="4" fontSize="12" fill="#cbd5e1" textAnchor="end" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{elev}</text>
                                    <line x1="0" x2="6" y1="0" y2="0" stroke="#cbd5e1" strokeWidth="1.5" />
                                </g>
                            ))}
                            {/* Vertical Axis Line */}
                            <line x1="0" y1="0" x2="0" y2="360" stroke="#94a3b8" strokeWidth="2" />
                            
                            {/* Y Axis Label */}
                            <text x="-55" y="180" fontSize="13" fill="#f1f5f9" fontWeight="bold" transform="rotate(-90, -55, 180)" style={{ letterSpacing: '3px' }}>
                                NIVEL DEL EMBALSE (msnm)
                            </text>

                            {/* NAMO Reference */}
                            <g transform="translate(5, 45)">
                                <polygon points="0,-6 10,0 0,6" fill="#facc15" />
                                <line x1="15" x2="350" y1="0" y2="0" stroke="#facc15" strokeWidth="1" strokeDasharray="6 4" opacity="0.8" />
                                <text x="20" y="-8" fontSize="13" fill="#facc15" fontWeight="bold" letterSpacing="0.5px">NIVEL MÁXIMO OPERATIVO (NAMO)</text>
                            </g>
                            
                            {/* NAMIN Reference */}
                            <g transform="translate(5, 315)">
                                <polygon points="0,-6 10,0 0,6" fill="#f1f5f9" />
                                <line x1="15" x2="350" y1="0" y2="0" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="6 4" opacity="0.8" />
                                <text x="20" y="-8" fontSize="13" fill="#f1f5f9" fontWeight="bold" letterSpacing="0.5px">NIVEL MÍNIMO OPERATIVO (NAMIN)</text>
                            </g>
                        </g>

                        {/* DYNAMIC WATER & STRUCTURE */}
                        <g transform="translate(85, 50)">
                            {(() => {
                                const p = clampedPercent / 100;
                                // Interpolate coordinates based on percentage 
                                // (100% -> Y=45 (NAMO), 0% -> Y=315 (NAMIN))
                                const topFrontY = 315 - (p * (315 - 45));
                                // Perspective drop towards back
                                const topBackY  = 160 - (p * (160 - -20));
                                const controlY = (topBackY + topFrontY) / 2;

                                return (
                                    <>
                                        {/* Back Water Top Surface (Perspective) */}
                                        <path d={`M 5,${topFrontY} L 240,${topBackY} L 550,${topBackY} Q 520,${controlY} 380,${topFrontY} Z`} fill="url(#waterTop)" style={{ transition: 'all 1.5s ease-in-out' }} />
                                        
                                        {/* Wavy Surface Edge Detail */}
                                        <path d={`M 5,${topFrontY} Q 140,${topFrontY - 25} 240,${topFrontY + 15} T 380,${topFrontY}`} fill="none" stroke="#60a5fa" strokeWidth="2.5" opacity="0.6" style={{ transition: 'all 1.5s ease-in-out' }} />

                                        {/* Front Water Body */}
                                        <path d={`M 5,${topFrontY} Q 140,${topFrontY - 25} 240,${topFrontY + 15} T 380,${topFrontY} L 375,420 L 5,420 Z`} fill="url(#waterFront)" style={{ transition: 'all 1.5s ease-in-out' }} />

                                        {/* "VASO DE LA PRESA" Text overlay directly on water */}
                                        {p > 0.3 && (
                                            <text x="180" y={topFrontY + (360 - topFrontY) * 0.4} fill="#bae6fd" fontSize="16" fontWeight="bold" opacity="0.8" style={{ transition: 'all 1.5s ease-in-out', letterSpacing: '1px' }}>
                                                VASO DE LA PRESA
                                            </text>
                                        )}
                                    </>
                                );
                            })()}

                            {/* GROUND BED (Dirt cross-section) */}
                            <path d="M 5,420 Q 150,440 280,480 L 395,430 L 375,420 Z" fill="url(#groundGrad)" />

                            {/* DAM CONCRETE STRUCTURE */}
                            <g>
                                {/* Inner concave wall touching water */}
                                <path d="M 380,0 L 550,-20 Q 560,180 440,380 L 375,420 Q 390,260 380,0 Z" fill="url(#concreteInner)" opacity="0.95" />
                                
                                {/* Dam Top Crest */}
                                <path d="M 380,0 L 550,-20 L 570,-20 L 400,0 Z" fill="#cbd5e1" />
                                
                                {/* Front Left Slice (the profile) */}
                                <path d="M 380,0 L 400,0 Q 420,240 460,460 L 405,460 L 395,430 L 375,420 Q 390,260 380,0 Z" fill="url(#concreteFront)" stroke="#f8fafc" strokeWidth="1" />
                                
                                {/* Right Dam Extent (The sweeping curved wall on the right) */}
                                <path d="M 400,0 L 570,-20 Q 590,220 530,360 L 460,460 Q 420,240 400,0 Z" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="1" />
                                
                                {/* Cutaway Details inside the front slice */}
                                {/* The vertical shaft for CFE pipe inside Concrete */}
                                <path d="M 385,140 L 395,140 L 395,380 Q 395,425 435,425 L 450,425 L 450,435 L 420,435 Q 385,435 385,380 Z" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
                                {/* Water inside vertical pipe */}
                                <path d="M 387,260 L 393,260 L 393,380 Q 393,423 435,423 L 450,423 L 450,433 L 420,433 Q 387,433 387,380 Z" fill="#2563eb" />
                            </g>

                            {/* ==== TOMAS DE AGUA Y SENSORES ==== */}

                            {/* TOMA ALTA */}
                            <g transform="translate(500, 100)">
                                {/* The Pipe */}
                                <rect x="30" y="20" width="260" height="14" fill="url(#pipeCyan)" rx="2" />
                                {/* Pipe shadow line */}
                                <line x1="30" y1="31" x2="290" y2="31" stroke="#0ea5e9" strokeWidth="1" opacity="0.6" />
                                
                                {/* 3D Cube Valve Connector */}
                                <path d="M 0,0 L 25,-10 L 40,0 L 40,40 L 15,50 L 0,40 Z" fill="#7dd3fc" stroke="#0284c7" strokeWidth="1.5" />
                                <circle cx="20" cy="25" r="10" fill="none" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="4 2" />
                                <circle cx="20" cy="25" r="3" fill="#0284c7" />

                                {/* UI Label Box */}
                                <g transform="translate(20, -50)">
                                    {/* Line connecting box to pipe */}
                                    <polyline points="70,50 70,75" fill="none" stroke="#38b6ff" strokeWidth="1.5" />
                                    <circle cx="70" cy="75" r="3" fill="#38b6ff" />
                                    
                                    {/* Label Title */}
                                    <text x="70" y="-10" fill="#f8fafc" fontSize="13" fontWeight="bold" textAnchor="middle">TOMA ALTA</text>
                                    
                                    {/* Outer Border Box */}
                                    <rect x="0" y="0" width="140" height="42" fill="none" stroke="#475569" strokeWidth="1.5" rx="4" />
                                    
                                    {/* SENSOR Side text */}
                                    <text x="-12" y="32" fill="#cbd5e1" fontSize="9" fontWeight="bold" transform="rotate(-90, 10, 21)">SENSOR</text>
                                    <line x1="22" y1="0" x2="22" y2="42" stroke="#475569" strokeWidth="1.5" />
                                    
                                    {/* Icon Box */}
                                    <rect x="28" y="8" width="28" height="20" fill="none" stroke="#94a3b8" strokeWidth="1" />
                                    <line x1="24" y1="18" x2="28" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
                                    <line x1="56" y1="18" x2="60" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
                                    <rect x="36" y="5" width="12" height="3" fill="#94a3b8" />
                                    
                                    {/* Status Display Area */}
                                    <g transform="translate(64, 0)">
                                        <line x1="0" y1="0" x2="0" y2="42" stroke="#475569" strokeWidth="1.5" />
                                        <line x1="0" y1="21" x2="76" y2="21" stroke="#475569" strokeWidth="1.5" />
                                        
                                        <text x="38" y="14" fill="#f8fafc" fontSize="10" fontWeight="bold" textAnchor="middle">SENSOR</text>
                                        <text x="38" y="35" fill="#10b981" fontSize="10" fontWeight="bold" textAnchor="middle">OPERATIVA</text>
                                        <rect x="0" y="21" width="76" height="21" fill="#10b981" opacity="0.1" rx="0" />
                                    </g>
                                </g>
                            </g>

                            {/* TOMA BAJA */}
                            <g transform="translate(460, 270)">
                                {/* The Pipe */}
                                <rect x="30" y="20" width="300" height="14" fill="url(#pipeBlue)" rx="2" />
                                {/* Pipe shadow line */}
                                <line x1="30" y1="31" x2="330" y2="31" stroke="#1d4ed8" strokeWidth="1" opacity="0.6" />
                                
                                {/* 3D Cube Valve Connector */}
                                <path d="M 0,0 L 25,-10 L 40,0 L 40,40 L 15,50 L 0,40 Z" fill="#60a5fa" stroke="#1d4ed8" strokeWidth="1.5" />
                                <circle cx="20" cy="25" r="10" fill="none" stroke="#1d4ed8" strokeWidth="1.5" strokeDasharray="4 2" />
                                <circle cx="20" cy="25" r="3" fill="#1d4ed8" />

                                {/* UI Label Box */}
                                <g transform="translate(140, -50)">
                                    {/* Line connecting box to pipe */}
                                    <polyline points="70,50 70,75" fill="none" stroke="#60a5fa" strokeWidth="1.5" />
                                    <circle cx="70" cy="75" r="3" fill="#60a5fa" />
                                    
                                    {/* Label Title */}
                                    <text x="70" y="-10" fill="#f8fafc" fontSize="13" fontWeight="bold" textAnchor="middle">TOMA BAJA</text>
                                    
                                    {/* Outer Border Box */}
                                    <rect x="0" y="0" width="140" height="42" fill="none" stroke="#475569" strokeWidth="1.5" rx="4" />
                                    
                                    {/* SENSOR Side text */}
                                    <text x="-12" y="32" fill="#cbd5e1" fontSize="9" fontWeight="bold" transform="rotate(-90, 10, 21)">SENSOR</text>
                                    <line x1="22" y1="0" x2="22" y2="42" stroke="#475569" strokeWidth="1.5" />
                                    
                                    {/* Icon Box */}
                                    <rect x="28" y="8" width="28" height="20" fill="none" stroke="#94a3b8" strokeWidth="1" />
                                    <line x1="24" y1="18" x2="28" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
                                    <line x1="56" y1="18" x2="60" y2="18" stroke="#94a3b8" strokeWidth="1.5" />
                                    <rect x="36" y="5" width="12" height="3" fill="#94a3b8" />
                                    
                                    {/* Status Display Area */}
                                    <g transform="translate(64, 0)">
                                        <line x1="0" y1="0" x2="0" y2="42" stroke="#475569" strokeWidth="1.5" />
                                        <line x1="0" y1="21" x2="76" y2="21" stroke="#475569" strokeWidth="1.5" />
                                        
                                        <text x="38" y="14" fill="#ef4444" fontSize="10" fontWeight="bold" textAnchor="middle">OPERATIA</text>
                                        <text x="38" y="35" fill="#ef4444" fontSize="10" fontWeight="bold" textAnchor="middle">CERRADA</text>
                                        <rect x="0" y="0" width="76" height="42" fill="#ef4444" opacity="0.05" rx="0" />
                                    </g>
                                </g>
                            </g>
                            
                            {/* TOMA CFE (Bottom) */}
                            <g transform="translate(450, 422)">
                                {/* The Pipe exiting to turbine */}
                                <rect x="0" y="0" width="200" height="15" fill="url(#pipeBlue)" rx="2" />
                                <line x1="0" y1="12" x2="200" y2="12" stroke="#1d4ed8" strokeWidth="1" opacity="0.6" />
                                
                                {/* Right Turbine Base Box */}
                                <rect x="200" y="-30" width="55" height="70" fill="#3b82f6" rx="2" />
                                <rect x="195" y="40" width="65" height="10" fill="#1e3a8a" />
                                
                                {/* Turbine Propeller Circular housing */}
                                <use href="#turbine" x="227" y="5" />
                                
                                {/* Dark blue back Engine block */}
                                <rect x="255" y="-10" width="40" height="40" fill="#1e3a8a" rx="4" />
                                <rect x="295" y="2" width="10" height="15" fill="#172554" />
                                
                                {/* Lines on engine block */}
                                <line x1="265" y1="-10" x2="265" y2="30" stroke="#1e40af" strokeWidth="2" />
                                <line x1="275" y1="-10" x2="275" y2="30" stroke="#1e40af" strokeWidth="2" />
                                <line x1="285" y1="-10" x2="285" y2="30" stroke="#1e40af" strokeWidth="2" />

                                {/* Flow arrow UI Indicator */}
                                <path d="M 50,-30 L 160,-30 L 160,-10" fill="none" stroke="#2dd4bf" strokeWidth="1.5" />
                                <polygon points="160,-5 164,-12 156,-12" fill="#2dd4bf" />
                                <circle cx="50" cy="-30" r="3" fill="#2dd4bf" />
                                
                                <rect x="70" y="-45" width="150" height="30" fill="none" stroke="#475569" strokeWidth="1.5" rx="6" />
                                {/* Electric symbol */}
                                <circle cx="85" cy="-30" r="10" fill="none" stroke="#cbd5e1" strokeWidth="1" />
                                <path d="M 85,-38 L 81,-30 L 87,-30 L 83,-22" stroke="#facc15" strokeWidth="1.5" fill="none" />
                                <text x="105" y="-26" fill="#f8fafc" fontSize="11" fontWeight="bold">TOMA CFE (GENERACIÓN)</text>
                            </g>

                        </g>
                    </svg>
                </div>
            </div>

            {/* BOTTOM HORIZONTAL VARS PANEL */}
            <div className="scada-vars-panel horizontal">
                <div className="scada-panel-header">
                    <span>VARIABLES DE EXTRACCIÓN Y ESTADO ACTUAL</span>
                </div>
                <div className="scada-vars-list">
                    <FlowCard title="TOMA ALTA" flow={0.05} pressure={1.3} active={true} type="ALTA" />
                    <FlowCard title="TOMA BAJA" flow={2.40} pressure={3} active={false} type="BAJA" />
                    <FlowCard title="TOMA CFE" flow={2.0} pressure={1} active={true} type="CFE" isCFE={true} />
                    
                    {/* TOTAL SUMATORIA CART */}
                    <div className="scada-flow-card scada-sum-card relative overflow-hidden" style={{ border: '2px solid #10b981' }}>
                        <div className="absolute top-0 left-0 w-full h-full bg-emerald-500/10" />
                        <div className="scada-fc-header bg-emerald-950/40 relative z-10">
                            <Activity size={14} className="text-emerald-400" />
                            <span className="scada-fc-title text-emerald-400">EXTRACCIÓN TOTAL</span>
                        </div>
                        <div className="scada-fc-body flex-col justify-center items-center py-6 relative z-10">
                            <div className="flex items-baseline gap-2">
                                <span className="scada-stat-val text-4xl text-emerald-300">{totalExtraccion.toFixed(2)}</span>
                                <span className="scada-stat-u text-emerald-500/80 font-bold text-lg">m³/s</span>
                            </div>
                            <div className="mt-2 text-[10px] text-emerald-400/60 uppercase tracking-widest font-semibold flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                SALIDA ACTIVA
                            </div>
                        </div>
                    </div>
                </div>
                
                {/* ÚLTIMO MOVIMIENTO */}
                {ultimoMovimiento && (
                    <div className="scada-last-mov-row mt-2 flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                                <Settings2 size={16} className="text-indigo-400" />
                            </div>
                            <div>
                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Último Movimiento Registrado</div>
                                <div className="text-sm font-medium text-slate-300">
                                    Ajuste de obra de toma a <span className="text-white font-bold">{ultimoMovimiento.gasto_m3s.toFixed(2)} m³/s</span>
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-[11px] text-slate-400">
                                {new Date(ultimoMovimiento.fecha_hora).toLocaleString('es-MX')}
                            </div>
                            <div className={`text-[10px] font-bold px-2 py-0.5 rounded mt-1 inline-block ${ultimoMovimiento.fuente_dato === 'GERENCIA_ADMIN' ? 'bg-amber-500/20 text-amber-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                                VIA {ultimoMovimiento.fuente_dato === 'GERENCIA_ADMIN' ? 'GERENCIA CENTRAL' : 'OPERADOR CAMPO'}
                            </div>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
};
