import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { diasDeCarga } from '../utils/jcasModelo';
import { hoyLocalISO } from '../utils/hoyLocal';
import { construirRedUnifrut, type FilaEstacionUnifrut, type FilaLecturaUnifrut, type ModeloUnifrut } from '../utils/unifrutModelo';

const PAGINA = 1000;
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const num = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));

export interface DatosUnifrut { est: FilaEstacionUnifrut[]; lec: FilaLecturaUnifrut[]; ultSyncEn: string | null }

/** Carga las 29 estaciones de la REM de Unifrut y sus lecturas diarias completas (tablas unifrut_*, separadas de WeatherLink y JCAS). Lanza si falla el catálogo. */
export async function cargarDatosUnifrut(diasLecturas?: number): Promise<DatosUnifrut> {
    const hoy = hoyLocalISO();
    const dias = diasLecturas ?? diasDeCarga(hoy);
    const desde = ISO(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000);
    const rEst = await supabase.from('unifrut_estaciones')
        .select('id_unifrut, nombre, municipio, tipo, latitud, longitud, altitud_m, zona, dist_limite_km, ult_fecha, ult_sync_en').order('id_unifrut');
    if (rEst.error) throw new Error(rEst.error.message);
    const est: FilaEstacionUnifrut[] = (rEst.data ?? []).map((r) => ({
        id_unifrut: String(r.id_unifrut), nombre: String(r.nombre), municipio: String(r.municipio), tipo: r.tipo === 'ADCON' ? 'ADCON' : 'CAMB',
        latitud: Number(r.latitud), longitud: Number(r.longitud), altitud_m: num(r.altitud_m), zona: r.zona as FilaEstacionUnifrut['zona'],
        dist_limite_km: num(r.dist_limite_km), ult_fecha: (r.ult_fecha as string | null) ?? null,
    }));
    // Solo se piden lecturas de estaciones con dato dentro de la carga: las apagadas desde hace meses no aportan a ninguna ventana.
    const ids = est.filter((e) => e.ult_fecha != null && e.ult_fecha >= desde).map((e) => e.id_unifrut);
    const lec: FilaLecturaUnifrut[] = [];
    for (let from = 0; ids.length; from += PAGINA) {
        const { data, error } = await supabase.from('unifrut_lecturas_diarias')
            .select('estacion_id, fecha, lluvia_mm, tmax_c, tmin_c, tmed_c, viento_kmh, viento_max_kmh, eto_mm').in('estacion_id', ids).gte('fecha', desde)
            .order('estacion_id').order('fecha').range(from, from + PAGINA - 1);
        if (error) throw new Error(error.message);
        for (const r of data ?? []) {
            lec.push({
                estacion_id: String(r.estacion_id), fecha: String(r.fecha), lluvia_mm: num(r.lluvia_mm), tmax_c: num(r.tmax_c), tmin_c: num(r.tmin_c),
                tmed_c: num(r.tmed_c), viento_kmh: num(r.viento_kmh), viento_max_kmh: num(r.viento_max_kmh), eto_mm: num(r.eto_mm),
            });
        }
        if ((data?.length ?? 0) < PAGINA) break;
    }
    const syncs = (rEst.data ?? []).map((r) => r.ult_sync_en as string | null).filter((x): x is string => !!x).sort();
    return { est, lec, ultSyncEn: syncs.length ? syncs[syncs.length - 1] : null };
}

/**
 * Red regional UNIFRUT (contexto, fuera del contorno de la cuenca). Si falla, la vista de la cuenca sigue sin esta sección
 * (nunca bloquea JCAS ni las estaciones propias).
 */
export function useUnifrutCuenca(refrescoMs = 60 * 60_000, opciones: { activo?: boolean; dias?: number } = {}) {
    const { activo = true, dias } = opciones;
    const [datos, setDatos] = useState<DatosUnifrut | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const recargar = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (!activo) return undefined;
        let vivo = true;
        (async () => {
            try {
                const d = await cargarDatosUnifrut(dias);
                if (vivo) { setDatos(d); setError(null); }
            } catch (e) {
                if (vivo) setError((e as Error).message || 'No se pudo cargar la red Unifrut');
            } finally {
                if (vivo) setLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [tick, activo, dias]);

    useEffect(() => {
        if (!activo) return undefined;
        const t = window.setInterval(recargar, refrescoMs);
        return () => window.clearInterval(t);
    }, [recargar, refrescoMs, activo]);

    const modelo: ModeloUnifrut | null = useMemo(() => (datos ? construirRedUnifrut(datos.est, datos.lec, hoyLocalISO()) : null), [datos]);
    return { modelo, ultSyncEn: datos?.ultSyncEn ?? null, loading, error, recargar };
}
