import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  anillosDeGeojson, normalizarBalance, normalizarCierre, normalizarCuerpo, ordenarCuerpos,
  type BalanceMensual, type CierreMensual, type CuerpoAgua, type Par,
} from '../utils/cuerposAgua';

/** Huella máxima del vaso (KMZ del inventario de presas): contorno a nivel de diseño, NO el espejo de hoy. */
export interface HuellaVaso { cuerpoId: string; anillos: Par[][]; areaKm2: number; numIslas: number; areaIslasKm2: number }

/** Escena NDWI (Sentinel-2) vigente de un vaso. `contorno` solo viene en la más reciente de cada serie. */
export interface EscenaSatelital {
  idSerie: string;
  fecha: string;
  areaKm2: number | null;
  perimetroKm: number | null;
  /** ±1 píxel de borde: perímetro × resolución. null si falta alguno de los dos (S/D). */
  incertidumbreKm2: number | null;
  nubesVasoPct: number | null;
  contorno: Par[][];
}

export interface DatosCuerposAgua {
  cuerpos: CuerpoAgua[];
  cierres: CierreMensual[];
  balances: BalanceMensual[];
  huellas: Map<string, HuellaVaso>;
  /** Serie de escenas por id_serie, cronológica. La última trae su contorno. */
  escenas: Map<string, EscenaSatelital[]>;
}

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function paginar<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await consulta(from, from + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return out;
}

/**
 * Catálogo de cuerpos de agua de la cuenca + cierres mensuales + balance + huellas KMZ + escenas satelitales.
 * Todo es lectura de tablas ya calculadas (la fuente elegida y la calidad vienen congeladas en cada cierre).
 * Un fallo en las escenas satelitales NO tira la vista: se queda sin medición satelital y lo dice.
 */
export function useCuerposAgua() {
  const [datos, setDatos] = useState<DatosCuerposAgua | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avisoSatelite, setAvisoSatelite] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => { setLoading(true); setError(null); setVersion((v) => v + 1); }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [cuerposRes, cierres, balances, geoRes] = await Promise.all([
          supabase.from('cuerpos_agua').select('*').eq('activo', true),
          paginar<Record<string, unknown>>((a, b) => supabase.from('cuerpos_agua_cierre_mensual').select('*').order('mes', { ascending: true }).order('cuerpo_id', { ascending: true }).range(a, b)),
          paginar<Record<string, unknown>>((a, b) => supabase.from('cuerpos_agua_balance_mensual').select('*').order('mes', { ascending: true }).order('cuerpo_id', { ascending: true }).range(a, b)),
          supabase.from('cuerpos_agua_geometria').select('cuerpo_id, geojson, area_km2, num_islas, area_islas_km2').eq('vigente', true).eq('tipo', 'huella_maxima'),
        ]);
        if (cuerposRes.error) throw new Error(cuerposRes.error.message);
        if (geoRes.error) throw new Error(geoRes.error.message);
        const cuerpos = ordenarCuerpos((cuerposRes.data ?? []).map((r) => normalizarCuerpo(r as Record<string, unknown>)));

        const huellas = new Map<string, HuellaVaso>();
        for (const r of geoRes.data ?? []) {
          huellas.set(String(r.cuerpo_id), { cuerpoId: String(r.cuerpo_id), anillos: anillosDeGeojson(r.geojson), areaKm2: num(r.area_km2) ?? 0, numIslas: num(r.num_islas) ?? 0, areaIslasKm2: num(r.area_islas_km2) ?? 0 });
        }

        // Escenas NDWI vigentes (v2): ligeras primero, y el contorno solo de la más reciente de cada serie.
        const escenas = new Map<string, EscenaSatelital[]>();
        let aviso: string | null = null;
        try {
          const claves = new Set(cuerpos.map((c) => c.idSerie));
          const filas = await paginar<Record<string, unknown>>((a, b) => supabase.from('vaso_geometria_historico')
            .select('presa_id, fecha_escena, area_km2, perimetro_km, resolucion_m, cobertura_nubes_vaso_pct')
            .eq('vigente', true).eq('es_referencia_historica', false).order('fecha_escena', { ascending: true }).range(a, b));
          for (const r of filas) {
            const id = String(r.presa_id);
            if (!claves.has(id)) continue;
            const per = num(r.perimetro_km), res = num(r.resolucion_m) ?? 10;
            const e: EscenaSatelital = {
              idSerie: id, fecha: String(r.fecha_escena), areaKm2: num(r.area_km2), perimetroKm: per,
              incertidumbreKm2: per == null ? null : Math.round(per * res) / 1000, nubesVasoPct: num(r.cobertura_nubes_vaso_pct), contorno: [],
            };
            escenas.set(id, [...(escenas.get(id) ?? []), e]);
          }
          await Promise.all([...escenas.entries()].map(async ([id, serie]) => {
            const ultima = serie[serie.length - 1];
            const { data, error: e } = await supabase.from('vaso_geometria_historico').select('contorno_geojson')
              .eq('presa_id', id).eq('vigente', true).eq('fecha_escena', ultima.fecha).limit(1);
            if (!e && data?.[0]) ultima.contorno = anillosDeGeojson(data[0].contorno_geojson);
          }));
        } catch (e) {
          aviso = `No se pudieron leer las escenas satelitales: ${(e as Error).message}`;
          escenas.clear();
        }

        if (!vivo) return;
        setDatos({ cuerpos, cierres: cierres.map(normalizarCierre), balances: balances.map(normalizarBalance), huellas, escenas });
        setAvisoSatelite(aviso);
        setError(null);
      } catch (e) {
        if (vivo) setError((e as Error).message || 'Error desconocido');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [version]);

  return { datos, loading, error, avisoSatelite, recargar };
}
