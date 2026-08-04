// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndvi-modulo — NDVI promedio del área de UN módulo de riego
// ---------------------------------------------------------------------------
// A diferencia de sentinel-catalog-search (que solo resuelve QUÉ fecha cubre
// el WMS visual), esta función SÍ calcula un valor: NDVI medio/min/max del
// polígono del módulo en la ventana más reciente, vía Statistical API.
//
// Alcance deliberadamente por MÓDULO, no por lote (~5,200 parcelas): la
// Statistical API cobra "processing units" por cada estadística calculada, y
// una llamada por lote sería 5,200x más cara que 6 llamadas (una por módulo).
// El bbox del módulo se usa como área (no el contorno exacto de miles de
// vértices) — más barato y suficiente para una tendencia agregada de vigor
// vegetativo por módulo, no un análisis de precisión de borde de parcela.
//
// Reutiliza el mismo patrón OAuth que sentinel-catalog-search: el secret
// nunca llega al frontend, todo corre server-side.
//
// Invocación: POST { minLon, minLat, maxLon, maxLat, diasVentana? }
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OAUTH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";
const STATISTICAL_URL = "https://services.sentinel-hub.com/api/v1/statistics";

let cachedToken: { token: string; expiraEn: number } | null = null;

async function obtenerAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiraEn > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!r.ok) throw new Error(`OAuth token HTTP ${r.status}: ${await r.text()}`);
  const body = await r.json();
  const token = body?.access_token;
  const expiresIn = Number(body?.expires_in) || 3600;
  if (!token) throw new Error("OAuth: respuesta sin access_token");
  cachedToken = { token, expiraEn: Date.now() + expiresIn * 1000 };
  return token;
}

// Evalscript NDVI estándar (Sentinel-2 L2A, bandas B04/B08) para la Statistical
// API — devuelve una banda "ndvi" por pixel más un output "dataMask" separado
// (nombre exacto que la Statistical API reconoce para excluir automáticamente
// los píxeles enmascarados del agregado mean/min/max/stDev). Sin el segundo
// output declarado en setup(), la API rechaza la petición con 400 "Output
// dataMask requested but missing from function setup()".
const EVALSCRIPT_NDVI = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" },
    ],
  };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001);
  return { ndvi: [ndvi], dataMask: [s.dataMask] };
}
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }

    const b = await req.json().catch(() => ({}));
    const minLon = Number(b?.minLon), minLat = Number(b?.minLat);
    const maxLon = Number(b?.maxLon), maxLat = Number(b?.maxLat);
    const diasVentana = Number.isFinite(Number(b?.diasVentana)) ? Number(b.diasVentana) : 30;
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      return json({ error: "Se requieren minLon/minLat/maxLon/maxLat numéricos" }, 400);
    }

    const token = await obtenerAccessToken(CLIENT_ID, CLIENT_SECRET);

    const fin = new Date();
    const inicio = new Date(fin.getTime() - diasVentana * 86400000);

    const reqBody = {
      input: {
        bounds: {
          bbox: [minLon, minLat, maxLon, maxLat],
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        },
        data: [{ type: "sentinel-2-l2a" }],
      },
      aggregation: {
        timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
        aggregationInterval: { of: "P30D" }, // un solo intervalo: toda la ventana
        evalscript: EVALSCRIPT_NDVI,
        // maxCloudCoverage: filtra escenas muy nubladas antes de agregar, para
        // no diluir el promedio con NDVI falso bajo nubes.
        maxCloudCoverage: 40,
      },
    };

    const r = await fetch(STATISTICAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(reqBody),
    });
    if (!r.ok) return json({ error: `Statistical API HTTP ${r.status}: ${await r.text()}` }, 502);
    const stats = await r.json();

    // La respuesta trae un "interval" por ventana de agregación (aquí, una
    // sola) con outputs.ndvi.bands.B0.stats.{mean,min,max,stDev}.
    const intervals = stats?.data ?? [];
    if (!intervals.length) {
      return json({ ok: true, encontrada: false, mensaje: `Sin escenas Sentinel-2 en los últimos ${diasVentana} días para este módulo.` }, 200);
    }

    // Toma el intervalo más reciente con datos válidos (sampleCount > 0).
    const conDatos = intervals.filter((iv: any) => (iv?.outputs?.ndvi?.bands?.B0?.stats?.sampleCount ?? 0) > 0);
    if (!conDatos.length) {
      return json({ ok: true, encontrada: false, mensaje: "Escenas encontradas pero sin píxeles válidos (nubes/máscara)." }, 200);
    }
    const ultimo = conDatos[conDatos.length - 1];
    const s = ultimo.outputs.ndvi.bands.B0.stats;

    return json({
      ok: true, encontrada: true,
      ndvi_medio: s.mean ?? null,
      ndvi_min: s.min ?? null,
      ndvi_max: s.max ?? null,
      ndvi_desv: s.stDev ?? null,
      muestras_validas: s.sampleCount ?? null,
      desde: ultimo.interval?.from ?? inicio.toISOString(),
      hasta: ultimo.interval?.to ?? fin.toISOString(),
      dias_ventana: diasVentana,
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
