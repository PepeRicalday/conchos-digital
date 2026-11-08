// ═══════════════════════════════════════════════════════════════════════════
// jcas-sync — estaciones climatológicas de JCAS/UACJ dentro de la cuenca del Conchos (contexto, fuente TERCERA)
// ---------------------------------------------------------------------------
// Portal público https://proyectojcas.uacj.mx (sin API ni términos publicados; robots.txt vacío). SOLO se leen tres rutas
// públicas: /maps/get/estaciones (JSON), /estacion/view/{id}?mode=month|year (arreglos JS en el HTML). NUNCA /consulta.
// Cortesía: User-Agent identificable, una petición a la vez con pausa de 1 s, ≤ 20 estaciones, cron 2 veces al día + 1 semanal.
// Nada de esto toca clima_estaciones / clima_estacion_lecturas (WeatherLink) ni los KPIs del distrito.
// Modos (body.modo): "diario" (default) catálogo + últimos ~30 días · "anio" meses completos de los últimos 12 (reanudable, body.forzar=true recarga todo) ·
//                    "catalogo" solo la lista de estaciones · "hoy" solo la lectura PARCIAL del día en curso (tabla jcas_lecturas_hoy, cron cada 2 h).
//                    Opcional body.estaciones = [ids]. El día en curso nunca entra a jcas_lecturas_diarias (solo días completos).
// Estricto: si el HTML cambia (FormatoJcasError) no se guarda nada de esa estación y se levanta la alerta JCAS-FORMATO.
// S/D = NULL, nunca 0. Datos provisionales.
// Auth: x-cron-secret (cron_secretos 'jcas_sync') o JWT de usuario SRL.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { exigirRol } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { BASE_JCAS, depuraPunto, diasCompletos, FormatoJcasError, hoyConservador, LIMITES_MES, parseEstaciones, parseSerie, puntoParcial } from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const UA = "SICA005-jcas-sync/1.0 (monitoreo DR-005 Delicias; contexto de cuenca, 2 corridas al dia)";
const PAUSA_MS = 1000;
const MAX_ESTACIONES = 20;
const PRESUPUESTO_MS = 100_000; // la página anual tarda ~7 s por estación: se corta antes del límite de la función y se reanuda
const MIN_VIGENTES_PCT = 60; // alerta de red si menos de este % de estaciones sincronizadas tiene dato de ≤ 3 días

async function pedir(ruta: string): Promise<Response> {
  const r = await fetch(`${BASE_JCAS}${ruta}`, { headers: { "User-Agent": UA, "Accept-Language": "es-MX" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta}`);
  return r;
}
const pausa = () => new Promise((r) => setTimeout(r, PAUSA_MS));

async function gestionarAlerta(sb: Sb, origen: string, activa: boolean, titulo: string, mensaje: string) {
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (activa && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({ tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen, titulo, mensaje });
  } else if (!activa && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() }).eq("origen_id", origen).eq("resuelta", false);
  }
}

/** Actualiza nombre/coordenadas/estado de lo ya catalogado; las estaciones nuevas entran como zona 'fuera' y sin sincronizar
 *  (la zona se calcula contra el contorno con scripts/jcas_generar_seed.mjs, no aquí). */
async function sincronizaCatalogo(sb: Sb) {
  const est = parseEstaciones(await (await pedir("/maps/get/estaciones")).json());
  const { data: previas } = await sb.from("jcas_estaciones").select("id_jcas");
  const conocidas = new Set<number>((previas ?? []).map((r: { id_jcas: number }) => r.id_jcas));
  let nuevas = 0;
  for (const e of est) {
    const campos = {
      nombre: e.nombre, latitud: e.latitud, longitud: e.longitud, altitud_m: e.altitud_m,
      tiene_pluviometro: e.tienePluviometro, activa: e.activa, actualizada_portal: e.actualizada,
    };
    if (conocidas.has(e.id)) {
      const { error } = await sb.from("jcas_estaciones").update(campos).eq("id_jcas", e.id);
      if (error) throw new Error(`catálogo ${e.id}: ${error.message}`);
    } else {
      const { error } = await sb.from("jcas_estaciones").insert({ id_jcas: e.id, ...campos, zona: "fuera", sincronizar: false });
      if (error) throw new Error(`catálogo nuevo ${e.id}: ${error.message}`);
      nuevas++;
    }
  }
  return { estaciones: est.length, nuevas };
}

async function modoSerie(sb: Sb, modo: "diario" | "anio" | "hoy", ids: number[] | undefined, t0: number, forzar: boolean) {
  let q = sb.from("jcas_estaciones").select("id_jcas, nombre, tiene_pluviometro").eq("sincronizar", true).order("id_jcas");
  if (ids?.length) q = q.in("id_jcas", ids);
  const { data: lista, error } = await q.limit(MAX_ESTACIONES);
  if (error) throw new Error(`estaciones: ${error.message}`);

  const ref = new Date();
  const r = { estaciones: 0, filas: 0, descartes: 0, errores: [] as string[], formato: 0, pendientes: 0 };
  // Modo anual reanudable: se saltan las estaciones ya cargadas en los últimos 3 días (el cron lo llama dos veces).
  const hechas = new Set<number>();
  if (modo === "anio" && !forzar) {
    const { data: rec } = await sb.from("jcas_lecturas_mensuales").select("estacion_id").gte("ingestado_en", new Date(Date.now() - 3 * 86_400_000).toISOString()).limit(2000);
    for (const x of (rec ?? []) as { estacion_id: number }[]) hechas.add(x.estacion_id);
  }
  for (const e of (lista ?? []) as { id_jcas: number; nombre: string; tiene_pluviometro: boolean }[]) {
    if (hechas.has(e.id_jcas)) continue;
    if (modo === "anio" && Date.now() - t0 > PRESUPUESTO_MS) { r.pendientes++; continue; }
    try {
      const html = await (await pedir(`/estacion/view/${e.id_jcas}?mode=${modo === "anio" ? "year" : "month"}`)).text();
      const serie = parseSerie(html, ref);
      if (serie.modo !== (modo === "anio" ? "anio" : "mes")) throw new FormatoJcasError(`modo inesperado "${serie.modo}"`);
      let registros: Record<string, unknown>[];
      if (modo === "hoy" || modo === "diario") {
        // Día en curso (parcial): tabla aparte, una fila por estación. Nunca entra a las lecturas diarias completas.
        const parcial = puntoParcial(serie.puntos, ref, e.tiene_pluviometro);
        if (parcial) {
          const { error: eH } = await sb.from("jcas_lecturas_hoy").upsert({
            estacion_id: e.id_jcas, fecha: parcial.fecha, temp_c: parcial.punto.temp_c, hum_pct: parcial.punto.hum_pct,
            viento_kmh: parcial.punto.viento_kmh, lluvia_mm: parcial.punto.lluvia_mm, actualizado_en: ref.toISOString(),
          }, { onConflict: "estacion_id" });
          if (eH) throw new Error(`hoy: ${eH.message}`);
        }
      }
      if (modo === "hoy") {
        registros = [];
      } else if (modo === "diario") {
        const dias = diasCompletos(serie.puntos, ref, e.tiene_pluviometro);
        registros = dias.map(({ fecha, punto: p }) => ({
          estacion_id: e.id_jcas, fecha, temp_c: p.temp_c, hum_pct: p.hum_pct, viento_kmh: p.viento_kmh,
          presion_hpa: p.presion_hpa, rocio_c: p.rocio_c, lluvia_mm: p.lluvia_mm, ingestado_en: ref.toISOString(),
        }));
        for (const p of serie.puntos) if (p.clave < hoyConservador(ref)) r.descartes += depuraPunto(p, e.tiene_pluviometro).descartados.length;
        const { error: eU } = registros.length
          ? await sb.from("jcas_lecturas_diarias").upsert(registros, { onConflict: "estacion_id,fecha" })
          : { error: null };
        if (eU) throw new Error(eU.message);
        const ult = registros.length ? String(registros[registros.length - 1].fecha) : null;
        await sb.from("jcas_estaciones").update({ ult_sync_en: ref.toISOString(), ...(ult ? { ult_fecha: ult } : {}) }).eq("id_jcas", e.id_jcas);
      } else {
        const mesActual = hoyConservador(ref).slice(0, 7); // YYYY-MM: el mes en curso es parcial y se omite
        registros = serie.puntos.filter((p) => p.clave < mesActual).map((p) => {
          const d = depuraPunto(p, e.tiene_pluviometro, LIMITES_MES);
          r.descartes += d.descartados.length;
          return { estacion_id: e.id_jcas, mes: `${p.clave}-01`, temp_c: d.punto.temp_c, hum_pct: d.punto.hum_pct, viento_kmh: d.punto.viento_kmh,
            presion_hpa: d.punto.presion_hpa, rocio_c: d.punto.rocio_c, lluvia_mm: d.punto.lluvia_mm, ingestado_en: ref.toISOString() };
        });
        const { error: eU } = registros.length
          ? await sb.from("jcas_lecturas_mensuales").upsert(registros, { onConflict: "estacion_id,mes" })
          : { error: null };
        if (eU) throw new Error(eU.message);
      }
      r.estaciones++;
      r.filas += registros.length;
    } catch (err) {
      if (err instanceof FormatoJcasError) r.formato++;
      r.errores.push(`${e.nombre}: ${(err as Error).message}`);
    }
    await pausa();
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  let modo: "diario" | "anio" | "catalogo" | "hoy" = "diario";
  try {
    const auth = await exigirRol(req, ["SRL"], { nombreSecreto: "jcas_sync" }, sb);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    modo = body?.modo === "anio" ? "anio" : body?.modo === "catalogo" ? "catalogo" : body?.modo === "hoy" ? "hoy" : "diario";
    const ids = Array.isArray(body?.estaciones) ? body.estaciones.map(Number).filter(Number.isInteger) : undefined;

    let cat: { estaciones: number; nuevas: number } | null = null;
    try {
      cat = await sincronizaCatalogo(sb);
      await gestionarAlerta(sb, "JCAS-FORMATO", false, "", "");
    } catch (e) {
      if (e instanceof FormatoJcasError) {
        await gestionarAlerta(sb, "JCAS-FORMATO", true, "JCAS: la lista de estaciones cambió de formato",
          `El portal proyectojcas.uacj.mx devolvió un formato inesperado (${e.message}). Se conserva lo ya cargado y la red JCAS se muestra como S/D.`);
      }
      throw e;
    }
    const s = modo === "catalogo" ? { estaciones: 0, filas: 0, descartes: 0, errores: [] as string[], formato: 0, pendientes: 0 } : await modoSerie(sb, modo, ids, t0, body?.forzar === true);

    if (modo !== "catalogo") {
      await gestionarAlerta(sb, "JCAS-FORMATO", s.formato > 0 && s.formato >= Math.max(1, Math.ceil((s.estaciones + s.errores.length) / 2)),
        "JCAS: las páginas de estación cambiaron de formato",
        `${s.formato} estación(es) devolvieron series ilegibles (${s.errores.slice(0, 2).join("; ")}). No se guardó nada de ellas.`);
    }
    if (modo === "diario") {
      const { data: v } = await sb.from("v_jcas_estado").select("vigente").eq("sincronizar", true);
      const total = (v ?? []).length, buenas = (v ?? []).filter((x: { vigente: boolean }) => x.vigente).length;
      await gestionarAlerta(sb, "JCAS-RED", total > 0 && (buenas / total) * 100 < MIN_VIGENTES_PCT,
        "JCAS: red de la cuenca con pocos datos recientes",
        `Solo ${buenas} de ${total} estaciones JCAS de la cuenca tienen dato de los últimos 3 días. La precipitación areal puede quedar S/D.`);
    }

    await sb.from("jcas_sync_log").insert({
      modo, ok: s.errores.length === 0, estaciones: s.estaciones, filas: s.filas, descartes: s.descartes,
      error: s.errores.length ? s.errores.slice(0, 5).join(" | ") : null, duracion_ms: Date.now() - t0,
    });
    return json({ ok: true, modo, catalogo: cat, ...s });
  } catch (e) {
    await sb.from("jcas_sync_log").insert({ modo, ok: false, error: (e as Error).message, duracion_ms: Date.now() - t0 });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
