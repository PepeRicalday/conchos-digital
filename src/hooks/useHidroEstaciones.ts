import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
    ORDEN_ESTACIONES, VENTANAS, radiacionConfiable, tieneMeteo,
    type EstacionHidro, type MensajeHidro, type PuntoHidro, type VariableHidro, type VentanaHidro,
} from '../utils/hidroEstaciones';

/**
 * Estaciones hidrométricas GOES (hidro_estaciones / hidro_lecturas / hidro_mensajes).
 * Lecturas cada 15-20 min: nunca se baja todo. Se pide por estación + variable + ventana, con paginación de 1000 filas
 * (tope de PostgREST) y caché con TTL en memoria (patrón de usePresasHistorico). Las deps de los efectos son solo
 * ventana / selección / token de recarga: nada que cambie cada segundo (sin refetch storm).
 */

const PAGINA = 1000;
const TTL_MS = 5 * 60 * 1000;
const HORAS_MENSAJES = 48;

type Serie = PuntoHidro[];
export type SeriesEstacion = Partial<Record<VariableHidro, Serie>>;
export type SeriesPorEstacion = Record<string, SeriesEstacion>;

// Las tablas hidro_* aún no están en los tipos generados de Supabase.
interface ConsultaLibre extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
    select: (c: string) => ConsultaLibre;
    eq: (c: string, v: string) => ConsultaLibre;
    in: (c: string, v: string[]) => ConsultaLibre;
    gte: (c: string, v: string) => ConsultaLibre;
    order: (c: string, o: { ascending: boolean }) => ConsultaLibre;
    range: (a: number, b: number) => ConsultaLibre;
}
const sb = () => supabase as unknown as { from: (t: string) => ConsultaLibre };

const cacheSeries = new Map<string, { p: Promise<Serie>; ts: number }>();
let cacheBase: { p: Promise<{ estaciones: EstacionHidro[]; mensajes: MensajeHidro[] }>; ts: number } | null = null;

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

async function descargarSerie(estacion: string, variable: VariableHidro, horas: number): Promise<Serie> {
    const desde = new Date(Date.now() - horas * 3600000).toISOString();
    const puntos: Serie = [];
    for (let ini = 0; ; ini += PAGINA) {
        const { data, error } = await sb().from('hidro_lecturas').select('ts_utc,valor')
            .eq('estacion_id', estacion).eq('variable', variable).gte('ts_utc', desde)
            .order('ts_utc', { ascending: true }).range(ini, ini + PAGINA - 1);
        if (error) throw new Error(error.message);
        const filas = (data ?? []) as { ts_utc: string; valor: unknown }[];
        for (const f of filas) {
            const v = num(f.valor);
            const t = Date.parse(f.ts_utc);
            if (v != null && Number.isFinite(t)) puntos.push({ t, v });
        }
        if (filas.length < PAGINA) break;
    }
    return puntos;
}

function serie(estacion: string, variable: VariableHidro, horas: number, forzar: boolean): Promise<Serie> {
    const k = `${estacion}|${variable}|${horas}`;
    const c = cacheSeries.get(k);
    if (!forzar && c && Date.now() - c.ts < TTL_MS) return c.p;
    const p = descargarSerie(estacion, variable, horas);
    cacheSeries.set(k, { p, ts: Date.now() });
    p.catch(() => { if (cacheSeries.get(k)?.p === p) cacheSeries.delete(k); }); // un fallo no se queda en caché
    return p;
}

async function descargarBase() {
    const desdeMsg = new Date(Date.now() - HORAS_MENSAJES * 3600000).toISOString();
    const [est, msg] = await Promise.all([
        sb().from('hidro_estaciones').select('id,nombre,presa_id,rol,latitud,longitud,intervalo_min,activa,ult_sync_en,ult_dato_en'),
        sb().from('hidro_mensajes').select('estacion_id,ts_msg,codigo_falla,senal_dbm').in('estacion_id', [...ORDEN_ESTACIONES])
            .gte('ts_msg', desdeMsg).order('ts_msg', { ascending: false }).range(0, 999),
    ]);
    if (est.error) throw new Error(est.error.message);
    if (msg.error) throw new Error(msg.error.message);
    const estaciones = ((est.data ?? []) as Record<string, unknown>[]).map(e => ({
        id: String(e.id), nombre: String(e.nombre), presa_id: (e.presa_id as string | null) ?? null, rol: (e.rol as string | null) ?? null,
        latitud: num(e.latitud), longitud: num(e.longitud), intervalo_min: num(e.intervalo_min),
        activa: e.activa !== false, ult_sync_en: (e.ult_sync_en as string | null) ?? null, ult_dato_en: (e.ult_dato_en as string | null) ?? null,
    } satisfies EstacionHidro)).sort((a, b) => ORDEN_ESTACIONES.indexOf(a.id as never) - ORDEN_ESTACIONES.indexOf(b.id as never));
    const mensajes = ((msg.data ?? []) as Record<string, unknown>[]).map(m => ({
        estacion_id: String(m.estacion_id), ts_msg: String(m.ts_msg), codigo_falla: (m.codigo_falla as string | null) ?? null, senal_dbm: num(m.senal_dbm),
    } satisfies MensajeHidro));
    return { estaciones, mensajes };
}

function base(forzar: boolean) {
    if (!forzar && cacheBase && Date.now() - cacheBase.ts < TTL_MS) return cacheBase.p;
    const p = descargarBase();
    cacheBase = { p, ts: Date.now() };
    p.catch(() => { if (cacheBase?.p === p) cacheBase = null; });
    return p;
}

async function cargarSeries(ids: string[], vars: (e: string) => VariableHidro[], horas: number, forzar: boolean): Promise<SeriesPorEstacion> {
    const salida: SeriesPorEstacion = {};
    await Promise.all(ids.map(async id => {
        const entradas = await Promise.all(vars(id).map(async v => [v, await serie(id, v, horas, forzar)] as const));
        salida[id] = Object.fromEntries(entradas);
    }));
    return salida;
}

const VARS_HIDRO = (id: string): VariableHidro[] => (id === 'C6300760' ? ['nivel_m', 'gasto_m3s', 'velocidad_ms'] : ['nivel_m', 'gasto_m3s']);
const VARS_METEO = (id: string): VariableHidro[] => (tieneMeteo(id)
    ? ['temp_c', 'viento_ms', 'viento_dir_deg', 'hr_pct', 'presion_hpa', ...(radiacionConfiable(id) ? ['rad_wm2' as const] : [])]
    : []);

interface Opciones { ventana: VentanaHidro; seleccion: string[]; meteo: boolean }

// El usuario no necesita el TypeError del navegador: red caída o respuesta rara de Supabase.
function mensajeError(e: Error): string {
    return /fetch|network|load failed/i.test(e.message)
        ? 'Sin conexión con el servidor. Revise la red e intente de nuevo.'
        : 'El servidor no respondió como se esperaba. Intente de nuevo en un momento.';
}


/** Cada cuánto se refresca sola la pantalla abierta (el cron ingiere cada hora): sin esto, tras 3 h declararía "Sin transmisión" en falso. */
const REFRESCO_MS = 10 * 60 * 1000;

/** Incrementa `setToken` cada REFRESCO_MS mientras la pestaña esté visible y al volver a verla si pasó ese tiempo. */
function useAutoRefresco(setToken: (f: (t: number) => number) => void) {
    useEffect(() => {
        let ultimo = Date.now();
        const refresca = () => { ultimo = Date.now(); setToken(t => t + 1); };
        const id = window.setInterval(() => { if (!document.hidden) refresca(); }, REFRESCO_MS);
        const alVolver = () => { if (!document.hidden && Date.now() - ultimo >= REFRESCO_MS) refresca(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
    }, [setToken]);
}

interface Cargado<T> { clave: string; datos: T | null; error: string | null }

export function useHidroEstaciones({ ventana, seleccion, meteo }: Opciones) {
    const [token, setToken] = useState(0);
    useAutoRefresco(setToken);
    const [raiz, setRaiz] = useState<Cargado<{ estaciones: EstacionHidro[]; mensajes: MensajeHidro[]; series24: SeriesPorEstacion; en: number }> | null>(null);
    const [grafica, setGrafica] = useState<Cargado<SeriesPorEstacion> | null>(null);
    const [clima, setClima] = useState<Cargado<SeriesPorEstacion> | null>(null);

    const claveRaiz = `r${token}`;
    const claveGrafica = `${ventana}|${[...seleccion].sort().join(',')}|${token}`;
    const claveClima = `${meteo}|${token}`;
    const forzar = token > 0;

    // Resumen: estaciones, salud del enlace y 24 h de nivel/gasto para tarjetas.
    useEffect(() => {
        let vivo = true;
        base(forzar)
            .then(async b => {
                const series24 = await cargarSeries(b.estaciones.map(e => e.id), VARS_HIDRO, 24, forzar);
                if (vivo) setRaiz({ clave: claveRaiz, datos: { ...b, series24, en: Date.now() }, error: null });
            })
            .catch((e: Error) => { if (vivo) setRaiz({ clave: claveRaiz, datos: null, error: mensajeError(e) }); });
        return () => { vivo = false; };
    }, [claveRaiz, forzar]);

    // Gráfica principal: solo las estaciones elegidas y la ventana elegida.
    useEffect(() => {
        let vivo = true;
        cargarSeries(seleccion, VARS_HIDRO, VENTANAS[ventana].horas, forzar)
            .then(d => { if (vivo) setGrafica({ clave: claveGrafica, datos: d, error: null }); })
            .catch((e: Error) => { if (vivo) setGrafica({ clave: claveGrafica, datos: null, error: mensajeError(e) }); });
        return () => { vivo = false; };
        // `seleccion` se resume en claveGrafica (evita nuevas referencias de array como dependencia).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claveGrafica, forzar]);

    // Meteorología: solo cuando el panel está abierto; 24 h.
    useEffect(() => {
        if (!meteo) return;
        let vivo = true;
        cargarSeries(ORDEN_ESTACIONES.filter(tieneMeteo), VARS_METEO, 24, forzar)
            .then(d => { if (vivo) setClima({ clave: claveClima, datos: d, error: null }); })
            .catch((e: Error) => { if (vivo) setClima({ clave: claveClima, datos: null, error: mensajeError(e) }); });
        return () => { vivo = false; };
    }, [claveClima, meteo, forzar]);

    const recargar = useCallback(() => setToken(t => t + 1), []);

    const raizOk = raiz && raiz.clave === claveRaiz ? raiz : null;
    const graficaOk = grafica && grafica.clave === claveGrafica ? grafica : null;
    const climaOk = clima && clima.clave === claveClima ? clima : null;

    return useMemo(() => ({
        loading: !raizOk,
        error: raizOk?.error ?? (raiz?.error ?? null),
        estaciones: raizOk?.datos?.estaciones ?? raiz?.datos?.estaciones ?? [],
        mensajes: raizOk?.datos?.mensajes ?? raiz?.datos?.mensajes ?? [],
        series24: raizOk?.datos?.series24 ?? raiz?.datos?.series24 ?? {},
        actualizadoEn: raizOk?.datos?.en ?? raiz?.datos?.en ?? null,
        serieVentana: graficaOk?.datos ?? null,
        cargandoGrafica: !graficaOk,
        errorGrafica: graficaOk?.error ?? null,
        clima: climaOk?.datos ?? null,
        cargandoClima: meteo && !climaOk,
        errorClima: climaOk?.error ?? null,
        recargar,
    }), [raizOk, raiz, graficaOk, climaOk, meteo, recargar]);
}

// ── API para estadística e informes ─────────────────────────────────────────────

/** Nivel, gasto (y velocidad en Ojinaga) de las estaciones pedidas, con caché de 5 min. `horas` puede ser cualquier ventana (hasta ~30 d). */
export function cargarSeriesHidro(ids: string[], horas: number, forzar = false): Promise<SeriesPorEstacion> {
    return cargarSeries(ids, VARS_HIDRO, horas, forzar);
}

/** Meteorología de las estaciones que la tienen (sin radiación donde no es confiable). */
export function cargarSeriesMeteoHidro(ids: string[], horas: number, forzar = false): Promise<SeriesPorEstacion> {
    return cargarSeries(ids.filter(tieneMeteo), VARS_METEO, horas, forzar);
}

/** Estaciones y mensajes de las últimas 48 h (salud del enlace). */
export function cargarBaseHidro(forzar = false) {
    return base(forzar);
}

/** Horas de serie que necesita la estadística de una ventana: la propia más 8 días de base para la variación a 7 d. */
export function horasEstadistica(ventana: VentanaHidro): number {
    return Math.max(VENTANAS[ventana].horas, 8 * 24);
}

/**
 * Series para la estadística de TODAS las estaciones en la ventana global (fichas, tabla de resumen, volumen).
 * Las deps son ventana + token: sin refetch storm. Con 7 d / 30 d baja varias páginas por serie la primera vez; luego caché.
 */
export function useHidroEstadistica(ventana: VentanaHidro, ids: string[]) {
    const [token, setToken] = useState(0);
    useAutoRefresco(setToken);
    const [estado, setEstado] = useState<{ clave: string; datos: SeriesPorEstacion | null; error: string | null } | null>(null);
    const clave = `${ventana}|${ids.join(',')}|${token}`;
    useEffect(() => {
        if (!ids.length) return;
        let vivo = true;
        cargarSeries(ids, VARS_HIDRO, horasEstadistica(ventana), token > 0)
            .then(d => { if (vivo) setEstado({ clave, datos: d, error: null }); })
            .catch((e: Error) => { if (vivo) setEstado({ clave, datos: null, error: mensajeError(e) }); });
        return () => { vivo = false; };
        // `ids` se resume en `clave`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave]);
    const ok = estado && estado.clave === clave ? estado : null;
    const recargar = useCallback(() => setToken(t => t + 1), []);
    return { series: ok?.datos ?? estado?.datos ?? null, cargando: !ok && ids.length > 0, error: ok?.error ?? null, recargar };
}
