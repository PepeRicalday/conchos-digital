import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CierreDifiere } from '../utils/alertasCuenca';

const REFRESCO_MS = 30 * 60 * 1000;

/**
 * Cierres mensuales cuyas fuentes discrepan (calidad DIFIERE), con el nombre del vaso. Una consulta pequeña (los últimos 12) cada 30 min
 * con la pestaña visible. Si falla queda null («aún no se sabe»): la alerta no afirma nada.
 */
export function useCierresDifieren() {
  const [filas, setFilas] = useState<CierreDifiere[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      if (document.hidden) return;
      const [c, n] = await Promise.all([
        supabase.from('cuerpos_agua_cierre_mensual').select('cuerpo_id, mes, dif_max_fuentes_mm3').eq('calidad', 'DIFIERE').order('mes', { ascending: false }).limit(12),
        supabase.from('cuerpos_agua').select('id, etiqueta'),
      ]);
      if (!vivo || c.error || n.error) return;
      const nombre = new Map((n.data ?? []).map((r) => [String(r.id), String(r.etiqueta)]));
      setFilas((c.data ?? []).map((r) => ({
        cuerpo: nombre.get(String(r.cuerpo_id)) ?? String(r.cuerpo_id), mes: String(r.mes),
        difMm3: r.dif_max_fuentes_mm3 == null || !Number.isFinite(Number(r.dif_max_fuentes_mm3)) ? null : Number(r.dif_max_fuentes_mm3),
      })));
    };
    void cargar();
    const t = window.setInterval(() => { void cargar(); }, REFRESCO_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);
  return filas;
}
