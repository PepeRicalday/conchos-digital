// ═══════════════════════════════════════════════════════════════════════════
// unifrut-sync — Red de Estaciones Meteorológicas (REM) de UNIFRUT A.C., Cuauhtémoc, Chih. (contexto regional, fuente TERCERA)
// ---------------------------------------------------------------------------
// Portal https://www.unifrut.com.mx/rem/ (sin API; autorizado por UNIFRUT). SOLO se leen dos endpoints POST públicos:
//   /rem/includes/getReport.php  (reporte diario "General" y horario "Hora")  ·  /rem/includes/getInfo.php (catálogo, solo modo catalogo)
// NUNCA se usa getTable.php (tiempo real): hoy devuelve "---" en toda la red.
// Cortesía: User-Agent identificable, una petición a la vez con pausa de 1 s, ≤ 30 estaciones, cron 1 vez al día.
// Nada de esto toca clima_estaciones / clima_estacion_lecturas (WeatherLink) ni jcas_*, ni los KPIs del distrito.
// Modos (body.modo): "diario" (default) últimos 14 días completos · "anio" un año completo (body.anio, default el actual; backfill reanudable por
//                    body.estaciones) · "horario" últimas ~48 h de las estaciones vigentes · "catalogo" refresca nombre/coordenadas/altitud.
//                    Opcional body.estaciones = ["_qtl", …]. El día en curso nunca entra a unifrut_lecturas_diarias (solo días completos).
// El servidor trunca los rangos multianuales: UNA consulta nunca cruza de año (se parte en dos).
// Estricto: si el HTML cambia (FormatoUnifrutError) no se guarda nada de esa estación y se levanta la alerta UNIFRUT-FORMATO.
// S/D = NULL, nunca 0. Datos provisionales.
// Auth: x-cron-secret (cron_secretos 'unifrut_sync') o JWT de usuario SRL.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { exigirRol } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  BASE_UNIFRUT, diasCompletos, FormatoUnifrutError, hoyChihuahua, parseDiario, parseHorario, parseInfo, radWm2, tieneDato,
} from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const UA = "SICA005-unifrut-sync/1.0 (monitoreo DR-005 Delicias; contexto regional, 1 corrida al dia)";
const PAUSA_MS = 1000;
const MAX_ESTACIONES = 30;
const PRESUPUESTO_MS = 110_000;
const MIN_VIGENTES = 3; // alerta de red si hay menos estaciones vigentes que esto (hoy solo 4-5 reportan)
const DIAS_DIARIO = 14;
const redondea = (v: number | null, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

async function pedir(ruta: string, cuerpo: Record<string, string>): Promise<string> {
  const r = await fetch(`${BASE_UNIFRUT}/${ruta}`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Accept-Language": "es-MX" },
    body: new URLSearchParams(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta}`);
  return await r.text();
}
const reporte = (id: string, ini: string, fin: string, ident: "General" | "Hora") =>
  pedir("getReport.php", { info: [ini, fin, ident, "Rango", id].join("|") });
const pausa = () => new Promise((r) => setTimeout(r, PAUSA_MS));
const sumaDias = (f: string, n: number) => new Date(Date.parse(f + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

async function gestionarAlerta(sb: Sb, origen: string, activa: boolean, titulo: string, mensaje: string) {
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (activa && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({ tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen, titulo, mensaje });
  } else if (!activa && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() }).eq("origen_id", origen).eq("resuelta", false);
  }
}

/** Refresca nombre/coordenadas/altitud de lo ya catalogado. No crea estaciones nuevas: la zona se calcula con scripts/unifrut_generar_seed.mjs. */
async function sincronizaCatalogo(sb: Sb, ids: string[]) {
  let n = 0;
  for (const id of ids) {
    const i = parseInfo(await pedir("getInfo.php", { id_tab: id }));
    const { error } = await sb.from("unifrut_estaciones").update({
      nombre: i.nombre, municipio: i.municipio, tipo: i.tipo, latitud: i.latitud, longitud: i.longitud, altitud_m: i.altitud_m,
    }).eq("id_unifrut", id);
    if (error) throw new Error(`catálogo ${id}: ${error.message}`);
    n++;
    await pausa();
  }
  return n;
}

type Est = { id_unifrut: string; nombre: string; tipo: string };

async function modoSerie(sb: Sb, modo: "diario" | "anio" | "horario", ids: string[] | undefined, t0: number, anio: number) {
  let q = sb.from("unifrut_estaciones").select("id_unifrut, nombre, tipo, ult_fecha").eq("sincronizar", true).order("id_unifrut");
  if (ids?.length) q = q.in("id_unifrut", ids);
  const { data: lista, error } = await q.limit(MAX_ESTACIONES);
  if (error) throw new Error(`estaciones: ${error.message}`);

  const ref = new Date();
  const hoy = hoyChihuahua(ref);
  const r = { estaciones: 0, filas: 0, descartes: 0, errores: [] as string[], formato: 0, pendientes: 0 };
  for (const e of (lista ?? []) as (Est & { ult_fecha: string | null })[]) {
    if (Date.now() - t0 > PRESUPUESTO_MS) { r.pendientes++; continue; }
    try {
      if (modo === "horario") {
        // Solo estaciones con dato reciente: no se piden horas a equipos apagados.
        if (!e.ult_fecha || sumaDias(e.ult_fecha, 7) < hoy) continue;
        const html = await reporte(e.id_unifrut, sumaDias(hoy, -2), hoy, "Hora");
        const { puntos, descartes } = parseHorario(html, e.tipo);
        r.descartes += descartes;
        const filas = puntos
          .map((p) => {
            // 24:00 = 00:00 del día siguiente. Chihuahua es UTC−6 todo el año (sin horario de verano desde 2022).
            const ts = new Date(Date.parse(`${p.fecha}T00:00:00Z`) + (p.hora + 6) * 3_600_000);
            return { p, ts };
          })
          .filter(({ ts }) => ts.getTime() <= ref.getTime()) // nunca horas futuras
          .map(({ p, ts }) => ({
            estacion_id: e.id_unifrut, ts: ts.toISOString(), temp_c: p.temp_c, hr_pct: p.hr_pct, rocio_c: p.rocio_c,
            viento_kmh: p.viento_kmh, viento_max_kmh: p.viento_max_kmh, viento_dir_deg: p.viento_dir_deg, lluvia_mm: p.lluvia_mm,
            eto_mm: p.eto_mm, rad_wm2: radWm2(p.rad_kwm2, e.tipo), presion_hpa: p.presion_kpa == null ? null : redondea(p.presion_kpa * 10, 1),
            ingestado_en: ref.toISOString(),
          }))
          .filter((f) => [f.temp_c, f.hr_pct, f.viento_kmh, f.rad_wm2, f.presion_hpa].some((v) => v != null));
        if (filas.length) {
          const { error: eH } = await sb.from("unifrut_lecturas_horarias").upsert(filas, { onConflict: "estacion_id,ts" });
          if (eH) throw new Error(`horario: ${eH.message}`);
        }
        r.estaciones++; r.filas += filas.length;
        await pausa();
        continue;
      }

      // Rango de fechas: diario = últimos 14 días; anio = año completo (parcial si es el actual). Nunca cruza de año por consulta.
      const ini = modo === "anio" ? `${anio}-01-01` : sumaDias(hoy, -DIAS_DIARIO);
      const fin = modo === "anio" ? (anio === Number(hoy.slice(0, 4)) ? hoy : `${anio}-12-31`) : hoy;
      const tramos: [string, string][] = ini.slice(0, 4) === fin.slice(0, 4)
        ? [[ini, fin]]
        : [[ini, `${ini.slice(0, 4)}-12-31`], [`${fin.slice(0, 4)}-01-01`, fin]];
      const dias = [];
      for (const [a, b] of tramos) {
        const { puntos, descartes } = parseDiario(await reporte(e.id_unifrut, a, b, "General"), e.tipo);
        r.descartes += descartes;
        dias.push(...diasCompletos(puntos, ref).filter(tieneDato));
        if (tramos.length > 1) await pausa();
      }
      const registros = dias.map((p) => ({
        estacion_id: e.id_unifrut, fecha: p.fecha, tmax_c: p.tmax_c, tmax_hora: p.tmax_hora, tmin_c: p.tmin_c, tmin_hora: p.tmin_hora, tmed_c: p.tmed_c,
        hr_max_pct: p.hr_max_pct, hr_min_pct: p.hr_min_pct, viento_kmh: p.viento_kmh, viento_max_kmh: p.viento_max_kmh,
        viento_dir: p.viento_dir, viento_dir_deg: p.viento_dir_deg, rad_wm2: radWm2(p.rad_kwm2, e.tipo), lluvia_mm: p.lluvia_mm, eto_mm: p.eto_mm,
        ingestado_en: ref.toISOString(),
      }));
      // Lotes de 500: el backfill anual de una estación son ~365 filas.
      for (let i = 0; i < registros.length; i += 500) {
        const { error: eU } = await sb.from("unifrut_lecturas_diarias").upsert(registros.slice(i, i + 500), { onConflict: "estacion_id,fecha" });
        if (eU) throw new Error(eU.message);
      }
      // ult_fecha solo avanza (un backfill de un año viejo no debe retrocederla).
      const ult = registros.length ? registros.map((x) => x.fecha).sort().pop()! : null;
      const patch: Record<string, unknown> = { ult_sync_en: ref.toISOString() };
      if (ult && (!e.ult_fecha || ult > e.ult_fecha)) patch.ult_fecha = ult;
      await sb.from("unifrut_estaciones").update(patch).eq("id_unifrut", e.id_unifrut);
      r.estaciones++; r.filas += registros.length;
    } catch (err) {
      if (err instanceof FormatoUnifrutError) r.formato++;
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
  let modo: "diario" | "anio" | "horario" | "catalogo" = "diario";
  try {
    const auth = await exigirRol(req, ["SRL"], { nombreSecreto: "unifrut_sync" }, sb);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    modo = body?.modo === "anio" ? "anio" : body?.modo === "horario" ? "horario" : body?.modo === "catalogo" ? "catalogo" : "diario";
    const ids: string[] | undefined = Array.isArray(body?.estaciones)
      ? body.estaciones.map(String).filter((s: string) => /^_[a-z0-9]{3}$/.test(s))
      : undefined;
    const anio = Number.isInteger(body?.anio) && body.anio >= 2010 && body.anio <= 2100 ? body.anio : Number(hoyChihuahua(new Date()).slice(0, 4));

    let s = { estaciones: 0, filas: 0, descartes: 0, errores: [] as string[], formato: 0, pendientes: 0 };
    if (modo === "catalogo") {
      const { data } = await sb.from("unifrut_estaciones").select("id_unifrut").order("id_unifrut");
      const todas = ((data ?? []) as { id_unifrut: string }[]).map((x) => x.id_unifrut).filter((x) => !ids || ids.includes(x));
      s.estaciones = await sincronizaCatalogo(sb, todas);
    } else {
      s = await modoSerie(sb, modo, ids, t0, anio);
    }

    if (modo !== "catalogo") {
      await gestionarAlerta(sb, "UNIFRUT-FORMATO", s.formato > 0 && s.formato >= Math.max(1, Math.ceil((s.estaciones + s.errores.length) / 2)),
        "UNIFRUT: los reportes de estación cambiaron de formato",
        `${s.formato} estación(es) devolvieron tablas ilegibles (${s.errores.slice(0, 2).join("; ")}). No se guardó nada de ellas.`);
    }
    if (modo === "diario") {
      const { data: v } = await sb.from("v_unifrut_estado").select("vigente").eq("sincronizar", true);
      const buenas = (v ?? []).filter((x: { vigente: boolean }) => x.vigente).length;
      await gestionarAlerta(sb, "UNIFRUT-RED", (v ?? []).length > 0 && buenas < MIN_VIGENTES,
        "UNIFRUT: red regional con pocas estaciones reportando",
        `Solo ${buenas} estación(es) UNIFRUT tienen dato de los últimos 3 días (se esperaban ≥ ${MIN_VIGENTES}). Es contexto regional; no afecta los KPIs del distrito.`);
    }

    await sb.from("unifrut_sync_log").insert({
      modo, ok: s.errores.length === 0, estaciones: s.estaciones, filas: s.filas, descartes: s.descartes,
      error: s.errores.length ? s.errores.slice(0, 5).join(" | ") : null, duracion_ms: Date.now() - t0,
    });
    return json({ ok: true, modo, ...s });
  } catch (e) {
    await sb.from("unifrut_sync_log").insert({ modo, ok: false, error: (e as Error).message, duracion_ms: Date.now() - t0 });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
