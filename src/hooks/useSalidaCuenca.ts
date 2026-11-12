import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { UBICACION_OJINAGA } from '../utils/aqwpCuenca';
import type { LecturaGasto } from '../utils/cuencaAnalisis';

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const DESDE = '2021-01-01';
const TTL_MS = 30 * 60 * 1000; // el portal publica una vez al día

let cache: { t: number; p: Promise<LecturaGasto[]> } | null = null;

async function descargar(): Promise<LecturaGasto[]> {
  const ds = await supabase.from('aqwp_datasets').select('id_number').eq('ubicacion_id', UBICACION_OJINAGA).eq('magnitud', 'gasto').limit(1);
  if (ds.error) throw new Error(ds.error.message);
  const id = ds.data?.[0]?.id_number;
  if (id == null) return [];
  const out: LecturaGasto[] = [];
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await supabase.from('aqwp_lecturas_diarias').select('fecha, valor').eq('dataset_id', id).gte('fecha', DESDE)
      .order('fecha', { ascending: true }).range(from, from + PAGINA - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.push({ fecha: r.fecha, valor: r.valor == null || !Number.isFinite(Number(r.valor)) ? null : Number(r.valor) });
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return out;
}

/**
 * Gasto diario del aforo de Ojinaga (USIBWC 08373000, vía AQUARIUS) desde 2021: la salida de la cuenca del Conchos.
 * Carga aparte y con caché: un fallo aquí deja la salida en S/D sin tirar el resto de la vista.
 */
export function useSalidaCuenca() {
  const [lecturas, setLecturas] = useState<LecturaGasto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!cache || Date.now() - cache.t > TTL_MS) {
      const p = descargar();
      cache = { t: Date.now(), p };
      p.catch(() => { if (cache?.p === p) cache = null; });
    }
    cache.p.then((l) => { if (vivo) setLecturas(l); }).catch((e: Error) => { if (vivo) setError(e.message || 'Error desconocido'); });
    return () => { vivo = false; };
  }, []);
  return { lecturas, cargando: lecturas == null && error == null, error };
}
