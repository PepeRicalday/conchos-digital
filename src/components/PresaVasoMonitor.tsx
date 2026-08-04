import React, { useMemo, useState, useEffect } from 'react';
import { Droplets, Gauge, Activity, AlertTriangle, TrendingUp, ChevronLeft, ChevronRight, Info, Satellite, RefreshCw } from 'lucide-react';
import './PresaVasoMonitor.css';
import { detectaSuperficieVaso, type SuperficieVaso } from '../utils/mapaSatelital';

interface CurvaPunto { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

// presa_id (tabla `presas`) → nombre usado en VASOS_CONOCIDOS (mapaSatelital.ts).
// Antes GeoMonitor comparaba contra el literal 'BOQUILLA', que nunca coincide
// con el presa_id real ('PRE-001'/'PRE-002') — ver informe de auditoría.
const NOMBRE_VASO_POR_PRESA_ID: Record<string, string> = {
    'PRE-001': 'La Boquilla',
    'PRE-002': 'Fco. I. Madero',
};

interface PresaVasoMonitorProps {
    data: {
        nombre: string;
        nivel_msnm: number | null;
        almacenamiento_mm3: number;
        porcentaje: number;
        extraccion_m3s: number;
        nivel_nma: number | null; // Nivel Máximo de Aguas — de elevacion_corona_msnm si no hay NAME propio
        capacidad_total: number | null;
        presa_id: string;
        curva?: CurvaPunto[];
    };
    onClose: () => void;
}

// Interpola volumen (Mm3) para una elevación dada usando la curva real de la
// presa (curvas_capacidad). Si no hay curva, retorna null — nunca un número
// inventado (antes: factor Mm3/metro hardcodeado por presa_id).
function volumenPorElevacion(curva: CurvaPunto[] | undefined, elevacion: number): number | null {
    if (!curva || curva.length < 2) return null;
    const pts = [...curva].sort((a, b) => a.elevacion_msnm - b.elevacion_msnm);
    if (elevacion <= pts[0].elevacion_msnm) return pts[0].volumen_mm3;
    if (elevacion >= pts[pts.length - 1].elevacion_msnm) return pts[pts.length - 1].volumen_mm3;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (elevacion >= a.elevacion_msnm && elevacion <= b.elevacion_msnm) {
            const t = (elevacion - a.elevacion_msnm) / (b.elevacion_msnm - a.elevacion_msnm);
            return a.volumen_mm3 + t * (b.volumen_mm3 - a.volumen_mm3);
        }
    }
    return null;
}

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, onClose }) => {
    const tieneNivel = data.nivel_msnm !== null;
    const tieneCurva = (data.curva?.length ?? 0) >= 2;

    // Estado para simulación interactiva — arranca en el nivel real si existe,
    // o en 0 (deshabilitado) si no hay lectura del día.
    const [simNivel, setSimNivel] = useState(data.nivel_msnm ?? 0);

    // Cálculos dinámicos basados en el nivel. Usa la curva real elevación→volumen
    // de la presa (curvas_capacidad) cuando está disponible; si no, no inventa un
    // factor Mm3/metro — el volumen simulado se muestra como "S/D".
    const stats = useMemo(() => {
        const diff = data.nivel_msnm !== null ? simNivel - data.nivel_msnm : 0;
        const nuevoAlmacenamiento = tieneCurva
            ? volumenPorElevacion(data.curva, simNivel)
            : (Math.abs(diff) < 0.001 ? data.almacenamiento_mm3 : null);
        const nuevoPorcentaje = (nuevoAlmacenamiento !== null && data.capacidad_total)
            ? Math.min(100, (nuevoAlmacenamiento / data.capacidad_total) * 100)
            : null;

        // Área expuesta (simulación visual, solo si hay NMA de referencia)
        const areaExpuestaFactor = data.nivel_nma !== null ? Math.max(0, data.nivel_nma - simNivel) * 12 : 0;

        return {
            almacenamiento: nuevoAlmacenamiento,
            porcentaje: nuevoPorcentaje,
            areaExpuesta: areaExpuestaFactor,
            isSimulated: Math.abs(diff) > 0.01
        };
    }, [simNivel, data, tieneCurva]);

    // Manejo de Vaso (Fase 2, auditoría ago-2026): superficie de agua estimada
    // por NDWI sobre imagen satelital reciente, para comparar contra la captura
    // diaria real (porcentaje_llenado) — antes esto no existía, el visor solo
    // mostraba una foto fija de una sola fecha (boquilla_5marzo.webp) sin
    // importar la presa ni el día seleccionados.
    const nombreVaso = NOMBRE_VASO_POR_PRESA_ID[data.presa_id];
    const [superficieVaso, setSuperficieVaso] = useState<SuperficieVaso | null>(null);
    const [cargandoNdwi, setCargandoNdwi] = useState(false);
    const [errorNdwi, setErrorNdwi] = useState(false);

    const cargarSuperficie = React.useCallback(() => {
        if (!nombreVaso) return;
        setCargandoNdwi(true);
        setErrorNdwi(false);
        detectaSuperficieVaso(nombreVaso)
            .then(res => {
                if (res) setSuperficieVaso(res);
                else setErrorNdwi(true);
            })
            .catch(() => setErrorNdwi(true))
            .finally(() => setCargandoNdwi(false));
    }, [nombreVaso]);

    useEffect(() => {
        cargarSuperficie();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.presa_id]);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                {/* Background Satellite Image with Dynamic Mask.
                    Fase 2: usa el recorte NDWI reciente del vaso (detectaSuperficieVaso)
                    cuando está disponible; antes era siempre la misma foto fija de una
                    sola fecha (boquilla_5marzo.webp), sin importar presa ni día. */}
                <div className="vaso-map-bg">
                    <img
                        src={superficieVaso?.dataURI || '/boquilla_5marzo.webp'}
                        alt={`Vaso de la Presa ${data.nombre} - Imagen Satelital`}
                        className="vaso-base-img"
                        style={{ filter: `brightness(${0.4 + ((stats.porcentaje ?? 50) / 200)}) contrast(1.1)` }}
                    />

                    {/* SVG MASK INTERACTIVA: Simula el espejo de agua moviéndose */}
                    <svg className="vaso-water-mask" viewBox="0 0 1000 600" preserveAspectRatio="none">
                        <defs>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="5" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <path
                            d="M150,300 Q300,150 500,200 T850,300 Q700,450 500,400 T150,300"
                            fill="rgba(34, 211, 238, 0.2)"
                            stroke="#22d3ee"
                            strokeWidth="2"
                            style={{
                                transform: `scale(${0.5 + ((stats.porcentaje ?? 50) / 180)})`,
                                transformOrigin: 'center',
                                transition: 'all 0.5s ease-out',
                                filter: 'url(#glow)'
                            }}
                        />
                    </svg>

                    <div className="vaso-scanline"></div>
                </div>

                {/* UI OVERLAYS */}
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN E INTERACTIVIDAD DE VASO</div>
                        <h2>PRESA {data.nombre.toUpperCase()}</h2>
                        <div className="vaso-coords">
                            LECTURA OFICIAL: {tieneNivel ? `${data.nivel_msnm!.toFixed(2)} msnm` : 'S/D — sin lectura del día'}
                        </div>
                    </div>
                    <button className="vaso-close" onClick={onClose}>×</button>
                </header>

                {/* CONTROLES DE SIMULACIÓN INTERACTIVA — deshabilitado sin lectura real de ancla */}
                <div className="vaso-sim-controls glass">
                    <div className="sim-header">
                        <Activity size={16} /> SIMULADOR DE IMPACTO HIDRÁULICO
                    </div>
                    <div className="sim-body">
                        {!tieneNivel ? (
                            <div className="sim-value-display" style={{ opacity: 0.6 }}>
                                Sin lectura oficial del día — simulador no disponible.
                            </div>
                        ) : (
                            <>
                                <div className="sim-slider-group">
                                    <label>Ajustar Nivel Manualmente (msnm)</label>
                                    <div className="sim-input-row">
                                        <button onClick={() => setSimNivel(s => s - 0.5)}><ChevronLeft /></button>
                                        <input
                                            type="range"
                                            min={data.nivel_msnm! - 10}
                                            max={(data.nivel_nma ?? data.nivel_msnm! + 5) + 2}
                                            step="0.1"
                                            value={simNivel}
                                            onChange={(e) => setSimNivel(parseFloat(e.target.value))}
                                        />
                                        <button onClick={() => setSimNivel(s => s + 0.5)}><ChevronRight /></button>
                                    </div>
                                    <div className="sim-value-display">
                                        <strong>{(simNivel ?? 0).toFixed(2)}</strong> <small>msnm</small>
                                    </div>
                                </div>
                                {stats.isSimulated && (
                                    <button className="sim-reset-btn" onClick={() => setSimNivel(data.nivel_msnm!)}>
                                        Restablecer a Lectura Real
                                    </button>
                                )}
                                {!tieneCurva && (
                                    <div className="sim-value-display" style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>
                                        Sin curva elevación-capacidad cargada para esta presa: el volumen simulado no se puede estimar.
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* KPI SQUARES (DINÁMICOS) */}
                <div className="vaso-stats-grid">
                    <div className={clsx('vaso-stat-card glass', stats.isSimulated && 'simulated-highlight')}>
                        <div className="vaso-stat-label">
                            <Gauge size={14} /> VOLUMEN {stats.isSimulated ? 'INTERACTIVO' : 'REGISTRADO'}
                        </div>
                        <div className="vaso-stat-value">
                            {stats.almacenamiento !== null ? stats.almacenamiento.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'S/D'} <small>Mm³</small>
                        </div>
                        <div className="vaso-stat-footer">
                            CAP. TOTAL: {data.capacidad_total !== null ? `${data.capacidad_total} Mm³` : 'S/D'}
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Droplets size={14} /> PORCENTAJE LLENADO
                        </div>
                        <div className="vaso-stat-value">
                            {stats.porcentaje !== null ? stats.porcentaje.toFixed(1) : 'S/D'} <small>{stats.porcentaje !== null ? '%' : ''}</small>
                        </div>
                        <div className="vaso-stat-progress">
                            <div className="vaso-progress-bar">
                                <div className="vaso-progress-fill" style={{ width: `${stats.porcentaje ?? 0}%` }}></div>
                            </div>
                        </div>
                    </div>

                    <div className="vaso-stat-card glass">
                        <div className="vaso-stat-label">
                            <Info size={14} /> ESTADO DEL EMBALSE
                        </div>
                        <div className="vaso-stat-value" style={{ fontSize: '1.5rem', marginTop: '10px' }}>
                            {stats.porcentaje === null ? 'S/D' : stats.porcentaje < 20 ? 'CRÍTICO' : stats.porcentaje < 40 ? 'BAJO' : 'NORMAL'}
                        </div>
                        <div className="vaso-stat-footer status-active">
                            <span className="pulse-dot"></span> MONITOREO ACTIVO
                        </div>
                    </div>
                </div>

                {/* ANALYTICS: PERFIL DE IMPACTO */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <TrendingUp size={16} /> ANÁLISIS TÉCNICO DE SUPERFICIE
                    </div>
                    <div className="vaso-analytics-body">
                        <div className="vaso-alert-box">
                            <AlertTriangle size={20} className={stats.porcentaje !== null && stats.porcentaje < 30 ? 'text-red-500' : 'text-amber-500'} />
                            <div className="vaso-alert-text">
                                {stats.isSimulated ? (
                                    <span>Simulando impacto de <strong>{(simNivel - (data.nivel_msnm ?? 0)).toFixed(2)}m</strong> sobre la lectura base de hoy.</span>
                                ) : tieneNivel ? (
                                    <span>Situación operativa estable basada en el aforo de entrada de la SRL.</span>
                                ) : (
                                    <span>Sin lectura oficial capturada hoy — verificar captura de nivel de embalse.</span>
                                )}
                            </div>
                        </div>
                        {data.nivel_nma !== null && (
                            <div className="vaso-prediction">
                                Diferencia vs NMA: <strong>{(data.nivel_nma - simNivel).toFixed(2)}m</strong> de "anillo de sequía" expuesto.
                            </div>
                        )}
                    </div>
                </div>

                {/* MANEJO DE VASO: NDWI satelital vs. captura diaria de campo
                    (Fase 2, auditoría ago-2026). Antes no existía comparación
                    alguna — el % de llenado capturado en sica-capture y el NDWI
                    ya calculado en mapaSatelital.ts vivían desconectados. */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <Satellite size={16} /> MANEJO DE VASO — ÍNDICE DE HUMEDAD (NDWI) VS. CAPTURA DE CAMPO
                        <button
                            className="sim-reset-btn"
                            style={{ marginLeft: 'auto', padding: '4px 10px' }}
                            onClick={cargarSuperficie}
                            disabled={cargandoNdwi || !nombreVaso}
                            title="Recalcular superficie de agua por imagen satelital reciente"
                        >
                            <RefreshCw size={12} className={cargandoNdwi ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    <div className="vaso-analytics-body">
                        {!nombreVaso ? (
                            <div className="vaso-prediction" style={{ opacity: 0.6 }}>
                                Esta presa no tiene coordenadas de vaso configuradas para detección satelital.
                            </div>
                        ) : cargandoNdwi ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>Analizando imagen satelital reciente…</div>
                        ) : errorNdwi ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>
                                Sin escena satelital disponible en este momento (red o cobertura de teselas insuficiente).
                            </div>
                        ) : superficieVaso ? (
                            <>
                                <div className="vaso-ndwi-compare">
                                    <div className="vaso-ndwi-col">
                                        <span className="vaso-ndwi-label">Superficie estimada (NDWI)</span>
                                        <span className="vaso-ndwi-value">{superficieVaso.areaKm2.toFixed(1)} <small>km²</small></span>
                                    </div>
                                    <div className="vaso-ndwi-col">
                                        <span className="vaso-ndwi-label">Llenado capturado (campo)</span>
                                        <span className="vaso-ndwi-value">
                                            {stats.porcentaje !== null ? stats.porcentaje.toFixed(1) : 'S/D'} <small>{stats.porcentaje !== null ? '%' : ''}</small>
                                        </span>
                                    </div>
                                </div>
                                <div className="vaso-prediction" style={{ fontSize: 10.5, opacity: 0.65, marginTop: 8 }}>
                                    Estimación por índice tipo NDWI sobre imaginería visual (ArcGIS World Imagery, sin
                                    banda infrarroja real) — aproximación, no medición de sensor multiespectral certificada.
                                    Cobertura de imagen: {(superficieVaso.cobertura * 100).toFixed(0)}%.
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                {/* MAP INTERACTORS */}
                <div className="vaso-map-tag tag-cortina" style={{ top: '50%', left: '88%' }}>
                    <div className="tag-line"></div>
                    <div className="tag-content">CORTINA</div>
                </div>
            </div>
        </div>
    );
};

const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');
