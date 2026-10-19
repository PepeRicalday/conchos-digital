import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePolling } from './useClimaOperativo';

export interface FrescuraSistema {
    /** Instante (ms) del último registro de presas; null = S/D. */
    presaMs: number | null;
    /** Instante (ms) de la última MEDICIÓN DE CAMPO de una escala (confirmada, no arrastre); null = S/D. */
    escalaMs: number | null;
    cargado: boolean;
    error: boolean;
}

/** Chihuahua es UTC−6 fijo (sin horario de verano desde 2022): se usa para interpretar fecha + hora de campo. */
const instante = (fecha: string | null | undefined, hora: string | null | undefined): number | null => {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null;
    const t = new Date(`${fecha.slice(0, 10)}T${(hora || '00:00:00').slice(0, 8)}-06:00`).getTime();
    return Number.isFinite(t) ? t : null;
};

/**
 * Qué tan frescos están los datos que consulta el asistente. Sustituye al "Conectado — Datos en tiempo real" fijo:
 * el indicador ahora dice la verdad (hace cuánto se leyó cada fuente) y se refresca solo.
 */
export function useFrescuraSistema(): FrescuraSistema {
    const [estado, setEstado] = useState<FrescuraSistema>({ presaMs: null, escalaMs: null, cargado: false, error: false });

    const cargar = useCallback(async () => {
        const [p, e] = await Promise.all([
            supabase.from('lecturas_presas').select('fecha').order('fecha', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('lecturas_escalas').select('fecha, hora_lectura').eq('confirmada', true)
                .order('fecha', { ascending: false }).order('hora_lectura', { ascending: false }).limit(1).maybeSingle(),
        ]);
        setEstado({
            // Fecha de la LECTURA (no la hora en que se insertó la fila: una carga histórica reciente no es un dato fresco).
            presaMs: instante(p.data?.fecha as string | undefined, '12:00:00'),
            escalaMs: instante(e.data?.fecha as string | undefined, e.data?.hora_lectura as string | undefined),
            cargado: true,
            error: !!(p.error || e.error),
        });
    }, []);

    usePolling(cargar, 5 * 60_000);
    return estado;
}
