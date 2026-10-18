import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { onTable } from '../lib/realtimeHub';
import { ensureMetadata } from '../store/useMetadataStore';
import { useFecha } from '../context/FechaContext';
import { useHydricEvents } from './useHydricEvents';
import { usePolling } from './useClimaOperativo';
import { getTodayString, toDateString } from '../utils/dateHelpers';
import {
    construirZonas, type EscalaMeta, type LecturaEscala, type ResumenDia, type SeccionMeta, type Zone,
} from '../utils/controlEscalasZonas';

const VENTANA_DIAS = 7;
const DEBOUNCE_MS = 800;
const POLL_MS = 5 * 60_000;

/**
 * Datos de Control de Niveles. Las 3 lecturas van en paralelo, el spinner solo existe en la primera carga (los
 * refrescos por realtime/polling mantienen lo anterior), los eventos realtime se agrupan (debounce) y una respuesta
 * vieja nunca pisa a una nueva. Un fallo parcial se reporta en `avisos` en vez de mostrar una pantalla "normal" vacía.
 */
export function useControlEscalas() {
    const { fechaSeleccionada, esHoy } = useFecha();
    const { activeEvent } = useHydricEvents();
    const vaciado = activeEvent?.evento_tipo === 'VACIADO';

    const [zones, setZones] = useState<Zone[]>([]);
    const [cargado, setCargado] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [avisos, setAvisos] = useState<string[]>([]);
    const [actualizadoMs, setActualizadoMs] = useState<number | null>(null);
    const version = useRef(0);

    const cargar = useCallback(async () => {
        const mi = ++version.current;
        try {
            const desde = toDateString(new Date(Date.now() - VENTANA_DIAS * 86_400_000));
            const [meta, lect, res] = await Promise.all([
                ensureMetadata({ requireSecciones: true }),
                esHoy
                    ? supabase.from('lecturas_escalas')
                        .select('escala_id, fecha, hora_lectura, creado_en, nivel_m, nivel_abajo_m, radiales_json, gasto_calculado_m3s, gasto_metodo, confirmada')
                        .gte('fecha', desde)
                        .order('fecha', { ascending: false }).order('hora_lectura', { ascending: false })
                        .limit(1500)
                    : Promise.resolve({ data: [] as LecturaEscala[], error: null }),
                supabase.from('resumen_escalas_diario').select('*').eq('fecha', fechaSeleccionada),
            ]);
            if (mi !== version.current) return;

            const faltas: string[] = [];
            if (lect.error) faltas.push('lecturas recientes');
            if (res.error) faltas.push('resumen del día');

            const escalas = (meta.escalas as unknown as EscalaMeta[]);
            const secciones = (meta.secciones as unknown as SeccionMeta[]);
            setZones(construirZonas(
                escalas, secciones,
                (lect.data ?? []) as unknown as LecturaEscala[], (res.data ?? []) as unknown as ResumenDia[],
                { fecha: fechaSeleccionada, esHoy: esHoy && fechaSeleccionada === getTodayString(), vaciado, ahoraMs: Date.now() },
            ));
            setAvisos(faltas);
            setError(null);
            setActualizadoMs(Date.now());
        } catch (err) {
            if (mi !== version.current) return;
            setError(err instanceof Error ? err.message : 'No se pudieron leer las escalas');
        } finally {
            if (mi === version.current) setCargado(true);
        }
    }, [fechaSeleccionada, esHoy, vaciado]);

    usePolling(cargar, POLL_MS);

    const timer = useRef<number | undefined>(undefined);
    useEffect(() => {
        const unsub = onTable('lecturas_escalas', '*', () => {
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => { void cargar(); }, DEBOUNCE_MS);
        });
        return () => { unsub(); window.clearTimeout(timer.current); };
    }, [cargar]);

    return { zones, cargado, error, avisos, actualizadoMs, vaciado, esHoy, fechaSeleccionada, recargar: cargar };
}
