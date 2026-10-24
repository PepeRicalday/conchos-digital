/**
 * informeNdviHtml — plantilla PURA del informe institucional de NDVI: (datos, logos, plano) → HTML autónomo.
 * Hasta 4 hojas densas (A: portada+resumen · B: plano+fichas · C: serie+anexo · D: metodología) según las secciones
 * elegidas; folio y numeración dinámicos. Marrón SRL como único acento de marca; el color de datos es solo la rampa
 * agronómica (ndviRampa.ts) y S/D va en gris. Sin red ni DOM: se prueba con vitest.
 */
import { CLASES_NDVI, NDVI_RANGO, colorNdvi } from './ndviRampa';
import { KC_BASE, KC_MAX, KC_MIN, KC_PENDIENTE } from './kcConstantes';
import { fmt, fmtMiles, SD } from './formato';
import { cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, mesLegible, pieInforme } from './informeBase';
import { svgSerieModulos, svgSparkline } from './informeNdviSvg';
import { CAUTELA_TITULAR, titularDeAnomalias } from './ndviGrafica';
import { signoDelta, svgBarrasDelta, svgBarrasPareadas, svgLineasSimples, svgPendienteSlope } from './informeNdviSvgComparativo';
import { MIN_ANIOS_REFERENCIA, Z_INUSUAL, fraseAnomalia, fraseEvolucion, type AnomaliaPeriodo, type TendenciaModulo } from './informeNdviAnalisis';
import { UMBRAL_SIN_CAMBIO } from './ndviInteranual';
import { ROTULO_METODO_NDVI } from './ndviSerie';
import { etiquetaPeriodo, SECCIONES_NDVI } from './informeNdviConfig';
import type { InformeNdvi, ModuloInforme } from './informeNdviDatos';
import type { ClaseNdvi } from './ndviRampa';

export interface LogosInforme { srl: string; sica: string }

function chipClase(c: ClaseNdvi | null): string {
    return c ? `<span class="chip"><i style="background:${c.color}"></i>${esc(c.etiqueta)}</span>` : '<span class="chip sd">S/D</span>';
}

/** Delta en tinta neutra con flecha (legible en B/N y para daltónicos): ▲ sube · ▼ baja · ■ sin cambio. */
function deltaTexto(d: number | null, decimales = 3): string {
    if (d == null || !Number.isFinite(d)) return `<span class="sd">${SD}</span>`;
    // Si el valor se imprimiría como 0.00 no se anuncia una subida o bajada (evita "▲ +0.00").
    if (Math.abs(d) < 0.5 * 10 ** -decimales) return `■ ${(0).toFixed(decimales)}`;
    return d > 0 ? `▲ +${d.toFixed(decimales)}` : `▼ −${Math.abs(d).toFixed(decimales)}`;
}

/** Tinta única (blanco → marrón institucional) para ICV/IHR: no se confunde con las clases NDVI. */
function tintaMarron(v: number | null): { bg: string; fg: string } {
    if (v == null) return { bg: '#eceae5', fg: '#8c959f' };
    const t = Math.max(0, Math.min(1, v / 100));
    const mez = (a: number, b: number) => Math.round(a + (b - a) * t);
    return { bg: `rgb(${mez(255, 0x6b)},${mez(255, 0x2d)},${mez(255, 0x2d)})`, fg: t > 0.5 ? '#fff' : '#1f2328' };
}

function colorTextoSobre(rgb: string): string {
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb);
    if (!m) return '#1f2328';
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#1f2328' : '#fff';
}

function hexARgb(h: string): string {
    return `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`;
}

function rangoClase(c: ClaseNdvi): string {
    return c.desde === -Infinity ? `< ${c.hasta.toFixed(2)}` : c.hasta === Infinity ? `≥ ${c.desde.toFixed(2)}` : `${c.desde.toFixed(2)}–${c.hasta.toFixed(2)}`;
}

function tablaCalor(titulo: string, d: InformeNdvi, valor: (m: ModuloInforme, i: number) => number | null, tinta: (v: number | null) => { bg: string; fg: string }, decimales: number, promedio?: (number | null)[]): string {
    const cab = d.meses.map((m) => `<th class="n">${esc(mesLegible(m, true))}</th>`).join('');
    const celda = (v: number | null) => {
        const t = tinta(v);
        return v == null ? '<td class="n sd" style="background:#eceae5">S/D</td>' : `<td class="n" style="background:${t.bg};color:${t.fg};font-weight:700">${v.toFixed(decimales)}</td>`;
    };
    const filas = d.modulos.map((m) => `<tr><td><b>${esc(m.nombre)}</b></td>${d.meses.map((_, i) => celda(valor(m, i))).join('')}</tr>`).join('');
    const prom = promedio && d.modulos.length > 1 ? `<tr><td><b>Promedio SRL (${d.basePromedio})</b></td>${promedio.map((v) => celda(v)).join('')}</tr>` : '';
    return `<div class="tabla-wrap"><table class="compacta"><caption>${esc(titulo)}</caption><thead><tr><th>Módulo</th>${cab}</tr></thead><tbody>${filas}${prom}</tbody></table></div>`;
}

function leyenda(): string {
    const items = CLASES_NDVI.map((c) => `<li><i style="background:${c.color}"></i><b>${esc(c.etiqueta)}</b> <span class="num">${rangoClase(c)}</span></li>`).join('');
    return `<ul class="leyenda" aria-label="Leyenda de vigor vegetativo (NDVI)">${items}<li><i class="hach"></i><b>S/D</b> <span>sin dato</span></li></ul>`;
}

const EXTRA_CSS = `
.run{display:flex;justify-content:space-between;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);border-bottom:1px solid var(--linea);padding-bottom:4px;margin-bottom:8px}
.run b{color:var(--inst)}
.cuerpo{min-width:0}
.cuerpo>h2:not(:first-child){margin-top:12px}
.banda{margin:2mm 0 4mm}
.banda small{display:block;font-size:8pt;color:var(--ink2);margin-bottom:3px}
.banda h1{font-size:20pt}
.banda .sub{font:10pt Georgia,serif;color:var(--ink2);margin-top:2px}
.datos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:4mm 0 3mm}
.dato{border-top:3px solid var(--inst);padding-top:4px}
.dato b{display:block;font-size:8pt;color:var(--ink2)}
.dato span{font:600 10pt Georgia,serif}
.frase{font:10.5pt/1.4 Georgia,serif;margin:2px 0 6px}
.frase.titular{border-left:4px solid var(--inst);padding-left:8px}
.kpis{margin:6px 0}
.dist{display:flex;height:14px;border-radius:3px;overflow:hidden;border:1px solid var(--linea);margin:4px 0 2px}
.dist span{display:grid;place-items:center;font-size:7.5pt;font-weight:700;color:#1f2328}
.rank .fila{display:grid;grid-template-columns:62px 1fr 34px;gap:6px;align-items:center;margin:2px 0;font-size:8pt}
.rank .barra{height:8px;background:#eceae5;border-radius:2px;overflow:hidden}
.rank .barra i{display:block;height:100%}
.leyenda{display:flex;flex-wrap:wrap;gap:3px 12px;list-style:none;padding:0;margin:6px 0 0;font-size:7.5pt}
.leyenda li{display:inline-flex;align-items:center;gap:5px}
.leyenda i{width:12px;height:12px;border-radius:2px;border:1px solid rgba(0,0,0,.35);display:inline-block}
.leyenda i.hach{background:repeating-linear-gradient(45deg,#e9e7e2 0 3px,#a8afb7 3px 5px)}
.leyenda.vertical{flex-direction:column;gap:5px;font-size:8pt}
.mapa{display:grid;grid-template-columns:1.4fr 1fr;gap:10px;align-items:start}
.mapa .lado h3:first-child{margin-top:0}
.lado .promedio{border:1px solid var(--linea);border-top:3px solid var(--inst);border-radius:3px;padding:6px 8px;margin-top:8px}
.lado .promedio .v{font:700 18pt/1.1 Georgia,serif}
.fichas{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.ficha{border:1px solid var(--linea);border-top:4px solid var(--c);border-radius:3px;padding:6px 8px}
.ficha .fh{display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:9pt}
.ficha .fv{display:flex;align-items:baseline;gap:6px;margin:3px 0 1px}
.ficha .big{font:700 19pt/1 Georgia,serif}
.ficha .dlt{font-size:7.5pt;color:var(--ink2)}
.ficha dl{margin:3px 0 0;display:grid;grid-template-columns:auto auto;gap:1px 8px;font-size:7.5pt}
.ficha dt{color:var(--ink2)} .ficha dd{margin:0;text-align:right}
table.compacta{font-size:7.5pt} table.compacta th{padding:3px 5px;font-size:7pt} table.compacta td{padding:2px 5px}
.pares{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.def dt{font-weight:700;color:var(--inst);margin-top:5px}
.def dd{margin:0 0 2px;color:var(--ink)}
.cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:8.5pt}
.nota-pie{margin-top:6px;font-size:7.5pt;color:var(--ink2)}
@media screen and (max-width:720px){.mapa,.pares,.cols3,.fichas{grid-template-columns:1fr}.datos{grid-template-columns:1fr 1fr}.banda h1{font-size:16pt}}
`;

export function construirHtmlNdvi(d: InformeNdvi, logos: LogosInforme, plano: string): string {
    const sec = new Set(d.config.secciones);
    const ind = new Set(d.config.indicadores);
    const ref = d.mesReferencia;
    const refTxt = mesLegible(ref);
    const baseCorta = d.basePromedio;
    // La hoja E (análisis) solo existe si el modo es tendencia/comparativo y hay resultado.
    const hay = (g: 'A' | 'B' | 'C' | 'D' | 'E') => SECCIONES_NDVI.some((s) => s.pagina === g && sec.has(s.id)) && (g !== 'E' || d.analisis != null);
    // La hoja de análisis de TENDENCIA ocupa dos hojas físicas (no cabe en una: sus dos tablas y dos gráficas desbordaban y el PDF salía con una página de más).
    const divideE = d.analisis?.modo === 'tendencia';
    const total = (['A', 'B', 'E', 'C', 'D'] as const).filter(hay).length + (divideE && hay('E') ? 1 : 0);
    let pagina = 0;
    let nSec = 0;
    const pie = () => pieInforme(`Folio ${d.folio} · SICA-005 v${d.version}`, ++pagina, total);
    const corrida = `<div class="run"><span><b>S R L Unidad Conchos</b> · Informe institucional NDVI</span><span>${esc(d.folio)} · ${esc(refTxt)}</span></div>`;
    const clasePromedio = d.promedio != null ? CLASES_NDVI.find((c) => d.promedio! >= c.desde && d.promedio! < c.hasta) ?? null : null;
    const otroPromedio = d.basePromedio === 'simple' ? `Ponderado por superficie: ${fmt(d.promedioPonderado, 2)}` : `Simple: ${fmt(d.promedioSimple, 2)}`;
    const varios = d.modulos.length > 1;
    const periodoTxt = etiquetaPeriodo(d.config);

    // ── Hoja A: portada compacta + resumen ejecutivo
    const portadaBanda = `<div class="banda"><small>Centro de Inteligencia Agroclimática · SICA-005</small>
  <h1>Informe institucional de vigor de cultivos (NDVI)</h1>
  <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · ${d.modulos.length} ${d.modulos.length === 1 ? 'módulo' : 'módulos'} SRL</div></div>
<div class="datos">
  <div class="dato"><b>Mes de referencia</b><span>${esc(refTxt)}</span></div>
  <div class="dato"><b>Periodo</b><span>${esc(mesLegible(d.meses[0] ?? null, true))}${d.meses.length > 1 ? ` – ${esc(mesLegible(ref, true))}` : ''}</span></div>
  <div class="dato"><b>Cobertura</b><span>${d.modulos.filter((m) => m.tieneDatoDelMes).length} de ${d.modulos.length} con dato</span></div>
  <div class="dato"><b>Promedio</b><span>${esc(baseCorta)}</span></div>
</div>`;

    const tendTxt = d.tendencia != null ? `${d.tendencia > 0.0005 ? 'sube' : d.tendencia < -0.0005 ? 'baja' : 'sin cambio'} ${Math.abs(d.tendencia).toFixed(3)} frente a ${esc(mesLegible(d.mesAnterior))}` : '';
    const frase = d.promedio == null
        ? 'No hay datos de NDVI suficientes para este corte.'
        : `En ${esc(refTxt)} el NDVI medio${varios ? ' de la SRL' : ''} fue <b>${fmt(d.promedio, 2)}</b>${clasePromedio ? ` (${esc(clasePromedio.etiqueta.toLowerCase())})` : ''}${tendTxt ? `, ${tendTxt}` : ''}. ${
            varios && d.mejor ? `${esc(d.mejor.nombre)} presenta el mayor vigor (${fmt(d.mejor.ndvi, 2)})` : ''}${varios && d.peor ? ` y ${esc(d.peor.nombre)} el menor (${fmt(d.peor.ndvi, 2)})` : ''}${varios ? '.' : ''}`;
    const ranking = [...d.modulos].sort((a, b) => (b.ndvi ?? -1) - (a.ndvi ?? -1)).map((m) => `<div class="fila">
    <b>${esc(m.nombre)}</b><span class="barra">${m.ndvi != null ? `<i style="width:${Math.min(100, (m.ndvi / NDVI_RANGO[1]) * 100).toFixed(0)}%;background:${colorNdvi(m.ndvi)}"></i>` : ''}</span>
    <span class="num">${fmt(m.ndvi, 2)}</span></div>`).join('');
    const distTot = d.distribucion.reduce((s, x) => s + x.modulos.length, 0);
    const dist = distTot ? d.distribucion.filter((x) => x.modulos.length).map((x) => `<span style="flex:${x.modulos.length};background:${x.clase.color};color:${colorTextoSobre(hexARgb(x.clase.color))}" title="${esc(x.clase.etiqueta)}">${x.modulos.length}</span>`).join('') : '';
    const AVISOS_MAX = 4;
    const avisosVis = d.avisos.slice(0, AVISOS_MAX);
    const avisosHtml = d.avisos.length
        ? avisosVis.map((a) => `<div class="aviso"><b>${a.nivel === 'warn' ? 'Atención' : 'Nota'}:</b> ${esc(a.texto)}</div>`).join('') + (d.avisos.length > AVISOS_MAX ? `<div class="fuente">+ ${d.avisos.length - AVISOS_MAX} aviso(s) más: ver anexo y metodología.</div>` : '')
        : '<div class="aviso" style="border-left-color:#13866F;background:#effaf6;color:#0f5a49">Sin advertencias de calidad del dato en este corte.</div>';
    const clasesTabla = `<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Clase</th><th class="n">NDVI</th><th class="n">Módulos</th></tr></thead><tbody>${d.distribucion.map((x) =>
        `<tr><td>${chipClase(x.clase)}</td><td class="n">${rangoClase(x.clase)}</td><td class="n">${x.modulos.length ? x.modulos.map((n) => `M${n}`).join(', ') : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    const resumenHtml = () => `<h2><span class="n">${++nSec}</span>Resumen ejecutivo — ${esc(refTxt)}</h2>
<p class="frase">${frase}</p>
<div class="aviso"><b>Cómo leer este NDVI:</b> es la mediana mensual de los píxeles limpios sobre la frontera completa del módulo (incluye caminos, canales y suelo sin riego). Sirve para comparar meses y años del mismo módulo; no es el NDVI de una parcela.</div>
<div class="kpis">
  <div class="kpi"><div class="et">${varios ? `Promedio SRL (${esc(baseCorta)})` : 'NDVI medio'}</div><div class="v">${fmt(d.promedio, 2)}</div><div class="s">${chipClase(clasePromedio)}${varios ? `<br>${otroPromedio}` : ''}</div></div>
  <div class="kpi"><div class="et">Mayor vigor</div><div class="v">${d.mejor ? fmt(d.mejor.ndvi, 2) : SD}</div><div class="s">${d.mejor ? esc(d.mejor.nombre) : ''}</div></div>
  <div class="kpi"><div class="et">Menor vigor</div><div class="v">${d.peor ? fmt(d.peor.ndvi, 2) : SD}</div><div class="s">${d.peor ? esc(d.peor.nombre) : ''}</div></div>
  <div class="kpi"><div class="et">Cambio vs mes anterior</div><div class="v">${deltaTexto(d.tendencia, 2)}</div><div class="s">${d.mesAnterior ? esc(mesLegible(d.mesAnterior)) : 'Sin mes anterior'}</div></div>
</div>
<div class="cols">
  <div><h3>Distribución por clase de vigor</h3>
    <div class="dist" role="img" aria-label="Distribución de módulos por clase de NDVI">${dist || '<span style="flex:1;background:#eceae5" class="sd">S/D</span>'}</div>
    <div class="fuente">Módulos en cada clase (de ${distTot} con dato).</div>
    <h3>Ranking de módulos</h3><div class="rank">${ranking}</div></div>
  <div><h3>Cómo leer las clases</h3>${clasesTabla}
    <h3>Calidad del dato</h3>${avisosHtml}</div>
</div>`;
    const hojaA = !hay('A') ? '' : `<section class="pagina">${sec.has('portada')
        ? cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta: [
            { k: 'Folio', v: d.folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitidoEn) }, { k: 'Emitió', v: d.emisor }, { k: 'Versión', v: `SICA-005 v${d.version}` }] })
        : corrida}
<div class="cuerpo">${sec.has('portada') ? portadaBanda : ''}${sec.has('resumen') ? resumenHtml() : ''}
  ${sec.has('portada') ? `<p class="nota-pie">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios. Fuente: Sentinel-2 L2A (Copernicus), Statistical API, polígono exacto de cada módulo; ${esc(ROTULO_METODO_NDVI)}. Periodo: ${esc(periodoTxt)}. Documento generado automáticamente por SICA-005.</p>` : ''}
</div>${pie()}</section>`;

    // ── Hoja B: plano + fichas 3×2
    const planoHtml = () => {
        const bloque = plano
            ? `<figure class="fig" style="margin:0">${plano}<figcaption class="fuente">Fuente: Sentinel-2 L2A · NDVI (mediana del mes) por polígono exacto de cada módulo · ${esc(refTxt)}.</figcaption></figure>`
            : '<div class="aviso"><b>Plano no disponible:</b> no se pudieron cargar los contornos de los módulos al generar el informe.</div>';
        return `<h2><span class="n">${++nSec}</span>Plano general — NDVI ${esc(refTxt)}</h2>
<div class="mapa"><div>${bloque}</div>
<div class="lado"><h3>Leyenda</h3>${leyenda().replace('class="leyenda"', 'class="leyenda vertical"')}
  <div class="promedio"><div class="fuente" style="margin:0">${varios ? `Promedio SRL (${esc(baseCorta)})` : 'NDVI medio'}</div><div class="v">${fmt(d.promedio, 2)}</div><div class="fuente" style="margin:0">${chipClase(clasePromedio)}</div></div>
  <p class="fuente" style="margin-top:8px">Relleno = clase de NDVI del mes. Gris hachurado = sin dato. Los valores por módulo están en las fichas.</p></div></div>`;
    };
    const ficha = (m: ModuloInforme) => `<div class="ficha" style="--c:${m.color}">
  <div class="fh"><b>${esc(m.nombre)}</b>${chipClase(m.clase)}</div>
  <div class="fv"><span class="big">${fmt(m.ndvi, 2)}</span><span class="dlt">${deltaTexto(m.delta)}</span></div>
  ${m.tieneDatoDelMes ? '' : `<div class="sd">Sin dato en ${esc(refTxt)}</div>`}
  ${d.meses.length > 1 ? `<div>${svgSparkline(m.serieNdvi, 120, 20)}</div>` : ''}
  <dl><dt>Superficie (ha)</dt><dd class="num">${fmtMiles(m.superficieHa, 0)}</dd>${ind.has('kc') ? `<dt>Kc estimado</dt><dd class="num">${fmt(m.kc, 2)}</dd>` : ''}${
        ind.has('icv') ? `<dt>ICV (0–100)</dt><dd class="num">${fmt(m.icv, 0)}</dd>` : ''}${ind.has('ihr') ? `<dt>IHR (0–100)</dt><dd class="num">${fmt(m.ihr, 0)}</dd>` : ''}${
        ind.has('iehp') ? `<dt>IEHP (ha/hm³)</dt><dd class="num">${fmt(m.iehp, 1)}</dd>` : ''}</dl></div>`;
    const fichasHtml = () => `<h2 style="margin-top:8px"><span class="n">${++nSec}</span>Fichas por módulo — ${esc(refTxt)}</h2>
<div class="fichas">${d.modulos.map(ficha).join('')}</div>
<p class="fuente">Sparkline: NDVI mensual del periodo (escala 0–0.8, igual en todos los módulos). Δ = diferencia contra el mes anterior de la serie.</p>`;
    const hojaB = !hay('B') ? '' : `<section class="pagina">${corrida}<div class="cuerpo">${sec.has('plano') ? planoHtml() : ''}${sec.has('fichas') ? fichasHtml() : ''}</div>${pie()}</section>`;

    // ── Hoja E: análisis (modo Tendencia o Comparativo)
    const analisisHtml = (): string => {
        const a = d.analisis;
        if (!a) return '';
        const cabNota = d.variosAnios ? '' : '<p class="fuente">La serie cargada abarca un solo año: no hay años anteriores contra los cuales comparar.</p>';
        const dd = (v: number | null, dec = 3) => (v == null ? `<span class="sd">${SD}</span>` : signoDelta(v, dec));
        const avisosAn = (lista: string[]) => lista.map((t) => `<div class="aviso"><b>Atención:</b> ${esc(t)}</div>`).join('');
        const frontera = '<div class="aviso"><b>Cómo leer este NDVI:</b> frontera completa del módulo (caminos, canales y suelo sin riego incluidos), mediana mensual con máscara de nubes. Compara un periodo con otro del mismo módulo; no es el NDVI de una parcela y una diferencia no prueba su causa.</div>';
        const pctTxt = (v: number | null) => (v == null ? SD : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} %`);
        if (a.modo === 'tendencia') {
            const srl = a.tendencias.find((t) => t.id === 'srl') ?? a.tendencias[0];
            const sujeto = varios ? 'Promedio SRL' : (srl?.etiqueta ?? '');
            const lecturaAnom = (an: AnomaliaPeriodo) => (an.nConRef === 0 ? `Insuficiente (sin referencia)` : an.direccion === 'arriba' ? '▲ Por encima de lo habitual'
                : an.direccion === 'abajo' ? '▼ Por debajo de lo habitual' : '■ En línea con lo habitual') + (an.fueraDeLoHabitual ? ' · fuera de lo habitual' : '');
            const lecturaAnual = (t: TendenciaModulo) => { const m = t.evolucion.media; return m.patron === 'sube' ? '▲ Sube año tras año' : m.patron === 'baja' ? '▼ Baja año tras año'
                : m.patron === 'sin-patron' ? '■ Sin patrón claro' : `Insuficiente (n=${m.n})`; };
            const filasAn = a.tendencias.map((t) => { const an = t.anomalia; return `<tr${t.id === 'srl' ? ' style="font-weight:700"' : ''}><td${t.id === 'srl' ? '' : ` style="border-left:4px solid ${t.color}"`}>${esc(t.etiqueta)}${t.nModulos ? ` <span class="fuente">(${t.nModulos.n} de ${t.nModulos.total})</span>` : ''}</td>
<td class="n">${fmt(an.mediaValor, 2)}</td><td class="n">${fmt(an.mediaRef, 2)}</td><td class="n">${dd(an.mediaAbs)}</td><td class="n">${pctTxt(an.pct)}</td>
<td class="n">${an.nConRef ? `${an.mesesArriba} / ${an.mesesAbajo} / ${an.mesesSimilar}` : SD}</td><td>${esc(lecturaAnom(an))}</td><td>${an.bajaConfianza ? 'Baja ⚠' : 'Aceptable'}</td></tr>`; }).join('');
            const motivos = [...new Set(a.tendencias.flatMap((t) => t.anomalia.motivos))].slice(0, 5);
            const aniosCols = [...new Set(a.tendencias.flatMap((t) => t.evolucion.anios.map((x) => x.anio)))].sort((x, y) => x - y);
            const celdaAnio = (t: TendenciaModulo, anio: number) => {
                const x = t.evolucion.anios.find((q) => q.anio === anio);
                if (!x || x.media == null) return `<td class="n sd">${SD}</td>`;
                return `<td class="n">${x.media.toFixed(2)}${x.completo ? '' : '*'}${x.pocoConfiable ? ' ⚠' : ''}</td>`;
            };
            const filasAnual = a.tendencias.map((t) => { const m = t.evolucion.media; return `<tr${t.id === 'srl' ? ' style="font-weight:700"' : ''}><td${t.id === 'srl' ? '' : ` style="border-left:4px solid ${t.color}"`}>${esc(t.etiqueta)}</td>
${aniosCols.map((an) => celdaAnio(t, an)).join('')}<td class="n">${m.sen == null ? SD : signoDelta(m.sen, 3)}</td><td class="n">${m.r2 == null ? SD : `${m.r2.toFixed(2)} (≥ ${(m.r2Umbral as number).toFixed(2)})`}</td><td>${esc(lecturaAnual(t))}</td></tr>`; }).join('');
            const barras = svgBarrasDelta(a.tendencias.map((t) => ({ etiqueta: t.etiqueta, valor: t.anomalia.mediaAbs })), 3);
            const lineasAnio = svgLineasSimples(aniosCols.map(String), a.tendencias.map((t) => ({
                etiqueta: t.id === 'srl' ? 'SRL' : `M${t.id}`, color: t.color, vals: aniosCols.map((an) => t.evolucion.anios.find((q) => q.anio === an)?.media ?? null),
                ...(t.id === 'srl' ? { dash: '6 3', ancho: 2.6 } : {}),
            })), 620, 190, aniosCols.map(String));
            const nSrl = srl?.nModulos;
            const titular = varios ? titularDeAnomalias(periodoTxt, 0, a.tendencias.filter((t) => t.id !== 'srl').map((t) => t.anomalia)) : null;
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Tendencia del NDVI — ${esc(periodoTxt)}</h2>
${srl ? `<p class="frase">${esc(fraseAnomalia(srl.anomalia, sujeto))}</p><p class="frase">${esc(fraseEvolucion(srl.evolucion, sujeto))}</p>` : '<p class="frase">No hay suficientes datos para describir la tendencia.</p>'}
${titular ? `<p class="frase titular"><b>${esc(titular.texto)}.</b></p><div class="aviso">${esc(CAUTELA_TITULAR)}</div>` : ''}
${frontera}
<h3>1 · Frente a lo habitual (mismos meses de los demás años)</h3>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Módulo</th><th class="n">NDVI del periodo</th><th class="n">Habitual</th><th class="n">Diferencia</th><th class="n">%</th><th class="n">Meses ↑ / ↓ / =</th><th>Lectura</th><th>Confianza</th></tr></thead><tbody>${filasAn}</tbody></table></div>
<figure class="fig" style="margin:0">${barras || '<div class="aviso">Sin diferencias para graficar.</div>'}
<figcaption class="fuente">Diferencia entre el NDVI del periodo y lo habitual en los mismos meses de otros años (derecha = por encima). ↑ / ↓ / = cuenta meses por encima, por debajo o en línea (menos de ${UMBRAL_SIN_CAMBIO.toFixed(2)}).${nSrl ? ` Promedio SRL: ${nSrl.n} de ${nSrl.total} módulos con referencia.` : ''}</figcaption></figure>
${motivos.length ? `<div class="aviso"><b>Baja confianza en:</b> ${motivos.map(esc).join(' · ')}</div>` : ''}
<!--CORTE-->
<h2 style="margin-top:0">Tendencia del NDVI — año tras año</h2>
<h3>2 · Año tras año (media de la temporada marzo–septiembre)</h3>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Módulo</th>${aniosCols.map((an) => `<th class="n">${an}</th>`).join('')}<th class="n">Cambio por año</th><th class="n">R² (mínimo)</th><th>Lectura</th></tr></thead><tbody>${filasAnual}</tbody></table></div>
<figure class="fig" style="margin:0">${lineasAnio || '<div class="aviso">Sin años para graficar.</div>'}</figure>
<div class="aviso"><b>Cómo se lee:</b> «Frente a lo habitual» compara cada mes del periodo con el mismo mes de los demás años (mínimo ${MIN_ANIOS_REFERENCIA} años de referencia): de marzo a septiembre el NDVI sube siempre por el ciclo del cultivo, por eso no se mide una pendiente dentro del año. «En línea» = diferencia menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)} (cerca de media desviación entre años de la media de temporada, ≈ 0.05). «Fuera de lo habitual» = promedio de ${Z_INUSUAL} o más desviaciones de los otros años. En «Año tras año» solo cuentan las temporadas completas (*: incompleta, no entra); se dice que sube o baja únicamente si el ajuste alcanza el R² mínimo para ese número de años (≈ 0.66 con 6) y el cambio de punta a punta es de ${UMBRAL_SIN_CAMBIO.toFixed(2)} o más (⚠: algún mes con pocas observaciones). Con unos 6 años es una descripción, no una prueba ni una causa.</div>
${cabNota}`;
        }
        const c = a.comparacion;
        if (c.kind === 'periodos' || c.kind === 'mesVsMes') {
            const m = c.kind === 'mesVsMes' ? 'Mes contra mes' : 'Periodo A contra periodo B';
            const dentro = c.delta != null && Math.abs(c.delta) < UMBRAL_SIN_CAMBIO ? ' Es una diferencia dentro de la variación normal entre años (menos de 0.02).' : '';
            const frase = c.promA == null || c.promB == null
                ? 'Alguno de los dos lados no tiene datos: no se puede calcular la diferencia.'
                : `El NDVI medio ${varios ? 'de la SRL ' : ''}fue <b>${fmt(c.promA, 2)}</b> en A (${esc(c.etiquetaA)}) y <b>${fmt(c.promB, 2)}</b> en B (${esc(c.etiquetaB)}): diferencia B − A ${deltaTexto(c.delta)}${c.pct != null ? ` (${c.pct >= 0 ? '+' : '−'}${Math.abs(c.pct).toFixed(1)} %)` : ''}.${dentro}${
                    varios && c.mayorAumento ? ` Mayor aumento: ${esc(c.mayorAumento.nombre)} (${deltaTexto(c.mayorAumento.delta)}).` : ''}${varios && c.mayorDescenso ? ` Mayor descenso: ${esc(c.mayorDescenso.nombre)} (${deltaTexto(c.mayorDescenso.delta)}).` : ''}`;
            const filasC = c.filas.map((f) => `<tr><td><b>${esc(f.nombre)}</b></td><td class="n">${fmt(f.a, 2)}</td><td class="n">${fmt(f.b, 2)}</td><td class="n">${dd(f.delta)}</td><td class="n">${pctTxt(f.pct)}</td><td class="n">${f.nA} / ${f.nB}</td></tr>`).join('');
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${m}</h2>
<p class="frase">${frase}</p>${avisosAn(c.avisos)}
<figure class="fig" style="margin:0">${svgPendienteSlope(c.filas.map((f) => ({ etiqueta: f.nombre.replace('Módulo ', 'M'), a: f.a, b: f.b })), c.etiquetaA, c.etiquetaB) || '<div class="aviso">Sin datos para graficar.</div>'}
<figcaption class="fuente">Cada línea une el NDVI medio del módulo en A y en B: continua = sube, punteada = baja, gris = sin cambio (menos de ${UMBRAL_SIN_CAMBIO.toFixed(2)}). Escala 0–0.8.</figcaption></figure>
<div class="pares"><div class="tabla-wrap"><table class="compacta"><caption>Diferencia B − A por módulo</caption><thead><tr><th>Módulo</th><th class="n">A</th><th class="n">B</th><th class="n">B − A</th><th class="n">%</th><th class="n">Meses A/B</th></tr></thead><tbody>${filasC}
<tr style="font-weight:700"><td>Promedio SRL (${esc(baseCorta)}; ${c.nModulosA} de ${c.filas.length} módulos en A y ${c.nModulosB} en B)</td><td class="n">${fmt(c.promA, 2)}</td><td class="n">${fmt(c.promB, 2)}</td><td class="n">${dd(c.delta)}</td><td class="n">${pctTxt(c.pct)}</td><td></td></tr></tbody></table></div>
<figure class="fig" style="margin:0">${svgBarrasDelta(c.filas.map((f) => ({ etiqueta: f.nombre, valor: f.delta })), 3, 420) || ''}</figure></div>
<p class="fuente">A = ${esc(c.etiquetaA)} (${c.mesesA.length} meses) · B = ${esc(c.etiquetaB)} (${c.mesesB.length} meses). Cada lado es el promedio de los meses con dato del módulo; un módulo sin dato en un lado queda S/D. Si A y B son de años distintos y cubren los mismos meses, la diferencia no es estacional.</p>
${frontera}${cabNota}`;
        }
        if (c.kind === 'modulos') {
            const nd = c.indicadores[0];
            const frase = c.delta == null ? 'No hay datos suficientes para comparar los dos módulos.'
                : Math.abs(c.delta) < UMBRAL_SIN_CAMBIO
                    ? `${esc(c.A.nombre)} y ${esc(c.B.nombre)} tienen un NDVI medio casi igual en el periodo (${fmt(nd.a, 2)} y ${fmt(nd.b, 2)}; diferencia menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}); ${esc(c.A.nombre)} supera a ${esc(c.B.nombre)} en ${c.mesesAMayor} de ${c.mesesComunes} meses.`
                    : `${esc(c.B.nombre)} ${c.delta >= 0 ? 'supera' : 'queda por debajo de'} a ${esc(c.A.nombre)} por <b>${Math.abs(c.delta).toFixed(3)}</b> de NDVI medio en el periodo (${fmt(nd.b, 2)} contra ${fmt(nd.a, 2)}); ${esc(c.A.nombre)} supera a ${esc(c.B.nombre)} en ${c.mesesAMayor} de ${c.mesesComunes} meses.`;
            const filasM = c.meses.map((mes, i) => `<tr><td>${esc(mesLegible(mes, true))}</td><td class="n">${fmt(c.serieA[i], 2)}</td><td class="n">${fmt(c.serieB[i], 2)}</td><td class="n">${c.serieA[i] != null && c.serieB[i] != null ? dd((c.serieB[i] as number) - (c.serieA[i] as number)) : `<span class="sd">${SD}</span>`}</td></tr>`).join('');
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${esc(c.A.nombre)} contra ${esc(c.B.nombre)}</h2>
<p class="frase">${frase}</p>
<figure class="fig" style="margin:0">${svgBarrasPareadas(c.indicadores.map((i) => ({ etiqueta: i.etiqueta, a: i.a, b: i.b, max: i.max, decimales: i.decimales })), c.A.nombre, c.B.nombre, c.A.color, c.B.color) || ''}
<figcaption class="fuente">Promedio de cada indicador en el periodo (${esc(periodoTxt)}); cada barra usa la escala de su indicador (NDVI 0–0.8 · IHR 0–100). El Kc y el ICV no se comparan aparte: son el NDVI en otra escala y repetirían la misma lectura.</figcaption></figure>
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.A.nombre, color: c.A.color, vals: c.serieA }, { etiqueta: c.B.nombre, color: c.B.color, vals: c.serieB, dash: '6 3' }]) || ''}</figure>
<div class="tabla-wrap"><table class="compacta"><caption>NDVI mensual (Δ = ${esc(c.B.nombre)} − ${esc(c.A.nombre)})</caption><thead><tr><th>Mes</th><th class="n">${esc(c.A.nombre)}</th><th class="n">${esc(c.B.nombre)}</th><th class="n">Δ</th></tr></thead><tbody>${filasM}</tbody></table></div>
${frontera}${cabNota}`;
        }
        // Módulo contra el promedio de los demás módulos
        if (c.kind !== 'vsSRL') return '';
        const frase = c.difMedia == null ? 'No hay datos suficientes para comparar el módulo con el promedio de los demás.'
            : Math.abs(c.difMedia) < UMBRAL_SIN_CAMBIO
                ? `${esc(c.modulo.nombre)} está en línea con el promedio de los otros ${c.totalOtros} módulos (diferencia media ${signoDelta(c.difMedia, 3)}, menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}).`
                : `${esc(c.modulo.nombre)} ${c.difMedia >= 0 ? 'está por encima' : 'está por debajo'} del promedio de los otros ${c.totalOtros} módulos por <b>${Math.abs(c.difMedia).toFixed(3)}</b> de NDVI en promedio; lo supera por ${UMBRAL_SIN_CAMBIO.toFixed(2)} o más en ${c.mesesPorEncima} de ${c.mesesComunes} meses.`;
        const filasV = c.meses.map((mes, i) => `<tr><td>${esc(mesLegible(mes, true))}</td><td class="n">${fmt(c.serie[i], 2)}</td><td class="n">${fmt(c.srl[i], 2)}</td><td class="n">${c.nOtros[i]} de ${c.totalOtros}</td><td class="n">${dd(c.diferencia[i])}</td></tr>`).join('');
        return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${esc(c.modulo.nombre)} contra el promedio de los demás</h2>
<p class="frase">${frase}</p>
${c.composicionVariable ? '<div class="aviso"><b>Atención:</b> en algunos meses el promedio de referencia se calculó con menos módulos que el total (ver la columna «Módulos»).</div>' : ''}
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.modulo.nombre, color: c.modulo.color, vals: c.serie }, { etiqueta: 'Otros', color: '#1f2328', vals: c.srl, dash: '6 3', ancho: 2.6 }]) || ''}
<figcaption class="fuente">La referencia es el promedio simple de los otros ${c.totalOtros} módulos SRL (el módulo no entra en su propia referencia ni depende del filtro de módulos).</figcaption></figure>
<h3>Diferencia mensual contra el promedio de los demás (NDVI)</h3>
<figure class="fig" style="margin:0">${svgBarrasDelta(c.meses.map((mes, i) => ({ etiqueta: mesLegible(mes, true), valor: c.diferencia[i] })), 3) || ''}</figure>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Mes</th><th class="n">${esc(c.modulo.nombre)}</th><th class="n">Otros</th><th class="n">Módulos</th><th class="n">Diferencia</th></tr></thead><tbody>${filasV}</tbody></table></div>
${frontera}${cabNota}`;
    };
    const hojaE = !hay('E') ? '' : analisisHtml().split('<!--CORTE-->').map((parte) => `<section class="pagina">${corrida}<div class="cuerpo">${parte}</div>${pie()}</section>`).join('\n');

    // ── Hoja C: serie histórica + anexo de datos
    const serieHtml = () => {
        const calor = [
            tablaCalor('NDVI mensual por módulo', d, (m, i) => m.serieNdvi[i], (v) => (v == null ? { bg: '#eceae5', fg: '#8c959f' } : { bg: colorNdvi(v), fg: colorTextoSobre(colorNdvi(v)) }), 2, d.promedioPorMes),
        ];
        const pares: string[] = [];
        if (ind.has('icv')) pares.push(tablaCalor('ICV mensual (0–100)', d, (m, i) => m.serieIcv[i], tintaMarron, 0));
        if (ind.has('ihr')) pares.push(tablaCalor('IHR mensual (0–100)', d, (m, i) => m.serieIhr[i], tintaMarron, 0));
        return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Serie histórica — ${esc(mesLegible(d.meses[0] ?? null))}${d.meses.length > 1 ? ` a ${esc(refTxt)}` : ''}</h2>
<figure class="fig" style="margin:0">${svgSerieModulos(d.meses, d.modulos, d.promedioPorMes, 660, 190) || '<div class="aviso">Sin serie para graficar.</div>'}
<figcaption class="fuente">NDVI medio mensual por módulo; línea punteada = promedio SRL (${esc(baseCorta)}). Escala vertical 0–0.8.</figcaption></figure>
${calor.join('')}${pares.length ? `<div class="pares">${pares.join('')}</div>` : ''}
<div class="fuente">Color de las celdas de NDVI = clase (misma leyenda del plano). ICV/IHR en tinta marrón: más oscuro = mayor valor. S/D = sin fila ese mes.</div>`;
    };
    const anexoHtml = () => {
        const cols = ['<th>Módulo</th>', '<th class="n">NDVI</th>', '<th>Clase</th>', '<th class="n">Δ NDVI</th>', '<th class="n">Superficie (ha)</th>',
            ind.has('kc') ? '<th class="n">Kc</th>' : '', ind.has('icv') ? '<th class="n">ICV</th>' : '', ind.has('ihr') ? '<th class="n">IHR</th>' : '', ind.has('iehp') ? '<th class="n">IEHP</th>' : ''].join('');
        const filasAnexo = d.modulos.map((m) => `<tr><td style="border-left:4px solid ${m.color}"><b>${esc(m.nombre)}</b></td>
<td class="n">${fmt(m.ndvi, 2)}</td><td>${chipClase(m.clase)}</td><td class="n">${m.delta == null ? SD : (m.delta >= 0 ? '+' : '−') + Math.abs(m.delta).toFixed(3)}</td>
<td class="n">${fmtMiles(m.superficieHa, 0)}</td>${ind.has('kc') ? `<td class="n">${fmt(m.kc, 2)}</td>` : ''}${ind.has('icv') ? `<td class="n">${fmt(m.icv, 0)}</td>` : ''}${
            ind.has('ihr') ? `<td class="n">${fmt(m.ihr, 0)}</td>` : ''}${ind.has('iehp') ? `<td class="n">${fmt(m.iehp, 1)}</td>` : ''}</tr>`).join('');
        const vacias = (n: number) => '<td></td>'.repeat(n);
        const prom = varios ? `<tr><td><b>Promedio SRL (${esc(baseCorta)})</b></td><td class="n"><b>${fmt(d.promedio, 2)}</b></td>${vacias(3)}${ind.has('kc') ? vacias(1) : ''}${
            ind.has('icv') ? `<td class="n"><b>${fmt(d.promedioIcv, 0)}</b></td>` : ''}${ind.has('ihr') ? `<td class="n"><b>${fmt(d.promedioIhr, 0)}</b></td>` : ''}${ind.has('iehp') ? vacias(1) : ''}</tr>` : '';
        return `<h2><span class="n">${++nSec}</span>Anexo de datos — ${esc(refTxt)}</h2>
<div class="tabla-wrap"><table class="compacta"><thead><tr>${cols}</tr></thead><tbody>${filasAnexo}${prom}</tbody></table></div>`;
    };
    const hojaC = !hay('C') ? '' : `<section class="pagina">${corrida}<div class="cuerpo">${sec.has('serie') ? serieHtml() : ''}${sec.has('anexo') ? anexoHtml() : ''}</div>${pie()}</section>`;

    // ── Hoja D: metodología, glosario y limitaciones (3 columnas)
    const p = d.parametros;
    const defs = [
        '<dt>NDVI</dt><dd>Índice de vegetación de diferencia normalizada: mediana mensual de los píxeles limpios (máscara de nubes por píxel) del polígono exacto de cada módulo (Sentinel-2 L2A, Statistical API). Es el NDVI de la frontera del módulo, no de una parcela.</dd>',
        ind.has('kc') ? `<dt>Kc estimado</dt><dd>Aproximación lineal NDVI→Kc: ${KC_BASE.toFixed(2)} + ${KC_PENDIENTE.toFixed(2)}·NDVI, acotado a ${KC_MIN.toFixed(2)}–${KC_MAX.toFixed(2)}.</dd>` : '',
        ind.has('icv') ? `<dt>ICV (0–100)</dt><dd>Condición vegetativa: escala lineal del NDVI con piso ${p.ndviPiso.toFixed(2)} (suelo desnudo) y techo ${p.ndviTecho.toFixed(2)} (vigor pleno).</dd>` : '',
        ind.has('ihr') ? '<dt>IHR (0–100)</dt><dd>Homogeneidad de riego: 100×(1 − desviación/media) del NDVI dentro del módulo.</dd>' : '',
        ind.has('iehp') ? `<dt>IEHP (ha/hm³)</dt><dd>Hectáreas con cobertura activa (NDVI ≥ ${p.umbralActivo.toFixed(2)}) por hm³ entregado acumulado del ciclo.</dd>` : '',
    ].join('');
    const metodologiaHtml = `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Metodología, glosario y limitaciones</h2>
<div class="cols3"><div><h3>Definiciones</h3><dl class="def">${defs}</dl></div>
<div><h3>Método</h3>
<p>Periodo del informe: ${esc(periodoTxt)}. Ventana de cálculo del mes de referencia: ${esc(d.ventana.desde ?? 'S/D')} a ${esc(d.ventana.hasta ?? 'S/D')} (mes calendario cerrado). Filtro de nubosidad: ≤ ${d.nubosidadMaxPct != null ? d.nubosidadMaxPct.toFixed(0) : 'S/D'} %. Resolución nativa 10 m.</p>
<p>Clases de vigor: ${CLASES_NDVI.map((c) => esc(c.etiqueta)).join(' · ')} (límites 0.15 / 0.30 / 0.50 / 0.70).</p>
<p>Serie: ${esc(ROTULO_METODO_NDVI)}. No se mezcla con la serie anterior (promedio de 30 días sin máscara), que es otra magnitud.</p><p>Los cambios (Δ) se calculan contra el mes calendario inmediato anterior; si ese mes no tiene dato, el cambio queda S/D.</p></div>
<div><h3>Limitaciones</h3>
<p>• Promedio SRL ${d.basePromedio === 'ponderado' ? '<b>ponderado por superficie</b> (el simple se muestra aparte)' : '<b>simple</b> (cada módulo pesa igual; el ponderado por superficie se muestra aparte)'}.<br>
• ${d.volumenMesParcial ? 'El volumen del mes de referencia es <b>parcial</b>: el IEHP de este corte no es comparable con meses completos.' : 'El volumen entregado proviene de la carga institucional provisional de la SRL, no de la captura operativa diaria.'}<br>
${d.variosAnios ? '• Para comparar un año contra otros use el modo Interanual (serie homogénea desde 2021).' : '• La serie cargada abarca un solo año: no hay años anteriores para comparar.'}<br>
• Con unos 6 años de serie, tendencias y diferencias son descriptivas: no prueban una causa.<br>
• El NDVI es de un mes calendario cerrado; no describe los últimos días. El mes en curso puede estar incompleto.<br>
• IEH e ISH requieren ETa y temperatura superficial satelital: pendientes.<br>
• Un módulo sin dato del mes aparece como S/D; no se sustituye con otro mes.</p></div></div>
<div class="aviso"><b>Uso del documento:</b> producto de apoyo a la decisión. No sustituye aforos ni mediciones oficiales en campo.</div>`;
    const hojaD = !hay('D') ? '' : `<section class="pagina">${corrida}<div class="cuerpo">${metodologiaHtml}</div>${pie()}</section>`;

    return documentoHtml({
        titulo: `Informe institucional NDVI — SRL Unidad Conchos — ${refTxt}`,
        css: cssInforme({ formato: d.config.hoja }) + EXTRA_CSS,
        cuerpo: [hojaA, hojaB, hojaE, hojaC, hojaD].filter(Boolean).join('\n'),
    });
}
