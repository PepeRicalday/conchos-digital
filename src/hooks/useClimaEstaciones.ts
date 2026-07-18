import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
    estimaNubosidadPorRadiacion, evaluaCalidad, fusionaCielo,
    type DiagnosticoCielo, type QaResultado,
} from '../utils/cielo';

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

/** Pronóstico horario vigente para una estación (nubosidad por capas + lluvia). */
export interface PronosticoHora {
    estacion_id: string;
    proveedor: string;
    modelo: string | null;
    corrida_en: string | null;
    valido_en: string;
    /** Fecha local America/Chihuahua del instante pronosticado. */
    fecha_local: string;
    horizonte_h: number | null;
    nubosidad_total_pct: number | null;
    nubosidad_baja_pct: number | null;
    nubosidad_media_pct: number | null;
    nubosidad_alta_pct: number | null;
    precip_prob_pct: number | null;
    precip_mm: number | null;
    temp_c: number | null;
    viento_ms: number | null;
    eto_fc_mm: number | null;
}

// Estación + su lectura más reciente, lista para tarjetas/mapa.
export interface EstacionConLectura extends EstacionClima {
    lectura: LecturaClima | null;
    /** Horas desde la última lectura (para marcar "en línea" vs "sin reportar"). */
    edadHoras: number | null;
    enLinea: boolean;
    /** Veredicto QA/QC de la lectura: frescura, rango físico y disponibilidad. */
    calidad: QaResultado;
    /** Pronóstico de la hora vigente; null si aún no se ha sincronizado. */
    pronostico: PronosticoHora | null;
    /** Serie horaria hacia adelante, para gráficas de nubosidad y lluvia. */
    pronosticoSerie: PronosticoHora[];
    /**
     * Estado del cielo fusionado. Vale 'no_determinado' —sin icono— mientras no
     * exista una fuente de nubosidad; NO se infiere de la lluvia observada.
     */
    cielo: DiagnosticoCielo;
    /** Nubosidad estimada localmente por radiación (§5.1); null de noche. */
    nubosidadEstPct: number | null;
    clearnessIndex: number | null;
}

/** Frescura: consideramos "en línea" si reportó en las últimas 3 h. */
const FRESCURA_H = 3;

/** Estado del refresco manual bajo demanda (botón "Actualizar datos"). */
export interface EstadoRefresco {
    activo: boolean;
    /** Paso en curso, para dar retroalimentación al operador. */
    paso: string | null;
    /** Resumen del último refresco: qué se actualizó y qué falló. */
    resultado: string | null;
    error: string | null;
    /** Momento del último refresco manual exitoso. */
    ultimoEn: Date | null;
}

export function useClimaEstaciones() {
    const [estaciones, setEstaciones] = useState<EstacionConLectura[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refresco, setRefresco] = useState<EstadoRefresco>({
        activo: false, paso: null, resultado: null, error: null, ultimoEn: null,
    });

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

            // Pronóstico horario vigente (nubosidad por capas + precipitación).
            // Es una fuente OPCIONAL: si aún no se ha sincronizado, el estado del
            // cielo queda "no determinado" en vez de inventarse.
            const desde = new Date(Date.now() - 3.6e6).toISOString();
            const { data: fcs } = await supabase
                .from('clima_pronostico_horario')
                .select('estacion_id, proveedor, modelo, corrida_en, valido_en, fecha_local, horizonte_h, nubosidad_total_pct, nubosidad_baja_pct, nubosidad_media_pct, nubosidad_alta_pct, precip_prob_pct, precip_mm, temp_c, viento_ms, eto_fc_mm')
                .in('estacion_id', ids)
                .gte('valido_en', desde)
                .order('valido_en', { ascending: true });

            const seriePorEstacion = new Map<string, PronosticoHora[]>();
            for (const f of (fcs ?? []) as PronosticoHora[]) {
                const arr = seriePorEstacion.get(f.estacion_id);
                if (arr) arr.push(f); else seriePorEstacion.set(f.estacion_id, [f]);
            }

            const ahoraMs = Date.now();
            const ahoraDate = new Date(ahoraMs);
            const combinadas: EstacionConLectura[] = lista.map((e) => {
                const lectura = ultimaPorEstacion.get(e.id) ?? null;
                const edadHoras = lectura ? (ahoraMs - new Date(lectura.ts).getTime()) / 3.6e6 : null;
                const calidad = evaluaCalidad(lectura, ahoraDate);

                const serie = seriePorEstacion.get(e.id) ?? [];
                const pronostico = serie[0] ?? null;

                // Estimación local por radiación: solo de día y con elevación
                // solar ≥ 10°; de noche devuelve null (no "0 % de nubes").
                const est = lectura
                    ? estimaNubosidadPorRadiacion(
                        lectura.rad_solar_wm2, new Date(lectura.ts),
                        Number(e.latitud), Number(e.longitud), Number(e.elevacion_msnm) || 1200,
                    )
                    : null;

                const cielo = fusionaCielo({
                    nubosidadFcPct: pronostico?.nubosidad_total_pct ?? null,
                    nubosidadEstPct: est?.nubosidadEstPct ?? null,
                    edadObsMin: calidad.edadMin,
                    edadFcMin: pronostico
                        ? (ahoraMs - new Date(pronostico.corrida_en ?? pronostico.valido_en).getTime()) / 60000
                        : null,
                });

                return {
                    ...e,
                    lectura,
                    edadHoras: edadHoras != null ? +edadHoras.toFixed(1) : null,
                    enLinea: edadHoras != null && edadHoras <= FRESCURA_H,
                    calidad,
                    pronostico,
                    pronosticoSerie: serie,
                    cielo,
                    nubosidadEstPct: est?.nubosidadEstPct ?? null,
                    clearnessIndex: est?.clearnessIndex ?? null,
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

    /**
     * Refresco MANUAL bajo demanda, para emitir un informe con datos frescos.
     *
     * No sustituye ni altera los crones (estaciones cada 2 h, pronóstico cada 1 h):
     * los invoca de inmediato para que el corte del informe no arrastre datos de
     * hasta 2 h de antigüedad, que el motor de calidad marcaría como "vencidos".
     *
     * Los dos syncs corren en paralelo (son independientes) y se tolera el fallo
     * de uno: si WeatherLink no responde pero el modelo sí, se refresca lo que se
     * pueda y se informa del fallo en vez de abortar todo.
     */
    const refrescarAhora = useCallback(async () => {
        setRefresco({ activo: true, paso: 'Consultando estaciones y modelo…', resultado: null, error: null, ultimoEn: null });
        try {
            const [wl, fc] = await Promise.allSettled([
                supabase.functions.invoke('weatherlink-sync', { body: {} }),
                supabase.functions.invoke('clima-pronostico-sync', { body: {} }),
            ]);

            // Una invocación puede resolverse pero devolver error de la función.
            const evalua = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, etiqueta: string) => {
                if (r.status === 'rejected') return { ok: false, txt: `${etiqueta}: sin respuesta` };
                if (r.value.error) return { ok: false, txt: `${etiqueta}: error del servicio` };
                const d = r.value.data as { sincronizadas?: number; total?: number } | null;
                return d?.sincronizadas != null
                    ? { ok: d.sincronizadas > 0, txt: `${etiqueta}: ${d.sincronizadas}/${d.total ?? '?'}` }
                    : { ok: true, txt: `${etiqueta}: ok` };
            };
            const rWl = evalua(wl, 'Estaciones');
            const rFc = evalua(fc, 'Pronóstico');

            setRefresco(r => ({ ...r, paso: 'Recargando lecturas…' }));
            await fetchData();

            const fallos = [rWl, rFc].filter(x => !x.ok);
            setRefresco({
                activo: false, paso: null,
                resultado: `${rWl.txt} · ${rFc.txt}`,
                error: fallos.length
                    ? 'Alguna fuente no se actualizó; el informe usará el último dato disponible.'
                    : null,
                ultimoEn: new Date(),
            });
        } catch (err) {
            // Aun con fallo del refresco, recargamos para no dejar la vista vacía.
            await fetchData();
            setRefresco({
                activo: false, paso: null, resultado: null,
                error: err instanceof Error ? err.message : 'No se pudo actualizar desde las fuentes',
                ultimoEn: null,
            });
        }
    }, [fetchData]);

    return { estaciones, loading, error, refetch: fetchData, refrescarAhora, refresco };
}
