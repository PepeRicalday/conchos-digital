import React, { useMemo, useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Droplets, Gauge, Activity, AlertTriangle, TrendingUp, ChevronLeft, ChevronRight, Info, Satellite, RefreshCw, CalendarRange, FileText, Box } from 'lucide-react';
import ReactECharts from 'echarts-for-react';

// Lazy: Three.js + React Three Fiber son pesados (~600KB) y la mayoría de
// aperturas de este modal no van a activar el visor 3D — se descarga solo
// cuando el usuario hace clic en "Ver en 3D", no en el bundle inicial del
// modal (que ya carga Leaflet/ECharts vía GeoMonitor).
const VasoVisor3D = lazy(() => import('./VasoVisor3D'));
// Mismo chunk que VasoVisor3D (Three.js ya se descarga una sola vez si el
// usuario abre cualquiera de los dos) pero import perezoso aparte: el
// informe institucional puede pedirse SIN que el usuario haya abierto nunca
// el visor 3D interactivo, y no debe forzar la descarga de Three.js si nunca
// se pide un informe tampoco.
const VasoVisor3DCaptura = lazy(() => import('./VasoVisor3D').then(m => ({ default: m.VasoVisor3DCaptura })));
import './PresaVasoMonitor.css';
import { detectaSuperficieVaso, type SuperficieVaso } from '../utils/mapaSatelital';
import { supabase } from '../lib/supabase';
import InformeVasoInstitucional from './InformeVasoInstitucional';

interface GeometriaVasoFila {
    fecha_escena: string;
    area_km2: number;
    perimetro_km: number;
    num_islas: number;
    ratio_elongacion: number | null;
    delta_area_km2: number | null;
    pct_del_maximo_ciclo: number | null;
    contorno_geojson: { type: 'Polygon'; coordinates: [number, number][][] };
}

interface CurvaPunto { elevacion_msnm: number; volumen_mm3: number; area_ha: number | null }

/** SVG "d" para un anillo GeoJSON [lon,lat][] proyectado a coordenadas de
 *  pantalla equirrectangulares, con corrección de aspecto por cos(latCentral)
 *  (a esta latitud 1° de longitud cubre menos distancia real que 1° de
 *  latitud — sin la corrección el vaso se ve estirado horizontalmente). */
function anilloASvgPath(
    anillo: [number, number][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number,
    h: number
): string {
    const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
    const spanLat = bbox.maxLat - bbox.minLat;
    const escala = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * escala) / 2;
    const offY = (h - spanLat * escala) / 2;
    const pts = anillo.map(([lon, lat]) => {
        const x = offX + (lon - bbox.minLon) * bbox.cosLat * escala;
        const y = offY + (bbox.maxLat - lat) * escala; // Y invertida: lat mayor = arriba
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join('L')}Z`;
}

/** Bbox equirrectangular común a partir de N anillos exteriores GeoJSON, con
 *  margen del 10% — usado tanto por el mini-mapa de 2 fechas como por la
 *  galería mensual, para que todos los contornos de una misma presa se
 *  dibujen sobre el mismo marco y sean comparables entre sí a simple vista. */
function calculaBboxComun(anillosExteriores: [number, number][][]) {
    const lons = anillosExteriores.flat().map(([lon]) => lon);
    const lats = anillosExteriores.flat().map(([, lat]) => lat);
    const minLonRaw = Math.min(...lons), maxLonRaw = Math.max(...lons);
    const minLatRaw = Math.min(...lats), maxLatRaw = Math.max(...lats);
    const margenLon = (maxLonRaw - minLonRaw) * 0.1 || 0.01;
    const margenLat = (maxLatRaw - minLatRaw) * 0.1 || 0.01;
    return {
        minLon: minLonRaw - margenLon, maxLon: maxLonRaw + margenLon,
        minLat: minLatRaw - margenLat, maxLat: maxLatRaw + margenLat,
        cosLat: Math.cos((minLatRaw + maxLatRaw) / 2 * Math.PI / 180),
    };
}

/** Un solo "d" con todos los anillos del polígono (exterior + islas) para
 *  dibujar con fill-rule="evenodd" en un único <path> — así las islas se
 *  recortan del relleno del cuerpo de agua en vez de sobre-pintarse. */
function poligonoASvgPath(
    coordinates: [number, number][][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number,
    h: number,
    areaMinIslaPx2 = 6
): string {
    return coordinates
        .map((anillo, i) => {
            if (i === 0) return anilloASvgPath(anillo, bbox, w, h);
            // Islas: descarta las que quedarían microscópicas al dibujar,
            // para no saturar el mini-mapa con puntos ilegibles.
            const path = anilloASvgPath(anillo, bbox, w, h);
            const xs = anillo.map(([lon]) => lon);
            const spanLonPx = (Math.max(...xs) - Math.min(...xs)) * bbox.cosLat * Math.min(w / ((bbox.maxLon - bbox.minLon) * bbox.cosLat), h / (bbox.maxLat - bbox.minLat));
            return spanLonPx * spanLonPx >= areaMinIslaPx2 ? path : '';
        })
        .filter(Boolean)
        .join(' ');
}

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
    /** Qué sección enfocar al abrir: 'satelital' (NDWI del día, default),
     *  'ciclo' (comparativa mensual histórica) o 'relieve3d' (visor 3D con
     *  terreno real/hillshade activado automáticamente) — evita que el
     *  usuario tenga que bajar manualmente y hacer clic adicional en un
     *  modal largo cuando entra desde un botón dedicado del mapa. */
    seccionInicial?: 'satelital' | 'ciclo' | 'relieve3d';
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

export const PresaVasoMonitor: React.FC<PresaVasoMonitorProps> = ({ data, seccionInicial = 'satelital', onClose }) => {
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

    // Manejo de Vaso — histórico mensual (Fase 3): a diferencia del NDWI de
    // arriba (recalculado en el cliente cada vez que se abre el modal, sin
    // memoria de meses anteriores), esto lee vaso_geometria_historico —
    // poblada por el cron mensual sentinel-ndwi-vaso-sync, ya con área,
    // perímetro y KPI derivados calculados server-side. Comparativa
    // apertura-de-ciclo vs. más reciente + serie mensual de área/perímetro.
    const [historicoVaso, setHistoricoVaso] = useState<GeometriaVasoFila[]>([]);
    const [cargandoHistorico, setCargandoHistorico] = useState(false);

    // Textura satelital true-color del terreno (misma fuente que usa
    // TerrenoMesh en VasoVisor3D.tsx, tabla textura_satelital_terreno) —
    // se pasa al informe institucional para la sección "Contexto Satelital
    // del Vaso" (imagen real del entorno, no solo el polígono vectorizado).
    const [texturaSatelital, setTexturaSatelital] = useState<{ urlPublica: string; bbox: [number, number, number, number]; fechaEscena: string | null } | null>(null);
    useEffect(() => {
        let cancelado = false;
        supabase
            .from('textura_satelital_terreno')
            .select('bbox, url_publica, fecha_escena')
            .eq('presa_id', data.presa_id)
            .maybeSingle()
            .then(({ data: fila, error }) => {
                if (cancelado || error || !fila) return;
                setTexturaSatelital({
                    urlPublica: fila.url_publica,
                    bbox: fila.bbox as [number, number, number, number],
                    fechaEscena: fila.fecha_escena,
                });
            });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    // Extraído a función reutilizable: el useEffect inicial la llama al
    // montar/cambiar de presa, y el botón "Actualizar mes actual" (más
    // abajo) la vuelve a llamar tras invocar sentinel-ndwi-vaso-sync a
    // mano, para refrescar la galería sin esperar al cron del día 3.
    const recargarHistorico = useCallback(async () => {
        const { data: filas, error } = await supabase
            .from('vaso_geometria_historico')
            .select('fecha_escena, area_km2, perimetro_km, num_islas, ratio_elongacion, delta_area_km2, pct_del_maximo_ciclo, contorno_geojson')
            .eq('presa_id', data.presa_id)
            .order('fecha_escena', { ascending: true });
        setHistoricoVaso(error || !filas ? [] : (filas as GeometriaVasoFila[]));
    }, [data.presa_id]);

    useEffect(() => {
        let cancelado = false;
        setCargandoHistorico(true);
        recargarHistorico().then(() => { if (!cancelado) setCargandoHistorico(false); });
        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.presa_id]);

    // Sincronización manual del mes en curso — mismo endpoint que invoca el
    // cron automático (día 3 de cada mes, "últimos 30 días"), pero
    // disparable a demanda: útil para traer el mes actual sin esperar esa
    // fecha, o como respaldo si el cron falla (ver migración
    // 20260823100000_cron_ndwi_vaso_sync.sql). Sin parámetro "mes": la
    // función usa su propia ventana de últimos 30 días, igual que el cron.
    const [sincronizandoMes, setSincronizandoMes] = useState(false);
    const [resultadoSyncManual, setResultadoSyncManual] = useState<string | null>(null);
    const sincronizarMesActual = useCallback(async () => {
        setSincronizandoMes(true);
        setResultadoSyncManual(null);
        try {
            const { data: resultado, error } = await supabase.functions.invoke('sentinel-ndwi-vaso-sync', {
                body: { presa_id: data.presa_id },
            });
            if (error) throw error;
            if (resultado?.error) throw new Error(resultado.error);
            if (resultado?.insertado) {
                await recargarHistorico();
                setResultadoSyncManual(
                    `Actualizado: escena del ${new Date(resultado.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })} (${resultado.area_km2} km²).`
                );
            } else {
                setResultadoSyncManual(resultado?.mensaje || 'Sin escena nueva disponible en la ventana actual.');
            }
        } catch (err) {
            setResultadoSyncManual(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSincronizandoMes(false);
        }
    }, [data.presa_id, recargarHistorico]);

    // Lecturas de campo (escala/almacenamiento) de esta presa — necesarias
    // para la validación cruzada NDWI vs. curva batimétrica oficial: cada
    // lectura de campo trae una elevación real, que la curva EAC oficial
    // (data.curva) convierte en un área "esperada" para comparar contra el
    // área que el satélite midió ese mes.
    const [lecturasCampo, setLecturasCampo] = useState<{ fecha: string; escala_msnm: number }[]>([]);
    useEffect(() => {
        let cancelado = false;
        supabase
            .from('lecturas_presas')
            .select('fecha, escala_msnm')
            .eq('presa_id', data.presa_id)
            .not('escala_msnm', 'is', null)
            .order('fecha', { ascending: true })
            .then(({ data: filas, error }) => {
                if (cancelado) return;
                setLecturasCampo(error || !filas ? [] : (filas as { fecha: string; escala_msnm: number }[]));
            });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    // Recalibración Dinámica (factor de corrección vs. curva oficial CONAGUA):
    // poblada por el job mensual recalibra-curva-batimetrica, que compara área
    // NDWI real contra el área que la curva oficial predice en cada lectura de
    // campo. La curva oficial (data.curva) NUNCA se modifica — esto es un
    // ajuste sugerido aparte, mostrado como referencia junto a la validación
    // cruzada existente, no usado por el simulador de nivel.
    interface FactorCorreccion { banda_elevacion_msnm: number; factor_area: number; desviacion_pct_prom: number; n_observaciones: number }
    const [curvaCorregida, setCurvaCorregida] = useState<FactorCorreccion[]>([]);
    useEffect(() => {
        let cancelado = false;
        supabase
            .from('curva_batimetrica_correccion')
            .select('banda_elevacion_msnm, factor_area, desviacion_pct_prom, n_observaciones')
            .eq('presa_id', data.presa_id)
            .order('banda_elevacion_msnm', { ascending: true })
            .then(({ data: filas, error }) => {
                if (cancelado) return;
                setCurvaCorregida(error || !filas ? [] : (filas as FactorCorreccion[]));
            });
        return () => { cancelado = true; };
    }, [data.presa_id]);

    // Resumen de recalibración: desviación promedio ponderada por número de
    // observaciones (una banda con 1 sola escena pesa menos que una con 5) y
    // la banda con mayor azolve detectado (factor más alejado de 1.0), para
    // no obligar al usuario a leer la tabla completa de bandas para entender
    // "¿esta presa tiene azolve relevante o no?".
    const resumenRecalibracion = useMemo(() => {
        if (!curvaCorregida.length) return null;
        const totalObs = curvaCorregida.reduce((s, f) => s + f.n_observaciones, 0);
        const desviacionPonderada = totalObs > 0
            ? curvaCorregida.reduce((s, f) => s + f.desviacion_pct_prom * f.n_observaciones, 0) / totalObs
            : 0;
        const bandaMayorAzolve = [...curvaCorregida].sort((a, b) => a.desviacion_pct_prom - b.desviacion_pct_prom)[0];
        return { desviacionPonderada, bandaMayorAzolve, totalBandas: curvaCorregida.length };
    }, [curvaCorregida]);

    // Interpola área (ha) para una elevación dada usando la curva EAC oficial
    // — mismo principio que volumenPorElevacion, pero sobre area_ha en vez
    // de volumen_mm3, para poder comparar contra area_km2 del satélite.
    const areaPorElevacion = React.useCallback((elevacion: number): number | null => {
        const curva = data.curva;
        if (!curva || curva.length < 2) return null;
        const pts = [...curva].filter(p => p.area_ha != null).sort((a, b) => a.elevacion_msnm - b.elevacion_msnm);
        if (pts.length < 2) return null;
        if (elevacion <= pts[0].elevacion_msnm) return pts[0].area_ha;
        if (elevacion >= pts[pts.length - 1].elevacion_msnm) return pts[pts.length - 1].area_ha;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (elevacion >= a.elevacion_msnm && elevacion <= b.elevacion_msnm) {
                const t = (elevacion - a.elevacion_msnm) / (b.elevacion_msnm - a.elevacion_msnm);
                return (a.area_ha! + t * (b.area_ha! - a.area_ha!));
            }
        }
        return null;
    }, [data.curva]);

    // Validación cruzada: por cada mes con geometría satelital, busca la
    // lectura de campo más cercana en fecha (máx. 20 días de diferencia —
    // más allá de eso el nivel pudo cambiar demasiado para que la comparación
    // sea justa) y calcula el % de coincidencia entre el área esperada por la
    // curva batimétrica oficial y el área medida por NDWI de Sentinel-2.
    const UMBRAL_DIAS_VALIDACION = 20;
    const validacionCruzada = useMemo(() => {
        if (!historicoVaso.length || !lecturasCampo.length) return [];
        return historicoVaso.map(fila => {
            const tEscena = new Date(fila.fecha_escena).getTime();
            let mejor: { fecha: string; escala_msnm: number } | null = null;
            let mejorDiffDias = Infinity;
            for (const lc of lecturasCampo) {
                const diffDias = Math.abs(new Date(lc.fecha + 'T12:00:00Z').getTime() - tEscena) / 864e5;
                if (diffDias < mejorDiffDias) { mejorDiffDias = diffDias; mejor = lc; }
            }
            if (!mejor || mejorDiffDias > UMBRAL_DIAS_VALIDACION) {
                return { fecha_escena: fila.fecha_escena, areaSatelite: fila.area_km2, sinReferencia: true as const };
            }
            const areaEsperadaHa = areaPorElevacion(mejor.escala_msnm);
            if (areaEsperadaHa === null) {
                return { fecha_escena: fila.fecha_escena, areaSatelite: fila.area_km2, sinReferencia: true as const };
            }
            const areaEsperadaKm2 = areaEsperadaHa / 100;
            const pctCoincidencia = areaEsperadaKm2 > 0 ? (fila.area_km2 / areaEsperadaKm2) * 100 : null;
            return {
                fecha_escena: fila.fecha_escena,
                areaSatelite: fila.area_km2,
                sinReferencia: false as const,
                fechaLectura: mejor.fecha,
                escalaLectura: mejor.escala_msnm,
                diasDiferencia: Math.round(mejorDiffDias),
                areaEsperadaKm2,
                pctCoincidencia,
            };
        });
    }, [historicoVaso, lecturasCampo, areaPorElevacion]);

    // Gráfica de Desviación: contrasta directamente el área esperada por la
    // curva batimétrica oficial (CONAGUA) contra el área real medida por
    // NDWI de Sentinel-2, mes a mes — antes esta comparación solo existía
    // como barra de "% de coincidencia" (vaso-validacion-cruzada, abajo),
    // que resume la brecha en un solo número pero no deja ver la forma de
    // ambas curvas ni hacia dónde diverge la tendencia con el tiempo.
    const opcionesDesviacionConagua = useMemo(() => {
        const filas = validacionCruzada.filter(v => !v.sinReferencia && v.areaEsperadaKm2 != null);
        if (filas.length < 2) return null;
        const fechas = filas.map(v =>
            new Date(v.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' })
        );
        return {
            grid: { left: 50, right: 20, top: 36, bottom: 30 },
            tooltip: { trigger: 'axis' },
            legend: {
                data: ['Área esperada (CONAGUA)', 'Área medida (NDWI)'],
                textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0,
            },
            xAxis: { type: 'category', data: fechas, axisLabel: { color: '#64748b', fontSize: 10 } },
            yAxis: {
                type: 'value', name: 'km²',
                axisLabel: { color: '#64748b', fontSize: 10 },
                splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } },
            },
            series: [
                {
                    name: 'Área esperada (CONAGUA)', type: 'line', smooth: true,
                    data: filas.map(v => v.areaEsperadaKm2),
                    lineStyle: { color: '#94a3b8', width: 2, type: 'dashed' },
                    itemStyle: { color: '#94a3b8' },
                },
                {
                    name: 'Área medida (NDWI)', type: 'line', smooth: true,
                    data: filas.map(v => v.areaSatelite),
                    lineStyle: { color: '#22d3ee', width: 2.5 },
                    itemStyle: { color: '#22d3ee' },
                    areaStyle: { color: 'rgba(34,211,238,0.08)' },
                },
            ],
        };
    }, [validacionCruzada]);

    const primeraDelCiclo = historicoVaso[0] ?? null;
    const masReciente = historicoVaso.length ? historicoVaso[historicoVaso.length - 1] : null;

    // Índice de Fragmentación — semáforo de conectividad hidráulica: en vez
    // de mostrar ratio_elongacion como número crudo (7-8x en un embalse
    // dendrítico como La Boquilla no dice nada por sí solo sin referencia),
    // se compara el mes más reciente contra el PROMEDIO HISTÓRICO de esa
    // misma presa — así cada vaso se evalúa contra su propia forma natural,
    // no contra un umbral fijo que no tendría sentido entre La Boquilla
    // (muy dendrítica) y Fco. I. Madero (más compacta). num_islas actúa como
    // agravante: si el vaso además expone más bancos de tierra de lo usual,
    // sube un nivel — dos señales de fragmentación a la vez son más
    // confiables que una sola, que puede ser ruido de una escena puntual.
    const fragmentacionVaso = useMemo(() => {
        const conRatio = historicoVaso.filter(f => f.ratio_elongacion != null);
        if (conRatio.length < 3 || !masReciente || masReciente.ratio_elongacion == null) {
            return { disponible: false as const };
        }
        // Baseline = promedio histórico excluyendo el mes evaluado (si hay
        // más de 3 meses con dato) — evita que el propio mes reciente infle
        // su referencia de comparación.
        const previos = conRatio.filter(f => f.fecha_escena !== masReciente.fecha_escena);
        const baseRatio = previos.length >= 2
            ? previos.reduce((s, f) => s + f.ratio_elongacion!, 0) / previos.length
            : conRatio.reduce((s, f) => s + f.ratio_elongacion!, 0) / conRatio.length;

        const ratioActual = masReciente.ratio_elongacion!;
        const desviacionPct = baseRatio > 0 ? ((ratioActual - baseRatio) / baseRatio) * 100 : 0;

        let nivel: 'normal' | 'atencion' | 'critico' =
            desviacionPct <= 15 ? 'normal' : desviacionPct <= 30 ? 'atencion' : 'critico';

        // Agravante por bancos de tierra expuestos (num_islas): si el mes
        // reciente también supera su propio promedio histórico de islas,
        // sube un nivel (normal→atención, atención→crítico) — nunca baja.
        const conIslas = historicoVaso.filter(f => f.fecha_escena !== masReciente.fecha_escena);
        const baseIslas = conIslas.length
            ? conIslas.reduce((s, f) => s + f.num_islas, 0) / conIslas.length
            : masReciente.num_islas;
        const islasAgravante = masReciente.num_islas > baseIslas + 1;
        if (islasAgravante && nivel === 'normal') nivel = 'atencion';
        else if (islasAgravante && nivel === 'atencion') nivel = 'critico';

        return {
            disponible: true as const, nivel, desviacionPct, baseRatio, ratioActual,
            islasAgravante, baseIslas, islasActuales: masReciente.num_islas,
        };
    }, [historicoVaso, masReciente]);

    // Selección de los dos meses a comparar en el mini-mapa y las tarjetas —
    // por defecto apertura de ciclo (0) vs. más reciente (último índice),
    // pero el usuario puede elegir cualquier otro par ya presente en
    // historicoVaso. Se reinicia cuando cambia la presa o llega un nuevo
    // largo de histórico (evita índices fuera de rango).
    const [idxBase, setIdxBase] = useState(0);
    const [idxComparado, setIdxComparado] = useState(0);
    useEffect(() => {
        if (!historicoVaso.length) return;
        setIdxBase(0);
        setIdxComparado(historicoVaso.length - 1);
    }, [data.presa_id, historicoVaso.length]);

    const filaBase = historicoVaso[idxBase] ?? primeraDelCiclo;
    const filaComparada = historicoVaso[idxComparado] ?? masReciente;
    const deltaAreaCiclo = filaBase && filaComparada ? filaComparada.area_km2 - filaBase.area_km2 : null;
    const deltaPerimetroCiclo = filaBase && filaComparada ? filaComparada.perimetro_km - filaBase.perimetro_km : null;

    const opcionesSerieMensual = useMemo(() => {
        if (!historicoVaso.length) return null;
        const fechas = historicoVaso.map(f =>
            new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' })
        );
        return {
            grid: { left: 50, right: 50, top: 30, bottom: 30 },
            tooltip: { trigger: 'axis' },
            legend: { data: ['Área (km²)', 'Perímetro (km)'], textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0 },
            xAxis: { type: 'category', data: fechas, axisLabel: { color: '#64748b', fontSize: 10 } },
            yAxis: [
                { type: 'value', name: 'km²', position: 'left', axisLabel: { color: '#22d3ee', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.1)' } } },
                { type: 'value', name: 'km', position: 'right', axisLabel: { color: '#a78bfa', fontSize: 10 }, splitLine: { show: false } },
            ],
            series: [
                {
                    name: 'Área (km²)', type: 'line', yAxisIndex: 0, smooth: true,
                    data: historicoVaso.map(f => f.area_km2),
                    lineStyle: { color: '#22d3ee', width: 2 },
                    itemStyle: { color: '#22d3ee' },
                    areaStyle: { color: 'rgba(34,211,238,0.08)' },
                    // Un hueco en la serie (mes sin dato confiable) debe verse
                    // como corte, no como interpolación silenciosa — echarts
                    // ya rompe la línea en null por defecto sin config extra.
                    connectNulls: false,
                },
                {
                    name: 'Perímetro (km)', type: 'line', yAxisIndex: 1, smooth: true,
                    data: historicoVaso.map(f => f.perimetro_km),
                    lineStyle: { color: '#a78bfa', width: 2, type: 'dashed' },
                    itemStyle: { color: '#a78bfa' },
                    connectNulls: false,
                },
            ],
        };
    }, [historicoVaso]);

    // Mini-mapa comparativo (apertura de ciclo vs. más reciente): un solo
    // SVG con ambos contornos superpuestos sobre un bbox común (unión de los
    // dos anillos exteriores + margen), en vez de Leaflet — evita cargar un
    // mapa interactivo completo para mostrar dos siluetas fijas dentro de un
    // modal ya largo.
    const mapaComparativo = useMemo(() => {
        if (!filaBase || !filaComparada) return null;
        const W = 640, H = 380;
        const bbox = calculaBboxComun([filaBase.contorno_geojson.coordinates[0], filaComparada.contorno_geojson.coordinates[0]]);
        return {
            W, H,
            pathBase: poligonoASvgPath(filaBase.contorno_geojson.coordinates, bbox, W, H),
            pathComparado: poligonoASvgPath(filaComparada.contorno_geojson.coordinates, bbox, W, H),
        };
    }, [filaBase, filaComparada]);

    // Filtro de Renderizado Espacial — visor de azolve: toggle entre los dos
    // polígonos elegidos arriba, iluminando en rojo SOLO las zonas que eran
    // agua en el mes base y ya no lo son en el mes comparado (banco expuesto
    // / azolve), y en cian tenue las zonas de nueva inundación (el caso
    // inverso, útil para distinguir "el vaso solo bajó" de "el vaso cambió
    // de forma"). Sin librería de geometría en el proyecto (turf, polygon-
    // clipping): la diferencia se resuelve rasterizando ambos contornos a una
    // grilla sobre el MISMO bbox de mapaComparativo con point-in-polygon
    // (ray casting), el mismo principio que ya usa el backend para ir de
    // máscara de píxeles a contorno, solo que aquí no hace falta vectorizar
    // el resultado — un rectángulo por celda alcanza para pintarlo.
    const [mostrarAzolve, setMostrarAzolve] = useState(false);
    const diffAzolve = useMemo(() => {
        if (!mostrarAzolve || !filaBase || !filaComparada) return null;
        const W = 640, H = 380;
        const RES = 3; // celdas de 3px — suficiente detalle sin recalcular miles de puntos por render
        const bbox = calculaBboxComun([filaBase.contorno_geojson.coordinates[0], filaComparada.contorno_geojson.coordinates[0]]);

        // Point-in-polygon con soporte de islas (evenodd): cuenta cruces con
        // TODOS los anillos (exterior + islas) — dentro del exterior pero
        // dentro de un anillo de isla también cuenta como cruce extra, que
        // paridad impar/par ya resuelve sin lógica especial.
        const dentroDelPoligono = (coordinates: [number, number][][], lon: number, lat: number): boolean => {
            let dentro = false;
            for (const anillo of coordinates) {
                for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
                    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
                    const cruza = ((yi > lat) !== (yj > lat)) &&
                        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
                    if (cruza) dentro = !dentro;
                }
            }
            return dentro;
        };

        const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
        const spanLat = bbox.maxLat - bbox.minLat;
        const escala = Math.min(W / spanLon, H / spanLat);
        const offX = (W - spanLon * escala) / 2;
        const offY = (H - spanLat * escala) / 2;

        const celdasAzolve: string[] = [];   // agua en base, tierra en comparado
        const celdasNuevaAgua: string[] = []; // tierra en base, agua en comparado
        let areaAzolvePx2 = 0, areaNuevaPx2 = 0;

        for (let py = 0; py < H; py += RES) {
            for (let px = 0; px < W; px += RES) {
                // Invierte la proyección de anilloASvgPath: pixel → lon/lat.
                const lon = bbox.minLon + (px - offX) / (bbox.cosLat * escala);
                const lat = bbox.maxLat - (py - offY) / escala;
                if (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat) continue;

                const enBase = dentroDelPoligono(filaBase.contorno_geojson.coordinates, lon, lat);
                const enComparado = dentroDelPoligono(filaComparada.contorno_geojson.coordinates, lon, lat);
                if (enBase && !enComparado) { celdasAzolve.push(`${px},${py}`); areaAzolvePx2 += RES * RES; }
                else if (!enBase && enComparado) { celdasNuevaAgua.push(`${px},${py}`); areaNuevaPx2 += RES * RES; }
            }
        }

        // km² por px²: la escala ya comprime lon→distancia real vía cosLat,
        // así que 1px en X y 1px en Y representan la misma distancia real —
        // basta convertir con el span real (km) entre span en px.
        const spanLonKm = (bbox.maxLon - bbox.minLon) * bbox.cosLat * 111.32;
        const kmPorPx = spanLonKm / spanLon; // spanLon aquí ya está en "grados*cosLat", coherente con spanLonKm
        const km2PorPx2 = kmPorPx * kmPorPx;

        return {
            W, H, RES,
            celdasAzolve, celdasNuevaAgua,
            areaAzolveKm2: areaAzolvePx2 * km2PorPx2,
            areaNuevaKm2: areaNuevaPx2 * km2PorPx2,
        };
    }, [mostrarAzolve, filaBase, filaComparada]);

    // Galería mensual: un mini-mapa por cada mes del histórico, todos sobre
    // el MISMO bbox (unión de todos los meses, no solo 2) para que la
    // progresión completa del ciclo se pueda comparar a simple vista en una
    // tira horizontal, sin tener que elegir pares uno a uno.
    const galeriaMensual = useMemo(() => {
        if (historicoVaso.length < 1) return null;
        const W = 220, H = 150;
        const bbox = calculaBboxComun(historicoVaso.map(f => f.contorno_geojson.coordinates[0]));
        return historicoVaso.map(f => ({
            fecha_escena: f.fecha_escena,
            area_km2: f.area_km2,
            perimetro_km: f.perimetro_km,
            path: poligonoASvgPath(f.contorno_geojson.coordinates, bbox, W, H),
            W, H,
        }));
    }, [historicoVaso]);

    // Informe institucional (SRL Conchos / SICA 005): documento HTML compartible
    // con tendencia, polígonos y KPIs de todo el histórico de la presa —
    // reutiliza los mismos datos ya cargados en historicoVaso, sin fetch propio.
    const [mostrarInforme, setMostrarInforme] = useState(false);

    // Imagen de relieve para el informe: ángulo panorámico FIJO (a diferencia
    // del visor 3D interactivo, que depende de cómo haya quedado orbitando la
    // cámara el último usuario) — se genera montando VasoVisor3DCaptura oculto.
    // undefined = todavía no se pidió; null = se pidió y no hay DEM disponible
    // para esta presa (el informe se genera igual, solo sin esa sección).
    const [imagenRelieveInforme, setImagenRelieveInforme] = useState<string | null | undefined>(undefined);
    // El modal del informe (y su botón "Imprimir/PDF") solo se muestran
    // DESPUÉS de que la captura resuelva (imagen o null) — antes, el informe
    // se abría de inmediato con imagenRelieveInforme todavía en undefined, y
    // si el usuario hacía clic en "Imprimir/PDF" antes de que la captura
    // llegara (varios segundos: fetch del DEM + textura satelital de varios
    // MB + render), el PDF generado quedaba con esa versión vieja (sin la
    // sección de relieve) aunque el iframe en pantalla se actualizara un
    // instante después — causa real del "no se actualiza" reportado en el
    // PDF exportado.
    const [preparandoInforme, setPreparandoInforme] = useState(false);
    // Montaje diferido de VasoVisor3DCaptura tras preparandoInforme=true: si
    // el visor 3D interactivo estaba abierto (mostrarVisor3D), se desmonta
    // en el MISMO render en que preparandoInforme se activa, pero el
    // navegador no libera la VRAM de ese contexto WebGL de forma instantánea
    // — montar el Canvas de captura en el mismo tick competía por memoria
    // con el contexto todavía en proceso de liberarse, y perdía el suyo
    // propio a mitad de captura (confirmado en consola: "Context Lost" justo
    // tras un toDataURL() de solo 5.8KB — un frame vacío, no el relieve
    // real). 400ms de margen es suficiente en la práctica para que el
    // navegador libere el contexto anterior antes de abrir uno nuevo.
    const [capturaListaParaMontar, setCapturaListaParaMontar] = useState(false);
    const abrirInforme = useCallback(() => {
        if (imagenRelieveInforme !== undefined) { setMostrarInforme(true); return; }
        // Sin histórico todavía no hay ningún mes que capturar en 3D — abre
        // el informe directo (sin sección de relieve) en vez de quedarse
        // esperando para siempre una captura que nunca se va a disparar.
        if (!masReciente) { setImagenRelieveInforme(null); setMostrarInforme(true); return; }
        setPreparandoInforme(true);
    }, [imagenRelieveInforme, masReciente]);
    useEffect(() => {
        if (!preparandoInforme) { setCapturaListaParaMontar(false); return; }
        const t = setTimeout(() => setCapturaListaParaMontar(true), 400);
        return () => clearTimeout(t);
    }, [preparandoInforme]);
    useEffect(() => {
        if (preparandoInforme && imagenRelieveInforme !== undefined) {
            setPreparandoInforme(false);
            setMostrarInforme(true);
        }
    }, [preparandoInforme, imagenRelieveInforme]);
    // Reinicia la captura pendiente al cambiar de presa — sin esto, abrir el
    // informe de una segunda presa en la misma sesión del modal (el
    // componente se remonta con nuevo `data.presa_id` vía key del padre, así
    // que en la práctica esto solo cubre el caso de reutilización futura)
    // podría mostrar la imagen de relieve de la presa anterior.
    useEffect(() => { setImagenRelieveInforme(undefined); }, [data.presa_id]);

    // Visor 3D (Fase 1): extrusión del polígono NDWI del mes "comparado"
    // (mismo selector que el mini-mapa 2D) con profundidad aproximada desde
    // la curva batimétrica oficial — ver disclaimer completo en
    // VasoVisor3D.tsx. Colapsado por defecto: Three.js solo se descarga
    // cuando el usuario decide verlo.
    const [mostrarVisor3D, setMostrarVisor3D] = useState(false);

    // Scroll automático a la sección de ciclo cuando se entra por el botón
    // dedicado "Evolución del Ciclo" — el modal es largo (varias secciones
    // apiladas) y sin esto el usuario tendría que bajar manualmente cada vez.
    const seccionCicloRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if ((seccionInicial === 'ciclo' || seccionInicial === 'relieve3d') && seccionCicloRef.current) {
            seccionCicloRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // 'relieve3d': activa el visor 3D de una vez — sin esto el usuario
        // llegaba a la sección correcta con scroll automático pero igual
        // tenía que hacer un clic más ("Ver en 3D") para llegar al relieve
        // real que pidió explícitamente desde el mapa.
        if (seccionInicial === 'relieve3d') setMostrarVisor3D(true);
        // Se dispara una sola vez al montar con esta prop — no en cada
        // render, para no pelear con el scroll/toggle manual del usuario después.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="vaso-screen-overlay">
            <div className="vaso-container animate-in-zoom">
                {/* UI OVERLAYS — envueltas en un contenedor scrolleable: antes
                    vaso-container tenía overflow:hidden y altura fija (90vh),
                    así que con 5+ secciones apiladas (simulador, KPIs, análisis
                    técnico, NDWI, evolución de ciclo) el contenido que excedía
                    la altura visible se cortaba sin ningún scroll posible —
                    causa real de que la sección nueva de "Evolución del Ciclo"
                    fuera invisible sin importar cuánto se bajara. Ya no hay
                    imagen satelital de fondo cubriendo todo el modal — la foto
                    del vaso ahora vive solo detrás de los polígonos de
                    comparación mensual, donde aporta contexto real en vez de
                    competir con el texto de las secciones de arriba. */}
                <div className="vaso-scroll-content">
                <header className="vaso-header">
                    <div className="vaso-title-group">
                        <div className="vaso-badge">SITUACIÓN E INTERACTIVIDAD DE VASO</div>
                        <h2>{data.nombre.toUpperCase()}</h2>
                        <div className="vaso-coords">
                            LECTURA OFICIAL: {tieneNivel ? `${data.nivel_msnm!.toFixed(2)} msnm` : 'S/D — sin lectura del día'}
                        </div>
                    </div>
                    {/* Acceso directo al relieve 3D desde el header — antes el
                        visor (terreno real Copernicus DEM + hillshade) solo se
                        alcanzaba bajando hasta Evolución del Vaso y haciendo un
                        clic más en "Ver en 3D"; con esto queda a un clic desde
                        que se abre el modal, sin importar cómo se haya entrado. */}
                    <button
                        type="button"
                        className="vaso-header-3d-btn"
                        onClick={() => { setMostrarVisor3D(true); seccionCicloRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        title="Ir directo al visor 3D con terreno real"
                    >
                        <Box size={14} /> Ver Relieve 3D
                    </button>
                    <button className="vaso-close" onClick={onClose}>×</button>
                </header>

                {/* CONTROLES DE SIMULACIÓN INTERACTIVA — deshabilitado sin lectura real de ancla */}
                <div className="vaso-sim-controls glass">
                    <div className="sim-header">
                        <Activity size={16} /> SIMULADOR DE IMPACTO HIDRÁULICO
                    </div>
                    <div className="sim-body">
                        {!tieneNivel ? (
                            <div className="sim-value-display sim-msg" style={{ opacity: 0.6 }}>
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
                                    <div className="sim-value-display sim-msg" style={{ opacity: 0.6 }}>
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
                                    <span>Todavía no se ha capturado la lectura de nivel de hoy en campo.</span>
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

                {/* VISTA RÁPIDA DE SUPERFICIE — recalculada en el cliente cada
                    vez que se abre el modal, sin memoria de meses anteriores.
                    Badge "APROXIMADO" la distingue de la sección de abajo, que
                    usa geometría validada y persistida server-side. */}
                <div className="vaso-analytics glass">
                    <div className="vaso-analytics-header">
                        <Satellite size={16} /> VISTA RÁPIDA DE SUPERFICIE — ESTIMACIÓN EN VIVO
                        <span className="vaso-confiabilidad-badge aproximado">APROXIMADO</span>
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
                                No hay una imagen satelital reciente y despejada para esta presa — vuelve a intentarlo
                                en unos minutos o consulta la evolución del ciclo abajo, que sí conserva meses pasados.
                            </div>
                        ) : superficieVaso ? (
                            <>
                                <div className="vaso-ndwi-compare">
                                    <div className="vaso-ndwi-col">
                                        <span className="vaso-ndwi-label">Superficie estimada (hoy)</span>
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
                                    Cálculo rápido sobre imaginería visual (ArcGIS World Imagery, sin banda infrarroja real) —
                                    útil como referencia del día, no como medición certificada. Cobertura de imagen: {(superficieVaso.cobertura * 100).toFixed(0)}%.
                                    Para cifras validadas por sensor multiespectral, ver la evolución del ciclo abajo.
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>

                {/* EVOLUCIÓN DEL VASO — HISTÓRICO VALIDADO (Fase 3): comparativa
                    apertura de ciclo vs. más reciente + serie de área/perímetro
                    por mes, leída de vaso_geometria_historico (poblada por el
                    cron mensual sentinel-ndwi-vaso-sync). A diferencia de la
                    vista rápida de arriba, esto tiene memoria de meses pasados
                    y usa geometría vectorizada y validada (marching squares +
                    tabla de Bourke) sobre banda infrarroja real de Sentinel-2. */}
                <div className="vaso-analytics glass" ref={seccionCicloRef}>
                    <div className="vaso-analytics-header">
                        <CalendarRange size={16} /> EVOLUCIÓN DEL VASO — HISTÓRICO VALIDADO (SENTINEL-2)
                        <span className="vaso-confiabilidad-badge validado">VALIDADO</span>
                        <button
                            className="sim-reset-btn"
                            style={{ marginLeft: 'auto', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={sincronizarMesActual}
                            disabled={sincronizandoMes}
                            title="Trae la escena Sentinel-2 más reciente (últimos 30 días) sin esperar al cron automático del día 3"
                        >
                            <RefreshCw size={12} className={sincronizandoMes ? 'animate-spin' : undefined} />
                            {sincronizandoMes ? 'Sincronizando…' : 'Actualizar mes actual'}
                        </button>
                        {historicoVaso.length > 0 && (
                            <button
                                className="sim-reset-btn"
                                style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
                                onClick={abrirInforme}
                                disabled={preparandoInforme}
                                title="Generar informe institucional SRL Conchos / SICA 005"
                            >
                                <FileText size={12} className={preparandoInforme ? 'animate-spin' : ''} />
                                {preparandoInforme ? 'Preparando relieve 3D…' : 'Informe Institucional'}
                            </button>
                        )}
                    </div>
                    {resultadoSyncManual && (
                        <div className="vaso-prediction" style={{ fontSize: 11.5, opacity: 0.8, padding: '0 1rem', marginTop: -4, marginBottom: 8 }}>
                            {resultadoSyncManual}
                        </div>
                    )}
                    <div className="vaso-analytics-body" style={{ gridTemplateColumns: '1fr' }}>
                        {cargandoHistorico ? (
                            <div className="vaso-prediction" style={{ opacity: 0.7 }}>Cargando histórico de vaso…</div>
                        ) : !historicoVaso.length ? (
                            <div className="vaso-prediction" style={{ opacity: 0.6 }}>
                                Todavía no hay meses registrados para esta presa — el sincronizador mensual de Sentinel-2
                                empezará a llenar esta línea de tiempo con la próxima escena despejada disponible.
                            </div>
                        ) : (
                            <>
                                {/* Índice de Fragmentación — semáforo de conectividad hidráulica:
                                    compara la forma del mes más reciente (ratio_elongacion,
                                    agravado por num_islas) contra el promedio histórico de ESTA
                                    presa, no contra un umbral fijo — un embalse dendrítico como
                                    La Boquilla tiene un ratio "normal" muy distinto al de Fco. I.
                                    Madero, así que solo el desvío respecto a su propia forma
                                    habitual es una señal confiable de pérdida de conectividad. */}
                                {fragmentacionVaso.disponible ? (
                                    <div className={clsx('vaso-fragmentacion-box', `nivel-${fragmentacionVaso.nivel}`)}>
                                        <div className="vaso-fragmentacion-semaforo">
                                            <span className="vaso-fragmentacion-dot" />
                                            <span className="vaso-fragmentacion-nivel">
                                                {fragmentacionVaso.nivel === 'normal' ? 'Conectividad normal'
                                                    : fragmentacionVaso.nivel === 'atencion' ? 'Atención — inicio de fragmentación'
                                                        : 'Crítico — pérdida de conectividad hidráulica'}
                                            </span>
                                        </div>
                                        <div className="vaso-fragmentacion-detalle">
                                            Ratio de elongación actual <strong>{fragmentacionVaso.ratioActual!.toFixed(2)}x</strong> vs.
                                            promedio histórico <strong>{fragmentacionVaso.baseRatio!.toFixed(2)}x</strong> de esta presa
                                            ({fragmentacionVaso.desviacionPct! >= 0 ? '+' : ''}{fragmentacionVaso.desviacionPct!.toFixed(0)}%).
                                            {fragmentacionVaso.islasAgravante && (
                                                <> Además, {fragmentacionVaso.islasActuales} bancos de tierra expuestos superan el
                                                    promedio histórico ({fragmentacionVaso.baseIslas!.toFixed(1)}) — señal compuesta.</>
                                            )}
                                        </div>
                                        <div className="vaso-prediction" style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>
                                            Índice de Fragmentación: compara el ratio de elongación (perímetro real / perímetro de
                                            círculo de igual área) del mes más reciente contra el promedio histórico de esta presa.
                                            Un ratio muy por encima de lo habitual indica que el vaso se está angostando en brazos
                                            separados — riesgo de que zonas del embalse queden hidráulicamente desconectadas del
                                            cuerpo principal antes de que eso sea visible a simple vista en la imagen satelital.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="vaso-prediction" style={{ opacity: 0.55, fontSize: 11.5, marginBottom: '1rem' }}>
                                        Índice de Fragmentación: se requieren al menos 3 meses con dato de forma para calibrar
                                        el promedio histórico de esta presa.
                                    </div>
                                )}

                                {galeriaMensual && (
                                    <div className="vaso-galeria-mensual">
                                        <div className="vaso-galeria-titulo">Una imagen por mes, todas sobre el mismo encuadre</div>
                                        <div className="vaso-galeria-tira">
                                            {galeriaMensual.map((mes) => (
                                                <div className="vaso-galeria-item" key={mes.fecha_escena}>
                                                    <svg viewBox={`0 0 ${mes.W} ${mes.H}`} width="100%" height="auto" role="img"
                                                        aria-label={`Contorno del vaso en ${new Date(mes.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`}>
                                                        <rect x="0" y="0" width={mes.W} height={mes.H} fill="rgba(255,255,255,0.02)" />
                                                        <path d={mes.path} fill="rgba(34,211,238,0.22)" stroke="#22d3ee" strokeWidth="1.5" fillRule="evenodd" />
                                                    </svg>
                                                    <div className="vaso-galeria-fecha">
                                                        {new Date(mes.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </div>
                                                    <div className="vaso-galeria-kpi">{mes.area_km2.toFixed(1)} km²</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="vaso-prediction" style={{ fontSize: 12, opacity: 0.85, marginBottom: '1rem' }}>
                                    Para más detalle, compara cualquier par de meses entre sí — por defecto, apertura del
                                    ciclo agrícola contra la imagen más reciente disponible.
                                </div>

                                {historicoVaso.length > 1 && (
                                    <div className="vaso-mes-selectores">
                                        <label className="vaso-mes-selector">
                                            <span>Comparar desde</span>
                                            <select value={idxBase} onChange={(e) => setIdxBase(Number(e.target.value))}>
                                                {historicoVaso.map((f, i) => (
                                                    <option key={f.fecha_escena} value={i}>
                                                        {new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="vaso-mes-selector">
                                            <span>Hasta</span>
                                            <select value={idxComparado} onChange={(e) => setIdxComparado(Number(e.target.value))}>
                                                {historicoVaso.map((f, i) => (
                                                    <option key={f.fecha_escena} value={i}>
                                                        {new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            className={clsx('vaso-azolve-toggle', mostrarAzolve && 'activo')}
                                            onClick={() => setMostrarAzolve(v => !v)}
                                            title="Iluminar zonas de azolve/bancos expuestos entre ambos meses"
                                        >
                                            {mostrarAzolve ? 'Ocultar' : 'Mostrar'} azolve
                                        </button>
                                    </div>
                                )}

                                {mapaComparativo && filaBase && filaComparada && (
                                    <div className="vaso-mapa-comparativo">
                                        <svg viewBox={`0 0 ${mapaComparativo.W} ${mapaComparativo.H}`} width="100%" height="auto" role="img"
                                            aria-label={`Contorno del vaso en ${new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })} comparado con ${new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`}>
                                            <path d={mapaComparativo.pathBase} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" fillRule="evenodd" />
                                            <path d={mapaComparativo.pathComparado} fill="rgba(34,211,238,0.18)" stroke="#22d3ee" strokeWidth="2.5" fillRule="evenodd" />
                                            {/* Visor de azolve: un <rect> por celda de la grilla de
                                                diferencia — rojo = agua en el mes base que ya no lo es
                                                en el comparado (azolve/banco expuesto), cian tenue = el
                                                caso inverso (nueva inundación). */}
                                            {diffAzolve && (
                                                <g>
                                                    {diffAzolve.celdasAzolve.map(c => {
                                                        const [x, y] = c.split(',').map(Number);
                                                        return <rect key={`az-${c}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#ef4444" opacity={0.75} />;
                                                    })}
                                                    {diffAzolve.celdasNuevaAgua.map(c => {
                                                        const [x, y] = c.split(',').map(Number);
                                                        return <rect key={`na-${c}`} x={x} y={y} width={diffAzolve.RES} height={diffAzolve.RES} fill="#22d3ee" opacity={0.4} />;
                                                    })}
                                                </g>
                                            )}
                                        </svg>
                                        <div className="vaso-mapa-leyenda">
                                            <span className="leyenda-item">
                                                <span className="leyenda-swatch marzo"></span>
                                                {new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="leyenda-item">
                                                <span className="leyenda-swatch reciente"></span>
                                                {new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            {mostrarAzolve && diffAzolve && (
                                                <>
                                                    <span className="leyenda-item">
                                                        <span className="leyenda-swatch" style={{ background: 'rgba(239,68,68,0.75)', border: 'none' }}></span>
                                                        Azolve / banco expuesto: {diffAzolve.areaAzolveKm2.toFixed(2)} km²
                                                    </span>
                                                    <span className="leyenda-item">
                                                        <span className="leyenda-swatch" style={{ background: 'rgba(34,211,238,0.4)', border: 'none' }}></span>
                                                        Nueva inundación: {diffAzolve.areaNuevaKm2.toFixed(2)} km²
                                                    </span>
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                className="vaso3d-toggle-btn"
                                                style={{ marginLeft: 'auto' }}
                                                onClick={() => setMostrarVisor3D(v => !v)}
                                            >
                                                <Box size={12} /> {mostrarVisor3D ? 'Ocultar' : 'Ver'} en 3D
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Visor 3D (Fase 1) — extrusión del polígono del mes
                                    "comparado" seleccionado arriba. Lazy: Three.js/R3F
                                    solo se descargan si el usuario activa este toggle.
                                    Se desmonta mientras se prepara el informe institucional
                                    (preparandoInforme): VasoVisor3DCaptura abre su PROPIO
                                    Canvas WebGL con el mismo DEM + textura satelital de
                                    varios MB — dos contextos WebGL pesados a la vez agotaba
                                    la VRAM disponible y perdía el contexto (confirmado en
                                    consola: "THREE.WebGLRenderer: Context Lost" justo
                                    después de capturar), dejando la imagen del informe en
                                    un rectángulo vacío/casi negro en vez del relieve real. */}
                                {mostrarVisor3D && !preparandoInforme && filaComparada && (
                                    <Suspense fallback={<div className="vaso3d-empty">Cargando visor 3D…</div>}>
                                        <VasoVisor3D
                                            contornoGeojson={filaComparada.contorno_geojson}
                                            curva={data.curva}
                                            nivelMsnm={data.nivel_msnm}
                                            nombrePresa={data.nombre}
                                            fechaEscena={filaComparada.fecha_escena}
                                            presaId={data.presa_id}
                                        />
                                    </Suspense>
                                )}

                                {filaBase && filaComparada && (
                                    <div className="vaso-ndwi-compare" style={{ marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                                        <div className="vaso-ndwi-col">
                                            <span className="vaso-ndwi-label">
                                                {new Date(filaBase.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="vaso-ndwi-value">{filaBase.area_km2.toFixed(1)} <small>km²</small></span>
                                            <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                perímetro {filaBase.perimetro_km.toFixed(0)} km
                                                {filaBase.num_islas > 0 && ` · ${filaBase.num_islas} banco${filaBase.num_islas === 1 ? '' : 's'} de tierra expuestos`}
                                            </span>
                                        </div>
                                        <div className="vaso-ndwi-col">
                                            <span className="vaso-ndwi-label">
                                                {new Date(filaComparada.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                            </span>
                                            <span className="vaso-ndwi-value">{filaComparada.area_km2.toFixed(1)} <small>km²</small></span>
                                            <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                perímetro {filaComparada.perimetro_km.toFixed(0)} km
                                                {filaComparada.num_islas > 0 && ` · ${filaComparada.num_islas} banco${filaComparada.num_islas === 1 ? '' : 's'} de tierra expuestos`}
                                            </span>
                                        </div>
                                        {deltaAreaCiclo !== null && deltaPerimetroCiclo !== null && (
                                            <div className="vaso-ndwi-col">
                                                <span className="vaso-ndwi-label">Variación entre ambos meses</span>
                                                <span className="vaso-ndwi-value" style={{ color: deltaAreaCiclo < 0 ? '#f59e0b' : '#10b981', fontSize: '1.1rem' }}>
                                                    {deltaAreaCiclo >= 0 ? '+' : ''}{deltaAreaCiclo.toFixed(1)} km²
                                                </span>
                                                <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                    perímetro {deltaPerimetroCiclo >= 0 ? '+' : ''}{deltaPerimetroCiclo.toFixed(0)} km
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {filaComparada?.pct_del_maximo_ciclo !== null && filaComparada?.pct_del_maximo_ciclo !== undefined && (
                                    <div className="vaso-prediction" style={{ fontSize: 11.5, opacity: 0.8, marginBottom: '1rem' }}>
                                        La superficie del mes de llegada equivale al <strong>{filaComparada.pct_del_maximo_ciclo.toFixed(0)}%</strong> del
                                        máximo alcanzado por el vaso en lo que va del ciclo agrícola.
                                    </div>
                                )}

                                {opcionesSerieMensual && (
                                    <ReactECharts option={opcionesSerieMensual} style={{ height: '220px', width: '100%' }} opts={{ renderer: 'svg' }} />
                                )}
                                <div className="vaso-prediction" style={{ fontSize: 10.5, opacity: 0.65, marginTop: 8 }}>
                                    Área neta (bancos de tierra excluidos) y perímetro real vía NDWI de Sentinel-2 (10-20m/pixel),
                                    vectorizado con marching squares. Un hueco en la línea indica un mes sin escena confiable
                                    por nubosidad excesiva — nunca se registra como cero.
                                </div>

                                {validacionCruzada.some(v => !v.sinReferencia) && (
                                    <div className="vaso-validacion-cruzada">
                                        <div className="vaso-validacion-titulo">
                                            Validación cruzada: satélite vs. curva batimétrica oficial
                                        </div>

                                        {/* Gráfica de Desviación: área esperada por CONAGUA (curva
                                            batimétrica oficial) vs. área real medida por NDWI, mes a
                                            mes — la barra de % de abajo resume la brecha en un solo
                                            número por mes; esta gráfica deja ver la FORMA de ambas
                                            curvas y hacia dónde diverge la tendencia en el tiempo. */}
                                        {opcionesDesviacionConagua && (
                                            <div className="vaso-desviacion-chart">
                                                <ReactECharts option={opcionesDesviacionConagua} style={{ height: '200px', width: '100%' }} opts={{ renderer: 'svg' }} />
                                            </div>
                                        )}

                                        <div className="vaso-validacion-lista">
                                            {validacionCruzada.filter(v => !v.sinReferencia).map(v => {
                                                const pct = v.pctCoincidencia!;
                                                const desvio = Math.abs(pct - 100);
                                                const color = desvio <= 5 ? '#10b981' : desvio <= 12 ? '#f59e0b' : '#ef4444';
                                                return (
                                                    <div className="vaso-validacion-item" key={v.fecha_escena}>
                                                        <div className="vaso-validacion-fecha">
                                                            {new Date(v.fecha_escena).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' })}
                                                        </div>
                                                        <div className="vaso-validacion-barra">
                                                            <div className="vaso-validacion-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                                                        </div>
                                                        <div className="vaso-validacion-pct" style={{ color }}>{pct.toFixed(0)}%</div>
                                                        <div className="vaso-validacion-detalle">
                                                            {v.areaSatelite.toFixed(1)} km² satélite vs. {v.areaEsperadaKm2!.toFixed(1)} km² esperado
                                                            (lectura de campo {new Date(v.fechaLectura! + 'T12:00:00Z').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' })},
                                                            {' '}{v.diasDiferencia} día{v.diasDiferencia === 1 ? '' : 's'} de diferencia)
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="vaso-prediction" style={{ fontSize: 10, opacity: 0.6, marginTop: 8 }}>
                                            Para cada mes con imagen satelital, se busca la lectura de campo (escala) más cercana en fecha
                                            (máx. {UMBRAL_DIAS_VALIDACION} días de diferencia) y se interpola su área esperada sobre la curva
                                            Elevación-Área-Capacidad oficial de la presa. 100% = coincidencia perfecta; desviaciones grandes
                                            pueden indicar azolve, error de escala o simplemente el desfase de días entre ambas mediciones.
                                        </div>
                                    </div>
                                )}

                                {/* Recalibración Dinámica: factor de corrección por banda de
                                    elevación, calculado por el job mensual recalibra-curva-
                                    batimetrica sobre TODO el histórico disponible (no solo lo
                                    cargado en este modal) — complementa la validación cruzada de
                                    arriba (mes a mes, solo cliente) con un ajuste agregado y
                                    persistido. La curva oficial CONAGUA nunca se modifica; esto
                                    se muestra como sugerencia aparte. */}
                                {resumenRecalibracion && (
                                    <div className="vaso-recalibracion">
                                        <div className="vaso-validacion-titulo">
                                            Recalibración Dinámica <span className="vaso-confiabilidad-badge aproximado">AJUSTE SUGERIDO</span>
                                        </div>
                                        <div className="vaso-recalibracion-resumen">
                                            <div className="vaso-ndwi-col">
                                                <span className="vaso-ndwi-label">Desviación promedio vs. CONAGUA</span>
                                                <span
                                                    className="vaso-ndwi-value"
                                                    style={{ color: Math.abs(resumenRecalibracion.desviacionPonderada) <= 5 ? '#10b981' : Math.abs(resumenRecalibracion.desviacionPonderada) <= 12 ? '#f59e0b' : '#ef4444' }}
                                                >
                                                    {resumenRecalibracion.desviacionPonderada >= 0 ? '+' : ''}{resumenRecalibracion.desviacionPonderada.toFixed(1)}<small>%</small>
                                                </span>
                                            </div>
                                            <div className="vaso-ndwi-col">
                                                <span className="vaso-ndwi-label">Banda con mayor desvío</span>
                                                <span className="vaso-ndwi-value" style={{ fontSize: '1.15rem' }}>
                                                    {resumenRecalibracion.bandaMayorAzolve.banda_elevacion_msnm.toFixed(0)} <small>msnm</small>
                                                </span>
                                                <span className="vaso-ndwi-label" style={{ fontWeight: 500, textTransform: 'none' }}>
                                                    {resumenRecalibracion.bandaMayorAzolve.desviacion_pct_prom >= 0 ? '+' : ''}{resumenRecalibracion.bandaMayorAzolve.desviacion_pct_prom.toFixed(1)}%
                                                    ({resumenRecalibracion.bandaMayorAzolve.n_observaciones} obs.)
                                                </span>
                                            </div>
                                            <div className="vaso-ndwi-col">
                                                <span className="vaso-ndwi-label">Bandas de elevación calibradas</span>
                                                <span className="vaso-ndwi-value" style={{ fontSize: '1.15rem' }}>{resumenRecalibracion.totalBandas}</span>
                                            </div>
                                        </div>
                                        <div className="vaso-prediction" style={{ fontSize: 10, opacity: 0.6, marginTop: 8 }}>
                                            Factor de corrección por banda de 1m de elevación, recalculado mensualmente comparando el área NDWI
                                            real contra el área que la curva oficial CONAGUA predice en cada lectura de campo cercana. Desviación
                                            negativa = el vaso mide menos área real de la esperada a esa elevación (posible azolve acumulado desde
                                            que se levantó la curva oficial); positiva = mide más. Esto NO reemplaza la curva oficial ni el
                                            simulador de nivel — es un ajuste sugerido para priorizar dónde verificar en campo.
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                </div>
            </div>

            {/* Captura del relieve 3D para el informe: se monta oculta apenas
                se pide el informe institucional (preparandoInforme, ANTES de
                abrir el modal — ver abrirInforme) mientras no se tenga ya una
                imagen o se haya confirmado que no hay DEM (imagenRelieveInforme
                sigue en undefined) — no antes, para no pagar el costo de
                Three.js/DEM en cada apertura del modal si el usuario nunca
                pide el informe. capturaListaParaMontar añade un margen corto
                tras preparandoInforme para que, si el visor 3D interactivo
                estaba abierto, su contexto WebGL termine de liberar VRAM
                antes de abrir uno nuevo (ver comentario en su declaración). */}
            {capturaListaParaMontar && imagenRelieveInforme === undefined && masReciente && (
                <Suspense fallback={null}>
                    <VasoVisor3DCaptura
                        contornoGeojson={masReciente.contorno_geojson}
                        nivelMsnm={data.nivel_msnm}
                        presaId={data.presa_id}
                        onCaptura={setImagenRelieveInforme}
                    />
                </Suspense>
            )}

            {mostrarInforme && (
                <InformeVasoInstitucional
                    nombrePresa={data.nombre}
                    historico={historicoVaso}
                    validacionCruzada={validacionCruzada}
                    texturaSatelital={texturaSatelital}
                    imagenRelieve3D={imagenRelieveInforme ?? null}
                    onClose={() => setMostrarInforme(false)}
                />
            )}
        </div>
    );
};

const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');
