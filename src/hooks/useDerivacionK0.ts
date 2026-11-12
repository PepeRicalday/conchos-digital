import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { LecturaGasto } from '../utils/cuencaAnalisis';

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const TTL_MS = 30 * 60 * 1000;
/** La telemetría de la toma empieza el 2026-03-15; antes no hay gasto en K-0 y esos meses quedan S/D en el balance por tramo. */
const DESDE = '2026-01-01';
const ESCALA_K0 = 'ESC-000';

let cache: { t: number; p: Promise<LecturaGasto[]> } | null = null;

async function descargar(): Promise<LecturaGasto[]> {
  const out: LecturaGasto[] = [];
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabase.from('resumen_escalas_diario').select('fecha, gasto_calculado_m3s')
      .eq('escala_id', ESCALA_K0).gte('fecha', DESDE).order('fecha', { ascending: true }).range(from, from + PAGINA - 1);
    if (error) throw new Error(error.message);
    // Un día sin gasto calculado es S/D (null), nunca 0.
    for (const r of data ?? []) out.push({ fecha: r.fecha, valor: r.gasto_calculado_m3s == null || !Number.isFinite(Number(r.gasto_calculado_m3s)) ? null : Number(r.gasto_calculado_m3s) });
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return out;
}

/**
 * Gasto diario en la toma K-0 del Canal Conchos (lo que el distrito deriva del río). Carga solo cuando `activo` y con caché:
 * un fallo aquí deja la derivación en S/D sin tirar el resto de la vista.
 */
export function useDerivacionK0(activo = true) {
  const [lecturas, setLecturas] = useState<LecturaGasto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    if (!cache || Date.now() - cache.t > TTL_MS) {
      const p = descargar();
      cache = { t: Date.now(), p };
      p.catch(() => { if (cache?.p === p) cache = null; });
    }
    cache.p.then((l) => { if (vivo) setLecturas(l); }).catch((e: Error) => { if (vivo) setError(e.message || 'Error desconocido'); });
    return () => { vivo = false; };
  }, [activo]);
  return { lecturas, cargando: activo && lecturas == null && error == null, error };
}
