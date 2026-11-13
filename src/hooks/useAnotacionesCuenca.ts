import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Anotacion, AnotacionNueva, TipoAnotacion } from '../utils/anotacionesCuenca';

const COLUMNAS = 'id, cuerpo_id, tipo, fecha, almacenamiento_mm3, elevacion_msnm, origen, comentario, anulada, creado_por, creado_por_nombre, creado_en';
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v)); // null es S/D, nunca 0

type Fila = Record<string, unknown>;
const aAnotacion = (r: Fila): Anotacion => ({
  id: Number(r.id), cuerpoId: String(r.cuerpo_id), tipo: r.tipo as TipoAnotacion, fecha: String(r.fecha),
  almMm3: num(r.almacenamiento_mm3), elevMsnm: num(r.elevacion_msnm),
  origen: (r.origen as string | null) ?? null, comentario: (r.comentario as string | null) ?? null, anulada: r.anulada === true,
  autorId: (r.creado_por as string | null) ?? null, autor: (r.creado_por_nombre as string | null) ?? null, creadoEn: String(r.creado_en),
});

/** La tabla todavía no existe en la base (migración sin aplicar): la edición se muestra como «no disponible», no como error. */
const sinTabla = (e: { code?: string; message?: string }) => e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message ?? '');

/**
 * Anotaciones de la cuenca (captura manual, cierre revisado, lectura sospechosa). Carga solo cuando `activo`.
 * `disponible` es false si la tabla no existe todavía; un fallo de red queda en `error` y no tira el resto de la vista.
 */
export function useAnotacionesCuenca(activo: boolean) {
  const [filas, setFilas] = useState<Anotacion[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    supabase.from('cuerpos_agua_anotaciones').select(COLUMNAS).order('fecha', { ascending: false }).limit(500).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) {
        if (sinTabla(e)) { setDisponible(false); setFilas([]); setError(null); } else setError(e.message);
        return;
      }
      setDisponible(true); setError(null); setFilas((data ?? []).map((r) => aAnotacion(r as Fila)));
    });
    return () => { vivo = false; };
  }, [activo, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  /** Guarda una anotación ya validada. Lanza con el mensaje de la base si se rechaza (permisos, restricciones). */
  const guardar = useCallback(async (fila: AnotacionNueva, autor: string | null) => {
    const { error: e } = await supabase.from('cuerpos_agua_anotaciones').insert({ ...fila, creado_por_nombre: autor });
    if (e) throw new Error(e.code === '42501' ? 'Su usuario no tiene permiso para anotar (solo SRL y ACU).' : e.message);
    setVersion((v) => v + 1);
  }, []);

  /** Anula (no borra) una anotación: queda en el historial, tachada. */
  const anular = useCallback(async (id: number) => {
    const { data, error: e } = await supabase.from('cuerpos_agua_anotaciones').update({ anulada: true, anulada_en: new Date().toISOString() }).eq('id', id).select('id');
    if (e) throw new Error(e.message);
    if (!data?.length) throw new Error('No se anuló: su usuario no tiene permiso sobre esta anotación.');
    setVersion((v) => v + 1);
  }, []);

  return { filas, disponible, error, recargar, guardar, anular, cargando: activo && filas == null && !error };
}
