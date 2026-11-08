/**
 * informeClimaCuencaHtml — informe institucional "Clima y pronóstico de la cuenca del Conchos" en HTML autónomo. Lógica PURA (strings).
 *
 * Tres formatos sobre los MISMOS datos (informeClimaCuencaDatos → planosCuenca, el mismo dibujo de la pantalla):
 *  · 'png'    — infografía vertical de 1600 px (WhatsApp / pantalla), hasta 6 planos;
 *  · 'lamina' — lámina 17×11 in horizontal (1632×1056 px), los 3 primeros planos y las cifras clave;
 *  · 'carta'  — PDF carta multipágina: resumen, dos planos por hoja, tablas de estaciones, anexo metodológico con trazabilidad y firmas.
 *
 * Reglas institucionales: S/D nunca 0; dato provisional con fecha de corte; fuente "JCAS/UACJ, Open-Meteo y estaciones propias"; es contexto y
 * no sustituye a las estaciones propias ni a los aforos; "n de M estaciones"; pluviómetro excluido declarado; confiabilidad del pronóstico
 * medida o "en construcción" (nunca asumida); niveles fijos (los planos de fechas distintas se comparan a ojo).
 */
import { CSS_MEMBRETE, altoMembretePorAncho, membreteDual } from './membreteDual';
import { bloqueFirmas, cssInforme, documentoHtml, esc, fechaHoraLegible, fechaLarga, folioConPartes, hashCorto, pieInforme, tablaTrazabilidad, FUENTE_MARCA } from './informeBase';
import { CSS_COMUN } from './informeCuencaHtml';
import { cuandoVentana, etiquetaVentana } from './jcasModelo';
import { planoSvg } from './planosCuenca';
import { VARIABLES_PLANO } from './paletasClima';
import type { DatosInformeClima, PlanoInforme } from './informeClimaCuencaDatos';

export type FormatoInformeClima = 'png' | 'lamina' | 'carta';
export const ANCHO_PNG_CLIMA = 1600;
export const LAMINA_CLIMA_PX = { ancho: 1632, alto: 1056 } as const;
export const MAX_PLANOS_PNG = 6;
export const MAX_PLANOS_LAMINA = 3;

export interface OpcionesHtmlClima { formato: FormatoInformeClima; logoSrl: string; logoSica: string; emitido: Date }

const SD = '<span class="sd">S/D</span>';
const num = (v: number | null | undefined, d = 1): string => (v == null || !Number.isFinite(v) ? SD : esc(v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d })));
const numTxt = (v: number | null | undefined, d = 1): string => (v == null || !Number.isFinite(v) ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fechaCorta = (iso: string | null): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : 'S/D'; };

// ── Bloques ───────────────────────────────────────────────────────────────────
function textoPlano(pl: PlanoInforme): string {
  const m = pl.modelo, u = VARIABLES_PLANO[pl.variable].unidad;
  if (m.motivoSD) return `S/D: ${esc(m.motivoSD)}`;
  const r = m.resumen;
  const rango = r.min != null && r.max != null ? ` · rango ${numTxt(r.min, 0)}–${numTxt(r.max, 0)} ${esc(u)}` : '';
  return `Promedio <b>${num(r.media, pl.variable === 'temperatura' || (r.media ?? 99) < 10 ? 1 : 0)} ${esc(u)}</b>${rango} · n = ${r.n} estaciones · cobertura ${numTxt(r.coberturaPct, 0)} %`;
}

/** Un plano con su leyenda y cifras. `anchoPx` es el ancho en pantalla/papel donde se coloca: el texto del SVG se escala para quedar en `fPx`. */
function figura(pl: PlanoInforme, d: DatosInformeClima, id: string, anchoPx: number, fPx: number): string {
  const textoPx = Math.round(((fPx * 500) / anchoPx) * 10) / 10;
  const svg = planoSvg(pl.modelo, d.contorno, { tema: 'papel', idPrefijo: id, textoPx });
  const aj = pl.modelo.ajuste.aplicado ? ` Corregido por altitud ${esc(pl.modelo.ajuste.motivo.replace(/^ajustado por altitud /, ''))}.` : '';
  const ex = pl.modelo.excluidos.length ? ` Excluida: ${esc(pl.modelo.excluidos.map((p) => p.nombre).join(', '))} (pluviómetro sospechoso).` : '';
  return `<figure class="plano"><figcaption><b>${esc(pl.modelo.titulo)}</b><span>${textoPlano(pl)}</span></figcaption>${svg}<p class="fuente">${pl.tipo === 'obs' ? 'Observado: estaciones JCAS/UACJ.' : `Pronóstico: mediana de 3 modelos (ECMWF, GFS, ICON); el rango entre ellos está en la tabla.`}${aj}${ex}</p></figure>`;
}

function kpis(d: DatosInformeClima): string {
  const o = d.lluviaObs, p = d.lluviaPron, c = d.confiabilidad;
  const tarjeta = (et: string, v: string, s: string) => `<div class="kpi"><div class="et">${esc(et)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return `<div class="kpis">${[
    tarjeta(`Lluvia observada · ${etiquetaVentana(o?.dias ?? d.config.diasObs)}`, o ? `${num(o.media, (o.media ?? 99) < 10 ? 1 : 0)}<small> mm</small>` : SD, o ? (o.motivoSD ? esc(o.motivoSD) : `promedio de la cuenca · n = ${o.n} estaciones · cobertura ${numTxt(o.cobertura, 0)} %`) : 'no incluida en este informe'),
    tarjeta(`Lluvia pronosticada · ${p?.dias ?? d.config.diasPron} d`, p ? `${num(p.media, (p.media ?? 99) < 10 ? 1 : 0)}<small> mm</small>` : SD, p ? (p.motivoSD ? esc(p.motivoSD) : `entre ${numTxt(p.min, 0)} y ${numTxt(p.max, 0)} mm según la estación · n = ${p.n}`) : 'no incluido en este informe'),
    tarjeta('Estaciones JCAS al día', `${d.vigentes}<small> de ${d.totalEstaciones}</small>`, `dato de los últimos 3 días · corte ${esc(fechaCorta(d.corte))}`),
    tarjeta('Confiabilidad del pronóstico', c.estado === 'medida' ? `${c.pod != null ? Math.round(c.pod * 100) : 'S/D'}<small> % de días con lluvia acertados</small>` : '<small>En construcción</small>', esc(c.texto)),
  ].join('')}</div>`;
}

function titular(d: DatosInformeClima, conTitulo = true): string {
  const o = d.lluviaObs, p = d.lluviaPron;
  const partes: string[] = [];
  if (o) partes.push(o.media == null ? `La lluvia observada (${cuandoVentana(o.dias)}) es S/D (${o.motivoSD ?? 'sin datos'})` : `${cuandoVentana(o.dias).replace(/^./, (c) => c.toUpperCase())} llovió en promedio ${numTxt(o.media, (o.media ?? 99) < 10 ? 1 : 0)} mm en la cuenca`);
  if (p) partes.push(p.media == null ? `el pronóstico a ${p.dias} días es S/D` : `el pronóstico a ${p.dias} días indica ${numTxt(p.media, (p.media ?? 99) < 10 ? 1 : 0)} mm en promedio, con diferencias de ${numTxt(p.min, 0)} a ${numTxt(p.max, 0)} mm entre estaciones`);
  const frase = partes.length ? `${partes.join('; ')}.` : 'Informe de clima de la cuenca.';
  return `<div class="titulo">${conTitulo ? '<h1>Clima y pronóstico de la cuenca del Conchos</h1>' : ''}<p>${esc(frase.charAt(0).toUpperCase() + frase.slice(1))} Corte: ${esc(fechaLarga(d.corte))} · dato provisional de contexto.</p></div>`;
}

function tablaObs(d: DatosInformeClima, max?: number): string {
  const filas = (max ? d.estacionesObs.slice(0, max) : d.estacionesObs).map((e) => `<tr><th scope="row">${esc(e.nombre)}${e.zona === 'Salida' ? ' <small>(salida)</small>' : ''}${e.motivo ? `<br><small>${esc(e.motivo)}</small>` : ''}</th>
<td class="n">${num(e.lluvia7)}</td><td class="n">${num(e.lluvia30)}</td><td class="n">${num(e.temp)}</td><td class="n">${num(e.hum, 0)}</td><td class="n">${num(e.viento, 0)}</td><td>${esc(e.estado)}</td><td class="n">${esc(fechaCorta(e.ultFecha))}</td></tr>`).join('');
  return `<section class="bloque"><h2>Estaciones observadas <small>JCAS/UACJ · ${d.estacionesObs.length} en la cuenca${max && d.estacionesObs.length > max ? `, se muestran ${max}` : ''}</small></h2>
<table class="cifras"><thead><tr><th>Estación</th><th class="n">Lluvia 7 d (mm)</th><th class="n">Lluvia 30 d (mm)</th><th class="n">Temp. 7 d (°C)</th><th class="n">Hum. 7 d (%)</th><th class="n">Viento 7 d (km/h)</th><th>Estado</th><th class="n">Último día</th></tr></thead><tbody>${filas}</tbody></table>
<p class="leyenda">Una estación por ciudad pesa una vez en los planos. Sin pluviómetro, la lluvia es S/D (el 0.0 del portal no significa «no llovió»).</p></section>`;
}

function tablaPron(d: DatosInformeClima, max?: number): string {
  if (!d.config.pronostico) return '';
  const filas = (max ? d.estacionesPron.slice(0, max) : d.estacionesPron).map((e) => `<tr><th scope="row">${esc(e.nombre)}${e.propia ? ' <small>(propia)</small>' : ''}</th>
<td class="n">${num(e.lluvia)}</td><td class="n">${e.min == null || e.max == null ? SD : `${numTxt(e.min, 0)}–${numTxt(e.max, 0)}`}</td><td class="n">${e.diasLluvia == null ? SD : `${e.diasLluvia} de ${d.config.diasPron}`}</td><td class="n">${num(e.temp)}</td><td class="n">${num(e.viento, 0)}</td></tr>`).join('');
  return `<section class="bloque"><h2>Pronóstico por estación <small>${d.config.diasPron} días · ${d.corridaEn ? `corrida del ${esc(fechaHoraLegible(new Date(d.corridaEn)))}` : 'sin corrida (S/D)'}</small></h2>
<table class="cifras"><thead><tr><th>Estación</th><th class="n">Lluvia (mm)</th><th class="n">Entre modelos (mm)</th><th class="n">Días con lluvia</th><th class="n">Temp. (°C)</th><th class="n">Viento (km/h)</th></tr></thead><tbody>${filas}</tbody></table>
<p class="leyenda">Un «día con lluvia» es aquel en que al menos 2 de los 3 modelos dan 1 mm o más. Los modelos pueden discrepar mucho en tormentas.</p></section>`;
}

function notas(d: DatosInformeClima): string {
  return `<section class="notas"><h3>Cómo se lee y qué límites tiene</h3><ul>
<li><b>Contexto provisional:</b> estaciones de JCAS/UACJ (portal público, sin API ni términos publicados), pronóstico de Open-Meteo (uso no comercial) y estaciones propias. No sustituye a las estaciones propias, a los aforos ni a CILA.</li>
<li><b>Interpolación:</b> inverso de la distancia al cuadrado, limitada a 90 km de una estación. Donde no hay estación a esa distancia el plano queda con trama y no entra a los promedios. Con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el plano es S/D.</li>
<li><b>Niveles fijos:</b> las isoyetas usan los mismos niveles (1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100 y 150 mm) en todos los informes: dos planos de fechas distintas se comparan a ojo.</li>
<li><b>Altitud:</b> el ajuste usa la elevación del modelo digital (la que reporta JCAS no es confiable) y solo se aplica con 12 o más estaciones y R² de 0.5 o más.</li>
<li><b>Pronóstico:</b> mediana de 3 modelos; la lluvia de un periodo es la suma de la mediana diaria. ${esc(d.confiabilidad.texto)}</li>
${d.excluidas.length ? `<li><b>Pluviómetros excluidos:</b> ${esc(d.excluidas.join(', '))} (0 mm en 30 días mientras estaciones vecinas registran lluvia). Es un criterio de SICA, no un dictamen.</li>` : ''}
<li><b>Contorno:</b> cuencas J–N de la región hidrológica RH24 (INEGI-CONAGUA, difundidas por CONABIO, licencia CC BY-NC 2.5 MX). Sin dirección del viento: JCAS solo entrega la velocidad media.</li></ul></section>`;
}

export function folioClima(d: DatosInformeClima, ahora: Date): string {
  return folioConPartes('CLIMA-CUENCA', [`${d.config.variables.length}VAR`], ahora);
}
export function huellaClima(d: DatosInformeClima): string {
  return hashCorto(JSON.stringify({ c: d.config, k: d.corte, p: d.planos.map((p) => [p.variable, p.tipo, p.modelo.resumen.media, p.modelo.resumen.n]) }));
}
function filasTrazabilidad(d: DatosInformeClima, ahora: Date): { k: string; v: string }[] {
  return [
    { k: 'Folio', v: folioClima(d, ahora) },
    { k: 'Emitido', v: fechaHoraLegible(ahora) },
    { k: 'Fecha de corte de lo observado', v: fechaLarga(d.corte) },
    { k: 'Alcance', v: d.alcance },
    { k: 'Estaciones observadas', v: `${d.vigentes} de ${d.totalEstaciones} con dato reciente (JCAS/UACJ)` },
    { k: 'Última sincronización JCAS', v: d.ultSyncJcas ? fechaHoraLegible(new Date(d.ultSyncJcas)) : 'S/D' },
    { k: 'Corrida del pronóstico', v: d.corridaEn ? fechaHoraLegible(new Date(d.corridaEn)) : 'S/D' },
    { k: 'Fuentes', v: 'JCAS/UACJ (observado), Open-Meteo con ECMWF, GFS e ICON (pronóstico), estaciones propias WeatherLink; contorno INEGI-CONAGUA vía CONABIO' },
    { k: 'Método', v: 'IDW p = 2 con vecindad de 90 km, máscara de cobertura, una estación por ciudad, mediana de modelos' },
    { k: 'Huella de la configuración', v: huellaClima(d) },
    { k: 'Clasificación', v: 'Dato provisional · contexto, no sustituye a las estaciones propias ni a los aforos' },
  ];
}
function membrete(o: OpcionesHtmlClima, d: DatosInformeClima, alto?: number): string {
  return membreteDual({ logoSrl: o.logoSrl, logoSica: o.logoSica, titulo: alto ? '' : 'Clima y pronóstico de la cuenca del Conchos',
    meta: alto ? undefined : [{ k: 'Corte', v: fechaLarga(d.corte) }, { k: 'Alcance', v: d.alcance }, { k: 'Folio', v: folioClima(d, o.emitido) }], alto });
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const CSS_PLANOS = `
.planos{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:14px 18px;margin:0 0 14px;min-width:0;--cap:3.7em}
.plano{margin:0;min-width:0;break-inside:avoid}
.plano figcaption{display:flex;flex-direction:column;gap:1px;margin-bottom:3px;min-height:var(--cap,0)}
.plano figcaption b{font:800 1.05em/1.2 ${FUENTE_MARCA};color:#0B3170}
.plano figcaption span{font-size:.8em;color:#3d4650}
.plano svg{display:block;width:100%;height:auto;border:1px solid #D8E2EC;border-radius:6px;background:#fff}
.plano .fuente{margin:3px 0 0}
.planos.chico .plano{width:88%;margin-inline:auto}
`;
const CSS_INFOGRAFIA = (ancho: number, alto: number | null) => `
*{box-sizing:border-box}
html,body{margin:0;background:#F4F8FC}
body{width:${ancho}px;${alto ? `height:${alto}px;overflow:hidden;` : ''}font:17px/1.4 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1B2733;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.hoja{width:${ancho}px;${alto ? `height:${alto}px;` : ''}padding:24px 44px 20px;background:#F4F8FC;display:flex;flex-direction:column}
.titulo{margin:6px 0 4px}
.titulo h1{font:800 2.1em/1.1 ${FUENTE_MARCA};color:#0B3170;margin:0}
.titulo p{margin:2px 0 0;color:#57606a;font-size:.95em;max-width:1400px}
.pie-inf{margin-top:auto;padding-top:8px;border-top:2px solid #0A7FDB;display:flex;justify-content:space-between;gap:16px;font-size:.74em;color:#57606a;text-transform:uppercase;letter-spacing:.05em}
.lam{font-size:14px}
.hoja.lam{padding:14px 32px 10px}
.lam .titulo{margin:2px 0}
.lam .titulo h1{font-size:1.7em}
.lam .titulo p{font-size:1.02em}
.lam .plano figcaption span{font-size:.86em}
.lam .kpis{margin:4px 0 8px;gap:8px}
.lam .kpi{padding:5px 9px}
.lam .kpi .v{font-size:1.3em;margin:1px 0}
.lam .kpi .s{font-size:.78em;line-height:1.25}
.lam .planos{margin:0;flex:1;min-height:0;gap:10px 16px}
.lam .plano figcaption{margin-bottom:2px}
.lam .planos{--cap:3.4em}
.lam .plano .fuente{display:none}
.lam .plano{max-width:470px;margin-inline:auto;width:100%}
${CSS_COMUN}
${CSS_PLANOS}
`;
const CSS_CARTA = `
${CSS_COMUN}
${CSS_PLANOS}
.pagina{font-size:9.5pt}
.kpi .v{font-size:15pt}
.kpi .s{font-size:7.2pt}
.planos{--cols:2}
.plano figcaption span{font-size:7.6pt}
table.cifras{font-size:7.6pt}
table.cifras th{font-size:6.8pt;padding:4px 4px}
table.cifras td,table.cifras tbody th{padding:3px 4px}
`;

// ── Formatos ──────────────────────────────────────────────────────────────────
function infografia(d: DatosInformeClima, o: OpcionesHtmlClima): string {
  const lam = o.formato === 'lamina';
  const ancho = lam ? LAMINA_CLIMA_PX.ancho : ANCHO_PNG_CLIMA;
  const cabecera = membrete(o, d, lam ? 76 : altoMembretePorAncho(ancho));
  const nota = lam && d.planos.length > MAX_PLANOS_LAMINA ? ` · muestra ${MAX_PLANOS_LAMINA} de ${d.planos.length} planos (el PDF carta incluye todos)` : '';
  const pie = `<div class="pie-inf"><span>Folio ${esc(folioClima(d, o.emitido))}${esc(nota)}</span><span>SRL Unidad Conchos · Delicias · SICA 005</span><span>Fuente: JCAS/UACJ, Open-Meteo, estaciones propias · emitido ${esc(fechaHoraLegible(o.emitido))}</span></div>`;
  const lista = d.planos.slice(0, lam ? MAX_PLANOS_LAMINA : MAX_PLANOS_PNG);
  const omitidos = d.planos.length - lista.length;
  const cols = lam ? Math.min(3, Math.max(1, lista.length)) : lista.length <= 1 ? 1 : lista.length <= 4 ? 2 : 3;
  // ancho en pantalla de cada plano: el texto del SVG se escala para quedar ≈ 15 px (PNG) / 11 px (lámina) en el documento final
  const wCol = Math.floor(((lam ? ancho - 64 : ancho - 88) - (cols - 1) * (lam ? 16 : 18)) / cols);
  const planos = `<div class="planos" style="--cols:${cols}">${lista.map((p, i) => figura(p, d, `p${i}`, lam ? Math.min(wCol, 470) : wCol, lam ? 11 : 15)).join('')}</div>`;
  const aviso = omitidos > 0 && !lam ? `<p class="aviso">Este formato muestra ${lista.length} de ${d.planos.length} planos; el PDF carta los incluye todos.</p>` : '';
  const cuerpo = lam
    ? `${kpis(d)}${planos}${aviso}`
    : `${kpis(d)}${planos}${aviso}${d.config.estaciones ? tablaObs(d, 10) : ''}${notas(d)}`;
  return `<div class="hoja${lam ? ' lam' : ''}">${cabecera}${titular(d)}${cuerpo}${pie}</div>`;
}

function carta(d: DatosInformeClima, o: OpcionesHtmlClima): string {
  const hojas: string[] = [];
  const porHoja = 2;
  const grupos: PlanoInforme[][] = [];
  for (let i = 0; i < d.planos.length; i += porHoja) grupos.push(d.planos.slice(i, i + porHoja));
  const conTablas = d.config.estaciones;
  const paginasTabla = conTablas ? (d.config.observado ? 1 : 0) + (d.config.pronostico ? 1 : 0) : 0;
  const total = grupos.length + paginasTabla + 1;
  let n = 0;
  const hoja = (cuerpo: string, cabecera: string) => `<section class="pagina">${cabecera}<div class="cuerpo">${cuerpo}</div>${pieInforme(`Folio ${folioClima(d, o.emitido)}`, ++n, total)}</section>`;
  grupos.forEach((g, k) => {
    const planos = `<div class="planos${k === 0 ? ' chico' : ''}" style="--cols:${g.length}">${g.map((p, i) => figura(p, d, `c${k}${i}`, 340, 10)).join('')}</div>`;
    hojas.push(hoja(k === 0 ? `${titular(d, false)}${kpis(d)}${planos}` : planos, membrete(o, d)));
  });
  if (conTablas && d.config.observado) hojas.push(hoja(tablaObs(d), membrete(o, d)));
  if (conTablas && d.config.pronostico) hojas.push(hoja(tablaPron(d), membrete(o, d)));
  hojas.push(hoja([notas(d), `<section class="bloque"><h2>Trazabilidad</h2>${tablaTrazabilidad(filasTrazabilidad(d, o.emitido))}</section>`, `<section class="bloque"><h2>Firmas</h2>${bloqueFirmas()}</section>`].join(''), membrete(o, d)));
  return hojas.join('\n');
}

/** HTML autónomo del informe en el formato pedido. */
export function htmlInformeClimaCuenca(d: DatosInformeClima, o: OpcionesHtmlClima): string {
  const titulo = `Clima y pronóstico de la cuenca del Conchos · ${d.alcance}`;
  if (o.formato === 'carta') return documentoHtml({ titulo, css: `${cssInforme({ formato: 'letter' })}${CSS_CARTA}`, cuerpo: carta(d, o), metas: { 'sica:folio': folioClima(d, o.emitido) } });
  const lam = o.formato === 'lamina';
  const ancho = lam ? LAMINA_CLIMA_PX.ancho : ANCHO_PNG_CLIMA;
  const css = `${CSS_MEMBRETE}${CSS_INFOGRAFIA(ancho, lam ? LAMINA_CLIMA_PX.alto : null)}${lam ? '@page{size:17in 11in;margin:0}' : ''}`;
  const html = documentoHtml({ titulo, css, cuerpo: infografia(d, o), metas: { 'sica:folio': folioClima(d, o.emitido) } });
  return html.replace(/<button class="btn-imprimir[\s\S]*?<\/button>/, '');
}

