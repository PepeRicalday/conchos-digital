// Parser del Reservoir Report de la CILA/USIBWC (res_report.txt y res_report_shef.txt).
// Módulo puro (sin dependencias de Deno) para poder probarlo con vitest.

export interface LecturaCila {
  presa_id: string;
  fecha: string;               // YYYY-MM-DD, día local del timestamp del reporte
  ts_reporte: string;          // ISO con offset -06:00 (Chihuahua, sin horario de verano)
  almacenamiento_mm3: number | null;
  elevacion_msnm: number | null;
  extraccion_m3s: number | null;
  pct_conservacion: number | null;
  elev_conservacion_msnm: number | null;
  cap_conservacion_mm3: number | null;
  cap_inundacion_mm3: number | null;
  payload_raw: string;
}

// Clave normalizada del nombre en el reporte → presa SICA y código SHEF.
export const PRESAS_CILA: Record<string, { presa_id: string; shef: string }> = {
  LABOQUILLACHIH: { presa_id: "PRE-001", shef: "LBQCH" },
  FCOIMADEROCHIH: { presa_id: "PRE-002", shef: "FIMCH" },
};

const MESES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export const normalizarNombre = (s: string) =>
  s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

// "05-Oct-2026 00:00" → { fecha: "2026-10-05", iso: "2026-10-05T00:00:00-06:00" }
export function parseTimestamp(s: string): { fecha: string; iso: string } | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  const dd = m[1].padStart(2, "0");
  const hh = m[4].padStart(2, "0");
  return { fecha: `${m[3]}-${mes}-${dd}`, iso: `${m[3]}-${mes}-${dd}T${hh}:${m[5]}:00-06:00` };
}

// "N/A", "" o no numérico → null (regla S/D: nunca 0).
export function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "" || /^n\/?a$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function parseReporte(txt: string): { lecturas: LecturaCila[]; errores: string[] } {
  const errores: string[] = [];
  const lecturas: LecturaCila[] = [];
  const lineas = txt.split(/\r?\n/);
  const iSec = lineas.findIndex((l) => /Large Storage Reservoirs in Mexico/i.test(l));
  if (iSec < 0) return { lecturas, errores: ["Sección 'Large Storage Reservoirs in Mexico' no encontrada"] };

  const vistas = new Set<string>();
  for (const linea of lineas.slice(iSec + 1)) {
    const campos = linea.split("|").map((c) => c.trim());
    if (campos.length < 10) continue;
    const info = PRESAS_CILA[normalizarNombre(campos[0])];
    if (!info) continue;
    vistas.add(info.presa_id);
    // nombre | cons elev | cons cap | flood elev | flood cap | ts elev | elev | storage | ts storage | release | pct
    const ts = parseTimestamp(campos[8]) ?? parseTimestamp(campos[5]);
    if (!ts) { errores.push(`${campos[0]}: timestamp inválido '${campos[8]}'`); continue; }
    const almacenamiento = num(campos[7]);
    const capInund = num(campos[4]);
    if (almacenamiento != null && (almacenamiento < 0 || (capInund != null && almacenamiento > capInund))) {
      errores.push(`${campos[0]}: almacenamiento fuera de rango (${almacenamiento})`);
      continue;
    }
    lecturas.push({
      presa_id: info.presa_id,
      fecha: ts.fecha,
      ts_reporte: ts.iso,
      almacenamiento_mm3: almacenamiento,
      elevacion_msnm: num(campos[6]),
      extraccion_m3s: num(campos[9]),
      pct_conservacion: num(campos[10]),
      elev_conservacion_msnm: num(campos[1]),
      cap_conservacion_mm3: num(campos[2]),
      cap_inundacion_mm3: capInund,
      payload_raw: linea.trim(),
    });
  }
  for (const [k, v] of Object.entries(PRESAS_CILA)) {
    if (!vistas.has(v.presa_id)) {
      errores.push(`Presa ${v.presa_id} (${k}) ausente en el reporte`);
    }
  }
  return { lecturas, errores };
}

// SHEF: ".A LBQCH 261005 CS DH0000/DUS/LS 702.466/DH0000/QT 0.0" → { LBQCH: { storage, release } }
export function parseShef(txt: string): Record<string, { storage: number | null; release: number | null }> {
  const out: Record<string, { storage: number | null; release: number | null }> = {};
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^\.A\s+(\w+)\s+/);
    if (!m) continue;
    const ls = l.match(/\bLS\s+(-?[\d.]+)/);
    const qt = l.match(/\bQT\s+(-?[\d.]+)/);
    out[m[1]] = { storage: ls ? Number(ls[1]) : null, release: qt ? Number(qt[1]) : null };
  }
  return out;
}
