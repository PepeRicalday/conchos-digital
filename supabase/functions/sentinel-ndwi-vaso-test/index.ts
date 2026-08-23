// ═══════════════════════════════════════════════════════════════════════════
// sentinel-ndwi-vaso-test — PRUEBA PUNTUAL: polígono de vaso de La Boquilla vía NDWI
// ---------------------------------------------------------------------------
// Función temporal de validación, NO para producción. A diferencia de la
// primera iteración (Statistical API, solo números), esta usa la Process API
// para bajar el RASTER crudo de la máscara binaria "esAgua" y vectorizarlo a
// un contorno GeoJSON — mismo algoritmo (borde 4-conectado + orden angular
// desde centroide) que ya usa src/utils/mapaSatelital.ts para el vaso
// aproximado sobre ArcGIS, pero aquí sobre NDWI real de Sentinel-2 (B03/B08).
//
// Process API devuelve PNG en escala de grises de 1 banda UINT8 (0/1) — se
// decodifica a mano (sin librería) porque Deno Edge Runtime no tiene un
// lector PNG nativo; el evalscript ya hace todo el trabajo de clasificación.
//
// Invocación: POST {} (bbox y umbral fijos para esta prueba puntual)
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OAUTH_TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";
const CATALOG_SEARCH_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

// Tercer ajuste: recortado al bbox REAL del vaso ya detectado (contorno
// exterior verificado: 22.2km x 7.8km) + 1km de margen en cada lado, en vez
// del radio de análisis genérico de VASOS_CONOCIDOS (radioKm=26 → 40x35km).
// Objetivo: caber bajo el límite de tamaño de imagen del Process API
// (~2500px/lado) a 10m/pixel NATIVO de Sentinel-2 B03/B08, en vez de los 20m
// usados hasta ahora (2416x983px a 10m — dentro del límite).
//
// Riesgo aceptado conscientemente: el margen de 1km es angosto. Si el nivel
// de llenado de La Boquilla sube significativamente sobre lo visto en esta
// escena (agosto 2026), el vaso podría extenderse más allá de esta ventana y
// la función subestimaría el área — a diferencia del bbox anterior (heredado
// del radio de 26km), que tenía margen amplio. Si esto se lleva a producción
// con corridas periódicas, hay que revisar este bbox contra el nivel NAMO
// real del vaso, no solo contra la escena puntual de esta prueba.
const BBOX_BOQUILLA = [-105.62477, 27.484151, -105.377838, 27.572157]; // [minLon, minLat, maxLon, maxLat]
const RESOLUCION_M = 10;
// Centro de ANCLA (VASOS_CONOCIDOS en mapaSatelital.ts) — no es el centroide
// del polígono de agua, es un punto de referencia genérico definido junto a
// un radioKm=26 para delimitar la ZONA de búsqueda. Su única función aquí es
// elegir la componente conexa correcta cuando hay más de un cuerpo de agua en
// el bbox (confirmado: "Lago Colina" aparece al noreste de La Boquilla) — por
// diseño puede caer fuera del polígono de agua real, especialmente en un vaso
// tan alargado y dendrítico como este, donde ningún punto único representa
// bien "el centro" visual de la forma.
const CENTRO_BOQUILLA = { lon: -105.4375, lat: 27.5517 };
// 0.0 (McFeeters puro) resultó demasiado laxo en la primera corrida: generó
// una mancha difusa que tocaba el borde del bbox en vez de la silueta
// dendrítica real del cañón inundado — confirmado contra el polígono real que
// ya pinta GeoMonitor con la capa Sentinel NDWI. 0.2 es el corte más común en
// la literatura para separar agua de vegetación húmeda/sombra de relieve.
const UMBRAL_NDWI = 0.2;

async function obtenerAccessToken(clientId: string, clientSecret: string): Promise<string> {
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
  if (!token) throw new Error("OAuth: respuesta sin access_token");
  return token;
}

// Salida de 1 banda UINT16 con el NDWI CONTINUO (no la máscara binaria):
// NDWI real está en [-1,1], se codifica como (ndwi+1)*30000 → rango
// [0,60000] dentro de UINT16 (máx 65535), con margen para no saturar en el
// extremo superior. Devolver el valor continuo (no solo 0/1) es lo que
// habilita interpolación subpíxel del borde en trazaContornoMarchingSquares:
// con máscara binaria pura, el borde solo puede caer en múltiplos de 0.5
// píxel (punto medio fijo de cada arista de celda); con el valor real de
// NDWI en cada esquina se puede calcular en qué fracción exacta de la arista
// el valor cruza el umbral — ganancia de precisión de borde sin pedir más
// resolución de píxel al sensor.
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
 * Decodifica un PNG en escala de grises (8 o 16 bits, sin interlace — formato
 * que devuelve Sentinel Hub Process API para sampleType UINT8/UINT16,
 * format image/png) a un Uint16Array plano de W*H con el valor real de cada
 * píxel. Usa DecompressionStream("deflate-raw") nativo de Deno para el
 * filtro zlib del IDAT — sin depender de una librería PNG.
 *
 * bitDepth=16 es necesario para NDWI continuo (ver EVALSCRIPT_MASCARA):
 * un PNG de 16 bits filtra en unidades de 2 bytes ("bpp"=2) — Sub/Up/Average/
 * Paeth operan sobre el píxel anterior de 16 bits, no byte a byte como en
 * 8-bit — así que el filtrado no es un simple cambio de ancho de dato.
 */
async function decodificaPngGris(buf: Uint8Array): Promise<{ data: Uint16Array; width: number; height: number; bitDepth: number }> {
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
    pos = dataStart + len + 4; // +4 = CRC
  }
  if (!width || !height) throw new Error("PNG sin IHDR legible");
  if ((bitDepth !== 8 && bitDepth !== 16) || colorType !== 0) {
    throw new Error(`PNG con formato inesperado (bitDepth=${bitDepth} colorType=${colorType}, se esperaba gris 8 o 16 bit)`);
  }

  const comprimido = new Uint8Array(idatChunks.reduce((s, c) => s + c.length, 0));
  let off = 0;
  for (const c of idatChunks) { comprimido.set(c, off); off += c.length; }

  // El stream de IDAT es zlib (RFC 1950): 2 bytes de cabecera + deflate + 4 de adler32.
  const deflateRaw = comprimido.slice(2, comprimido.length - 4);
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(deflateRaw);
  writer.close();
  const descomprimido = new Uint8Array(await new Response(ds.readable).arrayBuffer());

  const bpp = bitDepth === 16 ? 2 : 1; // bytes por píxel, para el filtro PNG
  const rowBytes = width * bpp;
  const stride = rowBytes + 1; // +1 byte de tipo de filtro al inicio de cada fila
  const filtrado = new Uint8Array(width * height * bpp); // fila desfiltrada, sin el byte de filtro
  let prevRow = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const filterType = descomprimido[y * stride];
    const row = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const raw = descomprimido[y * stride + 1 + i];
      const a = i >= bpp ? row[i - bpp] : 0;       // mismo canal, píxel anterior
      const b = prevRow[i];                          // mismo canal, fila anterior
      const c = i >= bpp ? prevRow[i - bpp] : 0;     // mismo canal, fila y píxel anterior
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

  // Ensambla bytes filtrados en valores de píxel: 1 byte/canal en 8-bit,
  // 2 bytes big-endian/canal en 16-bit (orden de PNG, RFC 2083 §2.3).
  const data = new Uint16Array(width * height);
  if (bitDepth === 16) {
    for (let p = 0; p < width * height; p++) {
      data[p] = (filtrado[p * 2] << 8) | filtrado[p * 2 + 1];
    }
  } else {
    for (let p = 0; p < width * height; p++) data[p] = filtrado[p];
  }
  return { data, width, height, bitDepth };
}

/**
 * Extrae el contorno del borde con MARCHING SQUARES (no seguimiento de vecino
 * píxel a píxel). El intento anterior (Moore-neighbor tracing) fallaba en esta
 * geometría dendrítica: en formas con brazos delgados, "girar pegado al último
 * contacto con el fondo" puede zigzaguear indefinidamente entre píxeles antes
 * de reconocer el cierre — llegó a recorrer 945,907 pasos en un raster de
 * ~944k píxeles sin agotar limpiamente, y una vez agotó los recursos del
 * worker por completo.
 *
 * Marching squares es estructuralmente distinto: recorre CELDAS de 2x2 entre
 * píxeles (no píxeles), y cada celda aporta a lo sumo 2 segmentos de borde
 * según cuáles de sus 4 esquinas son agua — sin ambigüedad de "hacia dónde
 * girar". El total de segmentos está acotado por (W-1)*(H-1), así que no hay
 * riesgo de loop largo. Los segmentos se ensamblan en un anillo con un mapa
 * punto-inicial→punto-final (cada punto de borde solo puede tener una
 * continuación posible en un contorno simple, así que el ensamblado es lineal).
 */
function trazaContornoMarchingSquares(
  ndwiRaster: Uint16Array, W: number, H: number, umbralCodificado: number,
): {
  exterior: [number, number][]; islas: [number, number][][]; debugAreas: number[];
  causasRuptura: { tipo: string; k: string; anilloLen: number }[];
  debugColisiones: { x: number; y: number; caso: number; arista: string; previoDestino: string; nuevoDestino: string }[];
  debugCeldaInfo: any[];
} {
  // Valor NDWI codificado en cada esquina (fuera de raster = muy por debajo
  // del umbral, para que el borde del raster se trate como "no agua").
  const valorEn = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H ? ndwiRaster[y * W + x] : 0;

  // La clave de identidad de cada punto de cruce NO es su coordenada
  // flotante interpolada — es la arista discreta de la rejilla que lo
  // contiene ("arista horizontal en fila y, entre columnas x y x+1" o
  // "arista vertical en columna x, entre filas y y y+1"). Esa identidad es
  // idéntica sin importar desde qué celda vecina se calcule, así que dos
  // celdas que comparten una arista SIEMPRE producen la misma clave — a
  // diferencia de indexar por el resultado flotante de interp(), que puede
  // diferir en el último bit entre dos caminos de cálculo matemáticamente
  // equivalentes y rompe el encadenamiento (causa real de que el anillo
  // exterior de miles de segmentos no cerrara en el intento anterior).
  //
  // "H0,x,y" = arista horizontal (top de la celda (x,y) == bottom de (x,y-1))
  // "V0,x,y" = arista vertical   (left de la celda (x,y) == right de (x-1,y))
  type Pt = [number, number];
  const claveH = (x: number, y: number) => `H,${x},${y}`;
  const claveV = (x: number, y: number) => `V,${x},${y}`;
  const siguienteDe = new Map<string, { pt: Pt; k: string }>();
  const debugColisiones: { x: number; y: number; caso: number; arista: string; previoDestino: string; nuevoDestino: string }[] = [];
  // Diagnóstico quirúrgico: captura el detalle completo de la celda en
  // conflicto (808,201) Y su vecina de arriba (808,200), que comparten la
  // arista H,808,201 — para comparar ambos casos y sus 4 esquinas reales en
  // vez de razonar sobre geometría de celda unitaria idealizada.
  const CELDAS_DEBUG = [{ x: 808, y: 201 }, { x: 808, y: 200 }];
  const debugCeldaInfo: any[] = [];

  // Interpola linealmente el punto donde el NDWI cruza el umbral entre dos
  // esquinas de valores va/vb en las posiciones pa/pb — esto es lo que gana
  // precisión de borde real frente al punto medio fijo (0.5) de una máscara
  // binaria: si el agua "gana" por poco (va apenas sobre el umbral) el borde
  // se dibuja cerca de pa, no a medio camino arbitrario.
  const interp = (pa: Pt, va: number, pb: Pt, vb: number): Pt => {
    const t = vb === va ? 0.5 : (umbralCodificado - va) / (vb - va);
    const tc = Math.max(0, Math.min(1, t));
    return [pa[0] + (pb[0] - pa[0]) * tc, pa[1] + (pb[1] - pa[1]) * tc];
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      // Esquinas de la celda (x,y)-(x+1,y+1): TL, TR, BR, BL.
      const vTL = valorEn(x, y), vTR = valorEn(x + 1, y);
      const vBR = valorEn(x + 1, y + 1), vBL = valorEn(x, y + 1);
      const tl = vTL > umbralCodificado ? 1 : 0;
      const tr = vTR > umbralCodificado ? 1 : 0;
      const br = vBR > umbralCodificado ? 1 : 0;
      const bl = vBL > umbralCodificado ? 1 : 0;
      const caso = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caso === 0 || caso === 15) continue; // celda totalmente fuera o dentro: sin borde

      // Esquinas en coords de píxel reales.
      const pTL: Pt = [x, y], pTR: Pt = [x + 1, y];
      const pBR: Pt = [x + 1, y + 1], pBL: Pt = [x, y + 1];

      // Puntos de cruce interpolados en cada arista de la celda, con su
      // clave de rejilla (compartida con la celda vecina que toca la misma
      // arista física). "top" de esta celda es la MISMA arista que "bottom"
      // de la celda (x,y-1) → misma clave claveH(x,y).
      const top = { pt: interp(pTL, vTL, pTR, vTR), k: claveH(x, y) };
      const bottom = { pt: interp(pBL, vBL, pBR, vBR), k: claveH(x, y + 1) };
      const left = { pt: interp(pTL, vTL, pBL, vBL), k: claveV(x, y) };
      const right = { pt: interp(pTR, vTR, pBR, vBR), k: claveV(x + 1, y) };

      // Tabla de marching squares (16 casos) — verificada contra la tabla
      // canónica de Bourke (referencia estándar de la literatura) caso por
      // caso, comparando explícitamente contra la tabla anterior de este
      // archivo: los 14 casos no ambiguos estaban con origen/destino
      // INVERTIDOS respecto a Bourke (confirmado imprimiendo ambas tablas
      // lado a lado — 0/14 coincidían). Esa inversión sistemática no
      // impedía cerrar la MAYORÍA de los anillos (un círculo recorrido en el
      // sentido "equivocado" también es un círculo válido en aislamiento),
      // pero rompía el encadenamiento exactamente en las fronteras entre una
      // celda ambigua (5/10) y una celda simple vecina que comparten una
      // arista — causa raíz confirmada con datos reales: celda (808,200)
      // caso 1 y celda (808,201) caso 10 generaban AMBAS un segmento con
      // origen en la arista compartida H,808,201, pisándose en el mapa.
      const segmentos: [typeof top, typeof top][] = [];
      const promedioCentro = (vTL + vTR + vBR + vBL) / 4;
      switch (caso) {
        case 1: segmentos.push([left, bottom]); break;
        case 2: segmentos.push([bottom, right]); break;
        case 3: segmentos.push([left, right]); break;
        case 4: segmentos.push([right, top]); break;
        case 5:
          // Ambiguo (TR+BL agua). Rama principal (Bourke): TL,BR tratados
          // como una sola región de "no-agua" conectada → [left,top] +
          // [right,bottom]. Rama alternativa: TR y BL como componentes
          // separadas (cada una su propio caso simple, 4 y 1) → [right,top]
          // + [left,bottom]. El asymptotic decider elige según el centro.
          if (promedioCentro > umbralCodificado) { segmentos.push([left, top]); segmentos.push([right, bottom]); }
          else { segmentos.push([right, top]); segmentos.push([left, bottom]); }
          break;
        case 6: segmentos.push([bottom, top]); break;
        case 7: segmentos.push([left, top]); break;
        case 8: segmentos.push([top, left]); break;
        case 9: segmentos.push([top, bottom]); break;
        case 10:
          // Ambiguo (TL+BR agua). Rama principal (Bourke): TL,BR conectados
          // → [top,right] + [bottom,left]. Rama alternativa: TL y BR como
          // componentes separadas (casos simples 8 y 2) → [top,left] +
          // [bottom,right].
          if (promedioCentro > umbralCodificado) { segmentos.push([top, right]); segmentos.push([bottom, left]); }
          else { segmentos.push([top, left]); segmentos.push([bottom, right]); }
          break;
        case 11: segmentos.push([top, right]); break;
        case 12: segmentos.push([right, left]); break;
        case 13: segmentos.push([right, bottom]); break;
        case 14: segmentos.push([bottom, left]); break;
      }
      if (CELDAS_DEBUG.some(c => c.x === x && c.y === y)) {
        debugCeldaInfo.push({
          x, y, caso, vTL, vTR, vBR, vBL, umbralCodificado, promedioCentro,
          segmentos: segmentos.map(([a, b]) => ({ origen: a.k, origenPt: a.pt, destino: b.k, destinoPt: b.pt })),
        });
      }
      for (const [a, b] of segmentos) {
        // Diagnóstico: si dos celdas distintas generan un segmento con la
        // MISMA arista como origen, la segunda sobreescribe a la primera en
        // el mapa — se pierde la conexión de la primera celda, que es
        // exactamente el tipo de bug que rompería el anillo exterior justo
        // antes de cerrar. No debería ocurrir en un contorno topológicamente
        // simple (cada arista de cruce tiene un único "siguiente" posible).
        if (siguienteDe.has(a.k) && debugColisiones.length < 15) {
          debugColisiones.push({ x, y, caso, arista: a.k, previoDestino: siguienteDe.get(a.k)!.k, nuevoDestino: b.k });
        }
        siguienteDe.set(a.k, b);
      }
    }
  }

  if (siguienteDe.size === 0) return { exterior: [], islas: [], debugAreas: [], causasRuptura: [], debugColisiones: [], debugCeldaInfo: [] };

  // Ensambla TODOS los anillos, no solo el más largo: con celdas ambiguas
  // (5, 10) separadas en 2 segmentos independientes hay un anillo por cada
  // frontera cerrada — el contorno exterior Y un anillo por cada isla
  // (parche de tierra) dentro del vaso. El más largo es el exterior por
  // construcción (su perímetro envuelve al resto); todos los demás con
  // suficiente tamaño son islas reales.
  const visitados = new Set<string>();
  const anillos: Pt[][] = [];
  let fragmentosAbiertos = 0;
  // Diagnóstico: causa exacta de las primeras rupturas, para distinguir
  // "sin continuación en el mapa" (caso ambiguo mal manejado) de "chocó con
  // otro anillo ya visitado" (anillos que se cruzan, no debería pasar en un
  // contorno topológicamente simple).
  const causasRuptura: { tipo: string; k: string; anilloLen: number }[] = [];
  for (const [k0] of siguienteDe) {
    if (visitados.has(k0)) continue;
    const anillo: Pt[] = [];
    let k = k0;
    const inicioK = k0;
    let pasos = 0;
    const maxPasos = siguienteDe.size + 1;
    let cerrado = false;
    while (pasos++ < maxPasos) {
      if (visitados.has(k)) {
        if (causasRuptura.length < 10) causasRuptura.push({ tipo: "choque_con_otro_anillo", k, anilloLen: anillo.length });
        break;
      }
      visitados.add(k);
      const siguiente = siguienteDe.get(k);
      if (!siguiente) {
        if (causasRuptura.length < 10) causasRuptura.push({ tipo: "sin_continuacion", k, anilloLen: anillo.length });
        break;
      }
      anillo.push(siguiente.pt);
      if (siguiente.k === inicioK) { cerrado = true; break; } // volvió a la arista de partida: anillo válido
      k = siguiente.k;
    }
    // Solo se acepta un anillo que efectivamente CERRÓ sobre sí mismo. Un
    // fragmento que rompe (choca con otro anillo, o queda sin continuación)
    // no es un contorno válido — dibujarlo como polígono cerrado (el `Z` de
    // SVG conecta el último punto con el primero en línea recta) produce
    // exactamente el artefacto de "línea diagonal atravesando la forma" que
    // se vio en el mapa: antes se aceptaba cualquier fragmento de ≥4 puntos
    // sin verificar que hubiera cerrado limpio.
    if (cerrado && anillo.length >= 4) anillos.push(anillo);
    else if (anillo.length > 0) fragmentosAbiertos++;
  }
  if (!anillos.length) return { exterior: [], islas: [], debugAreas: [fragmentosAbiertos], causasRuptura, debugColisiones, debugCeldaInfo };

  anillos.sort((a, b) => b.length - a.length);
  const [masLargo, ...resto] = anillos;

  // Área de un anillo por la fórmula del shoelace, ya en píxeles² reales
  // (las coordenadas son de punto flotante en unidades de píxel, no "x2").
  const areaAnillo = (a: Pt[]) => {
    let s = 0;
    for (let i = 0; i < a.length - 1; i++) s += a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1];
    return Math.abs(s) / 2;
  };
  // Umbral de área, no de número de vértices. Verificado contra el raster
  // real: la isla candidata más chica que aparece mide 124 píxeles reales
  // (~5 ha a 20m/pixel) — es decir, todas las islas que sobreviven al
  // ensamblado de anillos son geográficamente reales (peñoles/lomeríos del
  // cañón inundado), no ruido de clasificación de 1-3 píxeles NDWI. El
  // umbral queda bajo (3 px) solo para filtrar fragmentos degenerados de
  // celdas ambiguas aisladas, no para recortar islas reales.
  const MIN_PX_ISLA = 3;

  const islasFiltradas = resto.filter(a => areaAnillo(a) >= MIN_PX_ISLA);
  return {
    exterior: masLargo,
    islas: islasFiltradas,
    debugAreas: [fragmentosAbiertos, ...resto.map(a => Number(areaAnillo(a).toFixed(2)))],
    causasRuptura,
    debugColisiones,
    debugCeldaInfo,
  };
}

/** Reduce el número de vértices por muestreo uniforme, preservando el orden real del trazado. */
function submuestrea(puntos: [number, number][], maxPuntos = 400): [number, number][] {
  if (puntos.length <= maxPuntos) return puntos;
  const paso = puntos.length / maxPuntos;
  const salida: [number, number][] = [];
  for (let i = 0; i < maxPuntos; i++) salida.push(puntos[Math.floor(i * paso)]);
  salida.push(salida[0]); // cierra el anillo
  return salida;
}

/**
 * Suaviza un anillo cerrado con el algoritmo de Chaikin (corte de esquinas):
 * cada arista original se reemplaza por 2 puntos al 25%/75% de su longitud,
 * redondeando el efecto "escalera" propio de un contorno extraído de raster
 * sin cambiar la topología ni desplazar la forma general — a diferencia de un
 * promedio simple, no puede "cortar" un brazo delgado del embalse porque
 * cada iteración solo se acerca a la línea recta entre esquinas consecutivas,
 * nunca salta a un punto lejano. 2 iteraciones son suficientes para quitar el
 * dentado más visible sin licuar la forma dendrítica real.
 */
function suavizaChaikin(anillo: [number, number][], iteraciones = 2): [number, number][] {
  let pts = anillo;
  for (let it = 0; it < iteraciones; it++) {
    if (pts.length < 4) break;
    const n = pts.length - 1; // el último punto == el primero (anillo cerrado)
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      out.push([x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25]);
      out.push([x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75]);
    }
    out.push(out[0]); // recierra el anillo
    pts = out;
  }
  return pts;
}

/**
 * Componente conexa que CONTIENE el píxel más cercano al centro conocido del
 * vaso (vecindad 4). No usa "la más grande" a secas: la primera corrida sobre
 * un bbox de 40x35km reveló un segundo cuerpo de agua real dentro de la
 * ventana ("Lago Colina", noreste de La Boquilla) — con un bbox más generoso
 * o distinta cobertura de nubes, ese otro cuerpo podría superar en tamaño al
 * vaso objetivo y robarle el resultado. Anclar por proximidad al centro
 * conocido es el mismo criterio que ya usa mascaraVasos() en
 * src/utils/mapaSatelital.ts (cercaDeVaso), aplicado aquí a nivel de
 * componente conexa en vez de por píxel individual.
 */
function manchaCercaDelCentro(
  mascara: Uint8Array, W: number, H: number,
  centroPx: { x: number; y: number },
): Uint8Array {
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
      const d = (x - centroPx.x) ** 2 + (y - centroPx.y) ** 2;
      if (d < distMinBlob) distMinBlob = d;
      if (x > 0 && mascara[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila[tope++] = p - 1; }
      if (x < W - 1 && mascara[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila[tope++] = p + 1; }
      if (y > 0 && mascara[p - W] && !visto[p - W]) { visto[p - W] = 1; pila[tope++] = p - W; }
      if (y < H - 1 && mascara[p + W] && !visto[p + W]) { visto[p + W] = 1; pila[tope++] = p + W; }
    }
    // Entre blobs candidatos, gana el que tiene el píxel más cercano al
    // centro conocido — no el más grande. Descarta manchas triviales (<50px,
    // ruido disperso tipo nube/sombra puntual) aunque queden más cerca.
    if (blob.length >= 50 && distMinBlob < mejorDist) {
      mejorDist = distMinBlob;
      mejorBlob = blob;
    }
  }
  const salida = new Uint8Array(N);
  for (const p of mejorBlob) salida[p] = 1;
  return salida;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const CLIENT_ID = Deno.env.get("SENTINEL_OAUTH_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("SENTINEL_OAUTH_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json({ error: "SENTINEL_OAUTH_CLIENT_ID / SENTINEL_OAUTH_CLIENT_SECRET no configurados" }, 500);
    }

    const token = await obtenerAccessToken(CLIENT_ID, CLIENT_SECRET);

    const fin = new Date();
    const inicio = new Date(fin.getTime() - 30 * 86400000);

    const [minLon, minLat, maxLon, maxLat] = BBOX_BOQUILLA;
    const latMedia = (minLat + maxLat) / 2;
    const mPorGradoLon = 111_320 * Math.cos(latMedia * Math.PI / 180);
    const mPorGradoLat = 110_574;
    const anchoM = (maxLon - minLon) * mPorGradoLon;
    const altoM = (maxLat - minLat) * mPorGradoLat;
    const width = Math.round(anchoM / RESOLUCION_M);
    const height = Math.round(altoM / RESOLUCION_M);

    // Fecha real de la escena: el Process API con salida PNG NO devuelve
    // metadata, solo el raster de píxeles — sin esta consulta aparte no hay
    // forma de saber de qué día es la imagen que se está vectorizando.
    // Mismo patrón que sentinel-catalog-search: Catalog API con el mismo
    // bbox/ventana/maxCloudCoverage y orden por menor nubosidad (leastCC),
    // para que la escena reportada sea la MISMA que mosaickingOrder:leastCC
    // eligió en el Process API de abajo, no una búsqueda independiente que
    // podría resolver a otra fecha.
    let fechaEscena: string | null = null;
    let nubosidadEscena: number | null = null;
    try {
      const catalogBody = {
        collections: ["sentinel-2-l2a"],
        datetime: `${inicio.toISOString()}/${fin.toISOString()}`,
        bbox: BBOX_BOQUILLA,
        limit: 20,
        fields: {
          include: ["properties.datetime", "properties.eo:cloud_cover"],
          exclude: ["geometry", "assets", "links"],
        },
      };
      const rCat = await fetch(CATALOG_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(catalogBody),
      });
      if (rCat.ok) {
        const catalogo = await rCat.json();
        const features: Array<{ properties?: { datetime?: string; "eo:cloud_cover"?: number } }> =
          catalogo?.features ?? [];
        const conCC = features.filter(f => (f.properties?.["eo:cloud_cover"] ?? 100) <= 20);
        const candidatas = conCC.length ? conCC : features;
        const elegida = [...candidatas].sort((a, b) => {
          const ca = a.properties?.["eo:cloud_cover"] ?? 100, cb = b.properties?.["eo:cloud_cover"] ?? 100;
          return ca - cb;
        })[0];
        fechaEscena = elegida?.properties?.datetime ?? null;
        nubosidadEscena = elegida?.properties?.["eo:cloud_cover"] ?? null;
      }
    } catch {
      // No bloquea el resultado principal si el Catalog API falla — la
      // vectorización sigue siendo válida, solo queda sin fecha reportada.
    }

    const reqBody = {
      input: {
        bounds: {
          bbox: BBOX_BOQUILLA,
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        },
        data: [{
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: { from: inicio.toISOString(), to: fin.toISOString() },
            maxCloudCoverage: 20,
            mosaickingOrder: "leastCC",
          },
        }],
      },
      output: {
        width,
        height,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript: EVALSCRIPT_MASCARA,
    };

    const r = await fetch(PROCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(reqBody),
    });
    if (!r.ok) {
      return json({ error: `Process API HTTP ${r.status}: ${await r.text()}`, bbox: BBOX_BOQUILLA, width, height }, 502);
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    const { data: ndwiRaster, width: W, height: H } = await decodificaPngGris(buf);
    // Umbral NDWI codificado en la misma escala UINT16 que el evalscript
    // (ver EVALSCRIPT_MASCARA: codificado = (ndwi+1)*30000).
    const umbralCodificado = Math.round((UMBRAL_NDWI + 1) * 30000);

    // Máscara binaria derivada del raster continuo — necesaria para el
    // algoritmo de componente conexa (manchaCercaDelCentro), que opera por
    // vecindad de píxeles discretos, no sobre valores continuos.
    const mascaraCruda = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) mascaraCruda[p] = ndwiRaster[p] > umbralCodificado ? 1 : 0;

    // Debug: además de vectorizar, devuelve la máscara cruda como grid de 0/1
    // en base64 (1 char por pixel, muestreado a un tamaño manejable) para
    // poder pintarla y compararla visualmente contra el polígono real que ya
    // muestra GeoMonitor, en vez de inferir el problema solo de los números.
    const DEBUG_MAX_DIM = 200;
    const stepX = Math.max(1, Math.floor(W / DEBUG_MAX_DIM));
    const stepY = Math.max(1, Math.floor(H / DEBUG_MAX_DIM));
    const debugRows: string[] = [];
    for (let y = 0; y < H; y += stepY) {
      let row = "";
      for (let x = 0; x < W; x += stepX) {
        row += mascaraCruda[y * W + x] ? "1" : "0";
      }
      debugRows.push(row);
    }

    const pixelesAguaTotal = mascaraCruda.reduce((s: number, v: number) => s + v, 0);
    const centroPx = {
      x: ((CENTRO_BOQUILLA.lon - minLon) / (maxLon - minLon)) * W,
      y: (1 - (CENTRO_BOQUILLA.lat - minLat) / (maxLat - minLat)) * H,
    };
    const mascaraPrincipal = manchaCercaDelCentro(mascaraCruda, W, H, centroPx);
    const pixelesVaso = mascaraPrincipal.reduce((s: number, v: number) => s + v, 0);

    const m2PorPixel = RESOLUCION_M * RESOLUCION_M;
    const areaVasoKm2 = (pixelesVaso * m2PorPixel) / 1_000_000;
    const areaAguaTotalKm2 = (pixelesAguaTotal * m2PorPixel) / 1_000_000;

    // Enmascara el raster NDWI CONTINUO con la selección de componente conexa:
    // fuera del blob elegido se fuerza a 0 (muy por debajo del umbral) para
    // que el trazador solo "vea" el vaso correcto (no Lago Colina u otro
    // cuerpo de agua vecino), pero dentro del blob conserva el valor real de
    // NDWI — necesario para la interpolación subpíxel del contorno (ver
    // trazaContornoMarchingSquares). Costo aceptado: el borde EXTERIOR pierde
    // interpolación fina justo en la frontera del blob (el corte ahí es dado
    // por la máscara binaria, no por el NDWI real del píxel vecino de tierra)
    // — las islas internas sí conservan interpolación completa en ambos lados.
    const ndwiEnmascarado = new Uint16Array(W * H);
    for (let p = 0; p < W * H; p++) ndwiEnmascarado[p] = mascaraPrincipal[p] ? ndwiRaster[p] : 0;

    // Vectoriza el contorno con interpolación subpíxel (marching squares
    // sobre el valor NDWI real, no la máscara binaria): anillo exterior + un
    // anillo por cada isla real dentro del vaso. Cada anillo se suaviza
    // (Chaikin) y se reproyecta a lon/lat por separado.
    const { exterior, islas, debugAreas, causasRuptura, debugColisiones, debugCeldaInfo } = trazaContornoMarchingSquares(
      ndwiEnmascarado, W, H, umbralCodificado,
    );
    const px2lon = (x: number) => minLon + (x / W) * (maxLon - minLon);
    const px2lat = (y: number) => maxLat - (y / H) * (maxLat - minLat); // y invertido: fila 0 = norte
    const aLonLat = (anillo: [number, number][]): [number, number][] =>
      submuestrea(suavizaChaikin(anillo, 2), 400).map(([x, y]) => [
        Number(px2lon(x).toFixed(6)),
        Number(px2lat(y).toFixed(6)),
      ]);

    const contornoExterior = aLonLat(exterior);
    // GeoJSON: el primer anillo es el exterior en sentido horario, los
    // siguientes son agujeros (islas) — deben ir en sentido antihorario por
    // convención RFC 7946; como el trazador ya orienta el exterior horario
    // con "agua a la derecha", los anillos internos (islas = tierra a la
    // derecha del trazo cuando se camina el borde del hueco) salen ya en el
    // sentido contrario de forma natural, sin necesidad de invertirlos.
    const contornoIslas = islas.map(aLonLat);

    return json({
      ok: true,
      encontrada: true,
      fecha_escena: fechaEscena,
      nubosidad_pct: nubosidadEscena,
      bbox: BBOX_BOQUILLA,
      resolucion_m: RESOLUCION_M,
      raster_width: W,
      raster_height: H,
      pixeles_agua_total_raster: pixelesAguaTotal,
      area_agua_total_km2_sin_filtrar: Number(areaAguaTotalKm2.toFixed(2)),
      pixeles_vaso_mancha_principal: pixelesVaso,
      area_vaso_km2: Number(areaVasoKm2.toFixed(2)),
      num_islas_detectadas: contornoIslas.length,
      debug_areas_islas_px: debugAreas,
      debug_causas_ruptura: causasRuptura,
      debug_colisiones: debugColisiones,
      debug_celda_info: debugCeldaInfo,
      contorno_num_vertices: contornoExterior.length,
      contorno_geojson: {
        type: "Polygon",
        coordinates: [contornoExterior, ...contornoIslas],
      },
      debug_mascara_grid: debugRows, // filas de "0"/"1", norte→sur, oeste→este
    }, 200);
  } catch (err) {
    return json({ error: String(err), stack: (err as Error)?.stack }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
