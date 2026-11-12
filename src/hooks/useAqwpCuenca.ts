import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Descarte } from '../utils/aqwpCalidad';
import {
    diaDelAnio, normalizarClimatologia, normalizarClimatologiaHoy,
    type ClimatologiaHoy, type FilaClimatologia,
} from '../utils/aqwpEstadistica';
import { hoyLocalISO } from '../utils/hoyLocal';
import { aplicarSeguimiento, seguimientoDeLecturasPresas } from '../utils/seguimientoPresas';
import {
    limpiarAlmacenamiento, normalizarEstado, resumenLluvia, restarDias, serieLlenado, ORDEN_PRESAS_CUENCA,
    type EstadoUbicacion, type FilaGrafica, type LecturaDiariaAqwp, type ResumenLluvia,
} from '../utils/aqwpCuenca';

export interface CruceCila { presaId: string; fecha: string; aqwpMm3: number; cilaMm3: number; difPct: number | null }

/** Historia del mismo día del año (vista v_aqwp_climatologia, 2017-último año completo, en Mm³). */
export interface Climatologia {
    /** Banda p10/mediana/p90 por día del año (≈ 366 filas por presa) para las mini-series. */
    banda: FilaClimatologia[];
    /** Distribución completa del día de hoy por presa, para el percentil exacto. */
    hoy: ClimatologiaHoy[];
    diaHoy: number;
}

export interface CuencaConchos {
    estados: EstadoUbicacion[];
    serie: FilaGrafica[];
    cruceCila: CruceCila[];
    /** Lluvia diaria de los pluviómetros GOES (mm). Vacío si el portal aún no trae datos. */
    lluvia: ResumenLluvia;
    /** Lluvia diaria cruda de los pluviómetros (ciclo en curso + ciclo anterior) para acumulados por ciclo. valor null = S/D. */
    lluviaSerie: { ubicacionId: number; fecha: string; valor: number | null }[];
    /** Lecturas de almacenamiento excluidas por atípicas, por ubicación (para rotularlas en informes). */
    descartes: Record<number, Descarte[]>;
    /** null = la vista no respondió: la UI rotula "rango de los últimos 12 meses" y no habla de histórico. */
    climatologia: Climatologia | null;
    /** Última sincronización del portal (aqwp_datasets.ult_sync_en); null si nunca corrió. */
    ultSyncEn: string | null;
}

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const DIAS_GRAFICA = 365;

// La climatología cambia una vez al año: se cachea en memoria 12 h (evita 4 consultas por cada apertura de la vista).
const TTL_CLIMATOLOGIA_MS = 12 * 3_600_000;
let cacheClimatologia: { t: number; dia: number; datos: Climatologia } | null = null;

async function cargarClimatologia(diaHoy: number): Promise<Climatologia | null> {
    if (cacheClimatologia && cacheClimatologia.dia === diaHoy && Date.now() - cacheClimatologia.t < TTL_CLIMATOLOGIA_MS) return cacheClimatologia.datos;
    try {
        const banda: FilaClimatologia[] = [];
        for (let from = 0; ; from += PAGINA) {
            const { data, error } = await supabase.from('v_aqwp_climatologia')
                .select('ubicacion_id, dia_anio, n_anios, minimo, p10, p25, mediana, p75, p90, maximo')
                .order('ubicacion_id', { ascending: true }).order('dia_anio', { ascending: true })
                .range(from, from + PAGINA - 1);
            if (error) throw new Error(error.message);
            for (const r of data ?? []) banda.push(normalizarClimatologia(r as Record<string, unknown>));
            if ((data?.length ?? 0) < PAGINA) break;
        }
        const { data: hoyRows, error: eHoy } = await supabase.from('v_aqwp_climatologia')
            .select('ubicacion_id, dia_anio, n_anios, valores').eq('dia_anio', diaHoy);
        if (eHoy) throw new Error(eHoy.message);
        const datos: Climatologia = {
            banda, diaHoy,
            hoy: (hoyRows ?? []).map((r) => normalizarClimatologiaHoy(r as Record<string, unknown>)),
        };
        if (banda.length === 0) return null;
        cacheClimatologia = { t: Date.now(), dia: diaHoy, datos };
        return datos;
    } catch {
        return null; // sin climatología la vista sigue funcionando: se rotula el rango de 12 meses
    }
}

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Cuenca del Conchos: contexto de las presas CONAGUA de Chihuahua + aforo Ojinaga (portal USIBWC AQUARIUS).
 * Fuente tercera, solo lectura (tablas aqwp_*, cargadas por aqwp-sync). Sin realtime: el portal publica una vez al día.
 */
export interface OpcionesCuenca {
    /** false = modo ligero (Dashboard): no baja la serie de 12 meses de llenado, solo estado actual y lluvia. */
    conSerie?: boolean;
    /** Refresco silencioso cada N ms (0 = sin refresco). Se omite con la pestaña oculta. Sin loading ni parpadeo. */
    refrescoMs?: number;
}

export function useAqwpCuenca({ conSerie = true, refrescoMs = 0 }: OpcionesCuenca = {}) {
    const [datos, setDatos] = useState<CuencaConchos | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);

    const recargar = useCallback(() => { setLoading(true); setError(null); setVersion(v => v + 1); }, []);

    // El portal publica una vez al día: un refresco lento basta para una pantalla de sala que queda abierta todo el día.
    useEffect(() => {
        if (!refrescoMs) return;
        const t = setInterval(() => { if (!document.hidden) setVersion(v => v + 1); }, refrescoMs);
        return () => clearInterval(t);
    }, [refrescoMs]);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const [estRes, cilaRes, dsRes, syncRes, lluviaDsRes] = await Promise.all([
                    supabase.from('v_aqwp_presas_estado').select('*'),
                    supabase.from('v_aqwp_vs_cila').select('presa_id, fecha, aqwp_mm3, cila_mm3, dif_pct').order('fecha', { ascending: false }).limit(10),
                    supabase.from('aqwp_datasets').select('id_number, ubicacion_id').eq('magnitud', 'almacenamiento'),
                    supabase.from('aqwp_datasets').select('ult_sync_en').not('ult_sync_en', 'is', null).order('ult_sync_en', { ascending: false }).limit(1),
                    supabase.from('aqwp_datasets').select('id_number, ubicacion_id').eq('magnitud', 'precipitacion_dia'),
                ]);
                const fallo = estRes.error ?? cilaRes.error ?? dsRes.error ?? syncRes.error ?? lluviaDsRes.error;
                if (fallo) throw new Error(fallo.message);

                // La captura manual («Seguimiento de presas») es prioritaria sobre AQUARIUS: si es igual o más reciente, lo sustituye.
                // Si la consulta falla se queda AQUARIUS tal cual (la vista no depende de la captura).
                let estados = (estRes.data ?? []).map(normalizarEstado);
                // UNA SOLA VERDAD: la lectura oficial de SICA (captura de campo o reporte de CILA, en lecturas_presas) alimenta también la cuenca
                // cuando es igual o más reciente que la de AQUARIUS. Va ANTES de la captura de seguimiento, que conserva su prioridad.
                try {
                    const oficial = await supabase.from('lecturas_presas').select('presa_id, fecha, almacenamiento_mm3, extraccion_total_m3s')
                        .gte('fecha', restarDias(hoyLocalISO(), 10)).order('fecha', { ascending: false });
                    if (!oficial.error && oficial.data?.length) estados = aplicarSeguimiento(estados, seguimientoDeLecturasPresas(oficial.data, estados)).estados;
                } catch { /* sin lecturas oficiales: AQUARIUS tal cual */ }
                try {
                    const seg = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { not: (c: string, o: string, v: null) => { gte: (c: string, v: string) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }> } } } })
                        .from('seguimiento_presas').select('aqwp_ubicacion_id, fecha, almacenamiento_mm3, ingreso_m3s, extraccion_m3s')
                        .not('aqwp_ubicacion_id', 'is', null).gte('fecha', restarDias(hoyLocalISO(), 10));
                    if (!seg.error && seg.data?.length) {
                        estados = aplicarSeguimiento(estados, seg.data.map((r) => ({
                            aqwpUbicacionId: Number(r.aqwp_ubicacion_id), fecha: String(r.fecha), almacenamientoMm3: Number(r.almacenamiento_mm3),
                            ingresoM3s: num(r.ingreso_m3s), extraccionM3s: num(r.extraccion_m3s),
                        }))).estados;
                    }
                } catch { /* sin captura: AQUARIUS tal cual */ }
                const datasets = (dsRes.data ?? []) as { id_number: number; ubicacion_id: number }[];
                const idsPresas = new Set<number>(ORDEN_PRESAS_CUENCA);
                const delPresas = datasets.filter(d => idsPresas.has(d.ubicacion_id));
                const ubicacionDeDataset = new Map(delPresas.map(d => [d.id_number, d.ubicacion_id]));
                const namoPorUbicacion = new Map<number, number | null>(estados.map(e => [e.ubicacionId, e.namoMm3]));

                // Fecha de corte: relativa al último dato disponible (no al reloj), para que la gráfica no quede vacía si el portal se atrasa.
                const ultFecha = estados.map(e => e.fecha).filter((f): f is string => !!f).sort().pop();
                const desde = ultFecha ? restarDias(ultFecha, DIAS_GRAFICA) : null;

                const lecturas: LecturaDiariaAqwp[] = [];
                if (conSerie && desde && delPresas.length) {
                    const ids = delPresas.map(d => d.id_number);
                    for (let from = 0; ; from += PAGINA) {
                        const { data, error: e } = await supabase.from('aqwp_lecturas_diarias')
                            .select('dataset_id, fecha, valor, estancada')
                            .in('dataset_id', ids).gte('fecha', desde)
                            .order('fecha', { ascending: true }).order('dataset_id', { ascending: true })
                            .range(from, from + PAGINA - 1);
                        if (e) throw new Error(e.message);
                        for (const r of data ?? []) lecturas.push({ datasetId: r.dataset_id, fecha: r.fecha, valor: num(r.valor), estancada: r.estancada === true });
                        if ((data?.length ?? 0) < PAGINA) break;
                    }
                }

                // Lluvia: ~400 días (ciclo en curso + ciclo anterior para compararlos) de 3 pluviómetros ≈ 1,200 filas: 2 páginas.
                const dsLluvia = (lluviaDsRes.data ?? []) as { id_number: number; ubicacion_id: number }[];
                const ubicacionDeLluvia = new Map(dsLluvia.map(d => [d.id_number, d.ubicacion_id]));
                const lecturasLluvia: LecturaDiariaAqwp[] = [];
                if (dsLluvia.length) {
                    const hoyISO = hoyLocalISO();
                    const idsLluvia = dsLluvia.map(d => d.id_number);
                    for (let from = 0; ; from += PAGINA) {
                        const { data, error: e } = await supabase.from('aqwp_lecturas_diarias')
                            .select('dataset_id, fecha, valor')
                            .in('dataset_id', idsLluvia).gte('fecha', restarDias(hoyISO, conSerie ? 400 : 35))
                            .order('fecha', { ascending: true }).order('dataset_id', { ascending: true })
                            .range(from, from + PAGINA - 1);
                        if (e) throw new Error(e.message);
                        for (const r of data ?? []) lecturasLluvia.push({ datasetId: r.dataset_id, fecha: r.fecha, valor: num(r.valor), estancada: false });
                        if ((data?.length ?? 0) < PAGINA) break;
                    }
                }

                // El cruce se queda con el último día comparable por presa.
                const vistos = new Set<string>();
                const cruceCila: CruceCila[] = [];
                for (const c of cilaRes.data ?? []) {
                    if (vistos.has(c.presa_id)) continue;
                    vistos.add(c.presa_id);
                    cruceCila.push({ presaId: c.presa_id, fecha: c.fecha, aqwpMm3: Number(c.aqwp_mm3), cilaMm3: Number(c.cila_mm3), difPct: num(c.dif_pct) });
                }

                if (!vivo) return;
                const limpio = limpiarAlmacenamiento(lecturas, ubicacionDeDataset, namoPorUbicacion);
                const climatologia = conSerie && ultFecha ? await cargarClimatologia(diaDelAnio(ultFecha)) : null;
                setDatos({
                    estados, serie: serieLlenado(limpio.lecturas, ubicacionDeDataset, namoPorUbicacion), cruceCila, descartes: limpio.descartes, climatologia,
                    lluvia: resumenLluvia(lecturasLluvia, ubicacionDeLluvia),
                    lluviaSerie: lecturasLluvia.flatMap(l => { const u = ubicacionDeLluvia.get(l.datasetId); return u == null ? [] : [{ ubicacionId: u, fecha: l.fecha, valor: l.valor }]; }),
                    ultSyncEn: (syncRes.data?.[0] as { ult_sync_en?: string } | undefined)?.ult_sync_en ?? null,
                });
                setError(null);
            } catch (e) {
                if (vivo) setError((e as Error).message || 'Error desconocido');
            } finally {
                if (vivo) setLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [version, conSerie]);

    return { datos, loading, error, recargar };
}
