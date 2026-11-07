// Parser puro (sin Deno) del TXT de telemetría USIBWC (TelemetryTXT/<sitio>.txt).
// Formato observado (08373000, 2026-11-07):
//   Data Usage Disclaimer: ...
//   08373000 Rio Conchos Near Ojinaga, Chih.
//       Date     Time      Stage          Discharge
//                CST       (meters)       (cubic meters per second)
//   11/07/2026   16:00       1.488                 1.42
// Orden descendente, ventana móvil de 30 días, 15 min. Hora según la etiqueta del encabezado: CST (UTC-6) o CDT (UTC-5).
// Valor no numérico o centinela (≤ -999) = S/D: se omite, NUNCA se vuelve 0.

export const BASE_IBWC = "https://ibwcsftpstg.blob.core.windows.net/wad/TelemetryTXT";
/** Desfase a UTC por etiqueta de zona del encabezado (CST = 6, CDT = 5). Sin etiqueta reconocida se asume CST. */
export const OFFSET_ZONA_H: Record<string, number> = { CST: 6, CDT: 5 };
export const OFFSET_CST_H = 6;

export interface LecturaIbwc { ts_utc: string; variable: "nivel_m" | "gasto_m3s"; valor: number }
export interface ResultadoIbwc { zona: string; sitio: string | null; nombre: string | null; lecturas: LecturaIbwc[]; descartadas: number; lineasDatos: number }

const RE_FILA = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(\S+)\s+(\S+)\s*$/;
const RE_SITIO = /^\s*(\d{8})\s+(.+?)\s*$/;

function numero(tok: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(tok)) return null;
  const v = Number(tok);
  return Number.isFinite(v) && v > -999 ? v : null;
}

/** Hora local CST (campos del archivo) → ISO UTC. null si la fecha es imposible. */
export function cstAUtcIso(mes: number, dia: number, anio: number, hh: number, mm: number, offsetH: number = OFFSET_CST_H): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23 || mm > 59) return null;
  const dia0 = new Date(Date.UTC(anio, mes - 1, dia));
  // Date.UTC normaliza 02/31 a marzo: se rechaza si el día no coincide.
  if (dia0.getUTCMonth() !== mes - 1 || dia0.getUTCDate() !== dia) return null;
  return new Date(Date.UTC(anio, mes - 1, dia, hh + offsetH, mm)).toISOString();
}

/** Cadencia de guardado: conserva solo lecturas cuyo instante UTC es múltiplo de `minutos` (120 = horas pares; CST fijo → también pares en CST). */
export function filtrarCadencia<T extends { ts_utc: string }>(lecturas: T[], minutos: number): T[] {
  if (minutos <= 15) return lecturas;
  return lecturas.filter((l) => Math.round(Date.parse(l.ts_utc) / 60000) % minutos === 0);
}

export function parseTelemetriaIbwc(texto: string): ResultadoIbwc {
  const lecturas: LecturaIbwc[] = [];
  let sitio: string | null = null;
  let nombre: string | null = null;
  let descartadas = 0;
  let lineasDatos = 0;
  let zona = "CST";
  let zonaVista = false;
  for (const linea of texto.split(/\r?\n/)) {
    const f = RE_FILA.exec(linea);
    if (!f) {
      const z = /^\s*(CST|CDT)(?![A-Za-z])/.exec(linea);
      if (z && !zonaVista) { zona = z[1]; zonaVista = true; }
      if (!sitio) {
        const s = RE_SITIO.exec(linea);
        if (s) { sitio = s[1]; nombre = s[2]; }
      }
      continue;
    }
    lineasDatos++;
    const ts = cstAUtcIso(Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5]), OFFSET_ZONA_H[zona]);
    if (!ts) { descartadas++; continue; }
    const nivel = numero(f[6]);
    const gasto = numero(f[7]);
    if (nivel == null && gasto == null) { descartadas++; continue; }
    if (nivel != null) lecturas.push({ ts_utc: ts, variable: "nivel_m", valor: nivel });
    if (gasto != null) lecturas.push({ ts_utc: ts, variable: "gasto_m3s", valor: gasto });
  }
  lecturas.sort((a, b) => (a.ts_utc < b.ts_utc ? -1 : a.ts_utc > b.ts_utc ? 1 : 0));
  return { zona, sitio, nombre, lecturas, descartadas, lineasDatos };
}
