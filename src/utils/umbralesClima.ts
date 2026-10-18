// Umbrales de clima para los informes que no pasan por la vista de alertas de BD.
// Fuente de verdad: tabla clima_umbrales (editable); estos valores son el respaldo si aún no cargó y
// coinciden con lo sembrado el 2026-10-18 (calibrados con lecturas jul-oct 2026).
import type { UmbralClima } from '../hooks/useClimaOperativo';

const RESPALDO = {
    calor: { aviso: 38, critico: 42 },
    helada: { aviso: 4, critico: 0 },
    viento: { aviso: 6, critico: 10 },
    viento_presa: { aviso: 8, critico: 12 },
    lluvia: { aviso: 10, critico: 25 },
    rafaga: { aviso: 12, critico: 18 },
    rafaga_presa: { aviso: 15, critico: 20 },
} as const;

export type ClaveUmbral = keyof typeof RESPALDO;

export function umbralVigente(umbrales: UmbralClima[] | undefined, clave: ClaveUmbral): { aviso: number; critico: number } {
    const u = umbrales?.find(x => x.clave === clave);
    return u ? { aviso: Number(u.aviso), critico: Number(u.critico) } : { ...RESPALDO[clave] };
}

/** Las presas (zona abierta) tienen umbral propio de viento y ráfaga: su régimen normal supera el de los módulos. */
export const claveVientoDe = (rol: string): 'viento' | 'viento_presa' => (rol === 'presa' ? 'viento_presa' : 'viento');
export const claveRafagaDe = (rol: string): 'rafaga' | 'rafaga_presa' => (rol === 'presa' ? 'rafaga_presa' : 'rafaga');
