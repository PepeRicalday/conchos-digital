/**
 * informeNdviHtml — plantilla PURA del informe institucional de NDVI: (datos, logos, plano) → HTML autónomo.
 * Hoja Carta, 8 páginas con folio y numeración, marrón SRL como único acento de marca; el color de datos es solo la
 * rampa agronómica (ndviRampa.ts) y S/D va en gris. Sin red ni DOM: se prueba con vitest.
 */
import { CLASES_NDVI, NDVI_RANGO, colorNdvi } from './ndviRampa';
import { KC_BASE, KC_MAX, KC_MIN, KC_PENDIENTE } from './kcConstantes';
import { fmt, fmtMiles, SD } from './formato';
import { cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, mesLegible, pieInforme } from './informeBase';
import { svgSerieModulos, svgSparkline } from './informeNdviSvg';
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

function tablaCalor(titulo: string, d: InformeNdvi, valor: (m: ModuloInforme, i: number) => number | null, tinta: (v: number | null) => { bg: string; fg: string }, decimales: number, promedio?: (number | null)[]): string {
    const cab = d.meses.map((m) => `<th class="n">${esc(mesLegible(m, true))}</th>`).join('');
    const celda = (v: number | null) => {
        const t = tinta(v);
        return v == null ? '<td class="n sd" style="background:#eceae5">S/D</td>' : `<td class="n" style="background:${t.bg};color:${t.fg};font-weight:700">${v.toFixed(decimales)}</td>`;
    };
    const filas = d.modulos.map((m) => `<tr><td><b>${esc(m.nombre)}</b></td>${d.meses.map((_, i) => celda(valor(m, i))).join('')}</tr>`).join('');
    const prom = promedio ? `<tr><td><b>Promedio SRL (simple)</b></td>${promedio.map((v) => celda(v)).join('')}</tr>` : '';
    return `<div class="tabla-wrap"><table><caption>${esc(titulo)}</caption><thead><tr><th>Módulo</th>${cab}</tr></thead><tbody>${filas}${prom}</tbody></table></div>`;
}

function leyenda(): string {
    const items = CLASES_NDVI.map((c) => {
        const r = c.desde === -Infinity ? `< ${c.hasta.toFixed(2)}` : c.hasta === Infinity ? `≥ ${c.desde.toFixed(2)}` : `${c.desde.toFixed(2)}–${c.hasta.toFixed(2)}`;
        return `<li><i style="background:${c.color}"></i><b>${esc(c.etiqueta)}</b> <span class="num">${r}</span></li>`;
    }).join('');
    return `<ul class="leyenda" aria-label="Leyenda de vigor vegetativo (NDVI)">${items}<li><i class="hach"></i><b>S/D</b> <span>sin dato</span></li></ul>`;
}

const EXTRA_CSS = `
.run{display:flex;justify-content:space-between;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);border-bottom:1px solid var(--linea);padding-bottom:5px;margin-bottom:10px}
.run b{color:var(--inst)}
.portada .titulo{margin:26mm 0 6mm}
.portada .titulo small{display:block;font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);margin-bottom:6px}
.portada h1{font-size:28pt}
.portada .sub{font:12pt Georgia,serif;color:var(--ink2);margin-top:6px}
.portada .datos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14mm}
.portada .dato{border-top:3px solid var(--inst);padding-top:6px}
.portada .dato b{display:block;font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.portada .dato span{font:600 11pt Georgia,serif}
.portada .nota{margin-top:auto;font-size:8pt;color:var(--ink2)}
.frase{font:11pt/1.45 Georgia,serif;margin:4px 0 8px}
.dist{display:flex;height:16px;border-radius:3px;overflow:hidden;border:1px solid var(--linea);margin:6px 0 2px}
.dist span{display:grid;place-items:center;font-size:7.5pt;font-weight:700;color:#1f2328}
.rank{margin:8px 0}
.rank .fila{display:grid;grid-template-columns:78px 1fr 44px auto;gap:8px;align-items:center;margin:3px 0;font-size:8.5pt}
.rank .barra{height:10px;background:#eceae5;border-radius:2px;overflow:hidden}
.rank .barra i{display:block;height:100%}
.leyenda{display:flex;flex-wrap:wrap;gap:4px 14px;list-style:none;padding:0;margin:8px 0 0;font-size:8pt}
.leyenda li{display:inline-flex;align-items:center;gap:5px}
.leyenda i{width:14px;height:14px;border-radius:2px;border:1px solid rgba(0,0,0,.35);display:inline-block}
.leyenda i.hach{background:repeating-linear-gradient(45deg,#e9e7e2 0 3px,#a8afb7 3px 5px)}
.plano{display:grid;grid-template-columns:1.7fr 1fr;gap:12px;align-items:start}
.plano .lista .fila{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--linea);font-size:8.5pt}
.fichas{display:grid;grid-template-columns:1fr;gap:8px}
.ficha{border:1px solid var(--linea);border-left:5px solid var(--c);border-radius:4px;padding:8px 12px;display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:10px;align-items:center}
.ficha h3{margin:0 0 4px}
.ficha .big{font:700 24pt/1 Georgia,serif}
.ficha dl{margin:0;display:grid;grid-template-columns:auto auto;gap:2px 10px;font-size:8.5pt}
.ficha dt{color:var(--ink2)} .ficha dd{margin:0;text-align:right}
.def dt{font-weight:700;color:var(--inst);margin-top:6px}
.def dd{margin:0 0 2px;color:var(--ink)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media screen and (max-width:720px){.plano,.cols,.ficha{grid-template-columns:1fr}.portada h1{font-size:22pt}.portada .datos{grid-template-columns:1fr}}
`;

export function construirHtmlNdvi(d: InformeNdvi, logos: LogosInforme, plano: string): string {
    const total = 7;
    const ref = d.mesReferencia;
    const refTxt = mesLegible(ref);
    const pie = (n: number) => pieInforme(`Folio ${d.folio} · SICA-005 v${d.version}`, n, total);
    const corrida = `<div class="run"><span><b>S R L Unidad Conchos</b> · Informe institucional NDVI</span><span>${esc(d.folio)} · ${esc(refTxt)}</span></div>`;
    const clasePromedio = d.promedioSimple != null ? CLASES_NDVI.find((c) => d.promedioSimple! >= c.desde && d.promedioSimple! < c.hasta) ?? null : null;

    // ── 1. Portada
    const portada = `<section class="pagina portada">
${cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta: [
        { k: 'Folio', v: d.folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitidoEn) }, { k: 'Emitió', v: d.emisor }, { k: 'Versión', v: `SICA-005 v${d.version}` }] })}
<div class="cuerpo" style="display:flex;flex-direction:column">
  <div class="titulo"><small>Centro de Inteligencia Agroclimática · SICA-005</small>
    <h1>Informe institucional<br>de vigor de cultivos (NDVI)</h1>
    <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · 6 módulos SRL</div></div>
  <div class="datos">
    <div class="dato"><b>Mes de referencia</b><span>${esc(refTxt)}</span></div>
    <div class="dato"><b>Serie histórica</b><span>${esc(mesLegible(d.meses[0] ?? null, true))} – ${esc(mesLegible(ref, true))}</span></div>
    <div class="dato"><b>Cobertura</b><span>${d.modulos.filter((m) => m.tieneDatoDelMes).length} de ${d.modulos.length} módulos con dato</span></div>
  </div>
  ${d.avisos.some((a) => a.nivel === 'warn') ? `<div class="aviso" style="margin-top:10mm"><b>Calidad del dato:</b> este informe tiene ${d.avisos.filter((a) => a.nivel === 'warn').length} advertencia(s); ver página 2.</div>` : ''}
  <p class="nota">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios.<br>Fuente: Sentinel-2 L2A (Copernicus), Statistical API, polígono exacto de cada módulo. Documento generado automáticamente por SICA-005.</p>
</div>
${pie(1)}</section>`;

    // ── 2. Resumen ejecutivo
    const tendTxt = d.tendencia != null ? `${d.tendencia > 0.0005 ? 'sube' : d.tendencia < -0.0005 ? 'baja' : 'sin cambio'} ${Math.abs(d.tendencia).toFixed(3)} frente a ${esc(mesLegible(d.mesAnterior))}` : '';
    const frase = d.promedioSimple == null
        ? 'No hay datos de NDVI suficientes para este corte.'
        : `En ${esc(refTxt)} el NDVI medio de la SRL fue <b>${fmt(d.promedioSimple, 2)}</b>${clasePromedio ? ` (${esc(clasePromedio.etiqueta.toLowerCase())})` : ''}${tendTxt ? `, ${tendTxt}` : ''}. ${
            d.mejor ? `${esc(d.mejor.nombre)} presenta el mayor vigor (${fmt(d.mejor.ndvi, 2)})` : ''}${d.peor ? ` y ${esc(d.peor.nombre)} el menor (${fmt(d.peor.ndvi, 2)})` : ''}.`;
    const maxNdvi = NDVI_RANGO[1];
    const ranking = [...d.modulos].sort((a, b) => (b.ndvi ?? -1) - (a.ndvi ?? -1)).map((m) => `<div class="fila">
    <b>${esc(m.nombre)}</b><span class="barra">${m.ndvi != null ? `<i style="width:${Math.min(100, (m.ndvi / maxNdvi) * 100).toFixed(0)}%;background:${colorNdvi(m.ndvi)}"></i>` : ''}</span>
    <span class="num">${fmt(m.ndvi, 2)}</span>${chipClase(m.clase)}</div>`).join('');
    const distTot = d.distribucion.reduce((s, x) => s + x.modulos.length, 0);
    const dist = distTot ? d.distribucion.filter((x) => x.modulos.length).map((x) => `<span style="flex:${x.modulos.length};background:${x.clase.color};color:${colorTextoSobre(x.clase.color.startsWith('#') ? hexARgb(x.clase.color) : x.clase.color)}" title="${esc(x.clase.etiqueta)}">${x.modulos.length}</span>`).join('') : '';
    const avisosHtml = d.avisos.length
        ? d.avisos.map((a) => `<div class="aviso"><b>${a.nivel === 'warn' ? 'Atención' : 'Nota'}:</b> ${esc(a.texto)}</div>`).join('')
        : '<div class="aviso" style="border-left-color:#13866F;background:#effaf6;color:#0f5a49">Sin advertencias de calidad del dato en este corte.</div>';
    const resumen = `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">1</span>Resumen ejecutivo — ${esc(refTxt)}</h2>
<p class="frase">${frase}</p>
<div class="kpis">
  <div class="kpi"><div class="et">Promedio SRL (simple)</div><div class="v">${fmt(d.promedioSimple, 2)}</div><div class="s">${chipClase(clasePromedio)}<br>Ponderado por superficie: ${fmt(d.promedioPonderado, 2)}</div></div>
  <div class="kpi"><div class="et">Mayor vigor</div><div class="v">${d.mejor ? fmt(d.mejor.ndvi, 2) : SD}</div><div class="s">${d.mejor ? esc(d.mejor.nombre) : ''}</div></div>
  <div class="kpi"><div class="et">Menor vigor</div><div class="v">${d.peor ? fmt(d.peor.ndvi, 2) : SD}</div><div class="s">${d.peor ? esc(d.peor.nombre) : ''}</div></div>
  <div class="kpi"><div class="et">Tendencia vs mes anterior</div><div class="v">${deltaTexto(d.tendencia, 2)}</div><div class="s">${d.mesAnterior ? esc(mesLegible(d.mesAnterior)) : 'Sin mes anterior'}</div></div>
</div>
<h3>Distribución de módulos por clase de vigor</h3>
<div class="dist" role="img" aria-label="Distribución de módulos por clase de NDVI">${dist || '<span style="flex:1;background:#eceae5" class="sd">S/D</span>'}</div>
<div class="fuente">Número de módulos en cada clase (de ${distTot} con dato).</div>
<h3>Ranking de módulos</h3>
<div class="rank">${ranking}</div>
<h3>Cómo leer las clases de vigor</h3>
<div class="tabla-wrap"><table><thead><tr><th>Clase</th><th class="n">NDVI</th><th>Qué indica</th><th class="n">Módulos</th></tr></thead><tbody>${d.distribucion.map((x) => {
        const c = x.clase;
        const r = c.desde === -Infinity ? `< ${c.hasta.toFixed(2)}` : c.hasta === Infinity ? `≥ ${c.desde.toFixed(2)}` : `${c.desde.toFixed(2)}–${c.hasta.toFixed(2)}`;
        return `<tr><td>${chipClase(c)}</td><td class="n">${r}</td><td>${esc(c.significado)}</td><td class="n">${x.modulos.length ? x.modulos.map((n) => `M${n}`).join(', ') : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>
<h3>Calidad del dato</h3>
${avisosHtml}
</div>${pie(2)}</section>`;

    // ── 3. Plano general
    const planoBloque = plano
        ? `<figure class="fig" style="margin:0">${plano}<figcaption class="fuente">Fuente: Sentinel-2 L2A · NDVI medio del mes por polígono exacto de cada módulo · ${esc(refTxt)}.</figcaption></figure>`
        : '<div class="aviso"><b>Plano no disponible:</b> no se pudieron cargar los contornos de los módulos al generar el informe.</div>';
    const planoPag = `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">2</span>Plano general — NDVI ${esc(refTxt)}</h2>
<div class="plano"><div>${planoBloque}${leyenda()}</div>
<div class="lista"><h3>Módulos</h3>${d.modulos.map((m) => `<div class="fila"><span><b>${esc(m.nombre)}</b> ${chipClase(m.clase)}</span><span class="num">${fmt(m.ndvi, 2)}</span></div>`).join('')}
<p class="fuente" style="margin-top:8px">Relleno = clase de NDVI del mes. Gris hachurado = sin dato. Promedio SRL simple: ${fmt(d.promedioSimple, 2)}.</p></div></div>
</div>${pie(3)}</section>`;

    // ── 4-5. Fichas por módulo (3 por página)
    const ficha = (m: ModuloInforme) => `<div class="ficha" style="--c:${m.color}">
  <div><h3>${esc(m.nombre)}</h3>${chipClase(m.clase)}${m.tieneDatoDelMes ? '' : '<div class="sd" style="margin-top:4px">Sin dato en ' + esc(refTxt) + '</div>'}</div>
  <div><div class="big">${fmt(m.ndvi, 2)}</div><div class="fuente">NDVI · ${deltaTexto(m.delta)} vs mes ant.</div><div style="margin-top:4px">${svgSparkline(m.serieNdvi)}</div></div>
  <dl><dt>Kc estimado</dt><dd class="num">${fmt(m.kc, 2)}</dd><dt>Superficie (ha)</dt><dd class="num">${fmtMiles(m.superficieHa, 0)}</dd>
  <dt>ICV (0–100)</dt><dd class="num">${fmt(m.icv, 0)} <span class="sd">${m.icv != null ? esc(m.icvEtiqueta) : ''}</span></dd>
  <dt>IHR (0–100)</dt><dd class="num">${fmt(m.ihr, 0)}</dd><dt>IEHP (ha/hm³)</dt><dd class="num">${fmt(m.iehp, 1)}</dd></dl></div>`;
    const fichasPag = (pag: number) => `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">3</span>Fichas por módulo — ${esc(refTxt)}</h2>
<div class="fichas">${d.modulos.map(ficha).join('')}</div>
<p class="fuente">Sparkline: NDVI mensual en la serie disponible (escala 0–0.8, igual en todos los módulos). Δ = diferencia contra el mes anterior con dato del mismo módulo.</p>
</div>${pie(pag)}</section>`;

    // ── 6. Serie histórica
    const serie = `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">4</span>Serie histórica — ${esc(mesLegible(d.meses[0] ?? null))} a ${esc(refTxt)}</h2>
<figure class="fig" style="margin:0">${svgSerieModulos(d.meses, d.modulos, d.promedioPorMes) || '<div class="aviso">Sin serie para graficar.</div>'}
<figcaption class="fuente">NDVI medio mensual por módulo; línea punteada = promedio SRL simple. Escala vertical 0–0.8.</figcaption></figure>
${tablaCalor('NDVI mensual por módulo', d, (m, i) => m.serieNdvi[i], (v) => (v == null ? { bg: '#eceae5', fg: '#8c959f' } : { bg: colorNdvi(v), fg: colorTextoSobre(colorNdvi(v)) }), 2, d.promedioPorMes)}
<div class="fuente">Color de cada celda = clase de NDVI (misma leyenda del plano). S/D = el módulo no tiene fila ese mes.</div>
${leyenda()}
</div>${pie(5)}</section>`;

    // ── 7. Metodología
    const p = d.parametros;
    const metodologia = `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">5</span>Metodología, glosario y limitaciones</h2>
<div class="cols"><div><h3>Definiciones</h3><dl class="def">
<dt>NDVI</dt><dd>Índice de vegetación de diferencia normalizada, media espacial del polígono exacto de cada módulo (Sentinel-2 L2A, Statistical API).</dd>
<dt>Kc estimado</dt><dd>Aproximación lineal NDVI→Kc: ${KC_BASE.toFixed(2)} + ${KC_PENDIENTE.toFixed(2)}·NDVI, acotado a ${KC_MIN.toFixed(2)}–${KC_MAX.toFixed(2)}.</dd>
<dt>ICV (0–100)</dt><dd>Condición vegetativa: escala lineal del NDVI con piso ${p.ndviPiso.toFixed(2)} (suelo desnudo) y techo ${p.ndviTecho.toFixed(2)} (vigor pleno).</dd>
<dt>IHR (0–100)</dt><dd>Homogeneidad de riego: 100×(1 − desviación/media) del NDVI dentro del módulo.</dd>
<dt>IEHP (ha/hm³)</dt><dd>Hectáreas con cobertura activa (NDVI ≥ ${p.umbralActivo.toFixed(2)}) por hm³ entregado acumulado del ciclo.</dd></dl></div>
<div><h3>Método</h3>
<p>Ventana de cálculo: ${esc(d.ventana.desde ?? 'S/D')} a ${esc(d.ventana.hasta ?? 'S/D')} (mes calendario cerrado). Filtro de nubosidad: ≤ ${d.nubosidadMaxPct != null ? d.nubosidadMaxPct.toFixed(0) : 'S/D'} %. Resolución nativa 10 m.</p>
<p>Clases de vigor: ${CLASES_NDVI.map((c) => esc(c.etiqueta)).join(' · ')} (límites 0.15 / 0.30 / 0.50 / 0.70).</p>
<h3>Limitaciones</h3>
<p>• El promedio SRL es <b>simple</b> (cada módulo pesa igual); el ponderado por superficie se muestra aparte.<br>
• ${d.volumenMesParcial ? `El volumen del mes de referencia es <b>parcial</b>: el IEHP de este corte no es comparable con meses completos.` : 'El volumen entregado proviene de la carga institucional provisional de la SRL, no de la captura operativa diaria.'}<br>
• El NDVI es de un mes calendario cerrado; no describe la condición de los últimos días.<br>
• IEH (estrés hídrico) e ISH (satisfacción hídrica) requieren ETa y temperatura superficial satelital: pendientes para una fase posterior.<br>
• Un módulo sin dato del mes aparece como S/D; no se sustituye con otro mes.</p></div></div>
<div class="aviso"><b>Uso del documento:</b> producto de apoyo a la decisión. No sustituye aforos ni mediciones oficiales en campo.</div>
</div>${pie(6)}</section>`;

    // ── 8. Anexo de datos
    const filasAnexo = d.modulos.map((m) => `<tr><td style="border-left:4px solid ${m.color}"><b>${esc(m.nombre)}</b></td>
<td class="n">${fmt(m.ndvi, 2)}</td><td>${chipClase(m.clase)}</td><td class="n">${m.delta == null ? SD : (m.delta >= 0 ? '+' : '−') + Math.abs(m.delta).toFixed(3)}</td>
<td class="n">${fmtMiles(m.superficieHa, 0)}</td><td class="n">${fmt(m.kc, 2)}</td><td class="n">${fmt(m.icv, 0)}</td><td class="n">${fmt(m.ihr, 0)}</td><td class="n">${fmt(m.iehp, 1)}</td></tr>`).join('');
    const anexo = `<section class="pagina">${corrida}<div class="cuerpo">
<h2><span class="n">6</span>Anexo de datos — ${esc(refTxt)}</h2>
<div class="tabla-wrap"><table><thead><tr><th>Módulo</th><th class="n">NDVI</th><th>Clase</th><th class="n">Δ NDVI</th><th class="n">Superficie (ha)</th><th class="n">Kc</th><th class="n">ICV</th><th class="n">IHR</th><th class="n">IEHP</th></tr></thead><tbody>${filasAnexo}
<tr><td><b>Promedio SRL (simple)</b></td><td class="n"><b>${fmt(d.promedioSimple, 2)}</b></td><td></td><td></td><td></td><td></td><td class="n"><b>${fmt(d.promedioIcv, 0)}</b></td><td class="n"><b>${fmt(d.promedioIhr, 0)}</b></td><td></td></tr></tbody></table></div>
${tablaCalor('ICV mensual (0–100)', d, (m, i) => m.serieIcv[i], tintaMarron, 0)}
${tablaCalor('IHR mensual (0–100)', d, (m, i) => m.serieIhr[i], tintaMarron, 0)}
<div class="fuente">ICV e IHR mensuales se recalculan con el NDVI de cada mes (el IEHP solo se reporta en el corte de referencia). Tinta marrón = mayor valor.</div>
</div>${pie(7)}</section>`;

    return documentoHtml({
        titulo: `Informe institucional NDVI — SRL Unidad Conchos — ${refTxt}`,
        css: cssInforme({ formato: 'letter' }) + EXTRA_CSS,
        cuerpo: [portada, resumen, planoPag, fichasPag(4), serie, metodologia, anexo].join('\n'),
    });
}

function hexARgb(h: string): string {
    return `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`;
}

