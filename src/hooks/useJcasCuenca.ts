import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { cargarContornoCuenca, type ContornoCuenca, type ZonaCuenca } from '../utils/geoCuenca';
import { temporadaFrio } from '../utils/horasFrio';
import { construirRedJcas, diasDeCarga, type FilaClimaPropio, type FilaEstacionJcas, type FilaHorasFrio, type FilaHoyJcas, type FilaLecturaJcas, type FilaLluviaPropia, type ModeloRedJcas } from '../utils/jcasModelo';
import { hoyJcasISO } from '../utils/hoyLocal';

const PAGINA = 1000;
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface RedJcas {
    contorno: ContornoCuenca | null;
    modelo: ModeloRedJcas | null;
    ultSyncEn: string | null;
}

export interface DatosJcas { est: FilaEstacionJcas[]; lec: FilaLecturaJcas[]; ultSyncEn: string | null; contorno: ContornoCuenca | null; hoy: FilaHoyJcas[]; propia: FilaLluviaPropia[]; clima: FilaClimaPropio[]; frio?: FilaHorasFrio[] }

/** Carga las filas de la red JCAS (+ día en curso + estaciones propias). Lanza si falla el catálogo; lo opcional (hoy, propias) degrada a vacío. Lo usan el hook y el Informe Geoclimático. */
/** Sin `diasLecturas` trae lo necesario para todas las ventanas (90 d y el ciclo en curso: diasDeCarga). */
export async function cargarDatosJcas(diasLecturas?: number): Promise<DatosJcas> {
    const hoy = hoyJcasISO(); // día local conservador (UTC-7)
    diasLecturas = diasLecturas ?? diasDeCarga(hoy);
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
    // Temperatura, humedad y viento de las propias (fn_cuenca_clima_propio). Opcional: si la función no existe o falla, esos sensores quedan S/D y la lluvia sigue.
    const clima: FilaClimaPropio[] = [];
    const rClima = await supabase.rpc('fn_cuenca_clima_propio', { p_desde: desde });
    if (!rClima.error) {
        const num = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
        for (const r of (rClima.data ?? []) as Record<string, unknown>[]) {
            clima.push({ estacion_id: String(r.estacion_id), fecha: String(r.fecha), temp_c: num(r.temp_c), hum_pct: num(r.hum_pct), viento_kmh: num(r.viento_kmh) });
        }
    }
    // Extremos y horas frío (fn_cuenca_horas_frio): desde el inicio de la temporada (1-nov) o los últimos 8 días, lo que sea más antiguo. Opcional: sin la función quedan S/D.
    const frio: FilaHorasFrio[] = [];
    const desdeFrio = [temporadaFrio(hoy).inicio, ISO(Date.parse(`${hoy}T00:00:00Z`) - 8 * 86_400_000)].sort()[0];
    // Umbral de hora frío editable (clima_umbrales.horas_frio.aviso); sin él, 7.2 °C (el default de la función).
    const rUmb = await supabase.from('clima_umbrales').select('aviso').eq('clave', 'horas_frio').eq('activo', true).maybeSingle();
    const umbralFrio = rUmb.data?.aviso != null && Number.isFinite(Number(rUmb.data.aviso)) ? Number(rUmb.data.aviso) : null;
    const rFrio = await supabase.rpc('fn_cuenca_horas_frio', umbralFrio == null ? { p_desde: desdeFrio } : { p_desde: desdeFrio, p_umbral: umbralFrio });
    if (!rFrio.error) {
        const num = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
        for (const r of (rFrio.data ?? []) as Record<string, unknown>[]) {
            if (r.fuente !== 'propia' && r.fuente !== 'jcas') continue;
            frio.push({ fuente: r.fuente, estacion_id: String(r.estacion_id), fecha: String(r.fecha), horas_frio: num(r.horas_frio), horas_helada: num(r.horas_helada), horas_con_dato: Number(r.horas_con_dato) || 0, tmax: num(r.tmax), tmin: num(r.tmin) });
        }
    }
    const syncs = (rEst.data ?? []).map((r) => r.ult_sync_en as string | null).filter((x): x is string => !!x).sort();
    return { est, lec, ultSyncEn: syncs.length ? syncs[syncs.length - 1] : null, contorno, hoy: hoyFilas, propia, clima, frio };
}

/**
 * Red de estaciones JCAS/UACJ dentro de la cuenca del Conchos (tablas jcas_*, separadas de WeatherLink). Solo contexto.
 * Si falla la red o el contorno, devuelve error y la vista de la cuenca sigue funcionando sin esta sección.
 */
export function useJcasCuenca(refrescoMs = 30 * 60_000, opciones: { activo?: boolean; dias?: number } = {}) {
    const { activo = true, dias: diasLecturas } = opciones;
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
        const hoy = hoyJcasISO();
        return {
            contorno: datos.contorno, ultSyncEn: datos.ultSyncEn,
            modelo: datos.contorno ? construirRedJcas(datos.est, datos.lec, hoy, datos.contorno.poligonos, datos.hoy, datos.propia, datos.clima, datos.frio ?? []) : null,
        };
    }, [datos]);

    return { red, loading, error, recargar };
}
