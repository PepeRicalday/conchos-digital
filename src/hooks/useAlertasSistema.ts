import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { useUmbralesClima, usePolling } from './useClimaOperativo';
import {
    alertaDesdeRegistro, resumenAlertas,
    type AlertaRegistroFila, type AlertaSistema, type ResumenAlertas,
} from '../utils/dashboardKpis';

/**
 * Alertas persistidas (registro_alertas sin resolver) normalizadas al modelo del sistema. Lo comparten el Dashboard
 * y el menú lateral: antes cada uno contaba por su lado (KPI 4 · lista 8 · menú 21) y las 20 alertas de marzo
 * inflaban el menú como si fueran de hoy.
 */
export function useAlertasRegistro() {
    const [filas, setFilas] = useState<AlertaRegistroFila[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);
    // Hora del último refresco: la antigüedad se evalúa contra ella (los renders se mantienen puros).
    const [corteMs, setCorteMs] = useState(0);
    const umbrales = useUmbralesClima();

    // Callback estable: el efecto de suscripción no debe reiniciarse en cada render.
    const cargar = useCallback(async () => {
        const { data, error: e } = await supabase
            .from('registro_alertas')
            .select('id, tipo_riesgo, categoria, titulo, mensaje, origen_id, fecha_deteccion')
            .eq('resuelta', false)
            .order('fecha_deteccion', { ascending: false })
            .limit(200);
        if (e) { setError(e.message); setCargado(true); return; }
        setError(null);
        setFilas((data ?? []) as AlertaRegistroFila[]);
        setCorteMs(Date.now());
        setCargado(true);
    }, []);

    // Carga inicial + refresco cada 5 min (pestaña visible) y, además, al instante por realtime.
    usePolling(cargar, 5 * 60_000);
    useEffect(() => {
        const unsub = onTable('registro_alertas', '*', () => { void cargar(); });
        return () => unsub();
    }, [cargar]);

    const acciones = useMemo(
        () => Object.fromEntries(umbrales.filter((u) => u.accion).map((u) => [u.clave, u.accion as string])),
        [umbrales],
    );

    const alertas: AlertaSistema[] = useMemo(
        () => filas.map((f) => alertaDesdeRegistro(f, corteMs, acciones)),
        [filas, corteMs, acciones],
    );

    const resumen: ResumenAlertas = useMemo(() => resumenAlertas(alertas), [alertas]);
    return { alertas, resumen, error, cargado };
}
