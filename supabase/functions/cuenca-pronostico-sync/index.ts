// ═══════════════════════════════════════════════════════════════════════════
// cuenca-pronostico-sync — pronóstico diario de 7 días en los puntos de la cuenca del Conchos (contexto, fuente TERCERA)
// ---------------------------------------------------------------------------
// Open-Meteo, sin llave (uso NO comercial). UNA petición por modelo con TODOS los puntos (cuenca_puntos: estaciones JCAS + propias):
// 3 modelos × 4 corridas/día ≈ 12 peticiones (~300 "llamadas" de cuota al día, de 10,000). Guarda un snapshot por corrida para poder
// verificar con la anticipación real (fn_cuenca_verificacion). NO toca clima_pronostico_* ni clima_estaciones (WeatherLink).
// Estricto: si la respuesta cambia de formato (FormatoOpenMeteoError) no se guarda nada de ese modelo. S/D = NULL, nunca 0.
// Auth: x-cron-secret (cron_secretos 'cuenca_pronostico') o JWT de usuario SRL.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { exigirRol } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { FormatoOpenMeteoError, MODELOS_CUENCA, parseRespuesta, urlPronostico } from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const UA = "SICA005-cuenca-pronostico/1.0 (monitoreo DR-005 Delicias; uso no comercial, 4 corridas al dia)";
const RETENCION_DIAS = 120;
const LOTE = 1000;

async function gestionarAlerta(sb: Sb, origen: string, activa: boolean, titulo: string, mensaje: string) {
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (activa && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({ tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen, titulo, mensaje });
  } else if (!activa && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() }).eq("origen_id", origen).eq("resuelta", false);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  try {
    const auth = await exigirRol(req, ["SRL"], { nombreSecreto: "cuenca_pronostico" }, sb);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const { data: puntos, error: eP } = await sb.from("cuenca_puntos").select("id, latitud, longitud, elevacion_dem_m").eq("activo", true).order("id");
    if (eP) throw new Error(`puntos: ${eP.message}`);
    const lista = (puntos ?? []) as { id: string; latitud: number; longitud: number; elevacion_dem_m: number | null }[];
    if (lista.length === 0) throw new Error("cuenca_puntos sin puntos activos");

    const corrida = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const r = { puntos: lista.length, modelos: 0, filas: 0, errores: [] as string[] };
    let elevaciones: (number | null)[] | null = null;

    for (const modelo of MODELOS_CUENCA) {
      try {
        const resp = await fetch(urlPronostico(lista.map((p) => ({ lat: Number(p.latitud), lon: Number(p.longitud) })), modelo), {
          headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const datos = parseRespuesta(await resp.json(), lista.length);
        if (!elevaciones) elevaciones = datos.map((d) => d.elevacion);
        const filas = datos.flatMap((d, k) => d.dias.map((x) => ({
          punto_id: lista[k].id, modelo, corrida_en: corrida, fecha: x.fecha, precip_mm: x.precip_mm, precip_prob_pct: x.precip_prob_pct,
          temp_media_c: x.temp_media_c, temp_max_c: x.temp_max_c, temp_min_c: x.temp_min_c, hum_media_pct: x.hum_media_pct, viento_medio_kmh: x.viento_medio_kmh, viento_dir_deg: x.viento_dir_deg,
        })));
        for (let i = 0; i < filas.length; i += LOTE) {
          const { error } = await sb.from("cuenca_pronostico_diario").upsert(filas.slice(i, i + LOTE), { onConflict: "punto_id,modelo,corrida_en,fecha" });
          if (error) throw new Error(error.message);
        }
        r.modelos++;
        r.filas += filas.length;
      } catch (e) {
        r.errores.push(`${modelo}: ${(e as Error).message}${e instanceof FormatoOpenMeteoError ? " (formato)" : ""}`);
      }
      await new Promise((s) => setTimeout(s, 1000)); // trato cortés con la API gratuita
    }

    // elevación del DEM de Open-Meteo para los puntos que aún no la tienen (las estaciones propias)
    if (elevaciones) {
      for (let k = 0; k < lista.length; k++) {
        if (lista[k].elevacion_dem_m == null && elevaciones[k] != null) await sb.from("cuenca_puntos").update({ elevacion_dem_m: elevaciones[k] }).eq("id", lista[k].id);
      }
    }
    await sb.from("cuenca_pronostico_diario").delete().lt("corrida_en", new Date(Date.now() - RETENCION_DIAS * 86_400_000).toISOString());

    await gestionarAlerta(sb, "CUENCA-PRONOSTICO", r.modelos === 0, "Pronóstico de la cuenca sin datos",
      `Ningún modelo respondió en la última corrida (${r.errores.slice(0, 2).join("; ")}). Se conserva el último pronóstico y se muestra con su antigüedad.`);
    await sb.from("cuenca_pronostico_log").insert({
      ok: r.modelos > 0 && r.errores.length === 0, puntos: r.puntos, modelos: r.modelos, filas: r.filas,
      error: r.errores.length ? r.errores.join(" | ") : null, duracion_ms: Date.now() - t0,
    });
    return json({ ok: r.modelos > 0, corrida, ...r }, r.modelos > 0 ? 200 : 502);
  } catch (e) {
    await sb.from("cuenca_pronostico_log").insert({ ok: false, error: (e as Error).message, duracion_ms: Date.now() - t0 });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
