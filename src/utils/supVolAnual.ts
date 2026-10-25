/**
 * supVolAnual — carga ÚNICA (con caché de sesión) de superficie_volumen_anual_modulo (informe ACUM_INF por año, módulo y cultivo).
 * El panel de comparación interanual y el informe de NDVI leían la misma tabla por separado; ahora comparten la consulta.
 * Un error de lectura se devuelve aparte (no equivale a "sin datos") y NO se guarda en la caché.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FilaSupVol } from './ndviInteranual';

export const COLS_SUPVOL = 'anio, numero_modulo, cultivo, superficie_ha, volumen_miles_m3, atipico';
export const LIMITE_FILAS_SUPVOL = 2000;

export interface ResultadoSupVol { filas: FilaSupVol[]; error: string | null }

let cache: Promise<ResultadoSupVol> | null = null;

export function cargarSupVolAnual(cliente: Pick<SupabaseClient, 'from'>): Promise<ResultadoSupVol> {
    if (!cache) {
        cache = (async () => {
            const { data, error } = await cliente.from('superficie_volumen_anual_modulo').select(COLS_SUPVOL).limit(LIMITE_FILAS_SUPVOL);
            if (error || !data) { cache = null; return { filas: [], error: error?.message ?? 'Sin respuesta del servidor.' }; }
            return { filas: data as FilaSupVol[], error: null };
        })();
    }
    return cache;
}

/** Solo para pruebas: vacía la caché. */
export function reiniciarCacheSupVol(): void { cache = null; }
