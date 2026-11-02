// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndwi-vaso-sync — Manejo de Vaso: geometría del espejo de agua (v2)
// ---------------------------------------------------------------------------
// Método v2 (2026-11-01), tras la auditoría de precisión de bordes
// (e2e/vaso-precision-bordes.mjs, referencia independiente a 10 m):
//
//   v1 → problema medido                         v2 → corrección
//   ──────────────────────────────────────────   ───────────────────────────────
//   20 m (B03/B08 son 10 m nativos)              10 m, raster en teselas ≤2400 px
//   fecha del Catalog "más reciente" pero        un SOLO día: timeRange = ese día,
//   píxeles de un mosaico leastCC de 30 días     mostRecent. fecha_pixeles = real.
//   (20-ago y 09-sep: 98-100 % nube ese día)
//   sin máscara de nubes                         SCL 8/9/10 (+ sin dato) = inválido;
//                                                sonda a 60 m elige el día con
//                                                ≤3 % de la huella del vaso inválida
//   NDWI McFeeters umbral fijo 0.2               NDWI ∪ MNDWI (B11 ve el agua
//                                                turbia de las colas), umbral Otsu
//   mancha 4-conexa                              8-conexa, sillas unidas por agua;
//                                                apertura r=2 px corta el cauce del río
//   área = píxeles; contorno con Chaikin +       área y perímetro del POLÍGONO
//   submuestreo a 400 vértices (perímetro        final; Douglas-Peucker 0.6 px;
//   guardado ≠ polígono mostrado)                islas = agujeros (orientación)
//   borde corrido medio píxel                    centro de píxel (+0.5)
//
// Guarda vía RPC fn_vaso_geometria_guardar (transaccional): metodo='v2',
// vigente=true; la escena vigente anterior del mismo mes pasa a vigente=false
// (las filas v1 se conservan para comparar/revertir).
//
// Invocación: POST {
//   presa_id: "PRE-001",
//   mes?: "2026-03"            ventana = ese mes (backfill/reproceso)
//   fecha?: "2026-03-25"       un día exacto (reproceso puntual)
//   fecha_referencia?: "2017-09-01"  ±45 d, es_referencia_historica=true
//   indice?: "union"|"ndwi"|"mndwi"  (diagnóstico, solo con dry_run; por defecto union)
//   apertura_px?: 0..6         (diagnóstico, solo con dry_run; por defecto APERTURA_PX)
//   dry_run?: true             calcula y devuelve, no guarda
//   debug_catalogo?: true      solo lista candidatas del Catalog
// }
// Sin mes/fecha/fecha_referencia: últimos 30 días (cron mensual).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Proveedor: "classic" (sinergise) o "cdse" (Copernicus Data Space), secret SENTINEL_PROVIDER.
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

// Encuadre por presa. La Boquilla v2: ajustado a la extensión máxima medida en
// 2026 (lon −105.685…−105.386, lat 27.487…27.566) con ≥3.5 km de margen; a 10 m
// son ≈4048×1774 px (2 teselas). Si el vaso toca el borde no se guarda (salvaguarda).
// bboxHistorico: escenas antiguas cerca del NAME (vaso mucho más extendido).
interface ConfigPresa {
  nombre: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  ancla: { lon: number; lat: number };     // punto dentro del vaso (cerca de la cortina)
  bboxHistorico?: [number, number, number, number];
}
const BBOXES_PRESA: Record<string, ConfigPresa> = {
  "PRE-001": {
    nombre: "La Boquilla",
    bbox: [-105.76, 27.45, -105.35, 27.61],
    ancla: { lon: -105.4375, lat: 27.5517 },
    bboxHistorico: [-105.8471, 27.4436, -105.2234, 27.6096],
  },
};

const METODO = "v2";
const RESOLUCION_M = 10;
const RES_SONDA_M = 60;
const MAX_PX_TESELA = 2400;           // límite del Process API ≈2500 px por lado
const UMBRAL_NUBES_VASO_PCT = 3;      // % máximo de la huella sin dato válido
const MAX_SONDAS = 6;
const DILATACION_HUELLA_M = 750;      // la mancha no puede salir más de esto de la huella histórica (frena el cauce del río aguas arriba)
const TOLERANCIA_DP_PX = 0.6;         // Douglas-Peucker (≈6 m)
const MIN_PX_ISLA = 10;               // agujeros < 1000 m² se ignoran (cuentan como agua)
// Apertura morfológica (px): corta cintas de agua más angostas que ~2·r+1 píxeles (≈50 m) — el cauce del río que
// entra al vaso (no es embalse) quedaba unido por conectividad 8 y alargaba el polígono decenas de km (26-sep-2026).
// Definición: vaso = cuerpo de agua anclado SIN cintas angostas. Medido con e2e/vaso-precision-bordes.mjs:
// 0 autointersecciones y distancia media de borde 10-28 m contra la referencia de 10 m.
const APERTURA_PX = 2;
const OTSU_LIM: [number, number] = [0.0, 0.35];
const UMBRAL_FIJO = { ndwi: 0.2, mndwi: 0.1 }; // si el histograma no es bimodal
const M_POR_GRADO_LAT = 110_850;      // a ≈27.5° N

type Pt = [number, number];
type Indice = "union" | "ndwi" | "mndwi";

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

// Timeout 90 s y 2 reintentos solo ante 429/5xx (un 400 fallará igual siempre).
async function fetchConReintento(url: string, init: RequestInit, intentos = 3): Promise<Response> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimoError = new Error(`HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    } catch (err) {
      ultimoError = err;
    }
    if (intento < intentos) await new Promise((res) => setTimeout(res, 1000 * 2 ** (intento - 1)));
  }
  throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

// Dos bandas UINT16: (NDWI+1)·30000 y (MNDWI+1)·30000; 0 = inválido (sin dato o nube SCL 8/9/10, saturado/sin dato SCL 0/1).
// B11 (20 m) se remuestrea al vecino más cercano: el borde fino lo da el NDWI de 10 m.
const EVALSCRIPT_V2 = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B08", "B11", "SCL", "dataMask"] }],
    output: { id: "default", bands: 2, sampleType: "UINT16" },
    mosaicking: "SIMPLE",
  };
}
function evaluatePixel(s) {
  if (s.dataMask === 0 || s.SCL === 0 || s.SCL === 1 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10) return [0, 0];
  var n = (s.B03 - s.B08) / (s.B03 + s.B08 + 0.0001);
  var m = (s.B03 - s.B11) / (s.B03 + s.B11 + 0.0001);
  return [Math.max(1, Math.min(60000, Math.round((n + 1) * 30000))), Math.max(1, Math.min(60000, Math.round((m + 1) * 30000)))];
}
`;

/**
 * Decodifica PNG en gris (colorType 0) o gris+alfa (colorType 4), 8 o 16 bits,
 * a canales Uint16Array planos. Deno Edge Runtime no tiene lector PNG nativo.
 */
async function decodificaPng(buf: Uint8Array): Promise<{ canales: Uint16Array[]; width: number; height: number }> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== firma[i]) throw new Error("No es un PNG válido (firma no coincide)");
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = dv.getUint32(pos, false);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const ini = pos + 8;
    if (type === "IHDR") {
      width = dv.getUint32(ini, false); height = dv.getUint32(ini + 4, false);
      bitDepth = buf[ini + 8]; colorType = buf[ini + 9];
    } else if (type === "IDAT") idat.push(buf.slice(ini, ini + len));
    else if (type === "IEND") break;
    pos = ini + len + 4;
  }
  if (!width || !height) throw new Error("PNG sin IHDR legible");
  const nCan = colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if ((bitDepth !== 8 && bitDepth !== 16) || !nCan) throw new Error(`PNG con formato inesperado (bitDepth=${bitDepth} colorType=${colorType})`);

  const comprimido = new Uint8Array(idat.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of idat) { comprimido.set(c, off); off += c.length; }
  const ds = new DecompressionStream("deflate-raw");
  const w = ds.writable.getWriter();
  w.write(comprimido.slice(2, comprimido.length - 4));
  w.close();
  const crudo = new Uint8Array(await new Response(ds.readable).arrayBuffer());

  const bytesMuestra = bitDepth / 8;
  const bpp = bytesMuestra * nCan;
  const rowBytes = width * bpp;
  const filtrado = new Uint8Array(rowBytes * height);
  let prev = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const ft = crudo[y * (rowBytes + 1)];
    const row = filtrado.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const raw = crudo[y * (rowBytes + 1) + 1 + i];
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`Filtro PNG desconocido: ${ft}`);
      }
      row[i] = v & 0xff;
    }
    prev = row;
  }
  const canales = Array.from({ length: nCan }, () => new Uint16Array(width * height));
  for (let p = 0; p < width * height; p++) {
    for (let k = 0; k < nCan; k++) {
      const o = p * bpp + k * bytesMuestra;
      canales[k][p] = bytesMuestra === 2 ? (filtrado[o] << 8) | filtrado[o + 1] : filtrado[o];
    }
  }
  return { canales, width, height };
}

/** Pide el raster de UN día, en teselas ≤ MAX_PX_TESELA, y lo cose. */
async function pideRaster(
  provider: SentinelProvider, token: string, bbox: [number, number, number, number], W: number, H: number, dia: string,
): Promise<{ ndwi: Uint16Array; mndwi: Uint16Array }> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const tx = Math.ceil(W / MAX_PX_TESELA), ty = Math.ceil(H / MAX_PX_TESELA);
  const ndwi = new Uint16Array(W * H), mndwi = new Uint16Array(W * H);
  const desde = `${dia}T00:00:00Z`;
  const hasta = new Date(new Date(desde).getTime() + 86400000).toISOString();
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      const x0 = Math.floor((i * W) / tx), x1 = Math.floor(((i + 1) * W) / tx);
      const y0 = Math.floor((j * H) / ty), y1 = Math.floor(((j + 1) * H) / ty);
      const sub: [number, number, number, number] = [
        minLon + (x0 / W) * (maxLon - minLon), maxLat - (y1 / H) * (maxLat - minLat),
        minLon + (x1 / W) * (maxLon - minLon), maxLat - (y0 / H) * (maxLat - minLat),
      ];
      const r = await fetchConReintento(ENDPOINTS[provider].process, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          input: {
            bounds: { bbox: sub, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
            data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: desde, to: hasta }, mosaickingOrder: "mostRecent" } }],
          },
          output: { width: x1 - x0, height: y1 - y0, responses: [{ identifier: "default", format: { type: "image/png" } }] },
          evalscript: EVALSCRIPT_V2,
        }),
      });
      if (!r.ok) throw new Error(`Process API HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const { canales, width: tw, height: th } = await decodificaPng(new Uint8Array(await r.arrayBuffer()));
      if (tw !== x1 - x0 || th !== y1 - y0 || canales.length < 2) throw new Error(`Tesela con tamaño/canales inesperados (${tw}×${th}, ${canales.length})`);
      for (let y = 0; y < th; y++) {
        ndwi.set(canales[0].subarray(y * tw, (y + 1) * tw), (y0 + y) * W + x0);
        mndwi.set(canales[1].subarray(y * tw, (y + 1) * tw), (y0 + y) * W + x0);
      }
    }
  }
  return { ndwi, mndwi };
}

/** Relleno par-impar de anillos lon/lat sobre la malla (centro de píxel). */
function rasterizaPoligonos(anillos: Pt[][], bbox: [number, number, number, number], W: number, H: number): Uint8Array {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const M = new Uint8Array(W * H);
  const px = anillos.map((r) => r.map(([lon, lat]) => [((lon - minLon) / (maxLon - minLon)) * W - 0.5, ((maxLat - lat) / (maxLat - minLat)) * H - 0.5] as Pt));
  for (let y = 0; y < H; y++) {
    const xs: number[] = [];
    for (const r of px) {
      for (let i = 0; i < r.length; i++) {
        const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k])), b = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = a; x <= b; x++) M[y * W + x] = 1;
    }
  }
  return M;
}

/** Distancia chamfer 3-4 (en píxeles) a la máscara. */
function distanciaA(M: Uint8Array, W: number, H: number): Float32Array {
  const D = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) D[p] = M[p] ? 0 : 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; let v = D[p];
    if (x > 0) v = Math.min(v, D[p - 1] + 3);
    if (y > 0) { v = Math.min(v, D[p - W] + 3); if (x > 0) v = Math.min(v, D[p - W - 1] + 4); if (x < W - 1) v = Math.min(v, D[p - W + 1] + 4); }
    D[p] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; let v = D[p];
    if (x < W - 1) v = Math.min(v, D[p + 1] + 3);
    if (y < H - 1) { v = Math.min(v, D[p + W] + 3); if (x < W - 1) v = Math.min(v, D[p + W + 1] + 4); if (x > 0) v = Math.min(v, D[p + W - 1] + 4); }
    D[p] = v;
  }
  // Escala a píxeles DESPUÉS de ambos barridos (dividir dentro del barrido mezclaba valores ya escalados con otros sin escalar).
  for (let p = 0; p < W * H; p++) D[p] /= 3;
  return D;
}

/** Otsu sobre valores codificados (k·30000−30000 → índice) en los píxeles marcados; devuelve umbral y bimodalidad η. */
function otsu(raster: Uint16Array, region: Uint8Array): { t: number; eta: number; n: number } {
  const h = new Float64Array(256);
  let n = 0;
  for (let p = 0; p < raster.length; p++) {
    if (!region[p] || !raster[p]) continue;
    const idx = raster[p] / 30000 - 1;
    h[Math.max(0, Math.min(255, Math.round((idx + 1) * 127.5)))]++; n++;
  }
  if (n < 1000) return { t: NaN, eta: 0, n };
  let sum = 0, sum2 = 0;
  for (let i = 0; i < 256; i++) { sum += i * h[i]; sum2 += i * i * h[i]; }
  const varT = sum2 / n - (sum / n) ** 2;
  let sB = 0, wB = 0, best = 0, th = 127;
  for (let i = 0; i < 256; i++) {
    wB += h[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += i * h[i];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; th = i; }
  }
  return { t: th / 127.5 - 1, eta: varT > 0 ? best / (n * n) / varT : 0, n };
}

/**
 * Marching squares (tabla de Bourke) sobre un campo codificado; ensamblado por
 * clave de arista discreta. Sillas (casos 5/10) siempre UNEN el agua: coherente
 * con la conectividad 8 de la máscara (un brazo unido en diagonal no se parte).
 */
function marchingSquares(campo: Uint16Array, W: number, H: number, umbral: number): Pt[][] {
  const valorEn = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? campo[y * W + x] : 0);
  const siguienteDe = new Map<string, { pt: Pt; k: string }>();
  const interp = (pa: Pt, va: number, pb: Pt, vb: number): Pt => {
    const t = vb === va ? 0.5 : Math.max(0, Math.min(1, (umbral - va) / (vb - va)));
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const vTL = valorEn(x, y), vTR = valorEn(x + 1, y), vBR = valorEn(x + 1, y + 1), vBL = valorEn(x, y + 1);
      const caso = ((vTL > umbral ? 1 : 0) << 3) | ((vTR > umbral ? 1 : 0) << 2) | ((vBR > umbral ? 1 : 0) << 1) | (vBL > umbral ? 1 : 0);
      if (caso === 0 || caso === 15) continue;
      const pTL: Pt = [x, y], pTR: Pt = [x + 1, y], pBR: Pt = [x + 1, y + 1], pBL: Pt = [x, y + 1];
      const top = { pt: interp(pTL, vTL, pTR, vTR), k: `H,${x},${y}` };
      const bottom = { pt: interp(pBL, vBL, pBR, vBR), k: `H,${x},${y + 1}` };
      const left = { pt: interp(pTL, vTL, pBL, vBL), k: `V,${x},${y}` };
      const right = { pt: interp(pTR, vTR, pBR, vBR), k: `V,${x + 1},${y}` };
      const segs: [typeof top, typeof top][] = [];
      switch (caso) {
        case 1: segs.push([left, bottom]); break;
        case 2: segs.push([bottom, right]); break;
        case 3: segs.push([left, right]); break;
        case 4: segs.push([right, top]); break;
        case 5: segs.push([left, top], [right, bottom]); break;   // agua TR+BL unida
        case 6: segs.push([bottom, top]); break;
        case 7: segs.push([left, top]); break;
        case 8: segs.push([top, left]); break;
        case 9: segs.push([top, bottom]); break;
        case 10: segs.push([top, right], [bottom, left]); break;  // agua TL+BR unida
        case 11: segs.push([top, right]); break;
        case 12: segs.push([right, left]); break;
        case 13: segs.push([right, bottom]); break;
        case 14: segs.push([bottom, left]); break;
      }
      for (const [a, b] of segs) siguienteDe.set(a.k, b);
    }
  }
  const visitados = new Set<string>();
  const anillos: Pt[][] = [];
  for (const [k0] of siguienteDe) {
    if (visitados.has(k0)) continue;
    const anillo: Pt[] = [];
    let k = k0, cerrado = false, pasos = 0;
    while (pasos++ <= siguienteDe.size) {
      if (visitados.has(k)) break;
      visitados.add(k);
      const s = siguienteDe.get(k);
      if (!s) break;
      anillo.push(s.pt);
      if (s.k === k0) { cerrado = true; break; }
      k = s.k;
    }
    if (cerrado && anillo.length >= 4) anillos.push(anillo);
  }
  return anillos;
}

const areaFirmada = (a: Pt[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const [x1, y1] = a[i], [x2, y2] = a[(i + 1) % a.length]; s += x1 * y2 - x2 * y1; }
  return s / 2;
};

/** Douglas-Peucker sobre anillo cerrado (sin punto repetido). */
function douglasPeucker(anillo: Pt[], tol: number): Pt[] {
  if (anillo.length < 8) return anillo;
  // partir en el punto más lejano al primero para tener dos polilíneas abiertas
  let lejos = 0, dMax = -1;
  for (let i = 1; i < anillo.length; i++) { const d = (anillo[i][0] - anillo[0][0]) ** 2 + (anillo[i][1] - anillo[0][1]) ** 2; if (d > dMax) { dMax = d; lejos = i; } }
  const dp = (pts: Pt[]): Pt[] => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const pila: [number, number][] = [[0, pts.length - 1]];
    while (pila.length) {
      const [a, b] = pila.pop()!;
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      let im = -1, dm = tol;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > dm) { dm = d; im = i; } }
      if (im > 0) { keep[im] = 1; pila.push([a, im], [im, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const a = dp(anillo.slice(0, lejos + 1)), b = dp([...anillo.slice(lejos), anillo[0]]);
  return [...a, ...b.slice(1, -1)];
}

function perimetro(anillo: Pt[], mx: number, my: number): number {
  let t = 0;
  for (let i = 0; i < anillo.length; i++) { const [x1, y1] = anillo[i], [x2, y2] = anillo[(i + 1) % anillo.length]; t += Math.hypot((x2 - x1) * mx, (y2 - y1) * my); }
  return t;
}

interface Analisis {
  areaKm2: number; areaPixelesKm2: number; perimetroKm: number; numIslas: number; areaIslaMayorKm2: number | null;
  contorno: { type: "Polygon"; coordinates: Pt[][] }; vertices: number; tocaBorde: boolean;
  umbrales: { ndwi: number; mndwi: number; eta_ndwi: number; eta_mndwi: number; fijo: boolean };
  pixelesInvalidosRellenados: number; huellaExcedida: boolean;
}

/** Del raster de un día al polígono del vaso. */
function analiza(
  ndwi: Uint16Array, mndwi: Uint16Array, W: number, H: number, bbox: [number, number, number, number],
  anclaLonLat: { lon: number; lat: number }, huella: Uint8Array | null, indice: Indice, aperturaPx = APERTURA_PX,
): Analisis | { error: string } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const N = W * H;
  const mx = ((maxLon - minLon) * 111_320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)) / W;
  const my = ((maxLat - minLat) * M_POR_GRADO_LAT) / H;

  // Región para Otsu: huella dilatada 500 m (o todo el encuadre si no hay huella).
  let region: Uint8Array;
  let dHuella: Float32Array | null = null;
  if (huella) {
    dHuella = distanciaA(huella, W, H);
    const lim = 500 / RESOLUCION_M;
    region = new Uint8Array(N);
    for (let p = 0; p < N; p++) region[p] = dHuella[p] <= lim ? 1 : 0;
  } else region = new Uint8Array(N).fill(1);

  const oN = otsu(ndwi, region), oM = otsu(mndwi, region);
  const clamp = (v: number) => Math.max(OTSU_LIM[0], Math.min(OTSU_LIM[1], v));
  const fijo = !(oN.eta >= 0.5) || !(oM.eta >= 0.5) || !Number.isFinite(oN.t) || !Number.isFinite(oM.t);
  const tN = fijo ? UMBRAL_FIJO.ndwi : clamp(oN.t), tM = fijo ? UMBRAL_FIJO.mndwi : clamp(oM.t);

  // Campo continuo f (>0 = agua) codificado (f+1)·30000; 0 = inválido.
  const campo = new Uint16Array(N);
  const enc = (f: number) => Math.max(1, Math.min(60000, Math.round((f + 1) * 30000)));
  for (let p = 0; p < N; p++) {
    if (!ndwi[p]) continue;
    const fn = ndwi[p] / 30000 - 1 - tN, fm = mndwi[p] / 30000 - 1 - tM;
    campo[p] = enc(indice === "ndwi" ? fn : indice === "mndwi" ? fm : Math.max(fn, fm));
  }
  const UMB = 30000;

  // Huecos por nube DENTRO del agua: inválidos no alcanzables desde el borde por tierra/inválido → agua.
  const fuera = new Uint8Array(N), pila = new Int32Array(N);
  let k = 0;
  const empuja = (p: number) => { if (!fuera[p] && campo[p] <= UMB) { fuera[p] = 1; pila[k++] = p; } };
  for (let x = 0; x < W; x++) { empuja(x); empuja((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { empuja(y * W); empuja(y * W + W - 1); }
  while (k) {
    const p = pila[--k], x = p % W, y = (p / W) | 0;
    if (x > 0) empuja(p - 1); if (x < W - 1) empuja(p + 1); if (y > 0) empuja(p - W); if (y < H - 1) empuja(p + W);
  }
  let rellenados = 0;
  for (let p = 0; p < N; p++) if (!campo[p] && !fuera[p]) { campo[p] = UMB + 300; rellenados++; }

  // Mancha anclada, conectividad 8, limitada a la huella dilatada.
  const limHuella = DILATACION_HUELLA_M / RESOLUCION_M;
  const permitido = (p: number) => !dHuella || dHuella[p] <= limHuella;
  const ax = Math.round(((anclaLonLat.lon - minLon) / (maxLon - minLon)) * W - 0.5);
  const ay = Math.round(((maxLat - anclaLonLat.lat) / (maxLat - minLat)) * H - 0.5);
  let semilla = -1, mejor = Infinity;
  for (let r = 0; r <= 300 && semilla < 0; r += 5) {
    for (let y = Math.max(0, ay - r); y <= Math.min(H - 1, ay + r); y++) for (let x = Math.max(0, ax - r); x <= Math.min(W - 1, ax + r); x++) {
      const p = y * W + x;
      if (campo[p] > UMB) { const d = (x - ax) ** 2 + (y - ay) ** 2; if (d < mejor) { mejor = d; semilla = p; } }
    }
  }
  if (semilla < 0) return { error: "Sin agua cerca del ancla del vaso (¿escena nublada o ancla mal configurada?)." };
  const mancha = new Uint8Array(N);
  let huellaExcedida = false;
  k = 0; pila[k++] = semilla; mancha[semilla] = 1;
  let pixAgua = 0;
  while (k) {
    const p = pila[--k], x = p % W, y = (p / W) | 0;
    pixAgua++;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const q = yy * W + xx;
      if (mancha[q] || campo[q] <= UMB) continue;
      if (!permitido(q)) { huellaExcedida = true; continue; }
      mancha[q] = 1; pila[k++] = q;
    }
  }
  if (aperturaPx > 0) {
    // Apertura = erosión + dilatación con disco chamfer de radio r, y se vuelve a tomar la mancha anclada.
    const noAgua = new Uint8Array(N);
    for (let p = 0; p < N; p++) noAgua[p] = mancha[p] ? 0 : 1;
    const dTierra = distanciaA(noAgua, W, H);
    const erosion = new Uint8Array(N);
    for (let p = 0; p < N; p++) erosion[p] = dTierra[p] > aperturaPx ? 1 : 0;
    const dEros = distanciaA(erosion, W, H);
    const abierta = new Uint8Array(N);
    for (let p = 0; p < N; p++) abierta[p] = mancha[p] && dEros[p] <= aperturaPx ? 1 : 0;
    let s0 = semilla;
    if (!abierta[s0]) { let best = Infinity; for (let p = 0; p < N; p++) if (abierta[p]) { const d = ((p % W) - ax) ** 2 + (((p / W) | 0) - ay) ** 2; if (d < best) { best = d; s0 = p; } } }
    mancha.fill(0);
    pixAgua = 0;
    if (abierta[s0]) {
      k = 0; pila[k++] = s0; mancha[s0] = 1;
      while (k) {
        const p = pila[--k], x = p % W, y = (p / W) | 0;
        pixAgua++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (abierta[q] && !mancha[q]) { mancha[q] = 1; pila[k++] = q; }
        }
      }
    }
  }

  let tocaBorde = false;
  for (let x = 0; x < W && !tocaBorde; x++) if (mancha[x] || mancha[(H - 1) * W + x]) tocaBorde = true;
  for (let y = 0; y < H && !tocaBorde; y++) if (mancha[y * W] || mancha[y * W + W - 1]) tocaBorde = true;

  // Fuera de la mancha: el campo se baja apenas bajo el umbral (conserva la interpolación del borde real).
  for (let p = 0; p < N; p++) if (!mancha[p] && campo[p] > UMB) campo[p] = UMB - 1;

  const anillos = marchingSquares(campo, W, H, UMB);
  if (!anillos.length) return { error: "Vectorización sin resultado." };
  anillos.sort((a, b) => Math.abs(areaFirmada(b)) - Math.abs(areaFirmada(a)));
  const exterior = anillos[0];
  const signo = Math.sign(areaFirmada(exterior));
  const islas = anillos.slice(1).filter((a) => Math.sign(areaFirmada(a)) !== signo && Math.abs(areaFirmada(a)) >= MIN_PX_ISLA);

  const m2px = mx * my;
  const areaM2 = (Math.abs(areaFirmada(exterior)) - islas.reduce((s, a) => s + Math.abs(areaFirmada(a)), 0)) * m2px;
  const exteriorS = douglasPeucker(exterior, TOLERANCIA_DP_PX);
  const islasS = islas.map((a) => douglasPeucker(a, TOLERANCIA_DP_PX)).filter((a) => a.length >= 4);
  const perimetroM = perimetro(exteriorS, mx, my) + islasS.reduce((s, a) => s + perimetro(a, mx, my), 0);

  // Píxel → lon/lat en el CENTRO del píxel; exterior antihorario y agujeros horarios (RFC 7946).
  const aLonLat = (r: Pt[], antihorario: boolean): Pt[] => {
    let c = r.map(([x, y]) => [Number((minLon + ((x + 0.5) / W) * (maxLon - minLon)).toFixed(6)), Number((maxLat - ((y + 0.5) / H) * (maxLat - minLat)).toFixed(6))] as Pt);
    if ((areaFirmada(c) > 0) !== antihorario) c = c.reverse();
    return [...c, c[0]];
  };
  const coordinates = [aLonLat(exteriorS, true), ...islasS.map((a) => aLonLat(a, false))];
  return {
    areaKm2: areaM2 / 1e6,
    areaPixelesKm2: (pixAgua * m2px) / 1e6,
    perimetroKm: perimetroM / 1000,
    numIslas: islasS.length,
    areaIslaMayorKm2: islas.length ? Math.max(...islas.map((a) => Math.abs(areaFirmada(a)))) * m2px / 1e6 : null,
    contorno: { type: "Polygon", coordinates },
    vertices: coordinates.reduce((s, r) => s + r.length, 0),
    tocaBorde,
    umbrales: { ndwi: +tN.toFixed(3), mndwi: +tM.toFixed(3), eta_ndwi: +oN.eta.toFixed(3), eta_mndwi: +oM.eta.toFixed(3), fijo },
    pixelesInvalidosRellenados: rellenados,
    huellaExcedida,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const provider = resolverProvider();
    const CID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID"), CSEC = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL"), SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!CID || !CSEC) return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Autorización (mismo criterio que sentinel-ndvi-modulo-sync-v2 / process-hydric-doc): el cron con el secreto de
    // Vault, o un usuario con rol SRL (botón "Actualizar mes actual"). La clave anon es pública: no basta. Cualquier
    // error de auth, de perfil o de RPC = no autorizado.
    let autorizado = false;
    const secretoCron = req.headers.get("x-cron-secret");
    if (secretoCron) {
      const { data: valido, error: eSec } = await supabase.rpc("fn_vaso_sync_secreto_valido", { p_secreto: secretoCron });
      autorizado = !eSec && valido === true;
    }
    if (!autorizado) {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (jwt) {
        const { data: u, error: eUser } = await supabase.auth.getUser(jwt); // la anon key NO es un usuario
        if (!eUser && u?.user?.id) {
          const { data: perfil, error: ePerfil } = await supabase.from("perfiles_usuario").select("rol").eq("id", u.user.id).maybeSingle();
          autorizado = !ePerfil && perfil?.rol === "SRL";
        }
      }
    }
    if (!autorizado) return json({ error: "No autorizado: la actualización de la escena del vaso es solo para la S.R.L." }, 401);

    const body = await req.json().catch(() => ({}));
    const presaId: string = body?.presa_id || "PRE-001";
    const config = BBOXES_PRESA[presaId];
    if (!config) return json({ error: `Presa no configurada: ${presaId}. Disponibles: ${Object.keys(BBOXES_PRESA).join(", ")}` }, 400);
    const dryRun = body?.dry_run === true;
    // Parámetros de diagnóstico SOLO en dry_run: lo que se guarda usa siempre el método canónico (la función es
    // invocable con la clave anon — el cron la usa —, así que nadie puede persistir una variante del método).
    const indice: Indice = dryRun && ["ndwi", "mndwi", "union"].includes(body?.indice) ? body.indice : "union";

    // Ventana de búsqueda.
    let inicio: Date, fin: Date;
    const fechaRef: string | undefined = body?.fecha_referencia;
    const fechaExacta: string | undefined = body?.fecha;
    const mesParam: string | undefined = body?.mes;
    const esReferenciaHistorica = !!fechaRef && /^\d{4}-\d{2}-\d{2}$/.test(fechaRef);
    if (esReferenciaHistorica) {
      const c = new Date(fechaRef + "T00:00:00Z");
      inicio = new Date(c.getTime() - 45 * 86400000); fin = new Date(c.getTime() + 45 * 86400000);
    } else if (fechaExacta && /^\d{4}-\d{2}-\d{2}$/.test(fechaExacta)) {
      inicio = new Date(fechaExacta + "T00:00:00Z"); fin = new Date(inicio.getTime() + 86400000);
    } else if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
      const [a, m] = mesParam.split("-").map(Number);
      inicio = new Date(Date.UTC(a, m - 1, 1)); fin = new Date(Date.UTC(a, m, 1));
    } else {
      fin = new Date(); inicio = new Date(fin.getTime() - 30 * 86400000);
    }

    const bbox = (esReferenciaHistorica && config.bboxHistorico) ? config.bboxHistorico : config.bbox;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const latMedia = (minLat + maxLat) / 2;
    const anchoM = (maxLon - minLon) * 111_320 * Math.cos(latMedia * Math.PI / 180);
    const altoM = (maxLat - minLat) * M_POR_GRADO_LAT;
    const W = Math.round(anchoM / RESOLUCION_M), H = Math.round(altoM / RESOLUCION_M);
    const Ws = Math.round(anchoM / RES_SONDA_M), Hs = Math.round(altoM / RES_SONDA_M);

    const token = await obtenerAccessToken(provider, CID, CSEC);

    // Catalog: fechas candidatas (una por día).
    const rCat = await fetch(ENDPOINTS[provider].catalog, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        collections: ["sentinel-2-l2a"], datetime: `${inicio.toISOString()}/${fin.toISOString()}`, bbox, limit: 100,
        fields: { include: ["properties.datetime", "properties.eo:cloud_cover"], exclude: ["geometry", "assets", "links"] },
      }),
    });
    if (!rCat.ok) return json({ error: `Catalog API HTTP ${rCat.status}: ${await rCat.text()}` }, 502);
    const features: Array<{ properties?: { datetime?: string; "eo:cloud_cover"?: number } }> = (await rCat.json())?.features ?? [];
    const porDia = new Map<string, { datetime: string; nubes: number }>();
    for (const f of features) {
      const dt = f.properties?.datetime; if (!dt) continue;
      const dia = dt.slice(0, 10), nubes = f.properties?.["eo:cloud_cover"] ?? 100;
      const prev = porDia.get(dia);
      if (!prev || nubes < prev.nubes) porDia.set(dia, { datetime: dt, nubes }); // el tile más limpio del día como referencia
    }
    let candidatas = [...porDia.entries()].map(([dia, v]) => ({ dia, ...v })).filter((c) => c.nubes <= 60);
    candidatas = esReferenciaHistorica
      ? candidatas.sort((a, b) => a.nubes - b.nubes)
      : candidatas.sort((a, b) => b.dia.localeCompare(a.dia));
    if (body?.debug_catalogo === true) return json({ ok: true, debug: true, ventana: { desde: inicio.toISOString(), hasta: fin.toISOString() }, candidatas }, 200);
    if (!candidatas.length) {
      return json({ ok: true, insertado: false, presa_id: presaId, mensaje: `Sin escena Sentinel-2 en la ventana ${inicio.toISOString().slice(0, 10)}..${fin.toISOString().slice(0, 10)}.` }, 200);
    }

    // Huella del vaso: la escena vigente de mayor área (cualquier método).
    const { data: refHuella } = await supabase
      .from("vaso_geometria_historico").select("contorno_geojson, area_km2")
      .eq("presa_id", presaId).eq("vigente", true).eq("es_referencia_historica", esReferenciaHistorica)
      .order("area_km2", { ascending: false }).limit(1).maybeSingle();
    const anillosHuella: Pt[][] | null = refHuella?.contorno_geojson?.coordinates ? [refHuella.contorno_geojson.coordinates[0]] : null;

    // Sonda a 60 m: % de la huella sin dato válido, por día candidato.
    const huellaSonda = anillosHuella ? rasterizaPoligonos(anillosHuella, bbox, Ws, Hs) : new Uint8Array(Ws * Hs).fill(1);
    const totHuella = huellaSonda.reduce((s, v) => s + v, 0) || 1;
    const sondas: { dia: string; invalido_pct: number }[] = [];
    let elegido: { dia: string; datetime: string; nubes: number; invalido: number } | null = null;
    for (const c of candidatas.slice(0, MAX_SONDAS)) {
      const s = await pideRaster(provider, token, bbox, Ws, Hs, c.dia);
      let inv = 0;
      for (let p = 0; p < Ws * Hs; p++) if (huellaSonda[p] && !s.ndwi[p]) inv++;
      const pct = (100 * inv) / totHuella;
      sondas.push({ dia: c.dia, invalido_pct: +pct.toFixed(2) });
      if (pct <= UMBRAL_NUBES_VASO_PCT) { elegido = { ...c, invalido: pct }; break; }
    }
    if (!elegido) {
      return json({ ok: true, insertado: false, presa_id: presaId, mensaje: `Ningún día con ≤${UMBRAL_NUBES_VASO_PCT} % de la huella del vaso cubierta por nubes/sin dato.`, sondas }, 200);
    }

    // Raster de 10 m del día elegido.
    const { ndwi, mndwi } = await pideRaster(provider, token, bbox, W, H, elegido.dia);
    const huella = anillosHuella ? rasterizaPoligonos(anillosHuella, bbox, W, H) : null;
    let invH = 0, totH = 0;
    if (huella) for (let p = 0; p < W * H; p++) if (huella[p]) { totH++; if (!ndwi[p]) invH++; }
    const nubesVasoPct = huella && totH ? (100 * invH) / totH : elegido.invalido;

    const aperturaPx = dryRun && Number.isInteger(body?.apertura_px) && body.apertura_px >= 0 && body.apertura_px <= 6 ? body.apertura_px : APERTURA_PX;
    const res = analiza(ndwi, mndwi, W, H, bbox, config.ancla, huella, indice, aperturaPx);
    if ("error" in res) return json({ ok: true, insertado: false, presa_id: presaId, fecha: elegido.dia, mensaje: res.error, sondas }, 200);
    if (res.tocaBorde) {
      return json({ ok: true, insertado: false, presa_id: presaId, fecha: elegido.dia, mensaje: "El vaso toca el borde del encuadre — el polígono quedaría truncado. Ampliar BBOXES_PRESA.", area_km2: res.areaKm2, sondas }, 200);
    }

    const areaKm2 = Number(res.areaKm2.toFixed(3));
    const perimetroKm = Number(res.perimetroKm.toFixed(3));
    const areaM2 = areaKm2 * 1e6, perM = perimetroKm * 1000;
    const indiceCompacidad = perM > 0 ? (4 * Math.PI * areaM2) / (perM * perM) : null;
    const ratioElongacion = areaM2 > 0 ? perM / (2 * Math.PI * Math.sqrt(areaM2 / Math.PI)) : null;

    // KPI vs. escenas vigentes del ciclo (no referencia).
    let deltaArea: number | null = null, deltaPer: number | null = null, pctMax: number | null = null;
    if (!esReferenciaHistorica) {
      // Se excluye el MES de la escena: la vigente anterior de ese mes será reemplazada por esta al guardar.
      const inicioMes = `${elegido.dia.slice(0, 7)}-01T00:00:00-07:00`;
      const { data: anterior } = await supabase.from("vaso_geometria_historico").select("area_km2, perimetro_km, metodo")
        .eq("presa_id", presaId).eq("vigente", true).eq("es_referencia_historica", false)
        .lt("fecha_escena", inicioMes).order("fecha_escena", { ascending: false }).limit(1).maybeSingle();
      const { data: maxH } = await supabase.from("vaso_geometria_historico").select("area_km2")
        .eq("presa_id", presaId).eq("vigente", true).eq("es_referencia_historica", false)
        .lt("fecha_escena", inicioMes).order("area_km2", { ascending: false }).limit(1).maybeSingle();
      const maximo = Math.max(Number(maxH?.area_km2 ?? 0), areaKm2);
      deltaArea = anterior ? Number((areaKm2 - Number(anterior.area_km2)).toFixed(3)) : null;
      // El perímetro depende de la resolución/método: solo se compara entre escenas del mismo método.
      deltaPer = anterior && anterior.metodo === METODO ? Number((perimetroKm - Number(anterior.perimetro_km)).toFixed(3)) : null;
      pctMax = maximo > 0 ? Number(((areaKm2 / maximo) * 100).toFixed(1)) : null;
    }

    const fila = {
      presa_id: presaId,
      fecha_escena: elegido.datetime,
      fecha_pixeles: elegido.datetime,
      nubosidad_pct: elegido.nubes,
      cobertura_nubes_vaso_pct: Number(nubesVasoPct.toFixed(2)),
      area_km2: areaKm2,
      perimetro_km: perimetroKm,
      num_islas: res.numIslas,
      area_isla_mayor_km2: res.areaIslaMayorKm2 != null ? Number(res.areaIslaMayorKm2.toFixed(3)) : null,
      indice_compacidad: indiceCompacidad != null ? Number(indiceCompacidad.toFixed(4)) : null,
      ratio_elongacion: ratioElongacion != null ? Number(ratioElongacion.toFixed(2)) : null,
      delta_area_km2: deltaArea,
      delta_perimetro_km: deltaPer,
      pct_del_maximo_ciclo: pctMax,
      resolucion_m: RESOLUCION_M,
      bbox,
      contorno_geojson: res.contorno,
      es_referencia_historica: esReferenciaHistorica,
      metodo: METODO,
      parametros_metodo: {
        indice, umbrales: res.umbrales, apertura_px: aperturaPx, tolerancia_dp_px: TOLERANCIA_DP_PX, min_px_isla: MIN_PX_ISLA,
        dilatacion_huella_m: DILATACION_HUELLA_M, huella_excedida: res.huellaExcedida,
        area_pixeles_km2: Number(res.areaPixelesKm2.toFixed(3)), pixeles_nube_rellenados: res.pixelesInvalidosRellenados,
        vertices: res.vertices, raster: [W, H], sondas, provider,
      },
    };

    if (!dryRun) {
      const { error } = await supabase.rpc("fn_vaso_geometria_guardar", { p_fila: fila });
      if (error) return json({ error: `Guardado falló: ${error.message}` }, 500);
    }

    const { contorno_geojson: _c, ...resumen } = fila;
    return json({ ok: true, insertado: !dryRun, dry_run: dryRun, nombre_presa: config.nombre, ...resumen, ...(body?.con_geojson ? { contorno_geojson: res.contorno } : {}) }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
