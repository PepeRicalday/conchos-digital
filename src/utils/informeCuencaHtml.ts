/**
 * informeCuencaHtml — informe institucional "Cuenca del Conchos" en HTML autónomo. Lógica PURA (strings): se prueba con vitest.
 *
 * Tres formatos sobre los MISMOS datos (informeCuencaDatos):
 *  · 'png'    — infografía vertical de 1600 px (WhatsApp / pantalla);
 *  · 'lamina' — lámina 17×11 in horizontal para imprimir (1632×1056 px a 96 dpi);
 *  · 'carta'  — PDF carta multipágina: resumen de cuenca, una hoja por presa (bloque "ficha"), anexo con trazabilidad y firmas.
 *
 * Reglas institucionales: S/D nunca 0; dato provisional; fecha de corte; fuente "CONAGUA vía USIBWC"; contexto, no sustituye
 * al aforo de campo ni a los reportes CILA; toda cifra histórica lleva "n = N años"; atípicos descartados con su fecha;
 * "sin actualizar" visible por presa; "N de M presas" cuando se filtra.
 */
import {
  CSS_MEMBRETE, altoMembretePorAncho, membreteDual,
} from './membreteDual';
import {
  bloqueFirmas, cssInforme, documentoHtml, esc, fechaHoraLegible, fechaLarga, folioConPartes, hashCorto, pieInforme,
  tablaTrazabilidad, FUENTE_MARCA,
} from './informeBase';
import { COLOR_PAPEL, colorEstado, miniSerieSvg, tanqueSvg, tiraLluviaSvg } from './informeCuencaSvg';
import type { DatosInformeCuenca, PresaInforme } from './informeCuencaDatos';
import { DATOS_INFORME } from './informeCuencaConfig';
import { CSS_CUERPOS_AGUA, hojaCuerposAgua, type DatosCuerposInforme } from './informeCuerposAgua';

export type FormatoInformeCuenca = 'png' | 'lamina' | 'carta';
export const ANCHO_PNG_CUENCA = 1600;
export const LAMINA_PX = { ancho: 1632, alto: 1056 } as const; // 17 × 11 in a 96 dpi

export interface OpcionesHtmlCuenca {
  formato: FormatoInformeCuenca;
  logoSrl: string;
  logoSica: string;
  emitido: Date;
  /** Cuerpos de agua de la cuenca (catálogo, cierres mensuales y vasos). Si falta, la carta queda como antes (sin la hoja). */
  cuerpos?: DatosCuerposInforme;
}

// ── Formato de cifras ─────────────────────────────────────────────────────────
const SD = '<span class="sd">S/D</span>';
const num = (v: number | null | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? SD : esc(v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const numTxt = (v: number | null | undefined, d = 1): string =>
  v == null || !Number.isFinite(v) ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const signo = (v: number | null | undefined, d = 1, u = ''): string =>
  v == null || !Number.isFinite(v) ? SD : esc(`${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d })}${u}`);
const fechaCorta = (iso: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : 'S/D';
};

const NIVEL: Record<string, { texto: string; glifo: string; clase: string }> = {
  critico: { texto: 'Crítico', glifo: '◆', clase: 'crit' },
  bajo: { texto: 'Bajo', glifo: '▲', clase: 'warn' },
  normal: { texto: 'Normal', glifo: '●', clase: 'ok' },
  sd: { texto: 'S/D', glifo: '○', clase: 'sd' },
};
const chipNivel = (p: PresaInforme): string => {
  const n = NIVEL[p.semaforo.nivel] ?? NIVEL.sd;
  return `<span class="chip-n n-${n.clase}"><i aria-hidden="true">${n.glifo}</i>${n.texto}</span>`;
};
const marcaSinAct = (p: PresaInforme): string =>
  p.fila.sinActualizar ? `<span class="sin-act">sin actualizar${p.fila.igualDesde ? ` desde ${esc(fechaCorta(p.fila.igualDesde))}` : ''}</span>` : '';

function posicionTxt(p: PresaInforme, compacto = false): string {
  const h = p.posicion;
  if (!h) return SD;
  const partes: string[] = [];
  partes.push(h.percentil != null ? `P${h.percentil}` : 'P S/D');
  if (h.mediana != null && !compacto) partes.push(`mediana ${numTxt(h.mediana, 1)}`);
  partes.push(`n = ${h.nAnios} años`);
  return esc(partes.join(' · '));
}

// ── Bloques ───────────────────────────────────────────────────────────────────
const incluye = (d: DatosInformeCuenca, b: (typeof DATOS_INFORME)[number]['id']): boolean => d.config.datos.includes(b);
const etiquetaAgregado = (d: DatosInformeCuenca): string =>
  d.filtrado ? (d.agregado.n === 1 ? 'de la presa seleccionada' : `de las ${d.agregado.n} presas seleccionadas`) : `de la cuenca (${d.agregado.n} presas)`;
/** Δ a 30 d: con la lectura sin actualizar el cambio sería 0 por repetición del valor, no estabilidad real: S/D. */
const cambio30 = (p: PresaInforme): number | null => (p.fila.sinActualizar ? null : p.cambio30Puntos);

function kpis(d: DatosInformeCuenca): string {
  const a = d.agregado;
  const ext = a.extraccionM3s;
  return `<div class="kpis" role="group" aria-label="Indicadores ${esc(etiquetaAgregado(d))}">
  <div class="kpi"><div class="et">Almacenado ${esc(etiquetaAgregado(d))}</div><div class="v">${num(a.almacenadoMm3, 1)} <small>Mm³</small></div><div class="s">${a.pct == null ? 'S/D' : `${numTxt(a.pct, 1)} % de su NAMO`}${a.namoMm3 != null ? ` (${numTxt(a.namoMm3, 1)} Mm³)` : ''}${a.conDato < a.n ? ` · ${a.conDato} de ${a.n} con dato` : ''}</div></div>
  <div class="kpi"><div class="et">Volumen útil</div><div class="v">${num(a.pctUtil, 1)} <small>%</small></div><div class="s">${a.utilMm3 != null ? `${numTxt(a.utilMm3, 1)} de ${numTxt(a.capacidadUtilMm3, 1)} Mm³ sobre el volumen muerto` : 'S/D'}</div></div>
  <div class="kpi"><div class="et">Aportación · extracción</div><div class="v">${num(a.aportacionM3s, 1)} <small>/</small> ${num(ext, 1)} <small>m³/s</small></div><div class="s">Aportación con dato en ${a.aportacionConDato} de ${a.n} presas</div></div>
  <div class="kpi"><div class="et">Semáforo de las presas</div><div class="v"><small>crítico</small> ${a.criticas} · <small>bajo</small> ${a.bajas}</div><div class="s">${a.sinActualizar > 0 ? `${a.sinActualizar} con lectura sin actualizar` : 'Todas con lectura al día'}</div></div>
</div>`;
}

function tanques(d: DatosInformeCuenca, alto: number, anchoMin = 56, anchoMax = 200): string {
  const maxNamo = Math.max(0, ...d.presas.map((p) => p.fila.namoMm3 ?? 0));
  const celdas = d.presas.map((p) => {
    const f = p.fila;
    return `<figure class="tanque">
  ${tanqueSvg({ id: f.ubicacionId, namoMm3: f.namoMm3, muertoMm3: f.muertoMm3, pct: f.pct, estado: f.estado.clave, sinActualizar: f.sinActualizar }, maxNamo, alto, anchoMin, anchoMax)}
  <figcaption><b>${esc(f.etiqueta)}</b>
    <span class="pct" style="color:${colorEstado(f.estado.clave)}">${f.pct == null ? 'S/D' : `${numTxt(f.pct, 1)} %`}</span>
    <span class="mm3">${f.almacenamientoValido == null ? 'S/D' : `${numTxt(f.almacenamientoValido, 1)} Mm³`}</span>
    ${chipNivel(p)}${marcaSinAct(p)}
    <span class="fch">${esc(fechaCorta(f.fecha))}</span></figcaption>
</figure>`;
  }).join('');
  return `<section class="bloque" aria-label="Estado de las presas">
  <h2>Estado de las presas</h2>
  <div class="tanques">${celdas}</div>
  <p class="leyenda">Ancho ∝ √capacidad (NAMO CONAGUA) · relleno = % del NAMO · rayas discontinuas = 20 % y 40 % · punteada azul = volumen muerto · trama = lectura sin actualizar · trama gris = S/D</p>
</section>`;
}

function tabla(d: DatosInformeCuenca, compacto = false): string {
  const hist = incluye(d, 'historico');
  const filas = d.presas.map((p) => {
    const f = p.fila;
    return `<tr><th scope="row">${esc(f.etiqueta)}${marcaSinAct(p) ? `<br>${marcaSinAct(p)}` : ''}</th>
<td>${esc(fechaCorta(f.fecha))}</td><td class="n">${num(f.almacenamientoValido, 1)}</td><td class="n">${num(f.pct, 1)}</td>
<td class="n">${num(p.util?.pctUtil, 1)}</td><td class="n">${signo(cambio30(p), 1, ' pts')}</td>
<td class="n">${num(f.aportacionM3s, 1)}</td><td class="n">${num(f.extraccionTotalM3s, 1)}</td><td class="n">${num(f.vertidoM3s, 1)}</td>
${hist ? `<td>${posicionTxt(p, compacto)}</td>` : ''}<td>${chipNivel(p)}</td></tr>`;
  }).join('');
  return `<section class="bloque" aria-label="Cifras por presa">
  <h2>Cifras por presa</h2>
  <div class="tabla-wrap"><table class="cifras"><thead><tr><th>Presa</th><th>Corte</th><th class="n">Alm. Mm³</th><th class="n">% NAMO</th><th class="n">% útil</th><th class="n">Δ 30 d</th><th class="n">Aport. m³/s</th><th class="n">Extr. m³/s</th><th class="n">Vert. m³/s</th>${hist ? '<th>Posición histórica</th>' : ''}<th>Semáforo</th></tr></thead><tbody>${filas}</tbody></table></div>
  <p class="fuente">% útil = (almacenado − volumen muerto) ÷ (NAMO − volumen muerto). Δ 30 d en puntos porcentuales del NAMO.${hist ? ' P = percentil frente a la historia del mismo día del año (2017 en adelante, ±3 d); solo se calcula con 8 o más años.' : ''}</p>
</section>`;
}

function series(d: DatosInformeCuenca, w: number, h: number): string {
  const celdas = d.presas.map((p) => {
    const rp = p.rangoPropio;
    return `<figure class="serie"><figcaption><b>${esc(p.fila.etiqueta)}</b><span>${cambio30(p) == null ? 'S/D' : `${signo(cambio30(p), 1, ' pts')} en 30 d`}</span></figcaption>
${miniSerieSvg(p.serie, p.banda, w, h)}
<small>${p.banda ? `Banda p10–p90 histórica (n = ${p.posicion?.nAnios ?? 'S/D'} años)` : `Rango de los últimos ${d.config.meses} meses${rp ? `: ${numTxt(rp.min, 0)}–${numTxt(rp.max, 0)} %` : ''}`}</small></figure>`;
  }).join('');
  return `<section class="bloque" aria-label="Series de llenado">
  <h2>Llenado de los últimos ${d.config.meses} meses <small>(% del NAMO, escala 0–100 común)</small></h2>
  <div class="series">${celdas}</div>
  <p class="leyenda">Línea = % del NAMO semanal · punteada = lectura dudosa (sin actualizar) · banda azul = p10–p90 de la historia del mismo día · discontinua gris = mediana · guías en 20 % y 40 %</p>
</section>`;
}

function lluvia(d: DatosInformeCuenca, wTira: number): string {
  const l = d.lluvia;
  if (!l) return `<section class="bloque" aria-label="Lluvia en la cuenca"><h2>Lluvia en la cuenca</h2><p class="sd">Sin datos de lluvia GOES para el periodo.</p></section>`;
  const filas = l.filas.map((f) => {
    const vs = f.vsAnterior;
    const vsTxt = vs
      ? `${signo(vs.difMm, 1, ' mm')} vs ciclo anterior (n = 1)${vs.advertencia ? ' ⚠' : ''}`
      : 'sin comparación posible';
    return `<tr><th scope="row">${esc(f.nombre)}</th><td>${tiraLluviaSvg(f.dias30, wTira, 22)}</td>
<td class="n">${num(f.total7Mm, 1)}<small> (${f.total7ConDato}/7 d)</small></td><td class="n">${num(f.total30Mm, 1)}<small> (${f.total30ConDato}/30 d)</small></td>
<td class="n">${num(f.ciclo.mm, 1)}<small> · ${f.ciclo.diasConLluvia} d con lluvia</small></td><td>${esc(vsTxt)}</td></tr>`;
  }).join('');
  const hayAdv = l.filas.some((f) => f.vsAnterior?.advertencia);
  return `<section class="bloque" aria-label="Lluvia en la cuenca">
  <h2>Lluvia en la cuenca <small>(pluviómetros GOES, mm; hasta ${esc(fechaCorta(l.hasta))})</small></h2>
  <div class="tabla-wrap"><table class="cifras"><thead><tr><th>Pluviómetro</th><th>Últimos 30 días</th><th class="n">7 d</th><th class="n">30 d</th><th class="n">Ciclo agrícola</th><th>Comparación</th></tr></thead><tbody>${filas}</tbody></table></div>
  <p class="fuente">Celda gris con trama = S/D (no es un día seco). Ciclo agrícola = 1-oct a la fecha. La comparación es solo contra el ciclo anterior (n = 1): no indica qué es lo normal.${hayAdv ? ' ⚠ El ciclo anterior sumó 0 mm en la ventana: puede ser un periodo seco real o un pluviómetro que no reportó.' : ''}</p>
</section>`;
}

/** Notas obligatorias del informe (van en todos los formatos). */
export function notasInforme(d: DatosInformeCuenca): string[] {
  const n: string[] = [
    'Dato provisional: lecturas del portal público USIBWC, fuente CONAGUA. Es contexto de la cuenca y no sustituye al aforo de campo ni a los reportes CILA.',
    `Fecha de corte: ${fechaLarga(d.corte)}. S/D = sin dato; nunca se interpreta como 0.`,
  ];
  if (d.filtrado) n.push(`Alcance filtrado: ${d.alcance}. Los totales corresponden solo a las presas incluidas, no a toda la cuenca.`);
  const sa = d.presas.filter((p) => p.fila.sinActualizar);
  if (sa.length) n.push(`Sin actualizar: ${sa.map((p) => `${p.fila.etiqueta}${p.fila.igualDesde ? ` (desde ${fechaCorta(p.fila.igualDesde)})` : ''}`).join(', ')}. Se muestra su último dato obtenido; la fuente repite el mismo valor.`);
  if (incluye(d, 'historico')) n.push(d.hayClimatologia
    ? 'Posición histórica: mismo día del año ±3 d, 2017 en adelante; el número de años (n) se indica en cada cifra. El percentil solo se calcula con 8 o más años.'
    : 'Posición histórica: S/D, no hay climatología disponible.');
  if (d.descartes.length) n.push(`Lecturas atípicas excluidas del análisis: ${d.descartes.map((x) => `${x.presa} ${fechaCorta(x.descarte.fecha)}`).join('; ')}. El dato original se conserva en la base.`);
  if (d.presas.some((p) => p.meta?.etiqueta.includes('Dgo.'))) n.push('San Gabriel, Dgo. (Río Florido) pertenece al Distrito de Riego 103 y alimenta a Pico del Águila; se incluye por su influencia en la cuenca.');
  return n;
}

function notas(d: DatosInformeCuenca): string {
  return `<section class="notas" aria-label="Notas"><h3>Notas</h3><ul>${notasInforme(d).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
}

// ── Ficha por presa (hoja de PDF) ─────────────────────────────────────────────
function ficha(d: DatosInformeCuenca, p: PresaInforme): string {
  const f = p.fila, m = p.meta;
  const dato = (k: string, v: string | null | undefined) => `<div class="dato"><b>${esc(k)}</b><span>${v == null || v === '' ? 'S/D' : esc(v)}</span></div>`;
  const maxNamo = f.namoMm3 ?? 0;
  const hist = p.posicion;
  return `<div class="ficha-presa">
  <div class="ficha-cab">${tanqueSvg({ id: f.ubicacionId, namoMm3: f.namoMm3, muertoMm3: f.muertoMm3, pct: f.pct, estado: f.estado.clave, sinActualizar: f.sinActualizar }, maxNamo, 230, 90, 90)}
    <div><h1>${esc(f.etiqueta)}</h1><p class="sub">${esc([m?.rio ? `Río ${m.rio}` : null, m?.municipio ?? null, m?.estado ?? null].filter(Boolean).join(' · ') || 'Ficha sin verificar (S/D)')}</p>
    <p class="gran"><b style="color:${colorEstado(f.estado.clave)}">${f.pct == null ? 'S/D' : `${numTxt(f.pct, 1)} %`}</b> del NAMO · ${f.almacenamientoValido == null ? 'S/D' : `${numTxt(f.almacenamientoValido, 1)} Mm³`}</p>
    <p>${chipNivel(p)} ${marcaSinAct(p)}</p></div></div>
  <div class="datos">
    ${dato('Corte de la lectura', fechaLarga(f.fecha))}
    ${dato('NAMO · volumen muerto', `${numTxt(f.namoMm3, 1)} · ${numTxt(f.muertoMm3, 2)} Mm³`)}
    ${dato('Volumen útil', p.util ? `${numTxt(p.util.utilMm3, 1)} de ${numTxt(p.util.capacidadUtilMm3, 1)} Mm³ (${numTxt(p.util.pctUtil, 1)} %)` : null)}
    ${dato('Peso en la cuenca', p.participacionNamo == null ? null : `${numTxt(p.participacionNamo, 1)} % del NAMO sumado`)}
  </div>
  <div class="datos">
    ${dato('Aportación', f.aportacionM3s == null ? null : `${numTxt(f.aportacionM3s, 2)} m³/s`)}
    ${dato('Extracción total', f.extraccionTotalM3s == null ? null : `${numTxt(f.extraccionTotalM3s, 2)} m³/s`)}
    ${dato('Vertido', f.vertidoM3s == null ? null : `${numTxt(f.vertidoM3s, 2)} m³/s`)}
    ${dato('Tendencia (Theil-Sen, 30 d)', p.tendencia ? `${p.tendencia.pendienteMm3Dia > 0 ? '+' : p.tendencia.pendienteMm3Dia < 0 ? '−' : ''}${numTxt(Math.abs(p.tendencia.pendienteMm3Dia), 2)} Mm³/día (${p.tendencia.n} puntos)` : null)}
  </div>
  ${incluye(d, 'historico') ? `<h3>Posición frente a su historia</h3><p class="frase">${hist
    ? `${hist.percentil != null ? `Percentil <b>${hist.percentil}</b>` : 'Percentil S/D'}; mediana ${numTxt(hist.mediana, 1)} Mm³, rango histórico ${numTxt(hist.minimo, 1)}–${numTxt(hist.maximo, 1)} Mm³${hist.anomaliaMm3 != null ? `; hoy ${hist.anomaliaMm3 > 0 ? '+' : hist.anomaliaMm3 < 0 ? '−' : ''}${numTxt(Math.abs(hist.anomaliaMm3), 1)} Mm³ frente a la mediana` : ''}. <i>${esc(hist.nota)}</i>`
    : 'Sin climatología para esta presa (S/D).'}</p>` : ''}
  ${incluye(d, 'serie') ? `<h3>Llenado de los últimos ${d.config.meses} meses</h3>${miniSerieSvg(p.serie, p.banda, 640, 120)}` : ''}
  <h3>Por qué este semáforo</h3><ul class="motivos">${p.semaforo.motivos.length ? p.semaforo.motivos.map((t) => `<li>${esc(t)}.</li>`).join('') : '<li>Sin elementos suficientes para calificar (S/D).</li>'}</ul>
  ${p.descartes.length ? `<p class="aviso">Lecturas atípicas excluidas: ${p.descartes.map((x) => `${esc(fechaCorta(x.fecha))} (${numTxt(x.valor, 1)} Mm³)`).join(', ')}.</p>` : ''}
  ${m?.fuente ? `<p class="fuente">Ficha: ${esc(m.fuente)}${m.verificado ? '' : ' (sin verificar)'}</p>` : '<p class="fuente">Ficha de la presa sin verificar: río, municipio y distrito en S/D.</p>'}
</div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────
export const CSS_COMUN = `
.sd{color:${COLOR_PAPEL.sd};font-style:italic}
.bloque{margin:0 0 18px;min-width:0}
.bloque h2{font:800 1.15em/1.2 ${FUENTE_MARCA};color:#0B3170;margin:0 0 8px;padding-bottom:4px;border-bottom:2px solid #D8E2EC}
.bloque h2 small{font:400 .72em "Segoe UI",Arial,sans-serif;color:#57606a}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 16px}
.kpi{border:1px solid #D8E2EC;border-top:5px solid #0A7FDB;border-radius:8px;padding:9px 12px;background:#fff;min-width:0}
.kpi .et{font-size:.74em;letter-spacing:.06em;text-transform:uppercase;color:#57606a}
.kpi .v{font:800 1.75em/1.1 ${FUENTE_MARCA};color:#0B3170;margin:3px 0}
.kpi .v small{font:600 .5em "Segoe UI",Arial,sans-serif;color:#57606a}
.kpi .s{font-size:.78em;color:#57606a}
.tanques{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.tanque{margin:0;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:96px}
.tanque figcaption{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;font-size:.85em}
.tanque .pct{font:800 1.45em/1 ${FUENTE_MARCA}}
.tanque .mm3,.tanque .fch{color:#57606a;font-size:.88em}
.chip-n{display:inline-flex;gap:4px;align-items:center;border:1.5px solid currentColor;border-radius:999px;padding:0 8px;font-weight:700;font-size:.82em;white-space:nowrap}
.chip-n i{font-style:normal}
.n-crit{color:${COLOR_PAPEL.crit}}.n-warn{color:${COLOR_PAPEL.warn}}.n-ok{color:${COLOR_PAPEL.ok}}.n-sd{color:${COLOR_PAPEL.sd}}
.sin-act{display:inline-block;background:#EEF1F4;border:1px dashed ${COLOR_PAPEL.sd};color:#3d4650;border-radius:4px;padding:0 6px;font-size:.78em;font-weight:600}
.leyenda,.fuente{font-size:.76em;color:#57606a;margin:6px 0 0}
table.cifras{width:100%;border-collapse:collapse;font-size:.92em}
table.cifras th{background:#0B3170;color:#fff;padding:5px 7px;text-align:left;font-size:.78em;letter-spacing:.03em;text-transform:uppercase}
table.cifras th.n{text-align:right}
table.cifras tbody th{background:transparent;color:#1f2328;text-transform:none;font-size:1em;letter-spacing:0;border-bottom:1px solid #DCE3EA}
table.cifras td{padding:5px 7px;border-bottom:1px solid #DCE3EA;vertical-align:middle}
table.cifras td.n{text-align:right;white-space:nowrap;font-family:Consolas,"SF Mono",ui-monospace,monospace}
table.cifras td small{color:#57606a;font-family:"Segoe UI",Arial,sans-serif}
.series{display:grid;grid-template-columns:repeat(var(--cols,4),minmax(0,1fr));gap:10px}
.serie{margin:0;min-width:0}
.serie figcaption{display:flex;justify-content:space-between;gap:6px;font-size:.85em;margin-bottom:2px}
.serie figcaption span{color:#57606a}
.serie svg{width:100%;height:auto;display:block}
.serie small{display:block;font-size:.74em;color:#57606a;margin-top:2px}
.notas{border-top:2px solid #D8E2EC;padding-top:8px;margin-bottom:14px;font-size:.8em;color:#3d4650}
.notas h3{margin:0 0 4px;font:700 1em "Segoe UI",Arial,sans-serif;color:#0B3170}
.notas ul{margin:0;padding-left:18px}.notas li{margin:0 0 2px}
.aviso{border:1px solid #e3c98a;border-left:5px solid #C27A0E;background:#fff8e6;border-radius:3px;padding:6px 10px;font-size:.88em;color:#5c3d00;margin:6px 0}
`;

const CSS_INFOGRAFIA = (ancho: number, alto: number | null) => `
*{box-sizing:border-box}
html,body{margin:0;background:#F4F8FC}
body{width:${ancho}px;${alto ? `height:${alto}px;overflow:hidden;` : ''}font:17px/1.4 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1B2733;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.hoja{width:${ancho}px;${alto ? `height:${alto}px;` : ''}padding:24px 44px 20px;background:#F4F8FC;display:flex;flex-direction:column}
.titulo{margin:6px 0 4px}
.titulo h1{font:800 2.1em/1.1 ${FUENTE_MARCA};color:#0B3170;margin:0}
.titulo p{margin:2px 0 0;color:#57606a;font-size:.95em}
.pie-inf{margin-top:auto;padding-top:8px;border-top:2px solid #0A7FDB;display:flex;justify-content:space-between;gap:16px;font-size:.74em;color:#57606a;text-transform:uppercase;letter-spacing:.05em}
.lam .cuerpo-lam{display:grid;grid-template-columns:1.12fr 1fr;gap:0 24px;flex:1;min-height:0}
.lam{font-size:13px}
.lam .hoja,.hoja.lam{padding:16px 36px 12px}
.lam .tanques{flex-wrap:nowrap;gap:8px;justify-content:space-between}
.lam .tanque{min-width:0;flex:1 1 0}
.lam .tanque figcaption{font-size:11px}
.lam .titulo{margin:2px 0}
.lam .titulo h1{font-size:1.7em}
.lam .kpi{padding:6px 10px}
.lam .kpi .v{font-size:1.35em}
.lam .kpi .s{font-size:.72em}
.lam .bloque h2{font-size:1.05em;margin-bottom:5px}
.lam table.cifras{font-size:.85em}
.lam table.cifras th{font-size:.68em;padding:3px 4px}
.lam table.cifras td,.lam table.cifras tbody th{padding:3px 4px}
.lam .leyenda,.lam .fuente{font-size:.7em;margin-top:3px}
.lam .notas{font-size:.76em}
.lam .titulo h1{font-size:1.9em}
.lam .kpis{margin:6px 0 10px}
.lam .kpi .v{font-size:1.5em}
.lam .bloque{margin-bottom:10px}
.lam .notas{font-size:.82em}
${CSS_COMUN}
`;

const CSS_CARTA = `
${CSS_COMUN}
.pagina{font-size:9.5pt}
.tanque figcaption{font-size:7.5pt}
.tanques{flex-wrap:nowrap;gap:6px;justify-content:space-between}
.tanque{min-width:0;flex:1 1 0}
.kpi .v{font-size:15pt}
.series{--cols:3}
.ficha-presa .ficha-cab{display:flex;gap:16px;align-items:flex-end;margin-bottom:8px}
.ficha-presa h1{margin:0}
.ficha-presa .sub{color:#57606a;margin:0 0 4px}
.ficha-presa .gran{font-size:13pt;margin:2px 0 6px}.ficha-presa .gran b{font:800 20pt ${FUENTE_MARCA}}
.ficha-presa .datos{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;margin:8px 0}
.ficha-presa .dato{border-top:3px solid #0A7FDB;padding-top:3px}
.ficha-presa .dato b{display:block;font-size:7.5pt;color:#57606a;font-weight:600}
.ficha-presa .dato span{font:600 9.5pt "Segoe UI",Arial,sans-serif}
.ficha-presa h3{margin:12px 0 4px}
.ficha-presa .motivos{margin:0;padding-left:18px}
.ficha-presa svg.ms{width:100%;height:auto}
table.cifras{font-size:7.6pt}
table.cifras th{font-size:6.8pt;padding:4px 4px}
table.cifras td,table.cifras tbody th{padding:3px 4px}
`;

// ── Documento ─────────────────────────────────────────────────────────────────
export function folioCuenca(d: DatosInformeCuenca, ahora: Date): string {
  return folioConPartes('CUENCA', [`${d.presas.length}DE${d.totalPresas}`], ahora);
}

/** Huella de la configuración + corte: dos informes con la misma huella contienen las mismas cifras. */
export function huellaCuenca(d: DatosInformeCuenca): string {
  return hashCorto(JSON.stringify({ c: d.config, k: d.corte, p: d.presas.map((p) => [p.fila.ubicacionId, p.fila.almacenamientoValido, p.fila.fecha]) }));
}

function filasTrazabilidad(d: DatosInformeCuenca, ahora: Date): { k: string; v: string }[] {
  return [
    { k: 'Folio', v: folioCuenca(d, ahora) },
    { k: 'Emitido', v: fechaHoraLegible(ahora) },
    { k: 'Fecha de corte de los datos', v: fechaLarga(d.corte) },
    { k: 'Alcance', v: d.alcance },
    { k: 'Presas incluidas', v: d.presas.map((p) => p.fila.etiqueta).join(', ') || 'S/D' },
    { k: 'Periodo de las series', v: `${d.config.meses} meses` },
    { k: 'Fuente de los datos', v: 'CONAGUA, vía portal público USIBWC (lecturas diarias); lluvia: pluviómetros GOES' },
    { k: 'Última sincronización', v: d.ultSyncEn ? fechaHoraLegible(new Date(d.ultSyncEn)) : 'S/D' },
    { k: 'Método', v: 'Volumen útil = (S − muerto) ÷ (NAMO − muerto); percentil empírico del mismo día ±3 d (n ≥ 8 años); tendencia Theil-Sen a 30 d; atípicos excluidos con regla de vecinos' },
    { k: 'Huella de la configuración', v: huellaCuenca(d) },
    { k: 'Clasificación', v: 'Dato provisional · contexto, no sustituye al aforo de campo ni a los reportes CILA' },
  ];
}

function membrete(o: OpcionesHtmlCuenca, d: DatosInformeCuenca, alto?: number): string {
  return membreteDual({
    logoSrl: o.logoSrl, logoSica: o.logoSica, titulo: alto ? '' : 'Cuenca del Conchos · Estado de las presas',
    meta: alto ? undefined : [{ k: 'Corte', v: fechaLarga(d.corte) }, { k: 'Alcance', v: d.alcance }, { k: 'Folio', v: folioCuenca(d, o.emitido) }],
    alto,
  });
}

function titular(d: DatosInformeCuenca, conTitulo = true): string {
  const a = d.agregado;
  const frase = a.almacenadoMm3 == null
    ? 'Sin dato de almacenamiento (S/D) para las presas seleccionadas.'
    : `${a.n === 1 ? 'La presa seleccionada almacena' : `Las ${a.n} presas ${d.filtrado ? 'seleccionadas ' : ''}almacenan`} ${numTxt(a.almacenadoMm3, 1)} Mm³${a.pct != null ? `, ${numTxt(a.pct, 1)} % de su NAMO` : ''}.`;
  return `<div class="titulo">${conTitulo ? '<h1>Cuenca del Conchos: estado de las presas</h1>' : ''}<p>${esc(frase)} Corte: ${esc(fechaLarga(d.corte))} · ${esc(d.alcance)} · dato provisional.</p></div>`;
}

function infografia(d: DatosInformeCuenca, o: OpcionesHtmlCuenca): string {
  const lam = o.formato === 'lamina';
  const ancho = lam ? LAMINA_PX.ancho : ANCHO_PNG_CUENCA;
  const cabecera = membrete(o, d, lam ? 84 : altoMembretePorAncho(ancho));
  const pie = `<div class="pie-inf"><span>Folio ${esc(folioCuenca(d, o.emitido))}</span><span>SRL Unidad Conchos · Delicias · SICA 005</span><span>Fuente: CONAGUA vía USIBWC · emitido ${esc(fechaHoraLegible(o.emitido))}</span></div>`;
  const izq = [kpis(d), lam ? tanques(d, 120, 44, 112) : tanques(d, 200), incluye(d, 'tabla') ? tabla(d, lam) : ''].join('');
  const der = [incluye(d, 'serie') ? series(d, lam ? 236 : 340, lam ? 52 : 90) : '', incluye(d, 'lluvia') ? lluvia(d, lam ? 220 : 420) : '', notas(d)].join('');
  const cuerpo = lam
    ? `<div class="cuerpo-lam"><div>${izq}</div><div>${der}</div></div>`
    : `${izq}${der}`;
  const colsSeries = lam ? 3 : 4;
  return `<div class="hoja${lam ? ' lam' : ''}" style="--cols:${colsSeries}">${cabecera}${titular(d)}${cuerpo}${pie}</div>`;
}

function carta(d: DatosInformeCuenca, o: OpcionesHtmlCuenca): string {
  const hojas: string[] = [];
  const conFicha = incluye(d, 'ficha');
  const conEvolucion = incluye(d, 'serie') || incluye(d, 'lluvia');
  const conCuerpos = !!o.cuerpos && o.cuerpos.cuerpos.length > 0;
  const total = 1 + (conEvolucion ? 1 : 0) + (conCuerpos ? 1 : 0) + (conFicha ? d.presas.length : 0) + 1;
  let n = 0;
  const hoja = (cuerpo: string, cabecera: string) => `<section class="pagina">${cabecera}<div class="cuerpo">${cuerpo}</div>${pieInforme(`Folio ${folioCuenca(d, o.emitido)}`, ++n, total)}</section>`;

  hojas.push(hoja([
    titular(d, false), kpis(d), tanques(d, 80, 30, 84),
    incluye(d, 'tabla') ? tabla(d) : '',
  ].join(''), membrete(o, d)));
  if (conEvolucion) {
    hojas.push(hoja([
      incluye(d, 'serie') ? series(d, 200, 70) : '',
      incluye(d, 'lluvia') ? lluvia(d, 260) : '',
    ].join(''), membrete(o, d)));
  }
  if (conCuerpos) hojas.push(hoja(hojaCuerposAgua(o.cuerpos!), membrete(o, d)));
  if (conFicha) for (const p of d.presas) hojas.push(hoja(ficha(d, p), membrete(o, d)));
  hojas.push(hoja([
    notas(d),
    `<section class="bloque"><h2>Trazabilidad</h2>${tablaTrazabilidad(filasTrazabilidad(d, o.emitido))}</section>`,
    `<section class="bloque"><h2>Firmas</h2>${bloqueFirmas()}</section>`,
  ].join(''), membrete(o, d)));
  return hojas.join('\n');
}

/** HTML autónomo del informe en el formato pedido. */
export function htmlInformeCuenca(d: DatosInformeCuenca, o: OpcionesHtmlCuenca): string {
  const titulo = `Cuenca del Conchos · ${d.alcance}`;
  if (o.formato === 'carta') {
    return documentoHtml({ titulo, css: `${cssInforme({ formato: 'letter' })}${CSS_CARTA}${CSS_CUERPOS_AGUA}`, cuerpo: carta(d, o), metas: { 'sica:folio': folioCuenca(d, o.emitido) } });
  }
  const lam = o.formato === 'lamina';
  const ancho = lam ? LAMINA_PX.ancho : ANCHO_PNG_CUENCA;
  const css = `${CSS_MEMBRETE}${CSS_INFOGRAFIA(ancho, lam ? LAMINA_PX.alto : null)}${lam ? '@page{size:17in 11in;margin:0}' : ''}`;
  const html = documentoHtml({ titulo, css, cuerpo: infografia(d, o), metas: { 'sica:folio': folioCuenca(d, o.emitido) } });
  // La infografía no lleva el botón de imprimir (se exporta como imagen / PDF desde la aplicación).
  return html.replace(/<button class="btn-imprimir[\s\S]*?<\/button>/, '');
}
