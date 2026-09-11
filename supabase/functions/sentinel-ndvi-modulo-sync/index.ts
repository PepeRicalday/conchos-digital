// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndvi-modulo-sync — NDVI mensual histórico por módulo (polígono exacto)
// ---------------------------------------------------------------------------
// Versión con HISTÓRICO de sentinel-ndvi-modulo (función puntual bajo-demanda,
// que sigue activa e intacta — consultarNdviModulo en GeoMonitor.tsx). Misma
// Statistical API y mismo evalscript NDVI, pero dos diferencias:
//
//   1. Usa el POLÍGONO EXACTO de cada módulo SRL (bounds.geometry), no el
//      bbox rectangular — geometría embebida en modulosGeometry.ts, extraída
//      de public/geo/modulos.geojson (ver ese archivo para la procedencia).
//   2. Persiste en public.ndvi_modulo_historico (upsert onConflict
//      numero_modulo,mes) en vez de solo devolver JSON — mismo patrón de
//      idempotencia que sentinel-ndwi-vaso-sync.
//
// Procesa los 6 módulos SRL en una sola invocación (loop interno) — el cron
// mensual dispara un solo POST, no seis cron.schedule separados.
//
// Invocación: POST { numero_modulo?: number, mes?: "2026-03" }
//   Sin numero_modulo: procesa los 6 módulos SRL.
//   Sin mes: mes calendario ANTERIOR al actual (uso normal del cron, día 3 —
//     da margen a que Sentinel-2 ya tenga indexado el mes recién cerrado).
//   Con mes ("2026-03"): ventana de ESE mes calendario completo (backfill).
//   En ambos casos la ventana es siempre un mes calendario completo, nunca
//   una ventana deslizante de "N días atrás desde hoy" — eso etiquetaba la
//   fila con el mes de HOY aunque la mayoría de los días de la ventana
//   fueran del mes anterior (bug confirmado en producción, ver git log).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MODULOS_SRL_GEOMETRY, NOMBRES_MODULO_SRL, type GeoJSONPolygon, type GeoJSONMultiPolygon } from "./modulosGeometry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Proveedor de Sentinel Hub: "classic" (sinergise, cuenta Trial vencida — ver
// sentinel-status) o "cdse" (Copernicus Data Space Ecosystem, gratuito sin
// vencimiento), elegido con el secret SENTINEL_PROVIDER. Default "classic":
// sin secret configurado, comportamiento idéntico al de siempre.
//
// IMPORTANTE — esta función es de ALTO riesgo para migrar: alimenta el cron
// mensual (día 3) que escribe ndvi_modulo_historico, un histórico NO
// recuperable retroactivamente si un mes falla en silencio. Además usa
// bounds.geometry (polígono exacto del módulo), no un bbox — antes de confiar
// el cron real a "cdse", invocar esta función manualmente con
// SENTINEL_PROVIDER=cdse y confirmar que la Statistical API de CDSE acepta
// geometry (no solo bbox) y devuelve stats con la misma forma
// (outputs.ndvi.bands.B0.stats.{mean,min,max,stDev,sampleCount}).
type SentinelProvider = "classic" | "cdse";

const ENDPOINTS: Record<SentinelProvider, { oauth: string; statistics: string }> = {
  classic: {
    oauth: "https://services.sentinel-hub.com/oauth/token",
    statistics: "https://services.sentinel-hub.com/api/v1/statistics",
  },
  cdse: {
    oauth: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    statistics: "https://sh.dataspace.copernicus.eu/api/v1/statistics",
  },
};

function resolverProvider(): SentinelProvider {
  const raw = (Deno.env.get("SENTINEL_PROVIDER") || "classic").trim().toLowerCase();
  return raw === "cdse" ? "cdse" : "classic";
}

const MAX_CLOUD_COVERAGE = 40;

async function obtenerAccessToken(provider: SentinelProvider, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(ENDPOINTS[provider].oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!r.ok) throw new Error(`OAuth token HTTP ${r.status}: ${await r.text()}`);
  const body = await r.json();
  const token = body?.access_token;
  if (!token) throw new Error("OAuth: respuesta sin access_token");
  return token;
}

// El cron mensual (día 3) alimenta un histórico NO recuperable retroactivamente
// — sin timeout, un fetch colgado agota el wall-clock de la Edge Function y el
// mes se pierde en silencio; sin reintento, un 429/5xx transitorio de CDSE
// (común en el plan gratuito bajo carga) hace lo mismo. 60s de timeout, hasta
// 2 reintentos con backoff, solo sobre códigos transitorios (429/5xx) — un 400
// (geometría/evalscript inválido) no se reintenta porque fallará igual siempre.
async function fetchConReintento(url: string, init: RequestInit, intentos = 3): Promise<Response> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimoError = new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    } catch (err) {
      ultimoError = err;
    }
    if (intento < intentos) await new Promise((res) => setTimeout(res, 1000 * 2 ** (intento - 1)));
  }
  throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

// Mismo evalscript base que sentinel-ndvi-modulo (Sentinel-2 L2A, B04/B08),
// más un output "activo" (1 si NDVI≥0.30, 0 si no) — el "mean" que la
// Statistical API calcula sobre ESE output es directamente la fracción de
// píxeles con cobertura vegetal activa dentro del polígono, sin necesitar
// histograma con bins. 0.30 es el umbral estándar en teledetección agrícola
// para distinguir vegetación real de suelo desnudo/agua/infraestructura.
const UMBRAL_COBERTURA_ACTIVA = 0.30;
const EVALSCRIPT_NDVI = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "activo", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" },
    ],
  };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001);
  let activo = ndvi >= ${UMBRAL_COBERTURA_ACTIVA} ? 1 : 0;
  return { ndvi: [ndvi], activo: [activo], dataMask: [s.dataMask] };
}
`;

// Kc ≈ 0.15 + 1.10·NDVI, acotado — MISMA fórmula que ndviAKc() en
// src/utils/kcNdvi.ts, duplicada aquí para que la fila persistida ya traiga
// Kc sin que el frontend recalcule por cada punto de la serie histórica. Si
// se ajusta la fórmula, actualizar los dos lugares.
function ndviAKc(ndvi: number): number {
  const kc = 0.15 + 1.10 * ndvi;
  return Math.max(0.15, Math.min(1.05, +kc.toFixed(2)));
}

// Área real del polígono (shoelace sobre proyección equirrectangular simple,
// m/grado por latitud media) — mismo criterio de proyección que
// sentinel-ndwi-vaso-sync usa para su raster. modulos.geojson no trae
// superficie_ha en properties, así que se calcula aquí en vez de asumir un
// campo que no existe.
function areaHaAnillo(ring: number[][], mPorGradoLon: number, mPorGradoLat: number): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const X0 = x0 * mPorGradoLon, Y0 = y0 * mPorGradoLat;
    const X1 = x1 * mPorGradoLon, Y1 = y1 * mPorGradoLat;
    s += X0 * Y1 - X1 * Y0;
  }
  return Math.abs(s) / 2 / 10_000;
}

function calcularSuperficieHa(geom: GeoJSONPolygon | GeoJSONMultiPolygon): number {
  const anillosExternos = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const todosPuntos = anillosExternos.flatMap((poly) => poly[0]);
  const lats = todosPuntos.map((c) => c[1]);
  const latMedia = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mPorGradoLon = 111_320 * Math.cos(latMedia * Math.PI / 180);
  const mPorGradoLat = 110_574;

  let totalHa = 0;
  for (const poly of anillosExternos) {
    // poly[0] = anillo exterior (suma), poly[1..] = huecos (resta) — mismo
    // criterio de signo que un cálculo de área con huecos estándar.
    poly.forEach((ring, i) => {
      const ha = areaHaAnillo(ring, mPorGradoLon, mPorGradoLat);
      totalHa += i === 0 ? ha : -ha;
    });
  }
  return totalHa;
}

interface ResultadoModulo {
  numero_modulo: number;
  nombre_modulo: string;
  insertado: boolean;
  mensaje?: string;
  ndvi_medio?: number;
  delta_ndvi?: number | null;
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
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const moduloParam: number | undefined = Number.isFinite(Number(body?.numero_modulo)) ? Number(body.numero_modulo) : undefined;
    const mesParam: string | undefined = body?.mes;

    const modulosAProcesar = moduloParam !== undefined ? [moduloParam] : Object.keys(MODULOS_SRL_GEOMETRY).map(Number);
    const invalidos = modulosAProcesar.filter((m) => !(m in MODULOS_SRL_GEOMETRY));
    if (invalidos.length) {
      return json({ error: `Módulo(s) sin geometría configurada: ${invalidos.join(", ")}. Disponibles: ${Object.keys(MODULOS_SRL_GEOMETRY).join(", ")}` }, 400);
    }

    // Ventana: mes calendario explícito (backfill) o mes calendario ANTERIOR
    // (cron normal, día 3 de cada mes — corre con margen para que el mes
    // recién cerrado ya tenga cobertura Sentinel-2 indexada). Antes usaba
    // "últimos 30 días desde hoy" pero etiquetaba la fila con el mes de HOY:
    // el día 3 de octubre eso arma una ventana 3-sep→3-oct (≈90% de días de
    // septiembre) guardada como mes="2026-10" — el mes actual quedaba
    // etiquetado con datos mayormente del mes anterior, y delta_ndvi
    // comparaba dos ventanas que se solapan casi por completo consigo
    // mismas en vez de dos meses reales (bug confirmado en producción,
    // sep-2026: la fila "2026-09" tenía ventana_desde=2026-08-12). El mes
    // calendario completo también evita depender de en qué día del mes se
    // invoque manualmente "Actualizar ahora" — siempre cae en el mes
    // calendario anterior, sin importar la hora local del usuario.
    let inicio: Date, fin: Date, mes: string;
    if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
      const [anio, mesNum] = mesParam.split("-").map(Number);
      inicio = new Date(Date.UTC(anio, mesNum - 1, 1));
      fin = new Date(Date.UTC(anio, mesNum, 1));
      mes = mesParam;
    } else {
      const hoy = new Date();
      // Mes calendario anterior al actual (UTC): si hoy es 2026-10-03,
      // cubre 2026-09-01..2026-10-01.
      fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
      inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
      mes = `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, "0")}`;
    }

    const token = await obtenerAccessToken(provider, CLIENT_ID, CLIENT_SECRET);
    const resultados: ResultadoModulo[] = [];

    // Duración exacta de la ventana en días — un intervalo fijo "P30D" corta
    // el último día en cualquier mes de 31 días (confirmado en producción:
    // ventana_hasta quedaba en el día 31 en vez del 1 del mes siguiente para
    // marzo/mayo/julio/agosto). ISO 8601 acepta "P<n>D" con n arbitrario.
    const diasVentana = Math.round((fin.getTime() - inicio.getTime()) / 86400000);

    for (const numeroModulo of modulosAProcesar) {
      const geom = MODULOS_SRL_GEOMETRY[numeroModulo];
      const nombreModulo = NOMBRES_MODULO_SRL[numeroModulo] ?? `Módulo ${numeroModulo}`;

      try {
        const reqBody = {
          input: {
            bounds: {
              geometry: geom,
              properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
            },
            // maxCloudCoverage va aquí, dentro de data[].dataFilter — NO en
            // el bloque `aggregation` (donde vivía antes). La Statistical API
            // ignora silenciosamente un maxCloudCoverage puesto en
            // `aggregation`: no es un parámetro válido ahí, así que nunca
            // filtró ninguna escena desde que existe esta función — cada mes
            // se promediaba con TODAS las escenas de la ventana, incluidas
            // las de 80-95% de nubosidad, junto con las limpias. Confirmado
            // con prueba directa (sep-2026): mismo request con el filtro en
            // el lugar correcto, ndvi_max de mayo 2026 pasó de 0.11 a 0.95.
            data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: MAX_CLOUD_COVERAGE } }],
          },
          aggregation: {
            timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
            aggregationInterval: { of: `P${diasVentana}D` },
            evalscript: EVALSCRIPT_NDVI,
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
        const intervals = stats?.data ?? [];
        const conDatos = intervals.filter((iv: any) => (iv?.outputs?.ndvi?.bands?.B0?.stats?.sampleCount ?? 0) > 0);
        if (!conDatos.length) {
          resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: `Sin escenas Sentinel-2 utilizables en la ventana ${inicio.toISOString().slice(0, 10)}..${fin.toISOString().slice(0, 10)}.` });
          continue;
        }
        const ultimo = conDatos[conDatos.length - 1];
        const s = ultimo.outputs.ndvi.bands.B0.stats;
        const ndviMedio: number = s.mean;
        // "mean" del output binario "activo" = fracción de píxeles con
        // NDVI≥UMBRAL_COBERTURA_ACTIVA dentro del polígono (0-1).
        const fraccionCoberturaActiva: number | null = ultimo.outputs?.activo?.bands?.B0?.stats?.mean ?? null;

        const superficieHa = Number(calcularSuperficieHa(geom).toFixed(2));
        const kcEstimado = ndviAKc(ndviMedio);

        // Delta vs. el mes calendario anterior CON DATO del mismo módulo.
        const { data: anterior } = await supabase
          .from("ndvi_modulo_historico")
          .select("ndvi_medio, mes")
          .eq("numero_modulo", numeroModulo)
          .lt("mes", mes)
          .order("mes", { ascending: false })
          .limit(1)
          .maybeSingle();
        const deltaNdvi = anterior ? Number((ndviMedio - anterior.ndvi_medio).toFixed(4)) : null;

        const fila = {
          numero_modulo: numeroModulo,
          nombre_modulo: nombreModulo,
          mes,
          ventana_desde: ultimo.interval?.from ?? inicio.toISOString(),
          ventana_hasta: ultimo.interval?.to ?? fin.toISOString(),
          ndvi_medio: Number(ndviMedio.toFixed(4)),
          ndvi_min: s.min != null ? Number(s.min.toFixed(4)) : null,
          ndvi_max: s.max != null ? Number(s.max.toFixed(4)) : null,
          ndvi_desv: s.stDev != null ? Number(s.stDev.toFixed(4)) : null,
          muestras_validas: s.sampleCount ?? null,
          nubosidad_max_pct: MAX_CLOUD_COVERAGE,
          superficie_ha: superficieHa,
          fraccion_cobertura_activa: fraccionCoberturaActiva != null ? Number(fraccionCoberturaActiva.toFixed(4)) : null,
          kc_estimado: kcEstimado,
          delta_ndvi: deltaNdvi,
          fuente_geometria: "poligono_exacto",
        };

        const { error: eUpsert } = await supabase
          .from("ndvi_modulo_historico")
          .upsert(fila, { onConflict: "numero_modulo,mes" });

        if (eUpsert) {
          resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: `Upsert falló: ${eUpsert.message}` });
        } else {
          resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: true, ndvi_medio: fila.ndvi_medio, delta_ndvi: fila.delta_ndvi });
        }
      } catch (errModulo) {
        resultados.push({ numero_modulo: numeroModulo, nombre_modulo: nombreModulo, insertado: false, mensaje: String(errModulo) });
      }
    }

    // El cron (net.http_post) no inspecciona el body de la respuesta, solo el
    // status HTTP — devolver 200 aunque TODOS los módulos hayan fallado hacía
    // que cron.job_run_details marcara "succeeded" con el mes completo
    // perdido y sin ninguna señal de alerta. 207 (Multi-Status) si hubo al
    // menos un fallo, 500 si fallaron todos — 200 solo si los 6 módulos
    // insertaron correctamente.
    const fallidos = resultados.filter((r) => !r.insertado);
    const status = fallidos.length === 0 ? 200 : fallidos.length === resultados.length ? 500 : 207;
    return json({ ok: fallidos.length !== resultados.length, provider, mes, ventana: { desde: inicio.toISOString(), hasta: fin.toISOString() }, resultados }, status);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
