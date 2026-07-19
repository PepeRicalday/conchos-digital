import {
    Cloud, CloudRain, Sun, Wind, Droplets, Thermometer, AlertTriangle,
    TrendingDown, MapPin, RefreshCw,
    Leaf, Zap, Activity, Loader
} from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Legend, LabelList
} from 'recharts';
import './Clima.css';
import { useFecha } from '../context/FechaContext';
import { usePresas, type ClimaPresaData } from '../hooks/usePresas';
import { useClimaEstaciones, type EstacionConLectura, type LecturaClima } from '../hooks/useClimaEstaciones';
import { exportClimaReport } from '../utils/exportClimaReport';
import { exportClimaInfografia, agrupaPorDia, type DiaHistorico } from '../utils/exportClimaInfografia';
import { supabase } from '../lib/supabase';
import { formateaEdad, clasificaCielo, PROCEDENCIA_LABEL } from '../utils/cielo';
import { Download, Gauge } from 'lucide-react';
import { useMemo } from 'react';
import { calculaIndices, entradasDesdeEstaciones, type Indice } from '../utils/indicesAgro';

// Types for display
interface WeatherCondition {
    variable: string;
    current: string;
    forecast: string;
    impact: string;
    icon: React.ReactNode;
    status: 'normal' | 'warning' | 'alert';
}

interface TechnicalVariable {
    name: string;
    value: string;
    unit: string;
    description: string;
    icon: React.ReactNode;
}

// Build weather conditions from Supabase data
function buildConditions(climaRecords: ClimaPresaData[]): WeatherCondition[] {
    if (climaRecords.length === 0) return [];

    // Use first record as primary, compare with second if available
    const primary = climaRecords[0];
    const secondary = climaRecords.length > 1 ? climaRecords[1] : null;

    const conditions: WeatherCondition[] = [];

    if (primary.temp_maxima_c != null) {
        const tempMax = Number(primary.temp_maxima_c);
        conditions.push({
            variable: 'Temperatura Máxima',
            current: `${tempMax}°C`,
            forecast: secondary?.temp_maxima_c != null ? `${secondary.temp_maxima_c}°C` : '—',
            impact: tempMax > 35 ? 'Estrés térmico alto en cultivos' : 'Define el estrés térmico del cultivo',
            icon: <Thermometer size={18} />,
            status: tempMax > 38 ? 'alert' : tempMax > 35 ? 'warning' : 'normal'
        });
    }

    if (primary.temp_minima_c != null) {
        const tempMin = Number(primary.temp_minima_c);
        conditions.push({
            variable: 'Temperatura Mínima',
            current: `${tempMin}°C`,
            forecast: secondary?.temp_minima_c != null ? `${secondary.temp_minima_c}°C` : '—',
            impact: tempMin < 5 ? '⚠️ Riesgo de heladas en frutales' : 'Sin riesgo de heladas',
            icon: <Thermometer size={18} />,
            status: tempMin < 0 ? 'alert' : tempMin < 5 ? 'warning' : 'normal'
        });
    }

    if (primary.evaporacion_mm != null) {
        conditions.push({
            variable: 'Evaporación',
            current: `${primary.evaporacion_mm} mm`,
            forecast: secondary?.evaporacion_mm != null ? `${secondary.evaporacion_mm} mm` : '—',
            impact: 'Pérdida de agua en vasos y canales',
            icon: <Droplets size={18} />,
            status: 'normal'
        });
    }

    if (primary.dir_viento) {
        conditions.push({
            variable: 'Viento',
            current: `${primary.dir_viento} — Int: ${primary.intensidad_viento ?? 0}`,
            forecast: primary.dir_viento_24h ? `${primary.dir_viento_24h} — Int: ${primary.intensidad_24h ?? 0}` : '—',
            impact: 'Afecta la uniformidad del riego por aspersión',
            icon: <Wind size={18} />,
            status: Number(primary.intensidad_viento ?? 0) > 3 ? 'warning' : 'normal'
        });
    }

    if (primary.precipitacion_mm != null) {
        const precip = primary.precipitacion_mm;
        conditions.push({
            variable: 'Precipitación',
            current: `${precip} mm`,
            forecast: secondary?.precipitacion_mm != null ? `${secondary.precipitacion_mm} mm` : '—',
            impact: precip > 10 ? 'Posible suspensión de riegos' : 'Sin impacto en operación',
            icon: <Droplets size={18} />,
            status: precip > 20 ? 'alert' : precip > 10 ? 'warning' : 'normal'
        });
    }

    if (primary.edo_tiempo) {
        conditions.push({
            variable: 'Estado del Tiempo',
            current: primary.edo_tiempo,
            forecast: primary.edo_tiempo_24h || '—',
            impact: 'Condiciones generales de operación',
            icon: <Cloud size={18} />,
            status: 'normal'
        });
    }

    if (primary.visibilidad != null) {
        conditions.push({
            variable: 'Visibilidad',
            current: `${primary.visibilidad} km`,
            forecast: '—',
            impact: 'Capacidad de supervisión en campo',
            icon: <Sun size={18} />,
            status: Number(primary.visibilidad ?? 99) < 5 ? 'warning' : 'normal'
        });
    }

    return conditions;
}

// Component: Condition Row
const ConditionRow = ({ condition }: { condition: WeatherCondition }) => (
    <tr className={`condition-row ${condition.status}`}>
        <td className="var-cell">
            <div className="var-icon">{condition.icon}</div>
            <span>{condition.variable}</span>
        </td>
        <td className="value-cell current">{condition.current}</td>
        <td className="value-cell forecast">{condition.forecast}</td>
        <td className="impact-cell">{condition.impact}</td>
    </tr>
);

// Component: Technical Variable Card
const TechVarCard = ({ variable }: { variable: TechnicalVariable }) => (
    <div className="tech-var-card">
        <div className="tech-icon">{variable.icon}</div>
        <div className="tech-content">
            <span className="tech-name">{variable.name}</span>
            <div className="tech-value-row">
                <span className="tech-value">{variable.value}</span>
                <span className="tech-unit">{variable.unit}</span>
            </div>
            <span className="tech-desc">{variable.description}</span>
        </div>
    </div>
);

// ── Tarjeta de estación WeatherLink en tiempo real ──────────────────────────
const rolLabel = (rol: string) =>
    rol === 'presa' ? 'Presa' : rol === 'modulo' ? 'Módulo' : 'Canal';

/**
 * Medidor de índice agroclimático (0-100) para el tablero ejecutivo.
 * Muestra SIEMPRE la implicación operativa junto al número: un valor sin
 * consecuencia obliga al lector a conocer de memoria la escala del indicador.
 * Sin dato se rotula «S/D», nunca 0 — un cero se leería como "riesgo nulo".
 */
const IndiceRing = ({ ind }: { ind: Indice }) => {
    const r = 32, circ = 2 * Math.PI * r;
    const pct = ind.valor ?? 0;
    return (
        <div className="idx-card" title={`${ind.formula}\nProcedencia: ${ind.procedencia}`}>
            <div className="idx-clave">{ind.clave === 'ICA' ? 'ICA-005' : ind.clave}</div>
            <div className="idx-nombre">{ind.nombre}</div>
            <svg viewBox="0 0 84 84" className="idx-svg" role="img"
                 aria-label={`${ind.clave}: ${ind.valor ?? 'sin dato'} de 100`}>
                <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="8" />
                {ind.valor != null && (
                    <circle cx="42" cy="42" r={r} fill="none" stroke={ind.color} strokeWidth="8"
                            strokeLinecap="round" transform="rotate(-90 42 42)"
                            strokeDasharray={`${(circ * pct / 100).toFixed(1)} ${circ.toFixed(1)}`} />
                )}
                {ind.valor != null ? (
                    <>
                        <text x="42" y="46" textAnchor="middle" className="idx-num">{ind.valor}</text>
                        <text x="42" y="59" textAnchor="middle" className="idx-den">/100</text>
                    </>
                ) : (
                    <text x="42" y="48" textAnchor="middle" className="idx-sd">S/D</text>
                )}
            </svg>
            <div className="idx-etq" style={{ color: ind.color }}>{ind.etiqueta}</div>
            <div className="idx-imp">{ind.implicacion}</div>
        </div>
    );
};

const EstacionCard = ({ est }: { est: EstacionConLectura }) => {
    const l = est.lectura;
    const q = est.calidad;
    const c = est.cielo;
    const fc = est.pronostico;
    return (
        <div className={`estacion-card ${est.enLinea ? 'online' : 'offline'}`}>
            <div className="estacion-head">
                <div className="estacion-title">
                    <MapPin size={14} />
                    <span>{est.nombre}</span>
                    <em className="estacion-rol">{rolLabel(est.rol)}</em>
                </div>
                {/* Calidad + edad del dato: ningún valor se presenta como "actual" sin ellas. */}
                <span className="estacion-status" style={{ color: q.color }} title={q.flags.join(', ') || 'sin banderas'}>
                    ● {q.etiqueta} · {formateaEdad(q.edadMin)}
                </span>
            </div>

            {/* Condición del cielo: variable propia, separada de la lluvia.
                Sin fuente de nubosidad se muestra "no determinado", sin icono solar. */}
            <div className="estacion-cielo" style={{ borderColor: c.color }}>
                <span className="cielo-estado" style={{ color: c.color }}>
                    {c.icono && <span className="cielo-icono">{c.icono}</span>}
                    {c.etiqueta}
                    {c.coberturaPct != null && <b> · {c.coberturaPct}%</b>}
                </span>
                <span className="cielo-meta">
                    <em className={`proc proc-${c.procedencia}`}>{PROCEDENCIA_LABEL[c.procedencia]}</em>
                    {c.procedencia !== 'ninguna' && <span>confianza {c.confianzaEtiqueta.toLowerCase()}</span>}
                </span>
            </div>

            {l ? (
                <div className="estacion-grid">
                    <div className="est-var"><Thermometer size={13} /><b>{l.temp_c != null ? l.temp_c.toFixed(1) : '—'}</b><small>°C</small></div>
                    <div className="est-var"><Droplets size={13} /><b>{l.hum_rel_pct != null ? Math.round(l.hum_rel_pct) : '—'}</b><small>% HR</small></div>
                    <div className="est-var"><Wind size={13} /><b>{l.viento_ms != null ? l.viento_ms.toFixed(1) : '—'}</b><small>m/s</small></div>
                    <div className="est-var"><CloudRain size={13} /><b>{l.lluvia_dia_mm != null ? l.lluvia_dia_mm.toFixed(1) : '—'}</b><small>mm día</small></div>
                    <div className="est-var accent"><Activity size={13} /><b>{l.eto_mm != null ? l.eto_mm.toFixed(2) : (l.et_dia_mm != null ? l.et_dia_mm.toFixed(2) : '—')}</b><small>ETₒ mm</small></div>
                    <div className="est-var"><Zap size={13} /><b>{l.gdd != null ? l.gdd.toFixed(0) : '—'}</b><small>GDD</small></div>
                </div>
            ) : (
                <div className="estacion-nodata">Aún sin lecturas registradas.</div>
            )}

            {/* Precipitación prevista: escala independiente de la nubosidad. */}
            {fc && (
                <div className="estacion-precip">
                    <Droplets size={12} />
                    <span>Lluvia prevista: <b>{fc.precip_prob_pct != null ? `${fc.precip_prob_pct}%` : '—'}</b>
                        {fc.precip_mm != null && fc.precip_mm > 0 && ` · ${fc.precip_mm.toFixed(1)} mm`}</span>
                </div>
            )}
        </div>
    );
};

// Main Component
const Clima = () => {
    const { fechaSeleccionada } = useFecha();
    const { clima, loading } = usePresas(fechaSeleccionada);
    const { estaciones, loading: loadingEst, refrescarAhora, refresco } = useClimaEstaciones();

    // Infografía: trae el historial de 7 días para el panel de tendencias. Si la
    // consulta falla se emite igual con historial vacío — ese panel se rotula
    // "sin datos suficientes" en vez de bloquear toda la descarga.
    const descargarInfografia = async () => {
        let historial: DiaHistorico[] = [];
        try {
            const ids = estaciones.map(e => e.id);
            if (ids.length) {
                const desde = new Date(Date.now() - 7 * 864e5).toISOString();
                const { data, error } = await supabase
                    .from('clima_estacion_lecturas')
                    .select('estacion_id, fecha, ts, temp_c, hum_rel_pct, viento_ms, eto_mm, et_dia_mm')
                    .in('estacion_id', ids)
                    .gte('ts', desde)
                    .order('ts', { ascending: true });
                if (error) throw error;
                historial = agrupaPorDia((data ?? []) as LecturaClima[]);
            }
        } catch (e) {
            console.warn('[Clima] historial 7 d no disponible para la infografía:', e);
        }
        await exportClimaInfografia(estaciones, historial);
    };

    // ── Tablero ejecutivo del distrito ──────────────────────────────────────
    // Los índices ICA-005/IDR/IRO/IHE existían solo en los informes descargados;
    // en pantalla el gerente tenía que derivar la lectura operativa de las
    // variables crudas. Se calculan con las MISMAS funciones auditadas que usan
    // los informes, para que pantalla y PDF nunca discrepen.
    const etoDiarioRed = useMemo(() => {
        const hoyLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
        const sumas = estaciones.map(e => e.pronosticoSerie
            .filter(p => p.fecha_local === hoyLocal && p.eto_fc_mm != null)
            .reduce((a, p) => a + (p.eto_fc_mm ?? 0), 0)).filter(v => v > 0);
        return sumas.length ? sumas.reduce((a, b) => a + b, 0) / sumas.length : null;
    }, [estaciones]);

    const indices = useMemo(
        () => (estaciones.length ? calculaIndices(entradasDesdeEstaciones(estaciones, etoDiarioRed)) : []),
        [estaciones, etoDiarioRed],
    );

    // Confianza del corte: frescura QA/QC + cobertura de red + pronóstico.
    // Un tablero de decisión debe declarar cuánto vale el dato que muestra.
    const confianza = useMemo(() => {
        if (!estaciones.length) return null;
        const frescas = estaciones.filter(e => e.calidad.usableComoActual).length;
        const enLinea = estaciones.filter(e => e.enLinea).length;
        const conFc = estaciones.filter(e => e.pronosticoSerie.length > 0).length;
        const n = estaciones.length;
        const pct = Math.round(100 * (0.5 * (frescas / n) + 0.3 * (enLinea / n) + 0.2 * (conFc / n)));
        const edades = estaciones.map(e => e.calidad.edadMin).filter((v): v is number => v != null);
        return {
            pct,
            etiqueta: pct >= 85 ? 'ALTA' : pct >= 60 ? 'MEDIA' : 'BAJA',
            color: pct >= 85 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444',
            detalle: `${frescas}/${n} con dato vigente · ${conFc}/${n} con pronóstico`
                + (edades.length ? ` · antigüedad máx. ${Math.max(...edades).toFixed(0)} min` : ''),
        };
    }, [estaciones]);

    // Build weather conditions from Supabase data
    const conditions = buildConditions(clima);

    // Build technical variables. Prioriza la ETₒ REAL de las estaciones WeatherLink
    // (FAO-56 Penman-Monteith); si no hay estaciones, cae a la aproximación previa.
    const techVars: TechnicalVariable[] = [];
    const estEnLinea = estaciones.filter(e => e.enLinea && e.lectura?.eto_mm != null);
    if (estEnLinea.length > 0) {
        const etoProm = estEnLinea.reduce((a, e) => a + (e.lectura!.eto_mm ?? 0), 0) / estEnLinea.length;
        techVars.push({
            name: 'Evapotranspiración (ETₒ)',
            value: etoProm.toFixed(2),
            unit: 'mm/día',
            description: `Real, promedio de ${estEnLinea.length} estación(es) — FAO-56 Penman-Monteith`,
            icon: <Activity size={18} />
        });
        const estGdd = estaciones.filter(e => e.lectura?.gdd != null);
        if (estGdd.length > 0) {
            const gddProm = estGdd.reduce((a, e) => a + (e.lectura!.gdd ?? 0), 0) / estGdd.length;
            techVars.push({
                name: 'Unidades Calor (GDD)',
                value: gddProm.toFixed(0),
                unit: '°C-día',
                description: 'Real de estación · base 10°C (nogal/alfalfa)',
                icon: <Zap size={18} />
            });
        }
    } else if (clima.length > 0) {
        const c = clima[0];
        if (c.evaporacion_mm != null) {
            const eto = (c.evaporacion_mm * 0.7).toFixed(1);
            techVars.push({
                name: 'Evapotranspiración (ETₒ)',
                value: eto,
                unit: 'mm/día',
                description: 'Estimada desde evaporación × 0.7 (sin estación en línea)',
                icon: <Activity size={18} />
            });
        }
        if (c.temp_maxima_c != null && c.temp_minima_c != null) {
            const gdd = Math.max(0, ((c.temp_maxima_c + c.temp_minima_c) / 2) - 10);
            techVars.push({
                name: 'Unidades Calor (GDD)',
                value: gdd.toFixed(0),
                unit: '°C-día',
                description: 'Base 10°C para nogal/alfalfa',
                icon: <Zap size={18} />
            });
        }
    }

    // Precipitación / evaporación de las DOS PRESAS del distrito, tomadas de sus
    // estaciones WeatherLink representativas (datos reales, no clima_presas):
    //   · Presa Boquilla       ← estación "Boquilla" (a ~3 km, rol presa)
    //   · Presa Fco. I. Madero ← estación "Las Vírgenes" (la más cercana, ~22 km)
    // La evaporación usa la ET de la estación (et_dia_mm), pérdida real medida.
    const estPorNombre = (n: string) => estaciones.find(e => e.nombre.toLowerCase().includes(n));
    const presaEstaciones = [
        { presa: 'Presa Boquilla', est: estPorNombre('boquilla') },
        { presa: 'Presa Fco. I. Madero', est: estPorNombre('vírgenes') ?? estPorNombre('virgenes') },
    ];
    const precipData = presaEstaciones
        .filter(x => x.est?.lectura)
        .map(x => ({
            station: x.presa,
            estacion: x.est!.nombre,
            precipitacion: +(x.est!.lectura!.lluvia_dia_mm ?? 0),
            evaporacion: +(x.est!.lectura!.et_dia_mm ?? 0),
            enLinea: x.est!.enLinea,
        }));

    // ── Condición del cielo del distrito ────────────────────────────────────
    // Se promedia SOLO entre estaciones con una fuente real de nubosidad. Si no
    // hay ninguna, cieloDistrito es null y la UI declara "NO DETERMINADO" en vez
    // de deducir el estado del cielo a partir de la precipitación.
    const estConCobertura = estaciones.filter(e => e.cielo.coberturaPct != null);
    const cobDistrito = estConCobertura.length
        ? estConCobertura.reduce((a, e) => a + (e.cielo.coberturaPct ?? 0), 0) / estConCobertura.length
        : null;
    const cieloDistrito = cobDistrito != null ? clasificaCielo(cobDistrito) : null;

    // Precipitación: escala independiente del cielo, observada y prevista.
    const lluviaObsTotal = estaciones.reduce((a, e) => a + (e.lectura?.lluvia_dia_mm ?? 0), 0);

    // Resumen de la red para la tarjeta de cabecera.
    const tempsRed = estaciones
        .map(e => e.lectura?.temp_max_c ?? e.lectura?.temp_c)
        .filter((v): v is number => v != null);
    const tempMaxRed = tempsRed.length ? Math.max(...tempsRed) : null;
    const etosRed = estaciones
        .map(e => e.lectura?.eto_mm ?? e.lectura?.et_dia_mm)
        .filter((v): v is number => v != null);
    const etoMedioRed = etosRed.length
        ? etosRed.reduce((a, b) => a + b, 0) / etosRed.length : null;
    const probsFc = estaciones
        .map(e => e.pronostico?.precip_prob_pct)
        .filter((v): v is number => v != null);
    const probMaxFc = probsFc.length ? Math.round(Math.max(...probsFc)) : null;

    // Irrigation alerts derived from real data
    // Alertas de riego desde la RED WEATHERLINK (fuente viva), no desde
    // clima_presas. La tabla legada trae `intensidad_viento` como CATEGORÍA de
    // texto ("Int > 3"), no como m/s: decidir la suspensión de aspersión con un
    // índice opaco, existiendo la medición real, es la misma clase de error ya
    // corregida en el resumen de red. Además, sin filas en clima_presas el panel
    // quedaba vacío aunque las 4 estaciones estuvieran reportando.
    const irrigationAlerts = [];
    {
        const conLect = estaciones.filter(e => e.lectura);
        const vientos = conLect.map(e => e.lectura!.viento_ms).filter((v): v is number => v != null);
        const vMax = vientos.length ? Math.max(...vientos) : null;
        const estVientoMax = vMax != null
            ? conLect.find(e => e.lectura!.viento_ms === vMax)?.nombre : null;
        const lluviaTot = conLect.reduce((a, e) => a + (e.lectura!.lluvia_dia_mm ?? 0), 0);
        const tMins = conLect.map(e => e.lectura!.temp_min_c).filter((v): v is number => v != null);
        const tMin = tMins.length ? Math.min(...tMins) : null;

        // Umbral 5 m/s: límite recomendado para aspersión (deriva y evaporación).
        if (vMax != null) {
            irrigationAlerts.push(vMax > 5
                ? { active: true, threshold: '> 5 m/s',
                    message: `Viento ${vMax.toFixed(1)} m/s${estVientoMax ? ` en ${estVientoMax}` : ''}: suspender riego por aspersión (deriva)` }
                : { active: false, threshold: '≤ 5 m/s',
                    message: `Viento ${vMax.toFixed(1)} m/s: riego por aspersión dentro de parámetros` });
        }
        if (lluviaTot > 10) {
            irrigationAlerts.push({
                active: true, threshold: '> 10 mm',
                message: `Precipitación ${lluviaTot.toFixed(1)} mm en la red: considerar cierre preventivo de tomas`,
            });
        }
        if (tMin != null && tMin < 5) {
            irrigationAlerts.push({
                active: true, threshold: '< 5 °C',
                message: `Temp. mínima ${tMin.toFixed(1)} °C: vigilar heladas en frutales`,
            });
        }
        // La demanda alta es una condición operativa, no una anomalía: se informa
        // para que el turno se dimensione, con la lámina bruta ya calculada.
        if (etoDiarioRed != null && etoDiarioRed >= 6) {
            irrigationAlerts.push({
                active: true, threshold: 'ETₒ ≥ 6 mm/día',
                message: `Demanda atmosférica alta (ETₒ ${etoDiarioRed.toFixed(2)} mm/día): reponer ≈ ${((etoDiarioRed * 0.85) / 0.7).toFixed(1)} mm/día; priorizar turnos nocturnos`,
            });
        }
    }
    // Dato vencido: se avisa explícitamente para que no se lea como "actual".
    const vencidas = estaciones.filter(e => e.calidad.status === 'expired');
    if (vencidas.length > 0) {
        irrigationAlerts.push({
            active: true,
            message: `${vencidas.length} estación(es) sin reportar hace más de 1 h (${vencidas.map(e => e.nombre).join(', ')}): no usar como lectura actual`,
            threshold: 'edad > 60 min',
        });
    }

    if (loading && clima.length === 0) {
        return (
            <div className="clima-container flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader size={32} className="animate-spin text-blue-400" />
                    <span className="text-sm font-medium">Cargando datos climatológicos...</span>
                </div>
            </div>
        );
    }

    const noData = clima.length === 0;

    return (
        <div className="clima-container">
            <header className="page-header">
                <div>
                    <h2 className="text-2xl font-bold text-white">Inteligencia Agroclimática</h2>
                    <p className="text-slate-400 text-sm">SICA-005 • Módulo Agro-SICA para el Distrito de Riego • {fechaSeleccionada}</p>
                </div>

                {/* Sync Status */}
                <div className="sync-status">
                    <RefreshCw size={14} className="sync-icon" />
                    <span>Fecha seleccionada: {fechaSeleccionada}</span>
                </div>
            </header>

            {/* Station Identification */}
            <section className="station-card">
                <div className="station-info">
                    <div className="station-icon">
                        <Cloud size={32} />
                    </div>
                    <div className="station-details">
                        <h3>Red de Estaciones Meteorológicas</h3>
                        <div className="station-meta">
                            {/* Cuenta la red WeatherLink real, no las presas: antes
                                mostraba "0 estaciones activas" con 4 en pantalla. */}
                            <span className="meta-item">
                                <Activity size={12} />
                                {estaciones.filter(e => e.calidad.usableComoActual).length} de {estaciones.length} con dato vigente
                            </span>
                            <span className="meta-item">
                                <Leaf size={12} />
                                SICA-005 / WeatherLink
                            </span>
                            {estaciones.length > 0 && (
                                <span className="meta-item">
                                    <MapPin size={12} />
                                    {estaciones.map(e => e.nombre).join(', ')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Resumen de la red. Toma los valores de las estaciones
                    WeatherLink —la fuente viva— y cae a clima_presas solo si
                    aún no hay lecturas; antes leía siempre de clima_presas y
                    mostraba guiones con las estaciones reportando. */}
                <div className="quick-stats">
                    <div className="quick-stat">
                        <span className="stat-label">Temp. Máx</span>
                        <span className="stat-value">
                            {tempMaxRed != null ? tempMaxRed.toFixed(1)
                                : clima[0]?.temp_maxima_c != null ? `${clima[0].temp_maxima_c}` : '—'} <small>°C</small>
                        </span>
                    </div>
                    <div className="quick-stat">
                        <span className="stat-label">Lluvia observada</span>
                        <span className="stat-value">
                            {lluviaObsTotal.toFixed(1)} <small>mm</small>
                        </span>
                    </div>
                    <div className="quick-stat">
                        <span className="stat-label">ETₒ acum. media</span>
                        <span className="stat-value">
                            {etoMedioRed != null ? etoMedioRed.toFixed(2) : '—'} <small>mm</small>
                        </span>
                    </div>
                </div>
            </section>

            {/* Tablero ejecutivo: los índices que resumen el estado operativo del
                distrito. Antes solo existían en los informes descargados. */}
            {indices.length > 0 && (
                <section className="card tablero-ejecutivo">
                    <div className="tablero-head">
                        <h3><Zap size={18} /> Tablero Ejecutivo del Distrito</h3>
                        {confianza && (
                            <span className="conf-chip" title={confianza.detalle}>
                                Confianza del dato
                                <b style={{ color: confianza.color }}>{confianza.etiqueta} · {confianza.pct}%</b>
                            </span>
                        )}
                    </div>
                    <div className="idx-row">
                        {indices.map(i => <IndiceRing key={i.clave} ind={i} />)}
                    </div>
                    {confianza && <p className="tablero-pie">{confianza.detalle}</p>}
                </section>
            )}

            {/* Condición del cielo del distrito — separada de la precipitación.
                Si ninguna estación tiene fuente de nubosidad, se declara NO
                DETERMINADO en vez de inferirlo de la lluvia observada. */}
            {estaciones.length > 0 && (
                <section className={`card cielo-panel ${cieloDistrito ? '' : 'sin-fuente'}`}>
                    <div className="cielo-panel-main">
                        <div className="cielo-panel-icono" style={{ color: cieloDistrito?.color ?? '#f59e0b' }}>
                            {cieloDistrito?.icono || <AlertTriangle size={30} />}
                        </div>
                        <div className="cielo-panel-txt">
                            <span className="cielo-panel-label">Condición del cielo · distrito</span>
                            <h3 style={{ color: cieloDistrito?.color ?? '#fbbf24' }}>
                                {cieloDistrito
                                    ? `${cieloDistrito.etiqueta} · ${cobDistrito!.toFixed(0)}% de cobertura`
                                    : 'NO DETERMINADO'}
                            </h3>
                            <p>
                                {cieloDistrito
                                    ? `Promedio de ${estConCobertura.length} estación(es) con fuente de nubosidad.`
                                    : 'Sin cobertura nubosa de modelo, satélite ni radiación utilizable. '
                                      + 'El estado del cielo no se infiere de la lluvia: 0 mm y 0 % de probabilidad son compatibles con cielo cubierto.'}
                            </p>
                        </div>
                    </div>
                    {/* Precipitación: tarjeta propia, escala independiente */}
                    <div className="cielo-panel-precip">
                        <span className="cielo-panel-label">Precipitación</span>
                        <div className="precip-linea">
                            <Droplets size={14} />
                            <span>Observada hoy <b>{lluviaObsTotal.toFixed(1)} mm</b></span>
                        </div>
                        <div className="precip-linea">
                            <CloudRain size={14} />
                            <span>Prevista {probMaxFc != null ? <b>{probMaxFc}%</b> : <em>sin pronóstico</em>}</span>
                        </div>
                    </div>
                </section>
            )}

            {/* Estaciones WeatherLink en tiempo real */}
            {estaciones.length > 0 && (
                <section className="card estaciones-section">
                    <div className="estaciones-header">
                        <h3><Activity size={18} /> Estaciones en tiempo real (WeatherLink / Davis)</h3>
                        <div className="estaciones-acciones">
                            {/* Refresco manual: fuerza el sync de estaciones y modelo antes de
                                emitir el informe, sin alterar los crones automáticos. */}
                            <button
                                className="estaciones-refresh"
                                onClick={() => { void refrescarAhora(); }}
                                disabled={refresco.activo}
                                title="Consulta ahora mismo las estaciones y el modelo de pronóstico, para emitir el informe con datos frescos"
                            >
                                <RefreshCw size={14} className={refresco.activo ? 'girando' : ''} />
                                {refresco.activo ? 'Actualizando…' : 'Actualizar datos'}
                            </button>
                            {/* Lectura rápida: KPI + plano activo, sin metodología ni tablas horarias.
                                El historial de 7 días alimenta el panel de tendencias; si la consulta
                                falla se emite igual y ese panel se rotula "sin datos suficientes". */}
                            <button className="estaciones-info" onClick={() => { void descargarInfografia(); }} title="Descargar infografía de clima actual: indicadores KPI y plano activo del distrito (HTML)">
                                <Gauge size={14} /> Infografía
                            </button>
                            <button className="estaciones-dl" onClick={() => { void exportClimaReport(estaciones); }} title="Descargar informe técnico de clima (HTML)">
                                <Download size={14} /> Informe
                            </button>
                        </div>
                    </div>

                    {/* Retroalimentación del refresco manual */}
                    {(refresco.activo || refresco.paso || refresco.resultado || refresco.error) && (
                        <div className={`refresco-estado ${refresco.error ? 'con-error' : ''}`}>
                            {refresco.activo
                                ? <span>{refresco.paso}</span>
                                : <>
                                    {refresco.resultado && <span>Actualizado · {refresco.resultado}</span>}
                                    {refresco.ultimoEn && (
                                        <span className="refresco-hora">
                                            {refresco.ultimoEn.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    )}
                                    {refresco.error && <span className="refresco-err">{refresco.error}</span>}
                                </>}
                        </div>
                    )}
                    <div className="estaciones-grid">
                        {estaciones.map((e) => <EstacionCard key={e.id} est={e} />)}
                    </div>
                    <p className="estaciones-foot">
                        {estaciones.filter(e => e.enLinea).length} de {estaciones.length} en línea ·
                        ETₒ calculada por estación (FAO-56 Penman-Monteith)
                    </p>
                </section>
            )}
            {!loadingEst && estaciones.length === 0 && (
                <div className="card p-4 text-center text-slate-400 text-xs">
                    Estaciones climáticas no configuradas todavía (tabla clima_estaciones vacía).
                </div>
            )}

            {noData && (
                <div className="card p-6 text-center text-slate-400">
                    <AlertTriangle size={24} className="mx-auto mb-2 text-amber-400" />
                    <p className="text-sm">No hay datos climatológicos disponibles para la fecha {fechaSeleccionada}.</p>
                    <p className="text-xs mt-1">Los datos mostrados podrían ser de la lectura más reciente disponible.</p>
                </div>
            )}

            <div className="clima-grid">
                {/* Section: Current Conditions */}
                {conditions.length > 0 && (
                    <section className="card conditions-section">
                        <h3><Thermometer size={18} /> Condiciones Registradas y Pronóstico (24h)</h3>
                        <table className="conditions-table">
                            <thead>
                                <tr>
                                    <th>Variable</th>
                                    <th>Valor Actual</th>
                                    <th>Pronóstico 24h</th>
                                    <th>Impacto Operativo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {conditions.map((c, i) => (
                                    <ConditionRow key={i} condition={c} />
                                ))}
                            </tbody>
                        </table>
                    </section>
                )}

                {/* Section: Technical Variables */}
                {techVars.length > 0 && (
                    <section className="card tech-section">
                        <h3><Activity size={18} /> Variables Técnicas de Riego (Cálculo SICA)</h3>
                        <div className="tech-grid">
                            {techVars.map((v, i) => (
                                <TechVarCard key={i} variable={v} />
                            ))}
                        </div>

                        <div className="kc-info">
                            <div className="kc-header">
                                <Leaf size={16} />
                                <span>Coeficiente de Cultivo (Kc)</span>
                            </div>
                            <p>La App cruza la ETₒ ({techVars[0]?.value || '—'} mm/día) con la etapa del cultivo para determinar la lámina de riego real:</p>
                            <div className="kc-formula">
                                <span>ETc = ETₒ × Kc</span>
                                <span className="kc-example">Ej: Nogal en brotación: {techVars[0]?.value || '—'} × 0.85 = <strong>{((Number(techVars[0]?.value) || 0) * 0.85).toFixed(2)} mm/día</strong></span>
                            </div>
                        </div>
                    </section>
                )}

                {/* Section: Irrigation Integration */}
                {irrigationAlerts.length > 0 && (
                    <section className="card alerts-section">
                        <h3><AlertTriangle size={18} /> Integración con Plan de Riego</h3>
                        <div className="alerts-list">
                            {irrigationAlerts.map((alert, i) => (
                                <div key={i} className={`alert-item ${alert.active ? 'active' : ''}`}>
                                    <div className="alert-indicator" />
                                    <div className="alert-content">
                                        <span className="alert-message">{alert.message}</span>
                                        <span className="alert-threshold">Umbral: {alert.threshold}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Section: Precipitación / Evaporación — dos presas del distrito */}
                {precipData.length > 0 && (
                    <section className="card history-section">
                        <h3><TrendingDown size={18} /> Precipitación y Evaporación — Presas del Distrito</h3>
                        <p className="chart-sub">Del día, medido en la estación de cada presa (mm)</p>
                        <div className="chart-container">
                            <ResponsiveContainer width="100%" height={210}>
                                <BarChart data={precipData} margin={{ top: 16, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="34%">
                                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                                    <XAxis dataKey="station" tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 600 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} />
                                    <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit=" mm" axisLine={false} tickLine={false} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                        contentStyle={{ backgroundColor: '#0f1c30', border: '1px solid rgba(56,189,248,0.35)', borderRadius: '8px', fontSize: '11px' }}
                                        labelStyle={{ color: '#e2e8f0', fontWeight: 700 }}
                                        formatter={(v, n) => [`${Number(v).toFixed(1)} mm`, n]}
                                        labelFormatter={(label, payload) => {
                                            const est = payload?.[0]?.payload?.estacion;
                                            return est ? `${label} · est. ${est}` : String(label);
                                        }}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: 4 }} iconType="circle" iconSize={9} />
                                    <Bar dataKey="precipitacion" name="Precipitación" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                                        <LabelList dataKey="precipitacion" position="top" formatter={(v) => Number(v) > 0 ? Number(v).toFixed(1) : ''} style={{ fill: '#93c5fd', fontSize: 10, fontWeight: 600 }} />
                                    </Bar>
                                    <Bar dataKey="evaporacion" name="Evaporación (ET)" fill="#f97316" radius={[4, 4, 0, 0]}>
                                        <LabelList dataKey="evaporacion" position="top" formatter={(v) => Number(v) > 0 ? Number(v).toFixed(1) : ''} style={{ fill: '#fdba74', fontSize: 10, fontWeight: 600 }} />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default Clima;
