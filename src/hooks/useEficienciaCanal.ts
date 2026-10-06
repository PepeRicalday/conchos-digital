import { useMemo } from 'react';
import { useCanalExtremos } from './useDashboardPulso';
import { clasificaConduccion, type ClasificacionConduccion } from '../utils/eficienciaCanal';
import type { ConduccionTramo } from '../utils/conduccion';

export interface EficienciaCanal {
    /** Eficiencia de conducción K-0→K-104 (Qs/Qe). La MISMA cifra en Dashboard, Hidrometría, Distribución y Balance. */
    conduccion: ConduccionTramo;
    clasificacion: ClasificacionConduccion;
    /** Gasto de entrada; null si el extremo no tiene lectura vigente (≤ 4 h) — se rotula S/D, no su último valor. */
    qEntrada: number | null;
    qSalida: number | null;
    /** Marca de la última telemetría de cada extremo (ms), para rotular la antigüedad. */
    k0TelemetriaMs: number | null;
    k104TelemetriaMs: number | null;
    k0Fresca: boolean;
    k104Fresca: boolean;
    cargado: boolean;
    error: string | null;
    recargar: () => void;
}

/** Fuente única de la eficiencia del canal para las pantallas operativas. */
export function useEficienciaCanal(): EficienciaCanal {
    const c = useCanalExtremos();
    return useMemo(() => ({
        conduccion: c.conduccion,
        clasificacion: clasificaConduccion(c.conduccion),
        qEntrada: c.k0?.fresca ? c.k0.gasto : null,
        qSalida: c.k104?.fresca ? c.k104.gasto : null,
        k0TelemetriaMs: c.k0?.telemetriaMs ?? null,
        k104TelemetriaMs: c.k104?.telemetriaMs ?? null,
        k0Fresca: !!c.k0?.fresca,
        k104Fresca: !!c.k104?.fresca,
        cargado: c.cargado,
        error: c.error,
        recargar: () => { void c.recargar(); },
    }), [c]);
}
