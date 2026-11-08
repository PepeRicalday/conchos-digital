import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    normalizarEstado, resumenLluvia, restarDias, serieLlenado, ORDEN_PRESAS_CUENCA,
    type EstadoUbicacion, type FilaGrafica, type LecturaDiariaAqwp, type ResumenLluvia,
} from '../utils/aqwpCuenca';

export interface CruceCila { presaId: string; fecha: string; aqwpMm3: number; cilaMm3: number; difPct: number | null }

export interface CuencaConchos {
    estados: EstadoUbicacion[];
    serie: FilaGrafica[];
    cruceCila: CruceCila[];
    /** Lluvia diaria de los pluviómetros GOES (mm). Vacío si el portal aún no trae datos. */
    lluvia: ResumenLluvia;
    /** Última sincronización del portal (aqwp_datasets.ult_sync_en); null si nunca corrió. */
    ultSyncEn: string | null;
}

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const DIAS_GRAFICA = 365;

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Cuenca del Conchos: contexto de las presas CONAGUA de Chihuahua + aforo Ojinaga (portal USIBWC AQUARIUS).
 * Fuente tercera, solo lectura (tablas aqwp_*, cargadas por aqwp-sync). Sin realtime: el portal publica una vez al día.
 */
export function useAqwpCuenca() {
    const [datos, setDatos] = useState<CuencaConchos | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [version, setVersion] = useState(0);

    const recargar = useCallback(() => { setLoading(true); setError(null); setVersion(v => v + 1); }, []);

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

                const estados = (estRes.data ?? []).map(normalizarEstado);
                const datasets = (dsRes.data ?? []) as { id_number: number; ubicacion_id: number }[];
                const idsPresas = new Set<number>(ORDEN_PRESAS_CUENCA);
                const delPresas = datasets.filter(d => idsPresas.has(d.ubicacion_id));
                const ubicacionDeDataset = new Map(delPresas.map(d => [d.id_number, d.ubicacion_id]));
                const namoPorUbicacion = new Map<number, number | null>(estados.map(e => [e.ubicacionId, e.namoMm3]));

                // Fecha de corte: relativa al último dato disponible (no al reloj), para que la gráfica no quede vacía si el portal se atrasa.
                const ultFecha = estados.map(e => e.fecha).filter((f): f is string => !!f).sort().pop();
                const desde = ultFecha ? restarDias(ultFecha, DIAS_GRAFICA) : null;

                const lecturas: LecturaDiariaAqwp[] = [];
                if (desde && delPresas.length) {
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

                // Lluvia: 35 días (30 de la gráfica + margen) de los pluviómetros GOES, ~105 filas: cabe en una página.
                const dsLluvia = (lluviaDsRes.data ?? []) as { id_number: number; ubicacion_id: number }[];
                const ubicacionDeLluvia = new Map(dsLluvia.map(d => [d.id_number, d.ubicacion_id]));
                const lecturasLluvia: LecturaDiariaAqwp[] = [];
                if (dsLluvia.length) {
                    const hoyISO = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10); // UTC-6, como el portal
                    const { data, error: e } = await supabase.from('aqwp_lecturas_diarias')
                        .select('dataset_id, fecha, valor')
                        .in('dataset_id', dsLluvia.map(d => d.id_number)).gte('fecha', restarDias(hoyISO, 35))
                        .order('fecha', { ascending: true }).limit(PAGINA);
                    if (e) throw new Error(e.message);
                    for (const r of data ?? []) lecturasLluvia.push({ datasetId: r.dataset_id, fecha: r.fecha, valor: num(r.valor), estancada: false });
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
                setDatos({
                    estados, serie: serieLlenado(lecturas, ubicacionDeDataset, namoPorUbicacion), cruceCila,
                    lluvia: resumenLluvia(lecturasLluvia, ubicacionDeLluvia),
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
    }, [version]);

    return { datos, loading, error, recargar };
}
