import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ── Estación climática WeatherLink seleccionada + su última lectura ──────────
export interface EstacionClima {
    id: string;
    station_id: number;
    nombre: string;
    latitud: number;
    longitud: number;
    elevacion_msnm: number | null;
    ciudad: string | null;
    presa_id: string | null;
    modulo_id: string | null;
    zona_id: string | null;
    rol: 'presa' | 'modulo' | 'canal' | string;
    activa: boolean;
    ult_dato_en: string | null;
}

export interface LecturaClima {
    estacion_id: string;
    station_id: number;
    fecha: string;
    ts: string;
    temp_c: number | null;
    temp_max_c: number | null;
    temp_min_c: number | null;
    hum_rel_pct: number | null;
    punto_rocio_c: number | null;
    presion_hpa: number | null;
    viento_ms: number | null;
    viento_dir_deg: number | null;
    viento_rafaga_ms: number | null;
    lluvia_dia_mm: number | null;
    lluvia_24h_mm: number | null;
    lluvia_mes_mm: number | null;
    lluvia_anio_mm: number | null;
    rad_solar_wm2: number | null;
    uv_index: number | null;
    et_dia_mm: number | null;
    et_mes_mm: number | null;
    eto_mm: number | null;
    gdd: number | null;
    bar_trend_hpa: number | null;
}

// Estación + su lectura más reciente, lista para tarjetas/mapa.
export interface EstacionConLectura extends EstacionClima {
    lectura: LecturaClima | null;
    /** Horas desde la última lectura (para marcar "en línea" vs "sin reportar"). */
    edadHoras: number | null;
    enLinea: boolean;
}

/** Frescura: consideramos "en línea" si reportó en las últimas 3 h. */
const FRESCURA_H = 3;

export function useClimaEstaciones() {
    const [estaciones, setEstaciones] = useState<EstacionConLectura[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: ests, error: eEst } = await supabase
                .from('clima_estaciones')
                .select('*')
                .eq('activa', true)
                .order('prioridad', { ascending: true });
            if (eEst) throw eEst;

            const lista = (ests ?? []) as EstacionClima[];
            if (!lista.length) { setEstaciones([]); return; }

            // Última lectura de cada estación (una query, tomamos la más reciente por estación)
            const ids = lista.map((e) => e.id);
            const { data: lects, error: eLec } = await supabase
                .from('clima_estacion_lecturas')
                .select('*')
                .in('estacion_id', ids)
                .order('ts', { ascending: false })
                .limit(ids.length * 20); // margen: varias lecturas por estación
            if (eLec) throw eLec;

            const ultimaPorEstacion = new Map<string, LecturaClima>();
            for (const l of (lects ?? []) as LecturaClima[]) {
                if (!ultimaPorEstacion.has(l.estacion_id)) ultimaPorEstacion.set(l.estacion_id, l);
            }

            const ahora = Date.now();
            const combinadas: EstacionConLectura[] = lista.map((e) => {
                const lectura = ultimaPorEstacion.get(e.id) ?? null;
                const edadHoras = lectura ? (ahora - new Date(lectura.ts).getTime()) / 3.6e6 : null;
                return {
                    ...e,
                    lectura,
                    edadHoras: edadHoras != null ? +edadHoras.toFixed(1) : null,
                    enLinea: edadHoras != null && edadHoras <= FRESCURA_H,
                };
            });
            setEstaciones(combinadas);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error cargando estaciones climáticas');
            setEstaciones([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    return { estaciones, loading, error, refetch: fetchData };
}
