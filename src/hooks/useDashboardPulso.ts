import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTableCoalesced } from '../lib/realtimeHub';
import { ensureMetadata } from '../store/useMetadataStore';
import { usePolling, useSaludRed } from './useClimaOperativo';
import { modeloPerfilCanal, type EscalaCanalKpi, type ExtremoCanalKpi } from '../utils/perfilCanal';
import type { EscalaMeta, LecturaEscala } from '../utils/controlEscalasZonas';

// ── Canal: gasto en los extremos K-0+000 y K-104 ────────────────────────────
export interface ExtremoCanal {
    km: number;
    nombre: string;
    gasto: number | null;
    /** Lectura dentro de la ventana de frescura (240 min); sin ella el gasto no entra al balance. */
    fresca: boolean;
    /** Marca de la última telemetría (ms). */
    telemetriaMs: number | null;
}

/**
 * Gasto de entrada (K-0) y salida (K-104) del canal. Vista del MISMO modelo que la tarjeta Canal del Dashboard
 * (`useCanalPerfil` → `utils/perfilCanal`): solo cuenta la medición de campo (confirmada), con la edad medida por
 * fecha + hora_lectura (UTC−6) y no por `creado_en`. Antes tomaba la fila de arrastre de continuidad como "última lectura"
 * y por eso siempre salía vieja. La eficiencia sale de utils/conduccion.ts: una sola fórmula. Interfaz sin cambios para
 * Clima, Hidrometría, Distribución y Balance (useEficienciaCanal).
 */
export function useCanalExtremos() {
    const p = useCanalPerfil(false);
    return useMemo(() => {
        const m = p.modelo;
        const a = (e: EscalaCanalKpi | undefined, x: ExtremoCanalKpi): ExtremoCanal | null =>
            e ? { km: e.km, nombre: e.nombre, gasto: x.gasto, fresca: x.vigente, telemetriaMs: x.medicionMs } : null;
        return {
            k0: a(m.escalas.find((e) => Math.abs(e.km) < 0.01), m.k0),
            k104: a(m.escalas.find((e) => Math.abs(e.km - 104) < 0.5), m.k104),
            conduccion: m.conduccion, error: p.error, cargado: p.cargado, recargar: p.recargar,
        };
    }, [p]);
}

// ── Clima: resumen ligero de la red (sin cargar todo el módulo de Clima) ────
export interface ClimaPulso {
    estacionesValidas: number;
    estacionesTotal: number;
    excluidas: string[];
    /** Ids de las estaciones excluidas (sospechosas o sin señal): el pronóstico las descarta con la misma regla. */
    excluidasIds: string[];
    tempMax: number | null;
    tempMin: number | null;
    /** Promedio de temperatura observada entre estaciones válidas; null = S/D. */
    tempProm: number | null;
    vientoMax: number | null;
    lluviaProm: number | null;
    etoProm: number | null;
    /** Observación más reciente entre las estaciones válidas (ISO); null = S/D. */
    ultimaObs: string | null;
}

interface FilaActual {
    estacion_id: string; nombre: string; obs_ts: string | null; temp_obs_c: number | string | null; viento_obs_ms: number | string | null;
    lluvia_obs_mm: number | string | null; eto_obs_mm: number | string | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function useClimaPulso() {
    const salud = useSaludRed();
    const [filas, setFilas] = useState<FilaActual[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        const { data, error: e } = await supabase
            .from('v_clima_estacion_actual')
            .select('estacion_id, nombre, obs_ts, temp_obs_c, viento_obs_ms, lluvia_obs_mm, eto_obs_mm');
        if (e) { setError(e.message); setCargado(true); return; }
        setError(null);
        setFilas((data ?? []) as FilaActual[]);
        setCargado(true);
    }, []);
    usePolling(cargar, 10 * 60_000);

    const pulso: ClimaPulso = useMemo(() => {
        // Estaciones sospechosas o sin señal no entran a los promedios (misma regla que la página de Clima).
        const malas = new Map(salud.estaciones.filter((s) => s.sospechosa || s.estado === 'SIN_SEÑAL').map((s) => [s.id, s.nombre]));
        const validas = filas.filter((f) => !malas.has(f.estacion_id));
        const col = (k: keyof FilaActual) => validas.map((f) => num(f[k])).filter((v): v is number => v != null);
        const t = col('temp_obs_c'), v = col('viento_obs_ms'), l = col('lluvia_obs_mm'), et = col('eto_obs_mm');
        const prom = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
        return {
            estacionesValidas: validas.length,
            estacionesTotal: filas.length,
            excluidas: [...malas.values()],
            excluidasIds: [...malas.keys()],
            tempMax: t.length ? Math.max(...t) : null,
            tempMin: t.length ? Math.min(...t) : null,
            tempProm: prom(t),
            vientoMax: v.length ? Math.max(...v) : null,
            lluviaProm: prom(l),
            etoProm: prom(et),
            ultimaObs: validas.map((f) => f.obs_ts).filter((s): s is string => !!s).sort().pop() ?? null,
        };
    }, [filas, salud.estaciones]);

    return { pulso, error, cargado };
}

// ── Canal: las 14 escalas con su última MEDICIÓN DE CAMPO (no arrastre) ─────
/**
 * Una sola consulta (30 días) para las 14 escalas. A diferencia de `useCanalExtremos`, separa la medición de campo del arrastre de
 * continuidad (confirmada = false) y mide la edad con fecha + hora_lectura, no con `creado_en` (que para el arrastre es 00:00 local).
 */
export function useCanalPerfil(vaciado: boolean) {
    const [metas, setMetas] = useState<EscalaMeta[]>([]);
    const [lecturas, setLecturas] = useState<LecturaEscala[]>([]);
    const [ahora, setAhora] = useState(() => Date.now());
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const meta = await ensureMetadata();
            const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
            const { data, error: e } = await supabase
                .from('lecturas_escalas')
                .select('escala_id, fecha, hora_lectura, nivel_m, nivel_abajo_m, radiales_json, gasto_calculado_m3s, gasto_metodo, confirmada, responsable, notas')
                .gte('fecha', desde)
                .order('fecha', { ascending: false })
                .order('hora_lectura', { ascending: false })
                .limit(1500);
            if (e) throw e;
            setMetas(meta.escalas as unknown as EscalaMeta[]);
            setLecturas((data ?? []) as unknown as LecturaEscala[]);
            setAhora(Date.now());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo leer el perfil del canal');
        } finally {
            setCargado(true);
        }
    }, []);

    usePolling(cargar, 5 * 60_000);
    useEffect(() => {
        const unsub = onTableCoalesced('lecturas_escalas', '*', () => { void cargar(); });
        return () => unsub();
    }, [cargar]);

    const modelo = useMemo(() => modeloPerfilCanal(metas, lecturas, ahora, vaciado), [metas, lecturas, ahora, vaciado]);
    return { modelo, error, cargado, recargar: cargar };
}

// ── Canal: volumen almacenado (vol_interescalas, solo lecturas de campo) ────
export interface VolumenCanal {
    /** Suma de los tramos con volumen calculable (Mm³); null si ningún tramo tiene dato. */
    totalMm3: number | null;
    tramosMedidos: number;
    tramosTotal: number;
}

/**
 * Volumen en el canal desde la vista `vol_interescalas`, que desde la migración 20261101180000 ya NO usa los
 * arrastres de medianoche de Chronos: un tramo sin lectura de campo en 2 días queda sin volumen (S/D) y se
 * reporta la cobertura (tramos medidos / totales) en lugar de inventar el faltante.
 */
export function useVolumenCanal() {
    const [vol, setVol] = useState<VolumenCanal>({ totalMm3: null, tramosMedidos: 0, tramosTotal: 0 });
    const [cargado, setCargado] = useState(false);
    const cargar = useCallback(async () => {
        const { data, error } = await supabase.from('vol_interescalas').select('esc_up, vol_mm3');
        if (!error && data) {
            const filas = data as { esc_up: string; vol_mm3: number | string | null }[];
            const conVol = filas.map((f) => (f.vol_mm3 == null ? null : Number(f.vol_mm3))).filter((v): v is number => v != null && Number.isFinite(v));
            setVol({ totalMm3: conVol.length ? conVol.reduce((a, b) => a + b, 0) : null, tramosMedidos: conVol.length, tramosTotal: filas.length });
        }
        setCargado(true);
    }, []);
    usePolling(cargar, 5 * 60_000);
    useEffect(() => {
        const unsub = onTableCoalesced('lecturas_escalas', '*', () => { void cargar(); });
        return () => unsub();
    }, [cargar]);
    return { vol, cargado };
}

// ── Clima: ETo MEDIDO de los últimos días (referencia para la previsión) ────
export interface EtoReciente {
    /** Promedio diario (mm/d) de los últimos días completos, promedio entre estaciones; null = S/D. */
    promMmDia: number | null;
    dias: number;
    estaciones: number;
}

/**
 * ETo diario observado (WeatherLink `et_dia_mm`, máximo del día local con lectura ≥ 20 h) de los últimos 7 días completos.
 * No hay climatología satelital de años previos para comparar "contra lo normal"; esto es la referencia honesta disponible:
 * cuánto evaporó realmente la semana pasada.
 */
export function useEtoReciente(dias = 7) {
    const [r, setR] = useState<EtoReciente>({ promMmDia: null, dias: 0, estaciones: 0 });
    const cargar = useCallback(async () => {
        const desde = new Date(Date.now() - (dias + 1) * 86_400_000).toISOString();
        const { data, error } = await supabase.from('clima_estacion_lecturas')
            .select('estacion_id, ts, et_dia_mm').gte('ts', desde).not('et_dia_mm', 'is', null).limit(5000);
        if (error || !data) return;
        const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
        const porDia = new Map<string, { max: number; ultH: number }>();
        for (const f of data as { estacion_id: string; ts: string; et_dia_mm: number | string }[]) {
            const loc = new Date(Date.parse(f.ts) - 6 * 3_600_000);
            const dia = loc.toISOString().slice(0, 10);
            if (dia >= hoy) continue;
            const v = Number(f.et_dia_mm);
            if (!Number.isFinite(v) || v < 0 || v > 20) continue;
            const k = `${f.estacion_id}|${dia}`;
            const p = porDia.get(k);
            porDia.set(k, { max: Math.max(p?.max ?? 0, v), ultH: Math.max(p?.ultH ?? 0, loc.getUTCHours()) });
        }
        const completos = [...porDia.entries()].filter(([, x]) => x.ultH >= 20);
        const porFecha = new Map<string, number[]>();
        for (const [k, x] of completos) { const d = k.split('|')[1]; (porFecha.get(d) ?? porFecha.set(d, []).get(d)!).push(x.max); }
        const medias = [...porFecha.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, dias)
            .map(([, a]) => a.reduce((s, v) => s + v, 0) / a.length);
        setR({
            promMmDia: medias.length ? medias.reduce((s, v) => s + v, 0) / medias.length : null,
            dias: medias.length, estaciones: new Set(completos.map(([k]) => k.split('|')[0])).size,
        });
    }, [dias]);
    usePolling(cargar, 60 * 60_000);
    return r;
}
