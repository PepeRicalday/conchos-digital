// Gráficas del avance del Tratado como cadenas SVG: una sola fuente para la pantalla y para el informe (HTML/PDF/PNG).
// Dos paletas: 'pantalla' usa las variables del tema (claro/oscuro) y 'papel' colores fijos para impresión.
import { afAMm3, diasEntre, fechaLargaTratado, metasEn, type Afluente, type CicloTratado, type CorteOficial, type FilaMes } from './tratadoCiclo';

export interface Paleta {
  texto: string; texto2: string; rejilla: string; fondo: string;
  meta: string; metaDeuda: string; publicada: string; oficial: string; positivo: string; negativo: string;
  afluentes: string[];
}
export const PALETA_PAPEL: Paleta = {
  texto: '#1f2937', texto2: '#4b5563', rejilla: '#d1d5db', fondo: '#ffffff',
  meta: '#b91c1c', metaDeuda: '#2563eb', publicada: '#0f766e', oficial: '#111827', positivo: '#15803d', negativo: '#b45309',
  afluentes: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
};
export const PALETA_PANTALLA: Paleta = {
  texto: 'var(--pr-t1)', texto2: 'var(--pr-t3)', rejilla: 'var(--pr-line)', fondo: 'var(--pr-surface)',
  meta: '#e05a4f', metaDeuda: '#5b9cf0', publicada: '#2fb99a', oficial: 'var(--pr-t1)', positivo: 'var(--pr-ok)', negativo: 'var(--pr-warn)',
  afluentes: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fCorta = (iso: string) => `${+iso.slice(8, 10)} ${MES3[+iso.slice(5, 7) - 1]} ${iso.slice(2, 4)}`;
const mesCorto = (mes: string) => `${MES3[+mes.slice(5, 7) - 1]} ${mes.slice(2, 4)}`;

/** Escala «bonita»: 4 a 6 marcas con paso 1, 2, 2.5 o 5 × 10ⁿ. */
export function marcasEscala(max: number): { max: number; paso: number } {
  if (!(max > 0)) return { max: 1, paso: 0.25 };
  const crudo = max / 5;
  const pot = Math.pow(10, Math.floor(Math.log10(crudo)));
  const f = crudo / pot;
  const paso = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pot;
  return { max: Math.ceil(max / paso) * paso, paso };
}

interface OpcionesAvance {
  ciclo: CicloTratado; dominioDesde: string; dominioHasta: string;
  publicada: { fecha: string; af: number }[]; cortes: CorteOficial[]; paleta: Paleta;
  ancho?: number; alto?: number; mostrarDeuda?: boolean; hoy: string;
}

/** Acumulado del ciclo contra la meta lineal y la meta con deuda (en Mm³; eje derecho en acre-pies). */
export function svgAvance(o: OpcionesAvance): string {
  const W = o.ancho ?? 760, H = o.alto ?? 330, ml = 58, mr = 62, mt = 24, mb = 40;
  const p = o.paleta;
  const total = Math.max(1, diasEntre(o.dominioDesde, o.dominioHasta));
  const x = (f: string) => ml + (Math.min(Math.max(diasEntre(o.dominioDesde, f), 0), total) / total) * (W - ml - mr);
  const mDom = (f: string) => { const m = metasEn(o.ciclo, f); return { l: afAMm3(m.lineal), d: afAMm3(m.conDeuda) }; };
  // Las metas son lineales: el valor en el extremo derecho del dominio fija la altura
  const yMaxDatos = Math.max(
    mDom(o.dominioHasta).l, o.mostrarDeuda ? mDom(o.dominioHasta).d : 0,
    ...o.publicada.map((s) => afAMm3(s.af)), ...o.cortes.map((c) => afAMm3(c.acumuladoAf)),
  );
  const esc_ = marcasEscala(yMaxDatos * 1.04);
  const y = (mm3: number) => H - mb - (mm3 / esc_.max) * (H - mt - mb);
  const partes: string[] = [];
  // rejilla y ejes
  for (let v = 0; v <= esc_.max + 1e-9; v += esc_.paso) {
    partes.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="${p.rejilla}" stroke-width="${v === 0 ? 1 : 0.6}"${v === 0 ? '' : ' stroke-dasharray="3 3"'}/>`);
    partes.push(`<text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${p.texto2}">${n0(v)}</text>`);
    partes.push(`<text x="${W - mr + 6}" y="${y(v) + 4}" font-size="11" fill="${p.texto2}">${n0((v * 1_000_000) / 1233.4818 / 1000)}</text>`);
  }
  partes.push(`<text x="${ml - 6}" y="${mt - 6}" text-anchor="end" font-size="11" fill="${p.texto2}">Mm³</text><text x="${W - mr + 6}" y="${mt - 6}" font-size="11" fill="${p.texto2}">miles de AF</text>`);
  // marcas del eje X: aniversarios (25-oct) si el dominio es largo; meses si es corto
  const largo = total > 500;
  const marcas: string[] = [];
  if (largo) {
    const y0 = +o.ciclo.inicio.slice(0, 4);
    for (let k = 0; k <= 5; k++) marcas.push(k === 5 ? o.ciclo.fin : `${y0 + k}${o.ciclo.inicio.slice(4)}`);
  } else {
    const paso = total > 200 ? 2 : 1; let i = 0;
    for (let d = `${o.dominioDesde.slice(0, 7)}-01`; d <= o.dominioHasta; ) {
      if (d >= o.dominioDesde && i++ % paso === 0) marcas.push(d);
      const m = +d.slice(5, 7); d = m === 12 ? `${+d.slice(0, 4) + 1}-01-01` : `${d.slice(0, 4)}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  for (const f of marcas) {
    partes.push(`<line x1="${x(f)}" x2="${x(f)}" y1="${H - mb}" y2="${H - mb + 4}" stroke="${p.texto2}"/>`);
    partes.push(`<text x="${x(f)}" y="${H - mb + 17}" text-anchor="middle" font-size="11" fill="${p.texto2}">${largo ? fCorta(f) : mesCorto(f.slice(0, 7))}</text>`);
  }
  // metas
  const l0 = o.dominioDesde < o.ciclo.inicio ? o.ciclo.inicio : o.dominioDesde;
  partes.push(`<line x1="${x(l0)}" y1="${y(mDom(l0).l)}" x2="${x(o.dominioHasta)}" y2="${y(mDom(o.dominioHasta).l)}" stroke="${p.meta}" stroke-width="2"/>`);
  if (o.mostrarDeuda) partes.push(`<line x1="${x(l0)}" y1="${y(mDom(l0).d)}" x2="${x(o.dominioHasta)}" y2="${y(mDom(o.dominioHasta).d)}" stroke="${p.metaDeuda}" stroke-width="1.6" stroke-dasharray="6 4"/>`);
  // acumulado publicado (suma de las series públicas; puede quedar por debajo del oficial)
  const pub = o.publicada.filter((s) => s.fecha >= o.dominioDesde && s.fecha <= o.dominioHasta);
  if (pub.length > 1) partes.push(`<polyline fill="none" stroke="${p.publicada}" stroke-width="2" stroke-dasharray="2 3" points="${pub.map((s) => `${x(s.fecha).toFixed(1)},${y(afAMm3(s.af)).toFixed(1)}`).join(' ')}"/>`);
  // cortes oficiales
  const cor = o.cortes.filter((c) => c.fecha >= o.dominioDesde && c.fecha <= o.dominioHasta).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  if (cor.length > 1) partes.push(`<polyline fill="none" stroke="${p.oficial}" stroke-width="2.4" points="${cor.map((c) => `${x(c.fecha).toFixed(1)},${y(afAMm3(c.acumuladoAf)).toFixed(1)}`).join(' ')}"/>`);
  for (const c of cor) partes.push(`<circle cx="${x(c.fecha).toFixed(1)}" cy="${y(afAMm3(c.acumuladoAf)).toFixed(1)}" r="4.5" fill="${p.oficial}" stroke="${p.fondo}" stroke-width="1.5"/>`);
  const ult = cor[cor.length - 1];
  if (ult) {
    const ux = x(ult.fecha), uy = y(afAMm3(ult.acumuladoAf));
    const der = ux > W - 190;
    partes.push(`<text x="${der ? ux - 10 : ux + 10}" y="${uy - 12}" text-anchor="${der ? 'end' : 'start'}" font-size="12" font-weight="700" fill="${p.texto}">${n0(ult.acumuladoAf)} AF · ${n0(afAMm3(ult.acumuladoAf))} Mm³</text>`);
  }
  // hoy
  if (o.hoy >= o.dominioDesde && o.hoy <= o.dominioHasta) partes.push(`<line x1="${x(o.hoy)}" x2="${x(o.hoy)}" y1="${mt}" y2="${H - mb}" stroke="${p.texto2}" stroke-width="1" stroke-dasharray="1 4"/>`);
  const resumen = ult ? `Acumulado oficial al ${fechaLargaTratado(ult.fecha)}: ${n0(ult.acumuladoAf)} acre-pies.` : 'Sin corte oficial en el periodo.';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(`Avance acumulado del ciclo contra la meta lineal. ${resumen}`)}" style="font-family:inherit;display:block">${partes.join('')}</svg>`;
}

interface OpcionesMensual { filas: FilaMes[]; afluentes: Afluente[]; paleta: Paleta; ancho?: number; alto?: number }

/** Volumen mensual por afluente, barras apiladas (Mm³). */
export function svgMensual(o: OpcionesMensual): string {
  const W = o.ancho ?? 760, H = o.alto ?? 280, ml = 50, mr = 12, mt = 14, mb = 36;
  const p = o.paleta;
  if (!o.filas.length) return `<svg viewBox="0 0 ${W} 60" width="100%" role="img" aria-label="Sin volumen mensual (S/D)"><text x="${W / 2}" y="34" text-anchor="middle" font-size="13" fill="${p.texto2}">Sin volumen mensual en el periodo (S/D)</text></svg>`;
  const orden = [...o.afluentes].sort((a, b) => a.orden - b.orden);
  const maxMm3 = Math.max(...o.filas.map((f) => afAMm3(f.totalAf)));
  const esc_ = marcasEscala(maxMm3 * 1.05);
  const y = (v: number) => H - mb - (v / esc_.max) * (H - mt - mb);
  const bw = Math.min(46, ((W - ml - mr) / o.filas.length) * 0.66);
  const partes: string[] = [];
  for (let v = 0; v <= esc_.max + 1e-9; v += esc_.paso) {
    partes.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="${p.rejilla}" stroke-width="${v === 0 ? 1 : 0.6}"${v === 0 ? '' : ' stroke-dasharray="3 3"'}/>`);
    partes.push(`<text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${p.texto2}">${n0(v)}</text>`);
  }
  partes.push(`<text x="6" y="${mt + 2}" font-size="11" fill="${p.texto2}">Mm³</text>`);
  o.filas.forEach((f, i) => {
    const cx = ml + ((i + 0.5) / o.filas.length) * (W - ml - mr);
    let base = 0;
    orden.forEach((a, k) => {
      const v = afAMm3(f.afluentes[a.clave] ?? 0);
      if (v <= 0) return;
      partes.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, y(base) - y(base + v)).toFixed(1)}" fill="${p.afluentes[k % p.afluentes.length]}"><title>${esc(a.nombre)} · ${esc(mesCorto(f.mes))}: ${n0(v)} Mm³</title></rect>`);
      base += v;
    });
    partes.push(`<text x="${cx.toFixed(1)}" y="${(y(base) - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${p.texto}">${n0(base)}</text>`);
    partes.push(`<text x="${cx.toFixed(1)}" y="${H - mb + 16}" text-anchor="middle" font-size="11" fill="${p.texto2}">${mesCorto(f.mes)}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Volumen mensual entregado por afluente, en millones de metros cúbicos" style="font-family:inherit;display:block">${partes.join('')}</svg>`;
}

/** Barra horizontal de avance contra el compromiso (0 – 100 %), con la marca de la meta lineal. */
export function svgBarraAvance(pct: number | null, metaPct: number | null, paleta: Paleta, ancho = 360): string {
  const H = 26, ml = 4, mr = 4;
  const w = ancho - ml - mr;
  if (pct == null) return `<svg viewBox="0 0 ${ancho} ${H}" width="100%" role="img" aria-label="Avance S/D"><rect x="${ml}" y="8" width="${w}" height="10" rx="5" fill="${paleta.rejilla}"/></svg>`;
  const v = Math.max(0, Math.min(100, pct));
  const m = metaPct == null ? null : Math.max(0, Math.min(100, metaPct));
  return `<svg viewBox="0 0 ${ancho} ${H}" width="100%" role="img" aria-label="${esc(`Avance ${pct.toFixed(1)} % del compromiso${m != null ? `; meta lineal ${m.toFixed(1)} %` : ''}`)}">`
    + `<rect x="${ml}" y="8" width="${w}" height="10" rx="5" fill="${paleta.rejilla}"/>`
    + `<rect x="${ml}" y="8" width="${(w * v) / 100}" height="10" rx="5" fill="${paleta.oficial === 'var(--pr-t1)' ? 'var(--pr-sky)' : paleta.publicada}"/>`
    + (m != null ? `<line x1="${ml + (w * m) / 100}" x2="${ml + (w * m) / 100}" y1="3" y2="23" stroke="${paleta.meta}" stroke-width="2.5"/>` : '')
    + `</svg>`;
}
