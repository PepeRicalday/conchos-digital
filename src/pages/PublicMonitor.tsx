import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { MapContainer, TileLayer, Polyline, ZoomControl, Marker, Popup } from 'react-leaflet';
import { supabase } from '../lib/supabase';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { Timer, Activity, Clock, ArrowRightCircle, MapPin, Waves, AlertTriangle, Map as MapIconLucide } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import './PublicMonitor.css';
import { LogoSica } from '../components/marca/LogoSica';
import { formatDate, getTodayString } from '../utils/dateHelpers';
import type { MovimientoPresaConNombreRow, RegistroAlertaRow } from '../types/sica.types';
import { calcIEC, iecColor } from '../utils/canalIndex';
import { calcRadialFlow, M1_FACTORS, getM1Factor } from '../utils/hydraulics';
import { onTable } from '../lib/realtimeHub';
import InformeOperativo from '../components/InformeOperativo';
import { exportEscalasCSV } from '../utils/exportCanal';
import { toast } from 'sonner';
import TendenciasPanel from '../components/TendenciasPanel';
import PresasNivelStrip from '../components/PresasNivelStrip';
import { useTendenciasHistoricas } from '../hooks/useTendenciasHistoricas';
import { fetchVolumenCiclo, totalesVolumenCiclo, estadoVolumen, type VolumenCicloModulo } from '../utils/volumenCiclo';
import FitCanal from '../components/monitor/FitCanal';
import { PanelEjecutivo, VistaVaciado, type DatosEjecutivos, type DatosVaciado } from '../components/monitor/PanelEjecutivo';
import { DIAS_ALERTA_VIGENTE } from '../utils/dashboardKpis';
import { useDevice } from '../hooks/useDevice';
import type { EscalaData, TelemetriaEstado } from '../components/monitor/canalHelpers';
import { CAPACIDAD_DISENO_K0, haversineDist, telemetriaEstado, LAMBDA_REF, escalaAlertColor, formatFechaCorta, ESC_SIN_CONTROL, escalaVencida, CARTO_TILE_URL, waterFrontIcon, UMBRAL_CRITICO, UMBRAL_ALERTA, UMBRAL_NORMAL } from '../components/monitor/canalHelpers';
import { MapController, EscalaMarker, CheckpointsGrid } from '../components/monitor/CheckpointsGrid';
import { CanalLongitudinalProfile } from '../components/monitor/CanalLongitudinalProfile';
import { PestanaSkill } from '../components/monitor/PestanaSkill';
// Cuenca del Conchos (portal USIBWC): carga diferida, el hook solo consulta cuando la pestaña está abierta (sin realtime).
const PanelCuencaConchos = lazy(() => import('../components/presas/cuenca/PanelCuencaConchos'));






 // m³/s·km⁻¹

 // m³/s
















   // por debajo: "flujo bajo" (o descenso en vaciado)




















const PublicMonitor: React.FC = () => {
    const navigate = useNavigate();
    const { activeEvent } = useHydricEvents();
    const [escalas, setEscalas] = useState<EscalaData[]>([]);
    const [geoCanal, setGeoCanal] = useState<any>(null);
    const [geoRio, setGeoRio] = useState<any>(null);
    const [realMaxKm, setRealMaxKm] = useState<number>(-36);
    const [presasData, setPresasData] = useState<any[]>([]);
    const [damMovements, setDamMovements] = useState<MovimientoPresaConNombreRow[]>([]);
    
    // Deep-link a una pestaña específica (p. ej. desde Geo-Monitor hacia
    // Tendencias, ver informe de auditoría — antes eran islas sin navegación
    // cruzada pese a operar sobre el mismo canal). Soporta ?tab=tendencias.
    const tabInicialUrl = (() => {
        if (typeof window === 'undefined') return null;
        const t = new URLSearchParams(window.location.search).get('tab');
        return (['resumen', 'canal', 'alertas', 'skill', 'tendencias', 'cuenca'] as const).includes(t as any) ? t : null;
    })();

    // Panel Visibility States - Start minimized on phone for total map priority
    const dispositivo = useDevice();
    const isMobile = dispositivo.tipo === 'phone';
    const [isDockVisible, setIsDockVisible] = useState(!isMobile || !!tabInicialUrl);
    // Ancho real del contenedor (área a la derecha del sidebar): decide si el
    // tablero va como PANEL LATERAL (el canal queda libre y centrado en el
    // resto) o como franja inferior (tableta vertical / pantallas angostas).
    const contRef = useRef<HTMLDivElement>(null);
    const [anchoCont, setAnchoCont] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1400);
    useEffect(() => {
        const el = contRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setAnchoCont(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const recentrarCanalRef = useRef<(() => void) | null>(null);
    const [dockTab, setDockTab] = useState<'resumen' | 'canal' | 'alertas' | 'skill' | 'tendencias' | 'cuenca'>(
        (tabInicialUrl as any) || 'resumen'
    );

    // Pestaña TENDENCIAS: rango, granularidad y series históricas — solo
    // consulta la base mientras dockTab === 'tendencias'.
    const {
        tndDesde, tndHasta, tndGran, setTndGran,
        tndLoading, tndError, tndData,
        onTndRango, onTndReintentar,
    } = useTendenciasHistoricas(dockTab === 'tendencias');

    const [snapshotCopied, setSnapshotCopied] = useState(false);
    const [showSkillInforme, setShowSkillInforme] = useState(false);
    const [modelQ0, setModelQ0] = useState('');
    const [modelResult, setModelResult] = useState<null | { q104: number; qZonas: number; perdidasLin: number; ef: number; transitH: number }>(null);
    const [isPredictionVisible, setIsPredictionVisible] = useState(false);
    const [fgvData, setFgvData] = useState<any>(null);
    const [fgvLoading, setFgvLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const [anchorTimes, setAnchorTimes] = useState<Record<number, string>>({});
    const [activeAlertas, setActiveAlertas] = useState<Pick<RegistroAlertaRow, 'id' | 'tipo_riesgo' | 'titulo' | 'mensaje' | 'fecha_deteccion'>[]>([]);
    const [volInterescalas, setVolInterescalas] = useState<any[]>([]);
    const [volZonas, setVolZonas] = useState<any[]>([]);
    const [tomasActivas, setTomasActivas] = useState<any[]>([]);
    const [balanceModulos, setBalanceModulos] = useState<any[]>([]);
    // ÚNICA FUENTE de volumen a entregar (autorizado) vs entregado del ciclo, por módulo
    // (vista volumen_ciclo_modulo vía utils/volumenCiclo.ts): hoja institucional + remanente.
    // balance_volumen_modulo ya deriva de esa misma vista; no sumar entregas_modulo aparte.
    const [volCiclo, setVolCiclo] = useState<VolumenCicloModulo[]>([]);
    const [entregasHoy, setEntregasHoy] = useState<any[]>([]);
    const [balanceTramos, setBalanceTramos] = useState<any[]>([]);
    const [flowAtZero, setFlowAtZero] = useState<number>(0);
    // Frescura de la lectura que alimenta flowAtZero (<4h, mismo criterio
    // STALE_MIN que coherenciaCanal.k0Disponible) — sin esto el header
    // mostraba "FLUJO K0+000: 27.50" en verde como si fuera dato en vivo
    // aunque la lectura tuviera 15h de antigüedad, mientras el panel
    // PANORAMA (que sí filtra por frescura) correctamente mostraba "S/D"
    // para el mismo K-0 en la misma pantalla.
    const [flowAtZeroFresh, setFlowAtZeroFresh] = useState<boolean>(false);
    // Resumen por módulo = vista única volumen_ciclo_modulo (UNA fila por módulo, sin
    // sumar zonas: antes se sumaban todas las zonas y se duplicaba el consumo). La zona
    // primaria solo se toma de balance_volumen_modulo como metadato.
    const modulosResumen = useMemo(() => volCiclo.map(v => {
        const zonaPrim = balanceModulos.find(b => b.modulo_id === v.moduloId && b.es_primaria)?.zona_codigo ?? '';
        return {
            modulo_id: v.moduloId,
            modulo_nombre: v.moduloNombre,
            codigo_corto: v.codigoCorto,
            zona_codigo: zonaPrim,
            autorizado_mm3: v.autorizadoMm3,
            hoja_mm3: v.hojaMm3,
            remanente_mm3: v.remanenteMm3,
            entregado_mm3: v.entregadoMm3,
            saldo_mm3: v.saldoMm3,
            pct_entregado: v.pctEntregado,
            estado_volumen: estadoVolumen(v.pctEntregado),
        };
    }), [volCiclo, balanceModulos]);

    // 0. Update internal clock for reactive calculations
    // 60 s (antes 15 s): cada tick re-renderiza TODO el árbol (mapa Leaflet, paneles,
    // SVGs) y recalcula ~5 useMemo pesados. La UI muestra edades con precisión de
    // minutos ("hace 5h 1m"), así que 15 s eran 4× re-renders sin beneficio visible.
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);

    // 1. Fetch Canal Geometry (sessionStorage cache — estático, no cambia por sesión)
    useEffect(() => {
        const loadGeo = async () => {
            const fetchOrCache = async (url: string, key: string) => {
                const cached = sessionStorage.getItem(key);
                if (cached) {
                    try { return JSON.parse(cached); } catch { /* ignore */ }
                }
                const res = await fetch(url).then(r => r.json()).catch(() => null);
                if (res) sessionStorage.setItem(key, JSON.stringify(res));
                return res;
            };
            const [canRes, rioRes] = await Promise.all([
                fetchOrCache('/geo/canal_conchos.geojson', 'geo_canal'),
                fetchOrCache('/geo/rio_conchos.geojson',   'geo_rio'),
            ]);
            if (canRes) setGeoCanal(canRes);
            if (rioRes) setGeoRio(rioRes);
        };
        loadGeo();
    }, []);

    // 2. Fetch Escalas & Wave Data (todos los fetches en paralelo)
    const fetchData = useCallback(async () => {
        try {
            const todayDate  = getTodayString();
            const eventStart = activeEvent?.fecha_inicio || `${todayDate}T00:00:00`;
            const isLlenado  = activeEvent?.evento_tipo === 'LLENADO';

            // ── RPC agregada fn_monitor_snapshot: 1 request en vez de 6 ──────
            // Feature-detect con caché de sesión: si la función aún no existe en
            // la BD (migración 20260709100000 pendiente de aplicar), se marca 'no'
            // y NO se vuelve a intentar en esta sesión → fallback sin costo extra.
            let escData: any[] | null | undefined, pData: any[] | null | undefined,
                summaryDelta: any[] | null | undefined, readings: any[] | null | undefined,
                mData: any[] | null | undefined, trackResult: { data: any } = { data: null };
            let usedRpc = false;
            if (sessionStorage.getItem('rpc_monitor_snapshot') !== 'no') {
                const { data: snap, error: rpcErr } = await supabase.rpc('fn_monitor_snapshot', {
                    p_event_start: eventStart,
                    p_evento_id: (isLlenado && activeEvent?.id) ? activeEvent.id : null,
                });
                if (!rpcErr && snap) {
                    usedRpc = true;
                    escData      = snap.escalas;
                    pData        = snap.lecturas_presas;
                    summaryDelta = snap.resumen_delta;
                    readings     = snap.lecturas_escalas;
                    mData        = snap.movimientos;
                    trackResult  = { data: snap.llenado_seguimiento };
                } else {
                    sessionStorage.setItem('rpc_monitor_snapshot', 'no');
                }
            }

            if (!usedRpc) {
            const [
                { data: escData2 },
                { data: pData2 },
                { data: summaryDelta2 },
                { data: readings2 },
                { data: mData2 },
                trackResult2,
            ] = await Promise.all([
                supabase
                    .from('escalas')
                    .select('id, nombre, km, latitud, longitud, pzas_radiales, ancho, alto, nivel_max_operativo, capacidad_max')
                    .order('km'),
                supabase
                    .from('lecturas_presas')
                    .select('*, presas:presa_id (nombre, nombre_corto)')
                    .order('fecha', { ascending: false })
                    .order('creado_en', { ascending: false }),
                supabase
                    .from('resumen_escalas_diario')
                    .select('escala_id, delta_12h')
                    .eq('fecha', todayDate),
                supabase
                    .from('lecturas_escalas')
                    .select('escala_id, nivel_m, nivel_abajo_m, fecha, hora_lectura, apertura_radiales_m, radiales_json, gasto_calculado_m3s, gasto_metodo, creado_en, responsable, notas, confirmada')
                    .gte('creado_en', eventStart)
                    .or('responsable.is.null,responsable.not.ilike.*chronos*')
                    .order('creado_en', { ascending: false })
                    .limit(500),
                supabase
                    .from('movimientos_presas')
                    .select('*, presas:presa_id (nombre_corto)')
                    .order('fecha_hora', { ascending: false })
                    .limit(5),
                isLlenado && activeEvent?.id
                    ? supabase
                        .from('sica_llenado_seguimiento')
                        .select('km, hora_real')
                        .eq('evento_id', activeEvent.id)
                        .not('hora_real', 'is', null)
                        .order('km', { ascending: false })
                    : Promise.resolve({ data: null }),
            ]);
            escData = escData2; pData = pData2; summaryDelta = summaryDelta2;
            readings = readings2; mData = mData2; trackResult = trackResult2;
            } // fin fallback sin RPC

            // Veracidad: SICA Chronos copia a las 00:00 el último nivel de cada
            // escala (responsable='SICA Chronos'). Ese arrastre NO es una lectura de campo:
            // en VACIADO mostraba niveles de agua que ya no está y, entre 00:00 y
            // 04:00, contaba las 14 escalas como "vigentes". Se descartan aquí
            // (mismo criterio que useTendenciasHistoricas); la escala queda con su
            // última lectura REAL (y su edad real) o en S/D.
            readings = (readings || []).filter((r: any) =>
                !/chronos|autogenerad|medianoche/i.test(`${r.responsable || ''} ${r.notas || ''}`));

            // Sincronía Digital: Solo tomamos la última lectura de cada presa
            const uniquePresasMap = new Map();
            (pData || []).forEach(p => {
                if (!uniquePresasMap.has(p.presa_id)) {
                    uniquePresasMap.set(p.presa_id, {
                        ...p,
                        extraccion_total: p.extraccion_total_m3s,
                        extraccion_fuente: p.extraccion_total_m3s != null ? 'lectura' : null,
                        extraccion_desde: p.fecha,
                    });
                }
            });

            // ── CAPA 2: continuidad operativa (movimientos_presas) ──
            // El Monitor Público omitía esta capa, así que un movimiento
            // registrado desde SICA Capture se reflejaba en el Dashboard pero
            // NO aquí — dos gastos distintos para la misma presa en el mismo
            // instante, siendo esta la cara pública del organismo.
            const movPorPresa = new Map<string, any>();
            (mData || []).forEach((m: any) => {
                if (!movPorPresa.has(m.presa_id)) movPorPresa.set(m.presa_id, m);
            });

            movPorPresa.forEach((mov, presaId) => {
                const lectura = uniquePresasMap.get(presaId);
                const fechaLectura = lectura?.fecha ? new Date(lectura.fecha).getTime() : 0;
                const fechaMov = mov.fecha_hora ? new Date(mov.fecha_hora).getTime() : 0;

                if (!lectura) {
                    // Hay movimiento sin reporte diario: se publica igualmente.
                    uniquePresasMap.set(presaId, {
                        id: `mov-${presaId}`,
                        presa_id: presaId,
                        extraccion_total: Number(mov.gasto_m3s),
                        extraccion_fuente: 'movimiento',
                        extraccion_desde: mov.fecha_hora,
                        fecha: mov.fecha_hora,
                        presas: mov.presas ?? null,
                        almacenamiento_mm3: null,
                        porcentaje_llenado: null,
                        escala_msnm: null,
                    });
                } else if (fechaMov > fechaLectura || lectura.extraccion_total == null) {
                    // Filas de nivel (CILA) no traen extracción: el último movimiento sigue vigente.
                    uniquePresasMap.set(presaId, { ...lectura, extraccion_total: Number(mov.gasto_m3s), extraccion_fuente: 'movimiento', extraccion_desde: mov.fecha_hora });
                }
            });

            let finalPresas = Array.from(uniquePresasMap.values());

            // Si es protocolo de LLENADO y no hay dato de hoy, inyectar el solicitado para Boquilla.
            // El gasto solicitado es una INSTRUCCIÓN: solo aplica mientras no exista
            // medición de campo posterior al inicio del protocolo (misma regla que usePresas).
            const movBoquilla = movPorPresa.get('PRE-001');
            const inicioProtocolo = activeEvent?.fecha_inicio ? new Date(activeEvent.fecha_inicio).getTime() : null;
            const medicionPosterior = movBoquilla?.fecha_hora && inicioProtocolo != null
                ? new Date(movBoquilla.fecha_hora).getTime() > inicioProtocolo
                : false;

            if (activeEvent?.evento_tipo === 'LLENADO' && activeEvent.gasto_solicitado_m3s && !medicionPosterior) {
                const hasBoquilla = finalPresas.some(p => (p.presas?.nombre_corto === 'Boquilla' || p.presa_id === 'PRE-001') && p.extraccion_total > 0);
                if (!hasBoquilla) {
                    finalPresas = [
                        {
                            id: 'fallback-plb',
                            presa_id: 'PRE-001',
                            extraccion_total: activeEvent.gasto_solicitado_m3s,
                            extraccion_fuente: 'protocolo',
                            extraccion_desde: activeEvent.fecha_inicio,
                            fecha: new Date().toISOString(),
                            presas: { nombre: 'La Boquilla', nombre_corto: 'Boquilla' }
                        },
                        ...finalPresas
                    ];
                }
            }

            setPresasData(finalPresas);

            // delta_12h map (Histórico en DB)
            const deltaMap = new Map<string, number>();
            (summaryDelta || []).forEach((r: any) => {
                if (r.delta_12h != null) deltaMap.set(r.escala_id, r.delta_12h);
            });

            // Darle vida inmediata a la tendencia: Live Delta inyectado en RAM sin costo DB.
            // Extraemos la diferencia entre el registro número 1 y el número 2 de las lecturas recientes
            const latestLevels = new Map<string, number>();
            const liveDeltaMap = new Map<string, number>();
            (readings || []).forEach((r: any) => {
                if (!latestLevels.has(r.escala_id)) {
                    latestLevels.set(r.escala_id, r.nivel_m);
                } else if (!liveDeltaMap.has(r.escala_id)) {
                    const currentLevel = latestLevels.get(r.escala_id)!;
                    const prevLevel = r.nivel_m;
                    liveDeltaMap.set(r.escala_id, currentLevel - prevLevel);
                }
            });

            setDamMovements((mData || []) as MovimientoPresaConNombreRow[]);

            const flowStartTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null;
            
            const readingsMap = new Map();
            let latestReadingAtZero: any = null;

            if (flowStartTime) {
                readings?.forEach(r => {
                    const manualReadingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                    const serverCreatedTime = new Date(r.creado_en).getTime();
                    
                    // Sincronía Hídrica: Si el dato es físicamente nuevo (creado hoy)
                    // pero la hora manual es antigua/errónea, usamos el tiempo del servidor.
                    const readingTime = (manualReadingTime >= flowStartTime!) ? manualReadingTime : serverCreatedTime;

                    if (readingTime >= flowStartTime!) {
                        if (!readingsMap.has(r.escala_id)) {
                            const esc = escData?.find(e => e.id === r.escala_id);
                            // Si el operador eligió curva nivel-gasto (robusta ante compuertas
                            // taponadas), respetar ese valor en vez de recalcular con la fórmula
                            // de orificio/radiales, que sobreestima cuando hay azolve.
                            const gasto_recalc = r.gasto_metodo === 'curva_nivel'
                                ? (r.gasto_calculado_m3s || 0)
                                : esc?.pzas_radiales
                                ? calcRadialFlow(
                                    r.nivel_m,
                                    r.nivel_abajo_m || 0,
                                    r.radiales_json,
                                    esc.ancho,
                                    esc.pzas_radiales,
                                    esc.nombre,
                                    esc.km
                                  )
                                : (r.gasto_calculado_m3s || 0);
                            const entry = {
                                nivel: r.nivel_m,
                                nivel_abajo: r.nivel_abajo_m || 0,
                                hora: r.hora_lectura,
                                fecha: r.fecha,
                                timestamp: readingTime,
                                apertura: r.apertura_radiales_m || 0,
                                radiales_json: r.radiales_json,
                                gasto_real: gasto_recalc
                            };
                            readingsMap.set(r.escala_id, entry);

                            // Track specifically the latest KM 0 to show in header/alerts
                            if (esc?.km === 0) {
                                if (!latestReadingAtZero || readingTime > latestReadingAtZero.timestamp) {
                                    latestReadingAtZero = entry;
                                }
                            }
                        }
                    }
                });
            }

            // ESTABILIZACIÓN: si no hay evento LLENADO activo, poblar readingsMap
            // con la lectura más reciente de cada escala (sin filtro de tiempo de evento)
            if (!flowStartTime) {
                (readings || []).forEach(r => {
                    if (!readingsMap.has(r.escala_id)) {
                        const manualReadingTime = new Date(`${r.fecha}T${r.hora_lectura}-06:00`).getTime();
                        const esc = escData?.find(e => e.id === r.escala_id);
                        const gasto_recalc = r.gasto_metodo === 'curva_nivel'
                            ? (r.gasto_calculado_m3s || 0)
                            : esc?.pzas_radiales
                            ? calcRadialFlow(
                                r.nivel_m,
                                r.nivel_abajo_m || 0,
                                r.radiales_json,
                                esc.ancho,
                                esc.pzas_radiales,
                                esc.nombre,
                                esc.km
                              )
                            : (r.gasto_calculado_m3s || 0);
                        readingsMap.set(r.escala_id, {
                            nivel:        r.nivel_m,
                            nivel_abajo:  r.nivel_abajo_m  || 0,
                            hora:         r.hora_lectura,
                            fecha:        r.fecha,
                            timestamp:    manualReadingTime,
                            apertura:     r.apertura_radiales_m || 0,
                            radiales_json: r.radiales_json,
                            gasto_real:   gasto_recalc,
                        });
                        if (esc?.km === 0 && !latestReadingAtZero) {
                            latestReadingAtZero = readingsMap.get(r.escala_id);
                        }
                    }
                });
            }

            // 4. Confirmed progress from Llenado Tracker (ya obtenido en Promise.all)
            let maxKmConfirmed = -36;
            if (activeEvent?.evento_tipo === 'LLENADO') {
                const trackData = (trackResult as any).data as { km: string; hora_real: string }[] | null;
                const newAnchors: Record<number, string> = {};

                trackData?.forEach(td => {
                    const kmNum = parseFloat(td.km);
                    if (kmNum > maxKmConfirmed) maxKmConfirmed = kmNum;
                    if (!newAnchors[kmNum]) {
                        newAnchors[kmNum] = td.hora_real;
                        sessionStorage.setItem(`anchor_time_${kmNum}`, td.hora_real);
                    }
                });
                
                setAnchorTimes(newAnchors);

                // Also check if any scale reading confirms arrival (Mediante SICA Capture)
                // KM 0 CONDITION: Level > 0 AND Apertura > 0 is REQUIRED to pass into canal.
                let maxReadingKm = -36;
                readingsMap.forEach((r, escId) => {
                    const esc = escData?.find(e => e.id === escId);
                    if (esc && (r.nivel > 0 || r.nivel_abajo > 0)) {
                        const kmNum = parseFloat(esc.km as any);
                        // KM 0 Specific Lock: Need Apertura OR Nivel Abajo to release
                        const isK0ReachedButLocked = kmNum === 0 && r.apertura <= 0 && r.nivel_abajo <= 0;
                        
                        if (isK0ReachedButLocked) {
                            if (0 > maxReadingKm) maxReadingKm = 0;
                        } else {
                            if (kmNum > maxReadingKm) {
                                maxReadingKm = kmNum;
                                if (!newAnchors[kmNum]) {
                                    newAnchors[kmNum] = new Date(r.timestamp).toISOString();
                                    sessionStorage.setItem(`anchor_time_${kmNum}`, newAnchors[kmNum]);
                                }
                            }
                        }
                    }
                });

                maxKmConfirmed = Math.max(maxKmConfirmed, maxReadingKm);
                setRealMaxKm(maxKmConfirmed);
                
                if (maxKmConfirmed < -36 && activeEvent.hora_apertura_real) {
                    setRealMaxKm(-36);
                }
            } else {
                setRealMaxKm(113); 
            }

            const baseEscalas = (escData || []).map(e => {
                const reading = readingsMap.get(e.id);
                const nivel = reading?.nivel;
                let estado: any = 'ESPERANDO';
                
                if (nivel !== undefined && nivel > 0) estado = 'OPERANDO';
                else if (realMaxKm !== undefined && e.km <= realMaxKm) estado = 'OPERANDO';

                const timestamp = reading?.timestamp || null;

                // ── Apertura real desde radiales_json ─────────────────────────
                // apertura_radiales_m es legacy (queda en 0 cuando el operador usa
                // la interfaz de compuertas individuales). La fuente real es radiales_json.
                const radialesArr = Array.isArray(reading?.radiales_json) ? reading!.radiales_json : [];
                const aperturaTotal = radialesArr.reduce((s: number, v: any) => {
                    if (typeof v === 'object' && v !== null && v.apertura_m !== undefined)
                        return s + Number(v.apertura_m);
                    return s + (parseFloat(String(v)) || 0);
                }, 0);
                const puertasAbiertas = radialesArr.filter((v: any) => {
                    const ap = typeof v === 'object' ? Number(v.apertura_m || 0) : parseFloat(String(v));
                    return ap > 0;
                }).length;
                const aperturaFinal = aperturaTotal > 0 ? aperturaTotal : (reading?.apertura || null);

                // ── Coherencia física: solo contra capacidad de diseño ────────
                // No comparar vs gasto de presa: el canal puede evacuar volumen
                // almacenado en el tramo Boquilla→K0 (36km), produciendo Q_k0 > Q_presa.
                const gastoFinal: number | null = reading?.gasto_real ?? null;

                return {
                    ...e,
                    nivel_actual:          nivel,
                    nivel_abajo:           reading?.nivel_abajo ?? null,
                    gasto_actual:          gastoFinal,
                    apertura_actual:       aperturaFinal,
                    puertas_abiertas:      puertasAbiertas > 0 ? puertasAbiertas : undefined,
                    nivel_max_operativo:   (e as any).nivel_max_operativo ?? null,
                    capacidad_max:         (e as any).capacidad_max       ?? null,
                    delta_12h:             (liveDeltaMap.has(e.id) && liveDeltaMap.get(e.id) !== 0) ? liveDeltaMap.get(e.id) : (deltaMap.get(e.id) ?? null),
                    estado:                estado,
                    ultima_telemetria:     timestamp,
                    fuente: e.km === 0 ? 'BOQUILLA' : e.km > 100 ? 'MADERO' : null
                };
            });

            if (activeEvent?.evento_tipo === 'LLENADO') {
                const presaReading = (pData || []).find((p: any) => p.presa_id === 'PRE-001' || p.presas?.nombre_corto === 'Boquilla');
                const extraccionReal = presaReading?.extraccion_total || 0;

                baseEscalas.unshift({
                    id: 'presa-boquilla',
                    nombre: 'PRESA LA BOQUILLA',
                    km: -36,
                    nivel_actual: 3.5, // Referencia Escala de Presa (Directiva de Usuario)
                    estado: activeEvent.hora_apertura_real ? 'OPERANDO' : 'ESPERANDO',
                    // Date.now() directo (no currentTime): currentTime cambia cada tick del
                    // reloj y, como dependencia de este useCallback, hacía que fetchData
                    // cambiara de identidad en cada tick → el useEffect de suscripciones
                    // destruía/recreaba 4 canales Realtime y RE-EJECUTABA el batch completo
                    // de queries cada 15 s (≈15× el tráfico diseñado de 5 min).
                    ultima_telemetria: extraccionReal > 0 ? new Date(presaReading!.fecha).getTime() : Date.now(),
                    latitud: 27.545,
                    longitud: -105.414
                } as any);
            }

            setEscalas(baseEscalas);
            
            // KM 0 Logic: Technical Comparison (Source vs Delivery)
            const zeroScale = baseEscalas.find(e => e.km === 0);
            const zeroReading = zeroScale ? readingsMap.get(zeroScale.id) : null;
            
            // Physical properties of K0 for technical validation
            const k0Phys = escData?.find(e => e.km === 0);
            const pzas = k0Phys?.pzas_radiales || 12;
            const ancho = k0Phys?.ancho || 1.84;
            
            // Priority 1: Real gauged/calculated flow from field (SICA Capture)
            // Priority 2: Theoretical radial gate model (Cd=0.6)
            let currentFlowAtZero = zeroReading?.gasto_real || 0;

            if (currentFlowAtZero === 0 && zeroReading?.apertura > 0) {
                // Usa calcRadialFlow con M1 y radiales_json individuales (igual que path principal)
                currentFlowAtZero = calcRadialFlow(
                    zeroReading.nivel || 0,
                    zeroReading.nivel_abajo || 0,
                    zeroReading.radiales_json,
                    ancho,
                    pzas,
                    k0Phys?.nombre,
                    0
                );
            }

            // Sin check vs presa — K0 puede superar Q_presa por almacenamiento en tramo 36km
            const hasViolation = currentFlowAtZero > CAPACIDAD_DISENO_K0;
            
            sessionStorage.setItem('zero_radial_apertura', (zeroReading?.apertura || 0).toString());
            sessionStorage.setItem('zero_nivel_abajo', (zeroReading?.nivel_abajo || 0).toString());
            sessionStorage.setItem('zero_nivel_arriba', (zeroReading?.nivel || 0).toString());
            sessionStorage.setItem('has_hydraulic_violation', hasViolation ? 'true' : 'false');
            sessionStorage.setItem('k0_pzas', pzas.toString());
            sessionStorage.setItem('k0_ancho', ancho.toString());
            setFlowAtZero(currentFlowAtZero);
            // Mismo umbral STALE_MIN=240min (4h) que esFresco() en coherenciaCanal.
            const zeroAgeMin = zeroReading?.timestamp ? (Date.now() - zeroReading.timestamp) / 60000 : Infinity;
            setFlowAtZeroFresh(zeroAgeMin <= 240);
            
        } catch (err) {
            console.error("PublicMonitor fetch error", err);
        }
    }, [activeEvent]);

    useEffect(() => {
        fetchData();

        // Realtime: refresca al instante cuando llegan nuevas lecturas
        const unsubEscalas  = onTable('lecturas_escalas',   '*', fetchData);
        const unsubPresas   = onTable('lecturas_presas',    '*', fetchData);
        const unsubMov      = onTable('movimientos_presas', '*', fetchData);
        const unsubSeguim   = onTable('sica_llenado_seguimiento', 'UPDATE', fetchData);

        // Fallback polling cada 5 min (cubre reconexiones y gaps de Realtime)
        const interval = setInterval(fetchData, 300_000);

        return () => {
            unsubEscalas();
            unsubPresas();
            unsubMov();
            unsubSeguim();
            clearInterval(interval);
        };
    }, [fetchData]);

    // ── Alertas activas — últimas 5, con toast Realtime para críticas ────
    useEffect(() => {
        const fetchAlertas = async () => {
            const { data } = await supabase
                .from('registro_alertas')
                .select('id, tipo_riesgo, titulo, mensaje, fecha_deteccion')
                .eq('resuelta', false)
                .order('fecha_deteccion', { ascending: false })
                .limit(200);
            // Las críticas primero: con 5 avisos más recientes, una crítica anterior quedaba fuera de la lista.
            // Todas las sin resolver, por severidad y luego fecha. El conteo usa el
            // MISMO criterio que el menú lateral y el Dashboard (useAlertasRegistro):
            // solo las vigentes (≤ DIAS_ALERTA_VIGENTE días); las antiguas van aparte.
            const rango = (t: string) => t === 'critical' ? 0 : t === 'warning' ? 1 : 2;
            if (data) setActiveAlertas([...(data as any[])].sort((a, b) => rango(a.tipo_riesgo) - rango(b.tipo_riesgo)));
        };
        fetchAlertas();

        const unsubAlertas = onTable('registro_alertas', 'INSERT', (payload) => {
            fetchAlertas();
            const row = payload.new as RegistroAlertaRow;
            if (row?.tipo_riesgo === 'critical') {
                toast.error(`🚨 ${row.titulo}`, {
                    description: row.mensaje?.slice(0, 120),
                    duration: 8000,
                });
            } else if (row?.tipo_riesgo === 'warning') {
                toast.warning(`⚠️ ${row.titulo}`, {
                    description: row.mensaje?.slice(0, 120),
                    duration: 6000,
                });
            }
        });

        return () => unsubAlertas();
    }, []);

    // 5. Predicted Front Position (Hydra Engine Logic)
    // Tránsito calibrado Presa Boquilla → K-0+000 = 7.56 h (454 min, medido en
    // protocolo de llenado). Antes 3.0 km/h ⇒ 12 h, sobreestimando 4.4 h la llegada.
    const vRio = 36 / 7.56; // ≈ 4.76 km/h
    const vCanalDefault = 4.17; // km/h (diseño)

    const predictedMaxKm = useMemo(() => {
        // 1. Find the latest confirmed point (Anchor)
        let startTime = activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : currentTime;
        let startKm = -36;

        // Buscar el ancla más avanzada
        const sortedKms = Object.keys(anchorTimes).map(Number).sort((a,b) => b - a);
        const topAnchor = sortedKms[0];
        
        if (topAnchor !== undefined && anchorTimes[topAnchor]) {
            startTime = new Date(anchorTimes[topAnchor]).getTime();
            startKm = topAnchor;
        }

        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        if (elapsedHours <= 0) return startKm;

        // Modelo A: v = 4.5 × Q^0.15 km/h (BC-07 reconciliado, skill v3.7 §5.1 — error <2% vs anclas K-23/K-104)
        const qK0vis = escalas.find(e => e.km === 0)?.gasto_actual ?? 20;
        const vCanal = activeEvent?.evento_tipo === 'LLENADO'
            ? 4.5 * Math.pow(Math.max(qK0vis, 0.5), 0.15)
            : vCanalDefault;

        let currentKm = startKm;
        let remainingHours = elapsedHours;

        if (currentKm < 0) {
            const timeToZero = Math.abs(currentKm) / vRio;

            if (remainingHours <= timeToZero) {
                currentKm += remainingHours * vRio;
                remainingHours = 0;
            } else {
                // Potential Block at KM 0: Waiting for scale confirmation at TOMA 0+000
                if (realMaxKm < 0) {
                    return 0; // System blocks at zero until confirmed in SICA Capture
                }
                currentKm = 0;
                remainingHours -= timeToZero;
            }
        }

        if (remainingHours > 0) {
            currentKm += remainingHours * vCanal;
        }

        // --- REGLA DE FISICA: ANCLAJE A TELEMETRIA ---
        // Si hay una escala adelante con lectura confirmada de 0.00m, el frente NO puede haber pasado por ahi.
        const dryBlockedScale = escalas.find(e => 
            e.km > realMaxKm && 
            e.km < currentKm && 
            e.nivel_actual === 0 && 
            e.ultima_telemetria
        );

        if (dryBlockedScale) {
            // El frente se queda 1km antes de la escala que reporta estar seca
            return Math.max(realMaxKm, dryBlockedScale.km - 0.5);
        }

        return Math.min(currentKm, 113);
    }, [activeEvent, realMaxKm, escalas, currentTime, anchorTimes]);

    // El avance del frente depende de telemetría confirmada O el modelado de travesía (Hidro-Sincronía)
    const displayMaxKm = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return 113;
        return Math.max(realMaxKm, predictedMaxKm);
    }, [realMaxKm, predictedMaxKm, activeEvent]);

    const isWaitingAtZero = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return false;
        
        // El bloqueo solo aplica si el frente estimado o real no han pasado la toma
        if (displayMaxKm > 0.5) return false;
        
        // Si ya hay confirmación de apertura en SICA Capture para hoy
        const storedApertura = parseFloat(sessionStorage.getItem('zero_radial_apertura') || '0');
        if (storedApertura > 0) return false;

        const startTime = new Date(activeEvent.hora_apertura_real!).getTime();
        const elapsedHours = (currentTime - startTime) / (1000 * 3600);
        return elapsedHours > (36 / vRio); // Tiempo mínimo para llegar de Boquilla a Toma
    }, [activeEvent, displayMaxKm, currentTime, vRio]);

    // Mapeo de distancias para el Río (GeoMonitor style)
    const rioDistData = useMemo(() => {
        if (!geoRio) return [];
        const coords = geoRio.features?.[0]?.geometry?.coordinates as [number, number][];
        if (!coords) return [];
        let total = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: -36 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            total += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: -36 + total });
        }
        const factor = total > 0 ? 36 / total : 1;
        data.forEach(d => d.dist = -36 + (d.dist + 36) * factor);
        return data;
    }, [geoRio]);

    const canalDistData = useMemo(() => {
        if (!geoCanal) return [];
        const coords = geoCanal.features?.[0]?.geometry?.coordinates as [number, number][];
        if (!coords) return [];
        let total = 0;
        const data = [{ lat: coords[0][1], lng: coords[0][0], dist: 0 }];
        for (let i = 1; i < coords.length; i++) {
            const d = haversineDist(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
            total += d;
            data.push({ lat: coords[i][1], lng: coords[i][0], dist: total });
        }
        const factor = total > 0 ? 104 / total : 1;
        data.forEach(d => d.dist *= factor);
        return data;
    }, [geoCanal]);

    const rioFullLength = useMemo(() => rioDistData.map(d => [d.lat, d.lng] as [number, number]), [rioDistData]);
    const canalFullLength = useMemo(() => canalDistData.map(d => [d.lat, d.lng] as [number, number]), [canalDistData]);
    
    const hydratedPath = useMemo(() => {
        const rioPart = rioDistData.filter(d => d.dist <= displayMaxKm).map(d => [d.lat, d.lng] as [number, number]);
        const canalPart = displayMaxKm > 0 ? canalDistData.filter(d => d.dist <= displayMaxKm).map(d => [d.lat, d.lng] as [number, number]) : [];
        return [...rioPart, ...canalPart];
    }, [rioDistData, canalDistData, displayMaxKm]);

    // Segmento del canal que aún no ha sido alcanzado por el frente de ola (LLENADO).
    // Se renderiza como trazo punteado oscuro para indicar el tramo por recorrer.
    const dryPath = useMemo(() => {
        if (!activeEvent || activeEvent.evento_tipo !== 'LLENADO') return [];
        const fromKm = Math.max(0, displayMaxKm);
        return canalDistData
            .filter(d => d.dist >= fromKm)
            .map(d => [d.lat, d.lng] as [number, number]);
    }, [activeEvent, canalDistData, displayMaxKm]);
    
    // Position for the Pulse Marker
    const frontCoords = useMemo(() => {
        if (hydratedPath.length === 0) return [27.545, -105.414]; // Presa approx start
        const last = hydratedPath[hydratedPath.length - 1];
        if (!last || typeof last[0] !== 'number' || typeof last[1] !== 'number') return [27.545, -105.414];
        return last;
    }, [hydratedPath]);

    // ── MODO DE VISUALIZACIÓN — discriminante explícito por tipo de evento ──
    // Reemplaza la condición binaria LLENADO / !LLENADO. Cada modo tiene
    // identidad propia: etiqueta pública, color semáforo e ícono de cabecera.
    type ModoVisualizacion = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA' | 'VACIADO' | 'ANOMALIA' | 'SIN_EVENTO';

    const MODO_CONFIG: Record<ModoVisualizacion, { label: string; color: string; kpi0Label: string }> = {
        LLENADO:        { label: 'LLENADO EN TRÁNSITO',   color: '#06b6d4', kpi0Label: 'ENTREGA KM 0:' },
        ESTABILIZACION: { label: 'DISTRIBUCIÓN ACTIVA',   color: '#22c55e', kpi0Label: 'FLUJO K0+000:' },
        CONTINGENCIA:   { label: 'CONTINGENCIA — LLUVIA', color: '#f59e0b', kpi0Label: 'FLUJO K0+000:' },
        VACIADO:        { label: 'VACIADO CONTROLADO',    color: '#c084fc', kpi0Label: 'FLUJO K0+000:' },
        ANOMALIA:       { label: 'ANOMALÍA DETECTADA',    color: '#ef4444', kpi0Label: 'FLUJO K0+000:' },
        SIN_EVENTO:     { label: 'MONITOREO CONTINUO',    color: '#22c55e', kpi0Label: 'FLUJO K0+000:' },
    };

    const modoVisualizacion: ModoVisualizacion = !activeEvent
        ? 'SIN_EVENTO'
        : activeEvent.evento_tipo === 'LLENADO'             ? 'LLENADO'
        : activeEvent.evento_tipo === 'ESTABILIZACION'      ? 'ESTABILIZACION'
        : activeEvent.evento_tipo === 'CONTINGENCIA_LLUVIA' ? 'CONTINGENCIA'
        : activeEvent.evento_tipo === 'VACIADO'             ? 'VACIADO'
        : 'ANOMALIA';

    const modoActual = MODO_CONFIG[modoVisualizacion];
    const protocolLabel = modoActual.label;
    const statusColor   = modoActual.color;

    // Helper to format exact time ago for telemetry (Pure version using explicit now)
    const formatTimeAgo = (timestamp?: number | null, now: number = currentTime) => {
        if (!timestamp) return 'SIN DATOS';
        const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
        if (diffSeconds < 60) return `HACE ${diffSeconds}s`;
        const diffMins = Math.floor(diffSeconds / 60);
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        const remainingMins = diffMins % 60;
        return `${diffHours}h ${remainingMins}m`;
    };

    // Expose Anchor for UI
    const topAnchorKm = useMemo(() => {
        const sorted = Object.keys(anchorTimes).map(Number).sort((a,b) => b - a);
        return sorted[0];
    }, [anchorTimes]);

    // 4. Calculate Dynamic Target Estimation (Hydra Engine Logic)
    const nextTargetInfo = useMemo(() => {
        if (!escalas || escalas.length === 0) return { name: "Buscando...", hours: 0, mins: 0, kmRemaining: '—' };
        
        if (isWaitingAtZero) {
            return {
                name: "TOMA 0+000 (ESPERA)",
                hours: 0,
                mins: 0,
                kmRemaining: "0.0",
                arrivalTime: "PENDIENTE",
                elapsed: formatTimeAgo(activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : null),
                status: "ESTADO: ESPERANDO APERTURA"
            };
        }

        const anchorTimeStr = sessionStorage.getItem(`anchor_time_${realMaxKm}`);
        const effectiveStartTime = anchorTimeStr ? new Date(anchorTimeStr).getTime() : (activeEvent?.hora_apertura_real ? new Date(activeEvent.hora_apertura_real).getTime() : currentTime);
        const elapsedSinceAnchor = formatTimeAgo(effectiveStartTime);

        // Find the first scale that is geographically ahead of our current water front
        const sorted = [...escalas].sort((a,b) => a.km - b.km);
        const nextScale = sorted.find(e => e.km > displayMaxKm);
        
        if (!nextScale) return { name: "Terminado", hours: 0, mins: 0, kmRemaining: '—' };

        // Distance remaining to that specific checkpoint
        const distRemaining = nextScale.km - displayMaxKm;

        // Modelo A — celeridad dinámica BC-07 reconciliado (skill v3.7 §5.1)
        // v_onda = 4.5 × Q^0.15 km/h  (error <2% vs anclas K-23, K-104)
        // ESTABILIZACIÓN: mantiene 1.16 m/s (velocidad media Manning observada)
        const qK0 = escalas.find(e => e.km === 0)?.gasto_actual ?? 20;
        const vCanalKmh = activeEvent?.evento_tipo === 'LLENADO'
            ? 4.5 * Math.pow(Math.max(qK0, 0.5), 0.15)
            : 1.16 * 3.6;

        let totalHours = 0;
        if (displayMaxKm < 0) {
            // El frente está en el río
            const distInRio = Math.min(distRemaining, -displayMaxKm);
            const distInCanal = Math.max(0, distRemaining - distInRio);
            totalHours = (distInRio / vRio) + (distInCanal / vCanalKmh);
        } else {
            // El frente ya está en el canal
            totalHours = distRemaining / vCanalKmh;
        }

        const hr = Math.floor(totalHours);
        const min = Math.floor((totalHours - hr) * 60);

        const arrivalTimeUTC = currentTime + (totalHours * 3600 * 1000);

        return {
            name: nextScale.nombre.toUpperCase(),
            hours: hr,
            mins: min,
            kmRemaining: distRemaining.toFixed(1),
            arrivalTime: new Date(arrivalTimeUTC).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' }),
            elapsed: elapsedSinceAnchor,
            status: "AVANCE EN CANAL",
            vOndaKmh: +vCanalKmh.toFixed(1),
            qK0Usado: +qK0.toFixed(1),
        };
    }, [escalas, isWaitingAtZero, displayMaxKm, activeEvent, currentTime, vRio, realMaxKm, anchorTimes]);


    // 6. Executive/Managerial Metrics
    const executiveMetrics = useMemo(() => {
        const totalRequested = activeEvent?.gasto_solicitado_m3s || 0;

        // Vigencia de la extracción según su PROCEDENCIA:
        //  · movimiento de compuertas → sigue vigente hasta el siguiente
        //    movimiento (un cierre del 29-sep es "0 m³/s, cerrada" hoy, no S/D);
        //  · lectura diaria → vigente 24 h (captura diaria, no continua);
        //  · protocolo (LLENADO sin medición) → instrucción vigente.
        // Antes la frescura se medía con lecturas_presas.fecha aunque la
        // extracción viniera de un movimiento posterior: el encabezado decía
        // S/D mientras el pie del panel decía "BOQUILLA 0.0 m³/s".
        const vigente = (p: any): boolean => {
            if (p.extraccion_total == null || Number.isNaN(Number(p.extraccion_total))) return false;
            if (p.extraccion_fuente === 'movimiento' || p.extraccion_fuente === 'protocolo') return true;
            const t = p.extraccion_desde ? new Date(String(p.extraccion_desde).length <= 10 ? `${p.extraccion_desde}T12:00:00-06:00` : p.extraccion_desde).getTime() : NaN;
            return Number.isFinite(t) && (Date.now() - t) / 3_600_000 <= 24;
        };
        const vigentes = presasData.filter(vigente);
        const totalReal = vigentes.reduce((acc, p) => acc + Number(p.extraccion_total), 0);
        const fresh = vigentes.length > 0;
        // Boquilla es la ÚNICA fuente de K-0+000 (Madero aporta en la cola, K>100):
        // el balance río PRESA→K0 debe usar solo Boquilla.
        const boq = presasData.find(p => p.presa_id === 'PRE-001' || p.presas?.nombre_corto === 'Boquilla');
        const qBoquilla = boq && vigente(boq) ? Number(boq.extraccion_total) : null;
        // Todas las presas vigentes cerradas por movimiento → "cerrada desde …"
        const cerradaDesde = fresh && totalReal === 0 && vigentes.every(p => p.extraccion_fuente === 'movimiento')
            ? vigentes.map(p => p.extraccion_desde).sort().slice(-1)[0] as string
            : null;

        const efficiency = totalRequested > 0 ? (totalReal / totalRequested) * 100 : 0;
        const healthStatus = efficiency > 95 ? 'OPTIMO' : efficiency > 85 ? 'PRECAUCIÓN' : 'REVISIÓN';
        const healthColor = efficiency > 95 ? '#22c55e' : efficiency > 85 ? '#eab308' : '#ef4444';

        return {
            totalReal,
            efficiency,
            healthStatus,
            healthColor,
            fresh,
            qBoquilla,
            cerradaDesde,
            vigente,
        };
    }, [activeEvent, presasData]);

    // ── Coherencia hidráulica K0→K104 (solo ESTABILIZACIÓN) ──────────────────
    // Verifica que el gasto medido en cada escala sea consistente con
    // la fuente (presa) considerando pérdidas esperadas por tramo.
    const coherenciaCanal = useMemo(() => {
        if (activeEvent?.evento_tipo === 'LLENADO') return null;

        // Fuente única: executiveMetrics.totalReal ya reconcilia 3 capas por
        // presa (lectura diaria → movimiento más reciente → protocolo). Antes
        // se usaba damMovements[0]?.gasto_m3s como primario: ese array es el
        // top-5 de movimientos_presas SIN filtrar por presa, ordenado por
        // fecha entre las 3 presas del sistema (Boquilla/Madero/Delicias) —
        // si otra presa registraba un movimiento más reciente que Boquilla,
        // su gasto se colaba aquí como "gasto de la presa" del Canal Conchos,
        // divergiendo del header (que sí usa executiveMetrics.totalReal) en
        // la misma pantalla al mismo tiempo.
        const qPresa = executiveMetrics.qBoquilla ?? 0;
        const qPresaVigente = executiveMetrics.qBoquilla != null;
        // Solo lecturas de gasto FRESCAS (<4 h). Una lectura vencida no debe
        // alimentar eficiencia/pérdidas/IEC y presentarse como estado en vivo
        // (mismo criterio que el panel SKILL y el perfil hidráulico).
        const STALE_MIN = 240;
        const esFresco = (e: EscalaData) =>
            e.ultima_telemetria != null && (Date.now() - e.ultima_telemetria) / 60000 <= STALE_MIN;
        const escOrdenadas = [...escalas]
            .filter(e => e.km >= 0 && e.km <= 104 && e.gasto_actual !== null && (e.gasto_actual ?? 0) > 0 && esFresco(e))
            .sort((a, b) => a.km - b.km);

        if (escOrdenadas.length === 0) return null;

        // Pérdida esperada en río (36 km): ~2-5% por km ≈ 8% total
        const qK0Esperado = qPresa * 0.92;
        const escK0   = escOrdenadas.find(e => e.km === 0);
        const escK104 = escOrdenadas.find(e => e.km >= 104);
        // qK0Medido = SOLO el gasto real de K-0. Si K-0 no tiene lectura fresca,
        // NO sustituir por escOrdenadas[0]: ese fallback rotulaba el caudal de
        // otra escala (la primera fresca) como "K0+000" → la cadena PANORAMA
        // mostraba 9.9 mientras la tarjeta de K-0 mostraba su valor real 21.6.
        const k0Disponible = !!escK0;
        const qK0Medido = escK0?.gasto_actual ?? 0;

        // Verificación de coherencia por punto: cada Q debe ser ≤ Q del punto anterior
        // tolerancia ±15% para lecturas de campo
        const puntos = escOrdenadas.map((e, i) => {
            const qRef = i === 0 ? qK0Medido : (escOrdenadas[i - 1].gasto_actual ?? 0);
            const q    = e.gasto_actual ?? 0;
            const delta = qRef > 0 ? ((q - qRef) / qRef) * 100 : 0;
            // q puede subir si hay retorno o error de lectura — flagear si sube >15%
            const coherente = delta <= 15 && delta >= -80;
            return { ...e, q, qRef, delta, coherente };
        });

        const nCoherentes = puntos.filter(p => p.coherente).length;
        // qFinal = caudal de salida REAL. Si no hay lectura fresca en K-104, no
        // existe "salida del canal" medida; usamos el último punto disponible
        // pero marcamos el tramo como parcial para no llamarlo eficiencia total.
        const ultimo      = escOrdenadas[escOrdenadas.length - 1];
        const qFinal      = ultimo?.gasto_actual ?? 0;
        const tramoCompleto = !!escK0 && !!escK104;   // ¿K-0 y K-104 ambos medidos?
        // Eficiencia de conducción SOLO válida de extremo a extremo (K-0→K-104).
        // Antes: qFinal/qK0 con un solo punto daba 100% imposible presentado como real.
        const eficiencia  = (tramoCompleto && qK0Medido > 0) ? (qFinal / qK0Medido) * 100 : null;
        const perdidaRio  = (escK0 && qPresaVigente && qPresa > 0) ? qPresa - qK0Medido : null;
        const perdidaCanal = (tramoCompleto && qK0Medido > 0) ? qK0Medido - qFinal : null;

        return {
            qPresa,
            qPresaVigente,
            qK0Esperado,
            qK0Medido,
            k0Disponible,
            qFinal,
            tramoCompleto,
            kmFinal: ultimo?.km ?? null,
            eficiencia,
            perdidaRio,
            perdidaCanal,
            puntos,
            nCoherentes,
            totalPuntos: puntos.length,
        };
    }, [activeEvent, executiveMetrics, escalas, currentTime]);

    // Modelo FGV (flujo permanente gradualmente variado): solo con gasto VIGENTE
    // medido en K-0 y fuera de VACIADO. Antes, sin lectura fresca se enviaba
    // q = 0 y el motor (que fija un piso numérico de 0.5 m³/s) devolvía
    // "Q salida 0.5 · tránsito 19.5 h": cifras que nadie midió.
    const fgvAplicable = !!coherenciaCanal && coherenciaCanal.k0Disponible
        && coherenciaCanal.qK0Medido >= 1 && modoVisualizacion !== 'VACIADO';
    const fgvMotivo = !coherenciaCanal || !coherenciaCanal.k0Disponible
        ? 'K-0+000 sin gasto medido en las últimas 4 h'
        : modoVisualizacion === 'VACIADO' ? 'el canal está en vaciado (el modelo supone flujo permanente)'
        : 'gasto en K-0+000 menor a 1 m³/s';

    // isEstabilizacion: true para ESTABILIZACION y SIN_EVENTO (comportamiento visual idéntico).
    // No incluye CONTINGENCIA/VACIADO/ANOMALIA — esos modos conservan el mapa de alertas
    // pero podrán tener su propia capa de indicadores en futuras iteraciones.
    const isEstabilizacion = modoVisualizacion === 'ESTABILIZACION'
                          || modoVisualizacion === 'SIN_EVENTO'
                          || modoVisualizacion === 'CONTINGENCIA'
                          || modoVisualizacion === 'VACIADO'
                          || modoVisualizacion === 'ANOMALIA';
    // El perfil longitudinal se dibuja dentro de la pestaña CANAL (antes era un
    // modal a pantalla completa que tapaba el canal).
    const perfilVisible = isDockVisible && dockTab === 'canal';

    // ── IEC — Índice de Estado del Canal ─────────────────────────────────────
    const iecData = useMemo(() => {
        if (!coherenciaCanal || !isEstabilizacion) return null;
        // El IEC pondera la eficiencia de conducción (30/100 pts). Sin medición
        // extremo a extremo (K-0→K-104 frescos) esa eficiencia es null; calcular
        // el IEC con eficiencia=0 daría un puntaje artificialmente bajo presentado
        // como real. En ese caso no publicamos IEC (el badge simplemente no aparece).
        if (coherenciaCanal.eficiencia === null) return null;
        const escalasConDatos = escalas.filter(e => e.nivel_actual !== null && e.nivel_max_operativo !== null);
        const escalasEnCritico = escalasConDatos.filter(e => {
            const pct = (e.nivel_actual ?? 0) / (e.nivel_max_operativo as number); // escalasConDatos ya exige bordo
            return pct >= 0.92;
        }).length;
        return calcIEC({
            eficiencia:       coherenciaCanal.eficiencia ?? 0,
            n_coherentes:     coherenciaCanal.nCoherentes,
            total_puntos:     coherenciaCanal.totalPuntos,
            q_fuga_total:     null, // sin medición de fugas: el componente se excluye (antes: 0 = 25 pts gratis)
            q_entrada:        coherenciaCanal.qK0Medido,
            escalas_criticas: escalasEnCritico,
            total_escalas:    escalasConDatos.length,
        });
    }, [coherenciaCanal, escalas, isEstabilizacion]);

    // ── IEC Histórico (localStorage, buffer 30 días) ──────────────────────────
    const IEC_LS_KEY = 'iec_historico_v1';
    const iecHistorico = useMemo((): { fecha: string; iec: number; sem: string }[] => {
        try { return JSON.parse(localStorage.getItem(IEC_LS_KEY) ?? '[]'); } catch { return []; }
    }, []);

    useEffect(() => {
        if (!iecData) return;
        const hoy = getTodayString();
        try {
            const hist: { fecha: string; iec: number; sem: string }[] =
                JSON.parse(localStorage.getItem(IEC_LS_KEY) ?? '[]');
            const filtered = hist.filter(h => h.fecha !== hoy);
            const updated = [...filtered, { fecha: hoy, iec: iecData.iec, sem: iecData.semaforo }]
                .sort((a, b) => a.fecha.localeCompare(b.fecha))
                .slice(-30); // últimos 30 días
            localStorage.setItem(IEC_LS_KEY, JSON.stringify(updated));
        } catch { /* ignore */ }
    }, [iecData]);

    // ── Skill Snapshot — datos actuales para extracción por Claude ───────────
    // Se recalcula cada vez que `escalas` cambia (suscripción Realtime activa).
    // Fetch vol_interescalas, vol_zonas y tomas activas — refresco cada 5 min
    useEffect(() => {
        const fetchVolumetria = async () => {
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(new Date());
            const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' })
                .format(new Date(Date.now() - 86_400_000));
            const [viRes, vzRes, tomasRes, bmRes, ehRes] = await Promise.all([
                supabase.from('vol_interescalas')
                    .select('esc_up, km_up, esc_down, km_down, longitud_km, nivel_up_m, nivel_down_m, nivel_ini_m, nivel_fin_m, ancho_canal_m, vol_m3, vol_mm3')
                    .order('km_up', { ascending: true }),
                supabase.from('vol_zonas')
                    .select('codigo, zona_nombre, km_inicio, km_fin, n_tramos, nivel_medio_m, tirante_diseno_m, bordo_libre_m, y_capacidad_m, vol_actual_m3, vol_actual_mm3, vol_diseno_m3, vol_capacidad_m3, pct_llenado')
                    .order('km_inicio', { ascending: true }),
                supabase.from('reportes_operacion')
                    .select('*, puntos_entrega(nombre, km)')
                    .eq('fecha', today)
                    .in('estado', ['inicio', 'continua', 'reabierto', 'modificacion']),
                supabase.from('balance_volumen_modulo')
                    .select('modulo_id, modulo_nombre, codigo_corto, zona_id, zona_codigo, zona_nombre, es_primaria, ciclo_id, vol_base_m3, vol_base_consumido_m3, vol_adicional_consumido_m3, vol_total_consumido_m3, vol_base_disponible_m3, pct_base_consumido, estado_volumen, ultimo_adicional_fecha')
                    .order('modulo_id', { ascending: true }),
                // Igual que sica-capture Monitor: fecha >= ayer, gasto > 0, orden desc → deduplicar más reciente
                supabase.from('entregas_modulo')
                    .select('modulo_id, zona_id, tipo_entrega, gasto_lps, gasto_m3s, volumen_m3, hora_inicio, hora_fin, estado_operativo, motivo_adicional, fecha')
                    .gte('fecha', yesterday)
                    .gt('gasto_m3s', 0)
                    .order('fecha', { ascending: false }),
            ]);
            if (!viRes.error)    setVolInterescalas(viRes.data  || []);
            if (!vzRes.error)    setVolZonas(vzRes.data         || []);
            if (!tomasRes.error) setTomasActivas(tomasRes.data  || []);
            if (!bmRes.error)    setBalanceModulos(bmRes.data   || []);
            if (!ehRes.error) {
                // Deduplicar: más reciente por modulo_id + zona_id + tipo_entrega
                const latestMap = new Map<string, any>();
                for (const e of (ehRes.data || [])) {
                    const key = `${e.modulo_id}_${e.zona_id ?? ''}_${e.tipo_entrega}`;
                    if (!latestMap.has(key)) latestMap.set(key, e);
                }
                setEntregasHoy(Array.from(latestMap.values()));
            }

            // Balance hidrico por tramo — detecta fugas y extracciones no registradas
            const btRes = await supabase.rpc('fn_balance_hidrico_tramos', { p_fecha: today });
            if (!btRes.error) setBalanceTramos(btRes.data || []);

            // Volumen autorizado vs entregado del ciclo (única fuente)
            setVolCiclo(await fetchVolumenCiclo());

        };
        fetchVolumetria();
        const interval = setInterval(fetchVolumetria, 5 * 60 * 1000);
        // Refrescar también cuando llega una nueva lectura de escala (misma fuente que vol_interescalas)
        const unsubVol = onTable('lecturas_escalas', 'INSERT', fetchVolumetria);
        return () => { clearInterval(interval); unsubVol(); };
    }, []);

    const skillSnapshot = useMemo(() => {
        // ── DOS conceptos de "zona" distintos — no confundirlos ──────────────
        //  1) VOLUMEN almacenado: límites geométricos de zonas_canal (vía vol_zonas):
        //     Z1 0–48.42, Z2 48.42–67.32, Z3 67.32–71.91, Z4 79.025–104.
        //     Esas fronteras NO caen en escalas → no sirven para diferencial de Q.
        //  2) Q EXTRAÍDO por zona: escalas de control de extracción (skill v3.7):
        //     Z1 K-23→K-29, Z2 K-34→K-44, Z3 K-54→K-68, Z4 K-79+025→K-94+057.
        //     El caudal de zona = Q_entrada − Q_salida entre ese par de escalas.
        // Antes se mezclaban: se buscaba escala en los km de zonas_canal (48.42…),
        // que nunca existe → q_real siempre null → balance nunca válido.
        // Solo usar Q de una escala si su telemetría es reciente (<4h = 240 min).
        // Si está FUERA_DE_LINEA/CRITICO, tratar como null para no contaminar el balance.
        const MAX_STALE_MIN = 240;
        const escalaFresh = (km: number) => {
            const e = escalas.find(e => Math.abs(e.km - km) < 0.5);
            if (!e || !e.ultima_telemetria) return null;
            const mins = (Date.now() - e.ultima_telemetria) / 60000;
            return mins <= MAX_STALE_MIN ? e : null;
        };
        // Último dato CONOCIDO de una escala, sin filtro de frescura. Devuelve el
        // gasto medido y su antigüedad (min) para mostrarlo como "histórico" cuando
        // la lectura fresca no existe — referencia atenuada, no medición en vivo.
        const escalaUlt = (km: number): { gasto: number; ageMin: number } | null => {
            const e = escalas.find(e => Math.abs(e.km - km) < 0.5);
            if (!e || !e.ultima_telemetria || (e.gasto_actual ?? 0) <= 0) return null;
            return { gasto: e.gasto_actual as number, ageMin: (Date.now() - e.ultima_telemetria) / 60000 };
        };
        const ZONAS_CONTROL = [
            { codigo: 'Z1', km_in: 23,     km_out: 29,     q_obj: 2.400 },
            { codigo: 'Z2', km_in: 34,     km_out: 44,     q_obj: 2.750 },
            { codigo: 'Z3', km_in: 54,     km_out: 68,     q_obj: 4.635 },
            { codigo: 'Z4', km_in: 79.025, km_out: 94.057, q_obj: 4.200 },
        ];
        // ── Q EXTRAÍDO POR ZONA = Σ ENTREGAS reales a usuarios ──────────────────
        // FUENTE CORRECTA: la extracción de una zona es el agua ENTREGADA a sus
        // módulos (entregas_modulo, base+adicional), capturada en campo.
        //
        // NO usar el diferencial entre escalas (Q_in − Q_out): ese diferencial
        // incluye las FUGAS del tramo (azolve, infiltración) y NO es extracción a
        // usuarios. Sumarlo inflaba Q_zonas a ~39 m³/s (> Q0=34), dando pérdidas
        // NEGATIVAS imposibles. El diferencial ya se usa aparte como detector de
        // fugas ("FUGA ALTA"), no debe entrar al balance de extracción.
        const zonaIdToCodigo = new Map<string, string>(
            volZonas.map((v: any) => [v.zona_id as string, v.codigo as string])
        );
        const entregasPorZona = new Map<string, number>();   // codigo Zn → Q m³/s
        for (const e of entregasHoy) {
            const cod = e.zona_id ? zonaIdToCodigo.get(e.zona_id) : undefined;
            if (!cod) continue;
            entregasPorZona.set(cod, (entregasPorZona.get(cod) ?? 0) + Number(e.gasto_m3s ?? 0));
        }
        const ZONAS_SKILL = ZONAS_CONTROL.map(z => {
            // escalas de control: solo para etiquetar y para el detector de fugas,
            // NO para el Q extraído del balance.
            const escIn  = escalaFresh(z.km_in);
            const escOut = escalaFresh(z.km_out);
            // Q extraído = suma de entregas de hoy de la zona (extracción real).
            const q_ent = entregasPorZona.get(z.codigo);
            const q_real  = q_ent && q_ent > 0 ? +q_ent.toFixed(3) : null;
            const q_fuente: 'entregas' | null = q_real !== null ? 'entregas' : null;
            // Volumen/pct/nivel: de vol_zonas (BD), emparejado por código de zona.
            const vz = volZonas.find(v => v.codigo === z.codigo);
            return {
                nombre:        z.codigo,
                // km_ini/km_fin = escalas de CONTROL de Q (no las fronteras geométricas
                // de vol_zonas). escala_in/out lo dejan explícito en el snapshot.
                km_ini:        z.km_in,
                km_fin:        z.km_out,
                escala_in:     escIn?.nombre  ?? `K-${z.km_in}`,
                escala_out:    escOut?.nombre ?? `K-${z.km_out}`,
                q_objetivo:    z.q_obj,
                q_real:        q_real !== null ? +q_real.toFixed(3) : null,
                q_fuente,                          // 'entregas' | null
                q_real_stale:  q_real === null,   // true si la zona no tiene entregas hoy
                vol_mm3:       vz?.vol_actual_mm3 != null ? +Number(vz.vol_actual_mm3).toFixed(4) : null,
                pct_llenado:   vz?.pct_llenado    != null ? +Number(vz.pct_llenado).toFixed(1)    : null,
                nivel_medio_m: vz?.nivel_medio_m  != null ? +Number(vz.nivel_medio_m).toFixed(3)  : null,
                n_tramos:      vz?.n_tramos        != null ? +Number(vz.n_tramos)                  : null,
            };
        });
        const Q_ZONAS_OBJ  = ZONAS_SKILL.reduce((s, z) => s + z.q_objetivo, 0);
        // Extracciones de zona MEDIDAS: solo suma zonas con q_real real (telemetría
        // en ambas escalas frontera). Las zonas sin medición quedan fuera del balance
        // — NO se sustituyen por q_objetivo, para no mezclar caudal medido con diseño.
        const N_ZONAS_ESPERADAS = 4;   // Z1–Z4
        const zonasMedidas  = ZONAS_SKILL.filter(z => z.q_real !== null);
        const Q_ZONAS_REAL  = zonasMedidas.reduce((s, z) => s + (z.q_real ?? 0), 0);
        // Completas solo si las 4 zonas tienen Q extraído MEDIDO (ambas escalas de
        // control frescas y con gasto). Sin las 4, el balance global no es confiable.
        const zonasCompletas = zonasMedidas.length === N_ZONAS_ESPERADAS;
        const q0   = escalaFresh(0)?.gasto_actual   ?? null;   // null cuando STALE
        const q104 = escalaFresh(104)?.gasto_actual ?? null;   // null cuando STALE
        // Último dato conocido (histórico) — solo para PRESENTACIÓN cuando no hay
        // lectura fresca. Nunca entra al balance (perdidas/eficiencia/λ).
        const q0Ult   = escalaUlt(0);
        const q104Ult = escalaUlt(104);
        // El balance Q0 − Q104 − Q_zonas tiene DOS modos:
        //  • 'vivo'    : K-0, K-104 y las 4 zonas frescas (<4h). Medición confiable.
        //  • 'parcial' : K-0 fresco + 4 zonas medidas (telemetría o entregas), pero
        //                K-104 usa el último dato conocido. Es una REFERENCIA, no una
        //                medición en vivo — se marca como tal en el panel.
        // Sin K-0 fresco o sin las 4 zonas, no hay balance (todo → S/D): no podemos
        // inventar la entrada ni la mitad de las extracciones.
        const q104Bal = q104 ?? (q104Ult ? q104Ult.gasto : null);   // fresco o histórico
        const balanceValido = q0 !== null && q104 !== null && zonasCompletas;     // 'vivo'
        const balanceParcial = !balanceValido && q0 !== null && q104Bal !== null && zonasCompletas;
        const balanceModo: 'vivo' | 'parcial' | null =
            balanceValido ? 'vivo' : balanceParcial ? 'parcial' : null;
        const q104Calc = balanceValido ? q104 : (balanceParcial ? q104Bal : null);
        const perdidas   = balanceModo ? q0! - q104Calc! - Q_ZONAS_REAL : null;
        const eficiencia = (balanceModo && q0! > 0) ? (q0! - Math.max(0, perdidas!)) / q0! * 100 : null;
        // λ dinámica = null cuando no hay balance. Antes caía a 0, lo que el panel
        // mostraba como "0.00000" — un valor que se lee como "pérdidas nulas medidas"
        // cuando en realidad NO hay medición. Mantenerlo null lo deja consistente.
        const lambda     = (perdidas !== null && q0! > 0) ? perdidas / 104 : null;

        const checkpoints = escalas
            .filter(e => e.km >= 0 && e.km <= 104)
            .sort((a, b) => a.km - b.km)
            .map(e => {
                // S/D = null, nunca 0 (un 0.000 se lee como "canal seco medido").
                const bl = e.nivel_max_operativo && e.nivel_actual != null ? +(e.nivel_max_operativo - e.nivel_actual).toFixed(3) : null;
                const ts_min = e.ultima_telemetria ? +((Date.now() - e.ultima_telemetria) / 60000).toFixed(0) : null;
                const telEst: TelemetriaEstado = telemetriaEstado(e.ultima_telemetria);
                return {
                    nombre:          e.nombre,
                    km:              e.km,
                    hA:              e.nivel_actual != null ? +e.nivel_actual.toFixed(3) : null,
                    hB:              e.nivel_abajo != null ? +e.nivel_abajo.toFixed(3) : null,
                    q:               e.gasto_actual != null ? +e.gasto_actual.toFixed(3) : null,
                    m1:              +getM1Factor(e.nombre, e.km).toFixed(4),
                    apertura:        e.apertura_actual != null ? +e.apertura_actual.toFixed(3) : null,
                    puertas_abiertas: e.puertas_abiertas ?? 0,
                    nivel_max:       e.nivel_max_operativo ?? null,
                    bl,
                    alerta:          bl !== null && bl < 0 ? 'NIVEL_CRITICO' : bl !== null && bl < 0.10 ? 'PRECAUCION' : null,
                    ts_min,
                    tel_estado:      telEst,
                };
            });

        const alertas = checkpoints.filter(c => c.alerta);

        // ── Estado de telemetría agregado (para banner gerencial) ───────────
        // Clasifica el estado GLOBAL del sistema para no mostrar "EN VIVO" cuando
        // en realidad todos los valores están S/D. Distingue tres situaciones que
        // antes se confundían en un muro de "0 / S/D":
        //   • frescos  : lecturas <60 min (operación normal, datos confiables)
        //   • atrasados: lecturas 60–240 min (datos útiles pero envejeciendo)
        //   • stale    : lecturas >240 min o sin telemetría (no confiable)
        const conTel    = checkpoints.filter(c => c.ts_min !== null);
        const frescos   = conTel.filter(c => (c.ts_min ?? 0) < 60).length;
        const atrasados = conTel.filter(c => (c.ts_min ?? 0) >= 60 && (c.ts_min ?? 0) <= MAX_STALE_MIN).length;
        const stale     = checkpoints.filter(c => c.ts_min === null || (c.ts_min ?? 0) > MAX_STALE_MIN).length;
        const sinFlujo  = conTel.filter(c => c.q == null || c.q <= 0).length;   // nivel presente pero sin gasto
        // Edad de la lectura más reciente del sistema (min). null si nada reportó.
        const tsMin = conTel.reduce<number | null>((min, c) => {
            const t = c.ts_min ?? Infinity;
            return min === null || t < min ? t : min;
        }, null);
        // El estado GLOBAL debe reflejar la COBERTURA de frescura, no la mejor
        // lectura. Antes usaba tsMin (la escala más nueva) → mostraba "EN VIVO·2min"
        // aunque 8/14 escalas estuvieran vencidas y casi todos los tramos en S/D.
        // Ahora pondera cuántas escalas están realmente vigentes (<4h):
        //   EN_VIVO  : ≥80% vigentes y la mayoría <60 min
        //   ATRASADO : ≥50% vigentes (datos parciales pero utilizables)
        //   STALE    : <50% vigentes (como aquí: solo 6/14 → balance no confiable)
        const total       = checkpoints.length;
        const vigentes    = frescos + atrasados;                 // escalas <4h
        const pctVigentes = total > 0 ? vigentes / total : 0;
        const pctFrescos  = total > 0 ? frescos / total : 0;
        const telemetria_estado_global =
            conTel.length === 0      ? 'OFFLINE'
            : pctVigentes < 0.5      ? 'STALE'
            : pctFrescos  >= 0.8     ? 'EN_VIVO'
            : 'ATRASADO';
        const telemetria = {
            estado: telemetria_estado_global,
            total,
            vigentes,
            pct_vigentes: +(pctVigentes * 100).toFixed(0),
            frescos, atrasados, stale, sin_flujo: sinFlujo,
            edad_min_reciente: tsMin,
            balance_valido: balanceValido,
        };

        return {
            meta: {
                version:    '3.7',
                generado:   new Date().toISOString(),
                canal:      'Canal Principal Conchos',
                distrito:   'DR-005 Delicias',
                calibracion: '01/06/2026',
            },
            telemetria,
            constantes: { Cd: 0.62, Cv: 1.84, g: 9.81, Cd_gl: 1.84, n_gl: 1.52, MIN_H: 0.01, n_man: 0.015, C_ONDA: 0.80, F_ATEN: 0.27, lambda: +(lambda ?? LAMBDA_REF).toFixed(5) },
            M1_FACTORS,
            zonas: ZONAS_SKILL,
            Q_ZONAS_REAL:  +Q_ZONAS_REAL.toFixed(3),
            Q_ZONAS_TOTAL: +Q_ZONAS_OBJ.toFixed(3),
            Q_ZONAS_MEDIDAS: zonasMedidas.length,   // cuántas de las 4 zonas tienen extracción medida
            balance: {
                Q0:             q0 !== null ? +q0.toFixed(3) : null,
                Q104:           q104 !== null ? +q104.toFixed(3) : null,
                // Último dato conocido (histórico) — referencia atenuada cuando Q0/Q104
                // son null por telemetría vencida. NO entra al balance.
                Q0_hist:        q0Ult   ? +q0Ult.gasto.toFixed(3)   : null,
                Q0_age_min:     q0Ult   ? Math.round(q0Ult.ageMin)   : null,
                Q104_hist:      q104Ult ? +q104Ult.gasto.toFixed(3) : null,
                Q104_age_min:   q104Ult ? Math.round(q104Ult.ageMin) : null,
                Q_extracciones: +Q_ZONAS_REAL.toFixed(3),
                perdidas:       perdidas !== null ? +perdidas.toFixed(3) : null,
                eficiencia:     eficiencia !== null ? +eficiencia.toFixed(1) : null,
                lambda:         lambda !== null ? +lambda.toFixed(5) : null,
                balance_valido: balanceValido,
                balance_modo:   balanceModo,        // 'vivo' | 'parcial' | null
                zonas_completas: zonasCompletas,
            },
            alertas_nivel: alertas.map(c => ({ nombre: c.nombre, km: c.km, hA: c.hA, bl: c.bl, tipo: c.alerta })),
            checkpoints,
            // ── Volumetría hidráulica ──────────────────────────────────
            vol_interescalas: volInterescalas,
            vol_zonas: volZonas,
            // ── Balance dotación vs consumo por módulo ─────────────────
            modulos_balance: modulosResumen.map(b => ({
                modulo:             b.modulo_nombre,
                codigo:             b.codigo_corto,
                zona:               b.zona_codigo,
                // Única fuente (volumen_ciclo_modulo): a entregar vs entregado del ciclo.
                dotacion_Mm3:       +b.autorizado_mm3.toFixed(3),
                entregado_hoja_Mm3: +b.hoja_mm3.toFixed(3),
                remanente_Mm3:      +b.remanente_mm3.toFixed(3),
                consumido_Mm3:      +b.entregado_mm3.toFixed(3),
                disponible_Mm3:     +b.saldo_mm3.toFixed(3),
                pct:                b.pct_entregado != null ? +b.pct_entregado.toFixed(2) : null,
                estado:             b.estado_volumen === 'agotado' ? 'base_agotado' : b.estado_volumen === 'alerta' ? 'alerta_base' : 'normal',
            })),
            // ── Presas estado actual ───────────────────────────────────
            // `null` = SIN DATO, nunca 0: un consumidor de este payload no puede
            // distinguir un embalse vacío de uno sin lectura si ambos llegan como 0.
            presas: presasData.map(p => ({
                nombre:           p.presas?.nombre       ?? p.presas?.nombre_corto ?? '—',
                almacenamiento_mm3: p.almacenamiento_mm3 != null ? +Number(p.almacenamiento_mm3).toFixed(3) : null,
                porcentaje_llenado: p.porcentaje_llenado != null ? +Number(p.porcentaje_llenado).toFixed(1) : null,
                extraccion_m3s:   executiveMetrics.vigente(p) ? +Number(p.extraccion_total).toFixed(3) : null,
                escala_msnm:      p.escala_msnm != null ? +Number(p.escala_msnm).toFixed(3) : null,
                fecha:            p.fecha,
            })),
            // ── Tomas activas hoy ──────────────────────────────────────
            tomas_activas: tomasActivas.map(t => ({
                nombre:   t.puntos_entrega?.nombre ?? '—',
                km:       t.puntos_entrega?.km     ?? null,
                estado:   t.estado,
                caudal_ls: +(t.caudal_promedio ?? 0).toFixed(1),
                caudal_m3s: +((t.caudal_promedio ?? 0) / 1000).toFixed(4),
            })),
            // ── Entregas hoy por módulo ────────────────────────────────
            entregas_hoy: (() => {
                const seenSK = new Set<string>();
                const pairs2: { mid: string; zid: string | null }[] = [];
                for (const e of entregasHoy) {
                    const k = `${e.modulo_id}_${e.zona_id ?? ''}`;
                    if (!seenSK.has(k)) { seenSK.add(k); pairs2.push({ mid: e.modulo_id, zid: e.zona_id ?? null }); }
                }
                return pairs2.map(({ mid, zid }) => {
                    const metaPrimary = balanceModulos.find(b => b.modulo_id === mid && b.es_primaria);
                    const metaZone = balanceModulos.find(b => b.modulo_id === mid && (zid ? b.zona_id === zid : b.es_primaria)) ?? metaPrimary;
                    const base = entregasHoy.find(e => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'base');
                    const adic = entregasHoy.find(e => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'adicional');
                    return {
                        modulo:          metaPrimary?.modulo_nombre ?? mid,
                        codigo:          metaPrimary?.codigo_corto  ?? mid,
                        zona:            metaZone?.zona_codigo       ?? '—',
                        base_m3:         base ? +(base.volumen_m3).toFixed(2)  : null,
                        base_m3s:        base ? +(base.gasto_m3s).toFixed(4)   : null,
                        base_lps:        base ? +(base.gasto_lps).toFixed(2)   : null,
                        base_horario:    base ? `${base.hora_inicio ?? '—'}–${base.hora_fin ?? '—'}` : null,
                        adic_m3:         adic ? +(adic.volumen_m3).toFixed(2)  : null,
                        adic_m3s:        adic ? +(adic.gasto_m3s).toFixed(4)   : null,
                        adic_lps:        adic ? +(adic.gasto_lps).toFixed(2)   : null,
                        motivo:          adic?.motivo_adicional ?? null,
                        total_m3:        +((base?.volumen_m3 ?? 0) + (adic?.volumen_m3 ?? 0)).toFixed(2),
                    };
                });
            })(),
            evento_activo: activeEvent ? {
                id:              activeEvent.id,
                tipo:            activeEvent.evento_tipo,
                fecha_inicio:    activeEvent.fecha_inicio,
                gasto_solicitado: activeEvent.gasto_solicitado_m3s ?? null,
                hora_apertura:   activeEvent.hora_apertura_real ?? null,
                autorizado_por:  activeEvent.autorizado_por ?? null,
                notas:           activeEvent.notas ?? null,
            } : null,
            timestamp: new Date().toISOString(),
        };
    }, [escalas, volInterescalas, volZonas, balanceModulos, entregasHoy, presasData, tomasActivas, activeEvent, volCiclo, executiveMetrics]);

    // Cerrar el modal de perfil con Escape (accesibilidad de teclado)
    useEffect(() => {
        // El perfil ya no es modal (vive en la pestaña CANAL): nada que cerrar.
    }, []);

    const iecBreakdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = iecBreakdownRef.current;
        if (!el || !iecData) return;
        el.style.setProperty('--iec-color', iecColor(iecData.semaforo));
        el.style.setProperty('--iec-pef',   `${(iecData.p_eficiencia / 30) * 100}%`);
        el.style.setProperty('--iec-pcoh',  `${(iecData.p_coherencia / 25) * 100}%`);
        el.style.setProperty('--iec-pfug',  `${(iecData.p_fugas      / 25) * 100}%`);
        el.style.setProperty('--iec-pcrit', `${(iecData.p_criticos   / 20) * 100}%`);
    }, [iecData]);

    // ── Motor hidráulico FGV — se invoca al abrir el modal de perfil ────────
    useEffect(() => {
        if (!perfilVisible || !coherenciaCanal || !isEstabilizacion) return;
        if (!fgvAplicable) return;
        if (fgvData) return; // ya cargado en esta sesión de modal

        setFgvLoading(true);
        // Las abstracciones abruptas causan divergencia matemática (Picos) en la Ecuación de Energía
        // al integrar flujos subcríticos hacia aguas abajo sin incluir estructuras de control (radiales).
        // Por ello, en el Monitor Público enviamos un canal libre teórico.
        const tomas: any[] = [];

        const escalasConDatos = escalas.filter(e => e.nivel_actual !== null && e.nivel_max_operativo !== null);
        const escalasEnCritico = escalasConDatos.filter(e =>
            (e.nivel_actual ?? 0) / (e.nivel_max_operativo as number) >= 0.92 // escalasConDatos ya exige bordo
        ).length;

        supabase.functions.invoke('hydraulic-engine', {
            body: {
                q:                 coherenciaCanal.qK0Medido,
                km_inicio:         0,
                km_fin:            104,
                tomas,
                eficiencia:        coherenciaCanal.eficiencia ?? 0,
                n_coherentes:      coherenciaCanal.nCoherentes,
                total_puntos:      coherenciaCanal.totalPuntos,
                q_fuga_total:      0,
                escalas_criticas:  escalasEnCritico,
                total_escalas:     escalasConDatos.length,
            },
        }).then(({ data, error }) => {
            if (!error && data) setFgvData(data);
        }).finally(() => setFgvLoading(false));
    }, [perfilVisible, coherenciaCanal, isEstabilizacion, fgvAplicable]);

    // Limpiar cache FGV cuando cambia el gasto real que alimenta el motor —
    // NO en cada recálculo de coherenciaCanal (ese memo se recrea cada 60s
    // por currentTime aunque qK0Medido no cambie, y limpiar fgvData en cada
    // recreación reinvocaba la Edge Function hydraulic-engine cada 60s con
    // el modal de perfil abierto, pese al comentario "ya cargado en esta
    // sesión de modal" del efecto de arriba).
    useEffect(() => { setFgvData(null); }, [coherenciaCanal?.qK0Medido]);

    // Canal segmentado por color de alerta (modo ESTABILIZACIÓN)
    const canalAlertSegments = useMemo(() => {
        if (!isEstabilizacion || canalDistData.length === 0 || escalas.length === 0) return [];

        const sorted = [...escalas]
            .filter(e => typeof e.km === 'number')
            .sort((a, b) => a.km - b.km);

        if (sorted.length === 0) return [];

        const maxKm = canalDistData[canalDistData.length - 1]?.dist ?? 104;
        // N escalas → N+1 segments: [0→km0], [km0→km1], …, [km_{N-1}→maxKm]
        const breakpoints = [0, ...sorted.map(e => e.km), maxKm];
        // Color for segment i: downstream escala (sorted[i]), last segment reuses sorted[N-1]
        const colors = [
            ...sorted.map(e => escalaAlertColor(e, coherenciaCanal)),
            escalaAlertColor(sorted[sorted.length - 1], coherenciaCanal),
        ];

        const segments: { coords: [number, number][]; color: string }[] = [];
        for (let i = 0; i < breakpoints.length - 1; i++) {
            const fromKm = breakpoints[i];
            const toKm   = breakpoints[i + 1];
            const color  = colors[i] ?? '#64748b';
            const coords = canalDistData
                .filter(d => d.dist >= fromKm && d.dist <= toKm)
                .map(d => [d.lat, d.lng] as [number, number]);
            if (coords.length >= 2) segments.push({ coords, color });
        }
        return segments;
    }, [isEstabilizacion, canalDistData, escalas, coherenciaCanal]);

    // Tag de estado de telemetría reutilizable — única fuente de verdad para
    // todas las pestañas del dock (RESUMEN/CANAL/ALERTAS/SKILL). Antes cada
    // pestaña mostraba un "● EN VIVO / MONITOREO TOTAL ACTIVO" fijo que
    // contradecía el estado real cuando la telemetría estaba vencida.
    const renderStateTag = (liveLabel?: string) => {
        const t = skillSnapshot.telemetria;
        const cfg =
            t.estado === 'EN_VIVO'  ? { cls: 'dsk-state--live',  dot: '●', txt: liveLabel ?? 'EN VIVO' } :
            t.estado === 'ATRASADO' ? { cls: 'dsk-state--warn',  dot: '◐', txt: 'DATOS ATRASADOS' } :
            t.estado === 'STALE'    ? { cls: 'dsk-state--stale', dot: '○', txt: 'TELEMETRÍA VENCIDA' } :
                                      { cls: 'dsk-state--off',   dot: '⊘', txt: 'SIN TELEMETRÍA' };
        const edad = t.edad_min_reciente;
        const edadTxt = edad === null ? '—' : edad < 60 ? `${edad} min` : `${(edad / 60).toFixed(1)} h`;
        // Sufijo = COBERTURA de escalas vigentes (no la edad de la mejor lectura,
        // que daba "EN VIVO·2min" con 8/14 vencidas). En EN_VIVO sí muestra edad.
        const sufijo = t.estado === 'EN_VIVO' ? edadTxt : `${t.vigentes}/${t.total} vigentes`;
        return (
            <span className={`telemetry-tag dsk-state-tag ${cfg.cls}`}
                  title={`${t.vigentes}/${t.total} escalas vigentes (<4 h) · ${t.frescos} frescas <1h / ${t.atrasados} 1–4h / ${t.stale} vencidas · lectura más nueva hace ${edadTxt}`}>
                {cfg.dot} {cfg.txt} · {sufijo}
            </span>
        );
    };

    // En pestañas de DATOS (Tendencias, Datos) el plano no aporta y resta espacio:
    // se oculta el mapa y el dock ocupa toda el área para ver mejor la información.
    // En Panorama, Canal y Alertas sí se muestra el plano.
    // ── Alertas: vigentes vs pendientes antiguas (mismo criterio que el menú) ──
    const { alertasVigentes, alertasAntiguas } = useMemo(() => {
        const corte = Date.now() - DIAS_ALERTA_VIGENTE * 86_400_000;
        const vig: typeof activeAlertas = [], ant: typeof activeAlertas = [];
        activeAlertas.forEach(a => (new Date(a.fecha_deteccion).getTime() >= corte ? vig : ant).push(a));
        return { alertasVigentes: vig, alertasAntiguas: ant };
    }, [activeAlertas]);

    // ── Franja ejecutiva y vista de VACIADO ─────────────────────────────────
    const datosEjecutivos: DatosEjecutivos = useMemo(() => {
        // Presas: % ponderado por capacidad (capacidad_i = alm_i / pct_i)
        const conAlm = presasData.filter(p => p.almacenamiento_mm3 != null && Number.isFinite(Number(p.almacenamiento_mm3)));
        const totalMm3 = conAlm.length ? conAlm.reduce((a, p) => a + Number(p.almacenamiento_mm3), 0) : null;
        const conCap = conAlm.filter(p => Number(p.porcentaje_llenado) > 0);
        const capMm3 = conCap.reduce((a, p) => a + Number(p.almacenamiento_mm3) / (Number(p.porcentaje_llenado) / 100), 0);
        const pct = conCap.length && capMm3 > 0 ? (conCap.reduce((a, p) => a + Number(p.almacenamiento_mm3), 0) / capMm3) * 100 : null;
        const extraccion = !executiveMetrics.fresh ? 'S/D'
            : executiveMetrics.cerradaDesde ? `cerrada desde ${formatFechaCorta(executiveMetrics.cerradaDesde)}`
            : `${executiveMetrics.totalReal.toFixed(2)} m³/s`;
        const vol = volZonas.length ? volZonas.reduce((a: number, z: any) => a + Number(z.vol_actual_mm3 ?? 0), 0) : null;
        const tot = volCiclo.length ? totalesVolumenCiclo(volCiclo) : null;
        return {
            presas: { totalMm3, pct, conDato: conAlm.length, total: presasData.length, extraccion },
            canal: { vigentes: skillSnapshot.telemetria.vigentes, total: skillSnapshot.telemetria.total, volumenMm3: vol },
            entregas: {
                entregadoMm3: tot ? tot.entregadoMm3 : null,
                autorizadoMm3: tot ? tot.autorizadoMm3 : null,
                pct: tot ? tot.pctEntregado : null,
                remanenteMm3: tot ? tot.remanenteMm3 : null,
                ciclo: volCiclo[0]?.cicloNombre ?? null,
            },
            alertas: {
                crit: alertasVigentes.filter(a => a.tipo_riesgo === 'critical').length,
                avisos: alertasVigentes.filter(a => a.tipo_riesgo === 'warning').length,
                info: alertasVigentes.filter(a => a.tipo_riesgo !== 'critical' && a.tipo_riesgo !== 'warning').length,
                antiguas: alertasAntiguas.length,
            },
        };
    }, [presasData, executiveMetrics, volZonas, volCiclo, skillSnapshot, alertasVigentes, alertasAntiguas]);

    const datosVaciado: DatosVaciado | null = useMemo(() => {
        if (modoVisualizacion !== 'VACIADO') return null;
        const control = [...escalas].filter(e => e.km >= 0 && e.km <= 104 && !ESC_SIN_CONTROL.has(e.nombre)).sort((a, b) => a.km - b.km);
        const edadTxt = (ts?: number | null) => {
            if (!ts) return 'sin lectura';
            const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
            return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
        };
        const filas = control.map(e => {
            const v = escalaVencida(e);
            return { nombre: e.nombre, km: e.km, nivel: e.nivel_actual ?? null, dCm: e.delta_12h != null ? Math.round(e.delta_12h * 100) : null, vencida: v, edad: edadTxt(e.ultima_telemetria) };
        });
        const vigentes = filas.filter(f => !f.vencida);
        const cierre = executiveMetrics.cerradaDesde;
        const tot = volCiclo.length ? totalesVolumenCiclo(volCiclo) : null;
        return {
            cerradaDesde: cierre ? formatFechaCorta(cierre) : null,
            diasCierre: cierre ? Math.floor((Date.now() - new Date(cierre).getTime()) / 86_400_000) : null,
            descendiendo: vigentes.filter(f => (f.dCm ?? 0) < 0).length,
            estables: vigentes.filter(f => (f.dCm ?? 0) >= 0).length,
            sinLectura: filas.length - vigentes.length,
            totalControl: filas.length,
            volumenMm3: datosEjecutivos.canal.volumenMm3,
            remanenteMm3: tot ? tot.remanenteMm3 : null,
            filas,
        };
    }, [modoVisualizacion, escalas, executiveMetrics, volCiclo, datosEjecutivos]);

    const tabSinMapa = isDockVisible && (dockTab === 'tendencias' || dockTab === 'skill' || dockTab === 'cuenca');
    // Panel lateral derecho cuando hay ancho (escritorio / tableta horizontal):
    // el mapa ocupa solo el área libre y el canal se encuadra ahí, sin nada encima.
    const layoutLateral = !isMobile && anchoCont >= 860 && !tabSinMapa;
    const claseLayout = tabSinMapa ? ' pm-sin-mapa'
        : layoutLateral ? (isDockVisible ? ' pm-lateral' : ' pm-lateral pm-panel-cerrado')
        : (isDockVisible ? ' pm-inferior' : ' pm-panel-cerrado');
    // Derivado del estado (antes se leía sessionStorage en el render: no se
    // re-renderizaba al cambiar y podía quedar pegado con un K-0 ya vencido).
    const hayViolacion = flowAtZeroFresh && flowAtZero > CAPACIDAD_DISENO_K0;
    const modoExtra = modoVisualizacion === 'CONTINGENCIA' || modoVisualizacion === 'VACIADO' || modoVisualizacion === 'ANOMALIA';

    return (
        <div ref={contRef} className={`public-monitor-container${claseLayout}`}>
            {/* Compact Header Badge - Floating over map */}
            <div className="public-header-badge animate-in" data-pm-overlay>
                <div className="phb-main">
                    <div className="phb-logos">
                        <LogoSica tamano={40} className="phb-sica" etiqueta="SICA 005" />
                        <span className="phb-marca">SICA 005</span>
                        <span className="phb-sep" aria-hidden="true" />
                        <img src="/logos/srl/logo-srl-claro.svg" alt="SRL" className="phb-logo" />
                    </div>
                    
                    <div className="phb-status">
                        <div className="status-dot-container-mini">
                            <div className="status-dot-pulse-mini" style={{ borderColor: statusColor }}></div>
                            <div className="status-dot-inner-mini" style={{ background: statusColor }}></div>
                        </div>
                        <div className="phb-text">
                            <span className="phb-label">Estado:</span>
                            <span className="phb-value" style={{ color: statusColor }}>{protocolLabel}</span>
                        </div>
                    </div>

                    <div className="phb-efficiency">
                        <span className="phb-label">Presa:</span>
                        <span className="phb-val" style={{ color: executiveMetrics.fresh ? undefined : '#8396ad' }}
                            title={!executiveMetrics.fresh ? 'Sin extracción vigente (ni movimiento de compuertas ni lectura <24 h)'
                                : executiveMetrics.cerradaDesde ? `Presas cerradas desde ${formatFechaCorta(executiveMetrics.cerradaDesde)} (último movimiento de compuertas)` : undefined}>
                            {executiveMetrics.fresh ? `${executiveMetrics.totalReal.toFixed(2)} m³/s` : 'S/D'}
                        </span>
                        {executiveMetrics.cerradaDesde && (
                            <span className="phb-sub">cerrada desde {formatFechaCorta(executiveMetrics.cerradaDesde)}</span>
                        )}
                    </div>

                    <div className="phb-divider"></div>

                    <div className="phb-efficiency">
                        <span className="phb-label">{modoActual.kpi0Label}</span>
                        <span
                            className="phb-val"
                            style={{ color: !flowAtZeroFresh ? '#8396ad' : hayViolacion ? '#ef4444' : statusColor }}
                            title={flowAtZeroFresh ? undefined : 'K-0 sin lectura de gasto fresca (<4 h)'}
                        >
                            {flowAtZeroFresh ? `${flowAtZero.toFixed(2)} m³/s` : 'S/D'}
                        </span>
                    </div>

                    {/* KPI meta de entrega — solo en ESTABILIZACIÓN cuando hay gasto solicitado */}
                    {(modoVisualizacion === 'ESTABILIZACION' || modoVisualizacion === 'SIN_EVENTO') &&
                     activeEvent?.gasto_solicitado_m3s && activeEvent.gasto_solicitado_m3s > 0 && (
                        <div className="phb-efficiency">
                            <span className="phb-label">META:</span>
                            <span className="phb-val" style={{ color: 'var(--text-3)' }}>
                                {activeEvent.gasto_solicitado_m3s.toFixed(1)} m³/s
                            </span>
                        </div>
                    )}

                    <button
                        type="button"
                        className="phb-system-btn"
                        onClick={() => window.location.href = '/'}
                        title="Ir al sistema completo"
                        aria-label="Ir al sistema completo"
                    >
                        <Activity size={12} />
                    </button>
                    <div className="phb-version">v{__V2_APP_VERSION__}</div>
                </div>
            </div>

            {/* Predicted position badge - Managerial Transit Report */}
            {activeEvent?.evento_tipo === 'LLENADO' && isPredictionVisible && (
                <div className="prediction-badge managerial animate-in">
                    <div className="mgr-header">
                        <span className="mgr-title">Análisis de tránsito</span>
                        {isWaitingAtZero && <span className="wait-badge-pulse">WAITING</span>}
                        <button type="button" className="panel-toggle-mini" onClick={() => setIsPredictionVisible(false)} title="Cerrar panel">×</button>
                    </div>

                    {isWaitingAtZero && (
                        <div className="wait-alert-box">
                            <Activity size={16} className="pulse-icon" />
                            <div className="wait-alert-text">
                                <b>Llenado de río: KM 0+000</b>
                                <p>Nivel detectado. Esperando reporte de <b>Apertura de radiales</b> en SICA Capture para iniciar canal.</p>
                            </div>
                        </div>
                    )}
                    
                    <div className="transit-summary">
                        <div className="transit-row">
                            <div className="tr-label">
                                <Clock size={12} />
                                Reporte de campo
                            </div>
                            <div className="tr-value">
                                {topAnchorKm !== undefined ? 
                                    `KM ${topAnchorKm} (${new Date(anchorTimes[topAnchorKm]).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })})` :
                                    'INICIO BOQUILLA'}
                            </div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <Timer size={12} />
                                Tiempo transcurrido
                            </div>
                            <div className="tr-value">
                                {nextTargetInfo.elapsed}
                            </div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <ArrowRightCircle size={12} />
                                Siguiente control
                            </div>
                            <div className="tr-value">{nextTargetInfo.name}</div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <MapPin size={12} />
                                Distancia restante
                            </div>
                            <div className="tr-value tr-value-accent">{nextTargetInfo.kmRemaining} KM</div>
                        </div>

                        <div className="transit-row">
                            <div className="tr-label">
                                <Timer size={12} />
                                Llegada estimada
                            </div>
                            <div className="tr-value tr-value-accent">{nextTargetInfo.arrivalTime}</div>
                        </div>

                        {nextTargetInfo.vOndaKmh != null && (
                        <div className="transit-row transit-row--onda">
                            <div className="tr-label">
                                〜 V ONDA
                            </div>
                            <div className="tr-value tr-value--onda">
                                {nextTargetInfo.vOndaKmh} km/h
                                <span className="tr-onda-q"> · Q={nextTargetInfo.qK0Usado} m³/s</span>
                            </div>
                        </div>
                        )}
                    </div>

                    <div className="transit-divider"></div>

                    {/* Professional Hydraulic Balance Section */}
                    <div className="balance-section technical">
                        <h4 className="balance-title technical-title">
                            <Activity size={14} />
                            Balance hidráulico: fuente - KM 0+000
                        </h4>
                        
                        <div className="technical-comparison-container">
                            {/* Source: Dam */}
                            <div className="tech-item source">
                                <div className="tech-label">Extracción presa</div>
                                <div className="tech-main-val" title={executiveMetrics.fresh ? undefined : 'Sin lectura/movimiento de presa en las últimas 24 h'}>
                                    {executiveMetrics.fresh ? executiveMetrics.totalReal.toFixed(2) : 'S/D'}
                                    {executiveMetrics.fresh && <small>m³/s</small>}
                                </div>
                                <div className="tech-sub">Fuente: total presas</div>
                            </div>

                            <div className="tech-arrow">
                                <ArrowRightCircle size={20} />
                                <span className="tech-dist">36 KM</span>
                            </div>

                            {/* Delivery: KM 0 */}
                            <div className="tech-item delivery">
                                <div className="tech-label">Entrega KM 0+000</div>
                                <div className="tech-main-val" title={flowAtZeroFresh ? undefined : 'K-0 sin lectura de gasto fresca (<4 h)'}>
                                    {flowAtZeroFresh ? flowAtZero.toFixed(2) : 'S/D'}
                                    {flowAtZeroFresh && <small>m³/s</small>}
                                </div>
                                <div className="tech-sub" style={{ color: 'var(--st-info)' }}>Radiales SICA</div>
                            </div>
                        </div>

                        <div className="radial-behavior-box">
                            <div className="rb-header">Comportamiento de radiales (K-0)</div>
                            <div className="rb-grid">
                                <div className="rb-stat">
                                    <span className="rb-st-label">Nivel (H)</span>
                                    <span className="rb-st-val">{parseFloat(sessionStorage.getItem('zero_nivel_arriba') || '0').toFixed(2)}m</span>
                                </div>
                                <div className="rb-stat">
                                    <span className="rb-st-label">APERTURA (w)</span>
                                    <span className="rb-st-val">{parseFloat(sessionStorage.getItem('zero_radial_apertura') || '0').toFixed(2)}m</span>
                                </div>
                                <div className="rb-stat">
                                    <span className="rb-st-label">TOTAL Pz</span>
                                    <span className="rb-st-val">{sessionStorage.getItem('k0_pzas')} x {sessionStorage.getItem('k0_ancho')}m</span>
                                </div>
                            </div>
                        </div>

                        <div className="balance-summary-tech">
                            {(() => {
                                const ambosFrescos = flowAtZeroFresh && executiveMetrics.fresh;
                                const motivo = !flowAtZeroFresh && !executiveMetrics.fresh
                                    ? 'K-0 y PRESA sin lectura fresca'
                                    : !flowAtZeroFresh
                                    ? 'K-0 sin lectura de gasto fresca (<4 h)'
                                    : 'Sin lectura/movimiento de presa en las últimas 24 h';
                                return (
                                <>
                                <div className="bst-item">
                                    <span className="bst-label">Pérdida en tránsito</span>
                                    <span
                                        className="bst-val"
                                        style={{ color: !ambosFrescos ? '#8396ad' : (executiveMetrics.totalReal - flowAtZero) > 5 ? '#ef4444' : '#22c55e' }}
                                        title={ambosFrescos ? undefined : motivo}
                                    >
                                        {ambosFrescos ? `${(executiveMetrics.totalReal - flowAtZero).toFixed(2)} m³/s` : 'S/D'}
                                    </span>
                                </div>
                                <div className="bst-item">
                                    <span className="bst-label">Eficiencia global</span>
                                    <span className="bst-val highlight" title={ambosFrescos ? undefined : motivo}>
                                        {executiveMetrics.totalReal > 0 && ambosFrescos
                                            ? ((flowAtZero / executiveMetrics.totalReal) * 100).toFixed(1)
                                            : 'S/D'}%
                                    </span>
                                </div>
                                </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Map Wrapper */}
            <div className="public-map-wrapper">
                <MapContainer 
                    center={[28.25, -105.45]} 
                    zoom={10} 
                    zoomSnap={0.25}
                    zoomDelta={0.5}
                    zoomControl={false}
                    style={{ height: "100%", width: "100%" }}
                >
                    <MapController 
                        center={frontCoords as [number, number]} 
                        zoom={11} 
                        active={activeEvent?.evento_tipo === 'LLENADO'} 
                    />
                    {/* Fuera de LLENADO el canal se encuadra en el área libre */}
                    <FitCanal
                        puntos={canalFullLength}
                        activo={activeEvent?.evento_tipo !== 'LLENADO' && !tabSinMapa}
                        trigger={`${claseLayout}|${dockTab}|${canalFullLength.length}|${anchoCont}`}
                        recentrarRef={recentrarCanalRef}
                    />
                    <TileLayer
                        url={CARTO_TILE_URL}
                        attribution='&copy; CARTO'
                    />
                    
                    {/* Río y Canal Inactivo */}
                    <Polyline 
                        positions={rioFullLength} 
                        color="rgba(255,255,255,0.08)" 
                        weight={4} 
                    />
                    <Polyline
                        positions={canalFullLength}
                        color="rgba(255,255,255,0.08)"
                        weight={4}
                        className="canal-path-base"
                    />

                    {/* Tramos del canal coloreados por alerta (modo ESTABILIZACIÓN) */}
                    {canalAlertSegments.map((seg, i) => (
                        <Polyline
                            key={`seg-${i}`}
                            positions={seg.coords}
                            color={seg.color}
                            weight={6}
                            opacity={0.85}
                        />
                    ))}

                    {/* Canal Seco — tramo por recorrer (solo LLENADO) */}
                    {activeEvent?.evento_tipo === 'LLENADO' && dryPath.length >= 2 && (
                        <Polyline
                            positions={dryPath}
                            color="#1e3a5f"
                            weight={3}
                            dashArray="6,10"
                            opacity={0.65}
                            className="canal-path-dry"
                        />
                    )}

                    {/* Canal Activo (Stream) — segmento hidratado con efecto de flujo */}
                    {activeEvent?.evento_tipo === 'LLENADO' && (
                        <Polyline
                            positions={hydratedPath}
                            color={statusColor}
                            weight={6}
                            className="canal-path-active"
                        />
                    )}

                    {/* Front de Agua Marker - Solo visible si hay avance real confirmado */}
                    {activeEvent?.evento_tipo === 'LLENADO' && typeof frontCoords[0] === 'number' && typeof frontCoords[1] === 'number' && (
                        <Marker position={frontCoords as any} icon={waterFrontIcon}>
                            <Popup className="custom-popup">
                                <div className="tooltip-content">
                                    <div className="tooltip-km">{displayMaxKm.toFixed(1)} KM</div>
                                    <b className="tooltip-name">
                                        {isWaitingAtZero ? 'ESTADO: ESPERANDO TOMA 0+000' : 
                                         displayMaxKm > 0 ? `FRENTE DE AVANCE: KM ${displayMaxKm.toFixed(1)}` : 
                                         'TRÁNSITO: RÍO CONCHOS'}
                                    </b>
                                    <div className="tooltip-payload">
                                        <Timer size={12} color={isWaitingAtZero ? '#f59e0b' : statusColor} />
                                        <span className="tooltip-value">{isWaitingAtZero ? 'ESPERANDO CAPTURA' : 'AVANCE ESTIMADO'}</span>
                                    </div>
                                    <div className="tooltip-footer">{isWaitingAtZero ? 'ALERTA: PUNTO DE CONTROL CERRADO' : 'Frente de avance estimado'}</div>
                                </div>
                            </Popup>
                        </Marker>
                    )}

                    {/* Escalas de Puntos — con mini-badge de nivel y clases de estado */}
                    {escalas.filter(esc => typeof esc.latitud === 'number' && typeof esc.longitud === 'number').map(esc => (
                        <EscalaMarker
                            key={esc.id}
                            esc={esc}
                            displayMaxKm={displayMaxKm}
                            isEstabilizacion={isEstabilizacion}
                            coherenciaCanal={coherenciaCanal}
                            statusColor={statusColor}
                        />
                    ))}

                    <ZoomControl position="bottomright" />
                </MapContainer>

                {/* Recentrar el canal tras hacer zoom/arrastre */}
                {activeEvent?.evento_tipo !== 'LLENADO' && (
                    <button type="button" className="pm-recentrar" data-pm-overlay
                        onClick={() => recentrarCanalRef.current?.()}
                        title="Centrar el canal en la vista" aria-label="Centrar el canal en la vista">
                        <MapPin size={15} /> <span>Centrar canal</span>
                    </button>
                )}

                {/* ── Leyenda de mapa — overlay persistente ── */}
                <div className="map-legend" data-pm-overlay>
                    {isEstabilizacion ? (
                        <>
                            <div className="ml-title">Nivel de agua</div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--critico" />
                                <span>Crítico ≥ {UMBRAL_CRITICO * 100}% máx.</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--alerta" />
                                <span>Alerta ≥ {UMBRAL_ALERTA * 100}% máx.</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--normal" />
                                <span>Normal ≥ {UMBRAL_NORMAL * 100}%</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--bajo" />
                                <span>Flujo bajo</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--vencido" />
                                <span>Dato vencido (&gt;4 h)</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-dot ml-dot--sin" />
                                <span>Sin datos</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="ml-title">Frente de avance</div>
                            <div className="ml-item">
                                <span className="ml-line ml-line--activo" />
                                <span>Hidratado</span>
                            </div>
                            <div className="ml-item">
                                <span className="ml-line ml-line--seco" />
                                <span>Por recorrer</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── HUD Barra de Progreso — solo en LLENADO ─────────────────── */}
            {modoVisualizacion === 'LLENADO' && (
                <div className="hud-progress">
                    <div className="hud-endpoints">
                        <span>PRESA</span>
                        <span>K104</span>
                    </div>
                    <div className="hud-track">
                        {/* Segmento completado */}
                        <div
                            className="hud-fill"
                            style={{ '--fill-pct': `${Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%` } as React.CSSProperties}
                        />
                        {/* Marcas de km clave */}
                        {([0, 23, 34, 57, 80, 104] as const).map(km => (
                            <div
                                key={km}
                                className={`hud-mark${km <= displayMaxKm ? ' hud-mark--done' : ''}`}
                                style={{ '--mark-left': `${(((km + 36) / 140) * 100).toFixed(1)}%` } as React.CSSProperties}
                            >
                                <div className="hud-tick" />
                                <span className="hud-km-label">K{km}</span>
                            </div>
                        ))}
                        {/* Marcador del frente de ola */}
                        {displayMaxKm >= -36 && (
                            <div
                                className="hud-front"
                                style={{ '--front-left': `${Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%` } as React.CSSProperties}
                            >
                                <div className="hud-front-pulse" />
                                <div className="hud-front-label">
                                    {displayMaxKm >= 0 ? `KM ${displayMaxKm.toFixed(0)}` : 'RÍO'}
                                    {nextTargetInfo.arrivalTime && nextTargetInfo.arrivalTime !== 'PENDIENTE'
                                        ? ` · ${nextTargetInfo.arrivalTime}`
                                        : ''}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Bottom Dock - Balanced layout to avoid 'heavy right' look */}
            {isDockVisible ? (
                <div className="info-cards-dock animate-in" data-pm-overlay style={{ animationDelay: '0.4s' }}>
                    <button type="button" className="dock-close-btn" onClick={() => setIsDockVisible(false)}
                        title="Ocultar tablero (el mapa toma todo el ancho)" aria-label="Ocultar tablero">×</button>

                    {/* Avisos de estado — dentro del tablero, nunca sobre el canal */}
                    {modoExtra && (
                        <div className="pm-aviso pm-aviso--modo" style={{ '--modo-color': modoActual.color } as React.CSSProperties} role="status">
                            <Activity size={16} className="pm-aviso-icono" />
                            <div className="pm-aviso-texto">
                                <b>{modoActual.label}</b>
                                {activeEvent?.notas && <p>{activeEvent.notas}</p>}
                            </div>
                        </div>
                    )}
                    {hayViolacion && (
                        <div className="pm-aviso pm-aviso--crit" role="alert">
                            <AlertTriangle size={16} className="pm-aviso-icono" />
                            <div className="pm-aviso-texto">
                                <b>Violación hidráulica detectada: K-0+000</b>
                                <p>El gasto de entrada ({flowAtZero.toFixed(2)} m³/s) excede la capacidad de diseño de {CAPACIDAD_DISENO_K0} m³/s. Riesgo de desbordamiento.</p>
                            </div>
                        </div>
                    )}

                    {/* ── Barra de pestañas ── */}
                    <div className="dock-tabs" role="tablist" aria-label="Secciones del tablero">
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'resumen' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'resumen'}
                            onClick={() => setDockTab('resumen')}
                        >
                            Panorama
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'canal' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'canal'}
                            onClick={() => setDockTab('canal')}
                        >
                            Canal
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'alertas' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'alertas'}
                            onClick={() => setDockTab('alertas')}
                        >
                            Alertas
                            {datosEjecutivos.alertas.crit + datosEjecutivos.alertas.avisos > 0 && (
                                <span className={`dock-tab-badge${datosEjecutivos.alertas.crit === 0 ? ' dock-tab-badge--warn' : ''}`}
                                    title={`${datosEjecutivos.alertas.crit} críticas · ${datosEjecutivos.alertas.avisos} avisos vigentes${datosEjecutivos.alertas.antiguas ? ` · ${datosEjecutivos.alertas.antiguas} pendientes antiguas` : ''}`}>{datosEjecutivos.alertas.crit + datosEjecutivos.alertas.avisos}</span>
                            )}
                        </button>
                        <button
                            type="button"
                            className={`dock-tab dock-tab--skill${dockTab === 'skill' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'skill'}
                            onClick={() => setDockTab('skill')}
                            title="Datos técnicos: balance, tramos, zonas, módulos y modelación"
                        >
                            Técnico
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'tendencias' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'tendencias'}
                            onClick={() => setDockTab('tendencias')}
                            title="Análisis histórico por periodo: escalas, tramos, compuertas, gasto"
                        >
                            Tendencias
                        </button>
                        <button
                            type="button"
                            className={`dock-tab${dockTab === 'cuenca' ? ' dock-tab--active' : ''}`}
                            role="tab"
                            aria-selected={dockTab === 'cuenca'}
                            onClick={() => setDockTab('cuenca')}
                            title="Presas de la cuenca del Conchos y lluvia GOES (portal USIBWC, dato provisional)"
                        >
                            Cuenca
                        </button>
                    </div>

                    {/* ── Pestaña RESUMEN (anterior dock-panel-left) ── */}
                    {dockTab === 'resumen' && (
                    <>
                    <div className="dock-section dock-panel-left">
                        {!isEstabilizacion ? (
                            // ── Vista LLENADO ──
                            <>
                                <div className="dock-panel-header">
                                    <span className="card-label">Balance hídrico</span>
                                    <div className="health-badge-premium" style={{ borderColor: executiveMetrics.healthColor }}>
                                        <div className="health-dot" style={{ background: executiveMetrics.healthColor }}></div>
                                        {executiveMetrics.healthStatus}
                                    </div>
                                </div>
                                <div className="summary-gasto">
                                    <span className="gasto-value" title={executiveMetrics.fresh ? undefined : 'Sin lectura/movimiento de presa en las últimas 24 h'}>
                                        {executiveMetrics.fresh ? executiveMetrics.totalReal.toFixed(2) : 'S/D'}
                                        {executiveMetrics.fresh && <span className="gasto-unit">m³/s</span>}
                                    </span>
                                    <div className="summary-info-row">
                                        <span className="summary-info-title">Progreso: <span className="summary-info-value" style={{ color: statusColor }}>{Math.max(0, Math.min(100, ((displayMaxKm + 36) / 140) * 100)).toFixed(1)}%</span></span>
                                    </div>
                                </div>
                                <PresasNivelStrip presas={presasData} />
                                {/* Fuentes en LLENADO */}
                                <div className="dock-panel-footer">
                                    {presasData.map(p => (
                                        <span key={p.id} className="dpf-item">
                                            <span className="dpf-label">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                                            <span className="dpf-val" title={p.extraccion_fuente === 'movimiento' ? `Último movimiento de compuertas: ${formatFechaCorta(p.extraccion_desde)}` : undefined}>
                                                {executiveMetrics.vigente(p)
                                                    ? `${Number(p.extraccion_total).toFixed(1)} m³/s${Number(p.extraccion_total) === 0 && p.extraccion_fuente === 'movimiento' ? ' · cerrada' : ''}`
                                                    : 'S/D'}
                                            </span>
                                        </span>
                                    ))}
                                    {damMovements[0]?.fecha_hora && (
                                        <span className="dpf-item">
                                            <span className="dpf-label">MOV.</span>
                                            <span className="dpf-val">
                                                {formatDate(damMovements[0].fecha_hora, { day: '2-digit', month: 'short' })}
                                                {' '}
                                                {new Date(damMovements[0].fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            </>
                        ) : (
                            // ── Vista ESTABILIZACIÓN ──
                            <>
                                <PanelEjecutivo d={datosEjecutivos} onAlertas={() => setDockTab('alertas')} />
                                {/* Header: título + badge + botón perfil */}
                                <div className="dock-panel-header">
                                    <span className="card-label">Panorama del canal</span>
                                    {iecData && (
                                        <div
                                            className="health-badge-premium iec-badge"
                                            style={{ borderColor: iecColor(iecData.semaforo) }}
                                            title={`IEC ${iecData.iec}/100 — ${iecData.texto}\nEficiencia: ${iecData.p_eficiencia}/30 pts\nCoherencia: ${iecData.p_coherencia}/25 pts\nFugas: ${iecData.sin_dato.includes('fugas') ? 'S/D (sin medición, excluido)' : iecData.p_fugas + '/25 pts'}\nCríticos: ${iecData.p_criticos}/20 pts`}
                                        >
                                            <div className="health-dot" style={{ background: iecColor(iecData.semaforo) }}></div>
                                            <span className="iec-score">{iecData.iec}</span>
                                            <span className="iec-label">IEC</span>
                                        </div>
                                    )}
                                    <button type="button" className="perfil-inline-btn" onClick={() => setDockTab('canal')} title="Ver perfil hidráulico en la pestaña CANAL">
                                        <Waves size={12} />
                                        <span>Perfil</span>
                                        <span className="ptb-badge">●</span>
                                    </button>
                                </div>

                                {datosVaciado && <VistaVaciado d={datosVaciado} />}
                                {/* En VACIADO la cadena PRESA→K0→Kfinal y el IEC describen un canal
                                    en distribución: no aplican con la presa cerrada. */}
                                {!datosVaciado && (<>
                                {/* Cadena de flujo */}
                                {coherenciaCanal ? (
                                    <div className="coherencia-flow-chain">
                                        <div className="cfc-node">
                                            <span className="cfc-label">Boquilla</span>
                                            <span className="cfc-val">{coherenciaCanal.qPresaVigente ? coherenciaCanal.qPresa.toFixed(1) : 'S/D'}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaRio !== null ? `−${coherenciaCanal.perdidaRio.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">36km río</span>
                                        </div>
                                        <div className="cfc-node">
                                            <span className="cfc-label">K0+000</span>
                                            <span className="cfc-val" title={coherenciaCanal.k0Disponible ? undefined : 'K-0 sin lectura de gasto fresca (<4 h)'}>
                                                {coherenciaCanal.k0Disponible ? coherenciaCanal.qK0Medido.toFixed(1) : 'S/D'}
                                            </span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                        <div className="cfc-arrow">
                                            <span className="cfc-loss">{coherenciaCanal.perdidaCanal !== null ? `−${coherenciaCanal.perdidaCanal.toFixed(1)}` : '—'}</span>
                                            <span className="cfc-dist">{coherenciaCanal.tramoCompleto ? '104km canal' : `hasta K${coherenciaCanal.kmFinal ?? '?'}`}</span>
                                        </div>
                                        <div className="cfc-node">
                                            <span className="cfc-label">{coherenciaCanal.tramoCompleto ? 'K104' : `K${coherenciaCanal.kmFinal ?? '?'}`}</span>
                                            <span className="cfc-val">{coherenciaCanal.qFinal.toFixed(1)}</span>
                                            <span className="cfc-unit">m³/s</span>
                                        </div>
                                    </div>
                                ) : (
                                    // Criterio real: frescura <4h (no "hoy") — decirlo evita contradecir a CANAL/DATOS
                                    <div className="coherencia-sin-datos">Sin lecturas de gasto frescas (&lt;4 h) — el último dato conocido está en la pestaña DATOS</div>
                                )}

                                {/* IEC — Desglose de componentes en español */}
                                {iecData && (
                                    <div className="iec-breakdown" ref={iecBreakdownRef}>
                                        <div className="iec-breakdown-row">
                                            <span className="iec-bd-title">Índice de estado del canal</span>
                                            <span className="iec-bd-total" title={iecData.max_evaluado < 100 ? `Calculado sobre ${iecData.max_evaluado} puntos: faltan componentes sin medición (${iecData.sin_dato.join(', ')})` : undefined}>{iecData.iec}/100{iecData.max_evaluado < 100 && <small> · sobre {iecData.max_evaluado} pts</small>}</span>
                                        </div>
                                        <div className="iec-bd-bars">
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Eficiencia</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-ef" /></div>
                                                <span className="iec-bd-pts">{iecData.p_eficiencia}<small>/30</small></span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Coherencia</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-coh" /></div>
                                                <span className="iec-bd-pts">{iecData.sin_dato.includes('coherencia') ? 'S/D' : <>{iecData.p_coherencia}<small>/25</small></>}</span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Sin fugas</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-fug" /></div>
                                                <span className="iec-bd-pts">{iecData.sin_dato.includes('fugas') ? 'S/D' : <>{iecData.p_fugas}<small>/25</small></>}</span>
                                            </div>
                                            <div className="iec-bd-item">
                                                <span className="iec-bd-label">Nivel canal</span>
                                                <div className="iec-bd-track"><div className="iec-bd-fill iec-fill-crit" /></div>
                                                <span className="iec-bd-pts">{iecData.sin_dato.includes('criticos') ? 'S/D' : <>{iecData.p_criticos}<small>/20</small></>}</span>
                                            </div>
                                        </div>
                                        <div className="iec-bd-texto">{iecData.texto}</div>
                                    </div>
                                )}

                                {/* IEC histórico — sparkline 30 días */}
                                {iecHistorico.length >= 2 && (
                                    <div className="iec-sparkline-wrap">
                                        <span className="iec-sp-label">IEC 30 días</span>
                                        <svg className="iec-sparkline" viewBox="0 0 120 28" preserveAspectRatio="none">
                                            {iecHistorico.map((h, i, arr) => {
                                                const x1 = (i / (arr.length - 1)) * 118 + 1;
                                                const y1 = 26 - (h.iec / 100) * 24;
                                                if (i === 0) return null;
                                                const prev = arr[i - 1];
                                                const x0 = ((i - 1) / (arr.length - 1)) * 118 + 1;
                                                const y0 = 26 - (prev.iec / 100) * 24;
                                                const col = h.sem === 'VERDE' ? '#22c55e' : h.sem === 'AMARILLO' ? '#f59e0b' : '#ef4444';
                                                return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={col} strokeWidth="1.5" strokeLinecap="round" />;
                                            })}
                                            {iecHistorico.length > 0 && (() => {
                                                const last = iecHistorico[iecHistorico.length - 1];
                                                const x = 119;
                                                const y = 26 - (last.iec / 100) * 24;
                                                const col = last.sem === 'VERDE' ? '#22c55e' : last.sem === 'AMARILLO' ? '#f59e0b' : '#ef4444';
                                                return <circle cx={x} cy={y} r="2.5" fill={col} />;
                                            })()}
                                        </svg>
                                        <span className="iec-sp-val">{iecHistorico[iecHistorico.length - 1]?.iec ?? '—'}</span>
                                    </div>
                                )}

                                </>)}

                                {/* Acciones: Reporte PDF + CSV */}
                                {(iecData && coherenciaCanal) && (
                                    <div className="dock-action-row">
                                        <button
                                            type="button"
                                            className="dock-action-btn"
                                            onClick={() => setShowReport(true)}
                                            title="Generar reporte gerencial PDF"
                                        >
                                            Reporte PDF
                                        </button>
                                        <button
                                            type="button"
                                            className="dock-action-btn dock-action-btn--csv"
                                            onClick={() => exportEscalasCSV(escalas)}
                                            title="Exportar telemetría a CSV"
                                        >
                                            Exportar CSV
                                        </button>
                                    </div>
                                )}

                                <PresasNivelStrip presas={presasData} />
                                {/* Footer: fuente + movimiento + coherencia en una línea */}
                                <div className="dock-panel-footer">
                                    {presasData.map(p => (
                                        <span key={p.id} className="dpf-item">
                                            <span className="dpf-label">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                                            <span className="dpf-val" title={p.extraccion_fuente === 'movimiento' ? `Último movimiento de compuertas: ${formatFechaCorta(p.extraccion_desde)}` : undefined}>
                                                {executiveMetrics.vigente(p)
                                                    ? `${Number(p.extraccion_total).toFixed(1)} m³/s${Number(p.extraccion_total) === 0 && p.extraccion_fuente === 'movimiento' ? ' · cerrada' : ''}`
                                                    : 'S/D'}
                                            </span>
                                        </span>
                                    ))}
                                    {damMovements[0]?.fecha_hora && (
                                        <span className="dpf-item">
                                            <span className="dpf-label">MOV.</span>
                                            <span className="dpf-val">
                                                {formatDate(damMovements[0].fecha_hora, { day: '2-digit', month: 'short' })}
                                                {' '}
                                                {new Date(damMovements[0].fecha_hora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chihuahua' })}
                                            </span>
                                        </span>
                                    )}
                                    {coherenciaCanal && (
                                        <span className="dpf-item dpf-coh">
                                            <span className="dpf-val">{coherenciaCanal.nCoherentes}/{coherenciaCanal.totalPuntos} coherentes</span>
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* ── Red de puntos: en LLENADO es el seguimiento del frente y se queda
                        aquí; en los demás modos vive en CANAL (antes duplicada). ── */}
                    {!isEstabilizacion ? (
                    <div className="dock-section checkpoints-section">
                        <div className="dock-section-header">
                            <span className="card-label">Red de puntos de control</span>
                            {renderStateTag('MONITOREO ACTIVO')}
                        </div>
                        <CheckpointsGrid
                            escalas={escalas}
                            coherenciaCanal={coherenciaCanal}
                            displayMaxKm={displayMaxKm}
                            isEstabilizacion={isEstabilizacion}
                            statusColor={statusColor}
                            currentTime={currentTime}
                        />
                    </div>
                    ) : (
                    <button type="button" className="pm-ir-canal" onClick={() => setDockTab('canal')}>
                        <span>
                            <b>Red de puntos de control y perfil hidráulico</b>
                            <small>Nivel, margen al máximo operativo, gasto y compuertas por escala</small>
                        </span>
                        {renderStateTag('MONITOREO ACTIVO')}
                        <ArrowRightCircle size={18} />
                    </button>
                    )}
                    </>
                    )}

                    {/* ── Pestaña CANAL (checkpoints standalone — móvil usa esta vista) ── */}
                    {dockTab === 'canal' && (
                    <div className="dock-section checkpoints-section">
                        {isEstabilizacion && (
                            <div className="pm-perfil-inline">
                                <div className="dock-section-header">
                                    <span className="card-label"><Waves size={13} /> PERFIL HIDRÁULICO — CANAL CONCHOS</span>
                                </div>
                                <div className="perfil-modal-body">
                            <div className="perfil-svg-scroll">
                                <CanalLongitudinalProfile
                                    escalas={escalas}
                                    coherencia={coherenciaCanal}
                                    fgvProfile={fgvAplicable ? fgvData?.profile : undefined}
                                    fgvLoading={fgvAplicable && fgvLoading}
                                />
                            </div>
                            <div className="canal-profile-legend">
                                <span className="cpl-item cpl-green">Operativo (&lt;80% bordo)</span>
                                <span className="cpl-item cpl-amber">Alerta (80–92% bordo)</span>
                                <span className="cpl-item cpl-red">Crítico (&gt;92%) / Incoherente</span>
                                <span className="cpl-item cpl-blue">Bajo / sin rango op.</span>
                                <span className="cpl-item cpl-bordo">— — Bordo real por escala</span>
                                <span className="cpl-item cpl-trend">▲ sube · ▼ baja · — estable (Δ12h)</span>
                                {fgvData && fgvAplicable && <span className="cpl-item cpl-fgv" title="Superficie libre calculada por el modelo de Flujo Gradualmente Variado para el caudal actual">— — FGV · perfil teórico (modelo)</span>}
                                {fgvData?.criticos?.length > 0 && <span className="cpl-item cpl-jump">| Salto hidráulico</span>}
                            </div>
                            {!fgvAplicable && (
                                <p className="pm-fgv-nota">Modelo de perfil teórico (FGV) no calculado: {fgvMotivo}. Se muestran solo niveles medidos.</p>
                            )}
                            {fgvData && fgvAplicable && (
                                <div className="fgv-stat-grid">
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">Q entrada</span>
                                        <span className="fgv-stat-val fgv-stat--cyan">{fgvData.q_entrada != null ? fgvData.q_entrada.toFixed(1) : '—'}<small>m³/s</small></span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">Q salida</span>
                                        <span className="fgv-stat-val fgv-stat--blue">{fgvData.q_salida != null ? fgvData.q_salida.toFixed(1) : '—'}<small>m³/s</small></span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">Ef. conducción</span>
                                        <span className={`fgv-stat-val ${fgvData.eficiencia_conduccion == null ? '' : fgvData.eficiencia_conduccion >= 95 ? 'fgv-stat--green' : fgvData.eficiencia_conduccion >= 90 ? 'fgv-stat--amber' : 'fgv-stat--red'}`}>
                                            {fgvData.eficiencia_conduccion != null ? fgvData.eficiencia_conduccion.toFixed(1) : '—'}<small>%</small>
                                        </span>
                                    </div>
                                    <div className="fgv-stat">
                                        <span className="fgv-stat-label">TRÁNSITO K-0→104</span>
                                        <span className="fgv-stat-val">{fgvData.transit_time_h != null ? fgvData.transit_time_h.toFixed(1) : '—'}<small>h</small></span>
                                    </div>
                                    {fgvData.criticos?.length > 0 && (
                                        <div className="fgv-stat fgv-stat--critbox">
                                            <span className="fgv-stat-label">Puntos críticos</span>
                                            <span className="fgv-stat-val fgv-stat--red">⚠ {fgvData.criticos.length}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                            </div>
                        )}
                        <div className="dock-section-header">
                            <span className="card-label">Red de puntos de control</span>
                            {renderStateTag('MONITOREO ACTIVO')}
                        </div>
                        <CheckpointsGrid
                            escalas={escalas}
                            coherenciaCanal={coherenciaCanal}
                            displayMaxKm={displayMaxKm}
                            isEstabilizacion={isEstabilizacion}
                            statusColor={statusColor}
                            currentTime={currentTime}
                        />
                    </div>
                    )}

                    {/* ── Pestaña ALERTAS ── */}
                    {dockTab === 'alertas' && (
                    <div className="dock-section dock-alertas-panel">
                        <div className="dock-section-header">
                            <span className="card-label">Alertas activas</span>
                            {renderStateTag()}
                        </div>
                        {activeAlertas.length === 0 ? (
                            <div className="dap-empty">
                                <span className="dap-empty-icon">✓</span>
                                <span>Sin alertas activas</span>
                            </div>
                        ) : (
                            <div className="dap-grupos">
                                <div className="pm-ejec-sevbar dap-sevbar" role="img"
                                    aria-label={`${datosEjecutivos.alertas.crit} críticas, ${datosEjecutivos.alertas.avisos} avisos, ${datosEjecutivos.alertas.info} informativas`}>
                                    {datosEjecutivos.alertas.crit > 0 && <i className="c" style={{ flex: datosEjecutivos.alertas.crit }} />}
                                    {datosEjecutivos.alertas.avisos > 0 && <i className="w" style={{ flex: datosEjecutivos.alertas.avisos }} />}
                                    {datosEjecutivos.alertas.info > 0 && <i className="n" style={{ flex: datosEjecutivos.alertas.info }} />}
                                </div>
                                {([
                                    ['critical', 'Críticas'],
                                    ['warning', 'Avisos'],
                                    ['info', 'Informativas'],
                                ] as const).map(([tipo, titulo]) => {
                                    const grupo = alertasVigentes.filter(a => tipo === 'info'
                                        ? a.tipo_riesgo !== 'critical' && a.tipo_riesgo !== 'warning'
                                        : a.tipo_riesgo === tipo);
                                    if (grupo.length === 0) return null;
                                    return (
                                        <div key={tipo} className={`dap-grupo dap-grupo--${tipo}`}>
                                            <div className="dap-grupo-cab"><span>{titulo}</span><b>{grupo.length}</b></div>
                                            <div className="dap-list">
                                                {grupo.map(a => (
                                                    <div key={a.id} className={`dap-item dap-item--${a.tipo_riesgo}`}>
                                                        <AlertTriangle size={13} className="dap-icon" />
                                                        <div className="dap-body">
                                                            <span className="dap-titulo">{a.titulo}</span>
                                                            {a.mensaje && <span className="dap-msg">{a.mensaje}</span>}
                                                            <span className="dap-fecha">
                                                                {new Date(a.fecha_deteccion).toLocaleString('es-MX', {
                                                                    day: '2-digit', month: 'short',
                                                                    hour: '2-digit', minute: '2-digit',
                                                                    hour12: true, timeZone: 'America/Chihuahua'
                                                                })}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {alertasVigentes.length === 0 && (
                                    <div className="dap-empty"><span className="dap-empty-icon">✓</span><span>Sin alertas vigentes (últimos {DIAS_ALERTA_VIGENTE} días)</span></div>
                                )}
                                {alertasAntiguas.length > 0 && (
                                    <details className="dap-grupo dap-grupo--antiguas">
                                        <summary className="dap-grupo-cab">
                                            <span>Pendientes antiguas (&gt;{DIAS_ALERTA_VIGENTE} d, sin resolver)</span><b>{alertasAntiguas.length}</b>
                                        </summary>
                                        <p className="dap-msg">No cuentan como alertas de hoy: conviene revisarlas y marcarlas como resueltas en el módulo Alertas.</p>
                                        <div className="dap-list">
                                            {alertasAntiguas.map(a => (
                                                <div key={a.id} className="dap-item dap-item--antigua">
                                                    <div className="dap-body">
                                                        <span className="dap-titulo">{a.titulo}</span>
                                                        <span className="dap-fecha">{new Date(a.fecha_deteccion).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}
                        <div className="dap-footer">
                            <a href="/alertas" className="dap-link">Ver módulo Alertas →</a>
                        </div>
                    </div>
                    )}

                    {/* ── Pestaña DATOS ACTUALES — Snapshot para Claude/Skill ── */}
                    {dockTab === 'skill' && (
                    <PestanaSkill balanceModulos={balanceModulos} balanceTramos={balanceTramos} entregasHoy={entregasHoy} modelQ0={modelQ0} modelResult={modelResult} modoVisualizacion={modoVisualizacion} modulosResumen={modulosResumen} renderStateTag={renderStateTag} setModelQ0={setModelQ0} setModelResult={setModelResult} setShowSkillInforme={setShowSkillInforme} setSnapshotCopied={setSnapshotCopied} showSkillInforme={showSkillInforme} skillSnapshot={skillSnapshot} snapshotCopied={snapshotCopied} volCiclo={volCiclo} volInterescalas={volInterescalas} volZonas={volZonas} />
                    )}

                    {/* ── Pestaña TENDENCIAS ── */}
                    {/* Mismo wrapper que DATOS: .dock-skill-panel acota la altura
                        (calc(100vh - 160px)) y convierte a .dsk-scroll-body en el
                        área scrolleable real. Sin él, el contenido crece sin límite
                        y el scroll nunca se activa. */}
                    {dockTab === 'tendencias' && (
                    <div className="dock-section dock-skill-panel">
                        <div className="dock-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="card-label">TENDENCIAS — ANÁLISIS POR PERIODO</span>
                            {/* Enlace a Geo-Monitor (Fase 5) — simétrico al botón que ya
                                trae al usuario hasta aquí desde el mapa. */}
                            <button
                                onClick={() => navigate('/geo-monitor')}
                                title="Ver en Geo-Monitor (mapa)"
                                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 6, color: 'var(--st-info)', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer' }}
                            >
                                <MapIconLucide size={13} /> Ver en mapa
                            </button>
                        </div>
                        <div className="dsk-scroll-body">
                            <TendenciasPanel
                                loading={tndLoading}
                                error={tndError}
                                onReintentar={onTndReintentar}
                                rangoDesde={tndDesde} rangoHasta={tndHasta}
                                granularidad={tndGran}
                                onRango={onTndRango}
                                onGranularidad={setTndGran}
                                niveles={tndData.niveles}
                                volTramos={tndData.volTramos}
                                volTotal={tndData.volTotal}
                                compuertas={tndData.compuertas}
                                gasto={tndData.gasto}
                                vaciadoDesde={tndData.vaciadoDesde}
                            />
                        </div>
                    </div>
                    )}

                    {/* ── Pestaña CUENCA: mismo wrapper que TENDENCIAS/DATOS (altura acotada + scroll propio) ── */}
                    {dockTab === 'cuenca' && (
                    <div className="dock-section dock-skill-panel">
                        <div className="dock-section-header">
                            <span className="card-label">CUENCA DEL CONCHOS — PRESAS Y LLUVIA</span>
                        </div>
                        <div className="dsk-scroll-body">
                            <Suspense fallback={<div className="an-root cu-root" aria-busy="true"><div className="an-skeleton" /></div>}>
                                <PanelCuencaConchos />
                            </Suspense>
                        </div>
                    </div>
                    )}

                </div>
            ) : (
                <button type="button" className="dock-minimized animate-in" onClick={() => setIsDockVisible(true)}>
                    <Activity size={20} />
                    <span>Ver tablero técnico</span>
                </button>
            )}

            {/* Informe Operativo Diario PDF */}
            {showReport && iecData && coherenciaCanal && (
                <InformeOperativo
                    escalas={escalas}
                    coherencia={coherenciaCanal}
                    iec={iecData}
                    entregasHoy={entregasHoy}
                    balanceModulos={balanceModulos}
                    volZonas={volZonas}
                    presasData={presasData}
                    onClose={() => setShowReport(false)}
                />
            )}

            {!isPredictionVisible && activeEvent?.evento_tipo === 'LLENADO' && (
                <div className="floating-ui-controls-v2" data-pm-overlay>
                    <button type="button" className="control-btn-premium" onClick={() => setIsPredictionVisible(true)} title="Mostrar avance del frente">
                        <Timer size={18} />
                        <span className="btn-label">Trayecto</span>
                    </button>
                </div>
            )}
            {!isDockVisible && (
                <button type="button" className="pm-reabrir" onClick={() => setIsDockVisible(true)}
                    title="Mostrar tablero" aria-label="Mostrar tablero">
                    <Activity size={16} />
                    <span>Tablero</span>
                </button>
            )}
        </div>
    );
};

export default PublicMonitor;
