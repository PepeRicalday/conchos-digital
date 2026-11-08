import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePolling } from './useClimaOperativo';
import { cargarBaseHidro, cargarSeriesHidro, type SeriesPorEstacion } from './useHidroEstaciones';
import { cargarSerieNdviV2 } from '../utils/ndviSerie';
import { cargarSupVolAnual } from '../utils/supVolAnual';
import type { FilaSupVol } from '../utils/ndviInteranual';
import { resumenPronostico, resumenNdvi, serieHoraria48, demanda24h, type FilaPronostico, type ResumenPronostico, type ResumenNdvi, type PuntoHora, type DemandaRiego24h } from '../utils/dashboardExtra';
import { cargarIndiceHistorico } from './usePresasHistorico';
import type { Indice } from '../utils/historicoPresas';
import {
    ORDEN_ESTACIONES, estadoEnlace, ultimoBueno, ultimoPunto, ceroSospechoso, GASTO_UMBRAL_CENSURA_M3S, estadiaEnlace, ultimoConocido,
    type EstadoEnlace, type EstacionHidro, type EstadiaEnlace,
} from '../utils/hidroEstaciones';

/**
 * Bloques informativos secundarios del Dashboard (pronóstico 48 h, NDVI, GOES).
 * Arrancan con un pequeño retardo para no competir con la carga crítica (presas/canal/alertas) y cada uno falla
 * por separado: un bloque caído muestra su error, nunca derriba el tablero ni se disfraza de "sin dato".
 */
const RETARDO_MS = 1200;

function useListo(ms: number): boolean {
    const [listo, setListo] = useState(false);
    useEffect(() => { const id = window.setTimeout(() => setListo(true), ms); return () => window.clearTimeout(id); }, [ms]);
    return listo;
}

export interface BloqueEstado<T> { datos: T | null; cargado: boolean; error: string | null; recargar: () => void }

/** El usuario no necesita el TypeError del navegador: red caída o respuesta rara del servidor. */
export function mensajeAmable(raw: string): string {
    return /fetch|network|load failed/i.test(raw)
        ? 'Sin conexión con el servidor.'
        : 'El servidor no respondió como se esperaba.';
}

function useToken(): [number, () => void] {
    const [t, setT] = useState(0);
    return [t, useCallback(() => setT((n) => n + 1), [])];
}

// ── Pronóstico 48 h + demanda de las próximas 24 h ──────────────────────────
export function usePronostico48h(activo: boolean, excluidasIds: string[]): BloqueEstado<ResumenPronostico> & { horas: PuntoHora[]; demanda: DemandaRiego24h | null } {
    const [token, recargar] = useToken();
    const [filas, setFilas] = useState<FilaPronostico[] | null>(null);
    const [aCorte, setACorte] = useState(0);
    const [meta, setMeta] = useState<{ cargado: boolean; error: string | null }>({ cargado: false, error: null });
    const [presaIds, setPresaIds] = useState<string[]>([]);
    const cargar = useCallback(async () => {
        void token; // un reintento manual cambia `cargar` y vuelve a pedir
        if (!activo) return;
        // Rol de cada estación: las de presa no cuentan para el viento agrícola (umbral y régimen propios).
        const est = await supabase.from('clima_estaciones').select('id, rol');
        if (!est.error && est.data) setPresaIds((est.data as { id: string; rol: string | null }[]).filter((e) => e.rol === 'presa').map((e) => e.id));
        const desde = new Date().toISOString();
        const hasta = new Date(Date.now() + 48 * 3_600_000).toISOString();
        const { data, error } = await supabase
            .from('clima_pronostico_horario')
            .select('estacion_id, valido_en, corrida_en, precip_mm, precip_prob_pct, temp_c, temp_c_corr, viento_ms, viento_ms_corr, eto_fc_mm, eto_fc_mm_corr, viento_rafaga_ms, viento_rafaga_ms_corr, hum_rel_pct, temp_min_c, nubosidad_total_pct')
            .gte('valido_en', desde).lte('valido_en', hasta).order('valido_en', { ascending: true }).limit(2000);
        if (error) { setMeta({ cargado: true, error: mensajeAmable(error.message) }); return; }
        setFilas((data ?? []) as unknown as FilaPronostico[]);
        setACorte(Date.now());
        setMeta({ cargado: true, error: null });
    }, [activo, token]);
    usePolling(cargar, 30 * 60_000);
    const claveExcl = excluidasIds.join(',');
    return useMemo(() => {
        const horas = filas ? serieHoraria48(filas) : [];
        const demanda = filas && filas.length ? demanda24h(filas, aCorte, claveExcl ? claveExcl.split(',') : [], presaIds) : null;
        return { datos: filas && filas.length ? resumenPronostico(filas) : null, cargado: meta.cargado, error: meta.error, horas, demanda, recargar };
    }, [filas, aCorte, claveExcl, meta, recargar, presaIds]);
}

// ── NDVI ──────────────────────────────────────────────────────────────────────
export function useNdviResumen(activo: boolean): BloqueEstado<ResumenNdvi> {
    const [token, recargar] = useToken();
    const [est, setEst] = useState<Omit<BloqueEstado<ResumenNdvi>, 'recargar'>>({ datos: null, cargado: false, error: null });
    useEffect(() => {
        if (!activo) return;
        let vivo = true;
        void cargarSerieNdviV2(supabase).then(({ filas, error }) => {
            if (!vivo) return;
            setEst(error ? { datos: null, cargado: true, error: mensajeAmable(error) } : { datos: resumenNdvi(filas), cargado: true, error: null });
        });
        return () => { vivo = false; };
    }, [activo, token]);
    return useMemo(() => ({ ...est, recargar }), [est, recargar]);
}

// ── Cultivos del ciclo (ACUM_INF) ─────────────────────────────────────────────
/** Filas de superficie y volumen por cultivo. La carga se comparte (caché de sesión) con Geo-Monitor: no hay consulta extra si ya se abrió. */
export function useCultivosCiclo(activo: boolean): BloqueEstado<FilaSupVol[]> {
    const [token, recargar] = useToken();
    const [est, setEst] = useState<Omit<BloqueEstado<FilaSupVol[]>, 'recargar'>>({ datos: null, cargado: false, error: null });
    useEffect(() => {
        if (!activo) return;
        let vivo = true;
        void cargarSupVolAnual(supabase).then(({ filas, error }) => {
            if (!vivo) return;
            setEst(error ? { datos: null, cargado: true, error: mensajeAmable(error) } : { datos: filas, cargado: true, error: null });
        });
        return () => { vivo = false; };
    }, [activo, token]);
    return useMemo(() => ({ ...est, recargar }), [est, recargar]);
}

// ── GOES (telemetría satelital de 4 estaciones) ───────────────────────────────
export interface FilaGoes {
    id: string; nombre: string; enlace: EstadoEnlace;
    /** m³/s; null = S/D (sin transmisión, sin dato o cero sospechoso). */
    gasto: number | null;
    /** Gasto bajo el umbral de censura de la estación (se muestra "< umbral", no 0). */
    bajoUmbral: number | null;
    nivel: number | null;
    serieGasto: (number | null)[];
    /** Último dato conocido (aunque la estación esté sin señal): se rotula siempre con su hora real. null = nunca hubo dato en 7 d. */
    ultimoDato: UltimoDatoGoes | null;
    estadia: EstadiaEnlace;
}

export interface UltimoDatoGoes {
    /** 'bajo' = gasto censurado (< umbral); 'nivel' cuando no hay gasto utilizable. */
    tipo: 'gasto' | 'nivel' | 'bajo';
    /** m³/s o m según tipo; para 'bajo' es el umbral. */
    valor: number;
    t: number;
    edadMin: number;
}

const BUCKETS = 24;
/** Ventana de series del Dashboard: 7 d para conocer el último dato aun tras un apagón largo; la sparkline usa solo las últimas 24 h. */
const HORAS_SERIES = 168;
function serieHoraria(puntos: { t: number; v: number }[], ahora: number): (number | null)[] {
    const out: (number | null)[] = Array(BUCKETS).fill(null);
    const ult: number[] = Array(BUCKETS).fill(-Infinity);
    for (const p of puntos) {
        const i = BUCKETS - 1 - Math.floor((ahora - p.t) / 3_600_000);
        if (i >= 0 && i < BUCKETS && p.t > ult[i]) { out[i] = p.v; ult[i] = p.t; }
    }
    return out;
}

export function useGoesResumen(activo: boolean): BloqueEstado<FilaGoes[]> {
    const [token, recargar] = useToken();
    const [est, setEst] = useState<Omit<BloqueEstado<FilaGoes[]>, 'recargar'>>({ datos: null, cargado: false, error: null });
    const cargar = useCallback(async () => {
        if (!activo) return;
        try {
            const forzar = token > 0;
            const base = await cargarBaseHidro(forzar);
            const ids = base.estaciones.map((e: EstacionHidro) => e.id);
            const series: SeriesPorEstacion = await cargarSeriesHidro(ids, HORAS_SERIES, forzar);
            const ahora = Date.now();
            const filas: FilaGoes[] = base.estaciones
                .filter((e: EstacionHidro) => e.activa)
                .sort((a: EstacionHidro, b: EstacionHidro) => ORDEN_ESTACIONES.indexOf(a.id as never) - ORDEN_ESTACIONES.indexOf(b.id as never))
                .map((e: EstacionHidro) => {
                    const enlace = estadoEnlace(ultimoBueno(base.mensajes, e.id), ahora, e.id);
                    const g = ultimoPunto(series[e.id]?.gasto_m3s ?? []);
                    const n = ultimoPunto(series[e.id]?.nivel_m ?? []);
                    const umbral = GASTO_UMBRAL_CENSURA_M3S[e.id] ?? null;
                    const vigente = g != null && enlace.clave !== 'sin_transmision' && enlace.clave !== 'sd';
                    // Estación con umbral de censura (Babisas): un valor bajo el umbral es "< umbral", no un caudal nulo.
                    const censurado = vigente && umbral != null && g.v < umbral;
                    const sospechoso = vigente && !censurado && ceroSospechoso(e.id, g.v, n?.v ?? null);
                    // Último dato conocido con sus mismas reglas de veracidad: censura de Babisas y cero sospechoso → nivel; nunca un 0 inventado.
                    const ug = ultimoConocido(series[e.id]?.gasto_m3s ?? [], ahora);
                    const un = ultimoConocido(series[e.id]?.nivel_m ?? [], ahora);
                    const ugCens = ug != null && umbral != null && ug.v < umbral;
                    const ugSosp = ug != null && !ugCens && ceroSospechoso(e.id, ug.v, un?.v ?? null);
                    const ultimoDato: UltimoDatoGoes | null = ug && ugCens ? { tipo: 'bajo', valor: umbral as number, t: ug.t, edadMin: ug.edadMin }
                        : ug && !ugSosp ? { tipo: 'gasto', valor: ug.v, t: ug.t, edadMin: ug.edadMin }
                        : un ? { tipo: 'nivel', valor: un.v, t: un.t, edadMin: un.edadMin } : null;
                    return {
                        ultimoDato,
                        estadia: estadiaEnlace(base.mensajes, e.id, ahora, ahora - HORAS_SERIES * 3_600_000),
                        id: e.id, nombre: e.nombre, enlace,
                        gasto: vigente && !sospechoso && !censurado ? g.v : null,
                        bajoUmbral: censurado ? umbral : null,
                        nivel: enlace.clave !== 'sin_transmision' && n ? n.v : null,
                        serieGasto: serieHoraria(series[e.id]?.gasto_m3s ?? [], ahora),
                    };
                });
            setEst({ datos: filas, cargado: true, error: null });
        } catch (e) {
            setEst({ datos: null, cargado: true, error: mensajeAmable(e instanceof Error ? e.message : '') });
        }
    }, [activo, token]);
    usePolling(cargar, 10 * 60_000);
    return useMemo(() => ({ ...est, recargar }), [est, recargar]);
}

// ── Histórico de presas (diferido; reutiliza la caché compartida de 10 min) ───
export function useHistoricoPresas(activo: boolean): { indice: Indice | null; cargado: boolean; error: string | null } {
    const [est, setEst] = useState<{ indice: Indice | null; cargado: boolean; error: string | null }>({ indice: null, cargado: false, error: null });
    useEffect(() => {
        if (!activo) return;
        let vivo = true;
        cargarIndiceHistorico()
            .then((indice) => { if (vivo) setEst({ indice, cargado: true, error: null }); })
            .catch((e: Error) => { if (vivo) setEst({ indice: null, cargado: true, error: mensajeAmable(e.message) }); });
        return () => { vivo = false; };
    }, [activo]);
    return est;
}

/** Los bloques con un solo retardo de arranque. */
export function useDashboardExtra(excluidasIds: string[] = []) {
    const listo = useListo(RETARDO_MS);
    const pronostico = usePronostico48h(listo, excluidasIds);
    const ndvi = useNdviResumen(listo);
    const cultivos = useCultivosCiclo(listo);
    const goes = useGoesResumen(listo);
    const historico = useHistoricoPresas(listo);
    return useMemo(() => ({ pronostico, ndvi, cultivos, goes, historico }), [pronostico, ndvi, cultivos, goes, historico]);
}
