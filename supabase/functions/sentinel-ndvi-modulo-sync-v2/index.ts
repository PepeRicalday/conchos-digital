// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndvi-modulo-sync-v2 — NDVI mensual por módulo, metodología homogénea
// ---------------------------------------------------------------------------
// Hermana de sentinel-ndvi-modulo-sync (que sigue activa e intacta y escribe
// ndvi_modulo_historico). Esta v2 existe para construir una serie INTERANUAL
// comparable (marzo 2021 → hoy) con UNA sola metodología, escrita en
// ndvi_modulo_mensual_v2. Diferencias contra la v1:
//
//   1. Máscara por píxel con la clasificación de escena SCL: se descartan
//      sombra de nube (3), nube media/alta (8, 9), cirro (10), nieve (11) y
//      saturados/defectuosos (1). La v1 solo filtraba escenas completas
//      (maxCloudCoverage) y la sombra/cirro dentro de escenas "limpias"
//      contaminaba la media.
//   2. Composición por MEDIANA por píxel de todas las observaciones válidas
//      del mes (mosaicking ORBIT), no "el píxel más reciente".
//   3. Resolución explícita (resolucion_m, 20 m por defecto) en vez de la
//      rejilla 256×256 que la API fija sola sobre el bbox.
//   4. Indicadores de calidad: n_escenas (escenas Sentinel-2 que cubren el
//      mes), obs_media_pixel (observaciones válidas por píxel) y
//      pct_pixeles_validos. Un mes sin dato útil NO se guarda con NDVI 0:
//      se guarda con ndvi_mediana=NULL (hueco explícito).
//   5. delta_ndvi NO se calcula aquí (depende del orden de carga): la vista
//      ndvi_modulo_mensual_v2_delta lo deriva en SQL.
//
// Invocación: POST { mes: "2021-03", numero_modulo?: n, resolucion_m?: 20,
//                    dry_run?: true }
//   dry_run: calcula y devuelve, sin escribir en la BD (validación F0).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MODULOS_SRL_GEOMETRY, NOMBRES_MODULO_SRL, type GeoJSONPolygon, type GeoJSONMultiPolygon } from "./modulosGeometry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SentinelProvider = "classic" | "cdse";

const ENDPOINTS: Record<SentinelProvider, { oauth: string; statistics: string; catalog: string }> = {
  classic: {
    oauth: "https://services.sentinel-hub.com/oauth/token",
    statistics: "https://services.sentinel-hub.com/api/v1/statistics",
    catalog: "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search",
  },
  cdse: {
    oauth: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    statistics: "https://sh.dataspace.copernicus.eu/api/v1/statistics",
    catalog: "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search",
  },
};

function resolverProvider(): SentinelProvider {
  const raw = (Deno.env.get("SENTINEL_PROVIDER") || "classic").trim().toLowerCase();
  return raw === "cdse" ? "cdse" : "classic";
}

const METODO = "scl-mediana-v1";
const MAX_CLOUD_COVERAGE = 60; // laxo a nivel de escena: la máscara SCL limpia por píxel
const UMBRAL_COBERTURA_ACTIVA = 0.30;
const RESOLUCION_DEFECTO_M = 20;
const MAX_PX_LADO = 1500; // tope conservador por lado del bbox; se sube resolución si se excede

async function obtenerAccessToken(provider: SentinelProvider, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(ENDPOINTS[provider].oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!r.ok) throw new Error(`OAuth token HTTP ${r.status}: ${await r.text()}`);
  const token = (await r.json())?.access_token;
  if (!token) throw new Error("OAuth: respuesta sin access_token");
  return token;
}

// Timeout + reintento solo sobre códigos transitorios (429/5xx); un 400
// (geometría/evalscript inválido) fallaría igual siempre.
async function fetchConReintento(url: string, init: RequestInit, intentos = 3): Promise<Response> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimoError = new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    } catch (err) {
      ultimoError = err;
    }
    if (intento < intentos) await new Promise((res) => setTimeout(res, 1000 * 2 ** (intento - 1)));
  }
  throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

// Clases SCL excluidas: 0 sin dato, 1 saturado/defectuoso, 3 sombra de nube,
// 8 nube prob. media, 9 nube prob. alta, 10 cirro, 11 nieve/hielo. Se
// conservan 4 vegetación, 5 suelo desnudo, 7 sin clasificar, 2 zonas oscuras
// y 6 agua (el agua baja el NDVI medio igual que en la v1 y en la serie
// 2026: se mantiene para que la frontera del módulo sea comparable).
const EVALSCRIPT_NDVI_SCL = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    mosaicking: "ORBIT",
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "activo", bands: 1, sampleType: "FLOAT32" },
      { id: "nobs", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" },
    ],
  };
}
function valida(s) {
  if (!s.dataMask) return false;
  const c = s.SCL;
  return !(c === 0 || c === 1 || c === 3 || c === 8 || c === 9 || c === 10 || c === 11);
}
function evaluatePixel(samples) {
  const v = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!valida(s)) continue;
    v.push((s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001));
  }
  if (v.length === 0) {
    return { ndvi: [0], activo: [0], nobs: [0], dataMask: [0] };
  }
  v.sort(function (a, b) { return a - b; });
  const m = v.length >> 1;
  const med = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  return { ndvi: [med], activo: [med >= ${UMBRAL_COBERTURA_ACTIVA} ? 1 : 0], nobs: [v.length], dataMask: [1] };
}
`;

function areaHaAnillo(ring: number[][], mPorGradoLon: number, mPorGradoLat: number): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    s += x0 * mPorGradoLon * y1 * mPorGradoLat - x1 * mPorGradoLon * y0 * mPorGradoLat;
  }
  return Math.abs(s) / 2 / 10_000;
}

function extension(geom: GeoJSONPolygon | GeoJSONMultiPolygon) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const pts = polys.flatMap((p) => p[0]);
  const lons = pts.map((c) => c[0]), lats = pts.map((c) => c[1]);
  const latMedia = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mLon = 111_320 * Math.cos(latMedia * Math.PI / 180);
  const mLat = 110_574;
  return {
    polys, mLon, mLat,
    anchoM: (Math.max(...lons) - Math.min(...lons)) * mLon,
    altoM: (Math.max(...lats) - Math.min(...lats)) * mLat,
  };
}

function calcularSuperficieHa(geom: GeoJSONPolygon | GeoJSONMultiPolygon): number {
  const { polys, mLon, mLat } = extension(geom);
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const ha = areaHaAnillo(ring, mLon, mLat);
      total += i === 0 ? ha : -ha;
    });
  }
  return total;
}

function ndviAKc(ndvi: number): number {
  return Math.max(0.15, Math.min(1.05, +(0.15 + 1.10 * ndvi).toFixed(2)));
}

const r4 = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Number(x.toFixed(4)) : null);

// Escenas Sentinel-2 L2A que cubren el polígono en el mes (Catalog API, solo
// conteo). Si falla no bloquea el cálculo: n_escenas queda NULL.
async function contarEscenas(provider: SentinelProvider, token: string, geom: GeoJSONPolygon | GeoJSONMultiPolygon, desde: Date, hasta: Date): Promise<number | null> {
  try {
    const r = await fetchConReintento(ENDPOINTS[provider].catalog, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        collections: ["sentinel-2-l2a"],
        datetime: `${desde.toISOString()}/${hasta.toISOString()}`,
        intersects: geom,
        limit: 100,
        filter: `eo:cloud_cover < ${MAX_CLOUD_COVERAGE}`,
        "filter-lang": "cql2-text",
      }),
    });
    if (!r.ok) { avisoCatalogo = `Catalog HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`; return null; }
    const j = await r.json();
    // La API no devuelve "matched": se cuentan las FECHAS de paso distintas
    // (un mismo paso puede cubrir el módulo con varios tiles).
    const feats: any[] = j?.features;
    if (!Array.isArray(feats)) { avisoCatalogo = `Catalog sin features: ${JSON.stringify(j).slice(0, 300)}`; return null; }
    if (feats.length >= 100) avisoCatalogo = "Catalog: tope de 100 resultados alcanzado, n_escenas subestimado";
    return new Set(feats.map((f) => String(f?.properties?.datetime ?? "").slice(0, 10)).filter(Boolean)).size;
  } catch (e) {
    avisoCatalogo = `Catalog error: ${String(e).slice(0, 300)}`;
    return null;
  }
}
let avisoCatalogo: string | undefined;

interface ResultadoModulo {
  numero_modulo: number;
  nombre_modulo: string;
  insertado: boolean;
  mensaje?: string;
  ndvi_mediana?: number | null;
  n_escenas?: number | null;
  resolucion_efectiva_m?: number;
  fila?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const provider = resolverProvider();
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Autorización: la función escribe con service role y gasta cuota de Copernicus,
    // y la anon key es pública. Pasa solo (a) el cron, con el secreto compartido de
    // public.cron_secretos (cabecera x-cron-secret), o (b) un usuario con sesión
    // real de la app (JWT de usuario; la anon key no es un usuario y se rechaza).
    const secretoCron = req.headers.get("x-cron-secret");
    let autorizado = false;
    if (secretoCron) {
      const { data: s } = await supabase.from("cron_secretos").select("valor").eq("nombre", "ndvi_sync_v2").maybeSingle();
      autorizado = !!s?.valor && s.valor === secretoCron;
    }
    if (!autorizado) {
      const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (jwt) {
        const { data: u } = await supabase.auth.getUser(jwt);
        autorizado = !!u?.user?.id;
      }
    }
    if (!autorizado) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const moduloParam: number | undefined = Number.isFinite(Number(body?.numero_modulo)) ? Number(body.numero_modulo) : undefined;
    // Resolución acotada: por debajo de 10 m no hay información nueva y por encima de 60 m se pierde el borde del módulo.
    const resolucionSolicitada = Number.isFinite(Number(body?.resolucion_m)) ? Math.min(60, Math.max(10, Number(body.resolucion_m))) : RESOLUCION_DEFECTO_M;

    const modulosAProcesar = moduloParam !== undefined ? [moduloParam] : Object.keys(MODULOS_SRL_GEOMETRY).map(Number);
    const invalidos = modulosAProcesar.filter((m) => !(m in MODULOS_SRL_GEOMETRY));
    if (invalidos.length) return json({ error: `Módulo(s) sin geometría: ${invalidos.join(", ")}` }, 400);

    // Ventana: mes calendario explícito, o mes calendario anterior (cron).
    let inicio: Date, fin: Date, mes: string;
    const mesParam: string | undefined = body?.mes;
    if (mesParam !== undefined && mesParam !== null) {
      // Mes válido (01–12), desde el inicio de la serie Sentinel-2 L2A usada (2021-03) y ya cerrado.
      const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mesParam));
      const [anio, mesNum] = ok ? String(mesParam).split("-").map(Number) : [0, 0];
      const hoyUtc = new Date();
      const primeroMesActual = Date.UTC(hoyUtc.getUTCFullYear(), hoyUtc.getUTCMonth(), 1);
      if (!ok || Date.UTC(anio, mesNum - 1, 1) < Date.UTC(2021, 2, 1) || Date.UTC(anio, mesNum - 1, 1) >= primeroMesActual) {
        return json({ error: "mes inválido: usa AAAA-MM entre 2021-03 y el último mes cerrado" }, 400);
      }
      inicio = new Date(Date.UTC(anio, mesNum - 1, 1));
      fin = new Date(Date.UTC(anio, mesNum, 1));
      mes = String(mesParam);
    } else {
      const hoy = new Date();
      fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
      inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
      mes = `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    const diasVentana = Math.round((fin.getTime() - inicio.getTime()) / 86400000);

    const token = await obtenerAccessToken(provider, CLIENT_ID, CLIENT_SECRET);
    const resultados: ResultadoModulo[] = [];

    for (const numeroModulo of modulosAProcesar) {
      const geom = MODULOS_SRL_GEOMETRY[numeroModulo];
      const nombreModulo = NOMBRES_MODULO_SRL[numeroModulo] ?? `Módulo ${numeroModulo}`;
      try {
        const ext = extension(geom);
        // Sube la resolución si el bbox excedería MAX_PX_LADO píxeles por lado.
        const resEfectiva = Math.max(resolucionSolicitada, Math.ceil(Math.max(ext.anchoM, ext.altoM) / MAX_PX_LADO));
        const resx = resEfectiva / ext.mLon;
        const resy = resEfectiva / ext.mLat;
        const superficieHa = Number(calcularSuperficieHa(geom).toFixed(2));

        const reqBody = {
          input: {
            bounds: { geometry: geom, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
            data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: MAX_CLOUD_COVERAGE, mosaickingOrder: "mostRecent" } }],
          },
          aggregation: {
            timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
            aggregationInterval: { of: `P${diasVentana}D` },
            evalscript: EVALSCRIPT_NDVI_SCL,
            resx, resy,
          },
          calculations: {
            ndvi: { statistics: { default: { percentiles: { k: [10, 50, 90] } } } },
          },
        };

        const r = await fetchConReintento(ENDPOINTS[provider].statistics, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(reqBody),
        });
        if (!r.ok) {
          resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: `Statistical API HTTP ${r.status}: ${await r.text()}` });
          continue;
        }
        const stats = await r.json();
        const intervals: any[] = stats?.data ?? [];
        const iv = intervals.find((x) => (x?.outputs?.ndvi?.bands?.B0?.stats?.sampleCount ?? 0) > 0) ?? intervals[0];
        const sNdvi = iv?.outputs?.ndvi?.bands?.B0?.stats;
        const validos = sNdvi ? (sNdvi.sampleCount ?? 0) - (sNdvi.noDataCount ?? 0) : 0;
        const pxEsperados = (superficieHa * 10_000) / (resEfectiva * resEfectiva);
        avisoCatalogo = undefined;
        const nEscenas = await contarEscenas(provider, token, geom, inicio, fin);

        const hayDato = !!sNdvi && validos > 0 && Number.isFinite(sNdvi.mean);
        const perc = sNdvi?.percentiles ?? {};
        const pk = (k: number) => perc[`${k}.0`] ?? perc[String(k)] ?? null;
        const activo = iv?.outputs?.activo?.bands?.B0?.stats?.mean;
        const nobs = iv?.outputs?.nobs?.bands?.B0?.stats?.mean;

        const fila = {
          numero_modulo: numeroModulo,
          nombre_modulo: nombreModulo,
          mes,
          metodo: METODO,
          ventana_desde: inicio.toISOString(),
          ventana_hasta: fin.toISOString(),
          ndvi_mediana: hayDato ? r4(pk(50) ?? sNdvi.mean) : null,
          ndvi_medio: hayDato ? r4(sNdvi.mean) : null,
          ndvi_min: hayDato ? r4(sNdvi.min) : null,
          ndvi_max: hayDato ? r4(sNdvi.max) : null,
          ndvi_desv: hayDato ? r4(sNdvi.stDev) : null,
          ndvi_p10: hayDato ? r4(pk(10)) : null,
          ndvi_p90: hayDato ? r4(pk(90)) : null,
          fraccion_cobertura_activa: hayDato ? r4(activo) : null,
          muestras_validas: validos,
          // Contra los píxeles esperados dentro del polígono (área/res²), no
          // contra el bbox: sampleCount incluye el rectángulo completo.
          pct_pixeles_validos: pxEsperados > 0 ? r4(Math.min(1, validos / pxEsperados)) : null,
          n_escenas: nEscenas,
          obs_media_pixel: hayDato ? r4(nobs) : null,
          nubosidad_max_pct: MAX_CLOUD_COVERAGE,
          resolucion_m: resEfectiva,
          superficie_ha: superficieHa,
          kc_estimado: hayDato ? ndviAKc(sNdvi.mean) : null,
          proveedor: provider,
          fuente_geometria: "poligono_exacto",
        };

        if (!dryRun) {
          const { error: eUpsert } = await supabase.from("ndvi_modulo_mensual_v2").upsert(fila, { onConflict: "numero_modulo,mes,metodo" });
          if (eUpsert) {
            resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: `Upsert falló: ${eUpsert.message}` });
            continue;
          }
        }
        resultados.push({
          numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: !dryRun,
          ndvi_mediana: fila.ndvi_mediana, n_escenas: nEscenas, resolucion_efectiva_m: resEfectiva,
          mensaje: hayDato ? avisoCatalogo : "Sin píxeles válidos tras máscara SCL (hueco explícito, NDVI=NULL)",
          ...(dryRun ? { fila } : {}),
        });
      } catch (errModulo) {
        resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: String(errModulo) });
      }
    }

    // 200 todo bien, 207 algún fallo, 500 todos fallaron. En dry_run no hay
    // inserciones: se evalúa por ausencia de error (mensaje de error de API/red).
    const fallidos = resultados.filter((r) => (dryRun ? !!r.mensaje && !r.fila : !r.insertado));
    const status = fallidos.length === 0 ? 200 : fallidos.length === resultados.length ? 500 : 207;
    return json({ ok: fallidos.length !== resultados.length, provider, metodo: METODO, dry_run: dryRun, mes, resultados }, status);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
