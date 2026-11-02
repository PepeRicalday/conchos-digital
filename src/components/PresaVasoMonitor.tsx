import React, { useMemo, useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { RefreshCw, CalendarRange, FileText, Box, Map as MapaIcono, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import ReactECharts from 'echarts-for-react';

// Lazy: Three.js + React Three Fiber (~600 KB) solo se descargan si se abre el relieve 3D o se pide el informe.
const VasoVisor3D = lazy(() => import('./VasoVisor3D'));
const VasoVisor3DCaptura = lazy(() => import('./VasoVisor3D').then(m => ({ default: m.VasoVisor3DCaptura })));
import './PresaVasoMonitor.css';
import { detectaSuperficieVaso, type SuperficieVaso } from '../utils/mapaSatelital';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePresasHistorico } from '../hooks/usePresasHistorico';
import InformeVasoModal from './vaso/InformeVasoModal';
import HeroVaso from './vaso/HeroVaso';
import SimuladorVaso from './vaso/SimuladorVaso';
import InteranualVaso from './vaso/InteranualVaso';
import { construirInteranual } from '../utils/informeVasoInteranual';
import TarjetaSuperficieVaso from './vaso/SuperficieVaso';
import './vaso/vasoNiveles.css';
import './vaso/vasoEvolucion.css';
import {
    areaKm2PorElevacion, conciliaSuperficie, cotasDePresa, deficitBajoNamo, estadoEmbalse, mensajeEstado, sinComillas, tendenciaNivel, volumenPorElevacion,
} from '../utils/presaNiveles';
import { calcularFrescura, procedenciaNivel } from '../utils/presaMetrics';
import type { EscenaVaso } from '../utils/informeVasoDatos';
import { bboxComun, poligonoPath } from '../utils/informeVasoSvg';
import {
    diferenciaPoligonos, fechaPixeles, indiceFragmentacion, nivelEnFecha, nubesEscena, resumenRecalibracion, unirNiveles, validacionCruzada,
    type FactorCorreccion, type NivelDia,
} from '../utils/vasoAnalisis';
import { DESVIO_ATENCION_PCT, DESVIO_CRITICO_PCT, DIAS_NIVEL_ESCENA, NUBES_VASO_MAX_PCT, semaforoDesvio, type ClaveSemaforo } from '../utils/vasoUmbrales';

interface CurvaPunto { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

// presa_id (tabla `presas`) → nombre usado en VASOS_CONOCIDOS (mapaSatelital.ts).
const NOMBRE_VASO_POR_PRESA_ID: Record<string, string> = {
    'PRE-001': 'La Boquilla',
    'PRE-002': 'Fco. I. Madero',
};

const ICONO_SEM: Record<ClaveSemaforo, typeof CheckCircle2> = { ok: CheckCircle2, warn: AlertTriangle, crit: XCircle, sd: HelpCircle };
const fCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
const fMes = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });
const fMesCorto = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' });
const signo = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const COLUMNAS_ESCENA = 'fecha_escena, fecha_pixeles, area_km2, perimetro_km, num_islas, nubosidad_pct, cobertura_nubes_vaso_pct, ratio_elongacion, delta_area_km2, pct_del_maximo_ciclo, contorno_geojson, metodo, resolucion_m';

interface PresaVasoMonitorProps {
    data: {
        nombre: string;
        nivel_msnm: number | null;
        // null = S/D (GeoMonitor ya los entrega así).
        almacenamiento_mm3: number | null;
        porcentaje: number | null;
        extraccion_m3s: number | null;
        /** Respaldo del NAMO (presas.elevacion_corona_msnm = 1317.00 = NAMO, no la corona real). La cota oficial sale de cotasDePresa. */
        nivel_nma: number | null;
        /** Fecha ('AAAA-MM-DD') de la lectura mostrada: da la frescura. */
        fecha_lectura?: string | null;
        /** lecturas_presas.notas: de ahí sale la procedencia del nivel (CILA / campo / estimada). */
        notas?: string | null;
        capacidad_total: number | null;
        presa_id: string;
        curva?: CurvaPunto[];
    };
    /** Sección a enfocar al abrir: 'satelital' (arriba), 'ciclo' (evolución) o 'relieve3d' (evolución con el relieve activo). */
    seccionInicial?: 'satelital' | 'ciclo' | 'relieve3d';
    onClose: () => void;
}

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, seccionInicial = 'satelital', onClose }) => {
    const { profile } = useAuth();
    const { indice: indiceHistorico, loading: cargandoSerie } = usePresasHistorico();
    const tieneNivel = data.nivel_msnm !== null;
    const tieneCurva = (data.curva?.length ?? 0) >= 2;

    // ── Simulador (arranca en la lectura real; sin lectura el control no se muestra) ──
    const [simNivel, setSimNivel] = useState(data.nivel_msnm ?? 0);
    // Sin simular: volumen y % OFICIALES de la lectura. Al simular: la curva real; sin curva, S/D. El % no se topa en 100:
    // sobre el NAMO se ve el excedente real (antes se congelaba en 100 %).
    const stats = useMemo(() => {
        const diff = data.nivel_msnm !== null ? simNivel - data.nivel_msnm : 0;
        const isSimulated = Math.abs(diff) > 0.01;
        const almCurva = tieneCurva ? volumenPorElevacion(data.curva, simNivel) : null;
        const pctDe = (alm: number | null) => (alm !== null && data.capacidad_total ? (alm / data.capacidad_total) * 100 : null);
        const almacenamiento = isSimulated ? almCurva : (data.almacenamiento_mm3 ?? almCurva);
        const porcentaje = isSimulated ? pctDe(almCurva) : (data.porcentaje ?? pctDe(almacenamiento));
        return { almacenamiento, porcentaje, isSimulated };
    }, [simNivel, data, tieneCurva]);

    // ── Referencia visual (mosaico ArcGIS de fecha desconocida; orientativa) ──
    const nombreVaso = NOMBRE_VASO_POR_PRESA_ID[data.presa_id];
    const [superficieVaso, setSuperficieVaso] = useState<SuperficieVaso | null>(null);
    const [cargandoVisual, setCargandoVisual] = useState(false);
    const [errorVisual, setErrorVisual] = useState(false);
    const cargarSuperficie = useCallback(() => {
        if (!nombreVaso) return;
        setCargandoVisual(true);
        setErrorVisual(false);
        detectaSuperficieVaso(nombreVaso)
            .then(res => { if (res) setSuperficieVaso(res); else setErrorVisual(true); })
            .catch(() => setErrorVisual(true))
            .finally(() => setCargandoVisual(false));
    }, [nombreVaso]);
    useEffect(() => { cargarSuperficie(); }, [cargarSuperficie]);

    // ── Escenas Sentinel-2 VIGENTES del ciclo (vaso_geometria_historico; v1 conservadas como no vigentes) ──
    const [historicoVaso, setHistoricoVaso] = useState<EscenaVaso[]>([]);
    const [cargandoHistorico, setCargandoHistorico] = useState(true);
    const recargarHistorico = useCallback(async () => {
        const { data: filas, error } = await supabase
            .from('vaso_geometria_historico')
            .select(COLUMNAS_ESCENA)
            .eq('presa_id', data.presa_id)
            .eq('vigente', true)
            .eq('es_referencia_historica', false)
            .order('fecha_escena', { ascending: true });
        setHistoricoVaso(error || !filas ? [] : (filas as unknown as EscenaVaso[]));
    }, [data.presa_id]);
    useEffect(() => {
        let cancelado = false;
        setCargandoHistorico(true);
        recargarHistorico().then(() => { if (!cancelado) setCargandoHistorico(false); });
        return () => { cancelado = true; };
    }, [recargarHistorico]);

    // Textura satelital del terreno (informe: "Contexto satelital del vaso").
    const [texturaSatelital, setTexturaSatelital] = useState<{ urlPublica: string; bbox: [number, number, number, number]; fechaEscena: string | null } | null>(null);
    useEffect(() => {
        let cancelado = false;
        supabase.from('textura_satelital_terreno').select('bbox, url_publica, fecha_escena').eq('presa_id', data.presa_id).maybeSingle()
            .then(({ data: fila, error }) => {
                if (cancelado || error || !fila) return;
                setTexturaSatelital({ urlPublica: fila.url_publica, bbox: fila.bbox as [number, number, number, number], fechaEscena: fila.fecha_escena });
            });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    // Sincronización manual (mismo endpoint que el cron del día 3).
    const [sincronizandoMes, setSincronizandoMes] = useState(false);
    const [resultadoSyncManual, setResultadoSyncManual] = useState<string | null>(null);
    const sincronizarMesActual = useCallback(async () => {
        setSincronizandoMes(true);
        setResultadoSyncManual(null);
        try {
            const { data: r, error } = await supabase.functions.invoke('sentinel-ndwi-vaso-sync', { body: { presa_id: data.presa_id } });
            if (error) throw error;
            if (r?.error) throw new Error(r.error);
            if (r?.insertado) {
                await recargarHistorico();
                setResultadoSyncManual(`Actualizado: píxeles del ${fCorta(r.fecha_pixeles ?? r.fecha_escena)} · ${r.area_km2} km² · nubes sobre el vaso ${r.cobertura_nubes_vaso_pct ?? 'S/D'} %.`);
            } else {
                setResultadoSyncManual(r?.mensaje || 'Sin escena nueva disponible en la ventana actual.');
            }
        } catch (err) {
            setResultadoSyncManual(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSincronizandoMes(false);
        }
    }, [data.presa_id, recargarHistorico]);

    // ── Niveles: histórico diario CILA (preferente) + capturas, ~13 meses. La tendencia usa solo las capturas. ──
    const [niveles, setNiveles] = useState<NivelDia[]>([]);
    const [capturas, setCapturas] = useState<{ fecha: string; escala_msnm: number }[]>([]);
    useEffect(() => {
        let cancelado = false;
        const desde = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
        Promise.all([
            supabase.from('presas_historico_diario').select('fecha, escala_msnm').eq('presa_id', data.presa_id).eq('calidad', 'OK')
                .not('escala_msnm', 'is', null).gte('fecha', desde).order('fecha', { ascending: true }).limit(1000),
            supabase.from('lecturas_presas').select('fecha, escala_msnm').eq('presa_id', data.presa_id)
                .not('escala_msnm', 'is', null).gte('fecha', desde).order('fecha', { ascending: true }).limit(1000),
        ]).then(([h, c]) => {
            if (cancelado) return;
            const capt = (c.data ?? []) as { fecha: string; escala_msnm: number }[];
            setCapturas(capt);
            setNiveles(unirNiveles((h.data ?? []) as { fecha: string; escala_msnm: number }[], capt));
        });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    // ── Estado del vaso ──
    const cotas = useMemo(() => cotasDePresa(data.presa_id), [data.presa_id]);
    const namo = cotas.namo ?? data.nivel_nma;
    const nivelMostrado = tieneNivel ? simNivel : null;
    const estadoVaso = estadoEmbalse(stats.porcentaje);
    const deficit = deficitBajoNamo(nivelMostrado, namo);
    const tendencia = useMemo(() => tendenciaNivel(capturas), [capturas]);
    const mensaje = mensajeEstado({
        tieneNivel, estado: estadoVaso, deficitM: deficit, tendencia, simulado: stats.isSimulated,
        deltaSimM: tieneNivel ? simNivel - data.nivel_msnm! : null,
    });
    const procedencia = procedenciaNivel(data.notas, tieneNivel);
    const frescura = calcularFrescura(data.fecha_lectura);
    const volumenBase = data.almacenamiento_mm3 ?? (tieneCurva && tieneNivel ? volumenPorElevacion(data.curva, data.nivel_msnm!) : null);
    const pctBase = data.porcentaje ?? (volumenBase !== null && data.capacidad_total ? (volumenBase / data.capacidad_total) * 100 : null);
    const interanual = useMemo(() => construirInteranual(indiceHistorico[data.presa_id], data.fecha_lectura ?? null, volumenBase), [indiceHistorico, data.presa_id, data.fecha_lectura, volumenBase]);

    const masReciente = historicoVaso.length ? historicoVaso[historicoVaso.length - 1] : null;
    const fuentesSuperficie = useMemo(() => {
        const nivelEscena = masReciente ? nivelEnFecha(fechaPixeles(masReciente), niveles) : null;
        return conciliaSuperficie({
            curvaKm2: tieneNivel ? areaKm2PorElevacion(data.curva, data.nivel_msnm!) : null,
            sentinel: masReciente ? {
                km2: masReciente.area_km2, fecha: fechaPixeles(masReciente), nubesPct: nubesEscena(masReciente),
                curvaKm2Escena: nivelEscena ? areaKm2PorElevacion(data.curva, nivelEscena.escala_msnm) : null,
                metodo: masReciente.metodo ?? 'v1', resolucionM: masReciente.resolucion_m ?? null, fechaPixelesConocida: masReciente.fecha_pixeles != null,
            } : null,
            visual: superficieVaso ? { km2: superficieVaso.areaKm2, cobertura: superficieVaso.cobertura } : null,
        });
    }, [tieneNivel, data.curva, data.nivel_msnm, masReciente, niveles, superficieVaso]);

    // ── Recalibración (job mensual; la curva oficial nunca se modifica) ──
    const [curvaCorregida, setCurvaCorregida] = useState<FactorCorreccion[]>([]);
    useEffect(() => {
        let cancelado = false;
        supabase.from('curva_batimetrica_correccion').select('banda_elevacion_msnm, factor_area, desviacion_pct_prom, n_observaciones')
            .eq('presa_id', data.presa_id).order('banda_elevacion_msnm', { ascending: true })
            .then(({ data: filas, error }) => { if (!cancelado) setCurvaCorregida(error || !filas ? [] : (filas as FactorCorreccion[])); });
        return () => { cancelado = true; };
    }, [data.presa_id]);
    const recalibracion = useMemo(() => resumenRecalibracion(curvaCorregida), [curvaCorregida]);

    // ── Validación cruzada (nivel DEL DÍA de los píxeles, ±2 d) y fragmentación ──
    const validacion = useMemo(() => validacionCruzada(historicoVaso, niveles, data.curva), [historicoVaso, niveles, data.curva]);
    const conReferencia = validacion.filter(v => !v.sinReferencia);
    const fragmentacion = useMemo(() => indiceFragmentacion(historicoVaso), [historicoVaso]);

    const opcionesDesviacion = useMemo(() => {
        if (conReferencia.length < 2) return null;
        return {
            grid: { left: 50, right: 20, top: 36, bottom: 30 },
            tooltip: { trigger: 'axis' },
            legend: { data: ['Curva oficial a la cota del día', 'Sentinel-2'], textStyle: { color: '#b4c2d4', fontSize: 12 }, top: 0 },
            xAxis: { type: 'category', data: conReferencia.map(v => fMesCorto(v.fecha_escena)), axisLabel: { color: '#8fa3ba', fontSize: 12 } },
            yAxis: { type: 'value', name: 'km²', axisLabel: { color: '#8fa3ba', fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
            series: [
                { name: 'Curva oficial a la cota del día', type: 'line', data: conReferencia.map(v => v.areaEsperadaKm2), lineStyle: { color: '#b4c2d4', width: 2, type: 'dashed' }, itemStyle: { color: '#b4c2d4' } },
                { name: 'Sentinel-2', type: 'line', data: conReferencia.map(v => v.areaSatelite), lineStyle: { color: '#38bdf8', width: 2.5 }, itemStyle: { color: '#38bdf8' }, areaStyle: { color: 'rgba(56,189,248,0.08)' } },
            ],
        };
    }, [conReferencia]);

    // ── Comparar dos meses ──
    const [idxBase, setIdxBase] = useState(0);
    const [idxComparado, setIdxComparado] = useState(0);
    useEffect(() => {
        if (!historicoVaso.length) return;
        setIdxBase(0);
        setIdxComparado(historicoVaso.length - 1);
    }, [historicoVaso.length]);
    const filaBase = historicoVaso[idxBase] ?? null;
    const filaComparada = historicoVaso[idxComparado] ?? masReciente;
    const deltaArea = filaBase && filaComparada ? filaComparada.area_km2 - filaBase.area_km2 : null;
    const mismoMetodo = filaBase && filaComparada && (filaBase.metodo ?? 'v1') === (filaComparada.metodo ?? 'v1');

    const opcionesSerie = useMemo(() => {
        if (!historicoVaso.length) return null;
        return {
            grid: { left: 50, right: 50, top: 30, bottom: 30 },
            tooltip: { trigger: 'axis' },
            legend: { data: ['Área (km²)', 'Perímetro (km)'], textStyle: { color: '#b4c2d4', fontSize: 12 }, top: 0 },
            xAxis: { type: 'category', data: historicoVaso.map(f => fMesCorto(f.fecha_escena)), axisLabel: { color: '#8fa3ba', fontSize: 12 } },
            yAxis: [
                { type: 'value', name: 'km²', position: 'left', axisLabel: { color: '#38bdf8', fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
                { type: 'value', name: 'km', position: 'right', axisLabel: { color: '#a78bfa', fontSize: 12 }, splitLine: { show: false } },
            ],
            series: [
                { name: 'Área (km²)', type: 'line', yAxisIndex: 0, data: historicoVaso.map(f => f.area_km2), lineStyle: { color: '#38bdf8', width: 2 }, itemStyle: { color: '#38bdf8' }, areaStyle: { color: 'rgba(56,189,248,0.08)' }, connectNulls: false },
                { name: 'Perímetro (km)', type: 'line', yAxisIndex: 1, data: historicoVaso.map(f => f.perimetro_km), lineStyle: { color: '#a78bfa', width: 2, type: 'dashed' }, itemStyle: { color: '#a78bfa' }, connectNulls: false },
            ],
        };
    }, [historicoVaso]);

    const MAPA_W = 640, MAPA_H = 380;
    const mapaComparativo = useMemo(() => {
        if (!filaBase || !filaComparada) return null;
        const b = bboxComun([filaBase.contorno_geojson.coordinates[0], filaComparada.contorno_geojson.coordinates[0]]);
        return { b, pathBase: poligonoPath(filaBase.contorno_geojson.coordinates, b, MAPA_W, MAPA_H), pathComparado: poligonoPath(filaComparada.contorno_geojson.coordinates, b, MAPA_W, MAPA_H) };
    }, [filaBase, filaComparada]);

    const [mostrarAzolve, setMostrarAzolve] = useState(false);
    const diffAzolve = useMemo(() => {
        if (!mostrarAzolve || !filaBase || !filaComparada || !mapaComparativo) return null;
        return diferenciaPoligonos(filaBase.contorno_geojson.coordinates, filaComparada.contorno_geojson.coordinates, mapaComparativo.b, MAPA_W, MAPA_H, 3);
    }, [mostrarAzolve, filaBase, filaComparada, mapaComparativo]);

    const galeriaMensual = useMemo(() => {
        if (!historicoVaso.length) return null;
        const W = 220, H = 150;
        const b = bboxComun(historicoVaso.map(f => f.contorno_geojson.coordinates[0]));
        return historicoVaso.map(f => ({ f, path: poligonoPath(f.contorno_geojson.coordinates, b, W, H), W, H }));
    }, [historicoVaso]);

    // ── Informe institucional (espera la captura del relieve 3D; ver comentarios históricos en git) ──
    const [mostrarInforme, setMostrarInforme] = useState(false);
    const [imagenRelieveInforme, setImagenRelieveInforme] = useState<string | null | undefined>(undefined);
    const [preparandoInforme, setPreparandoInforme] = useState(false);
    const [capturaListaParaMontar, setCapturaListaParaMontar] = useState(false);
    const abrirInforme = useCallback(() => {
        if (imagenRelieveInforme !== undefined) { setMostrarInforme(true); return; }
        if (!masReciente) { setImagenRelieveInforme(null); setMostrarInforme(true); return; }
        setPreparandoInforme(true);
    }, [imagenRelieveInforme, masReciente]);
    useEffect(() => {
        if (!preparandoInforme) { setCapturaListaParaMontar(false); return; }
        // 400 ms para que el contexto WebGL del visor interactivo libere VRAM antes de abrir el de captura.
        const t = setTimeout(() => setCapturaListaParaMontar(true), 400);
        return () => clearTimeout(t);
    }, [preparandoInforme]);
    useEffect(() => {
        if (preparandoInforme && imagenRelieveInforme !== undefined) { setPreparandoInforme(false); setMostrarInforme(true); }
    }, [preparandoInforme, imagenRelieveInforme]);

    // ── Contorno | Relieve 3D ──
    const [vista, setVista] = useState<'contorno' | '3d'>('contorno');
    const [avisoSinHistorico, setAvisoSinHistorico] = useState(false);
    const seccionCicloRef = React.useRef<HTMLElement>(null);
    const irARelieve = useCallback(() => {
        if (!historicoVaso.length) { setAvisoSinHistorico(true); return; }
        setVista('3d');
        seccionCicloRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [historicoVaso.length]);
    useEffect(() => {
        if (seccionInicial === 'relieve3d') setVista('3d');
        if ((seccionInicial === 'ciclo' || seccionInicial === 'relieve3d') && seccionCicloRef.current) {
            seccionCicloRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Una sola vez al montar, para no pelear con el usuario después.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const opcionMes = (f: EscenaVaso, i: number) => <option key={f.fecha_escena} value={i}>{fMes(f.fecha_escena)}</option>;

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                <div className="vaso-scroll-content">
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN E INTERACTIVIDAD DE VASO</div>
                        <h2>{sinComillas(data.nombre).toUpperCase()}</h2>
                    </div>
                    <button type="button" className="vaso-btn" onClick={irARelieve} aria-disabled={!historicoVaso.length}
                        title={historicoVaso.length ? 'Ir al relieve 3D con terreno real' : 'Relieve 3D · sin escenas mensuales todavía'}>
                        <Box size={16} aria-hidden="true" /> Relieve 3D
                    </button>
                    <button type="button" className="vaso-close" aria-label="Cerrar manejo de vaso" onClick={onClose}>×</button>
                </header>
                {avisoSinHistorico && !historicoVaso.length && (
                    <div className="vaso-sc" style={{ margin: '0 clamp(1.25rem, 4vw, 3rem) 1rem' }}>
                        <div className="vaso-mensaje vaso-mensaje--info" role="status"><HelpCircle size={18} aria-hidden="true" />
                            <span>Aún no hay escenas mensuales de esta presa; el relieve 3D aparecerá con la primera escena despejada.</span></div>
                    </div>
                )}

                <HeroVaso
                    presaId={data.presa_id} nivel={nivelMostrado} pct={stats.porcentaje} volumen={stats.almacenamiento} capacidad={data.capacidad_total}
                    namo={namo} deficit={deficit} estado={estadoVaso} mensaje={mensaje} simulado={stats.isSimulated} frescura={frescura} procedencia={procedencia}
                />

                <SimuladorVaso
                    nivelBase={data.nivel_msnm} nivel={simNivel} min={tieneNivel ? data.nivel_msnm! - 10 : 0} max={tieneNivel ? (namo ?? data.nivel_msnm! + 5) + 2 : 1}
                    namo={namo} tieneCurva={tieneCurva} volumenBase={volumenBase} volumenSim={stats.almacenamiento} pctBase={pctBase} pctSim={stats.porcentaje}
                    deficitSim={deficit} onNivel={setSimNivel}
                />

                <TarjetaSuperficieVaso
                    fuentes={fuentesSuperficie} cargandoVisual={cargandoVisual} errorVisual={errorVisual} sinDeteccion={!nombreVaso} onRefrescarVisual={cargarSuperficie}
                />

                <InteranualVaso datos={interanual} cargando={cargandoSerie} />

                {/* EVOLUCIÓN DEL VASO — escenas Sentinel-2 vigentes (vaso_geometria_historico). */}
                <section className="vaso-sc vaso-card vaso-evo" ref={seccionCicloRef} aria-labelledby="vaso-evo-t">
                    <div className="vaso-evo-cab">
                        <span className="vaso-kicker" id="vaso-evo-t"><CalendarRange size={13} aria-hidden="true" /> Evolución del vaso · Sentinel-2</span>
                        {masReciente && <span className="vaso-chip vaso-chip--ok"><CheckCircle2 size={14} aria-hidden="true" />{(masReciente.metodo ?? 'v1') === 'v2' ? 'Método v2 · 10 m · un día de píxeles' : 'Método v1 · 20 m'}</span>}
                        <div className="vaso-evo-acciones">
                            <button type="button" className="vaso-btn" onClick={sincronizarMesActual} disabled={sincronizandoMes}
                                title="Busca la escena más reciente con el vaso despejado (últimos 30 días) sin esperar al cron del día 3">
                                <RefreshCw size={16} className={sincronizandoMes ? 'animate-spin' : undefined} aria-hidden="true" />
                                {sincronizandoMes ? 'Buscando escena…' : 'Actualizar mes actual'}
                            </button>
                            {historicoVaso.length > 0 && (
                                <button type="button" className="vaso-btn" onClick={abrirInforme} disabled={preparandoInforme} title="Informe institucional SRL Conchos / SICA 005">
                                    <FileText size={16} className={preparandoInforme ? 'animate-spin' : undefined} aria-hidden="true" />
                                    {preparandoInforme ? 'Preparando relieve 3D…' : 'Informe institucional'}
                                </button>
                            )}
                        </div>
                    </div>
                    {resultadoSyncManual && <p className="vaso-nota" role="status" aria-live="polite">{resultadoSyncManual}</p>}

                    {cargandoHistorico ? (
                        <div className="vaso-vacio" role="status">Cargando escenas del vaso…</div>
                    ) : !historicoVaso.length ? (
                        <div className="vaso-vacio">Todavía no hay meses registrados para esta presa — el sincronizador mensual de Sentinel-2 llenará esta línea de tiempo con la próxima escena despejada.</div>
                    ) : (
                        <>
                            {/* Comparar dos meses: contorno 2D o relieve 3D */}
                            <div className="vaso-evo-sub" style={{ borderTop: 0, paddingTop: 0 }}>
                                <div className="vaso-comparar">
                                    {historicoVaso.length > 1 && (
                                        <>
                                            <label className="vaso-mes-selector"><span>Comparar desde</span>
                                                <select value={idxBase} onChange={(e) => setIdxBase(Number(e.target.value))}>{historicoVaso.map(opcionMes)}</select>
                                            </label>
                                            <label className="vaso-mes-selector"><span>Hasta</span>
                                                <select value={idxComparado} onChange={(e) => setIdxComparado(Number(e.target.value))}>{historicoVaso.map(opcionMes)}</select>
                                            </label>
                                        </>
                                    )}
                                    <div className="vaso-tabs" role="tablist" aria-label="Vista del vaso">
                                        <button type="button" role="tab" aria-selected={vista === 'contorno'} onClick={() => setVista('contorno')}><MapaIcono size={15} aria-hidden="true" /> Contorno</button>
                                        <button type="button" role="tab" aria-selected={vista === '3d'} onClick={() => setVista('3d')}><Box size={15} aria-hidden="true" /> Relieve 3D</button>
                                    </div>
                                    {vista === 'contorno' && historicoVaso.length > 1 && (
                                        <button type="button" className="vaso-btn" aria-pressed={mostrarAzolve} onClick={() => setMostrarAzolve(v => !v)} title="Zonas que eran agua en el mes base y ya no lo son (y al revés)">
                                            {mostrarAzolve ? 'Ocultar' : 'Mostrar'} diferencia
                                        </button>
                                    )}
                                </div>

                                {vista === 'contorno' && mapaComparativo && filaBase && filaComparada && (
                                    <div className="vaso-mapa-comparativo">
                                        <svg viewBox={`0 0 ${MAPA_W} ${MAPA_H}`} width="100%" role="img" aria-label={`Contorno del vaso en ${fMes(filaBase.fecha_escena)} comparado con ${fMes(filaComparada.fecha_escena)}`}>
                                            <path d={mapaComparativo.pathBase} fill="none" stroke="#b4c2d4" strokeWidth="2" strokeDasharray="6 4" fillRule="evenodd" />
                                            <path d={mapaComparativo.pathComparado} fill="rgba(56,189,248,0.18)" stroke="#38bdf8" strokeWidth="2" fillRule="evenodd" />
                                            {diffAzolve && (
                                                <g>
                                                    {diffAzolve.celdasAzolve.map(([x, y]) => <rect key={`a${x},${y}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#f87171" opacity={0.75} />)}
                                                    {diffAzolve.celdasNuevaAgua.map(([x, y]) => <rect key={`n${x},${y}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#38bdf8" opacity={0.45} />)}
                                                </g>
                                            )}
                                        </svg>
                                        <div className="vaso-mapa-leyenda">
                                            <span className="leyenda-item"><span className="leyenda-swatch marzo"></span>{fCorta(fechaPixeles(filaBase))}</span>
                                            <span className="leyenda-item"><span className="leyenda-swatch reciente"></span>{fCorta(fechaPixeles(filaComparada))}</span>
                                            {diffAzolve && (
                                                <>
                                                    <span className="leyenda-item"><span className="leyenda-swatch leyenda-swatch--azolve"></span>Banco expuesto: {diffAzolve.areaAzolveKm2.toFixed(2)} km²</span>
                                                    <span className="leyenda-item"><span className="leyenda-swatch leyenda-swatch--nueva"></span>Nueva inundación: {diffAzolve.areaNuevaKm2.toFixed(2)} km²</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {/* El visor se desmonta mientras se prepara el informe: dos contextos WebGL pesados a la vez perdían el de captura. */}
                                {vista === '3d' && !preparandoInforme && filaComparada && (
                                    <Suspense fallback={<div className="vaso-vacio">Cargando relieve 3D…</div>}>
                                        <VasoVisor3D
                                            contornoGeojson={filaComparada.contorno_geojson} curva={data.curva} nivelMsnm={data.nivel_msnm}
                                            nombrePresa={data.nombre} fechaEscena={fechaPixeles(filaComparada)} presaId={data.presa_id}
                                        />
                                    </Suspense>
                                )}

                                {filaBase && filaComparada && (
                                    <dl className="vaso-evo-kpis">
                                        <div className="vaso-kpi"><dt>{fCorta(fechaPixeles(filaBase))}</dt>
                                            <dd>{filaBase.area_km2.toFixed(1)}<small>km²</small></dd>
                                            <span className="sub">perímetro {filaBase.perimetro_km.toFixed(0)} km · {filaBase.num_islas} banco{filaBase.num_islas === 1 ? '' : 's'} de tierra</span></div>
                                        <div className="vaso-kpi"><dt>{fCorta(fechaPixeles(filaComparada))}</dt>
                                            <dd>{filaComparada.area_km2.toFixed(1)}<small>km²</small></dd>
                                            <span className="sub">perímetro {filaComparada.perimetro_km.toFixed(0)} km · {filaComparada.num_islas} banco{filaComparada.num_islas === 1 ? '' : 's'} de tierra</span></div>
                                        <div className="vaso-kpi"><dt>Variación</dt>
                                            <dd className={deltaArea! < 0 ? 'vaso-delta--baja' : 'vaso-delta--sube'}>{deltaArea! < 0 ? '▼' : '▲'} {signo(deltaArea!)}<small>km²</small></dd>
                                            <span className="sub">{mismoMetodo ? `perímetro ${signo(filaComparada.perimetro_km - filaBase.perimetro_km, 0)} km` : 'perímetro no comparable (métodos distintos)'}</span></div>
                                    </dl>
                                )}
                                {filaComparada?.pct_del_maximo_ciclo != null && (
                                    <p className="vaso-nota">La superficie del mes de llegada equivale al <strong>{filaComparada.pct_del_maximo_ciclo.toFixed(0)} %</strong> del máximo registrado en el ciclo.</p>
                                )}
                            </div>

                            {opcionesSerie && (
                                <div className="vaso-evo-sub">
                                    <h3>Área y perímetro por mes</h3>
                                    <ReactECharts option={opcionesSerie} style={{ height: '220px', width: '100%' }} opts={{ renderer: 'svg' }} />
                                    <p className="vaso-nota">Área neta (sin bancos de tierra) y perímetro del polígono. Un mes sin escena despejada queda como hueco, nunca como cero.</p>
                                </div>
                            )}

                            {galeriaMensual && (
                                <div className="vaso-evo-sub">
                                    <h3>Una imagen por mes, mismo encuadre</h3>
                                    <div className="vaso-galeria-tira">
                                        {galeriaMensual.map(({ f, path, W, H }) => (
                                            <div className="vaso-galeria-item" key={f.fecha_escena}>
                                                <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Contorno del vaso en ${fMes(f.fecha_escena)}`}>
                                                    <path d={path} fill="rgba(56,189,248,0.22)" stroke="#38bdf8" strokeWidth="1.2" fillRule="evenodd" />
                                                </svg>
                                                <div className="vaso-galeria-fecha">{fCorta(fechaPixeles(f))}</div>
                                                <div className="vaso-galeria-kpi">{f.area_km2.toFixed(1)} km²</div>
                                                <div className="vaso-galeria-metodo">{(f.metodo ?? 'v1')} · nubes {nubesEscena(f) != null ? `${nubesEscena(f)!.toFixed(1)} %` : 'S/D'}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="vaso-evo-sub">
                                <h3>Validación: satélite vs. curva oficial a la cota del día</h3>
                                {opcionesDesviacion && <ReactECharts option={opcionesDesviacion} style={{ height: '200px', width: '100%' }} opts={{ renderer: 'svg' }} />}
                                <ul className="vaso-valid">
                                    {validacion.map(v => {
                                        if (v.sinReferencia) {
                                            return <li key={v.fecha_escena} className="sin"><span className="f">{fCorta(v.fecha_escena)}</span>
                                                <span>Sin validar · {v.motivo === 'nubes' ? `nubes sobre el vaso > ${NUBES_VASO_MAX_PCT} %` : v.motivo === 'sin_curva' ? 'sin curva a esa cota' : `sin nivel registrado a ±${DIAS_NIVEL_ESCENA} días`}</span></li>;
                                        }
                                        const pct = v.pctCoincidencia!;
                                        const sem = semaforoDesvio(pct - 100);
                                        const Icono = ICONO_SEM[sem.clave];
                                        return (
                                            <li key={v.fecha_escena} className={`vaso-sem--${sem.clave}`}>
                                                <span className="f">{fCorta(v.fecha_escena)}</span>
                                                <span className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={`${pct.toFixed(0)} % de la curva`}><i style={{ width: `${Math.min(100, pct)}%` }} /><b /></span>
                                                <span className="pct">{pct.toFixed(0)} %</span>
                                                <span className={`vaso-sem vaso-sem--${sem.clave}`}><Icono size={14} aria-hidden="true" />{sem.etiqueta}</span>
                                                <span className="det">{v.areaSatelite.toFixed(1)} km² satélite vs. {v.areaEsperadaKm2!.toFixed(1)} km² de la curva a {v.escalaLectura!.toFixed(2)} msnm
                                                    ({v.fuenteNivel === 'historico' ? 'CILA' : 'captura'} {fCorta(v.fechaLectura! + 'T18:00:00Z')}{v.diasDiferencia ? `, ${v.diasDiferencia} d` : ''})</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                                <p className="vaso-nota">100 % = el satélite mide exactamente el área de la curva a esa cota. Un área satelital ~10 % menor es el sesgo normal del método (el píxel de 10 m pierde la orilla somera y la cola con vegetación): "Revisar" a partir de {DESVIO_ATENCION_PCT} % y "Discrepa" a partir de {DESVIO_CRITICO_PCT} %. Una brecha mayor y sostenida en todas las cotas sugiere revisar la curva (no la corrige).</p>
                            </div>

                            <details className="vaso-plegable">
                                <summary>Índice de fragmentación{fragmentacion.disponible ? ` · ${fragmentacion.nivel === 'normal' ? 'conectividad normal' : fragmentacion.nivel === 'atencion' ? 'atención' : 'crítico'}` : ' · S/D'}</summary>
                                <div>
                                    {fragmentacion.disponible ? (
                                        <p className="vaso-nota">Ratio de elongación actual <strong>{fragmentacion.ratioActual.toFixed(2)}×</strong> vs. promedio de esta presa <strong>{fragmentacion.baseRatio.toFixed(2)}×</strong> ({signo(fragmentacion.desviacionPct, 0)} %).
                                            {fragmentacion.islasAgravante && <> Además, {fragmentacion.islasActuales} bancos de tierra superan su promedio ({fragmentacion.baseIslas.toFixed(1)}).</>}</p>
                                    ) : (
                                        <p className="vaso-nota">Se requieren al menos 3 escenas del mismo método para calibrar el promedio de esta presa.</p>
                                    )}
                                    <p className="vaso-nota">Perímetro real ÷ perímetro del círculo de igual área, contra el promedio histórico de la propia presa: si sube mucho, el vaso se está angostando en brazos que pueden quedar desconectados del cuerpo principal.</p>
                                </div>
                            </details>

                            <details className="vaso-plegable">
                                <summary>Recalibración sugerida de la curva{recalibracion ? ` · ${signo(recalibracion.desviacionPonderada)} %` : ' · sin corridas'}</summary>
                                <div>
                                    {recalibracion ? (
                                        <dl className="vaso-evo-kpis">
                                            <div className="vaso-kpi"><dt>Desvío ponderado</dt><dd>{signo(recalibracion.desviacionPonderada)}<small>%</small></dd><span className="sub">{recalibracion.totalObs} observaciones</span></div>
                                            <div className="vaso-kpi"><dt>Banda con mayor desvío</dt><dd>{recalibracion.bandaMayorDesvio.banda_elevacion_msnm.toFixed(0)}<small>msnm</small></dd>
                                                <span className="sub">{signo(recalibracion.bandaMayorDesvio.desviacion_pct_prom)} % ({recalibracion.bandaMayorDesvio.n_observaciones} obs.)</span></div>
                                            <div className="vaso-kpi"><dt>Bandas calibradas</dt><dd>{recalibracion.totalBandas}</dd></div>
                                        </dl>
                                    ) : (
                                        <p className="vaso-nota">El job mensual de recalibración aún no ha guardado factores para esta presa.</p>
                                    )}
                                    <p className="vaso-nota">Factor por banda de 1 m: área satelital ÷ área de la curva a la cota del día, solo escenas despejadas. Es un ajuste de referencia para priorizar verificación en campo; la curva oficial y el simulador no cambian.</p>
                                </div>
                            </details>
                        </>
                    )}
                </section>
                </div>
            </div>

            {/* Captura oculta del relieve 3D para el informe (solo tras pedirlo; margen para liberar el WebGL anterior). */}
            {capturaListaParaMontar && imagenRelieveInforme === undefined && masReciente && (
                <Suspense fallback={null}>
                    <VasoVisor3DCaptura contornoGeojson={masReciente.contorno_geojson} nivelMsnm={data.nivel_msnm} presaId={data.presa_id} onCaptura={setImagenRelieveInforme} />
                </Suspense>
            )}

            {mostrarInforme && (
                <InformeVasoModal
                    onCerrar={() => setMostrarInforme(false)}
                    entrada={{
                        nombrePresa: sinComillas(data.nombre),
                        escenas: historicoVaso,
                        validacion,
                        estado: {
                            nivel: tieneNivel ? data.nivel_msnm : null, pct: pctBase, volumen: volumenBase, capacidad: data.capacidad_total ?? null, namo,
                            deficit: deficitBajoNamo(tieneNivel ? data.nivel_msnm : null, namo), fechaLectura: data.fecha_lectura ?? null, procedencia,
                        },
                        textura: texturaSatelital, imagenRelieve: imagenRelieveInforme ?? null, historico: indiceHistorico[data.presa_id], emisor: profile?.nombre ?? null,
                    }}
                />
            )}
        </div>
    );
};
