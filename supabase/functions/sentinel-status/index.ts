// ═══════════════════════════════════════════════════════════════════════════
// sentinel-status — Probe funcional de disponibilidad de Sentinel Hub
// ---------------------------------------------------------------------------
// Contexto: la cuenta de Sentinel Hub del proyecto expiró (WMS respondía 403
// "It looks like your Sentinel Hub account has expired"), lo que dejaba en
// negro tanto GEO-MONITOR (capa base 'sentinel') como el panel NDVI. El
// frontend ahora cae solo a satélite ArcGIS cuando eso pasa, PERO no vuelve a
// 'sentinel' automáticamente (para no reactivar consumo de cuota sin que el
// usuario lo decida) — así que hace falta avisar cuándo el servicio ya
// respondió de nuevo, para que el usuario reactive manualmente.
//
// Esta función NO se llama desde cada carga de página: la llama un cron (cada
// 6h) y opcionalmente un botón "Verificar ahora" en el panel. Escribe el
// resultado en `sentinel_hub_status` (fila única); el frontend solo lee esa
// tabla.
//
// Qué hace:
//   1. Pide un OAuth token con SENTINEL_OAUTH_CLIENT_ID/SECRET (mismo par que
//      usa sentinel-catalog-search). Si esto falla, la cuenta/credenciales
//      están mal de raíz — no hace falta seguir.
//   2. Prueba el WMS con un GetMap de 1×1 px (el más barato posible) usando
//      VITE_SENTINEL_INSTANCE_ID — así confirma que el Instance ID concreto
//      que usa GeoMonitor.tsx también sirve, no solo el OAuth.
//   3. Intenta leer /api/v1/statistics (Processing Units del mes) — algunos
//      planes no lo exponen; si falla, se ignora sin tumbar el resultado
//      principal.
//   4. Upsert en sentinel_hub_status: si pasa de no-disponible a disponible,
//      guarda ultima_vez_disponible = now().
//
// Proveedor: soporta "classic" (sinergise, cuenta Trial vencida — plan de
// pago requerido para reactivar) y "cdse" (Copernicus Data Space Ecosystem,
// gratuito sin vencimiento) vía el secret SENTINEL_PROVIDER. Mientras no se
// configure ese secret, se sigue usando "classic" — sin cambio de
// comportamiento hasta que haya credenciales CDSE listas.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Dos proveedores posibles para las mismas APIs de Sentinel Hub:
// - "classic" (sinergise.com, services.sentinel-hub.com): el que se usó
//   siempre en este proyecto. La cuenta Trial gratuita expiró y no se
//   renueva sola — requiere plan de pago para reactivarse.
// - "cdse" (Copernicus Data Space Ecosystem, dataspace.copernicus.eu): plan
//   gratuito sin vencimiento, mismas APIs (OAuth/WMS/Statistical/Catalog/
//   Process) pero con endpoints y flujo de credenciales distintos.
// Se elige con el secret SENTINEL_PROVIDER ("classic" por defecto, para no
// cambiar comportamiento hasta que haya credenciales CDSE configuradas).
type SentinelProvider = "classic" | "cdse";

const ENDPOINTS: Record<SentinelProvider, { oauth: string; statistics: string; wms: string }> = {
  classic: {
    oauth: "https://services.sentinel-hub.com/oauth/token",
    statistics: "https://services.sentinel-hub.com/api/v1/statistics",
    wms: "https://services.sentinel-hub.com/ogc/wms",
  },
  cdse: {
    oauth: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
    statistics: "https://sh.dataspace.copernicus.eu/api/v1/statistics",
    wms: "https://sh.dataspace.copernicus.eu/ogc/wms",
  },
};

function resolverProvider(): SentinelProvider {
  const raw = (Deno.env.get("SENTINEL_PROVIDER") || "classic").trim().toLowerCase();
  return raw === "cdse" ? "cdse" : "classic";
}

// El Instance ID de la configuration WMS no es secreto (viaja en el bundle
// público de Vite con prefijo VITE_ y en cada URL de tile del navegador) — se
// hardcodea aquí como fallback para el cron, que no tiene body del frontend.
// Puede sobreescribirse pasando { instanceId } en el POST, o con el secret
// SENTINEL_INSTANCE_ID en Supabase si algún día cambia.
const INSTANCE_ID_FALLBACK = "25dab096-95ef-4ca7-b0af-6024e9d25b74";

async function obtenerAccessToken(provider: SentinelProvider, clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(ENDPOINTS[provider].oauth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.error_description || body?.error || `OAuth token HTTP ${r.status}`);
  }
  const token = body?.access_token;
  if (!token) throw new Error("OAuth: respuesta sin access_token");
  return token;
}

/** GetMap de 1×1 px sobre un punto fijo del canal — el probe más barato que
 *  aún ejercita el mismo Instance ID/WMS que usa el mapa real. Cualquier XML
 *  de ServiceException (cuenta vencida, instance ID inválido, cuota agotada)
 *  se captura como texto para mostrarlo tal cual al usuario. */
async function probarWms(provider: SentinelProvider, instanceId: string): Promise<{ ok: boolean; mensaje: string }> {
  const bbox = "27.9,-105.5,28.1,-105.3"; // mismo punto de referencia del canal usado en sentinel-catalog-search
  const url = `${ENDPOINTS[provider].wms}/${instanceId}` +
    `?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=1_TRUE_COLOR&FORMAT=image/png` +
    `&TRANSPARENT=true&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=1&HEIGHT=1`;
  const r = await fetch(url);
  const contentType = r.headers.get("content-type") || "";
  if (r.ok && contentType.includes("image")) {
    return { ok: true, mensaje: "WMS responde correctamente" };
  }
  const texto = await r.text().catch(() => "");
  const match = texto.match(/<ServiceException(?:\s[^>]*)?>([\s\S]*?)<\/ServiceException>/i);
  const mensaje = match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : `WMS HTTP ${r.status}`;
  return { ok: false, mensaje };
}

/** Best-effort: no todos los planes exponen esta API. Si falla, se ignora. */
async function leerEstadisticas(provider: SentinelProvider, token: string): Promise<{ usadas: number | null; limite: number | null }> {
  try {
    const hoy = new Date();
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const r = await fetch(ENDPOINTS[provider].statistics, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {},
        aggregation: { timeRange: { from: inicioMes.toISOString(), to: hoy.toISOString() }, aggregationInterval: { of: "P1M" } },
      }),
    });
    if (!r.ok) return { usadas: null, limite: null };
    const data = await r.json().catch(() => null);
    const pu = data?.data?.[0]?.outputs?.data?.bands?.processingUnitsCount ?? null;
    return { usadas: typeof pu === "number" ? pu : null, limite: null };
  } catch {
    return { usadas: null, limite: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const provider = resolverProvider();
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    const body = await req.json().catch(() => ({}));
    const INSTANCE_ID = (typeof body?.instanceId === "string" && body.instanceId.trim())
      || Deno.env.get("SENTINEL_INSTANCE_ID")
      || INSTANCE_ID_FALLBACK;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let disponible = false;
    let mensaje = "";
    let usadas: number | null = null;
    let limite: number | null = null;

    try {
      const token = await obtenerAccessToken(provider, CLIENT_ID, CLIENT_SECRET);
      const probe = await probarWms(provider, INSTANCE_ID);
      disponible = probe.ok;
      mensaje = probe.mensaje;
      if (probe.ok) {
        const stats = await leerEstadisticas(provider, token);
        usadas = stats.usadas;
        limite = stats.limite;
      }
    } catch (err) {
      disponible = false;
      mensaje = err instanceof Error ? err.message : String(err);
    }

    // Fila única: trae el estado previo para saber si es una transición
    // no-disponible -> disponible (eso es lo único que mueve
    // ultima_vez_disponible).
    const { data: previo } = await supabase
      .from("sentinel_hub_status")
      .select("id, disponible")
      .limit(1)
      .maybeSingle();

    const ahora = new Date().toISOString();
    const cambioADisponible = disponible && !(previo?.disponible ?? false);

    const patch: Record<string, unknown> = {
      disponible,
      mensaje,
      processing_units_usadas: usadas,
      processing_units_limite: limite,
      ultima_verificacion: ahora,
    };
    if (cambioADisponible) patch.ultima_vez_disponible = ahora;

    if (previo?.id) {
      await supabase.from("sentinel_hub_status").update(patch).eq("id", previo.id);
    } else {
      await supabase.from("sentinel_hub_status").insert(patch);
    }

    return json({ ok: true, provider, disponible, mensaje, processing_units_usadas: usadas, processing_units_limite: limite }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
