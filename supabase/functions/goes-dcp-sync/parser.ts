// Parser del monitor DCP de Sutron (https://www.sutronwin.com/dcpmon/), telemetría GOES.
// Módulo puro (sin dependencias de Deno) para poder probarlo con vitest.

export const BASE_DCPMON = "https://www.sutronwin.com/dcpmon";

export interface TransmisionDcp {
  msgfilename: string;
  ts_msg: string;            // ISO UTC de la transmisión (epoch ms del nombre del archivo)
  codigo_falla: string;      // G = bueno, ? = error de paridad, etc.
  senal_dbm: number | null;
  longitud: number | null;
}

export interface LecturaDcp {
  variable: string;          // nombre normalizado (nivel_m, gasto_m3s, ...)
  codigo: string;            // código crudo del DCP (NI, GR, ...)
  idx: number;               // posición dentro del mensaje (0 = más antigua)
  n: number;                 // total de lecturas de ese código en el mensaje
  valor: number;
}

// Código del DCP → variable SICA. PA queda con nombre crudo hasta confirmar su significado.
export const VARIABLES_DCP: Record<string, string> = {
  NI: "nivel_m", N1: "nivel_m",
  GR: "gasto_m3s",
  VL: "velocidad_ms",
  PA: "pa_sin_confirmar",
  DV: "viento_dir_deg", VV: "viento_ms",
  TA: "temp_c", HR: "hr_pct", RS: "rad_wm2", PB: "presion_hpa",
};

const quitaTags = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

// Lista de transmisiones (dcpout.jsp). Una fila por transmisión; el enlace trae el epoch ms UTC.
export function parseListado(html: string): TransmisionDcp[] {
  const out: TransmisionDcp[] = [];
  for (const fila of html.split(/<tr class="full_perf_report">/i).slice(1)) {
    const enlace = fila.match(/msgfilename=([A-Za-z0-9_]+)/);
    if (!enlace) continue;
    const epoch = Number(enlace[1].split("_").at(-1));
    if (!Number.isFinite(epoch)) continue;
    const celdas = [...fila.split(/<\/tr>/i)[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => quitaTags(m[1]));
    // 0 canal, 1 fecha, 2 inicio, 3 fin, 4-5 ventana, 6 falla, 7 señal, 8 longitud
    const sen = Number(celdas[7]);
    const lon = Number(celdas[8]);
    out.push({
      msgfilename: enlace[1],
      ts_msg: new Date(epoch).toISOString(),
      codigo_falla: celdas[6] || "?",
      senal_dbm: celdas[7] && Number.isFinite(sen) ? sen : null,
      longitud: celdas[8] && Number.isFinite(lon) ? lon : null,
    });
  }
  return out;
}

const esNumero = (t: string) => /^-?\d+(\.\d+)?$/.test(t);

// Mensaje crudo (msg-html.jsp). Devuelve solo líneas íntegras; una línea con bytes corruptos
// o texto no numérico se descarta completa (nunca se rellena con 0).
export function parseMensaje(html: string): { lecturas: LecturaDcp[]; descartadas: string[] } {
  const lecturas: LecturaDcp[] = [];
  const descartadas: string[] = [];
  const i = html.search(/Raw Data:/i);
  if (i < 0) return { lecturas, descartadas: ["sin bloque Raw Data"] };
  const lineas = html.slice(i).split(/<\/?(?:p|br|pre|div)[^>]*>|\r?\n/i).map(quitaTags).filter(Boolean);
  for (const linea of lineas) {
    const m = linea.match(/^([A-Z][A-Z0-9])\s+(.+)$/);
    if (!m || !(m[1] in VARIABLES_DCP)) continue;
    const toks = m[2].trim().split(/\s+/);
    if (!toks.every(esNumero)) { descartadas.push(m[1]); continue; }
    toks.forEach((t, idx) => lecturas.push({
      variable: VARIABLES_DCP[m[1]], codigo: m[1], idx, n: toks.length, valor: Number(t),
    }));
  }
  return { lecturas, descartadas };
}

// Hora de cada lectura: la última es el cuarto de intervalo más reciente a la hora de transmisión
// y las anteriores van hacia atrás cada `intervaloMin`. Supuesto pendiente de validar contra
// aforos/escalas de campo (el mensaje no trae hora por lectura).
export function tsLectura(tsMsg: string, idx: number, n: number, intervaloMin: number): string {
  const paso = intervaloMin * 60_000;
  const ancla = Math.floor(new Date(tsMsg).getTime() / paso) * paso;
  return new Date(ancla - (n - 1 - idx) * paso).toISOString();
}
