import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { ensureMetadata } from '../store/useMetadataStore';
import { gastoDeLectura, esFrescaEscala } from '../utils/geoKpis';
import { conduccionTramo, type ConduccionTramo } from '../utils/conduccion';
import { usePolling, useSaludRed } from './useClimaOperativo';

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
 * Gasto de entrada (K-0) y salida (K-104) del canal con el criterio de Geo-Monitor / Monitor Público
 * (utils/geoKpis.gastoDeLectura + frescura de 240 min). La eficiencia sale de utils/conduccion.ts: una sola fórmula.
 */
export function useCanalExtremos() {
    const [extremos, setExtremos] = useState<{ k0: ExtremoCanal | null; k104: ExtremoCanal | null }>({ k0: null, k104: null });
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const meta = await ensureMetadata();
            // La fila de metadatos trae pzas_radiales/ancho (select *), aunque los tipos generados aún no los declaran.
            const dos = meta.escalas
                .filter((e) => Number(e.km) === 0 || Number(e.km) === 104)
                .map((e) => e as typeof e & { pzas_radiales?: number | null; ancho?: number | null });
            const leidos = await Promise.all(dos.map(async (esc) => {
                const { data, error: e } = await supabase
                    .from('lecturas_escalas')
                    .select('nivel_m, nivel_abajo_m, radiales_json, gasto_calculado_m3s, gasto_metodo, creado_en')
                    .eq('escala_id', esc.id)
                    .order('fecha', { ascending: false })
                    .order('hora_lectura', { ascending: false })
                    .limit(1);
                if (e) throw e;
                const l = data?.[0];
                const ts = l?.creado_en ? new Date(l.creado_en as string).getTime() : null;
                const extremo: ExtremoCanal = {
                    km: Number(esc.km),
                    nombre: esc.nombre,
                    gasto: l ? gastoDeLectura(l, { pzas_radiales: esc.pzas_radiales, ancho: esc.ancho, nombre: esc.nombre, km: Number(esc.km) }) : null,
                    fresca: esFrescaEscala(ts, Date.now()),
                    telemetriaMs: ts,
                };
                return extremo;
            }));
            setExtremos({ k0: leidos.find((x) => x.km === 0) ?? null, k104: leidos.find((x) => x.km === 104) ?? null });
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo leer el gasto del canal');
        } finally {
            setCargado(true);
        }
    }, []);

    usePolling(cargar, 5 * 60_000);
    useEffect(() => {
        const unsub = onTable('lecturas_escalas', '*', () => { void cargar(); });
        return () => unsub();
    }, [cargar]);

    const conduccion: ConduccionTramo = useMemo(
        () => conduccionTramo(
            { gasto: extremos.k0?.gasto, fresca: !!extremos.k0?.fresca },
            { gasto: extremos.k104?.gasto, fresca: !!extremos.k104?.fresca },
        ),
        [extremos],
    );
    return { ...extremos, conduccion, error, cargado };
}

// ── Clima: resumen ligero de la red (sin cargar todo el módulo de Clima) ────
export interface ClimaPulso {
    estacionesValidas: number;
    estacionesTotal: number;
    excluidas: string[];
    tempMax: number | null;
    tempMin: number | null;
    vientoMax: number | null;
    lluviaProm: number | null;
    etoProm: number | null;
}

interface FilaActual {
    estacion_id: string; nombre: string; temp_obs_c: number | string | null; viento_obs_ms: number | string | null;
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
            .select('estacion_id, nombre, temp_obs_c, viento_obs_ms, lluvia_obs_mm, eto_obs_mm');
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
            tempMax: t.length ? Math.max(...t) : null,
            tempMin: t.length ? Math.min(...t) : null,
            vientoMax: v.length ? Math.max(...v) : null,
            lluviaProm: prom(l),
            etoProm: prom(et),
        };
    }, [filas, salud.estaciones]);

    return { pulso, error, cargado };
}
