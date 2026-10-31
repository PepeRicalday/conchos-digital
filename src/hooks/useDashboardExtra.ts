import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePolling } from './useClimaOperativo';
import { cargarBaseHidro, cargarSeriesHidro, type SeriesPorEstacion } from './useHidroEstaciones';
import { cargarSerieNdviV2 } from '../utils/ndviSerie';
import { resumenPronostico, resumenNdvi, serieHoraria48, type FilaPronostico, type ResumenPronostico, type ResumenNdvi, type PuntoHora } from '../utils/dashboardExtra';
import {
    ORDEN_ESTACIONES, estadoEnlace, ultimoBueno, ultimoPunto, ceroSospechoso, GASTO_UMBRAL_CENSURA_M3S,
    type EstadoEnlace, type EstacionHidro,
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

// ── Pronóstico 48 h ───────────────────────────────────────────────────────────
export function usePronostico48h(activo: boolean): BloqueEstado<ResumenPronostico> & { horas: PuntoHora[] } {
    const [token, recargar] = useToken();
    const [est, setEst] = useState<Omit<BloqueEstado<ResumenPronostico>, 'recargar'>>({ datos: null, cargado: false, error: null });
    const [horas, setHoras] = useState<PuntoHora[]>([]);
    const cargar = useCallback(async () => {
        void token; // un reintento manual cambia `cargar` y vuelve a pedir
        if (!activo) return;
        const desde = new Date().toISOString();
        const hasta = new Date(Date.now() + 48 * 3_600_000).toISOString();
        const { data, error } = await supabase
            .from('clima_pronostico_horario')
            .select('estacion_id, valido_en, precip_mm, precip_prob_pct, temp_c, temp_c_corr, viento_ms, viento_ms_corr, eto_fc_mm')
            .gte('valido_en', desde).lte('valido_en', hasta).order('valido_en', { ascending: true }).limit(2000);
        if (error) { setEst({ datos: null, cargado: true, error: mensajeAmable(error.message) }); return; }
        const filas = ((data ?? []) as unknown as FilaPronostico[]);
        setHoras(serieHoraria48(filas));
        setEst({ datos: filas.length ? resumenPronostico(filas) : null, cargado: true, error: null });
    }, [activo, token]);
    usePolling(cargar, 30 * 60_000);
    return { ...est, horas, recargar };
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
    return { ...est, recargar };
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
}

const BUCKETS = 24;
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
            const series: SeriesPorEstacion = await cargarSeriesHidro(ids, 24, forzar);
            const ahora = Date.now();
            const filas: FilaGoes[] = base.estaciones
                .filter((e: EstacionHidro) => e.activa)
                .sort((a: EstacionHidro, b: EstacionHidro) => ORDEN_ESTACIONES.indexOf(a.id as never) - ORDEN_ESTACIONES.indexOf(b.id as never))
                .map((e: EstacionHidro) => {
                    const enlace = estadoEnlace(ultimoBueno(base.mensajes, e.id), ahora);
                    const g = ultimoPunto(series[e.id]?.gasto_m3s ?? []);
                    const n = ultimoPunto(series[e.id]?.nivel_m ?? []);
                    const umbral = GASTO_UMBRAL_CENSURA_M3S[e.id] ?? null;
                    const vigente = g != null && enlace.clave !== 'sin_transmision' && enlace.clave !== 'sd';
                    // Estación con umbral de censura (Babisas): un valor bajo el umbral es "< umbral", no un caudal nulo.
                    const censurado = vigente && umbral != null && g.v < umbral;
                    const sospechoso = vigente && !censurado && ceroSospechoso(e.id, g.v, n?.v ?? null);
                    return {
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
    return { ...est, recargar };
}

/** Los tres bloques con un solo retardo de arranque. */
export function useDashboardExtra() {
    const listo = useListo(RETARDO_MS);
    const pronostico = usePronostico48h(listo);
    const ndvi = useNdviResumen(listo);
    const goes = useGoesResumen(listo);
    return useMemo(() => ({ pronostico, ndvi, goes }), [pronostico, ndvi, goes]);
}
