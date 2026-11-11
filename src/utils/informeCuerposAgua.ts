/**
 * informeCuerposAgua — hoja «Cuerpos de agua de la cuenca» del Informe de Cuenca (PDF carta). Lógica PURA: devuelve HTML/SVG como texto.
 * Cierres mensuales 2021 → hoy con su fuente, cobertura por cuerpo y plano de cada vaso (huella máxima KMZ y espejo satelital).
 * Reglas: S/D nunca 0; la huella es el nivel de diseño, no el de hoy; sin medición satelital no se inventa un área.
 */
import { esc } from './informeBase';
import { COLOR_PAPEL } from './informeCuencaSvg';
import {
  coberturaDeCuerpo, etiquetaMes, longitudEscala, proyeccionPara, rutaDeAnillos, ultimoCierreConDato,
  type CierreMensual, type CuerpoAgua, type FuenteAlm, type Par,
} from './cuerposAgua';

export interface EscenaInforme { fecha: string; areaKm2: number | null; incertidumbreKm2: number | null; contorno: Par[][] }
export interface DatosCuerposInforme {
  cuerpos: CuerpoAgua[];
  cierres: CierreMensual[];
  huellas: Map<string, { anillos: Par[][]; areaKm2: number; numIslas: number }>;
  /** Última escena satelital de cada cuerpo (clave = id_serie). */
  escenas: Map<string, EscenaInforme>;
}

const SD = '<span class="sd">S/D</span>';
const nTxt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? null : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const num = (v: number | null | undefined, d = 1) => { const t = nTxt(v, d); return t == null ? SD : esc(t); };
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' });

/** Plano de un vaso: huella punteada y, si existe, espejo observado relleno. Cada plano a su escala (barra de escala dentro). */
export function planoVasoSvg(huella: Par[][] | undefined, espejo: Par[][] | undefined, w = 170, h = 112): string {
  const base = huella?.length ? huella : (espejo ?? []);
  const p = proyeccionPara(base, w, h, 8);
  if (!p) return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Sin polígono del vaso"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="${COLOR_PAPEL.tenue}" stroke-dasharray="4 3"/><text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="10" fill="${COLOR_PAPEL.sd}">Sin polígono (S/D)</text></svg>`;
  const esc_ = longitudEscala(p.mPorPx, 44);
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Huella máxima del vaso${espejo?.length ? ' y espejo observado' : ''}">
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#fff" stroke="${COLOR_PAPEL.tenue}"/>
${huella?.length ? `<path d="${rutaDeAnillos(huella, p)}" fill="${COLOR_PAPEL.banda}" fill-opacity=".45" fill-rule="evenodd" stroke="${COLOR_PAPEL.linea}" stroke-width="0.9" stroke-dasharray="4 2.5" stroke-linejoin="round"/>` : ''}
${espejo?.length ? `<path d="${rutaDeAnillos(espejo, p)}" fill="${COLOR_PAPEL.agua}" fill-opacity=".75" fill-rule="evenodd" stroke="${COLOR_PAPEL.agua}" stroke-width="0.8" stroke-linejoin="round"/>` : ''}
<g transform="translate(8 ${h - 8})"><line x1="0" x2="${esc_.px.toFixed(1)}" y1="0" y2="0" stroke="${COLOR_PAPEL.linea}" stroke-width="1.2"/><text x="${(esc_.px + 4).toFixed(1)}" y="3" font-size="8" fill="${COLOR_PAPEL.linea}">${esc(esc_.etiqueta)}</text></g>
<text x="${w - 6}" y="12" text-anchor="end" font-size="8" fill="${COLOR_PAPEL.linea}">N ↑</text></svg>`;
}

/** Tabla: último cierre con dato, cobertura 2021 → hoy y vaso por satélite de cada cuerpo. */
export function tablaCuerposAgua(d: DatosCuerposInforme): string {
  const filas = d.cuerpos.map((c) => {
    const cs = d.cierres.filter((x) => x.cuerpoId === c.id);
    const u = ultimoCierreConDato(cs), k = coberturaDeCuerpo(cs);
    const ultimo = cs.length ? cs.reduce((a, b) => (b.mes > a.mes ? b : a)) : null;
    const vencido = u != null && ultimo != null && u.mes !== ultimo.mes;
    const huella = d.huellas.get(c.id), esc2 = d.escenas.get(c.idSerie);
    const fuentes = (['SRL', 'SINA', 'AQWP'] as FuenteAlm[]).filter((f) => k.porFuente[f] > 0).map((f) => `${f === 'SRL' ? 'R' : f === 'SINA' ? 'S' : 'A'} ${k.porFuente[f]}`).join(' · ');
    return `<tr><th scope="row">${esc(c.etiqueta)}${c.rol !== 'almacenamiento' ? ` <small>${c.rol === 'reguladora' ? 'reguladora' : 'derivadora'}</small>` : ''}</th>
<td>${u ? `${esc(etiquetaMes(u.mes, true))}${vencido ? ' <small>(último dato)</small>' : ''}` : SD}</td>
<td class="n">${num(u?.almMm3, u && (u.almMm3 ?? 0) >= 100 ? 0 : 1)}</td>
<td class="n">${u?.pctNamo == null ? SD : `${esc(nTxt(u.pctNamo, 1) ?? '')} %`}</td>
<td class="n">${k.conDato} de ${k.total}</td>
<td>${fuentes ? esc(fuentes) : SD}</td>
<td class="n">${k.difiere + k.repetido > 0 ? `${k.difiere} / ${k.repetido}` : '0 / 0'}</td>
<td class="n">${huella ? esc(nTxt(huella.areaKm2, 1) ?? '') : SD}</td>
<td class="n">${esc2?.areaKm2 != null ? `${esc(nTxt(esc2.areaKm2, 1) ?? '')}${esc2.incertidumbreKm2 != null ? ` ± ${esc(nTxt(esc2.incertidumbreKm2, 2) ?? '')}` : ''} <small>${esc(fechaCorta(esc2.fecha))}</small>` : '<span class="sd">sin medir</span>'}</td></tr>`;
  }).join('');
  return `<table class="cifras" aria-label="Cuerpos de agua de la cuenca"><thead><tr><th>Cuerpo de agua</th><th>Último cierre</th><th class="n">Mm³</th><th class="n">% NAMO</th><th class="n">Meses con dato</th><th>Fuente (meses)</th><th class="n">Difiere / igual</th><th class="n">Huella km²</th><th class="n">Espejo km²</th></tr></thead><tbody>${filas}</tbody></table>`;
}

/** Cuadrícula de planos de vasos. */
export function planosVasosHtml(d: DatosCuerposInforme): string {
  return `<div class="vasos">${d.cuerpos.map((c) => {
    const h = d.huellas.get(c.id), e = d.escenas.get(c.idSerie);
    return `<figure class="vaso"><figcaption><b>${esc(c.etiqueta)}</b></figcaption>${planoVasoSvg(h?.anillos, e?.contorno, 170, 108)}<small>${h ? `huella ${esc(nTxt(h.areaKm2, 1) ?? '')} km²` : 'huella S/D'}${e?.areaKm2 != null ? ` · espejo ${esc(nTxt(e.areaKm2, 1) ?? '')} km²` : ' · sin medición satelital'}</small></figure>`;
  }).join('')}</div>`;
}

/** Notas de lectura de la hoja (texto plano; el HTML las escapa). */
export function notasCuerposAgua(d: DatosCuerposInforme): string[] {
  const sd = d.cuerpos.filter((c) => c.aqwpUbicacionId == null);
  const medidos = d.cuerpos.filter((c) => d.escenas.has(c.idSerie)).length;
  return [
    `Cierre = almacenamiento del último día del mes (o de hasta 3 días antes). Precedencia: reporte SRL/CILA, luego SINA CONAGUA, luego AQUARIUS (CONAGUA vía USIBWC) en las presas del distrito; SINA y luego AQUARIUS en las demás. Las fuentes que difieren más de 0.5 Mm³ o 0.5 % se marcan.`,
    `Fuente (meses): R reporte SRL/CILA, S SINA, A AQUARIUS = meses cuyo cierre sale de cada una. «Difiere / igual» = meses con fuentes discrepantes / cuyo valor es idéntico al mes anterior.`,
    `SINA CONAGUA dejó de actualizarse el 23-abr-2025: de mayo de 2025 en adelante los cierres de las presas de AQUARIUS vienen de ese portal; los cuerpos sin telemetría vigente quedan S/D${sd.length ? ` (${sd.map((c) => c.etiqueta).join(', ')})` : ''}.`,
    `La huella es el polígono máximo del vaso (inventario de presas, nivel de diseño), no el nivel de hoy. El espejo observado es la última escena Sentinel-2 (NDWI a 10 m) y trae ± un píxel de borde; ${medidos} de ${d.cuerpos.length} vasos tienen medición. El volumen satelital es S/D mientras el cuerpo no tenga curva elevación–área–capacidad.`,
    `El % se calcula contra el NAMO declarado de cada cuerpo (AQUARIUS/SINA vigente), que puede diferir del NAMO operativo del distrito. Dato provisional de fuentes terceras: contexto, no sustituye la captura de campo ni CILA.`,
  ];
}

/** CSS propio de la hoja (se agrega al CSS de la carta). */
export const CSS_CUERPOS_AGUA = `
.vasos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;margin-top:6px}
.vaso{margin:0;min-width:0}
.vaso figcaption{font-size:.82em;color:#1B2733;margin-bottom:2px}
.vaso svg{width:100%;height:auto;display:block}
.vaso small{display:block;font-size:.72em;color:#57606a;margin-top:2px}
`;

/** Hoja completa (cuerpo HTML sin cabecera ni pie). */
export function hojaCuerposAgua(d: DatosCuerposInforme): string {
  return [
    `<section class="bloque" aria-label="Cuerpos de agua de la cuenca"><h2>Cuerpos de agua de la cuenca <small>cierres mensuales 2021 → hoy y vasos por satélite</small></h2>${tablaCuerposAgua(d)}</section>`,
    `<section class="bloque" aria-label="Vasos por satélite"><h2>Vasos <small>huella máxima (punteada) y espejo observado (azul), cada plano a su escala</small></h2>${planosVasosHtml(d)}</section>`,
    `<section class="notas" aria-label="Notas de la hoja"><h3>Cómo se lee</h3><ul>${notasCuerposAgua(d).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`,
  ].join('');
}
