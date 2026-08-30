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
//   Sin mes: ventana de "últimos 30 días" (uso normal del cron mensual).
//   Con mes ("2026-03"): ventana del mes calendario completo (backfill manual).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MODULOS_SRL_GEOMETRY, NOMBRES_MODULO_SRL, type GeoJSONPolygon, type GeoJSONMultiPolygon } from "./modulosGeometry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OAUTH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";
const STATISTICAL_URL = "https://services.sentinel-hub.com/api/v1/statistics";
const MAX_CLOUD_COVERAGE = 40;

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

    // Ventana: mes calendario explícito (backfill) o últimos 30 días (cron normal).
    let inicio: Date, fin: Date, mes: string;
    if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
      const [anio, mesNum] = mesParam.split("-").map(Number);
      inicio = new Date(Date.UTC(anio, mesNum - 1, 1));
      fin = new Date(Date.UTC(anio, mesNum, 1));
      mes = mesParam;
    } else {
      fin = new Date();
      inicio = new Date(fin.getTime() - 30 * 86400000);
      mes = `${fin.getUTCFullYear()}-${String(fin.getUTCMonth() + 1).padStart(2, "0")}`;
    }

    const token = await obtenerAccessToken(CLIENT_ID, CLIENT_SECRET);
    const resultados: ResultadoModulo[] = [];

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
            data: [{ type: "sentinel-2-l2a" }],
          },
          aggregation: {
            timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
            aggregationInterval: { of: "P30D" },
            evalscript: EVALSCRIPT_NDVI,
            maxCloudCoverage: MAX_CLOUD_COVERAGE,
          },
        };

        const r = await fetch(STATISTICAL_URL, {
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

    return json({ ok: true, mes, ventana: { desde: inicio.toISOString(), hasta: fin.toISOString() }, resultados }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
