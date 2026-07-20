import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, AreaChart, Area
} from 'recharts';
import {
    Droplets, Waves, Activity, AlertTriangle, TrendingUp, TrendingDown,
    ArrowRight, Loader, ShieldCheck, Smartphone, Monitor as MonitorIcon, Database,
    Radio, Clock
} from 'lucide-react';
import KPICard, { type KPISeverity } from '../components/KPICard';
import ChartWidget from '../components/ChartWidget';
import AlertList, { type Alert } from '../components/AlertList';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { usePresas } from '../hooks/usePresas';
import { useLeakMonitor } from '../hooks/useLeakMonitor';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { usePredictiveBalance } from '../hooks/usePredictiveBalance';
import { useFecha } from '../context/FechaContext';
import { supabase } from '../lib/supabase';
import { getTodayString, addDays, getStartOfDateISO } from '../utils/dateHelpers';
import { porcentajeLlenadoPresa } from '../utils/presaMetrics';
import type { AppVersionRow, VwAlertaTomaVaradaRow } from '../types/sica.types';
import './Dashboard.css';

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Pérdida mínima (m³/s) para considerar una fuga como real y accionable. */
const UMBRAL_PERDIDA_M3S = 0.05;

/** Días tras los cuales un protocolo abierto se considera sospechoso de no haberse cerrado. */
const UMBRAL_DIAS_PROTOCOLO = 30;

/** Capacidad de conducción de referencia del canal (m³/s) para normalizar el anillo de extracción. */
const CAPACIDAD_CONDUCCION_M3S = 80;

function formatFechaCorta(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d)} ${MESES_CORTOS[parseInt(m) - 1]} ${y}`;
}

/**
 * Nombre legible de un tramo. La vista dashboard_vulnerabilidad_fugas no siempre
 * entrega `tramo_inicio`, y sin este respaldo la UI imprimía "Tramo undefined".
 */
function nombrarTramo(s: { tramo_inicio?: string | null; tramo_fin?: string | null; km_inicio?: number | null }): string {
    const km = s.km_inicio != null ? `KM ${s.km_inicio.toFixed(1)}` : 'KM s/d';
    if (s.tramo_inicio && s.tramo_fin) return `Tramo ${s.tramo_inicio} → ${s.tramo_fin}`;
    if (s.tramo_inicio) return `Tramo ${s.tramo_inicio} (${km})`;
    return `Tramo ${km}`;
}

/* ─── SVG Donut Ring ──────────────────────────────────────────── */
function DonutRing({ pct, label, color = '#60a5fa', size = 110 }: {
    pct: number | null; label: string; color?: string; size?: number;
}) {
    const r = 38;
    const circ = 2 * Math.PI * r;
    // null = sin dato: el anillo se muestra vacío con "S/D" al centro, nunca 0%.
    const sinDato = pct == null || !Number.isFinite(pct);
    const safePct = sinDato ? 0 : Math.max(0, Math.min(pct as number, 100));
    const stroke = circ * safePct / 100;
    const ringId = `donut-grad-${label.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
                <defs>
                    <linearGradient id={ringId} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={color} stopOpacity="1" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.6" />
                    </linearGradient>
                    <filter id="glow-donut-premium">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                </defs>
                {/* Track */}
                <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                {/* Fill */}
                <circle
                    cx="50" cy="50" r={r}
                    fill="none"
                    stroke={`url(#${ringId})`}
                    strokeWidth="10"
                    strokeDasharray={`${stroke} ${circ}`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                    style={{
                        filter: `drop-shadow(0 0 8px ${color}80)`,
                        transition: 'stroke-dasharray 1.5s cubic-bezier(0.4, 0, 0.2, 1)'
                    }}
                />
                {/* Center text */}
                <text
                    x="50" y="55" textAnchor="middle"
                    fill={sinDato ? '#94a3b8' : '#fff'}
                    fontSize={sinDato ? '15' : '18'}
                    fontWeight="900"
                    fontFamily="var(--font-mono)"
                >
                    {sinDato ? 'S/D' : `${safePct.toFixed(0)}%`}
                </text>
            </svg>
            <span style={{ 
                fontSize: '0.6rem', 
                fontWeight: '800', 
                color: '#94a3b8', 
                letterSpacing: '0.15em', 
                textTransform: 'uppercase',
                fontFamily: 'var(--font-sans)',
                background: 'rgba(255,255,255,0.03)',
                padding: '2px 8px',
                borderRadius: '4px'
            }}>
                {label}
            </span>
        </div>
    );
}



/* ─── Module Efficiency Bar (custom, no recharts) ──────────────── */
function ModuleBar({ name, pct, rank, vol }: { name: string; pct: number; rank: number; vol: number }) {
    // El sobregiro (>100% del volumen autorizado) es una condición distinta de
    // "cumplimiento alto" y debe distinguirse a simple vista.
    const isOver = pct > 100;
    const isHigh = pct >= 90 && !isOver;

    const barColor = isOver
        ? 'linear-gradient(90deg, #dc2626, #f43f5e)'
        : isHigh
            ? 'linear-gradient(90deg, #f43f5e, #fb923c)'
            : pct >= 60
                ? 'linear-gradient(90deg, #3b82f6, #06b6d4)'
                : 'linear-gradient(90deg, #10b981, #34d399)';

    const glowColor = isOver ? '#dc2626' : isHigh ? '#f43f5e' : pct >= 60 ? '#3b82f6' : '#10b981';

    // La barra se escala contra el máximo real para que el excedente sea visible.
    const escala = Math.max(100, pct);
    const anchoPct = (Math.min(pct, escala) / escala) * 100;
    const marca100 = (100 / escala) * 100;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            {/* Rank badge */}
            <span style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: (rank <= 2 && pct > 0) ? 'linear-gradient(135deg,#fbbf24,#f59e0b)' : 'rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.65rem', fontWeight: '800', color: (rank <= 2 && pct > 0) ? '#1c1400' : '#94a3b8',
                flexShrink: 0,
                border: (rank <= 2 && pct > 0) ? 'none' : '1px solid rgba(255,255,255,0.05)'
            }}>{rank}</span>

            {/* Name */}
            <span style={{ width: '55px', fontSize: '0.75rem', color: '#cbd5e1', fontWeight: '700', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
                {name}
            </span>

            {/* Bar track */}
            <div style={{ flex: 1, height: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '999px', position: 'relative', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}>
                <div style={{
                    width: `${anchoPct}%`,
                    height: '100%',
                    background: barColor,
                    borderRadius: '999px',
                    boxShadow: `0 0 12px ${glowColor}B3, inset 0 1px 1px rgba(255,255,255,0.3)`,
                    transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                }} />
                {/* Marca de referencia en el volumen autorizado (100%) */}
                {isOver && (
                    <div
                        title="Volumen autorizado (100%)"
                        style={{
                            position: 'absolute', top: '-2px', bottom: '-2px',
                            left: `${marca100}%`, width: '2px',
                            background: 'rgba(255,255,255,0.85)',
                            boxShadow: '0 0 4px rgba(0,0,0,0.6)',
                            pointerEvents: 'none'
                        }}
                    />
                )}
            </div>

            {/* Value & Volume */}
            <div style={{
                width: '85px', textAlign: 'right',
                display: 'flex', flexDirection: 'column',
                lineHeight: '1.1', flexShrink: 0
            }}>
                <span style={{
                    fontSize: '0.8rem', fontWeight: '800',
                    color: isOver ? '#f87171' : isHigh ? '#fb923c' : pct >= 60 ? '#60a5fa' : '#34d399',
                    fontFamily: 'var(--font-mono)',
                    textShadow: `0 0 10px ${glowColor}80`
                }}>
                    {pct.toFixed(1)}%
                </span>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: '600', fontFamily: 'var(--font-mono)' }}>
                    {vol.toFixed(3)}<small style={{ fontSize: '0.5rem', marginLeft: '1px' }}>Mm³</small>
                </span>
            </div>
        </div>
    );
}

/* ─── Tooltip renderers ── */
const StorageTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="chart-tooltip">
            <p className="tooltip-label">{label}</p>
            {payload.map((p: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.fill || p.stroke }} />
                    <span className="tooltip-value" style={{ fontSize: '0.8rem' }}>
                        {Number(p.value).toFixed(1)} <span style={{ fontSize: '0.6rem', color: '#94a3b8' }}>Mm³</span>
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{p.name}</span>
                </div>
            ))}
        </div>
    );
};

const ExtraccionTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="chart-tooltip">
            <p className="tooltip-label">{label}</p>
            <p className="tooltip-value">{Number(payload[0].value).toFixed(2)} <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>m³/s</span></p>
        </div>
    );
};

/* ═══════════════════════════════════════════════════════════════ */
const Dashboard = () => {
    const navigate = useNavigate();
    const { fechaSeleccionada, esHoy } = useFecha();
    const { activeEvent } = useHydricEvents();

    const { modules, loading: loadingModules } = useHydraEngine();
    const {
        presas,
        totalAlmacenamiento,
        totalCapacidad,
        totalExtraccion,
        totalVolumenExtraidoMm3,
        porcentajeLlenado,
        almacenamiento,
        frescuraLectura,
        loading: loadingPresas
    } = usePresas(fechaSeleccionada);

    const { segments, loading: loadingLeaks } = useLeakMonitor();
    const { alertas: predictiveAlerts } = usePredictiveBalance();

    const [appVersions, setAppVersions] = useState<AppVersionRow[]>([]);
    const [tomasVaradas, setTomasVaradas] = useState<VwAlertaTomaVaradaRow[]>([]);
    const [rawExtractionHistory, setRawExtractionHistory] = useState<{ fecha: string; total: number }[]>([]);
    /** Fuentes que fallaron al cargar — se informan en la tira de estado en lugar
     *  de dejar que la pantalla se vea completa cuando no lo está. */
    const [fuentesCaidas, setFuentesCaidas] = useState<string[]>([]);

    useEffect(() => {
        let cancelado = false;
        const fallos: string[] = [];

        const marcarFallo = (fuente: string, err: unknown) => {
            console.error(`[Dashboard] Error cargando ${fuente}:`, err);
            fallos.push(fuente);
        };

        const cargar = async () => {
            const [versionsRes, varadasRes, histRes] = await Promise.allSettled([
                supabase.from('app_versions').select('*'),
                supabase.from('vw_alertas_tomas_varadas').select('*'),
                (async () => {
                    // Ventana anclada a la FECHA SELECCIONADA, no a hoy: antes la
                    // gráfica mostraba los últimos 7 días reales aunque el resto
                    // de la pantalla estuviera en una fecha histórica.
                    const to = fechaSeleccionada || getTodayString();
                    const from = addDays(to, -6);
                    return supabase
                        .from('lecturas_presas')
                        .select('fecha, extraccion_total_m3s')
                        .gte('fecha', from)
                        .lte('fecha', to)
                        .order('fecha', { ascending: true });
                })(),
            ]);

            if (cancelado) return;

            if (versionsRes.status === 'fulfilled' && !versionsRes.value.error) {
                setAppVersions((versionsRes.value.data ?? []) as AppVersionRow[]);
            } else {
                marcarFallo('Versiones', versionsRes.status === 'rejected' ? versionsRes.reason : versionsRes.value.error);
            }

            if (varadasRes.status === 'fulfilled' && !varadasRes.value.error) {
                setTomasVaradas((varadasRes.value.data ?? []) as VwAlertaTomaVaradaRow[]);
            } else {
                marcarFallo('Tomas varadas', varadasRes.status === 'rejected' ? varadasRes.reason : varadasRes.value.error);
            }

            if (histRes.status === 'fulfilled' && !histRes.value.error) {
                const data = histRes.value.data ?? [];
                const byDate = new Map<string, number>();
                (data as { fecha: string; extraccion_total_m3s: number | null }[]).forEach(r => {
                    byDate.set(r.fecha, (byDate.get(r.fecha) || 0) + (r.extraccion_total_m3s || 0));
                });
                setRawExtractionHistory(
                    Array.from(byDate.entries()).map(([fecha, total]) => ({ fecha, total }))
                );
            } else {
                marcarFallo('Historial de extracción', histRes.status === 'rejected' ? histRes.reason : histRes.value.error);
            }

            setFuentesCaidas(fallos);
        };

        cargar();
        return () => { cancelado = true; };
    }, [fechaSeleccionada]);

    const loading = loadingModules || loadingPresas || loadingLeaks;

    // Reloj para interpolar volumen entregado. A 3 s re-renderizaba todo el árbol
    // (tarjetas, ambos gráficos de Recharts, lista de alertas) para animar un dígito
    // imperceptible — costo directo de batería en las tabletas de campo.
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!esHoy) return;            // en fechas históricas no hay nada que interpolar
        const interval = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(interval);
    }, [esHoy]);

    /* ── Aggregations ── */
    const totalDailyVol = useMemo(() => modules.reduce((acc, m) => {
        const mDailyVol = m.delivery_points.reduce((ptAcc, pt) => {
            const elapsedSeconds = pt.last_update_time ? Math.max(0, (now - new Date(pt.last_update_time).getTime()) / 1000) : 0;
            const cappedSeconds = Math.min(elapsedSeconds, 30 * 60);
            const interpolated = (esHoy && pt.current_q > 0) ? (pt.current_q * cappedSeconds) / 1000000 : 0;
            return ptAcc + (pt.daily_vol || 0) + interpolated;
        }, 0);
        return acc + mDailyVol;
    }, 0), [modules, now, esHoy]);

    const extractionTrend = useMemo(() => {
        if (rawExtractionHistory.length >= 2) {
            const last = rawExtractionHistory[rawExtractionHistory.length - 1].total;
            const prev = rawExtractionHistory[rawExtractionHistory.length - 2].total;
            if (prev > 0 && last > prev * 1.05) return 'rising';
            if (prev > 0 && last < prev * 0.95) return 'falling';
            return 'stable';
        }
        return totalExtraccion > 30 ? 'rising' : totalExtraccion > 0 ? 'stable' : 'falling';
    }, [rawExtractionHistory, totalExtraccion]);

    /* Entrega a módulos — volumen del día.
     * Antes: cualquier volumen > 0.001 era "Ascenso" y bastaba con que existiera
     * un módulo cargado para declarar "Estable", así que una entrega NULA en plena
     * operación se rotulaba como estable. Ahora el cero se trata como anomalía. */
    const deliveryState = useMemo(() => {
        const hayEntrega = totalDailyVol > 0.0001;

        if (!hayEntrega) {
            return {
                trend: undefined as 'rising' | 'falling' | 'stable' | undefined,
                severity: (modules.length > 0 ? 'warning' : 'normal') as KPISeverity,
                label: modules.length > 0 ? 'Sin registro de entrega' : 'Sin módulos cargados',
            };
        }

        const objetivo = modules.reduce((acc, m) => acc + (m.target_flow || 0), 0);
        // Volumen esperado a esta hora del día si se sostuviera el gasto objetivo.
        // Usa `now` (estado del reloj) en vez de Date.now() para que el cálculo
        // sea puro respecto al render y reactivo al tick.
        const fraccionDia = esHoy
            ? Math.min(Math.max((now - new Date(getStartOfDateISO(fechaSeleccionada)).getTime()) / 86400000, 0), 1)
            : 1;
        const esperado = (objetivo * 86400 * fraccionDia) / 1_000_000;

        if (esperado <= 0) return { trend: 'stable' as const, severity: 'normal' as KPISeverity, label: 'En operación' };

        const ratio = totalDailyVol / esperado;
        if (ratio > 1.1) return { trend: 'rising' as const, severity: 'warning' as KPISeverity, label: 'Sobre lo previsto' };
        if (ratio < 0.9) return { trend: 'falling' as const, severity: 'warning' as KPISeverity, label: 'Bajo lo previsto' };
        return { trend: 'stable' as const, severity: 'normal' as KPISeverity, label: 'Conforme a lo previsto' };
    }, [totalDailyVol, modules, esHoy, fechaSeleccionada, now]);

    /* ── Chart Data ── */
    const moduleChartData = useMemo(() =>
        modules.map(m => ({
            name: m.short_code || (m.name || '').substring(0, 10),
            full_name: m.name,
            vol: m.accumulated_vol,
            authorized: m.authorized_vol,
            // SIN truncar a 100: Math.min() aplanaba el sobregiro y dibujaba un
            // módulo al 145% igual que uno al 100%, ocultando visualmente la
            // condición que distribución necesita detectar.
            efficiency: (m.accumulated_vol / (m.authorized_vol || 1)) * 100,
            flow: m.current_flow * 1000
        })).sort((a, b) => b.efficiency - a.efficiency),
        [modules]
    );

    const damStorageData = useMemo(() =>
        presas.map(p => ({
            nombre: p.nombre_corto || p.nombre,
            actual: p.lectura?.almacenamiento_mm3 || 0,
            capacidad: p.capacidad_max_mm3,
            pct: ((p.lectura?.almacenamiento_mm3 || 0) / p.capacidad_max_mm3) * 100
        })),
        [presas]
    );

    /* Real extraction trend — 7-day historical from lecturas_presa */
    const extractionTrendData = useMemo(() => {
        if (rawExtractionHistory.length > 0) {
            return rawExtractionHistory.map(r => ({
                label: formatFechaCorta(r.fecha).slice(0, 6),
                extraccion: r.total
            }));
        }
        // Fallback: flat line with current value while data loads
        const base = totalExtraccion || 0;
        const labels = ['−6d', '−5d', '−4d', '−3d', '−2d', 'Ayer', 'Hoy'];
        return labels.map(label => ({ label, extraccion: base }));
    }, [rawExtractionHistory, totalExtraccion]);

    /* ── Alerts ── */
    const realAlerts: Alert[] = useMemo(() => {
        const alerts: Alert[] = [];

        // 1. Anomalías de continuidad (Tomas Varadas)
        tomasVaradas.forEach(tv => {
            alerts.push({
                id: `varada-${tv.punto_id}`,
                type: 'critical',
                title: 'Toma Varada (Falla de Continuidad)',
                message: `${tv.punto_nombre}: Estado "${tv.ultimo_estado}" hace ${tv.dias_varada} días. Se requiere intervención diagnóstica.`,
                timestamp: 'Crítico'
            });
        });

        // 2. Pérdidas Críticas / Fugas en Canales (Directiva 10%)
        //    Se exige pérdida MATERIAL, no solo eficiencia baja: un tramo con
        //    q_perdida = 0.00 no está perdiendo agua y anunciarlo como fuga
        //    genera alarmas falsas que entrenan al operador a ignorar el panel.
        segments.filter(s => (s.eficiencia_pct ?? 100) < 90).forEach(s => {
            const perdida = s.q_perdida ?? 0;
            const nombreTramo = nombrarTramo(s);
            const eficiencia = (s.eficiencia_pct ?? 0).toFixed(1);

            if (perdida >= UMBRAL_PERDIDA_M3S) {
                alerts.push({
                    id: `leak-${s.km_inicio}`,
                    type: 'critical',
                    title: 'Pérdida Crítica / Posible Fuga',
                    message: `${nombreTramo}: Eficiencia ${eficiencia}% — pérdida de ${perdida.toFixed(2)} m³/s. Requiere inspección.`,
                    timestamp: 'Ahora'
                });
            } else {
                // Eficiencia baja sin pérdida medible: informativo, no accionable.
                alerts.push({
                    id: `leak-info-${s.km_inicio}`,
                    type: 'info',
                    title: 'Eficiencia Baja sin Pérdida Medible',
                    message: `${nombreTramo}: Eficiencia ${eficiencia}% con pérdida ${perdida.toFixed(2)} m³/s (bajo umbral de ${UMBRAL_PERDIDA_M3S} m³/s). Posible error de aforo.`,
                    timestamp: 'Ahora'
                });
            }
        });

        // 3. Sobregiros en Módulos
        modules.forEach(m => {
            // Durante LLENADO, los gastos pueden ser erráticos o de purga, toleramos más (50%)
            const tolerance = activeEvent?.evento_tipo === 'LLENADO' ? 1.5 : 1.1;
            if (m.current_flow > m.target_flow * tolerance && m.target_flow > 0) {
                alerts.push({ 
                    id: `ovf-${m.id}`, 
                    type: 'warning', 
                    title: 'Sobregiro Detectado', 
                    message: `${m.name}: Gasto ${((m.current_flow ?? 0) * 1000).toFixed(0)} L/s excede autorizado (+${(((m.current_flow ?? 0)/(m.target_flow || 1) - 1)*100).toFixed(0)}%).`,
                    timestamp: 'Ahora' 
                });
            }
        });

        // 4. Estado de Presas — solo con nivel capturado. Sin lectura no se puede
        //    afirmar nada del embalse: alertar sobre `null` sería inventar el dato.
        presas.forEach(p => {
            const pct = porcentajeLlenadoPresa(p);
            if (pct == null) return;

            if (pct > 90) {
                alerts.push({ id: `dam-high-${p.id}`, type: 'warning' as const, title: 'Alto Nivel (NAMO)', message: `${p.nombre}: ${pct.toFixed(1)}% de llenado.`, timestamp: p.lectura?.fecha || 'Hoy' });
            }
            // Alerta de nivel bajo solo si NO estamos en protocolo de LLENADO (donde es sabido que estamos extrayendo)
            if (pct < 20 && activeEvent?.evento_tipo !== 'LLENADO') {
                alerts.push({ id: `dam-low-${p.id}`, type: 'critical' as const, title: 'Almacenamiento Crítico', message: `${p.nombre}: Nivel por debajo del 20% (${pct.toFixed(1)}%).`, timestamp: p.lectura?.fecha || 'Hoy' });
            }
        });

        // 4b. Protocolo hidráulico abierto por tiempo prolongado.
        //     Un protocolo activo gobierna umbrales y (antes del fix de Capa 3)
        //     podía congelar el gasto mostrado. Si lleva semanas abierto casi
        //     siempre significa que nadie lo cerró, no que siga vigente.
        if (activeEvent?.fecha_inicio) {
            const diasAbierto = Math.floor((now - new Date(activeEvent.fecha_inicio).getTime()) / 86400000);
            if (diasAbierto > UMBRAL_DIAS_PROTOCOLO) {
                alerts.push({
                    id: `proto-stale-${activeEvent.id}`,
                    type: 'warning',
                    title: 'Protocolo Abierto Prolongado',
                    message: `${activeEvent.evento_tipo} activo desde hace ${diasAbierto} días. Verificar si sigue vigente o debe cerrarse.`,
                    timestamp: activeEvent.fecha_inicio.slice(0, 10),
                });
            }
        }

        // 5. Alertas predictivas (balance hídrico proyectado)
        // Deduplicar: si ya existe una alerta de fuga real para el mismo tramo,
        // la predictiva no aporta información nueva → omitirla.
        for (const pa of predictiveAlerts) {
            const yaExiste = alerts.some(a => a.id.replace('pred-fuga-', 'leak-') === pa.id.replace('pred-fuga-', 'leak-'));
            if (!yaExiste) alerts.push(pa);
        }

        if (alerts.length === 0) {
            alerts.push({ id: 'ok', type: 'info', title: 'Sistema Estable', message: 'Operando dentro de parámetros normales.', timestamp: 'Ahora' });
        }

        // Críticas primero: el orden del panel debe seguir la severidad, no el
        // orden en que se generaron las alertas.
        const peso = { critical: 0, warning: 1, info: 2 } as const;
        return alerts.sort((a, b) => (peso[a.type] ?? 3) - (peso[b.type] ?? 3));
    }, [modules, presas, tomasVaradas, segments, activeEvent, predictiveAlerts, now]);

    /* Cuenta accionable: las informativas no deben inflar el KPI de alertas. */
    const alertasAccionables = useMemo(
        () => realAlerts.filter(a => a.type === 'critical' || a.type === 'warning').length,
        [realAlerts]
    );
    const alertasInformativas = realAlerts.length - alertasAccionables;
    const hayCriticas = useMemo(() => realAlerts.some(a => a.type === 'critical'), [realAlerts]);

    /* Serie para el sparkline de extracción (7 días). */
    const sparkExtraccion = useMemo(
        () => rawExtractionHistory.map(r => r.total),
        [rawExtractionHistory]
    );

    /* Días que lleva abierto el protocolo activo. */
    const diasProtocolo = useMemo(() => {
        if (!activeEvent?.fecha_inicio) return null;
        return Math.floor((now - new Date(activeEvent.fecha_inicio).getTime()) / 86400000);
    }, [activeEvent, now]);

    if (loading && presas.length === 0) {
        return (
            <div className="dashboard-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando Centro de Control...</span>
                </div>
            </div>
        );
    }

    /* ── Tooltip renderers ── */
    /* ──────────── RENDER ──────────────────────────────────────── */
    return (
        <div className="dashboard-container" style={{ marginTop: '-24px' }}>

            {/* Header — identidad comprimida a una barra delgada.
                El bloque institucional completo se reserva para la vista de
                impresión (.print-only), donde la identidad sí es el propósito.
                En consola operativa ese espacio informa estado del sistema. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div className="dash-identity">
                    <img src="/logos/logo-srl.png" alt="SRL Unidad Conchos" className="dash-identity-logo" />
                    <span className="dash-identity-name">Unidad Conchos</span>
                    <span className="dash-identity-sep">·</span>
                    <span className="dash-identity-sub">S. de R.L. de I.P. y C.V.</span>
                </div>

                {/* Bloque institucional completo — solo al imprimir */}
                <div className="print-only dash-print-header">
                    <img src="/logos/logo-srl.png" alt="SRL Unidad Conchos" style={{ height: '64px', width: 'auto', objectFit: 'contain' }} />
                    <div>
                        <h3>Sociedad de Asociaciones de Usuarios</h3>
                        <h1>Unidad Conchos</h1>
                        <h4>S. de R.L. de I.P. y C.V.</h4>
                    </div>
                </div>

                <header className="dashboard-header" style={{ marginBottom: '8px' }}>
                    <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Centro de Control</h2>
                        <p className="text-slate-400 text-sm font-medium">
                            Distrito de Riego 005 Delicias — {esHoy ? 'Hoy' : formatFechaCorta(fechaSeleccionada)}
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <button
                            className="btn-premium btn-premium-glass"
                            onClick={() => window.open('/monitor-publico', '_blank')}
                        >
                            <Activity size={16} />
                            Monitor Público
                        </button>
                        <button
                            className="btn-premium btn-premium-solid"
                            onClick={() => window.print()}
                        >
                            <Droplets size={16} />
                            Generar Reporte Digital
                        </button>
                    </div>
                </header>

                {/* ── Tira de estado operativo ──────────────────────────────
                    El protocolo activo ya se consultaba y modulaba los umbrales
                    de alerta, pero nunca se mostraba: el operador no sabía que
                    estaba en LLENADO cuando eso cambia lo que está viendo.

                    Los chips se arman en un array con severidad explícita y se
                    ordenan crítico → alerta → informativo → ok antes de pintarse:
                    antes el orden fijo del JSX podía dejar "125 d abierto" (que
                    ya dispara alerta interna) al mismo nivel visual que la hora
                    de la última lectura. */}
                {(() => {
                    const PESO_CHIP = { crit: 0, warn: 1, info: 2, ok: 3 } as const;
                    const chips: { key: string; sev: keyof typeof PESO_CHIP; icon: React.ReactNode; content: React.ReactNode }[] = [];

                    if (activeEvent) {
                        const protocoloVencido = (diasProtocolo ?? 0) > UMBRAL_DIAS_PROTOCOLO;
                        chips.push({
                            key: 'protocolo',
                            sev: protocoloVencido ? 'crit' : 'info',
                            icon: <Radio size={12} />,
                            content: (
                                <>
                                    Protocolo <b>{activeEvent.evento_tipo}</b>
                                    {activeEvent.gasto_solicitado_m3s ? ` · ${activeEvent.gasto_solicitado_m3s} m³/s solicitados` : ''}
                                    {diasProtocolo != null ? ` · ${diasProtocolo} d abierto` : ''}
                                    {protocoloVencido ? ' — revisar cierre' : ''}
                                </>
                            ),
                        });
                    } else {
                        chips.push({ key: 'protocolo', sev: 'ok', icon: <Radio size={12} />, content: 'Sin protocolo activo' });
                    }

                    if (almacenamiento.parcial) {
                        // Cobertura de datos en cero (nadie capturó nivel) es más grave que
                        // un dato presente pero con antigüedad — antes ambos casos usaban
                        // el mismo chip-warn y se veían igual de urgentes.
                        chips.push({
                            key: 'nivel-presa',
                            sev: almacenamiento.presasConDato === 0 ? 'crit' : 'warn',
                            icon: <Database size={12} />,
                            content: `Nivel de presa: ${almacenamiento.presasConDato} de ${almacenamiento.presasTotal} con lectura`,
                        });
                    }

                    if (fuentesCaidas.length > 0) {
                        chips.push({
                            key: 'fuentes-caidas',
                            sev: 'crit',
                            icon: <AlertTriangle size={12} />,
                            content: `Sin respuesta: ${fuentesCaidas.join(', ')}`,
                        });
                    }

                    if (frescuraLectura) {
                        chips.push({
                            key: 'frescura',
                            sev: frescuraLectura.stale ? 'warn' : 'ok',
                            icon: <Clock size={12} />,
                            content: frescuraLectura.texto,
                        });
                    }

                    chips.sort((a, b) => PESO_CHIP[a.sev] - PESO_CHIP[b.sev]);
                    const claseSev = { crit: 'chip-crit', warn: 'chip-warn', info: 'chip-info', ok: 'chip-ok' } as const;

                    return (
                        <div className="dash-statusbar">
                            {chips.map(c => (
                                <span key={c.key} className={clsx('dash-chip', claseSev[c.sev], c.sev === 'crit' && 'chip-crit-loud')}>
                                    {c.icon} {c.content}
                                </span>
                            ))}
                        </div>
                    );
                })()}
            </div>



            {/* KPI Section */}
            <section className="dashboard-grid-kpi">
                <KPICard
                    title="Almacenamiento Total"
                    // null → "S/D". Antes `|| 0` mostraba 0.0% cuando simplemente
                    // no había nivel capturado, junto a una extracción activa.
                    value={porcentajeLlenado != null ? `${porcentajeLlenado.toFixed(1)}%` : null}
                    subtext={
                        totalAlmacenamiento != null
                            ? `${totalAlmacenamiento.toFixed(1)} / ${almacenamiento.capacidadContabilizadaMm3.toFixed(0)} Mm³`
                            : undefined
                    }
                    noDataReason={`Sin lectura de nivel · capacidad instalada ${totalCapacidad.toFixed(0)} Mm³`}
                    icon={Waves}
                    color="cyan"
                    severity={porcentajeLlenado != null && porcentajeLlenado < 20 ? 'critical' : 'normal'}
                    freshness={frescuraLectura?.texto}
                    freshnessStale={frescuraLectura?.stale}
                    className="shadow-cyan-900/10"
                />
                <KPICard
                    title="Extracción Total (Presas)"
                    value={(totalExtraccion ?? 0).toFixed(1)}
                    unit="m³/s"
                    subtext={`Volumen inyectado: ${(totalVolumenExtraidoMm3 ?? 0).toFixed(3)} Mm³`}
                    icon={Droplets}
                    color="blue"
                    trend={extractionTrend as 'rising' | 'falling' | 'stable'}
                    sparkline={sparkExtraccion}
                    freshness={frescuraLectura?.texto}
                    freshnessStale={frescuraLectura?.stale}
                    className="shadow-blue-900/10"
                />
                <KPICard
                    title="Entrega a Módulos"
                    // Miles de m³ en vez de 4 decimales en Mm³: "0.0000" no comunica nada.
                    value={(totalDailyVol * 1000).toFixed(1)}
                    unit="miles m³"
                    subtext={`${totalDailyVol.toFixed(3)} Mm³ · ${deliveryState.label}`}
                    icon={Activity}
                    color="emerald"
                    trend={deliveryState.trend}
                    trendLabel={deliveryState.label}
                    severity={deliveryState.severity}
                    // Entrega en cero con módulos activos es la anomalía más seria de
                    // esta fila de KPIs después de las alertas — la franja sola es sutil.
                    valueFlag={deliveryState.severity === 'warning' && totalDailyVol <= 0.0001}
                    className="shadow-emerald-900/10"
                />
                <KPICard
                    title="Alertas Activas"
                    value={alertasAccionables.toString()}
                    subtext={
                        alertasInformativas > 0
                            ? `${alertasAccionables} requieren atención · ${alertasInformativas} informativas`
                            : 'Atención Requerida'
                    }
                    icon={AlertTriangle}
                    color={hayCriticas ? 'rose' : alertasAccionables > 0 ? 'amber' : 'emerald'}
                    severity={hayCriticas ? 'critical' : alertasAccionables > 0 ? 'warning' : 'normal'}
                    className="shadow-rose-900/10"
                />
            </section>

            {/* Main Content Grid */}
            <section className="dashboard-grid-main">
                <div className="grid-col-left">

                    {/* Presa Cards */}
                    <div className="card presa-status-card">
                        <div className="presa-header flex justify-between items-center mb-2">
                            <h3 className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>Estado de Fuentes (Presas)</h3>
                            {frescuraLectura && (
                                <span className={clsx(
                                    'text-xs font-mono px-2 py-1 rounded border',
                                    frescuraLectura.stale
                                        ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                                        : 'text-slate-500 bg-slate-800/50 border-slate-700'
                                )}>
                                    {frescuraLectura.texto}
                                </span>
                            )}
                        </div>

                        <div className="space-y-4">
                            {presas.map(presa => {
                                const lect = presa.lectura;
                                // `null` = sin lectura capturada; NO se colapsa a 0.
                                const almacPresa = lect?.almacenamiento_mm3 ?? null;
                                const pctLlenado = porcentajeLlenadoPresa(presa);
                                const extraccion = lect?.extraccion_total_m3s || 0;
                                const elevacion = lect?.escala_msnm ?? null;

                                return (
                                    <div key={presa.id} className="presa-item group">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                {/* Mini donut per presa */}
                                                <DonutRing
                                                    pct={pctLlenado}
                                                    label="Llenado"
                                                    color={(pctLlenado ?? 0) > 90 ? '#fbbf24' : '#60a5fa'}
                                                    size={80}
                                                />
                                                <div className="flex flex-col">
                                                    <h4 className="text-white font-bold text-base flex items-center gap-2">
                                                        {presa.nombre}
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">{presa.nombre_corto}</span>
                                                    </h4>
                                                    <span className="text-xs text-slate-400 mt-1">{presa.municipio}</span>
                                                </div>
                                            </div>
                                            <div className="text-right bg-blue-950/30 px-3 py-2 rounded-lg border border-blue-500/10">
                                                <div className="flex items-center justify-end gap-1 mb-1">
                                                    <span className="text-xs text-blue-300 uppercase font-bold tracking-wider">Extracción</span>
                                                    {extraccion > 0 ? <TrendingUp size={12} className="text-emerald-400" /> : <TrendingDown size={12} className="text-slate-500" />}
                                                </div>
                                                <span className="text-2xl font-mono font-bold text-blue-100">{(extraccion ?? 0).toFixed(1)} <span className="text-sm text-blue-400">m³/s</span></span>
                                            </div>
                                        </div>

                                        <div className="presa-stats">
                                            <div className="stat border-r border-slate-700/50">
                                                <span>Elevación Actual</span>
                                                <strong>
                                                    {elevacion != null
                                                        ? <>{elevacion.toFixed(2)} <small className="text-slate-500 text-[10px]">msnm</small></>
                                                        : <span className="text-slate-500">S/D</span>}
                                                </strong>
                                            </div>
                                            <div className="stat border-r border-slate-700/50">
                                                <span>Almacenamiento</span>
                                                <strong>
                                                    {almacPresa != null
                                                        ? <>{almacPresa.toFixed(1)} <small className="text-slate-500 text-[10px]">Mm³</small></>
                                                        : <span className="text-slate-500">S/D</span>}
                                                </strong>
                                            </div>
                                            <div className="stat">
                                                <span>% Llenado</span>
                                                <strong className={pctLlenado == null ? 'text-slate-500' : pctLlenado > 90 ? 'text-amber-400' : 'text-emerald-400'}>
                                                    {pctLlenado != null ? `${pctLlenado.toFixed(1)}%` : 'S/D'}
                                                </strong>
                                            </div>
                                        </div>

                                        <div className="presa-level mt-2">
                                            <div className="flex justify-between text-xxs text-slate-400 mb-1 font-mono">
                                                <span>NAMO ({(presa.capacidad_max_mm3 ?? 0).toFixed(0)} Mm³)</span>
                                                <span>
                                                    {almacPresa != null ? almacPresa.toFixed(1) : 'S/D'} / {(presa.capacidad_max_mm3 ?? 0).toFixed(0)} Mm³
                                                </span>
                                            </div>
                                            <div className="h-3 bg-slate-900/80 rounded-full overflow-hidden border border-slate-700/50 shadow-inner">
                                                {pctLlenado != null ? (
                                                    <div
                                                        className={`h-full relative overflow-hidden transition-all duration-1000 ease-out ${pctLlenado > 90 ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-blue-600 to-cyan-400'}`}
                                                        style={{ width: `${Math.min(pctLlenado, 100)}%` }}
                                                    >
                                                        <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                                                    </div>
                                                ) : (
                                                    // Sin lectura: barra rayada, nunca vacía-como-cero.
                                                    <div className="presa-level-sd" title="Sin lectura de nivel capturada" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Chart 1: Almacenamiento por Presa — Gradient BarChart ── */}
                    <ChartWidget
                        title="Almacenamiento por Presa"
                        subtitle="Comparativa Actual vs Capacidad NAMO · Mm³"
                        badge="LIVE"
                        infoBar={
                            <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'linear-gradient(135deg,#3b82f6,#06b6d4)' }} />
                                    Almacenamiento Actual
                                </div>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'rgba(99,179,237,0.2)', border: '1px dashed #60a5fa' }} />
                                    Capacidad NAMO
                                </div>
                            </div>
                        }
                    >
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart
                                data={damStorageData}
                                margin={{ top: 16, right: 16, left: 0, bottom: 0 }}
                                barGap={4}
                            >
                                <defs>
                                    <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.8} />
                                    </linearGradient>
                                    <linearGradient id="gradCapacidad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18} />
                                        <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.08} />
                                    </linearGradient>
                                    <linearGradient id="gradAmber" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={1} />
                                        <stop offset="100%" stopColor="#d97706" stopOpacity={0.8} />
                                    </linearGradient>
                                    <filter id="glow-bar">
                                        <feGaussianBlur stdDeviation="3" result="blur" />
                                        {/* SICA DR-005 Conchos Digital • v2.5.3-hydrasync */}
                                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                    </filter>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.04)" />
                                <XAxis dataKey="nombre" tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                                <Tooltip content={<StorageTooltip />} cursor={{ fill: 'rgba(96,165,250,0.04)', radius: 6 } as any} />
                                <Bar dataKey="capacidad" name="Capacidad NAMO" fill="url(#gradCapacidad)" radius={[6, 6, 0, 0]} stroke="rgba(96,165,250,0.18)" strokeWidth={1} />
                                <Bar dataKey="actual" name="Actual" fill="url(#gradActual)" radius={[6, 6, 0, 0]}
                                    style={{ filter: 'drop-shadow(0 0 6px rgba(96,165,250,0.5))' }}>
                                    {damStorageData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.pct > 90 ? 'url(#gradAmber)' : 'url(#gradActual)'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartWidget>

                    {/* ── Chart 2: Tendencia de Extracción — Glowing AreaChart ── */}
                    <ChartWidget
                        title="Tendencia de Extracción"
                        subtitle={rawExtractionHistory.length > 0 ? 'Datos históricos reales · m³/s' : 'Cargando datos históricos · m³/s'}
                        badge="7d"
                        infoBar={
                            <div style={{ display: 'flex', gap: '1.5rem', width: '100%', justifyContent: 'center' }}>
                                <div className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: 'linear-gradient(135deg,#a78bfa,#60a5fa)' }} />
                                    Extracción combinada presas
                                </div>
                            </div>
                        }
                    >
                        <ResponsiveContainer width="100%" height={180}>
                            <AreaChart data={extractionTrendData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradExtraccion" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                                        <stop offset="60%" stopColor="#60a5fa" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.01} />
                                    </linearGradient>
                                    <filter id="glow-line">
                                        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                                        <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                        </feMerge>
                                    </filter>
                                </defs>
                                <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="rgba(255,255,255,0.04)" />
                                <XAxis dataKey="label" tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                                <Tooltip content={<ExtraccionTooltip />} cursor={{ stroke: 'rgba(167,139,250,0.3)', strokeWidth: 1, strokeDasharray: '4 2' }} />
                                <Area
                                    type="monotone"
                                    dataKey="extraccion"
                                    name="Extracción"
                                    stroke="#a78bfa"
                                    strokeWidth={2.5}
                                    fill="url(#gradExtraccion)"
                                    dot={{ fill: '#a78bfa', r: 4, strokeWidth: 2, stroke: '#1e1b4b' }}
                                    activeDot={{ r: 7, fill: '#a78bfa', stroke: '#fff', strokeWidth: 2, style: { filter: 'drop-shadow(0 0 8px #a78bfa)' } }}
                                    style={{ filter: 'drop-shadow(0 0 4px rgba(167,139,250,0.6))' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartWidget>
                </div>

                <div className="grid-col-right space-y-4">
                    <AlertList alerts={realAlerts} />

                    {/* ── Balance Hídrico Global — el resumen más denso de la pantalla
                        (presas + canal + módulos en 3 números) se sube al tope de la
                        columna y sus anillos crecen de 85px a 130px: antes vivía al
                        fondo, del mismo tamaño que el ícono de versión de app. */}
                    <div className="card" style={{ background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)' }}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                                <Database size={18} className="text-violet-400" />
                            </div>
                            <h3 className="font-bold text-white tracking-wide">Balance Hídrico Global</h3>
                        </div>

                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-around',
                            alignItems: 'center',
                            padding: '0.5rem 0'
                        }}>
                            <DonutRing pct={porcentajeLlenado} label="ALMAC." color="#38bdf8" size={130} />
                            <DonutRing
                                // Normalizado contra la capacidad de conducción del canal,
                                // no contra una constante sin unidad ni origen.
                                pct={totalExtraccion > 0 ? (totalExtraccion / CAPACIDAD_CONDUCCION_M3S) * 100 : 0}
                                label={`DE ${CAPACIDAD_CONDUCCION_M3S} m³/s`}
                                color="#a78bfa"
                                size={130}
                            />
                            <DonutRing
                                pct={moduleChartData.length > 0 ? moduleChartData.reduce((a, m) => a + m.efficiency, 0) / moduleChartData.length : 0}
                                label="EFICIEN."
                                color="#10b981"
                                size={130}
                            />
                        </div>
                    </div>

                    {/* ── Chart 3: Cumplimiento Módulos — Modern Lollipop Bars ── */}
                    <div className="card h-full flex flex-col">
                        <div className="flex items-center justify-between gap-2 mb-4">
                            <div className="flex items-center gap-2">
                                <Activity size={18} className="text-blue-400 shadow-blue-500/50 drop-shadow-sm" />
                                <h3 className="font-bold text-white">Cumplimiento Módulos</h3>
                            </div>
                            {/* Cuenta real — antes decía "TOP 8" pero se renderizan todos */}
                            <span className="chart-badge">{moduleChartData.length} MÓDULOS</span>
                        </div>

                        {/* Legend */}
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '12px', flexWrap: 'wrap' }}>
                            {[
                                { color: 'linear-gradient(90deg,#10b981,#34d399)', label: '< 60%' },
                                { color: 'linear-gradient(90deg,#3b82f6,#06b6d4)', label: '60-89%' },
                                { color: 'linear-gradient(90deg,#f43f5e,#fb923c)', label: '90-100%' },
                                { color: 'linear-gradient(90deg,#dc2626,#f43f5e)', label: '> 100% sobregiro' },
                            ].map(l => (
                                <div key={l.label} className="chart-legend-item">
                                    <div className="chart-legend-dot" style={{ background: l.color }} />
                                    {l.label}
                                </div>
                            ))}
                        </div>

                        <div className="flex-1" style={{ 
                            maxHeight: '260px', 
                            overflowY: 'auto', 
                            paddingRight: '4px',
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(56, 189, 248, 0.3) transparent'
                        }}>
                            {loadingModules ? (
                                <div className="flex items-center justify-center h-full text-slate-500 animate-pulse">Cargando datos...</div>
                            ) : moduleChartData.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {moduleChartData.map((entry, i) => (
                                        <ModuleBar key={entry.name} name={entry.name} pct={entry.efficiency} rank={i + 1} vol={entry.vol} />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">Sin datos operativos</div>
                            )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-700/30">
                            <button
                                onClick={() => navigate('/balance')}
                                className="w-full py-2.5 text-xs font-bold text-blue-300 bg-blue-500/10 rounded-lg hover:bg-blue-500/20 transition-all hover:scale-[1.02] flex items-center justify-center gap-2 border border-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                            >
                                Ver Balance Hidráulico <ArrowRight size={14} />
                            </button>
                        </div>
                    </div>

                    {/* ── Version Control — información de mantenimiento, no operativa;
                        se queda al fondo de la columna, separada del resumen hídrico. ── */}
                    <div className="card" style={{ background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.5) 0%, rgba(15, 23, 42, 0.8) 100%)' }}>
                        <div className="pt-2">
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldCheck size={14} className="text-emerald-400" />
                                <span className="text-[0.6rem] font-black text-slate-500 uppercase tracking-[0.2em]">SICA Source of Truth</span>
                            </div>
                            <div className="space-y-2">
                                {appVersions.map(v => (
                                    <div key={v.id} className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors group">
                                        <div className="flex items-center gap-3">
                                            <div className="p-1 px-2 rounded-lg bg-slate-800 border border-slate-700 group-hover:border-blue-500/30 transition-colors flex items-center gap-2">
                                                {v.app_id === 'capture' ? <Smartphone size={11} className="text-slate-400" /> : <MonitorIcon size={11} className="text-slate-400" />}
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-tight">{v.app_id.replace('-', ' ')}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">v{v.version}</span>
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                <p className="text-[9px] text-amber-500/60 leading-tight italic font-medium">
                                    Seguridad Activa: Dispositivos obsoletos son bloqueados por el núcleo SICA.
                                </p>
                            </div>
                            <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">SICA DR-005 Conchos Digital • v{__V2_APP_VERSION__} • {__V2_BUILD_HASH__} • {new Date().toISOString().slice(0, 16).replace('T', ' ')}</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500/50"></div>
                                    <span className="text-[8px] font-bold text-slate-600 uppercase">Operational Nucleus</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Dashboard;
