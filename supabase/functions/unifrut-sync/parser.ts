// ═══════════════════════════════════════════════════════════════════════════
// Parser de la Red de Estaciones Meteorológicas (REM) de UNIFRUT A.C. — Cuauhtémoc, Chih.
// ---------------------------------------------------------------------------
// Puro y sin dependencias de Deno (se prueba con vitest desde src/utils/unifrutParser.test.ts).
// Fuente: https://www.unifrut.com.mx/rem/ (sin API; el sitio es PHP con endpoints POST en /rem/includes/).
//   getInfo.php {id_tab:"_qtl"}  → "nombre|municipio|tipo|lat|lon|altitud|foto"
//   getReport.php {info:"ini|fin|General|Rango|_qtl"}  → HTML con <table id='Datatable'> (General = diario, Hora = horario)
// Se lee UN AÑO por consulta como máximo (rangos multianuales se truncan en el servidor).
// ESTRICTO: si cambia el formato (faltan columnas, encabezados distintos) lanza FormatoUnifrutError y no se guarda nada.
// Reglas del proyecto: S/D = null (nunca 0). Valores fuera de rango físico → null y se cuentan como descartes.
// ═══════════════════════════════════════════════════════════════════════════

export const BASE_UNIFRUT = "https://www.unifrut.com.mx/rem/includes";
export class FormatoUnifrutError extends Error {}

export interface InfoEstacion {
  nombre: string; municipio: string; tipo: string; latitud: number; longitud: number; altitud_m: number | null;
}

export interface PuntoDiario {
  fecha: string; // YYYY-MM-DD, día local de la estación
  tmax_c: number | null; tmax_hora: string | null; tmin_c: number | null; tmin_hora: string | null; tmed_c: number | null;
  hr_max_pct: number | null; hr_min_pct: number | null;
  viento_kmh: number | null; viento_max_kmh: number | null; viento_dir: string | null; viento_dir_deg: number | null;
  rad_kwm2: number | null /* kW/m² en CAMB; W/m² en ADCON (ver radWm2) */; lluvia_mm: number | null; eto_mm: number | null;
}

export interface PuntoHorario {
  fecha: string; hora: number; // 0-23 (el reporte numera 1:00 … 24:00 → ver horaLocal)
  temp_c: number | null; hr_pct: number | null; rocio_c: number | null; viento_dir: string | null; viento_dir_deg: number | null;
  viento_kmh: number | null; viento_max_kmh: number | null; lluvia_mm: number | null; eto_mm: number | null;
  rad_kwm2: number | null; presion_kpa: number | null;
}

/** Número finito o null: "", "---", ":" y espacios son S/D. Number("") vale 0 y NO debe colarse como dato. */
export function numONull(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, "").replace(",", ".");
  if (s === "" || s === "---" || s === ":" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const horaONull = (v: string): string | null => (/^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);

/** Rosa de 16 vientos en español, como la imprime el portal ("Este-Sureste") → grados. */
const ROSA: Record<string, number> = {
  "norte": 0, "norte-noreste": 22.5, "noreste": 45, "este-noreste": 67.5, "este": 90, "este-sureste": 112.5,
  "sureste": 135, "sur-sureste": 157.5, "sur": 180, "sur-suroeste": 202.5, "suroeste": 225, "oeste-suroeste": 247.5,
  "oeste": 270, "oeste-noroeste": 292.5, "noroeste": 315, "norte-noroeste": 337.5,
};
export function dirAGrados(d: string | null): number | null {
  if (!d) return null;
  const k = d.trim().toLowerCase();
  return k in ROSA ? ROSA[k] : null;
}

/** "Nombre|MUNI|CAMB|28.44|-106.87|2029|qtl.jpg" → InfoEstacion. */
export function parseInfo(txt: string): InfoEstacion {
  const p = txt.trim().split("|");
  if (p.length < 5) throw new FormatoUnifrutError(`getInfo.php devolvió ${p.length} campos (se esperaban ≥ 5)`);
  const lat = numONull(p[3]), lon = numONull(p[4]);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new FormatoUnifrutError("getInfo.php sin coordenadas válidas");
  return { nombre: p[0].trim(), municipio: p[1].trim(), tipo: p[2].trim(), latitud: lat, longitud: lon, altitud_m: numONull(p[5]) };
}

/** Extrae las filas de <tbody> como arreglos de texto. Sin tabla → FormatoUnifrutError; tabla sin filas de datos → []. */
function filas(html: string): string[][] {
  if (!/<table[^>]*id=['"]Datatable['"]/i.test(html)) {
    // El portal responde con un párrafo corto cuando no hay registros: eso es "sin datos", no cambio de formato.
    if (!/<table/i.test(html)) return [];
    throw new FormatoUnifrutError("falta la tabla Datatable");
  }
  const tb = /<tbody>([\s\S]*?)<\/tbody>/i.exec(html);
  if (!tb) throw new FormatoUnifrutError("falta <tbody>");
  const out: string[][] = [];
  for (const m of tb[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    out.push(celdas);
  }
  return out;
}

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Reporte "General" (diario). 16 columnas: Estación, Fecha, Tmax, h, Tmin, h, Tprom, HRmax, HRmin, Vprom, Vmax, Dir, h, Rad, Pp, ETo. */
export function parseDiario(html: string, tipo = "CAMB"): { puntos: PuntoDiario[]; descartes: number } {
  const puntos: PuntoDiario[] = [];
  let descartes = 0;
  for (const c of filas(html)) {
    if (!esFecha(c[1] ?? "")) continue; // Maximo / Minimo / Promedio de resumen
    if (c.length < 16) throw new FormatoUnifrutError(`fila diaria con ${c.length} columnas (se esperaban 16)`);
    const lim = (v: number | null, lo: number, hi: number) => {
      if (v == null) return null;
      if (v < lo || v > hi) { descartes++; return null; }
      return v;
    };
    let tmax = lim(numONull(c[2]), -40, 55), tmin = lim(numONull(c[4]), -40, 50);
    if (tmax != null && tmin != null && tmin > tmax) { tmax = null; tmin = null; descartes += 2; } // columnas desfasadas / sensor malo
    let dir = c[11] && c[11] !== "---" ? c[11] : null;
    let vProm = lim(numONull(c[9]), 0, 120), vMax = lim(numONull(c[10]), 0, 160);
    // Anemómetro sin señal: promedio 0 Y ráfaga 0 en TODO el día (con dirección fija, p. ej. "Norte") no es calma real, es un sensor muerto
    // (Col. Álvaro Obregón desde ago-2021, Namiquipa Alto desde oct-2020). S/D, nunca 0.
    if (vProm === 0 && vMax === 0) { vProm = null; vMax = null; dir = null; descartes += 2; }
    puntos.push({
      fecha: c[1],
      tmax_c: tmax, tmax_hora: horaONull(c[3]), tmin_c: tmin, tmin_hora: horaONull(c[5]), tmed_c: lim(numONull(c[6]), -40, 55),
      hr_max_pct: lim(numONull(c[7]), 0, 100), hr_min_pct: lim(numONull(c[8]), 0, 100),
      viento_kmh: vProm, viento_max_kmh: vMax,
      viento_dir: dir, viento_dir_deg: dirAGrados(dir),
      rad_kwm2: lim(numONull(c[13]), 0, tipo.toUpperCase() === "CAMB" ? 1.6 : 1600), lluvia_mm: lim(numONull(c[14]), 0, 400), eto_mm: lim(numONull(c[15]), 0, 20),
    });
  }
  return { puntos, descartes };
}

/** Reporte "Hora". 13 columnas: Estación, Fecha, Hora, Temp, HR, Rocío, Dir, Vel, VelMax, Pp, ETo, Rad, Presión(kPa). */
export function parseHorario(html: string, tipo = "CAMB"): { puntos: PuntoHorario[]; descartes: number } {
  const puntos: PuntoHorario[] = [];
  let descartes = 0;
  for (const c of filas(html)) {
    if (!esFecha(c[1] ?? "")) continue;
    if (c.length < 13) throw new FormatoUnifrutError(`fila horaria con ${c.length} columnas (se esperaban 13)`);
    const mh = /^(\d{1,2}):(\d{2})$/.exec(c[2]);
    if (!mh) throw new FormatoUnifrutError(`hora ilegible "${c[2]}"`);
    const lim = (v: number | null, lo: number, hi: number) => {
      if (v == null) return null;
      if (v < lo || v > hi) { descartes++; return null; }
      return v;
    };
    const dir = c[6] && c[6] !== "---" ? c[6] : null;
    puntos.push({
      fecha: c[1], hora: Number(mh[1]),
      temp_c: lim(numONull(c[3]), -40, 55), hr_pct: lim(numONull(c[4]), 0, 100), rocio_c: lim(numONull(c[5]), -50, 40),
      viento_dir: dir, viento_dir_deg: dirAGrados(dir),
      viento_kmh: lim(numONull(c[7]), 0, 120), viento_max_kmh: lim(numONull(c[8]), 0, 160),
      lluvia_mm: lim(numONull(c[9]), 0, 200), eto_mm: lim(numONull(c[10]), 0, 2), rad_kwm2: lim(numONull(c[11]), 0, tipo.toUpperCase() === "CAMB" ? 1.6 : 1600),
      presion_kpa: lim(numONull(c[12]), 60, 110),
    });
  }
  return { puntos, descartes };
}

/** Día local de hoy en America/Chihuahua (UTC−6 todo el año desde 2022). */
export function hoyChihuahua(ref: Date): string {
  return new Date(ref.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** Solo días COMPLETOS: el día en curso (parcial) y los futuros se descartan. */
export function diasCompletos(puntos: PuntoDiario[], ref: Date): PuntoDiario[] {
  const hoy = hoyChihuahua(ref);
  return puntos.filter((p) => p.fecha < hoy);
}

/** Un registro diario sin ninguna variable útil no se guarda (el portal publica filas de relleno). */
export function tieneDato(p: PuntoDiario): boolean {
  return [p.tmax_c, p.tmin_c, p.tmed_c, p.hr_max_pct, p.viento_kmh, p.rad_kwm2, p.lluvia_mm, p.eto_mm].some((v) => v != null);
}

/** Unidad de radiación según el tipo de equipo: CAMB imprime kW/m² (0.234); ADCON imprime W/m² (109.0). → W/m² media diaria. */
export function radWm2(valor: number | null, tipo: string): number | null {
  if (valor == null) return null;
  return tipo.toUpperCase() === "CAMB" ? Math.round(valor * 1000 * 10) / 10 : valor;
}
