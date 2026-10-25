// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndvi-modulo-raster — IMAGEN NDVI por módulo y mes cerrado (informe)
// ---------------------------------------------------------------------------
// Hermana de sentinel-ndvi-modulo-sync-v2 (misma metodología 'scl-mediana-v1'):
// sentinel-2-l2a, mes calendario completo, máscara SCL por píxel, MEDIANA
// mensual por píxel (mosaicking ORBIT), pero devuelve un PNG en vez de
// estadísticas. NO reemplaza ni toca sentinel-ndvi-modulo-imagen (sin uso).
//
//   · Colores = clases DISCRETAS de src/utils/ndviRampa.ts (CLASES_NDVI).
//   · Sin dato (todas las observaciones enmascaradas) = alfa 0 (transparente).
//   · Devuelve el bbox EXACTO usado; el recorte al polígono lo hace el
//     cliente con clipPath (la imagen es del rectángulo, no del polígono).
//   · NDVI de la FRONTERA del módulo (caminos, canales, suelo sin riego):
//     NO es NDVI de parcela. Se declara en el campo `nota`.
//   · Caché por (mes cerrado, módulo) en Storage, bucket privado 'ndvi-raster'.
//   · Un módulo por llamada, sin bucles internos (cuota CDSE).
//
// Invocación: POST { mes: "AAAA-MM", numero_modulo: n, resolucion_m?: 20..60,
//                    dry_run?: true }
//   dry_run: valida autorización/mes/módulo y devuelve el plan (bbox, tamaño,
//            clave de caché) SIN llamar a CDSE ni tocar Storage.
// Autorización: igual que la v2 (x-cron-secret o JWT de usuario con rol SRL).
//
// Respuesta 200: { mes, numero_modulo, bbox, ancho, alto, resolucion_m,
//   png_base64, n_escenas, pct_pixeles_validos, proveedor, metodo, nota,
//   cache: 'hit'|'miss', sin_datos? }
//   · png_base64 = null y sin_datos = true cuando el mes no tiene ningún píxel
//     válido (hueco explícito; nunca una imagen "vacía" que parezca dato).
//   · pct_pixeles_validos = fracción 0–1 de píxeles DENTRO del polígono con
//     dato; null (S/D) si el PNG no pudo decodificarse.
// Errores: 400 entrada, 401 sin autorización, 502 CDSE caído/rechazó, 500 resto.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { MODULOS_SRL_GEOMETRY, NOMBRES_MODULO_SRL } from "./modulosGeometry.ts";
import {
  METODO, MAX_CLOUD_COVERAGE, NOTA_FRONTERA, alfaDePng, bboxDe, bytesABase64, claveCache,
  construirPeticionProcess, fraccionValidos, mascaraPoligono, tamanoImagen, validarMes, type Geom,
} from "./rasterLogica.ts";

// CORS: solo orígenes propios (el cron no usa navegador y no necesita CORS). Mismo patrón que process-hydric-doc.
const ORIGENES_FIJOS = new Set([
  "https://conchos-digital.vercel.app",
  "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
]);
const ORIGEN_PREVIEW = /^https:\/\/conchos-digital(-[a-z0-9]+)*-pepericaldays-projects\.vercel\.app$/;
function calculaCors(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  const permitido = ORIGENES_FIJOS.has(origen) || ORIGEN_PREVIEW.test(origen);
  return {
    ...(permitido ? { "Access-Control-Allow-Origin": origen } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type SentinelProvider = "classic" | "cdse";
const ENDPOINTS: Record<SentinelProvider, { oauth: string; process: string; catalog: string }> = {
  classic: {
    oauth: "https://services.sentinel-hub.com/oauth/token",
    process: "https://services.sentinel-hub.com/api/v1/process",
    catalog: "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search",
  },
  cdse: {
    oauth: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    process: "https://sh.dataspace.copernicus.eu/api/v1/process",
    catalog: "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search",
  },
};

function resolverProvider(): SentinelProvider {
  const raw = (Deno.env.get("SENTINEL_PROVIDER") || "classic").trim().toLowerCase();
  return raw === "cdse" ? "cdse" : "classic";
}

const BUCKET = "ndvi-raster";

async function obtenerAccessToken(provider: SentinelProvider, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(ENDPOINTS[provider].oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new ErrorCdse(`OAuth token HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const token = (await r.json())?.access_token;
  if (!token) throw new ErrorCdse("OAuth: respuesta sin access_token");
  return token;
}

/** Fallo atribuible al proveedor (CDSE): se responde 502 para que el cliente lo distinga de un error propio. */
class ErrorCdse extends Error {}

// Timeout + reintento solo sobre códigos transitorios (429/5xx); un 400 (evalscript/geometría) fallaría igual.
async function fetchConReintento(url: string, init: RequestInit, intentos = 3): Promise<Response> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimoError = new Error(`HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    } catch (err) {
      ultimoError = err;
    }
    if (intento < intentos) await new Promise((res) => setTimeout(res, 1000 * 2 ** (intento - 1)));
  }
  throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

// Escenas (FECHAS de paso distintas) que cubren el polígono en el mes. Si falla no bloquea: null (S/D).
async function contarEscenas(provider: SentinelProvider, token: string, geom: Geom, desde: Date, hasta: Date): Promise<number | null> {
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
    if (!r.ok) return null;
    const feats: any[] = (await r.json())?.features;
    if (!Array.isArray(feats)) return null;
    return new Set(feats.map((f) => String(f?.properties?.datetime ?? "").slice(0, 10)).filter(Boolean)).size;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = calculaCors(req);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Autorización: gasta cuota de Copernicus y escribe en Storage con service role; la anon key es pública.
    // Pasa solo (a) el cron/herramienta con el secreto de public.cron_secretos, o (b) usuario con sesión real y rol SRL.
    const secretoCron = req.headers.get("x-cron-secret");
    let autorizado = false;
    if (secretoCron) {
      const { data: s } = await supabase.from("cron_secretos").select("valor").eq("nombre", "ndvi_sync_v2").maybeSingle();
      autorizado = !!s?.valor && s.valor === secretoCron;
    }
    if (!autorizado) {
      const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (jwt) {
        const { data: u, error: eUser } = await supabase.auth.getUser(jwt);
        if (!eUser && u?.user?.id) {
          const { data: perfil, error: ePerfil } = await supabase.from("perfiles_usuario").select("rol").eq("id", u.user.id).maybeSingle();
          autorizado = !ePerfil && perfil?.rol === "SRL";
        }
      }
    }
    if (!autorizado) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    const vm = validarMes(body?.mes);
    if (!vm.ok) return json({ error: vm.error }, 400);
    const { mes, inicio, fin } = vm;

    const numeroModulo = Number(body?.numero_modulo);
    if (!Number.isInteger(numeroModulo) || !(numeroModulo in MODULOS_SRL_GEOMETRY)) {
      return json({ error: `numero_modulo inválido: usa uno de ${Object.keys(MODULOS_SRL_GEOMETRY).join(", ")}` }, 400);
    }
    const geom = MODULOS_SRL_GEOMETRY[numeroModulo] as Geom;
    const bbox = bboxDe(geom);
    const { ancho, alto, resolucionM } = tamanoImagen(bbox, body?.resolucion_m);
    const provider = resolverProvider();
    const ruta = claveCache(mes, numeroModulo);

    if (dryRun) {
      return json({ dry_run: true, mes, numero_modulo: numeroModulo, nombre_modulo: NOMBRES_MODULO_SRL[numeroModulo], bbox, ancho, alto, resolucion_m: resolucionM, proveedor: provider, metodo: METODO, cache_clave: `${BUCKET}/${ruta}` });
    }

    // Caché (solo meses cerrados, que es lo único permitido): se usa si coincide la resolución y el método.
    try {
      const { data: blob } = await supabase.storage.from(BUCKET).download(ruta);
      if (blob) {
        const guardado = JSON.parse(await blob.text());
        if (guardado?.metodo === METODO && guardado?.resolucion_m === resolucionM && guardado?.png_base64) {
          return json({ ...guardado, cache: "hit" });
        }
      }
    } catch { /* sin caché legible: se calcula */ }

    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);

    const token = await obtenerAccessToken(provider, CLIENT_ID, CLIENT_SECRET);
    const [rProc, nEscenas] = await Promise.all([
      fetchConReintento(ENDPOINTS[provider].process, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "image/png", Authorization: `Bearer ${token}` },
        body: JSON.stringify(construirPeticionProcess({ bbox, ancho, alto, inicio, fin })),
      }),
      contarEscenas(provider, token, geom, inicio, fin),
    ]);
    if (!rProc.ok) {
      return json({ error: `Process API HTTP ${rProc.status}: ${(await rProc.text().catch(() => "")).slice(0, 400)}`, codigo: "cdse" }, 502);
    }
    const png = new Uint8Array(await rProc.arrayBuffer());

    const alfa = await alfaDePng(png, ancho, alto);
    const pct = alfa ? fraccionValidos(alfa, mascaraPoligono(geom, bbox, ancho, alto)) : null;
    const sinDatos = pct === 0 || nEscenas === 0;

    const respuesta = {
      mes, numero_modulo: numeroModulo, bbox, ancho, alto, resolucion_m: resolucionM,
      png_base64: sinDatos ? null : bytesABase64(png),
      n_escenas: nEscenas, pct_pixeles_validos: pct,
      proveedor: provider, metodo: METODO, nota: NOTA_FRONTERA,
      ...(sinDatos ? { sin_datos: true } : {}),
    };

    // Solo se cachea un resultado con imagen (un hueco puede deberse a un fallo transitorio del proveedor).
    if (!sinDatos) {
      const { error: eSube } = await supabase.storage.from(BUCKET).upload(ruta, new Blob([JSON.stringify(respuesta)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
      if (eSube) console.warn(`[ndvi-raster] caché no escrita (${ruta}): ${eSube.message}`);
    }
    return json({ ...respuesta, cache: "miss" });
  } catch (err) {
    if (err instanceof ErrorCdse) return json({ error: String(err.message), codigo: "cdse" }, 502);
    return json({ error: String(err) }, 500);
  }
});
