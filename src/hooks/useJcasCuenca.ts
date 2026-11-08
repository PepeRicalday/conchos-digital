import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cargarContornoCuenca, type ContornoCuenca, type ZonaCuenca } from '../utils/geoCuenca';
import { construirRedJcas, type FilaEstacionJcas, type FilaHoyJcas, type FilaLecturaJcas, type FilaLluviaPropia, type ModeloRedJcas } from '../utils/jcasModelo';

const PAGINA = 1000;
const DIAS = 36; // 30 días de acumulado + margen para el corte (ayer) y estaciones atrasadas
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface RedJcas {
    contorno: ContornoCuenca | null;
    modelo: ModeloRedJcas | null;
    ultSyncEn: string | null;
}

export interface DatosJcas { est: FilaEstacionJcas[]; lec: FilaLecturaJcas[]; ultSyncEn: string | null; contorno: ContornoCuenca | null; hoy: FilaHoyJcas[]; propia: FilaLluviaPropia[] }

/** Carga las filas de la red JCAS (+ día en curso + estaciones propias). Lanza si falla el catálogo; lo opcional (hoy, propias) degrada a vacío. Lo usan el hook y el Informe Geoclimático. */
export async function cargarDatosJcas(diasLecturas = DIAS): Promise<DatosJcas> {
    const hoy = ISO(Date.now() - 7 * 3_600_000); // día local conservador (UTC-7)
    const desde = ISO(Date.parse(`${hoy}T00:00:00Z`) - diasLecturas * 86_400_000);
    const [contorno, rEst] = await Promise.all([
        cargarContornoCuenca(),
        supabase.from('jcas_estaciones')
            .select('id_jcas, nombre, latitud, longitud, altitud_m, zona, grupo_ciudad, tiene_pluviometro, activa, ult_fecha, ult_sync_en, elevacion_dem_m')
            .in('zona', ['cuenca', 'salida']).eq('sincronizar', true).order('id_jcas'),
    ]);
    if (rEst.error) throw new Error(rEst.error.message);
    const est: FilaEstacionJcas[] = (rEst.data ?? []).map((r) => ({
        id_jcas: Number(r.id_jcas), nombre: String(r.nombre), latitud: Number(r.latitud), longitud: Number(r.longitud),
        altitud_m: r.altitud_m == null ? null : Number(r.altitud_m), zona: r.zona as ZonaCuenca, grupo_ciudad: (r.grupo_ciudad as string | null) ?? null,
        tiene_pluviometro: !!r.tiene_pluviometro, activa: !!r.activa, ult_fecha: (r.ult_fecha as string | null) ?? null,
        elevacion_dem_m: r.elevacion_dem_m == null ? null : Number(r.elevacion_dem_m),
    }));
    const ids = est.map((e) => e.id_jcas);
    const lec: FilaLecturaJcas[] = [];
    for (let from = 0; ids.length; from += PAGINA) {
        const { data, error: e2 } = await supabase.from('jcas_lecturas_diarias')
            .select('estacion_id, fecha, lluvia_mm, temp_c, hum_pct, viento_kmh').in('estacion_id', ids).gte('fecha', desde)
            .order('estacion_id').order('fecha').range(from, from + PAGINA - 1);
        if (e2) throw new Error(e2.message);
        for (const r of data ?? []) lec.push({ estacion_id: Number(r.estacion_id), fecha: String(r.fecha), lluvia_mm: r.lluvia_mm == null ? null : Number(r.lluvia_mm), temp_c: r.temp_c == null ? null : Number(r.temp_c), hum_pct: r.hum_pct == null ? null : Number(r.hum_pct), viento_kmh: r.viento_kmh == null ? null : Number(r.viento_kmh) });
        if ((data?.length ?? 0) < PAGINA) break;
    }
    // Día en curso (parcial): tabla aparte; si falla, la red sigue funcionando con días completos (hoy = S/D).
    const hoyFilas: FilaHoyJcas[] = [];
    const rHoy = await supabase.from('jcas_lecturas_hoy').select('estacion_id, fecha, lluvia_mm, temp_c, hum_pct, viento_kmh, actualizado_en').in('estacion_id', ids);
    if (!rHoy.error) {
        const num = (x: unknown) => (x == null ? null : Number(x));
        for (const r of rHoy.data ?? []) hoyFilas.push({ estacion_id: Number(r.estacion_id), fecha: String(r.fecha), lluvia_mm: num(r.lluvia_mm), temp_c: num(r.temp_c), hum_pct: num(r.hum_pct), viento_kmh: num(r.viento_kmh), actualizado_en: String(r.actualizado_en) });
    }
    // Estaciones propias (WeatherLink): su lluvia suma a la observada; si falla, la red JCAS sigue sola.
    const propia: FilaLluviaPropia[] = [];
    const rProp = await supabase.rpc('fn_cuenca_lluvia_propia', { p_desde: desde });
    if (!rProp.error) {
        for (const r of (rProp.data ?? []) as Record<string, unknown>[]) {
            const mm = r.lluvia_mm == null ? null : Number(r.lluvia_mm), la = Number(r.latitud), lo = Number(r.longitud);
            if (mm != null && Number.isFinite(mm) && Number.isFinite(la) && Number.isFinite(lo)) propia.push({ estacion_id: String(r.estacion_id), nombre: String(r.nombre), latitud: la, longitud: lo, fecha: String(r.fecha), lluvia_mm: mm, ult_lectura: String(r.ult_lectura) });
        }
    }
    const syncs = (rEst.data ?? []).map((r) => r.ult_sync_en as string | null).filter((x): x is string => !!x).sort();
    return { est, lec, ultSyncEn: syncs.length ? syncs[syncs.length - 1] : null, contorno, hoy: hoyFilas, propia };
}

/**
 * Red de estaciones JCAS/UACJ dentro de la cuenca del Conchos (tablas jcas_*, separadas de WeatherLink). Solo contexto.
 * Si falla la red o el contorno, devuelve error y la vista de la cuenca sigue funcionando sin esta sección.
 */
export function useJcasCuenca(refrescoMs = 30 * 60_000, opciones: { activo?: boolean; dias?: number } = {}) {
    const { activo = true, dias: diasLecturas = DIAS } = opciones;
    const [datos, setDatos] = useState<DatosJcas | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const recargar = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (!activo) return undefined;
        let vivo = true;
        (async () => {
            try {
                const d = await cargarDatosJcas(diasLecturas);
                if (vivo) { setDatos(d); setError(null); }
            } catch (e) {
                if (vivo) setError((e as Error).message || 'No se pudo cargar la red JCAS');
            } finally {
                if (vivo) setLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [tick, activo, diasLecturas]);

    useEffect(() => {
        if (!activo) return undefined;
        const t = window.setInterval(recargar, refrescoMs);
        return () => window.clearInterval(t);
    }, [recargar, refrescoMs, activo]);

    const red: RedJcas | null = useMemo(() => {
        if (!datos) return null;
        const hoy = ISO(Date.now() - 7 * 3_600_000);
        return {
            contorno: datos.contorno, ultSyncEn: datos.ultSyncEn,
            modelo: datos.contorno ? construirRedJcas(datos.est, datos.lec, hoy, datos.contorno.poligonos, datos.hoy, datos.propia) : null,
        };
    }, [datos]);

    return { red, loading, error, recargar };
}
