/**
 * informeCuencaSvg — gráficos SVG del informe de la cuenca, con paleta para PAPEL (fondo blanco/crema). Puro (strings).
 * Sin texto dentro de los SVG (los rótulos van en HTML): así no dependen de la fuente al rasterizar y no se recortan.
 * Un S/D nunca se dibuja como 0: tanque vacío con trama gris y series cortadas.
 */
import { alturaRelleno, anchoTanque, posicionMuerto, type PuntoBanda, type PuntoSemanal } from './cuencaViz';

export const COLOR_PAPEL = {
  ok: '#1F7A44', warn: '#B26A00', crit: '#B3261E', sd: '#7B848E',
  linea: '#2B3A4D', tenue: '#C9D2DC', agua: '#0A7FDB', banda: '#BFD9F2', mediana: '#5B7FA8', muerto: '#0A7FDB',
} as const;

export type ClaveEstado = 'ok' | 'warn' | 'crit' | 'sd';
export const colorEstado = (c: string): string => (c === 'ok' || c === 'warn' || c === 'crit' ? COLOR_PAPEL[c] : COLOR_PAPEL.sd);

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface TanqueEntrada {
  id: number;
  namoMm3: number | null;
  muertoMm3: number | null;
  pct: number | null;
  estado: string;
  sinActualizar: boolean;
}

/** Un tanque: ancho ∝ √NAMO, relleno = % del NAMO, marcas 20/40 %, línea punteada del volumen muerto, trama si sin actualizar. */
export function tanqueSvg(t: TanqueEntrada, maxNamo: number, alto: number, anchoMin = 56, anchoMax = 200): string {
  const w = Math.round(anchoTanque(t.namoMm3, maxNamo, anchoMin, anchoMax));
  const pad = 3, h = alto - 2 * pad, x0 = pad, y0 = pad, wi = w - 2 * pad;
  const rell = (h * alturaRelleno(t.pct)) / 100;
  const color = colorEstado(t.estado);
  const idTrama = `tr-${t.id}`;
  const m = posicionMuerto(t.muertoMm3, t.namoMm3);
  const marca = (pct: number) => `<line x1="${x0}" x2="${x0 + wi}" y1="${f1(y0 + h - (h * pct) / 100)}" y2="${f1(y0 + h - (h * pct) / 100)}" stroke="${COLOR_PAPEL.linea}" stroke-opacity=".55" stroke-width="1" stroke-dasharray="4 3"/>`;
  const cuerpo = t.pct == null
    ? `<rect x="${x0}" y="${y0}" width="${wi}" height="${h}" fill="url(#${idTrama}s)"/>`
    : `<rect x="${x0}" y="${f1(y0 + h - rell)}" width="${wi}" height="${f1(rell)}" fill="${color}"/>`
      + (t.sinActualizar ? `<rect x="${x0}" y="${f1(y0 + h - rell)}" width="${wi}" height="${f1(rell)}" fill="url(#${idTrama})"/>` : '');
  return `<svg class="tq" width="${w}" height="${alto}" viewBox="0 0 ${w} ${alto}" role="img" aria-hidden="true" focusable="false">`
    + `<defs><pattern id="${idTrama}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-opacity=".75" stroke-width="2.2"/></pattern>`
    + `<pattern id="${idTrama}s" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${COLOR_PAPEL.sd}" stroke-opacity=".55" stroke-width="1.6"/></pattern></defs>`
    + `<rect x="${x0}" y="${y0}" width="${wi}" height="${h}" fill="#F3F6F9"/>${cuerpo}${marca(20)}${marca(40)}`
    + (m != null ? `<line x1="${x0}" x2="${x0 + wi}" y1="${f1(y0 + h - (h * m) / 100)}" y2="${f1(y0 + h - (h * m) / 100)}" stroke="${COLOR_PAPEL.muerto}" stroke-width="1.6" stroke-dasharray="1.5 2.5"/>` : '')
    + `<rect x="${x0}" y="${y0}" width="${wi}" height="${h}" fill="none" stroke="${COLOR_PAPEL.linea}" stroke-width="1.6" rx="2"/></svg>`;
}

/**
 * Mini-serie de llenado 0-100 % del NAMO: banda histórica p10-p90 (si hay), mediana y la línea de la presa. Una lectura dudosa
 * (sin actualizar) se dibuja punteada; los huecos cortan la línea (nunca se interpolan ni caen a 0).
 */
export function miniSerieSvg(serie: PuntoSemanal[], banda: PuntoBanda[] | null, w: number, h: number): string {
  const pts = serie.filter((p) => p.fecha);
  if (pts.length < 2) return `<svg class="ms" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#F3F6F9" stroke="${COLOR_PAPEL.tenue}"/></svg>`;
  const t0 = Date.parse(pts[0].fecha), t1 = Date.parse(pts[pts.length - 1].fecha);
  const X = (f: string) => ((Date.parse(f) - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2;
  const Y = (v: number) => h - 2 - (Math.max(0, Math.min(100, v)) / 100) * (h - 4);

  let bandaSvg = '';
  const b = (banda ?? []).filter((p) => p.p10 != null && p.p90 != null);
  if (b.length >= 2) {
    const arriba = b.map((p) => `${f1(X(p.fecha))},${f1(Y(p.p90 as number))}`);
    const abajo = [...b].reverse().map((p) => `${f1(X(p.fecha))},${f1(Y(p.p10 as number))}`);
    bandaSvg += `<polygon points="${[...arriba, ...abajo].join(' ')}" fill="${COLOR_PAPEL.banda}" fill-opacity=".75"/>`;
    const med = b.filter((p) => p.mediana != null);
    if (med.length >= 2) bandaSvg += `<polyline points="${med.map((p) => `${f1(X(p.fecha))},${f1(Y(p.mediana as number))}`).join(' ')}" fill="none" stroke="${COLOR_PAPEL.mediana}" stroke-width="1" stroke-dasharray="3 2"/>`;
  }

  // Tramos continuos separados por huecos; los dudosos van punteados.
  const tramos: { dudoso: boolean; p: string[] }[] = [];
  for (const p of pts) {
    if (p.pct == null) { tramos.push({ dudoso: false, p: [] }); continue; }
    let u = tramos[tramos.length - 1];
    if (!u || u.p.length === 0 || u.dudoso !== p.dudoso) {
      u = { dudoso: p.dudoso, p: [] }; tramos.push(u);
      const prev = pts[pts.indexOf(p) - 1];
      if (prev?.pct != null) u.p.push(`${f1(X(prev.fecha))},${f1(Y(prev.pct))}`);
    }
    u.p.push(`${f1(X(p.fecha))},${f1(Y(p.pct))}`);
  }
  const lineas = tramos.filter((t) => t.p.length >= 2).map((t) =>
    `<polyline points="${t.p.join(' ')}" fill="none" stroke="${COLOR_PAPEL.linea}" stroke-width="1.8" stroke-linejoin="round"${t.dudoso ? ' stroke-dasharray="3 3" stroke-opacity=".7"' : ''}/>`).join('');
  const ultimo = [...pts].reverse().find((p) => p.pct != null);
  const punto = ultimo ? `<circle cx="${f1(X(ultimo.fecha))}" cy="${f1(Y(ultimo.pct as number))}" r="2.6" fill="${COLOR_PAPEL.linea}"/>` : '';
  const guias = [20, 40].map((v) => `<line x1="2" x2="${w - 2}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="${COLOR_PAPEL.tenue}" stroke-width=".8" stroke-dasharray="2 3"/>`).join('');
  return `<svg class="ms" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#F7F9FB" stroke="${COLOR_PAPEL.tenue}"/>${guias}${bandaSvg}${lineas}${punto}</svg>`;
}

/** Rampa única (azul) para la lluvia diaria; el valor numérico va en el HTML, el color no es el único canal. */
export function colorLluvia(mm: number | null): string {
  if (mm == null) return '#E4E8EC';
  if (mm < 1) return '#F1F6FB';
  if (mm < 5) return '#CFE4F7';
  if (mm < 10) return '#8DBFEA';
  if (mm < 25) return '#3E8FD6';
  return '#0B3170';
}

/** Tira de 30 días de un pluviómetro. S/D = celda gris con trama (nunca un día seco). */
export function tiraLluviaSvg(dias: (number | null)[], w: number, h: number): string {
  const n = Math.max(1, dias.length), cw = w / n;
  const celdas = dias.map((v, i) =>
    `<rect x="${f1(i * cw + 0.5)}" y="0.5" width="${f1(cw - 1)}" height="${h - 1}" fill="${colorLluvia(v)}"${v == null ? ` stroke="${COLOR_PAPEL.sd}" stroke-opacity=".5" stroke-dasharray="2 2"` : ''}/>`).join('');
  return `<svg class="tl" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" focusable="false">${celdas}</svg>`;
}
