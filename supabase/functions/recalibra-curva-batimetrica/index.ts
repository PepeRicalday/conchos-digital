// ═══════════════════════════════════════════════════════════════════════════
// recalibra-curva-batimetrica — Manejo de Vaso: recalibración dinámica
// ---------------------------------------------------------------------------
// Job mensual que compara el área real medida por NDWI (vaso_geometria_historico,
// poblada por sentinel-ndwi-vaso-sync) contra el área que predice la curva
// batimétrica oficial de CONAGUA (curvas_capacidad) en cada lectura de campo
// cercana, y guarda el factor de corrección resultante por banda de elevación
// en curva_batimetrica_correccion (migración 20260823160000).
//
// La curva oficial NUNCA se modifica — este job solo escribe en la tabla de
// corrección aparte, que el frontend puede mostrar como "ajuste sugerido"
// junto a la curva oficial, sin que eso afecte el simulador de nivel
// (PresaVasoMonitor.tsx → volumenPorElevacion), que sigue leyendo la curva
// oficial tal cual.
//
// El cómputo pesado (interpolación sobre la curva de 5501 puntos, promedio
// por banda) vive en la función SQL fn_recalibra_curva_batimetrica — esta
// función solo la invoca y hace el upsert/limpieza de bandas obsoletas
// (bandas que ya no tienen ninguna observación se eliminan, no quedan con
// un factor viejo sin respaldo).
//
// Invocación: POST { presa_id?: "PRE-001" }  (default: PRE-001)
// Cron: día 4 de cada mes, 08:00 UTC — un día después de
// ndwi-vaso-sync-mensual (día 3, 07:00 UTC), para asegurar que la escena del
// mes ya esté insertada en vaso_geometria_historico antes de recalibrar.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const presaId: string = body?.presa_id || "PRE-001";

    const { data: factores, error: errCalc } = await supabase
      .rpc("fn_recalibra_curva_batimetrica", { p_presa_id: presaId });
    if (errCalc) return json({ error: `fn_recalibra_curva_batimetrica: ${errCalc.message}` }, 500);

    const nuevasBandas = new Set((factores ?? []).map((f: any) => Number(f.banda_elevacion_msnm)));

    // Limpia bandas que ya no tienen ninguna observación respaldándolas (ej.
    // la lectura de campo que las sustentaba quedó fuera de la ventana de
    // ±20 días tras un backfill/corrección de datos) — un factor sin
    // observaciones vigentes es peor que no tener factor.
    const { data: existentes } = await supabase
      .from("curva_batimetrica_correccion")
      .select("banda_elevacion_msnm")
      .eq("presa_id", presaId);
    const bandasAEliminar = (existentes ?? [])
      .map((e: any) => Number(e.banda_elevacion_msnm))
      .filter((b: number) => !nuevasBandas.has(b));
    if (bandasAEliminar.length) {
      await supabase.from("curva_batimetrica_correccion")
        .delete().eq("presa_id", presaId).in("banda_elevacion_msnm", bandasAEliminar);
    }

    if (!factores || factores.length === 0) {
      return json({
        ok: true, presa_id: presaId, bandas_actualizadas: 0, bandas_eliminadas: bandasAEliminar.length,
        mensaje: "Sin observaciones válidas (escena NDWI + lectura de campo cercana) para recalibrar todavía.",
      }, 200);
    }

    // Escena más reciente de esta presa, para dejar constancia de hasta qué
    // dato se recalibró (procedencia, igual que fecha_escena en el histórico).
    const { data: ultimaEscena } = await supabase
      .from("vaso_geometria_historico")
      .select("fecha_escena")
      .eq("presa_id", presaId)
      .eq("es_referencia_historica", false)
      .order("fecha_escena", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultimaFechaEscena = ultimaEscena?.fecha_escena ?? new Date().toISOString();

    const filas = (factores as { banda_elevacion_msnm: number; factor_area: number; n_observaciones: number }[])
      .map((f) => ({
        presa_id: presaId,
        banda_elevacion_msnm: f.banda_elevacion_msnm,
        factor_area: Number(f.factor_area.toFixed(4)),
        n_observaciones: f.n_observaciones,
        desviacion_pct_prom: Number(((f.factor_area - 1) * 100).toFixed(2)),
        ultima_fecha_escena: ultimaFechaEscena,
        actualizado_en: new Date().toISOString(),
      }));

    const { error: errUpsert } = await supabase
      .from("curva_batimetrica_correccion")
      .upsert(filas, { onConflict: "presa_id,banda_elevacion_msnm" });
    if (errUpsert) return json({ error: `upsert curva_batimetrica_correccion: ${errUpsert.message}` }, 500);

    return json({
      ok: true, presa_id: presaId,
      bandas_actualizadas: filas.length, bandas_eliminadas: bandasAEliminar.length,
      desviacion_pct_promedio: Number((filas.reduce((s, f) => s + f.desviacion_pct_prom, 0) / filas.length).toFixed(2)),
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
