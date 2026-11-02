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

    // Área y perímetro en gráficas separadas (sin doble eje) y con el eje de área recortado (empezar en 0 aplanaba la variación).
    const ejeX = useMemo(() => ({ type: 'category', data: historicoVaso.map(f => fMesCorto(f.fecha_escena)), axisLabel: { color: '#8fa3ba', fontSize: 12 } }), [historicoVaso]);
    const opcionesArea = useMemo(() => {
        if (!historicoVaso.length) return null;
        return {
            grid: { left: 48, right: 16, top: 16, bottom: 28 }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(1)} km²` },
            xAxis: ejeX,
            yAxis: { type: 'value', name: 'km²', scale: true, min: (v: { min: number }) => Math.floor((v.min - 4) / 5) * 5, axisLabel: { color: '#8fa3ba', fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
            series: [{ name: 'Área', type: 'line', data: historicoVaso.map(f => f.area_km2), lineStyle: { color: '#38bdf8', width: 2.5 }, itemStyle: { color: '#38bdf8' }, areaStyle: { color: 'rgba(56,189,248,0.10)', origin: 'start' }, connectNulls: false, symbolSize: 7 }],
        };
    }, [historicoVaso, ejeX]);
    const opcionesPerimetro = useMemo(() => {
        if (!historicoVaso.length) return null;
        return {
            grid: { left: 48, right: 16, top: 10, bottom: 24 }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v.toFixed(0)} km` },
            xAxis: { ...ejeX, axisLabel: { show: false } },
            yAxis: { type: 'value', name: 'km', scale: true, splitNumber: 2, axisLabel: { color: '#8fa3ba', fontSize: 11 }, splitLine: { show: false } },
            series: [{ name: 'Perímetro', type: 'line', data: historicoVaso.map(f => f.perimetro_km), lineStyle: { color: '#a78bfa', width: 1.8, type: 'dashed' }, itemStyle: { color: '#a78bfa' }, connectNulls: false, symbolSize: 5 }],
        };
    }, [historicoVaso, ejeX]);

    // Mapa comparativo: el lienzo toma la proporción real del encuadre (antes ~40 % del alto quedaba vacío) + escala gráfica.
    const MAPA_W = 640;
    const mapaComparativo = useMemo(() => {
        if (!filaBase || !filaComparada) return null;
        const b = bboxComun([filaBase.contorno_geojson.coordinates[0], filaComparada.contorno_geojson.coordinates[0]]);
        const spanLon = (b.maxLon - b.minLon) * b.cosLat, spanLat = b.maxLat - b.minLat;
        const H = Math.round(Math.min(480, Math.max(200, (MAPA_W * spanLat) / spanLon)));
        const k = Math.min(MAPA_W / spanLon, H / spanLat);
        const kmPorPx = 111.32 / k;
        const escalaKm = [1, 2, 5, 10, 20, 50].find(km => km / kmPorPx >= 70) ?? 50;
        return {
            b, H, escalaKm, escalaPx: escalaKm / kmPorPx,
            pathBase: poligonoPath(filaBase.contorno_geojson.coordinates, b, MAPA_W, H),
            pathComparado: poligonoPath(filaComparada.contorno_geojson.coordinates, b, MAPA_W, H),
        };
    }, [filaBase, filaComparada]);

    // Capas del mapa: la leyenda enciende/apaga cada una (sustituye el botón "Mostrar diferencia").
    const [capas, setCapas] = useState({ base: true, comparado: true, diferencia: false });
    const alternaCapa = (c: keyof typeof capas) => setCapas(v => ({ ...v, [c]: !v[c] }));
    const diffAzolve = useMemo(() => {
        if (!capas.diferencia || !filaBase || !filaComparada || !mapaComparativo) return null;
        return diferenciaPoligonos(filaBase.contorno_geojson.coordinates, filaComparada.contorno_geojson.coordinates, mapaComparativo.b, MAPA_W, mapaComparativo.H, 3);
    }, [capas.diferencia, filaBase, filaComparada, mapaComparativo]);

    const galeriaMensual = useMemo(() => {
        if (!historicoVaso.length) return null;
        const W = 220, H = 150;
        const b = bboxComun(historicoVaso.map(f => f.contorno_geojson.coordinates[0]));
        return historicoVaso.map((f, i) => ({ f, i, path: poligonoPath(f.contorno_geojson.coordinates, b, W, H), W, H }));
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
    const seccionCicloRef = React.useRef<HTMLElement>(null);
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
                <header className="vaso-header vaso-header--sc">
                    <div className="vaso-title-group">
                        <span className="vaso-cab-kicker">Manejo de vaso</span>
                        <h2>{sinComillas(data.nombre)}</h2>
                        <p className="vaso-cab-contexto">
                            Río Conchos · capacidad al NAMO {data.capacidad_total != null ? `${data.capacidad_total.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Mm³` : 'S/D'}
                            {' · '}{data.fecha_lectura ? `lectura ${new Date(data.fecha_lectura + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'sin lectura'}
                        </p>
                    </div>
                    <button type="button" className="vaso-close" aria-label="Cerrar manejo de vaso" onClick={onClose}>×</button>
                </header>

                <HeroVaso
                    presaId={data.presa_id} nivelBase={data.nivel_msnm} nivel={nivelMostrado} pct={stats.porcentaje} volumen={stats.almacenamiento}
                    pctBase={pctBase} volumenBase={volumenBase} capacidad={data.capacidad_total} namo={namo} deficit={deficit} estado={estadoVaso} mensaje={mensaje}
                    simulado={stats.isSimulated} frescura={frescura} procedencia={procedencia} fechaLectura={data.fecha_lectura ?? null}
                    curva={data.curva} tieneCurva={tieneCurva}
                    simMin={tieneNivel ? data.nivel_msnm! - 10 : 0} simMax={tieneNivel ? (namo ?? data.nivel_msnm! + 5) + 2 : 1} onNivel={setSimNivel}
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
                        <div className="vaso-skel" role="status">
                            <svg viewBox="0 0 320 120" aria-hidden="true"><path d="M14 64c22-30 52-18 74-34s48-8 66 4 40 2 58-10 46-4 62 12 26 30 32 42-26 20-50 16-40 10-64 6-34-14-58-2-46 18-70 6S-2 86 14 64Z" /></svg>
                            <span>Cargando escenas del vaso…</span>
                        </div>
                    ) : !historicoVaso.length ? (
                        <div className="vaso-vacio">Todavía no hay meses registrados para esta presa — el sincronizador mensual de Sentinel-2 llenará esta línea de tiempo con la próxima escena despejada.</div>
                    ) : (
                        <>
                            {/* Comparar dos meses: contorno 2D o relieve 3D */}
                            <div className="vaso-evo-sub vaso-evo-sub--primero">
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
                                </div>

                                {vista === 'contorno' && mapaComparativo && filaBase && filaComparada && (
                                    <div className="vaso-mapa">
                                        <svg viewBox={`0 0 ${MAPA_W} ${mapaComparativo.H}`} width="100%" role="img" aria-label={`Contorno del vaso en ${fMes(filaBase.fecha_escena)} comparado con ${fMes(filaComparada.fecha_escena)}`}>
                                            {capas.base && <path d={mapaComparativo.pathBase} fill="none" stroke="#b4c2d4" strokeWidth="2" strokeDasharray="6 4" fillRule="evenodd" />}
                                            {capas.comparado && <path d={mapaComparativo.pathComparado} fill="rgba(56,189,248,0.18)" stroke="#38bdf8" strokeWidth="2" fillRule="evenodd" />}
                                            {diffAzolve && (
                                                <g>
                                                    {diffAzolve.celdasAzolve.map(([x, y]) => <rect key={`a${x},${y}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#f87171" opacity={0.75} />)}
                                                    {diffAzolve.celdasNuevaAgua.map(([x, y]) => <rect key={`n${x},${y}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#38bdf8" opacity={0.45} />)}
                                                </g>
                                            )}
                                            {/* escala gráfica y norte */}
                                            <g transform={`translate(14 ${mapaComparativo.H - 18})`} className="vaso-mapa-escala">
                                                <rect x="0" y="-6" width={mapaComparativo.escalaPx} height="6" fill="#e8eef6" />
                                                <rect x="0" y="-6" width={mapaComparativo.escalaPx / 2} height="6" fill="#020617" stroke="#e8eef6" strokeWidth="1" />
                                                <text x="0" y="-12">0</text><text x={mapaComparativo.escalaPx} y="-12" textAnchor="end">{mapaComparativo.escalaKm} km</text>
                                            </g>
                                            <g transform={`translate(${MAPA_W - 24} 30)`} className="vaso-mapa-norte" aria-hidden="true">
                                                <path d="M0 -16 L7 6 L0 1 L-7 6 Z" /><text x="0" y="20" textAnchor="middle">N</text>
                                            </g>
                                        </svg>
                                        <div className="vaso-capas" role="group" aria-label="Capas del mapa">
                                            <button type="button" className="vaso-capa" aria-pressed={capas.base} onClick={() => alternaCapa('base')}><span className="leyenda-swatch marzo" />{fCorta(fechaPixeles(filaBase))}</button>
                                            <button type="button" className="vaso-capa" aria-pressed={capas.comparado} onClick={() => alternaCapa('comparado')}><span className="leyenda-swatch reciente" />{fCorta(fechaPixeles(filaComparada))}</button>
                                            {historicoVaso.length > 1 && (
                                                <button type="button" className="vaso-capa" aria-pressed={capas.diferencia} onClick={() => alternaCapa('diferencia')} title="Zonas que eran agua en el mes base y ya no lo son (y al revés)">
                                                    <span className="leyenda-swatch leyenda-swatch--azolve" />Diferencia
                                                    {diffAzolve && <b> · expuesto {diffAzolve.areaAzolveKm2.toFixed(2)} km² · nueva agua {diffAzolve.areaNuevaKm2.toFixed(2)} km²</b>}
                                                </button>
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

                            {galeriaMensual && (
                                <div className="vaso-evo-sub">
                                    <h3>Una imagen por mes, mismo encuadre <span className="vaso-h3-nota">· toca un mes para compararlo</span></h3>
                                    <div className="vaso-galeria">
                                        {galeriaMensual.map(({ f, i, path, W, H }) => (
                                            <button type="button" key={f.fecha_escena} aria-pressed={i === idxComparado}
                                                className={`vaso-galeria-mes${i === idxComparado ? ' es-comparado' : ''}${i === idxBase ? ' es-base' : ''}`}
                                                onClick={() => { setIdxComparado(i); setVista('contorno'); }} aria-label={`Comparar ${fMes(f.fecha_escena)}: ${f.area_km2.toFixed(1)} km²`}>
                                                <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
                                                    <path d={path} fill="rgba(56,189,248,0.22)" stroke="#38bdf8" strokeWidth="1.2" fillRule="evenodd" />
                                                </svg>
                                                <span className="fecha">{fCorta(fechaPixeles(f))}</span>
                                                <span className="kpi">{f.area_km2.toFixed(1)} km²</span>
                                                <span className="meta">{(f.metodo ?? 'v1')} · nubes {nubesEscena(f) != null ? `${nubesEscena(f)!.toFixed(1)} %` : 'S/D'}{i === idxBase ? ' · base' : ''}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {opcionesArea && (
                                <div className="vaso-evo-sub">
                                    <h3>Área por mes <span className="vaso-h3-nota">· eje recortado</span></h3>
                                    <ReactECharts option={opcionesArea} style={{ height: '200px', width: '100%' }} opts={{ renderer: 'svg' }} />
                                    {opcionesPerimetro && <ReactECharts option={opcionesPerimetro} style={{ height: '90px', width: '100%' }} opts={{ renderer: 'svg' }} />}
                                    <p className="vaso-nota">Área neta (sin bancos de tierra) arriba y perímetro del polígono abajo (línea discontinua). Un mes sin escena despejada queda como hueco, nunca como cero.</p>
                                </div>
                            )}

                            <div className="vaso-evo-sub">
                                <h3>Validación: satélite vs. curva oficial a la cota del día</h3>
                                {/* Gráfica de puntos en un eje 70-105 % con bandas por umbral (una barra 0-100 % no dejaba ver 83 vs. 95 %). */}
                                <div className="vaso-puntos" role="list">
                                    <div className="vaso-puntos-eje" aria-hidden="true">
                                        {[70, 75, 85, 100, 105].map(t => <span key={t} style={{ left: `${((t - 70) / 35) * 100}%` }}>{t} %</span>)}
                                    </div>
                                    {validacion.map(v => {
                                        if (v.sinReferencia) {
                                            return (
                                                <div role="listitem" key={v.fecha_escena} className="vaso-punto-fila sin">
                                                    <span className="f">{fCorta(v.fecha_escena)}</span>
                                                    <span className="motivo">Sin validar · {v.motivo === 'nubes' ? `nubes sobre el vaso > ${NUBES_VASO_MAX_PCT} %` : v.motivo === 'sin_curva' ? 'sin curva a esa cota' : `sin nivel a ±${DIAS_NIVEL_ESCENA} d`}</span>
                                                </div>
                                            );
                                        }
                                        const pct = v.pctCoincidencia!;
                                        const sem = semaforoDesvio(pct - 100);
                                        const Icono = ICONO_SEM[sem.clave];
                                        const x = Math.min(100, Math.max(0, ((pct - 70) / 35) * 100));
                                        return (
                                            <div role="listitem" key={v.fecha_escena} className={`vaso-punto-fila vaso-sem--${sem.clave}`}>
                                                <span className="f">{fCorta(v.fecha_escena)}</span>
                                                <span className="pista" role="meter" aria-valuemin={70} aria-valuemax={105} aria-valuenow={Math.round(pct)} aria-valuetext={`${pct.toFixed(0)} % de la curva · ${sem.etiqueta}`}>
                                                    <i style={{ left: `${x}%` }} />
                                                </span>
                                                <span className="pct">{pct.toFixed(0)} %</span>
                                                <span className={`vaso-sem vaso-sem--${sem.clave}`}><Icono size={14} aria-hidden="true" />{sem.etiqueta}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <details className="vaso-plegable">
                                    <summary>Detalle por escena</summary>
                                    <div>
                                        <ul className="vaso-detalle-lista">
                                            {conReferencia.map(v => (
                                                <li key={v.fecha_escena}><b>{fCorta(v.fecha_escena)}</b> — {v.areaSatelite.toFixed(1)} km² satélite vs. {v.areaEsperadaKm2!.toFixed(1)} km² de la curva a {v.escalaLectura!.toFixed(2)} msnm ({v.fuenteNivel === 'historico' ? 'CILA' : 'captura'} {fCorta(v.fechaLectura! + 'T18:00:00Z')}{v.diasDiferencia ? `, ${v.diasDiferencia} d` : ''})</li>
                                            ))}
                                        </ul>
                                    </div>
                                </details>
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
