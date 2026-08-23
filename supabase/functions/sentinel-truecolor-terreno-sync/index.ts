// ═══════════════════════════════════════════════════════════════════════════
// sentinel-truecolor-terreno-sync — Manejo de Vaso: textura satelital del terreno
// ---------------------------------------------------------------------------
// Trae una imagen de color natural (Sentinel-2 TRUE_COLOR) recortada al
// MISMO bbox que usa dem-boquilla-sync, y la sube a Supabase Storage (bucket
// 'dem-texturas') — no se decodifica píxel a píxel (a diferencia de
// sentinel-ndwi-vaso-sync, que sí necesita leer NDWI banda por banda para
// vectorizar el contorno): aquí el PNG se sube tal cual, la Process API ya
// entrega la imagen lista para usarse como textura.
//
// Mismo patrón OAuth/Catalog API que sentinel-ndwi-vaso-sync — reutiliza la
// infraestructura Sentinel Hub existente, no agrega credenciales nuevas.
//
// Invocación: POST { presa_id?: "PRE-001" }  (por ahora solo La Boquilla)
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OAUTH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";
const CATALOG_SEARCH_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

// MISMO bbox que BBOXES_PRESA['PRE-001'] en sentinel-ndwi-vaso-sync y
// BBOX_CORTINA en dem-boquilla-sync (ambos ya alineados al vaso completo) —
// la textura tiene que cubrir exactamente el mismo bbox que el DEM para que
// el mapeo UV en VasoVisor3D.tsx (lon/lat → coordenada de textura) sea 1:1
// sin desplazamiento.
const BBOX_PRESA: Record<string, { nombre: string; bbox: [number, number, number, number] }> = {
  "PRE-001": { nombre: "La Boquilla", bbox: [-105.7241, 27.3942, -105.2175, 27.7092] },
};

// Subido de 20m/pixel a 42m/pixel: la resolución original (~2750x1750px,
// 11.5MB) generaba ~23MB de textura en VRAM (imagen + cadena de mipmaps) —
// en GPU integrada de memoria compartida limitada, sumado al resto de la
// escena (DEM, cortina de fotogrametría), agotaba la memoria disponible y
// perdía el contexto WebGL (Canvas congelado, "no pasa nada" al interactuar
// con el visor). 42m/pixel da ~1200x836px — el terreno se ve desde una
// distancia donde el detalle de píxel individual no se percibe de todas
// formas, así que la pérdida de nitidez es aceptable frente al riesgo de
// que la escena no cargue en absoluto.
const RESOLUCION_M = 42;

const EVALSCRIPT_TRUE_COLOR = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B03", "B02"] }],
    output: { bands: 3, sampleType: "AUTO" },
  };
}
function evaluatePixel(s) {
  // Ganancia estándar de visualización Sentinel-2 (2.5x) — mismo factor que
  // usa el script "true color" de referencia del propio Sentinel Hub para
  // que la imagen no salga oscura (reflectancia cruda subexpone a simple vista).
  return [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5];
}
`;

async function obtenerAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(OAUTH_TOKEN_URL, {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const SENTINEL_CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const SENTINEL_CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SENTINEL_CLIENT_ID || !SENTINEL_CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const presaId: string = body?.presa_id || "PRE-001";
    const config = BBOX_PRESA[presaId];
    if (!config) {
      return json({ error: `Presa no configurada: ${presaId}. Disponibles: ${Object.keys(BBOX_PRESA).join(", ")}` }, 400);
    }
    const [minLon, minLat, maxLon, maxLat] = config.bbox;

    const token = await obtenerAccessToken(SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET);

    const fin = new Date();
    const inicio = new Date(fin.getTime() - 60 * 86400000); // ventana amplia (60 días): TRUE_COLOR necesita cielo despejado, no solo NDWI

    // Fecha real de la escena — el Process API con salida de imagen no la
    // expone; se resuelve aparte vía Catalog API, mismo patrón que
    // sentinel-ndwi-vaso-sync.
    let fechaEscena: string | null = null;
    let nubosidadEscena: number | null = null;
    try {
      const rCat = await fetch(CATALOG_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          collections: ["sentinel-2-l2a"],
          datetime: `${inicio.toISOString()}/${fin.toISOString()}`,
          bbox: config.bbox,
          limit: 100,
          fields: { include: ["properties.datetime", "properties.eo:cloud_cover"], exclude: ["geometry", "assets", "links"] },
        }),
      });
      if (rCat.ok) {
        const catalogo = await rCat.json();
        const features: Array<{ properties?: { datetime?: string; "eo:cloud_cover"?: number } }> = catalogo?.features ?? [];
        const elegida = [...features].sort((a, b) =>
          (a.properties?.["eo:cloud_cover"] ?? 100) - (b.properties?.["eo:cloud_cover"] ?? 100))[0];
        fechaEscena = elegida?.properties?.datetime ?? null;
        nubosidadEscena = elegida?.properties?.["eo:cloud_cover"] ?? null;
      }
    } catch {
      // No bloquea la corrida: el Process API igual intenta con leastCC.
    }

    const mPorGradoLon = 111_320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const mPorGradoLat = 110_574;
    const anchoM = (maxLon - minLon) * mPorGradoLon;
    const altoM = (maxLat - minLat) * mPorGradoLat;
    const width = Math.round(anchoM / RESOLUCION_M);
    const height = Math.round(altoM / RESOLUCION_M);

    const reqBody = {
      input: {
        bounds: { bbox: config.bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
            maxCloudCoverage: 30, mosaickingOrder: "leastCC",
          },
        }],
      },
      output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
      evalscript: EVALSCRIPT_TRUE_COLOR,
    };

    const r = await fetch(PROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(reqBody),
    });
    if (!r.ok) return json({ error: `Process API HTTP ${r.status}: ${await r.text()}` }, 502);
    const pngBuffer = await r.arrayBuffer();

    // cacheControl 30 días: la imagen (11+ MB, un mosaico satelital de todo
    // el bbox del vaso) no cambia entre visitas del mismo mes — sin esto
    // Supabase Storage no manda cabeceras de caché por defecto y el
    // navegador re-descarga el archivo completo cada vez que se abre el
    // visor 3D, causa confirmada de la carga lenta/inconsistente reportada.
    const rutaStorage = `${presaId}/truecolor.png`;
    const { error: errUpload } = await supabase.storage
      .from("dem-texturas")
      .upload(rutaStorage, pngBuffer, { contentType: "image/png", upsert: true, cacheControl: "2592000" });
    if (errUpload) return json({ error: `Storage upload: ${errUpload.message}` }, 500);

    const { data: urlData } = supabase.storage.from("dem-texturas").getPublicUrl(rutaStorage);

    const registro = {
      presa_id: presaId,
      fuente: "Sentinel-2 TRUE_COLOR (Sentinel Hub)",
      fecha_escena: fechaEscena,
      nubosidad_pct: nubosidadEscena,
      bbox: config.bbox,
      ancho_px: width,
      alto_px: height,
      url_storage: rutaStorage,
      url_publica: urlData.publicUrl,
      actualizado_en: new Date().toISOString(),
    };
    const { error: errUpsert } = await supabase
      .from("textura_satelital_terreno")
      .upsert(registro, { onConflict: "presa_id" });
    if (errUpsert) return json({ error: `upsert textura_satelital_terreno: ${errUpsert.message}` }, 500);

    return json({
      ok: true, presa_id: presaId, ancho_px: width, alto_px: height,
      fecha_escena: fechaEscena, nubosidad_pct: nubosidadEscena,
      url_publica: urlData.publicUrl,
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
