// ═══════════════════════════════════════════════════════════════════════════
// rasterLogica — piezas PURAS de sentinel-ndvi-modulo-raster (sin Deno, sin red)
// ---------------------------------------------------------------------------
// Separadas de index.ts para poder probarlas con vitest: validación de mes,
// tamaño de imagen, evalscript, petición Process API, máscara del polígono y
// decodificación mínima del PNG (solo canal alfa) para calcular el % de
// píxeles válidos.
//
// IMPORTANTE (declararlo siempre junto a la imagen): es el NDVI de la
// FRONTERA del módulo, no de parcela. Incluye caminos, canales, poblados y
// suelo sin riego. Sirve para comparar entre años y ver el patrón espacial,
// no para evaluar un cultivo concreto.
// ═══════════════════════════════════════════════════════════════════════════

export type GeoJSONPolygon = { type: "Polygon"; coordinates: number[][][] };
export type GeoJSONMultiPolygon = { type: "MultiPolygon"; coordinates: number[][][][] };
export type Geom = GeoJSONPolygon | GeoJSONMultiPolygon;
/** CRS84: [minLon, minLat, maxLon, maxLat]. */
export type Bbox = [number, number, number, number];

export const METODO = "scl-mediana-v1";
export const MAX_CLOUD_COVERAGE = 60; // laxo por escena; la máscara SCL limpia por píxel (igual que la v2)
export const RESOLUCION_MIN_M = 20;
export const RESOLUCION_MAX_M = 60;
export const RESOLUCION_DEFECTO_M = 20;
/** Lado máximo objetivo de la imagen; la Process API admite hasta 2500 px por lado. */
export const MAX_PX_LADO = 900;
export const LIMITE_PROCESS_API_PX = 2500;
export const MES_INICIAL_SERIE = Date.UTC(2021, 2, 1); // 2021-03, inicio de la serie L2A usada

export const NOTA_FRONTERA =
  "NDVI de la frontera del módulo (incluye caminos, canales, poblados y suelo sin riego); no es NDVI de parcela. Úsese para comparar entre años y ver el patrón espacial.";

/**
 * Clases discretas: COPIA EXACTA de CLASES_NDVI (src/utils/ndviRampa.ts). Una prueba
 * (ndviRasterFuncion.test.ts) falla si divergen. `hasta` es el corte superior (exclusivo).
 */
export const CLASES_RASTER: { hasta: number; color: string }[] = [
  { hasta: 0.15, color: "#D9C9A0" }, // suelo
  { hasta: 0.3, color: "#B7C26E" },  // vigor bajo
  { hasta: 0.5, color: "#6FB15A" },  // vigor medio
  { hasta: 0.7, color: "#2E8B57" },  // vigor alto
  { hasta: Infinity, color: "#14532D" }, // vigor muy alto
];

/** Clases SCL excluidas: 0 sin dato, 1 saturado/defectuoso, 3 sombra de nube, 8-9 nube, 10 cirro, 11 nieve. */
export const SCL_EXCLUIDAS = [0, 1, 3, 8, 9, 10, 11];

// ── Mes ──────────────────────────────────────────────────────────────────────
export type ValidacionMes =
  | { ok: true; mes: string; inicio: Date; fin: Date }
  | { ok: false; error: string };

/** Mes válido (01–12), desde 2021-03 y ya cerrado (el mes en curso no se permite: cambia a diario y no se cachea). */
export function validarMes(mes: unknown, ahora: Date = new Date()): ValidacionMes {
  const texto = typeof mes === "string" ? mes : "";
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(texto);
  const msg = "mes inválido: usa AAAA-MM entre 2021-03 y el último mes cerrado";
  if (!m) return { ok: false, error: msg };
  const anio = Number(m[1]), mesNum = Number(m[2]);
  const inicioMs = Date.UTC(anio, mesNum - 1, 1);
  const primeroMesActual = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1);
  if (inicioMs < MES_INICIAL_SERIE || inicioMs >= primeroMesActual) return { ok: false, error: msg };
  return { ok: true, mes: texto, inicio: new Date(inicioMs), fin: new Date(Date.UTC(anio, mesNum, 1)) };
}

// ── Geometría y tamaño ───────────────────────────────────────────────────────
function poligonos(geom: Geom): number[][][][] {
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}

/** Bbox exacto del polígono, redondeado HACIA AFUERA a 6 decimales (nunca recorta el módulo). */
export function bboxDe(geom: Geom): Bbox {
  const pts = poligonos(geom).flatMap((p) => p[0]);
  const lons = pts.map((c) => c[0]), lats = pts.map((c) => c[1]);
  const f = 1e6;
  return [
    Math.floor(Math.min(...lons) * f) / f,
    Math.floor(Math.min(...lats) * f) / f,
    Math.ceil(Math.max(...lons) * f) / f,
    Math.ceil(Math.max(...lats) * f) / f,
  ];
}

export interface TamanoImagen { ancho: number; alto: number; resolucionM: number }

/**
 * Tamaño proporcional al bbox. Resolución efectiva ≥ 20 m (pedida acotada a 20–60 m) y se sube si el lado
 * mayor excedería MAX_PX_LADO (≈900 px). Nunca pasa de 2500 px (límite de la Process API).
 */
export function tamanoImagen(bbox: Bbox, resolucionSolicitadaM?: number): TamanoImagen {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const latMedia = (minLat + maxLat) / 2;
  const anchoM = (maxLon - minLon) * 111_320 * Math.cos((latMedia * Math.PI) / 180);
  const altoM = (maxLat - minLat) * 110_574;
  const pedida = Number.isFinite(Number(resolucionSolicitadaM)) && resolucionSolicitadaM != null
    ? Math.min(RESOLUCION_MAX_M, Math.max(RESOLUCION_MIN_M, Number(resolucionSolicitadaM)))
    : RESOLUCION_DEFECTO_M;
  const resolucionM = Math.max(pedida, Math.ceil(Math.max(anchoM, altoM) / MAX_PX_LADO));
  const ancho = Math.min(LIMITE_PROCESS_API_PX, Math.max(1, Math.ceil(anchoM / resolucionM)));
  const alto = Math.min(LIMITE_PROCESS_API_PX, Math.max(1, Math.ceil(altoM / resolucionM)));
  return { ancho, alto, resolucionM };
}

// ── Evalscript y petición ────────────────────────────────────────────────────
const rgbDeHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Evalscript: NDVI por observación válida (máscara SCL) → MEDIANA del mes por píxel (mosaicking ORBIT, igual
 * que el evalscript de la v2) → color de la clase discreta. Píxel sin observación válida → alfa 0 (transparente).
 */
export function construirEvalscript(): string {
  const cortes = CLASES_RASTER.slice(0, -1).map((c) => c.hasta);
  const colores = CLASES_RASTER.map((c) => rgbDeHex(c.color));
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    mosaicking: "ORBIT",
    output: { id: "default", bands: 4, sampleType: "UINT8" },
  };
}
var EXCLUIDAS = ${JSON.stringify(SCL_EXCLUIDAS)};
var CORTES = ${JSON.stringify(cortes)};
var COLORES = ${JSON.stringify(colores)};
function valida(s) {
  if (!s.dataMask) return false;
  return EXCLUIDAS.indexOf(s.SCL) === -1;
}
function evaluatePixel(samples) {
  var v = [];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (!valida(s)) continue;
    v.push((s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001));
  }
  if (v.length === 0) return [0, 0, 0, 0];
  v.sort(function (a, b) { return a - b; });
  var m = v.length >> 1;
  var med = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  var k = 0;
  while (k < CORTES.length && med >= CORTES[k]) k++;
  var c = COLORES[k];
  return [c[0], c[1], c[2], 255];
}
`;
}

export function construirPeticionProcess(p: { bbox: Bbox; ancho: number; alto: number; inicio: Date; fin: Date }) {
  return {
    input: {
      bounds: { bbox: p.bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
      data: [{
        type: "sentinel-2-l2a",
        dataFilter: {
          timeRange: { from: p.inicio.toISOString(), to: p.fin.toISOString() },
          maxCloudCoverage: MAX_CLOUD_COVERAGE,
        },
      }],
    },
    output: {
      width: p.ancho,
      height: p.alto,
      responses: [{ identifier: "default", format: { type: "image/png" } }],
    },
    evalscript: construirEvalscript(),
  };
}

export const claveCache = (mes: string, numeroModulo: number) => `${mes}/M${numeroModulo}.json`;

// ── Base64 ───────────────────────────────────────────────────────────────────
export function bytesABase64(bytes: Uint8Array): string {
  let bin = "";
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) bin += String.fromCharCode(...bytes.subarray(i, i + paso));
  return btoa(bin);
}

// ── Máscara del polígono (relleno por líneas de barrido, regla par-impar) ─────
/** 1 = el centro del píxel cae dentro del polígono (huecos incluidos por par-impar). */
export function mascaraPoligono(geom: Geom, bbox: Bbox, ancho: number, alto: number): Uint8Array {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const sx = ancho / (maxLon - minLon), sy = alto / (maxLat - minLat);
  const aristas: [number, number, number, number][] = [];
  for (const poly of poligonos(geom)) {
    for (const anillo of poly) {
      for (let i = 0; i < anillo.length - 1; i++) {
        const x0 = (anillo[i][0] - minLon) * sx, y0 = (maxLat - anillo[i][1]) * sy;
        const x1 = (anillo[i + 1][0] - minLon) * sx, y1 = (maxLat - anillo[i + 1][1]) * sy;
        if (y0 !== y1) aristas.push([x0, y0, x1, y1]);
      }
    }
  }
  const mascara = new Uint8Array(ancho * alto);
  for (let fila = 0; fila < alto; fila++) {
    const yc = fila + 0.5;
    const xs: number[] = [];
    for (const [x0, y0, x1, y1] of aristas) {
      if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const desde = Math.max(0, Math.ceil(xs[k] - 0.5)), hasta = Math.min(ancho - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let col = desde; col <= hasta; col++) mascara[fila * ancho + col] = 1;
    }
  }
  return mascara;
}

// ── PNG: solo el plano alfa (RGBA 8 bits, sin entrelazado) ───────────────────
async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/**
 * Plano alfa del PNG devuelto por la Process API. null si el formato no es el esperado (RGBA 8 bits, sin
 * entrelazado) o no coincide con el tamaño pedido: en ese caso pct_pixeles_validos queda null (S/D), nunca 0.
 */
export async function alfaDePng(png: Uint8Array, ancho: number, alto: number): Promise<Uint8Array | null> {
  try {
    const firma = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.length < 33 || firma.some((b, i) => png[i] !== b)) return null;
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    let pos = 8, w = 0, h = 0, prof = 0, tipo = -1, entrelazado = 0;
    const idat: Uint8Array[] = [];
    while (pos + 8 <= png.length) {
      const len = dv.getUint32(pos);
      const nombre = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
      const cuerpo = png.subarray(pos + 8, pos + 8 + len);
      if (nombre === "IHDR") {
        w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12);
        prof = png[pos + 16]; tipo = png[pos + 17]; entrelazado = png[pos + 20];
      } else if (nombre === "IDAT") idat.push(cuerpo);
      else if (nombre === "IEND") break;
      pos += 12 + len;
    }
    if (w !== ancho || h !== alto || prof !== 8 || tipo !== 6 || entrelazado !== 0 || !idat.length) return null;
    const total = idat.reduce((s, c) => s + c.length, 0);
    const comprimido = new Uint8Array(total);
    let o = 0;
    for (const c of idat) { comprimido.set(c, o); o += c.length; }
    const crudo = await inflar(comprimido);
    const bpp = 4, paso = 1 + w * bpp;
    if (crudo.length < paso * h) return null;
    const px = new Uint8Array(w * h * bpp);
    for (let y = 0; y < h; y++) {
      const filtro = crudo[y * paso];
      for (let i = 0; i < w * bpp; i++) {
        const x = crudo[y * paso + 1 + i];
        const a = i >= bpp ? px[y * w * bpp + i - bpp] : 0;
        const b = y > 0 ? px[(y - 1) * w * bpp + i] : 0;
        const c = i >= bpp && y > 0 ? px[(y - 1) * w * bpp + i - bpp] : 0;
        let v: number;
        if (filtro === 0) v = x;
        else if (filtro === 1) v = x + a;
        else if (filtro === 2) v = x + b;
        else if (filtro === 3) v = x + ((a + b) >> 1);
        else if (filtro === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        } else return null;
        px[y * w * bpp + i] = v & 255;
      }
    }
    const alfa = new Uint8Array(w * h);
    for (let i = 0; i < alfa.length; i++) alfa[i] = px[i * bpp + 3];
    return alfa;
  } catch {
    return null;
  }
}

/** Fracción (0–1) de píxeles DENTRO del polígono con dato. null si no hay píxeles dentro (S/D). */
export function fraccionValidos(alfa: Uint8Array, mascara: Uint8Array): number | null {
  let dentro = 0, validos = 0;
  for (let i = 0; i < mascara.length; i++) {
    if (!mascara[i]) continue;
    dentro++;
    if (alfa[i] > 0) validos++;
  }
  return dentro > 0 ? Number((validos / dentro).toFixed(4)) : null;
}
