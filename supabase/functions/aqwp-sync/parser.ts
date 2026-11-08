// Parser puro (sin Deno ni red) del portal USIBWC AQUARIUS (AQWP). Testeable con vitest.
// Regla S/D: vacío, "S/D", "N/A" o no numérico → null. Jamás 0.

export const BASE_AQWP = "https://waterdata.ibwc.gov/AQWebportal";

export interface FilaDiaria { fecha: string; valor: number | null }

/** Número del portal. El formato depende del idioma de la petición: "819,803" (es) o "819.803" (en). */
export function parseNumero(s: unknown): number | null {
  const t = String(s ?? "").trim();
  if (t === "" || /^(s\/?d|n\/?a|nan|null)$/i.test(t)) return null;
  let n = t;
  if (n.includes(",") && n.includes(".")) {
    // "1,234.5" o "1.234,5": el separador que aparece ÚLTIMO es el decimal; el otro es de miles.
    n = n.lastIndexOf(",") > n.lastIndexOf(".") ? n.replace(/\./g, "").replace(",", ".") : n.replace(/,/g, "");
  } else if (n.includes(",")) {
    n = n.replace(",", ".");
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * Lee el texto de un CSV de "Export/DataSet/Csv". Detecta el separador por línea:
 *   es → "2026-11-07 00:00:00;819,803"      en → "2026-11-07 00:00:00,819.803"
 * Solo toma filas cuyo sello empieza con fecha; el resto (cabecera, aviso legal) se ignora.
 * El sello viene en UTC-6 FIJO: la fecha es el día del sello tal cual (sin convertir zona).
 */
export function parseCsvExport(texto: string): FilaDiaria[] {
  // AQUARIUS añade una marca de hueco "NaN" a las 00:00:01 junto a los puntos aislados (p. ej. 2015 es mensual):
  //   "2015-05-01 00:00:00,2262.141" + "2015-05-01 00:00:01,NaN". Esa marca no es un día sin dato: se descarta.
  // Además se deduplica por fecha: si hay dos filas del mismo día, gana la que trae valor (un upsert por lotes
  // falla con "cannot affect row a second time" si el lote repite la clave).
  const porFecha = new Map<string, FilaDiaria>();
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:(\d{2}))?[^;,]*[;,](.*)$/.exec(linea);
    if (!m) continue;
    const valor = parseNumero(m[4]);
    if (valor === null && m[3] !== undefined && m[3] !== "00") continue; // marca de hueco
    const previa = porFecha.get(m[1]);
    if (!previa || (previa.valor === null && valor !== null)) porFecha.set(m[1], { fecha: m[1], valor });
  }
  return [...porFecha.values()];
}

export const COLUMNAS_MEXRES = [
  "Identifier", "Location", "Date", "DeadStorage", "ConservationStorage", "VolumeStorage",
  "DeltaVolume", "PercentConservation", "DischargeInflow", "DischargeRelease", "DischargeSpill", "DischargeTotal",
] as const;

export interface FilaMexRes {
  id: string; presa: string; fecha: string | null;
  almacenamiento_mm3: number | null; pct_conservacion: number | null;
  aportacion_m3s: number | null; extraccion_m3s: number | null; vertido_m3s: number | null;
}

const MESES: Record<string, string> = {
  jan: "01", ene: "01", feb: "02", mar: "03", apr: "04", abr: "04", may: "05", jun: "06", jul: "07",
  aug: "08", ago: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12", dic: "12",
};

/** "07-nov.-2026 00:00" / "07-Nov-2026 00:00" → "2026-11-07". null si no se reconoce. */
export function fechaMexRes(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-zñ]+)\.?-(\d{4})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  return mes ? `${m[3]}-${mes}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Valida y normaliza GetTable?id=MexResScript. Lanza si cambió el formato (faltan columnas):
 * mejor fallar con alerta que escribir basura.
 */
export function parseMexResScript(json: unknown): FilaMexRes[] {
  const data = (json as { Data?: Record<string, string>[] })?.Data;
  if (!Array.isArray(data) || data.length < 2) throw new Error("MexResScript sin filas");
  const cab = data[0];
  const faltan = COLUMNAS_MEXRES.filter((c) => !(c in cab));
  if (faltan.length) throw new Error(`MexResScript cambió de formato; faltan columnas: ${faltan.join(", ")}`);
  return data.slice(1).map((d) => ({
    id: d.Identifier, presa: d.Location, fecha: fechaMexRes(d.Date),
    almacenamiento_mm3: parseNumero(d.VolumeStorage), pct_conservacion: parseNumero(d.PercentConservation),
    aportacion_m3s: parseNumero(d.DischargeInflow), extraccion_m3s: parseNumero(d.DischargeRelease),
    vertido_m3s: parseNumero(d.DischargeSpill),
  }));
}

/**
 * Lectura sin actualizar ("estancada"): el almacenamiento repite EXACTAMENTE el mismo valor ≥ minDias días seguidos
 * aunque hay actividad hidráulica (|aportación| + |extracción total| ≥ actividadMin m³/s en cada día).
 * Con 0.05 m³/s el cambio esperado es ≥ ~0.004 Mm³/día, visible en los 3 decimales que publica CONAGUA.
 * minDias = 21: CONAGUA actualiza algunas presas POR TRAMOS (Madero repite 8–16 días y luego salta), y con 4 días se
 * marcaba la mitad de su año. Una lectura que no cambia en 3 semanas con flujos activos sí es una lectura sin actualizar
 * (Chihuahua: 8.924 Mm³ desde el 22-sep, con cambio de almacenamiento 0 reportado por la propia CONAGUA).
 * Un embalse realmente quieto (sin flujos o con flujos mínimos) NO se marca.
 * Devuelve el conjunto de fechas marcadas (todas las del tramo repetido).
 */
export const MIN_DIAS_ESTANCADA = 21;

export function detectarEstancamiento(
  almacenamiento: FilaDiaria[],
  aportacion: FilaDiaria[],
  extraccionTotal: FilaDiaria[],
  minDias = MIN_DIAS_ESTANCADA,
  actividadMin = 0.05,
): Set<string> {
  const flujo = (serie: FilaDiaria[]) => new Map(serie.map((f) => [f.fecha, f.valor]));
  const ap = flujo(aportacion), ex = flujo(extraccionTotal);
  const actividad = (fecha: string) => {
    const a = ap.get(fecha), e = ex.get(fecha);
    if (a == null && e == null) return null; // sin información de flujo: no se puede afirmar
    return Math.abs(a ?? 0) + Math.abs(e ?? 0);
  };
  const marcadas = new Set<string>();
  const s = [...almacenamiento].sort((x, y) => x.fecha.localeCompare(y.fecha));
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[i].valor != null && s[j + 1].valor === s[i].valor) j++;
    if (s[i].valor != null && j - i + 1 >= minDias) {
      const tramo = s.slice(i, j + 1);
      if (tramo.every((f) => { const a = actividad(f.fecha); return a != null && a >= actividadMin; })) {
        for (const f of tramo) marcadas.add(f.fecha);
      }
    }
    i = j + 1;
  }
  return marcadas;
}

/** Fecha YYYY-MM-DD para StartTime/EndTime del export (UTC-6 fijo). */
export const aFecha = (d: Date): string => d.toISOString().slice(0, 10);

/** URL del export CSV por rango personalizado (DateRange=Custom) o histórico completo. */
export function urlExport(titulo: string, desde?: string, hasta?: string): string {
  const q = new URLSearchParams({
    DataSet: titulo, Calendar: "CALENDARYEAR", Step: "1", ExportFormat: "csv", TimeAligned: "True",
    RoundData: "False", IncludeGradeCodes: "False", IncludeApprovalLevels: "False",
    IncludeInterpolationTypes: "False", Datum: "Original", Timezone: "-6",
  });
  if (desde && hasta) {
    q.set("DateRange", "Custom");
    q.set("StartTime", `${desde}T00:00:00.000-06:00`);
    q.set("EndTime", `${hasta}T00:00:00.000-06:00`);
  } else {
    q.set("DateRange", "EntirePeriodOfRecord");
  }
  return `${BASE_AQWP}/Export/DataSet/Csv?${q}`;
}

// ── Lluvia GOES (pluviómetro acumulado, 10–15 min) → mm por día ──────────────
export interface MuestraRaw { ts: string; valor: number }

/**
 * CSV de export SIN colapsar por día (series sub-diarias GOES). Conserva el sello completo "YYYY-MM-DD HH:MM:SS"
 * (UTC-6 fijo). Descarta la marca de hueco NaN y los vacíos: aquí un valor ausente no es una muestra.
 */
export function parseCsvRaw(texto: string): MuestraRaw[] {
  const out: MuestraRaw[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[;,](.*)$/.exec(linea);
    if (!m) continue;
    const valor = parseNumero(m[2]);
    if (valor !== null) out.push({ ts: m[1], valor });
  }
  return out;
}

/**
 * "Precip Total" de CONAGUA es un acumulado de pluviómetro con ruido y reinicios (sube, baja, se pone en 0 y a veces
 * da un pico absurdo, p. ej. 1481). La lluvia del día es la suma de los INCREMENTOS positivos entre muestras
 * consecutivas; se ignoran las bajadas (reinicio, deriva) y los saltos mayores a maxIncMm (pico o reinicio al revés).
 * Validado con 6 meses reales: días secos = 0.0 mm y los eventos coinciden con las estaciones propias.
 *
 * S/D vs 0: un día con menos de minHoras horas con muestra NO puede afirmar "0 mm" → valor null (S/D). Un día sin
 * ninguna muestra no genera fila. El día en curso (fecha ≥ hoy) se omite: está incompleto.
 */
export function precipitacionDiaria(
  muestras: MuestraRaw[],
  hoy: string,
  maxIncMm = 40,
  minHoras = 18,
): FilaDiaria[] {
  const s = [...muestras].sort((a, b) => a.ts.localeCompare(b.ts));
  const suma = new Map<string, number>();
  const horas = new Map<string, Set<string>>();
  for (let i = 0; i < s.length; i++) {
    const dia = s[i].ts.slice(0, 10);
    (horas.get(dia) ?? horas.set(dia, new Set()).get(dia)!).add(s[i].ts.slice(11, 13));
    if (i === 0) continue;
    const inc = s[i].valor - s[i - 1].valor;
    if (inc > 0 && inc <= maxIncMm) suma.set(dia, (suma.get(dia) ?? 0) + inc);
  }
  return [...horas.entries()]
    .filter(([dia]) => dia < hoy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, hs]) => ({ fecha: dia, valor: hs.size >= minHoras ? Math.round((suma.get(dia) ?? 0) * 100) / 100 : null }));
}

/** Días consecutivos, hasta el último día con dato, en que el valor no cambia (1 = cambió en el último día). 0 sin datos. */
export function diasIgualFinal(serie: FilaDiaria[]): number {
  const s = serie.filter((f) => f.valor !== null).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (s.length === 0) return 0;
  const ult = s[s.length - 1].valor;
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i].valor === ult; i--) n++;
  return n;
}
