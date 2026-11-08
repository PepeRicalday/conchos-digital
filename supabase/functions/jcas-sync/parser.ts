// ═══════════════════════════════════════════════════════════════════════════
// Parser de la red de estaciones JCAS (Junta Central de Agua y Saneamiento de Chihuahua / UACJ)
// ---------------------------------------------------------------------------
// Puro y sin dependencias de Deno (se prueba con vitest desde src/utils/jcasParser.test.ts).
// El portal NO tiene API: las series salen de arreglos JavaScript embebidos en el HTML de /estacion/view/{id}?mode=…
// Por eso el parser es ESTRICTO: si cambia el formato (falta un arreglo, longitudes distintas, etiquetas ilegibles)
// lanza FormatoJcasError y la función no guarda nada — jamás se rellena con ceros ni se adivina.
// Reglas del proyecto: S/D = null (nunca 0); datos provisionales.
// ═══════════════════════════════════════════════════════════════════════════

export const BASE_JCAS = "https://proyectojcas.uacj.mx";
export class FormatoJcasError extends Error {}

export interface EstacionJcas {
  id: number; nombre: string; latitud: number; longitud: number; altitud_m: number | null;
  actualizada: string | null; activa: boolean; tienePluviometro: boolean;
}

/** Número finito o null: Number(null) y Number("") valen 0 y convertirían un dato ausente en (0, 0). */
function numONull(v: unknown): number | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Valida y reduce el JSON de /maps/get/estaciones. Descarta filas sin coordenadas finitas; falla si no es una lista. */
export function parseEstaciones(json: unknown): EstacionJcas[] {
  if (!Array.isArray(json)) throw new FormatoJcasError("/maps/get/estaciones no devolvió una lista");
  const out: EstacionJcas[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const id = numONull(r?.id), lat = numONull(r?.latitud), lon = numONull(r?.longitud);
    if (id == null || !Number.isInteger(id) || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const alt = numONull(r.altitud);
    out.push({
      id, nombre: String(r.nombre ?? `JCAS ${id}`).trim(), latitud: lat, longitud: lon,
      altitud_m: alt,
      actualizada: aIsoLocal(r.actualizada), activa: r.active === true,
      tienePluviometro: String(r.pluviometro ?? "").toUpperCase() === "SI",
    });
  }
  if (out.length === 0) throw new FormatoJcasError("/maps/get/estaciones sin estaciones válidas");
  return out;
}

/** "2026-11-08 15:50:00" → "2026-11-08T15:50:00" (hora del reloj de la estación; el portal no declara zona). */
function aIsoLocal(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(String(v ?? ""));
  return m ? `${m[1]}T${m[2].length === 5 ? m[2] + ":00" : m[2]}` : null;
}

export type ModoSerie = "dia" | "mes" | "anio";
export interface PuntoSerie {
  /** dia: "HH:00" · mes: YYYY-MM-DD · anio: YYYY-MM */
  clave: string;
  temp_c: number | null; hum_pct: number | null; viento_kmh: number | null; presion_hpa: number | null; rocio_c: number | null; lluvia_mm: number | null;
}

const CAMPOS: [keyof PuntoSerie, string][] = [
  ["temp_c", "temp_value"], ["hum_pct", "hum_value"], ["viento_kmh", "wind_value"],
  ["presion_hpa", "bar_value"], ["rocio_c", "dew_pt_value"], ["lluvia_mm", "rain_value"],
];

function extraeArreglo(html: string, nombre: string): unknown[] | null {
  const m = new RegExp(`var\\s+${nombre}\\s*=\\s*(\\[[^\\]]*\\])\\s*;`).exec(html);
  if (!m) return null;
  try { const a = JSON.parse(m[1]); return Array.isArray(a) ? a : null; } catch { return null; }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Lee las series embebidas. `ref` = fecha-hora de referencia (UTC) para completar el año de las etiquetas dd/mm:
 * una etiqueta que caiga más de 2 días en el futuro respecto a `ref` pertenece al año anterior.
 * Los puntos vienen SOLO de los días con dato (la estación que dejó de transmitir simplemente no tiene etiquetas):
 * por eso se enlaza por etiqueta, nunca por posición.
 */
export function parseSerie(html: string, ref: Date): { modo: ModoSerie; puntos: PuntoSerie[] } {
  const etiquetas = extraeArreglo(html, "graph_label");
  const xl = /var\s+xLabel\s*=\s*"([^"]*)"/.exec(html)?.[1] ?? "";
  if (!etiquetas) throw new FormatoJcasError("falta graph_label");
  const modo = modoDeEtiqueta(xl);
  if (!modo) throw new FormatoJcasError(`xLabel desconocido: "${xl}"`);
  const cols = new Map<keyof PuntoSerie, unknown[]>();
  for (const [campo, nombre] of CAMPOS) {
    const a = extraeArreglo(html, nombre);
    if (!a) throw new FormatoJcasError(`falta ${nombre}`);
    if (a.length !== etiquetas.length) throw new FormatoJcasError(`${nombre} tiene ${a.length} valores y graph_label ${etiquetas.length}`);
    cols.set(campo, a);
  }
  const puntos: PuntoSerie[] = etiquetas.map((et, i) => {
    const clave = claveDeEtiqueta(String(et), modo, ref);
    const p = { clave } as PuntoSerie;
    for (const [campo] of CAMPOS) (p[campo] as number | null) = num(cols.get(campo)![i]);
    return p;
  });
  const vistas = new Set<string>();
  for (const p of puntos) { if (vistas.has(p.clave)) throw new FormatoJcasError(`etiqueta repetida ${p.clave}`); vistas.add(p.clave); }
  return { modo, puntos };
}

function modoDeEtiqueta(xl: string): ModoSerie {
  if (/hora/i.test(xl)) return "dia";
  if (/d[ií]a/i.test(xl)) return "mes";
  if (/mes/i.test(xl)) return "anio";
  throw new FormatoJcasError(`xLabel desconocido: "${xl}"`);
}

function claveDeEtiqueta(et: string, modo: ModoSerie, ref: Date): string {
  if (modo === "dia") {
    if (!/^\d{2}:\d{2}$/.test(et)) throw new FormatoJcasError(`etiqueta horaria ilegible "${et}"`);
    return et;
  }
  if (modo === "anio") {
    const m = /^(\d{2})\/(\d{4})$/.exec(et);
    if (!m || +m[1] < 1 || +m[1] > 12) throw new FormatoJcasError(`etiqueta mensual ilegible "${et}"`);
    return `${m[2]}-${m[1]}`;
  }
  const m = /^(\d{2})\/(\d{2})$/.exec(et);
  if (!m) throw new FormatoJcasError(`etiqueta diaria ilegible "${et}"`);
  const dia = +m[1], mes = +m[2];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) throw new FormatoJcasError(`etiqueta diaria fuera de rango "${et}"`);
  let anio = ref.getUTCFullYear();
  if (Date.UTC(anio, mes - 1, dia) > ref.getTime() + 2 * 86_400_000) anio -= 1;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) throw new FormatoJcasError(`fecha inexistente "${et}"`); // 31/04, 30/02…
  return d.toISOString().slice(0, 10);
}

/** Límites de plausibilidad: lo que cae fuera es error de sensor y se guarda como S/D (null), no se corrige. */
export const LIMITES = {
  temp_c: [-35, 52], hum_pct: [0, 100], viento_kmh: [0, 200], presion_hpa: [700, 1090], rocio_c: [-45, 40], lluvia_mm: [0, 150],
} as const;
/** La serie anual trae TOTALES MENSUALES de lluvia (julio con monzón supera 150 mm sin ser error): el techo diario no aplica. */
export const LIMITES_MES = { ...LIMITES, lluvia_mm: [0, 1200] } as const;

/** Anula (null) los valores fuera de rango y la lluvia de estaciones sin pluviómetro (un 0.0 sin sensor NO es "no llovió"). */
export function depuraPunto(p: PuntoSerie, tienePluviometro: boolean, limites: typeof LIMITES | typeof LIMITES_MES = LIMITES): { punto: PuntoSerie; descartados: string[] } {
  const out = { ...p }, descartados: string[] = [];
  for (const [campo, [lo, hi]] of Object.entries(limites) as [keyof typeof LIMITES, readonly [number, number]][]) {
    const v = out[campo];
    if (v != null && (v < lo || v > hi)) { out[campo] = null; descartados.push(`${campo}=${v}`); }
  }
  if (!tienePluviometro) out.lluvia_mm = null;
  return { punto: out, descartados };
}

/**
 * Fecha local "de hoy" en el huso más occidental de la red (UTC-7, Juárez/Ojinaga sin horario de verano en noviembre):
 * el último día de la serie mensual es el día EN CURSO y su lluvia está incompleta, así que se descarta todo día ≥ a esta fecha.
 */
export function hoyConservador(ref: Date): string {
  return new Date(ref.getTime() - 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Lectura PARCIAL del día en curso: el último punto de la serie mensual cuya fecha es ≥ a hoy (conservador). Es lo acumulado/promediado
 * hasta el momento de la consulta; va a jcas_lecturas_hoy, nunca a las lecturas diarias completas. null si la serie no trae día en curso.
 */
export function puntoParcial(puntos: PuntoSerie[], ref: Date, tienePluviometro: boolean): { fecha: string; punto: PuntoSerie } | null {
  const hoy = hoyConservador(ref);
  const en = puntos.filter((p) => p.clave >= hoy).sort((a, b) => a.clave.localeCompare(b.clave));
  const p = en[en.length - 1];
  return p ? { fecha: p.clave, punto: depuraPunto(p, tienePluviometro).punto } : null;
}

/** Días completos de una serie mensual, listos para guardar. */
export function diasCompletos(puntos: PuntoSerie[], ref: Date, tienePluviometro: boolean): { fecha: string; punto: PuntoSerie }[] {
  const hoy = hoyConservador(ref);
  return puntos.filter((p) => p.clave < hoy).map((p) => ({ fecha: p.clave, punto: depuraPunto(p, tienePluviometro).punto }));
}
