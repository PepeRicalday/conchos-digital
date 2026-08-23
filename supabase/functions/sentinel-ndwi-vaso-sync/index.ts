// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndwi-vaso-sync — Manejo de Vaso: geometría mensual por NDWI
// ---------------------------------------------------------------------------
// Versión de PRODUCCIÓN de sentinel-ndwi-vaso-test (función de prueba,
// validada y ahora retirada): mismo pipeline OAuth → Catalog API (fecha real
// de escena) → Process API (NDWI continuo UINT16, 10m nativo) → marching
// squares (tabla de Bourke + asymptotic decider, verificado 0 fragmentos
// abiertos / 0 colisiones de ensamblado) → Chaikin. Lo nuevo aquí:
//
//   1. Parametrizable por presa y por mes (POST { presa_id, mes: "2026-03" }),
//      para poder invocar el backfill marzo→agosto a mano y luego dejar que
//      el cron mensual cubra el resto sin tocar código.
//   2. Cálculo de PERÍMETRO (no existía en la prueba) — longitud real en km
//      del anillo exterior + todos los anillos de isla, proyectada a metros.
//   3. KPI derivados calculados aquí, no en el cliente: índice de compacidad
//      isoperimétrica (Polsby-Popper), delta vs. el mes anterior de la misma
//      presa, y % respecto al máximo histórico del ciclo — así el frontend
//      solo lee filas, nunca recalcula.
//   4. Persiste en public.vaso_geometria_historico (upsert onConflict
//      presa_id,fecha_escena) en vez de solo devolver JSON — mismo patrón de
//      idempotencia que weatherlink-sync.
//
// Multi-presa por diseño: BBOXES_PRESA es un registro extensible; añadir Las
// Vírgenes es agregar una entrada, no duplicar la función.
//
// Invocación: POST { presa_id: "PRE-001", mes?: "2026-03" }
//   Sin "mes": usa el mes calendario actual (uso normal del cron mensual).
//   Con "mes": ventana de ese mes completo (uso del backfill manual).
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

// Bbox y ancla por presa.
//
// La Boquilla: el backfill marzo→julio reveló que el bbox angosto (22.2km x
// 7.8km + 1km, recortado SOLO contra la escena de julio) corta el vaso a
// nivel alto — marzo-mayo dieron ratio_elongacion < 1.0 (geométricamente
// IMPOSIBLE: el círculo es la forma de MENOR perímetro para un área dada,
// ningún polígono real puede tener menos). Causa: el polígono truncado por
// el borde del raster suma área grande (cuenta todos los píxeles de agua,
// incluidos los cortados) pero perímetro corto (el corte del bbox no genera
// segmentos de marching squares — fuera del raster se trata como "no agua"
// de forma abrupta, sin borde real que medir).
//
// Segundo ajuste (confirmado visualmente contra el grid de la máscara real
// de marzo): el bbox de 40x35km TODAVÍA cortaba el vaso a nivel alto, pero
// SOLO por el borde OESTE — no es un canal ancho conectándose a otro cuerpo
// de agua (se probó y descartó poda morfológica por erosión/reconstrucción
// geodésica, 3/8/20 iteraciones dieron resultado idéntico: no había nada que
// podar, era simplemente el propio vaso extendiéndose más allá del bbox).
// Extendido al máximo posible sin bajar de 20m/pixel (límite del Process API
// ~2500px/lado → 50km de ancho máximo a esta resolución).
interface ConfigPresa {
  nombre: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  ancla: { lon: number; lat: number };     // para descartar cuerpos de agua vecinos
}
const BBOXES_PRESA: Record<string, ConfigPresa> = {
  "PRE-001": {
    nombre: "La Boquilla",
    bbox: [-105.7241, 27.3942, -105.2175, 27.7092],
    ancla: { lon: -105.4375, lat: 27.5517 },
  },
};

const RESOLUCION_M = 20;
// 0.2 = corte estándar para separar agua de vegetación húmeda/sombra de
// relieve — mismo umbral validado en la prueba puntual.
const UMBRAL_NDWI = 0.2;

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

// NDWI continuo (no máscara binaria): codificado = (ndwi+1)*30000 en UINT16
// — habilita interpolación subpíxel del borde en vez de que el cruce caiga
// siempre en el punto medio fijo de una arista de celda.
const EVALSCRIPT_MASCARA = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B08", "dataMask"] }],
    output: { id: "default", bands: 1, sampleType: "UINT16" },
  };
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0];
  let ndwi = (s.B03 - s.B08) / (s.B03 + s.B08 + 0.0001);
  let codificado = Math.round((ndwi + 1) * 30000);
  return [Math.max(0, Math.min(60000, codificado))];
}
`;

/**
 * Decodifica un PNG en escala de grises (8 o 16 bits) a un Uint16Array plano
 * de W*H. Deno Edge Runtime no tiene lector PNG nativo. bitDepth=16 filtra en
 * unidades de 2 bytes (Sub/Up/Average/Paeth operan sobre el píxel anterior de
 * 16 bits, no byte a byte).
 */
async function decodificaPngGris(buf: Uint8Array): Promise<{ data: Uint16Array; width: number; height: number }> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== firma[i]) throw new Error("No es un PNG válido (firma no coincide)");
  }

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = dv.getUint32(pos, false);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const dataStart = pos + 8;
    if (type === "IHDR") {
      width = dv.getUint32(dataStart, false);
      height = dv.getUint32(dataStart + 4, false);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buf.slice(dataStart, dataStart + len));
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }
  if (!width || !height) throw new Error("PNG sin IHDR legible");
  if ((bitDepth !== 8 && bitDepth !== 16) || colorType !== 0) {
    throw new Error(`PNG con formato inesperado (bitDepth=${bitDepth} colorType=${colorType})`);
  }

  const comprimido = new Uint8Array(idatChunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of idatChunks) { comprimido.set(c, off); off += c.length; }
  const deflateRaw = comprimido.slice(2, comprimido.length - 4);
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(deflateRaw);
  writer.close();
  const descomprimido = new Uint8Array(await new Response(ds.readable).arrayBuffer());

  const bpp = bitDepth === 16 ? 2 : 1;
  const rowBytes = width * bpp;
  const stride = rowBytes + 1;
  const filtrado = new Uint8Array(width * height * bpp);
  let prevRow = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const filterType = descomprimido[y * stride];
    const row = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const raw = descomprimido[y * stride + 1 + i];
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let val: number;
      switch (filterType) {
        case 0: val = raw; break;
        case 1: val = (raw + a) & 0xff; break;
        case 2: val = (raw + b) & 0xff; break;
        case 3: val = (raw + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = (raw + pred) & 0xff;
          break;
        }
        default: throw new Error(`Filtro PNG desconocido: ${filterType}`);
      }
      row[i] = val;
      filtrado[y * rowBytes + i] = val;
    }
    prevRow = row;
  }

  const data = new Uint16Array(width * height);
  if (bitDepth === 16) {
    for (let p = 0; p < width * height; p++) data[p] = (filtrado[p * 2] << 8) | filtrado[p * 2 + 1];
  } else {
    for (let p = 0; p < width * height; p++) data[p] = filtrado[p];
  }
  return { data, width, height };
}

type Pt = [number, number];

/**
 * Marching squares con tabla de Bourke (referencia canónica) + asymptotic
 * decider para los casos ambiguos 5/10. La clave de ensamblado es la arista
 * discreta de la rejilla ("H,x,y" / "V,x,y"), no la coordenada flotante
 * interpolada — evita que dos celdas vecinas que comparten arista calculen
 * el mismo punto por caminos de redondeo distintos y no encadenen.
 * Verificado en la prueba puntual: 0 fragmentos abiertos, 0 colisiones.
 */
function trazaContornoMarchingSquares(
  ndwiRaster: Uint16Array, W: number, H: number, umbralCodificado: number,
): { exterior: Pt[]; islas: Pt[][] } {
  const valorEn = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? ndwiRaster[y * W + x] : 0);
  const claveH = (x: number, y: number) => `H,${x},${y}`;
  const claveV = (x: number, y: number) => `V,${x},${y}`;
  const siguienteDe = new Map<string, { pt: Pt; k: string }>();

  const interp = (pa: Pt, va: number, pb: Pt, vb: number): Pt => {
    const t = vb === va ? 0.5 : (umbralCodificado - va) / (vb - va);
    const tc = Math.max(0, Math.min(1, t));
    return [pa[0] + (pb[0] - pa[0]) * tc, pa[1] + (pb[1] - pa[1]) * tc];
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const vTL = valorEn(x, y), vTR = valorEn(x + 1, y);
      const vBR = valorEn(x + 1, y + 1), vBL = valorEn(x, y + 1);
      const tl = vTL > umbralCodificado ? 1 : 0;
      const tr = vTR > umbralCodificado ? 1 : 0;
      const br = vBR > umbralCodificado ? 1 : 0;
      const bl = vBL > umbralCodificado ? 1 : 0;
      const caso = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caso === 0 || caso === 15) continue;

      const pTL: Pt = [x, y], pTR: Pt = [x + 1, y];
      const pBR: Pt = [x + 1, y + 1], pBL: Pt = [x, y + 1];
      const top = { pt: interp(pTL, vTL, pTR, vTR), k: claveH(x, y) };
      const bottom = { pt: interp(pBL, vBL, pBR, vBR), k: claveH(x, y + 1) };
      const left = { pt: interp(pTL, vTL, pBL, vBL), k: claveV(x, y) };
      const right = { pt: interp(pTR, vTR, pBR, vBR), k: claveV(x + 1, y) };

      const segmentos: [typeof top, typeof top][] = [];
      const promedioCentro = (vTL + vTR + vBR + vBL) / 4;
      switch (caso) {
        case 1: segmentos.push([left, bottom]); break;
        case 2: segmentos.push([bottom, right]); break;
        case 3: segmentos.push([left, right]); break;
        case 4: segmentos.push([right, top]); break;
        case 5:
          if (promedioCentro > umbralCodificado) { segmentos.push([left, top]); segmentos.push([right, bottom]); }
          else { segmentos.push([right, top]); segmentos.push([left, bottom]); }
          break;
        case 6: segmentos.push([bottom, top]); break;
        case 7: segmentos.push([left, top]); break;
        case 8: segmentos.push([top, left]); break;
        case 9: segmentos.push([top, bottom]); break;
        case 10:
          if (promedioCentro > umbralCodificado) { segmentos.push([top, right]); segmentos.push([bottom, left]); }
          else { segmentos.push([top, left]); segmentos.push([bottom, right]); }
          break;
        case 11: segmentos.push([top, right]); break;
        case 12: segmentos.push([right, left]); break;
        case 13: segmentos.push([right, bottom]); break;
        case 14: segmentos.push([bottom, left]); break;
      }
      for (const [a, b] of segmentos) siguienteDe.set(a.k, b);
    }
  }

  if (siguienteDe.size === 0) return { exterior: [], islas: [] };

  // Solo se acepta un anillo que efectivamente CERRÓ sobre su propia arista
  // de partida. Un fragmento que rompe (choca con otro anillo, o queda sin
  // continuación) no es un contorno válido — dibujarlo como polígono cerrado
  // produciría un artefacto geométrico (línea recta entre el último punto y
  // el primero). Verificado en la prueba puntual con la tabla de Bourke:
  // 0 fragmentos abiertos, 0 colisiones de ensamblado.
  const visitados = new Set<string>();
  const anillos: Pt[][] = [];
  for (const [k0] of siguienteDe) {
    if (visitados.has(k0)) continue;
    const anillo: Pt[] = [];
    let k = k0;
    const inicioK = k0;
    let pasos = 0;
    const maxPasos = siguienteDe.size + 1;
    let cerrado = false;
    while (pasos++ < maxPasos) {
      if (visitados.has(k)) break;
      visitados.add(k);
      const siguiente = siguienteDe.get(k);
      if (!siguiente) break;
      anillo.push(siguiente.pt);
      if (siguiente.k === inicioK) { cerrado = true; break; }
      k = siguiente.k;
    }
    if (cerrado && anillo.length >= 4) anillos.push(anillo);
  }
  if (!anillos.length) return { exterior: [], islas: [] };

  const areaAnillo = (a: Pt[]) => {
    let s = 0;
    for (let i = 0; i < a.length - 1; i++) s += a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1];
    return Math.abs(s) / 2;
  };

  // El exterior geométrico es el anillo de MAYOR ÁREA, no el de más vértices.
  // "Más vértices" (criterio anterior) puede elegir mal cuando una isla
  // grande y detallada genera, en esa escena particular, más segmentos de
  // marching squares que el propio exterior — causa confirmada de un bug
  // real: en marzo/abril el backfill guardó como "exterior" un anillo de
  // solo 1.16 km² (una isla) en vez del vaso completo de 72.5 km², dando
  // perímetro/compacidad geométricamente imposibles (ratio_elongacion<1.0,
  // que solo puede pasar si el "exterior" no envuelve realmente al resto).
  // El área SIEMPRE es mayor en el anillo que contiene a todos los otros,
  // por construcción — criterio robusto sin importar el detalle de borde.
  anillos.sort((a, b) => areaAnillo(b) - areaAnillo(a));
  const [masGrande, ...resto] = anillos;

  // Umbral de 3px² solo filtra fragmentos degenerados de celdas ambiguas
  // aisladas — verificado en la prueba puntual que toda isla real supera
  // ampliamente este mínimo (la más chica observada: 124 px reales).
  const MIN_PX_ISLA = 3;
  return { exterior: masGrande, islas: resto.filter(a => areaAnillo(a) >= MIN_PX_ISLA) };
}

function submuestrea(puntos: Pt[], maxPuntos = 400): Pt[] {
  if (puntos.length <= maxPuntos) return puntos;
  const paso = puntos.length / maxPuntos;
  const salida: Pt[] = [];
  for (let i = 0; i < maxPuntos; i++) salida.push(puntos[Math.floor(i * paso)]);
  salida.push(salida[0]);
  return salida;
}

/** Chaikin (corte de esquinas), 2 iteraciones: quita el dentado de raster sin desplazar la forma real. */
function suavizaChaikin(anillo: Pt[], iteraciones = 2): Pt[] {
  let pts = anillo;
  for (let it = 0; it < iteraciones; it++) {
    if (pts.length < 4) break;
    const n = pts.length - 1;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      out.push([x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25]);
      out.push([x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75]);
    }
    out.push(out[0]);
    pts = out;
  }
  return pts;
}

/** Componente conexa que contiene el píxel más cercano al ancla — evita que un cuerpo de agua vecino robe el resultado. */
function manchaCercaDelAncla(mascara: Uint8Array, W: number, H: number, anclaPx: { x: number; y: number }): Uint8Array {
  const N = W * H;
  const visto = new Uint8Array(N);
  const pila = new Int32Array(N);
  let mejorBlob: number[] = [];
  let mejorDist = Infinity;
  for (let s = 0; s < N; s++) {
    if (!mascara[s] || visto[s]) continue;
    let tope = 0;
    const blob: number[] = [];
    let distMinBlob = Infinity;
    pila[tope++] = s; visto[s] = 1;
    while (tope > 0) {
      const p = pila[--tope];
      blob.push(p);
      const x = p % W, y = (p / W) | 0;
      const d = (x - anclaPx.x) ** 2 + (y - anclaPx.y) ** 2;
      if (d < distMinBlob) distMinBlob = d;
      if (x > 0 && mascara[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila[tope++] = p - 1; }
      if (x < W - 1 && mascara[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila[tope++] = p + 1; }
      if (y > 0 && mascara[p - W] && !visto[p - W]) { visto[p - W] = 1; pila[tope++] = p - W; }
      if (y < H - 1 && mascara[p + W] && !visto[p + W]) { visto[p + W] = 1; pila[tope++] = p + W; }
    }
    if (blob.length >= 50 && distMinBlob < mejorDist) { mejorDist = distMinBlob; mejorBlob = blob; }
  }
  const salida = new Uint8Array(N);
  for (const p of mejorBlob) salida[p] = 1;
  return salida;
}

/** Longitud real en metros de un anillo cerrado, dado en coords de píxel + factores de escala m/pixel por eje. */
function perimetroAnillo(anillo: Pt[], mPorPixelX: number, mPorPixelY: number): number {
  let total = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const dx = (anillo[i + 1][0] - anillo[i][0]) * mPorPixelX;
    const dy = (anillo[i + 1][1] - anillo[i][1]) * mPorPixelY;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
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
    const config = BBOXES_PRESA[presaId];
    if (!config) {
      return json({ error: `Presa no configurada: ${presaId}. Disponibles: ${Object.keys(BBOXES_PRESA).join(", ")}` }, 400);
    }

    // Ventana de búsqueda: mes explícito ("2026-03", usado en el backfill
    // manual marzo→agosto) o los últimos 30 días si se omite (uso normal del
    // cron mensual, mismo comportamiento que la prueba puntual).
    let inicio: Date, fin: Date;
    const mesParam: string | undefined = body?.mes;
    if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
      const [anio, mes] = mesParam.split("-").map(Number);
      inicio = new Date(Date.UTC(anio, mes - 1, 1));
      fin = new Date(Date.UTC(anio, mes, 1)); // primer día del mes siguiente
    } else {
      fin = new Date();
      inicio = new Date(fin.getTime() - 30 * 86400000);
    }

    const token = await obtenerAccessToken(SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET);

    const [minLon, minLat, maxLon, maxLat] = config.bbox;
    const latMedia = (minLat + maxLat) / 2;
    const mPorGradoLon = 111_320 * Math.cos(latMedia * Math.PI / 180);
    const mPorGradoLat = 110_574;
    const anchoM = (maxLon - minLon) * mPorGradoLon;
    const altoM = (maxLat - minLat) * mPorGradoLat;
    const width = Math.round(anchoM / RESOLUCION_M);
    const height = Math.round(altoM / RESOLUCION_M);

    // Fecha real de la escena — el Process API con salida PNG no la expone.
    let fechaEscena: string | null = null;
    let nubosidadEscena: number | null = null;
    try {
      const catalogBody = {
        collections: ["sentinel-2-l2a"],
        datetime: `${inicio.toISOString()}/${fin.toISOString()}`,
        bbox: config.bbox,
        limit: 20,
        fields: { include: ["properties.datetime", "properties.eo:cloud_cover"], exclude: ["geometry", "assets", "links"] },
      };
      const rCat = await fetch(CATALOG_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(catalogBody),
      });
      if (rCat.ok) {
        const catalogo = await rCat.json();
        const features: Array<{ properties?: { datetime?: string; "eo:cloud_cover"?: number } }> = catalogo?.features ?? [];
        const conCC = features.filter(f => (f.properties?.["eo:cloud_cover"] ?? 100) <= 20);
        const candidatas = conCC.length ? conCC : features;
        const elegida = [...candidatas].sort((a, b) =>
          (a.properties?.["eo:cloud_cover"] ?? 100) - (b.properties?.["eo:cloud_cover"] ?? 100))[0];
        fechaEscena = elegida?.properties?.datetime ?? null;
        nubosidadEscena = elegida?.properties?.["eo:cloud_cover"] ?? null;
      }
    } catch {
      // No bloquea la corrida: el Process API igual intenta con leastCC.
    }

    // Sin escena utilizable en la ventana (mes muy nublado): no se inserta
    // fila — convención del proyecto de no guardar 0/inventado cuando no hay
    // dato confiable. El mes queda como hueco visible en la serie, no relleno.
    if (!fechaEscena) {
      return json({
        ok: true, insertado: false, presa_id: presaId,
        mensaje: `Sin escena Sentinel-2 utilizable en la ventana ${inicio.toISOString().slice(0, 10)}..${fin.toISOString().slice(0, 10)}.`,
      }, 200);
    }

    const reqBody = {
      input: {
        bounds: { bbox: config.bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: { from: inicio.toISOString(), to: fin.toISOString() }, maxCloudCoverage: 20, mosaickingOrder: "leastCC" },
        }],
      },
      output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
      evalscript: EVALSCRIPT_MASCARA,
    };

    const r = await fetch(PROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(reqBody),
    });
    if (!r.ok) return json({ error: `Process API HTTP ${r.status}: ${await r.text()}` }, 502);

    const buf = new Uint8Array(await r.arrayBuffer());
    const { data: ndwiRaster, width: W, height: H } = await decodificaPngGris(buf);
    const umbralCodificado = Math.round((UMBRAL_NDWI + 1) * 30000);

    const mascaraCruda = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) mascaraCruda[p] = ndwiRaster[p] > umbralCodificado ? 1 : 0;

    const anclaPx = {
      x: ((config.ancla.lon - minLon) / (maxLon - minLon)) * W,
      y: (1 - (config.ancla.lat - minLat) / (maxLat - minLat)) * H,
    };
    const blobConAncla = manchaCercaDelAncla(mascaraCruda, W, H, anclaPx);
    const mascaraPrincipal = blobConAncla;
    const pixelesVaso = mascaraPrincipal.reduce((s, v) => s + v, 0);
    // Salvaguarda: ¿el blob seleccionado toca el borde del raster? Si el
    // vaso se extiende más allá del bbox configurado, el resultado no es
    // confiable (área contada de más, perímetro cortado de menos) — mismo
    // síntoma que causó ratio_elongacion<1.0 en el backfill de marzo con el
    // bbox angosto original. Verificado que la causa era bbox insuficiente,
    // no un canal/brazo delgado conectado (se intentó podar por erosión
    // morfológica y no cambió nada — la forma es real, no ruido).
    let blobTocaBorde = false;
    for (let x = 0; x < W && !blobTocaBorde; x++) { if (mascaraPrincipal[x] || mascaraPrincipal[(H - 1) * W + x]) blobTocaBorde = true; }
    for (let y = 0; y < H && !blobTocaBorde; y++) { if (mascaraPrincipal[y * W] || mascaraPrincipal[y * W + W - 1]) blobTocaBorde = true; }
    const m2PorPixel = RESOLUCION_M * RESOLUCION_M;
    const areaVasoKm2 = (pixelesVaso * m2PorPixel) / 1_000_000;

    const ndwiEnmascarado = new Uint16Array(W * H);
    for (let p = 0; p < W * H; p++) ndwiEnmascarado[p] = mascaraPrincipal[p] ? ndwiRaster[p] : 0;

    const { exterior, islas } = trazaContornoMarchingSquares(ndwiEnmascarado, W, H, umbralCodificado);
    if (!exterior.length) {
      return json({ ok: true, insertado: false, presa_id: presaId, fecha_escena: fechaEscena, mensaje: "Vectorización sin resultado (sin píxeles de agua sobre el umbral)." }, 200);
    }

    // Salvaguarda: si el vaso toca el borde del raster, el polígono queda
    // truncado por el bbox en vez de cerrado por su propio contorno real —
    // produce área grande (cuenta píxeles de agua cortados) con perímetro
    // corto (el corte del bbox no genera segmentos de marching squares,
    // fuera del raster no hay borde real que medir). Causa confirmada del
    // bug de ratio_elongacion < 1.0 (geométricamente imposible) visto en el
    // backfill de marzo-mayo con el bbox angosto anterior. Margen de 2px
    // (no 0) porque el suavizado Chaikin puede desplazar el último vértice
    // un poco hacia adentro del borde exacto.
    const MARGEN_BORDE_PX = 2;
    const tocaBorde = exterior.some(([x, y]) => x <= MARGEN_BORDE_PX || y <= MARGEN_BORDE_PX || x >= W - MARGEN_BORDE_PX || y >= H - MARGEN_BORDE_PX);
    if (tocaBorde) {
      return json({
        ok: true, insertado: false, presa_id: presaId, fecha_escena: fechaEscena,
        mensaje: "El vaso toca el borde del bbox configurado — el polígono quedaría truncado (área/perímetro geométricamente inconsistentes). No se guardó. Ampliar BBOXES_PRESA para esta presa.",
      }, 200);
    }

    // Perímetro real: metros por píxel distintos en X/Y (proyección
    // equirrectangular simple), exterior + todas las islas — un vaso que se
    // fragmenta en más islas al bajar de nivel tiene MÁS perímetro total
    // aunque su área baje, señal que el área sola no captura.
    const mPorPixelX = anchoM / W, mPorPixelY = altoM / H;
    const perimetroTotalM = perimetroAnillo(exterior, mPorPixelX, mPorPixelY)
      + islas.reduce((s, isla) => s + perimetroAnillo(isla, mPorPixelX, mPorPixelY), 0);
    const perimetroKm = perimetroTotalM / 1000;

    // Índice de compacidad isoperimétrica (Polsby-Popper): 4π×área/perímetro².
    // 1.0 = círculo perfecto; cae con fragmentación/irregularidad del borde.
    // área y perímetro deben ir en las MISMAS unidades (m² y m) para que el
    // índice sea adimensional correcto.
    const areaM2 = areaVasoKm2 * 1_000_000;
    const indiceCompacidad = perimetroTotalM > 0 ? (4 * Math.PI * areaM2) / (perimetroTotalM * perimetroTotalM) : null;
    // Mismo dato, lectura intuitiva: perímetro real / perímetro del círculo
    // de igual área. "7.8x" se entiende sin conocer Polsby-Popper.
    const perimetroCirculoEquivalenteM = areaM2 > 0 ? 2 * Math.PI * Math.sqrt(areaM2 / Math.PI) : null;
    const ratioElongacion = perimetroCirculoEquivalenteM && perimetroCirculoEquivalenteM > 0
      ? perimetroTotalM / perimetroCirculoEquivalenteM
      : null;

    const areaIslaMayorKm2 = islas.length
      ? Math.max(...islas.map(isla => {
          let s = 0;
          for (let i = 0; i < isla.length - 1; i++) s += isla[i][0] * isla[i + 1][1] - isla[i + 1][0] * isla[i][1];
          return (Math.abs(s) / 2) * m2PorPixel / 1_000_000;
        }))
      : null;

    // Reproyección a lon/lat con suavizado Chaikin, mismo criterio que la prueba puntual.
    const px2lon = (x: number) => minLon + (x / W) * (maxLon - minLon);
    const px2lat = (y: number) => maxLat - (y / H) * (maxLat - minLat);
    const aLonLat = (anillo: Pt[]): Pt[] =>
      submuestrea(suavizaChaikin(anillo, 2), 400).map(([x, y]) => [Number(px2lon(x).toFixed(6)), Number(px2lat(y).toFixed(6))]);
    const contornoGeoJSON = { type: "Polygon", coordinates: [aLonLat(exterior), ...islas.map(aLonLat)] };

    // KPI comparativos: delta vs. la fila más reciente ANTERIOR a esta fecha
    // (misma presa), y % respecto al máximo histórico del ciclo hasta esta
    // fecha inclusive — se consultan aquí, no se recalculan en el cliente.
    const { data: anterior } = await supabase
      .from("vaso_geometria_historico")
      .select("area_km2, perimetro_km")
      .eq("presa_id", presaId)
      .lt("fecha_escena", fechaEscena)
      .order("fecha_escena", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: maximoHistorico } = await supabase
      .from("vaso_geometria_historico")
      .select("area_km2")
      .eq("presa_id", presaId)
      .lte("fecha_escena", fechaEscena)
      .order("area_km2", { ascending: false })
      .limit(1)
      .maybeSingle();

    const areaKm2Redondeada = Number(areaVasoKm2.toFixed(3));
    const perimetroKmRedondeado = Number(perimetroKm.toFixed(3));
    const maximoParaPct = maximoHistorico?.area_km2 != null
      ? Math.max(maximoHistorico.area_km2, areaKm2Redondeada)
      : areaKm2Redondeada;

    const fila = {
      presa_id: presaId,
      fecha_escena: fechaEscena,
      nubosidad_pct: nubosidadEscena,
      area_km2: areaKm2Redondeada,
      perimetro_km: perimetroKmRedondeado,
      num_islas: islas.length,
      area_isla_mayor_km2: areaIslaMayorKm2 != null ? Number(areaIslaMayorKm2.toFixed(3)) : null,
      indice_compacidad: indiceCompacidad != null ? Number(indiceCompacidad.toFixed(4)) : null,
      ratio_elongacion: ratioElongacion != null ? Number(ratioElongacion.toFixed(2)) : null,
      delta_area_km2: anterior ? Number((areaKm2Redondeada - anterior.area_km2).toFixed(3)) : null,
      delta_perimetro_km: anterior ? Number((perimetroKmRedondeado - anterior.perimetro_km).toFixed(3)) : null,
      pct_del_maximo_ciclo: maximoParaPct > 0 ? Number(((areaKm2Redondeada / maximoParaPct) * 100).toFixed(1)) : null,
      resolucion_m: RESOLUCION_M,
      bbox: config.bbox,
      contorno_geojson: contornoGeoJSON,
    };

    const { error: eUpsert } = await supabase
      .from("vaso_geometria_historico")
      .upsert(fila, { onConflict: "presa_id,fecha_escena" });
    if (eUpsert) return json({ error: `Upsert falló: ${eUpsert.message}` }, 500);

    return json({
      ok: true, insertado: true, presa_id: presaId, nombre_presa: config.nombre,
      fecha_escena: fechaEscena, nubosidad_pct: nubosidadEscena,
      area_km2: areaKm2Redondeada, perimetro_km: perimetroKmRedondeado,
      num_islas: islas.length, indice_compacidad: fila.indice_compacidad,
      ratio_elongacion: fila.ratio_elongacion,
      delta_area_km2: fila.delta_area_km2, delta_perimetro_km: fila.delta_perimetro_km,
      pct_del_maximo_ciclo: fila.pct_del_maximo_ciclo,
      blob_toca_borde: blobTocaBorde,
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
