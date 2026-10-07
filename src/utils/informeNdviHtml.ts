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
import { signoDelta, svgBarrasDelta, svgBarrasPareadas, svgLineasSimples, svgPendienteSlope } from './informeNdviSvgComparativo';
import { TENDENCIA_MIN_N, TENDENCIA_MIN_PENDIENTE, TENDENCIA_MIN_R2, type TendenciaModulo } from './informeNdviAnalisis';
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
    if (Math.abs(d) < 0.0005) return `■ ${(0).toFixed(decimales)}`;
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
.banda small{display:block;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-bottom:3px}
.banda h1{font-size:20pt}
.banda .sub{font:10pt Georgia,serif;color:var(--ink2);margin-top:2px}
.datos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:4mm 0 3mm}
.dato{border-top:3px solid var(--inst);padding-top:4px}
.dato b{display:block;font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.dato span{font:600 10pt Georgia,serif}
.frase{font:10.5pt/1.4 Georgia,serif;margin:2px 0 6px}
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
.mapa{display:grid;grid-template-columns:1.1fr 1fr;gap:10px;align-items:start}
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
    const total = (['A', 'B', 'E', 'C', 'D'] as const).filter(hay).length;
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
  ${sec.has('portada') ? `<p class="nota-pie">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios. Fuente: Sentinel-2 L2A (Copernicus), Statistical API, polígono exacto de cada módulo. Periodo: ${esc(periodoTxt)}. Documento generado automáticamente por SICA-005.</p>` : ''}
</div>${pie()}</section>`;

    // ── Hoja B: plano + fichas 3×2
    const planoHtml = () => {
        const bloque = plano
            ? `<figure class="fig" style="margin:0">${plano}<figcaption class="fuente">Fuente: Sentinel-2 L2A · NDVI medio del mes por polígono exacto de cada módulo · ${esc(refTxt)}.</figcaption></figure>`
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
        const cabNota = '<p class="fuente">Dentro del ciclo 2026 (un solo ciclo disponible): no es una comparación entre años.</p>';
        const dd = (v: number | null, dec = 3) => (v == null ? `<span class="sd">${SD}</span>` : signoDelta(v, dec));
        if (a.modo === 'tendencia') {
            const srl = a.tendencias.find((t) => t.id === 'srl') ?? a.tendencias[0];
            const lectura = (t: TendenciaModulo) => (t.confianza === 'clara' ? (t.direccion === 'sube' ? '▲ Al alza' : '▼ A la baja')
                : t.confianza === 'sin-tendencia' ? '■ Sin tendencia clara' : t.confianza === 'descriptiva' ? `Descriptiva (n=${t.n})` : 'S/D');
            const frase = !srl || srl.pendiente == null
                ? 'No hay suficientes meses con dato para describir una tendencia.'
                : srl.confianza === 'clara'
                    ? `${varios ? 'El NDVI medio de la SRL' : esc(srl.etiqueta)} ${srl.direccion === 'sube' ? 'sube' : 'baja'} <b>${Math.abs(srl.pendiente).toFixed(3)}</b> por mes (R² ${fmt(srl.r2, 2)}, n=${srl.n}); pico en ${esc(mesLegible(srl.pico?.mes ?? null))} (${fmt(srl.pico?.valor ?? null, 2)}).`
                    : `Sin tendencia clara en el periodo (${esc(lectura(srl).toLowerCase())}; pendiente ${srl.pendiente >= 0 ? '+' : '−'}${Math.abs(srl.pendiente).toFixed(3)} por mes, R² ${fmt(srl.r2, 2)}, n=${srl.n}).`;
            const filasT = a.tendencias.map((t) => `<tr${t.id === 'srl' ? ' style="font-weight:700"' : ''}><td${t.id === 'srl' ? '' : ` style="border-left:4px solid ${t.color}"`}>${esc(t.etiqueta)}</td>
<td class="n">${t.n}</td><td class="n">${t.pendiente == null ? SD : (t.pendiente >= 0 ? '+' : '−') + Math.abs(t.pendiente).toFixed(3)}</td><td>${lectura(t)}</td><td class="n">${fmt(t.r2, 2)}</td>
<td class="n">${t.pico ? `${fmt(t.pico.valor, 2)} · ${esc(mesLegible(t.pico.mes, true))}` : SD}</td><td class="n">${t.minimo ? `${fmt(t.minimo.valor, 2)} · ${esc(mesLegible(t.minimo.mes, true))}` : SD}</td>
<td class="n">${dd(t.variacion)}</td><td class="n">${t.cv == null ? SD : `${(t.cv * 100).toFixed(0)} %`}</td></tr>`).join('');
            const barras = svgBarrasDelta(a.tendencias.map((t) => ({ etiqueta: t.etiqueta, valor: t.pendiente })), 3);
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Tendencia del NDVI — ${esc(periodoTxt)}</h2>
<p class="frase">${frase}</p>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Módulo</th><th class="n">Meses</th><th class="n">Pendiente (NDVI/mes)</th><th>Lectura</th><th class="n">R²</th><th class="n">Pico</th><th class="n">Mínimo</th><th class="n">Variación</th><th class="n">Estabilidad (CV)</th></tr></thead><tbody>${filasT}</tbody></table></div>
<h3>Pendiente por módulo (NDVI por mes)</h3><figure class="fig" style="margin:0">${barras || '<div class="aviso">Sin pendientes para graficar.</div>'}</figure>
<div class="aviso"><b>Criterio:</b> se declara tendencia solo con al menos ${TENDENCIA_MIN_N} meses con dato, R² ≥ ${TENDENCIA_MIN_R2} y pendiente mayor a ${TENDENCIA_MIN_PENDIENTE} por mes; con menos meses la pendiente es solo descriptiva. La pendiente usa el mes calendario como eje: un mes sin dato no la distorsiona. Estabilidad = desviación entre meses / media (menor es más estable).</div>
${cabNota}`;
        }
        const c = a.comparacion;
        if (c.kind === 'periodos' || c.kind === 'mesVsMes') {
            const m = c.kind === 'mesVsMes' ? 'Mes contra mes' : 'Periodo A contra periodo B';
            const frase = c.promA == null || c.promB == null
                ? 'Alguno de los dos lados no tiene datos: no se puede calcular la diferencia.'
                : `El NDVI medio ${varios ? 'de la SRL ' : ''}pasó de <b>${fmt(c.promA, 2)}</b> (A) a <b>${fmt(c.promB, 2)}</b> (B): ${deltaTexto(c.delta)}${c.pct != null ? ` (${c.pct >= 0 ? '+' : '−'}${Math.abs(c.pct).toFixed(1)} %)` : ''}.${
                    varios && c.mejor && c.peor ? ` Mayor mejora: ${esc(c.mejor.nombre)} (${deltaTexto(c.mejor.delta)}); menor: ${esc(c.peor.nombre)} (${deltaTexto(c.peor.delta)}).` : ''}`;
            const filasC = c.filas.map((f) => `<tr><td><b>${esc(f.nombre)}</b></td><td class="n">${fmt(f.a, 2)}</td><td class="n">${fmt(f.b, 2)}</td><td class="n">${dd(f.delta)}</td><td class="n">${f.pct == null ? SD : `${f.pct >= 0 ? '+' : '−'}${Math.abs(f.pct).toFixed(1)} %`}</td><td class="n">${f.nA} / ${f.nB}</td></tr>`).join('');
            const traslape = c.traslapados ? '<div class="aviso"><b>Atención:</b> los periodos A y B comparten meses; la diferencia subestima el cambio.</div>' : '';
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${m}</h2>
<p class="frase">${frase}</p>${traslape}
<figure class="fig" style="margin:0">${svgPendienteSlope(c.filas.map((f) => ({ etiqueta: f.nombre.replace('Módulo ', 'M'), a: f.a, b: f.b })), c.etiquetaA, c.etiquetaB) || '<div class="aviso">Sin datos para graficar.</div>'}
<figcaption class="fuente">Cada línea une el NDVI medio del módulo en A y en B: continua = sube, punteada = baja, gris = sin cambio (±0.005). Escala 0–0.8.</figcaption></figure>
<div class="pares"><div class="tabla-wrap"><table class="compacta"><caption>Diferencia B − A por módulo</caption><thead><tr><th>Módulo</th><th class="n">A</th><th class="n">B</th><th class="n">Δ</th><th class="n">%</th><th class="n">Meses A/B</th></tr></thead><tbody>${filasC}
<tr style="font-weight:700"><td>Promedio SRL (${esc(baseCorta)})</td><td class="n">${fmt(c.promA, 2)}</td><td class="n">${fmt(c.promB, 2)}</td><td class="n">${dd(c.delta)}</td><td class="n">${c.pct == null ? SD : `${c.pct >= 0 ? '+' : '−'}${Math.abs(c.pct).toFixed(1)} %`}</td><td></td></tr></tbody></table></div>
<figure class="fig" style="margin:0">${svgBarrasDelta(c.filas.map((f) => ({ etiqueta: f.nombre, valor: f.delta })), 3, 420) || ''}</figure></div>
<p class="fuente">A = ${esc(c.etiquetaA)} (${c.mesesA.length} meses) · B = ${esc(c.etiquetaB)} (${c.mesesB.length} meses). Cada lado es el promedio de los meses con dato del módulo; un módulo sin dato en un lado queda S/D.</p>
${cabNota}`;
        }
        if (c.kind === 'modulos') {
            const nd = c.indicadores[0];
            const frase = c.delta == null ? 'No hay datos suficientes para comparar los dos módulos.'
                : `${esc(c.B.nombre)} ${c.delta >= 0 ? 'supera' : 'queda por debajo de'} a ${esc(c.A.nombre)} por <b>${Math.abs(c.delta).toFixed(3)}</b> de NDVI medio en el periodo (${fmt(nd.b, 2)} contra ${fmt(nd.a, 2)}); ${esc(c.A.nombre)} supera a ${esc(c.B.nombre)} en ${c.mesesAMayor} de ${c.mesesComunes} meses.`;
            const filasM = c.meses.map((mes, i) => `<tr><td>${esc(mesLegible(mes, true))}</td><td class="n">${fmt(c.serieA[i], 2)}</td><td class="n">${fmt(c.serieB[i], 2)}</td><td class="n">${c.serieA[i] != null && c.serieB[i] != null ? dd((c.serieB[i] as number) - (c.serieA[i] as number)) : `<span class="sd">${SD}</span>`}</td></tr>`).join('');
            return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${esc(c.A.nombre)} contra ${esc(c.B.nombre)}</h2>
<p class="frase">${frase}</p>
<figure class="fig" style="margin:0">${svgBarrasPareadas(c.indicadores.map((i) => ({ etiqueta: i.etiqueta, a: i.a, b: i.b, max: i.max, decimales: i.decimales })), c.A.nombre, c.B.nombre, c.A.color, c.B.color) || ''}
<figcaption class="fuente">Promedio de cada indicador en el periodo (${esc(periodoTxt)}); cada barra usa la escala de su indicador (NDVI 0–0.8 · ICV/IHR 0–100 · Kc 0–1.05).</figcaption></figure>
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.A.nombre, color: c.A.color, vals: c.serieA }, { etiqueta: c.B.nombre, color: c.B.color, vals: c.serieB, dash: '6 3' }]) || ''}</figure>
<div class="tabla-wrap"><table class="compacta"><caption>NDVI mensual (Δ = ${esc(c.B.nombre)} − ${esc(c.A.nombre)})</caption><thead><tr><th>Mes</th><th class="n">${esc(c.A.nombre)}</th><th class="n">${esc(c.B.nombre)}</th><th class="n">Δ</th></tr></thead><tbody>${filasM}</tbody></table></div>
${cabNota}`;
        }
        // Módulo contra el promedio SRL
        if (c.kind !== 'vsSRL') return '';
        const frase = c.difMedia == null ? 'No hay datos suficientes para comparar el módulo con el promedio SRL.'
            : `${esc(c.modulo.nombre)} ${c.difMedia >= 0 ? 'está por encima' : 'está por debajo'} del promedio SRL por <b>${Math.abs(c.difMedia).toFixed(3)}</b> de NDVI en promedio; supera al promedio SRL en ${c.mesesPorEncima} de ${c.mesesComunes} meses.`;
        return `<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparativo — ${esc(c.modulo.nombre)} contra el promedio SRL</h2>
<p class="frase">${frase}</p>
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.modulo.nombre, color: c.modulo.color, vals: c.serie }, { etiqueta: 'Promedio SRL', color: '#1f2328', vals: c.srl, dash: '6 3', ancho: 2.6 }]) || ''}
<figcaption class="fuente">El promedio SRL es el promedio simple de los 6 módulos (referencia institucional, no depende de los módulos filtrados).</figcaption></figure>
<h3>Diferencia mensual contra el promedio SRL (NDVI)</h3>
<figure class="fig" style="margin:0">${svgBarrasDelta(c.meses.map((mes, i) => ({ etiqueta: mesLegible(mes, true), valor: c.diferencia[i] })), 3) || ''}</figure>
${cabNota}`;
    };
    const hojaE = !hay('E') ? '' : `<section class="pagina">${corrida}<div class="cuerpo">${analisisHtml()}</div>${pie()}</section>`;

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
        '<dt>NDVI</dt><dd>Índice de vegetación de diferencia normalizada, media espacial del polígono exacto de cada módulo (Sentinel-2 L2A, Statistical API).</dd>',
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
<p>Los cambios (Δ) se calculan contra el mes inmediato anterior de toda la serie disponible, aunque quede fuera del periodo elegido.</p></div>
<div><h3>Limitaciones</h3>
<p>• Promedio SRL ${d.basePromedio === 'ponderado' ? '<b>ponderado por superficie</b> (el simple se muestra aparte)' : '<b>simple</b> (cada módulo pesa igual; el ponderado por superficie se muestra aparte)'}.<br>
• ${d.volumenMesParcial ? 'El volumen del mes de referencia es <b>parcial</b>: el IEHP de este corte no es comparable con meses completos.' : 'El volumen entregado proviene de la carga institucional provisional de la SRL, no de la captura operativa diaria.'}<br>
• Un solo ciclo disponible: no hay comparación entre años.<br>
• El NDVI es de un mes calendario cerrado; no describe los últimos días.<br>
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
