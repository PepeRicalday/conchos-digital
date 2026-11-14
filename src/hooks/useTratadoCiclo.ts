import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  CICLO_POR_DEFECTO, type Afluente, type CapturaMx, type CicloTratado, type CorteOficial, type EntregaDiaria, type SutronDia,
} from '../utils/tratadoCiclo';

const PAGINA = 1000; // PostgREST corta en 1000 filas por petición
const TTL_MS = 20 * 60 * 1000; // el IBWC actualiza una vez al día; el corte, una vez por semana

export interface DatosTratado {
  ciclo: CicloTratado;
  afluentes: Afluente[];
  cortes: CorteOficial[];
  entregas: EntregaDiaria[];
  capturas: CapturaMx[];
  sutron: SutronDia[];
  /** Última corrida de la sincronización automática. */
  ultimaSync: { en: string; ok: boolean; error: string | null } | null;
  /** Lo que no se pudo leer (cada bloque falla por separado: el resto de la vista sigue). */
  fallos: string[];
}

let cache: { t: number; p: Promise<DatosTratado> } | null = null;
const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function paginar<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGINA) {
    const { data, error } = await pedir(from, from + PAGINA - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return out;
}

async function descargar(): Promise<DatosTratado> {
  const fallos: string[] = [];
  const intenta = async <T,>(nombre: string, f: () => PromiseLike<T>, vacio: T): Promise<T> => {
    try { return await f(); } catch (e) { fallos.push(`${nombre}: ${(e as Error).message}`); return vacio; }
  };

  const [ciclo, afluentes, cortes, entregas, capturas, sutron, sync] = await Promise.all([
    intenta('ciclo', async () => {
      const { data, error } = await supabase.from('tratado_ciclos').select('*').eq('id', 'C37').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return CICLO_POR_DEFECTO;
      return {
        id: data.id, nombre: data.nombre, inicio: data.inicio, fin: data.fin, compromisoAf: Number(data.compromiso_af),
        compromisoAnualAf: Number(data.compromiso_anual_af), deudaPreviaAf: num(data.deuda_previa_af), deudaRemanenteAf: num(data.deuda_remanente_af),
      } satisfies CicloTratado;
    }, CICLO_POR_DEFECTO),
    intenta('afluentes', async () => {
      const { data, error } = await supabase.from('tratado_afluentes').select('clave, nombre, estacion, orden').order('orden');
      if (error) throw new Error(error.message);
      return (data ?? []) as Afluente[];
    }, [] as Afluente[]),
    intenta('cortes', async () => {
      const { data, error } = await supabase.from('tratado_cortes_oficiales').select('fecha_corte, acumulado_af, acumulado_mcm, deuda_remanente_af').order('fecha_corte');
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ fecha: r.fecha_corte as string, acumuladoAf: Number(r.acumulado_af), acumuladoMcm: num(r.acumulado_mcm), deudaRemanenteAf: num(r.deuda_remanente_af) }));
    }, [] as CorteOficial[]),
    intenta('entregas', async () => {
      const filas = await paginar<{ afluente: string; fecha: string; tcm: number | null }>((a, b) =>
        supabase.from('tratado_entregas_diarias').select('afluente, fecha, tcm').order('fecha', { ascending: true }).order('afluente').range(a, b));
      return filas.map((r) => ({ afluente: r.afluente, fecha: r.fecha, tcm: num(r.tcm) }));
    }, [] as EntregaDiaria[]),
    intenta('capturas', async () => {
      const { data, error } = await supabase.from('tratado_captura_mx')
        .select('id, periodo_desde, periodo_hasta, volumen_mm3, fuente, comentario, anulada, creado_por_nombre, creado_en').order('periodo_desde', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id as number, desde: r.periodo_desde as string, hasta: r.periodo_hasta as string, mm3: Number(r.volumen_mm3), fuente: r.fuente as string,
        comentario: (r.comentario as string | null) ?? null, autor: (r.creado_por_nombre as string | null) ?? null, creadoEn: r.creado_en as string, anulada: !!r.anulada,
      }));
    }, [] as CapturaMx[]),
    intenta('sutron', async () => {
      const { data, error } = await supabase.rpc('fn_tratado_sutron_diario', { p_desde: CICLO_POR_DEFECTO.inicio });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { fecha: string; gasto_medio_m3s: number; lecturas: number }[]).map((r) => ({ fecha: r.fecha, gastoMedio: Number(r.gasto_medio_m3s), lecturas: Number(r.lecturas) }));
    }, [] as SutronDia[]),
    intenta('sync', async () => {
      const { data, error } = await supabase.from('tratado_sync_log').select('en, ok, error').order('en', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      return data?.[0] ? { en: data[0].en as string, ok: !!data[0].ok, error: (data[0].error as string | null) ?? null } : null;
    }, null),
  ]);
  return { ciclo, afluentes, cortes, entregas, capturas, sutron, ultimaSync: sync, fallos };
}

/** Invalida la caché (tras capturar o anular una cifra oficial mexicana). */
export function invalidarTratado() { cache = null; }

/**
 * Avance del Tratado de 1944: ciclo vigente, corte oficial del IBWC, volumen diario de los seis afluentes, medición propia
 * del Sutron de Ojinaga y capturas oficiales de CONAGUA. Caché compartida: Cuenca y Dashboard montan el mismo hook sin
 * pedir dos veces. Cada bloque falla por separado (`fallos`), sin tirar la tarjeta. Con `activo = false` no pide nada
 * (la tarjeta del Dashboard solo lo carga al elegir su vista Tratado).
 */
export function useTratadoCiclo(activo = true) {
  const [datos, setDatos] = useState<DatosTratado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    if (!cache || Date.now() - cache.t > TTL_MS) {
      const p = descargar();
      cache = { t: Date.now(), p };
      p.catch(() => { if (cache?.p === p) cache = null; });
    }
    cache.p.then((d) => { if (vivo) { setDatos(d); setError(null); } }).catch((e: Error) => { if (vivo) setError(e.message || 'Error desconocido'); });
    return () => { vivo = false; };
  }, [version, activo]);

  const recargar = useCallback(() => { invalidarTratado(); setVersion((v) => v + 1); }, []);
  return { datos, cargando: datos == null && error == null, error, recargar };
}

export async function guardarCapturaMx(c: { desde: string; hasta: string; mm3: number; fuente: string; comentario?: string }): Promise<string | null> {
  const { error } = await supabase.from('tratado_captura_mx').insert({
    ciclo_id: 'C37', periodo_desde: c.desde, periodo_hasta: c.hasta, volumen_mm3: c.mm3, fuente: c.fuente.trim(), comentario: c.comentario?.trim() || null,
  });
  if (error) return error.message;
  invalidarTratado();
  return null;
}

export async function anularCapturaMx(id: number): Promise<string | null> {
  const { error } = await supabase.from('tratado_captura_mx').update({ anulada: true }).eq('id', id);
  if (error) return error.message;
  invalidarTratado();
  return null;
}
