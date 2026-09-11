// ═══════════════════════════════════════════════════════════════════════════
// sentinel-catalog-search — Fecha real de la imagen Sentinel-2 mostrada en mapa
// ---------------------------------------------------------------------------
// El WMS de Sentinel Hub (usado directo en GeoMonitor con el Instance ID) NO
// expone qué fecha exacta eligió dentro de un rango — solo pinta el tile. Para
// mostrarle al operador "de qué día es esta imagen" hace falta el Catalog API,
// que requiere OAuth Client Credentials (Client ID + Secret), distinto del
// Instance ID del WMS. El secret NUNCA debe llegar al frontend: por eso esta
// función corre server-side y el cliente solo pide "dame la fecha disponible".
//
// Dos modos (par con el selector de GeoMonitor):
//   'reciente' — ventana corta (3 días), sin filtro de nubosidad: prioriza
//                que la imagen sea de HOY/AYER aunque tenga nubes.
//   'legible'  — ventana de 30 días, con maxcc: prioriza la imagen más clara
//                del período (comportamiento por defecto ya usado en el WMS).
//
// Invocación: POST { lat, lon, modo: 'reciente' | 'legible' }
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Proveedor de Sentinel Hub: "classic" (sinergise, cuenta Trial vencida — ver
// sentinel-status) o "cdse" (Copernicus Data Space Ecosystem, gratuito sin
// vencimiento), elegido con el secret SENTINEL_PROVIDER. Default "classic":
// sin secret configurado, comportamiento idéntico al de siempre.
type SentinelProvider = "classic" | "cdse";

const ENDPOINTS: Record<SentinelProvider, { oauth: string; catalog: string }> = {
  classic: {
    oauth: "https://services.sentinel-hub.com/oauth/token",
    catalog: "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search",
  },
  cdse: {
    oauth: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    catalog: "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search",
  },
};

function resolverProvider(): SentinelProvider {
  const raw = (Deno.env.get("SENTINEL_PROVIDER") || "classic").trim().toLowerCase();
  return raw === "cdse" ? "cdse" : "classic";
}

interface ModoConfig {
  diasVentana: number;
  maxcc: number | null; // null = sin filtro de nubosidad
}

const MODOS: Record<"reciente" | "legible", ModoConfig> = {
  reciente: { diasVentana: 3, maxcc: null },
  legible: { diasVentana: 30, maxcc: 40 },
};

// Cacheado por proveedor: si SENTINEL_PROVIDER cambia entre invocaciones (o
// durante la transición classic -> cdse) un token del proveedor equivocado
// nunca se reutiliza para el otro.
let cachedToken: { provider: SentinelProvider; token: string; expiraEn: number } | null = null;

async function obtenerAccessToken(provider: SentinelProvider, clientId: string, clientSecret: string): Promise<string> {
  // El token OAuth dura minutos/horas según Sentinel Hub; se cachea en memoria
  // de la función mientras la instancia siga viva, para no pedirlo en cada
  // request (el warm start de Edge Functions reutiliza el módulo).
  if (cachedToken && cachedToken.provider === provider && cachedToken.expiraEn > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const r = await fetch(ENDPOINTS[provider].oauth, {
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

  cachedToken = { provider, token, expiraEn: Date.now() + expiresIn * 1000 };
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const provider = resolverProvider();
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);
    const modo: "reciente" | "legible" = body?.modo === "reciente" ? "reciente" : "legible";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return json({ error: "Se requiere lat/lon numéricos" }, 400);
    }

    const { diasVentana, maxcc } = MODOS[modo];
    const fin = new Date();
    const inicio = new Date(fin.getTime() - diasVentana * 86400000);

    const token = await obtenerAccessToken(provider, CLIENT_ID, CLIENT_SECRET);

    // Bbox pequeño (~0.02°, ~2 km) centrado en el punto: solo interesa saber
    // qué escena cubre ese punto exacto del canal, no un área amplia.
    const delta = 0.01;
    const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];

    const searchBody: Record<string, unknown> = {
      collections: ["sentinel-2-l2a"],
      datetime: `${inicio.toISOString()}/${fin.toISOString()}`,
      bbox,
      limit: 10,
      fields: {
        include: ["id", "properties.datetime", "properties.eo:cloud_cover"],
        exclude: ["geometry", "assets", "links"],
      },
    };

    const r = await fetch(ENDPOINTS[provider].catalog, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(searchBody),
    });
    if (!r.ok) return json({ error: `Catalog API HTTP ${r.status}: ${await r.text()}` }, 502);
    const catalogo = await r.json();

    const features: Array<{ properties?: { datetime?: string; "eo:cloud_cover"?: number } }> =
      catalogo?.features ?? [];
    if (!features.length) {
      return json({
        ok: true, modo, encontrada: false,
        mensaje: `Sin escenas Sentinel-2 en los últimos ${diasVentana} días para este punto.`,
      }, 200);
    }

    // Orden: 'reciente' = la más nueva; 'legible' = la de menor nubosidad
    // dentro de la ventana (empatando por fecha si hay cobertura igual).
    const ordenadas = [...features].sort((a, b) => {
      if (modo === "reciente") {
        return (b.properties?.datetime ?? "").localeCompare(a.properties?.datetime ?? "");
      }
      const ca = a.properties?.["eo:cloud_cover"] ?? 100;
      const cb = b.properties?.["eo:cloud_cover"] ?? 100;
      if (ca !== cb) return ca - cb;
      return (b.properties?.datetime ?? "").localeCompare(a.properties?.datetime ?? "");
    });

    const elegida = ordenadas[0];
    return json({
      ok: true, modo, encontrada: true,
      fecha_captura: elegida.properties?.datetime ?? null,
      nubosidad_pct: elegida.properties?.["eo:cloud_cover"] ?? null,
      escenas_en_ventana: features.length,
      dias_ventana: diasVentana,
      maxcc_aplicado: maxcc,
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
