import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizarFuente, type FuenteSalud } from '../utils/saludFuentes';

const REFRESCO_MS = 5 * 60 * 1000;

/**
 * Estado de las fuentes de datos de la cuenca (vista v_cuenca_salud_fuentes). Una sola consulta pequeña, se repite cada 5 min
 * mientras la pestaña está visible. Un fallo deja `filas` en null y el error a la vista: nunca se supone que todo está bien.
 */
export function useSaludFuentes() {
  const [filas, setFilas] = useState<FuenteSalud[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      if (document.hidden) return;
      const { data, error: e } = await supabase.from('v_cuenca_salud_fuentes').select('clave, grupo, nombre, ultimo_en, esperado_min');
      if (!vivo) return;
      if (e) { setError(e.message || 'Error desconocido'); setFilas(null); return; }
      setError(null);
      setFilas((data ?? []).map((r) => normalizarFuente(r as Record<string, unknown>)));
    };
    void cargar();
    const t = window.setInterval(() => { void cargar(); }, REFRESCO_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);
  return { filas, error, cargando: filas == null && error == null };
}
