// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndvi-modulo-imagen — captura PNG de NDVI coloreado por módulo
// ---------------------------------------------------------------------------
// A diferencia de sentinel-ndvi-modulo-sync (Statistical API, solo números
// agregados), esta función usa la PROCESS API para devolver una imagen PNG
// real del vigor vegetativo, coloreada con rampa rojo→ámbar→verde (mismo
// evalscript NDVI base que sentinel-ndvi-modulo-sync: B04/B08, Sentinel-2
// L2A), recortada al bbox de cada módulo — para incrustarla como imagen
// estática en el informe institucional HTML (offline, no puede usar el WMS
// interactivo en vivo).
//
// Devuelve las imágenes como base64 inline en la respuesta JSON (no se suben
// a Storage: es una captura puntual para el momento de generar un informe,
// no un asset persistente reutilizado — a diferencia de
// sentinel-truecolor-terreno-sync, que sí persiste su textura).
//
// Invocación: POST { numero_modulo?: number }
//   Sin numero_modulo: captura los 6 módulos SRL en una sola invocación.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Copia local (no import cross-función — Supabase Edge Functions se
// despliegan de forma aislada, sin dependencias entre carpetas de función)
// de la misma geometría embebida que usa sentinel-ndvi-modulo-sync. Si el
// geojson fuente cambia, regenerar en AMBOS lugares (ver modulosGeometry.ts
// para el procedimiento de extracción).
import { MODULOS_SRL_GEOMETRY, type GeoJSONPolygon, type GeoJSONMultiPolygon } from "./modulosGeometry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OAUTH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";
const LADO_PX = 260; // imagen cuadrada, suficiente para miniatura de informe sin pesar demasiado el HTML

// Rampa rojo(#d03b3b)→ámbar(#d98704)→verde(#0ca30c) sobre NDVI∈[0.05,0.75] —
// MISMOS colores hex que colorRampa() en src/utils/informeNdviInstitucional.ts
// y src/components/PlanoGeneralModulos.tsx, para que la imagen capturada aquí
// luzca coherente con el resto del semáforo institucional del proyecto.
const EVALSCRIPT_NDVI_COLOREADO = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: { bands: 4, sampleType: "AUTO" },
  };
}
function lerp(a, b, f) { return a + (b - a) * f; }
function rampa(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {
    var f = t / 0.5;
    return [lerp(0xd0, 0xd9, f) / 255, lerp(0x3b, 0x87, f) / 255, lerp(0x3b, 0x04, f) / 255];
  }
  var f2 = (t - 0.5) / 0.5;
  return [lerp(0xd9, 0x0c, f2) / 255, lerp(0x87, 0xa3, f2) / 255, lerp(0x04, 0x0c, f2) / 255];
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001);
  let t = (ndvi - 0.05) / (0.75 - 0.05);
  let c = rampa(t);
  return [c[0], c[1], c[2], 1];
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

function bboxCuadradoDe(geom: GeoJSONPolygon | GeoJSONMultiPolygon): [number, number, number, number] {
  const anillosExternos = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  const todosPuntos = anillosExternos.flat();
  const lons = todosPuntos.map((c) => c[0]), lats = todosPuntos.map((c) => c[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  // Cuadra el bbox (mismo ancho/alto en metros) para que LADO_PX×LADO_PX no
  // deforme la imagen — margen de 5% para que el contorno no toque el borde.
  const latMedia = (minLat + maxLat) / 2;
  const mPorGradoLon = 111_320 * Math.cos(latMedia * Math.PI / 180);
  const mPorGradoLat = 110_574;
  const anchoM = (maxLon - minLon) * mPorGradoLon, altoM = (maxLat - minLat) * mPorGradoLat;
  const ladoM = Math.max(anchoM, altoM) * 1.05;
  const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2;
  const medioLon = (ladoM / 2) / mPorGradoLon, medioLat = (ladoM / 2) / mPorGradoLat;
  return [cLon - medioLon, cLat - medioLat, cLon + medioLon, cLat + medioLat];
}

function arrayBufferABase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface ResultadoImagen {
  numero_modulo: number;
  ok: boolean;
  mensaje?: string;
  data_uri?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const moduloParam: number | undefined = Number.isFinite(Number(body?.numero_modulo)) ? Number(body.numero_modulo) : undefined;
    const modulosAProcesar = moduloParam !== undefined ? [moduloParam] : Object.keys(MODULOS_SRL_GEOMETRY).map(Number);
    const invalidos = modulosAProcesar.filter((m) => !(m in MODULOS_SRL_GEOMETRY));
    if (invalidos.length) {
      return json({ error: `Módulo(s) sin geometría configurada: ${invalidos.join(", ")}` }, 400);
    }

    const token = await obtenerAccessToken(CLIENT_ID, CLIENT_SECRET);
    const fin = new Date();
    const inicio = new Date(fin.getTime() - 30 * 86400000);

    const resultados: ResultadoImagen[] = [];
    for (const numeroModulo of modulosAProcesar) {
      try {
        const geom = MODULOS_SRL_GEOMETRY[numeroModulo];
        const bbox = bboxCuadradoDe(geom);
        const reqBody = {
          input: {
            bounds: { bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
            data: [{
              type: "sentinel-2-l2a",
              dataFilter: { timeRange: { from: inicio.toISOString(), to: fin.toISOString() }, maxCloudCoverage: 40, mosaickingOrder: "leastCC" },
            }],
          },
          output: { width: LADO_PX, height: LADO_PX, responses: [{ identifier: "default", format: { type: "image/png" } }] },
          evalscript: EVALSCRIPT_NDVI_COLOREADO,
        };
        const r = await fetch(PROCESS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(reqBody),
        });
        if (!r.ok) {
          resultados.push({ numero_modulo: numeroModulo, ok: false, mensaje: `Process API HTTP ${r.status}: ${await r.text()}` });
          continue;
        }
        const buf = await r.arrayBuffer();
        const base64 = arrayBufferABase64(buf);
        resultados.push({ numero_modulo: numeroModulo, ok: true, data_uri: `data:image/png;base64,${base64}` });
      } catch (errModulo) {
        resultados.push({ numero_modulo: numeroModulo, ok: false, mensaje: String(errModulo) });
      }
    }

    return json({ ok: true, resultados }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
