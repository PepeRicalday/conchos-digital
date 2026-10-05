import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizaSalud, type EstacionSalud, type FilaSaludRed } from '../utils/saludRed';
import { entregadoDelDia } from '../utils/balanceModulo';
import { numeroModuloDeId } from '../utils/modulosSRL';

/** Refresca cada `ms` solo con la pestaña visible; al volver a verse recarga de inmediato. */
/** `cargar` DEBE ser estable (useCallback): una función nueva en cada render reiniciaría el efecto en bucle. */
function usePolling(cargar: () => unknown, ms: number) {
    useEffect(() => {
        void cargar();
        const tick = () => { if (document.visibilityState === 'visible') void cargar(); };
        const id = window.setInterval(tick, ms);
        document.addEventListener('visibilitychange', tick);
        return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
    }, [cargar, ms]);
}

// ── Salud de la red (fn_clima_salud_red) ────────────────────────────────────
export function useSaludRed() {
    const [estaciones, setEstaciones] = useState<EstacionSalud[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        const { data, error: e } = await supabase.rpc('fn_clima_salud_red');
        if (e) { setError(e.message); setCargado(true); return; }
        setError(null);
        setEstaciones(((data ?? []) as FilaSaludRed[]).map(normalizaSalud));
        setCargado(true);
    }, []);
    usePolling(cargar, 5 * 60_000);
    return { estaciones, error, cargado, recargar: cargar };
}

// ── Alertas agroclimáticas y de fuente de datos abiertas ────────────────────
export interface AlertaClima {
    id: string;
    tipoRiesgo: string;
    categoria: 'agroclimatica' | 'fuente_datos';
    titulo: string;
    mensaje: string;
    origenId: string;
    detectadaEn: string;
}

export function useAlertasClima() {
    const [alertas, setAlertas] = useState<AlertaClima[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    const cargar = useCallback(async () => {
        const { data, error: e } = await supabase
            .from('registro_alertas')
            .select('id, tipo_riesgo, categoria, titulo, mensaje, origen_id, fecha_deteccion')
            .in('categoria', ['agroclimatica', 'fuente_datos'])
            .like('origen_id', 'CLIMA-%')
            .eq('resuelta', false)
            .order('fecha_deteccion', { ascending: false })
            .limit(60);
        if (e) { setError(e.message); setCargado(true); return; }
        setError(null);
        setAlertas((data ?? []).map((r) => ({
            id: r.id as string,
            tipoRiesgo: r.tipo_riesgo as string,
            categoria: r.categoria as AlertaClima['categoria'],
            titulo: r.titulo as string,
            mensaje: r.mensaje as string,
            origenId: r.origen_id as string,
            detectadaEn: r.fecha_deteccion as string,
        })));
        setCargado(true);
    }, []);
    usePolling(cargar, 5 * 60_000);
    return { alertas, error, cargado };
}

// ── Umbrales vigentes (clima_umbrales) ──────────────────────────────────────
export interface UmbralClima {
    clave: string;
    etiqueta: string;
    comparador: "mayor" | "menor";
    aviso: number;
    critico: number;
    unidad: string;
    accion: string | null;
}

export function useUmbralesClima() {
    const [umbrales, setUmbrales] = useState<UmbralClima[]>([]);
    useEffect(() => {
        let vivo = true;
        void supabase.from('clima_umbrales').select('clave, etiqueta, comparador, aviso, critico, unidad, accion').order('clave')
            .then(({ data }) => { if (vivo && data) setUmbrales(data as UmbralClima[]); });
        return () => { vivo = false; };
    }, []);
    return umbrales;
}

// ── Entregas del día por módulo (entregas_modulo) — número de módulo SRL → m³ ──
export function useEntregasDia(fecha: string) {
    const [porModulo, setPorModulo] = useState<Map<number, number | null>>(new Map());
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let vivo = true;
        void supabase.from('entregas_modulo').select('modulo_id, volumen_m3').eq('fecha', fecha)
            .then(({ data, error: e }) => {
                if (!vivo) return;
                if (e) { setError(e.message); return; }
                setError(null);
                const grupos = new Map<number, { volumen_m3: number | null }[]>();
                for (const r of data ?? []) {
                    const n = numeroModuloDeId(r.modulo_id as string);
                    if (n == null) continue;
                    const g = grupos.get(n) ?? [];
                    g.push({ volumen_m3: r.volumen_m3 as number | null });
                    grupos.set(n, g);
                }
                setPorModulo(new Map([...grupos].map(([n, filas]) => [n, entregadoDelDia(filas)])));
            });
        return () => { vivo = false; };
    }, [fecha]);
    return { porModulo, error };
}

// ── Serie observada de las últimas 24 h de una estación ─────────────────────
export interface PuntoObs { ts: number; temp: number | null; viento: number | null; lluvia: number | null }

export function useSerieObservada(estacionId: string | null) {
    const [serie, setSerie] = useState<PuntoObs[]>([]);
    useEffect(() => {
        if (!estacionId) return;
        let vivo = true;
        const desde = new Date(Date.now() - 24 * 3.6e6).toISOString();
        void supabase.from('clima_estacion_lecturas')
            .select('ts, temp_c, viento_ms, lluvia_dia_mm')
            .eq('estacion_id', estacionId).gte('ts', desde).order('ts', { ascending: true }).limit(500)
            .then(({ data }) => {
                if (!vivo) return;
                setSerie((data ?? []).map((r) => ({
                    ts: new Date(r.ts as string).getTime(),
                    temp: r.temp_c as number | null,
                    viento: r.viento_ms as number | null,
                    lluvia: r.lluvia_dia_mm as number | null,
                })));
            });
        return () => { vivo = false; };
    }, [estacionId]);
    return estacionId ? serie : [];
}
