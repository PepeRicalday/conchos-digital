// ═══════════════════════════════════════════════════════════════════════════
// dem-boquilla-sync — Manejo de Vaso: Modelo Digital de Elevación (DEM)
// ---------------------------------------------------------------------------
// Trae el terreno real alrededor de la cortina de La Boquilla desde
// Copernicus DEM GLO-30 (resolución 30m, cobertura global, sin trámite de
// descarga manual por hoja/carta como INEGI) vía la API REST de
// OpenTopography — mismo principio que sentinel-ndwi-vaso-sync (bbox → raster),
// pero aquí el resultado es elevación de TERRENO (relieve real de las laderas
// y el cañón), no agua. Complementa, no reemplaza, la profundidad aproximada
// que VasoVisor3D.tsx ya calcula desde curvas_capacidad para el FONDO del
// vaso — el DEM cubre lo que esa aproximación no puede: el relieve de las
// laderas que rodean la cortina.
//
// Bbox acotado a la zona de la cortina (~3km alrededor de las coordenadas
// GPS reales extraídas de las fotos de dron: 27.5477°N, -105.4139°W), NO el
// bbox completo del vaso (55km x 35km, BBOXES_PRESA de sentinel-ndwi-vaso-sync)
// — un DEM de detalle útil para el visor 3D de la cortina no necesita cubrir
// todo el embalse, y un raster de esa extensión a 30m sería innecesariamente
// pesado para lo que el visor va a mostrar.
//
// Salida: en vez de reenviar el GeoTIFF crudo (formato pesado, requiere un
// parser GDAL que no existe en Deno), esta función lo decodifica a una
// grilla de elevaciones (JSON: filas x columnas de metros sobre el nivel del
// mar) que el frontend puede consumir directo como heightmap en Three.js,
// vía PlaneGeometry con vértices desplazados en Y — mismo principio que la
// malla de fondo aproximada en VasoVisor3D.tsx, pero con datos reales en vez
// de una función cónica calibrada por volumen.
//
// Requiere: OPENTOPOGRAPHY_API_KEY (gratuita, registro en
// https://portal.opentopography.org/requestService?service=api).
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

const OPENTOPO_URL = "https://portal.opentopography.org/API/globaldem";

// Bbox del VASO COMPLETO — mismo bbox que BBOXES_PRESA['PRE-001'] en
// sentinel-ndwi-vaso-sync (~55km x 35km). Ampliado desde el bbox original
// (~3km acotado solo a la cortina): con un embalse dendrítico tan extenso
// como La Boquilla, un DEM acotado a la cortina se veía como un parche
// aislado y minúsculo junto al polígono del vaso completo — el terreno
// tiene que cubrir la misma extensión que el agua para que ambas mallas se
// perciban como una sola escena continua, no dos objetos flotando sueltos.
const BBOX_CORTINA: Record<string, { nombre: string; south: number; north: number; west: number; east: number }> = {
  "PRE-001": {
    nombre: "La Boquilla — vaso completo",
    south: 27.3942, north: 27.7092,
    west: -105.7241, east: -105.2175,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);

  try {
    const OPENTOPO_KEY = Deno.env.get("OPENTOPOGRAPHY_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!OPENTOPO_KEY) return json({ error: "OPENTOPOGRAPHY_API_KEY no configurada" }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const presaId: string = body?.presa_id || "PRE-001";
    const bbox = BBOX_CORTINA[presaId];
    if (!bbox) {
      return json({ error: `Presa no configurada para DEM: ${presaId}. Disponibles: ${Object.keys(BBOX_CORTINA).join(", ")}` }, 400);
    }

    const url = new URL(OPENTOPO_URL);
    url.searchParams.set("demtype", "COP30"); // Copernicus GLO-30, 30m
    url.searchParams.set("south", String(bbox.south));
    url.searchParams.set("north", String(bbox.north));
    url.searchParams.set("west", String(bbox.west));
    url.searchParams.set("east", String(bbox.east));
    url.searchParams.set("outputFormat", "AAIGrid"); // ASCII Grid: texto plano, parseable sin GDAL
    url.searchParams.set("API_Key", OPENTOPO_KEY);

    const r = await fetch(url.toString());
    if (!r.ok) {
      const detalle = await r.text().catch(() => "");
      return json({ error: `OpenTopography respondió ${r.status}: ${detalle.slice(0, 300)}` }, 502);
    }
    const texto = await r.text();

    // ── Parseo de ASCII Grid (formato Esri AAIGrid) ──────────────────────────
    // Header de 6 líneas (ncols, nrows, xllcorner, yllcorner, cellsize,
    // NODATA_value) seguido de nrows líneas con ncols valores de elevación,
    // fila por fila de norte a sur — formato de texto plano estándar,
    // documentado, sin necesitar una librería de rasters en Deno.
    const lineas = texto.split("\n");
    const header: Record<string, number> = {};
    let idxDatos = 0;
    for (let i = 0; i < lineas.length; i++) {
      const partes = lineas[i].trim().split(/\s+/);
      if (partes.length !== 2 || isNaN(Number(partes[1]))) { idxDatos = i; break; }
      header[partes[0].toLowerCase()] = Number(partes[1]);
    }
    const ncols = header["ncols"], nrows = header["nrows"];
    const cellsize = header["cellsize"], nodata = header["nodata_value"] ?? -9999;
    if (!ncols || !nrows || !cellsize) {
      return json({ error: "Header AAIGrid incompleto — respuesta inesperada de OpenTopography", muestra: texto.slice(0, 400) }, 502);
    }

    const elevaciones: number[] = [];
    for (let i = idxDatos; i < lineas.length && elevaciones.length < ncols * nrows; i++) {
      const linea = lineas[i].trim();
      if (!linea) continue;
      for (const tok of linea.split(/\s+/)) {
        const v = Number(tok);
        elevaciones.push(v === nodata ? NaN : v);
      }
    }
    if (elevaciones.length < ncols * nrows) {
      return json({ error: `Grid incompleto: se esperaban ${ncols * nrows} valores, se leyeron ${elevaciones.length}` }, 502);
    }

    // Downsample a máximo 200x200 antes de persistir — un DEM de detalle de
    // cortina a 30m nativo ya cae en ese rango típicamente, pero se acota
    // por si el bbox creciera: el heightmap del visor no necesita más
    // resolución que la que la malla de Three.js va a renderizar en pantalla.
    const MAX_LADO = 200;
    const pasoX = Math.max(1, Math.ceil(ncols / MAX_LADO));
    const pasoY = Math.max(1, Math.ceil(nrows / MAX_LADO));
    const grid: number[][] = [];
    for (let fila = 0; fila < nrows; fila += pasoY) {
      const filaOut: number[] = [];
      for (let col = 0; col < ncols; col += pasoX) {
        filaOut.push(elevaciones[fila * ncols + col]);
      }
      grid.push(filaOut);
    }

    const registro = {
      presa_id: presaId,
      fuente: "Copernicus DEM GLO-30 (OpenTopography)",
      resolucion_m_nativa: 30,
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      ncols: grid[0]?.length ?? 0,
      nrows: grid.length,
      grid_elevaciones_msnm: grid,
      actualizado_en: new Date().toISOString(),
    };

    const { error: errUpsert } = await supabase
      .from("dem_terreno_presa")
      .upsert(registro, { onConflict: "presa_id" });
    if (errUpsert) return json({ error: `upsert dem_terreno_presa: ${errUpsert.message}` }, 500);

    // Min/max con reduce en bucle, NO Math.min(...array) — con bboxes grandes
    // (vaso completo, ~2M celdas antes del downsample) el spread operator
    // pasa cada elemento como argumento individual de la función, lo que
    // excede el límite de argumentos por llamada del motor JS y tronaba con
    // "RangeError: Maximum call stack size exceeded". Se calcula sobre la
    // grilla YA reducida (grid, máx. 200x200), suficiente para el resumen
    // devuelto y más barato que recorrer los millones de puntos originales.
    let elevMin = Infinity, elevMax = -Infinity;
    for (const fila of grid) {
      for (const v of fila) {
        if (isNaN(v)) continue;
        if (v < elevMin) elevMin = v;
        if (v > elevMax) elevMax = v;
      }
    }

    return json({
      ok: true, presa_id: presaId, filas: grid.length, columnas: grid[0]?.length ?? 0,
      elevacion_min: isFinite(elevMin) ? elevMin : null,
      elevacion_max: isFinite(elevMax) ? elevMax : null,
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
