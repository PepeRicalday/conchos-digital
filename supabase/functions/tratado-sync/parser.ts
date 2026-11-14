// Parser del corte semanal oficial del IBWC (Current_Cycle.pdf, generado desde Excel) y de los volúmenes diarios.
// Puro y sin dependencias de Deno salvo DecompressionStream (existe también en Node ≥ 18, para las pruebas).

export interface CorteOficial {
  fechaCorte: string;          // YYYY-MM-DD
  acumuladoAf: number;
  acumuladoMcm: number | null;
  deudaRemanenteAf: number | null;
  deficitCicloAnteriorAf: number | null;
  cicloInicio: string | null;  // YYYY-MM-DD
}

const MESES: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07",
  august: "08", september: "09", october: "10", november: "11", december: "12",
};

const num = (s: string) => Number(s.replace(/,/g, ""));

/** "November 7, 2026" → "2026-11-07" */
export function fechaIngles(s: string): string | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(s);
  const mes = m && MESES[m[1].toLowerCase()];
  return m && mes ? `${m[3]}-${mes}-${m[2].padStart(2, "0")}` : null;
}

/** Extrae los textos (Tj/TJ) de los content streams comprimidos (FlateDecode) del PDF. */
export async function textoDePdf(pdf: Uint8Array): Promise<string> {
  const bin = new TextDecoder("latin1").decode(pdf);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const ini = m.index + m[0].length;
    const fin = bin.indexOf("endstream", ini);
    if (fin < 0) break;
    let datos: Uint8Array;
    let finDatos = fin;
    while (finDatos > ini && (pdf[finDatos - 1] === 10 || pdf[finDatos - 1] === 13)) finDatos--; // EOL antes de "endstream"
    try {
      const ds = new DecompressionStream("deflate");
      const w = ds.writable.getWriter();
      w.write(pdf.slice(ini, finDatos)).catch(() => {});
      w.close().catch(() => {});
      datos = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    } catch { re.lastIndex = fin; continue; }
    const t = new TextDecoder("latin1").decode(datos);
    if (!/T[jJ]/.test(t)) { re.lastIndex = fin; continue; }
    for (const arr of t.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      out.push([...arr[1].matchAll(/\((.*?)\)/gs)].map((x) => x[1]).join(""));
    }
    for (const s of t.matchAll(/\(([^)]*)\)\s*Tj/g)) out.push(s[1]);
    re.lastIndex = fin;
  }
  return out.join("\n").replace(/\\([()])/g, "$1");
}

/** Interpreta el texto del PDF. null si no trae el acumulado y su fecha (formato cambió). */
export function parseCorte(texto: string): CorteOficial | null {
  // El Excel parte la línea con escapes: "363,679 AF \(449 MCM \) as of November 7, 2026".
  const acum = /([\d,]{6,})\s*AF[^\n]{0,12}?([\d,.]+)\s*MCM[^\n]{0,12}?as of\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(texto);
  if (!acum) return null;
  const fechaCorte = fechaIngles(acum[3]);
  if (!fechaCorte) return null;
  const ciclo = /Current Cycle:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*thru/i.exec(texto);
  const deficit = /deficit of\s*([\d,]+)\s*acre/i.exec(texto);
  const deuda = /remaining debt of\s*(?:of\s*)?([\d,]+)\s*acre/i.exec(texto);
  return {
    fechaCorte,
    acumuladoAf: num(acum[1]),
    acumuladoMcm: num(acum[2]),
    deudaRemanenteAf: deuda ? num(deuda[1]) : null,
    deficitCicloAnteriorAf: deficit ? num(deficit[1]) : null,
    cicloInicio: ciclo ? fechaIngles(ciclo[1]) : null,
  };
}
