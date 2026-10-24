/**
 * informeNdviInteranualHtml — gráficos SVG y plantilla PURA del informe NDVI en modo INTERANUAL (modelo, logos) → HTML autónomo.
 * Hojas: A portada + resumen + pulso general · B un recuadro por módulo · C superficie/volumen/vegetación · D metodología y límites.
 * Marrón SRL = año de interés (acento de marca); los demás años, un solo matiz azul de claro a oscuro (más reciente = más oscuro);
 * cada línea lleva su año escrito al final, así que no depende del color. S/D en gris itálico, nunca 0.
 */
import { fmt, fmtMiles, SD } from './formato';
import { SRL_MARRON, cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, pieInforme } from './informeBase';
import { ETIQUETA_MES, MESES_TEMPORADA, MIN_MESES_ANIO_COMPLETO, UMBRAL_SIN_CAMBIO } from './ndviInteranual';
import { NDVI_RANGO, NDVI_TICKS } from './ndviRampa';
import type { ModeloInteranual, ModuloInteranual } from './informeNdviInteranual';
import type { LogosInforme } from './informeNdviHtml';
import { cabeceraSvg } from './informeNdviSvgComparativo';

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
const RAMPA_PREVIOS = ['#b4c7de', '#8fabcc', '#6a8db8', '#4a6f9c', '#2f527f'];
const NDVI_MAX = NDVI_RANGO[1];
const f1 = (n: number) => n.toFixed(1);

export const colorPrevioImpreso = (i: number, total: number): string => {
    const n = RAMPA_PREVIOS.length;
    return RAMPA_PREVIOS[total <= 1 ? n - 1 : Math.min(n - 1, Math.round((i / (total - 1)) * (n - 1)))];
};

const sdSpan = `<span class="sd">${SD}</span>`;
const celda = (txt: string) => (txt === SD ? sdSpan : esc(txt));
const signo = (v: number, d: number) => `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v).toFixed(d)}`;

interface OpcionesPulso { w: number; h: number; mini?: boolean }

/** Pulso estacional: banda típica (p10–p90) detrás, años previos finos con su etiqueta, año de interés grueso en marrón SRL. */
export function svgPulso(m: { anios: number[]; anioFoco: number; series: { anio: number; vals: (number | null)[] }[]; clim: { media: number | null; p10: number | null; p90: number | null }[]; titulo: string }, o: OpcionesPulso): string {
    const { w, h } = o;
    const L = o.mini ? 26 : 34, R = o.mini ? 30 : 38, T = 8, B = o.mini ? 18 : 22;
    const x = (i: number) => L + (i * (w - L - R)) / (MESES_TEMPORADA.length - 1);
    const y = (v: number) => T + (1 - Math.min(NDVI_MAX, Math.max(0, v)) / NDVI_MAX) * (h - T - B);
    const fs = o.mini ? 8 : 9;
    const camino = (vals: (number | null)[]) => {
        let d = '', pen = false;
        vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        return d;
    };
    const grid = NDVI_TICKS.map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 4}" y="${f1(y(t) + 3)}" text-anchor="end" font-size="${fs}" fill="${INK2}" ${FONT}>${t.toFixed(1)}</text>`).join('');
    const ejeX = MESES_TEMPORADA.map((mm, i) => `<text x="${f1(x(i))}" y="${h - 5}" text-anchor="middle" font-size="${fs}" fill="${INK2}" ${FONT}>${ETIQUETA_MES[mm]}</text>`).join('');
    const conBanda = m.clim.length > 0 && m.clim.every((c) => c.p10 != null && c.p90 != null);
    const banda = conBanda
        ? `<path d="M${m.clim.map((c, i) => `${f1(x(i))} ${f1(y(c.p90 as number))}`).join(' L')} L${[...m.clim].reverse().map((c, k) => `${f1(x(m.clim.length - 1 - k))} ${f1(y(c.p10 as number))}`).join(' L')} Z" fill="#d9d6cf" opacity="0.8"/>`
        : '';
    const prom = m.clim.some((c) => c.media != null) ? `<path d="${camino(m.clim.map((c) => c.media))}" fill="none" stroke="${INK2}" stroke-width="1.2" stroke-dasharray="4 3"/>` : '';
    const previos = m.series.filter((s) => s.anio !== m.anioFoco);
    const lineas = previos.map((s, i) => {
        const c = colorPrevioImpreso(i, previos.length);
        return `<path d="${camino(s.vals)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`;
    }).join('');
    const foco = m.series.find((s) => s.anio === m.anioFoco);
    const lineaFoco = foco ? `<path d="${camino(foco.vals)}" fill="none" stroke="${SRL_MARRON}" stroke-width="2.8" stroke-linejoin="round"/>${
        foco.vals.map((v, i) => (v == null ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="3" fill="${SRL_MARRON}" stroke="#fff" stroke-width="1"/>`)).join('')}` : '';
    // Etiqueta del año al final de cada línea (último mes con dato), separadas verticalmente para que no se encimen.
    const fin = m.series.map((s) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { anio: s.anio, xx: x(i), yy: y(s.vals[i] as number) }; })
        .filter((s): s is { anio: number; xx: number; yy: number } => !!s).sort((p, q) => p.yy - q.yy);
    for (let k = 1; k < fin.length; k++) if (fin[k].yy - fin[k - 1].yy < fs + 2) fin[k].yy = fin[k - 1].yy + fs + 2;
    const etiquetas = fin.map((s) => `<text x="${f1(s.xx + 5)}" y="${f1(s.yy + 3)}" font-size="${fs + 0.5}" ${s.anio === m.anioFoco ? `font-weight="700" fill="${SRL_MARRON}"` : `fill="${INK}"`} ${FONT}>${s.anio}</text>`).join('');
    const picos = m.series.map((s) => { const v = s.vals.filter((x): x is number => x != null); return v.length ? `${s.anio}: pico ${Math.max(...v).toFixed(3)}` : `${s.anio}: S/D`; }).join('; ');
    const cab = cabeceraSvg(m.titulo, picos);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" ${cab.attrs}>${cab.tags}${grid}${ejeX}${banda}${prom}${lineas}${lineaFoco}${etiquetas}</svg>`;
}

const EXTRA_CSS = `
.run{display:flex;justify-content:space-between;font-size:7.5pt;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);border-bottom:1px solid var(--linea);padding-bottom:4px;margin-bottom:8px}
.run b{color:var(--inst)}
.cuerpo{min-width:0}
.banda{margin:2mm 0 4mm}
.banda small{display:block;font-size:8pt;color:var(--ink2);margin-bottom:3px}
.banda h1{font-size:20pt}
.banda .sub{font:10pt Georgia,serif;color:var(--ink2);margin-top:2px}
.datos{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:4mm 0 3mm}
.dato{border-top:3px solid var(--inst);padding-top:4px}
.dato b{display:block;font-size:8pt;color:var(--ink2)}
.dato span{font:600 10pt Georgia,serif}
.frase{font:10.5pt/1.4 Georgia,serif;margin:2px 0 6px;font-variant-numeric:lining-nums}
.dato span,.kpi .v{font-variant-numeric:lining-nums}
.nota-pie{margin-top:6px;font-size:7.5pt;color:var(--ink2)}
.aviso.frontera{border-left-color:#2f527f;background:#eef3f9;color:#1f3550;border-color:#c7d5e6}
.aviso.frontera b{color:#1f3550}
table.compacta{font-size:7.5pt} table.compacta th{padding:3px 5px;font-size:7pt} table.compacta td{padding:2px 5px}
table.compacta tr.foco td,table.compacta tr.foco th{background:#f4eaea}
.mods{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mod{border:1px solid var(--linea);border-top:4px solid var(--c);border-radius:3px;padding:6px 8px;break-inside:avoid}
.mod h3{margin:0 0 2px;font-size:9.5pt;display:flex;justify-content:space-between}
.mod .lect{font-size:8pt;line-height:1.35;color:var(--ink);margin:2px 0 4px}
.mod dl{margin:3px 0 0;display:grid;grid-template-columns:auto auto;gap:1px 8px;font-size:7.5pt}
.mod dt{color:var(--ink2)} .mod dd{margin:0;text-align:right}
.ley{display:flex;flex-wrap:wrap;gap:3px 14px;list-style:none;padding:0;margin:4px 0 0;font-size:7.5pt}
.ley li{display:inline-flex;align-items:center;gap:5px}
.ley i{display:inline-block;width:18px;height:3px}
.ley i.b{height:9px;background:#d9d6cf} .ley i.p{height:0;border-top:1.5px dashed ${INK2};background:none}
.cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:8.5pt}
.def dt{font-weight:700;color:var(--inst);margin-top:5px} .def dd{margin:0 0 2px}
@media screen and (max-width:720px){.mods,.cols3{grid-template-columns:1fr}.datos{grid-template-columns:1fr 1fr}.banda h1{font-size:16pt}}
`;

const leyenda = (anios: number[], foco: number, conBanda: boolean, conPromedio = true): string => {
    const prev = anios.filter((a) => a !== foco);
    return `<ul class="ley" aria-label="Leyenda de años">${prev.map((a, i) => `<li><i style="background:${colorPrevioImpreso(i, prev.length)}"></i>${a}</li>`).join('')}<li><i style="background:${SRL_MARRON};height:4px"></i><b>${foco}</b></li>${conPromedio ? '<li><i class="p"></i>Promedio de los otros años</li>' : ''}${conBanda ? '<li><i class="b"></i>Banda típica (p10–p90)</li>' : ''}</ul>`;
};

export function construirHtmlInteranual(d: ModeloInteranual, logos: LogosInforme, hoja: 'letter' | 'a4' = 'letter'): string {
    const foco = d.anioFoco;
    const rango = `${d.anios[0]}–${foco}`;
    const varios = d.modulos.length > 1;
    let pagina = 0, nSec = 0;
    const total = 4;
    const pie = () => pieInforme(`Folio ${d.folio} · SICA-005 v${d.version}`, ++pagina, total);
    const corrida = `<div class="run"><span><b>S R L Unidad Conchos</b> · Informe institucional NDVI · Comparativo interanual</span><span>${esc(d.folio)} · ${esc(rango)}</span></div>`;
    const conBandaGlobal = d.modulos.some((m) => m.clim.every((c) => c.p10 != null && c.p90 != null));

    // ── Hoja A
    const sinRef = d.conteo.arriba + d.conteo.abajo + d.conteo.similar === 0;
    const pFoco = d.picoSrlPorAnio.find((p) => p.anio === foco);
    const fraseResumen = sinRef
        ? `No hay datos suficientes para comparar ${foco} contra los otros años elegidos (S/D).`
        : `En ${foco}, ${d.conteo.arriba} de ${d.modulos.length} ${varios ? 'módulos van' : 'módulo va'} por encima del promedio de pico de sus otros años, ${d.conteo.abajo} por debajo y ${d.conteo.similar} en línea${d.conteo.sd ? ` (${d.conteo.sd} sin dato)` : ''}.${
            d.mayorAlza ? ` Mayor alza: Módulo ${d.mayorAlza.modulo} (${signo(d.mayorAlza.abs, 3)}).` : ''}${d.mayorBaja ? ` Mayor baja: Módulo ${d.mayorBaja.modulo} (${signo(d.mayorBaja.abs, 3)}).` : ''}`;
    const filaPico = (a: number, i: number) => `<tr${a === foco ? ' class="foco"' : ''}><th scope="row" style="text-align:left;background:none;color:inherit;text-transform:none;font-size:7.5pt">${a}</th>${
        d.modulos.map((m) => `<td class="n">${celda(fmt(m.resumenes[i].pico, 3))}${m.resumenes[i].pocoConfiables.length ? ' ⚠' : ''}</td>`).join('')}<td class="n"><b>${celda(fmt(d.picoSrlPorAnio[i].pico, 3))}</b>${d.picoSrlPorAnio[i].pico != null && d.picoSrlPorAnio[i].n < d.modulos.length ? ` <small>(${d.picoSrlPorAnio[i].n} de ${d.modulos.length})</small>` : ''}</td></tr>`;
    const filaAn = `<tr><th scope="row" style="text-align:left;background:none;color:inherit;text-transform:none;font-size:7.5pt">${foco} vs otros años</th>${
        d.modulos.map((m) => `<td class="n">${m.lectura.anomalia ? esc(signo(m.lectura.anomalia.abs, 3)) : sdSpan}</td>`).join('')}<td class="n">${sdSpan}</td></tr>`;
    const tablaPico = `<div class="tabla-wrap"><table class="compacta"><caption>Pico de NDVI por año y módulo (temporada marzo–septiembre)</caption><thead><tr><th>Año</th>${
        d.modulos.map((m) => `<th class="n" style="border-bottom:3px solid ${m.color}">M${m.numero}</th>`).join('')}<th class="n">Promedio${varios ? ' SRL' : ''}</th></tr></thead><tbody>${d.anios.map(filaPico).join('')}${filaAn}</tbody></table></div>
<p class="fuente">Pico = mes de mayor NDVI de la temporada. Promedio = promedio simple de los módulos con dato. ▲▼ = pico de ${foco} menos el promedio de pico de los otros años elegidos. ⚠ = algún mes con menos de 2 pasos de satélite limpios o menos de la mitad de píxeles válidos.</p>`;
    const graficaSrl = svgPulso({ anios: d.anios, anioFoco: foco, series: d.serieSrl, clim: [], titulo: 'NDVI medio mensual de los módulos elegidos, por año' }, { w: 620, h: 170 });
    const hojaA = `<section class="pagina">${cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta: [
        { k: 'Folio', v: d.folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitidoEn) }, { k: 'Emitió', v: d.emisor }, { k: 'Versión', v: `SICA-005 v${d.version}` }] })}
<div class="cuerpo"><div class="banda"><small>Centro de Inteligencia Agroclimática · SICA-005</small>
  <h1>Comparativo interanual de vigor de cultivos (NDVI)</h1>
  <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · ${d.modulos.length} ${d.modulos.length === 1 ? 'módulo' : 'módulos'} SRL · temporada marzo–septiembre</div></div>
<div class="datos">
  <div class="dato"><b>Años comparados</b><span>${esc(d.anios.join(', '))}</span></div>
  <div class="dato"><b>Año de interés</b><span>${foco}</span></div>
  <div class="dato"><b>Pico NDVI medio ${foco}</b><span>${celda(fmt(pFoco?.pico ?? null, 3))}</span></div>
  <div class="dato"><b>Módulos</b><span>${d.modulos.map((m) => `M${m.numero}`).join(' · ')}</span></div>
</div>
<h2><span class="n">${++nSec}</span>Resumen ejecutivo</h2>
<p class="frase">${fraseResumen}</p>
<div class="aviso frontera"><b>Cómo leer este NDVI:</b> se mide sobre la frontera completa de cada módulo (incluye caminos, canales y suelo sin riego). Sirve para comparar un año contra otro en el mismo módulo; no es el NDVI de una parcela.</div>
${tablaPico}
<h3>Pulso de la temporada${varios ? ' (promedio de los módulos elegidos)' : ''}</h3>
<figure class="fig" style="margin:0">${graficaSrl}${leyenda(d.anios, foco, false, false)}</figure>
<p class="nota-pie">Fuente: Sentinel-2 L2A (Copernicus), máscara de nubes por píxel y mediana mensual; polígono exacto de cada módulo. Documento de apoyo a la decisión; no sustituye aforos ni mediciones oficiales en campo.</p>
</div>${pie()}</section>`;

    // ── Hoja B: un recuadro por módulo
    const recuadro = (m: ModuloInteranual) => {
        const r = m.resumenes[m.resumenes.length - 1];
        return `<div class="mod" style="--c:${m.color}"><h3><span>${esc(m.nombre)}</span><span class="num">${celda(fmt(r.pico, 3))}</span></h3>
<p class="lect">${esc(m.lectura.texto)}</p>
${svgPulso({ anios: d.anios, anioFoco: foco, series: m.series, clim: m.clim, titulo: `${m.nombre}: NDVI mensual por año` }, { w: 300, h: 118, mini: true })}
<dl><dt>Pico ${foco}</dt><dd class="num">${celda(fmt(r.pico, 3))}${r.mesPico ? ` · ${esc(r.mesPico)}` : ''}</dd><dt>Media ${foco}</dt><dd class="num">${celda(fmt(r.media, 3))}</dd><dt>Meses con dato ${foco}</dt><dd class="num">${r.mesesConDato}/${MESES_TEMPORADA.length}</dd></dl></div>`;
    };
    const hojaB = `<section class="pagina">${corrida}<div class="cuerpo"><h2 style="margin-top:0"><span class="n">${++nSec}</span>Un año contra los demás, módulo por módulo</h2>
<div class="mods">${d.modulos.map(recuadro).join('')}</div>
${leyenda(d.anios, foco, conBandaGlobal, d.modulos.some((m) => m.clim.some((c) => c.media != null)))}
<p class="fuente">Escala vertical 0–0.8 igual en todos los recuadros. La banda típica (zona gris) y el promedio punteado se calculan con los otros años elegidos, sin ${foco}; con menos de tres años no se dibuja banda.</p>
</div>${pie()}</section>`;

    // ── Hoja C: superficie, volumen y vegetación
    const matriz = (titulo: string, valor: (c: ModuloInteranual['cruce'][number]) => string, nota: string) => `<div class="tabla-wrap"><table class="compacta"><caption>${esc(titulo)}</caption><thead><tr><th>Módulo</th>${
        d.anios.map((a) => `<th class="n">${a}</th>`).join('')}</tr></thead><tbody>${d.modulos.map((m) => `<tr><td style="border-left:4px solid ${m.color}"><b>${esc(m.nombre)}</b></td>${
        m.cruce.map((c) => `<td class="n">${celda(valor(c))}${c.atipicos > 0 ? ' ⚠' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${nota ? `<p class="fuente">${nota}</p>` : ''}`;
    const ultimoSup = d.modulos.flatMap((m) => m.cruce).filter((c) => c.volumenHm3 != null).reduce<number | null>((mx, c) => (mx == null || c.anio > mx ? c.anio : mx), null);
    const hojaC = `<section class="pagina">${corrida}<div class="cuerpo"><h2 style="margin-top:0"><span class="n">${++nSec}</span>Superficie, volumen y vegetación</h2>
<p class="frase">¿Se entregó más agua por hectárea en los años de mayor vegetación? La tabla permite verlo año contra año; ${ultimoSup != null ? `el informe de superficie y volumen cubre hasta ${ultimoSup}.` : 'ninguno de los años elegidos tiene informe de superficie y volumen (S/D).'}</p>
${matriz('Superficie regada (ha)', (c) => fmtMiles(c.superficieHa, 0), 'Informe de distribución al corte de septiembre (ACUM_INF), suma de cultivos; el volumen está en miles de m³ convertidos a hm³ y la lámina es volumen dividido entre superficie del mismo informe.')}
${matriz('Volumen entregado (hm³)', (c) => fmt(c.volumenHm3, 1), '')}
${matriz('Lámina entregada (m³ por hectárea)', (c) => fmtMiles(c.laminaM3Ha, 0), '')}
${matriz('Media de NDVI de la temporada (mar–sep)', (c) => fmt(c.mediaNdvi, 3), `Media = promedio de los meses con dato de marzo a septiembre; se usa la media y no el pico porque dentro de cada módulo la media acompaña al volumen entregado y el pico no. Una temporada con menos de ${MIN_MESES_ANIO_COMPLETO} meses con dato (p. ej. el año en curso) no es comparable con un año completo.`)}
<div class="aviso"><b>Lectura con cuidado:</b> S/D = ese año no tiene informe de superficie y volumen cargado${d.aniosSinSupVol.length ? ` (${d.aniosSinSupVol.join(' y ')})` : ''} o no tiene NDVI${d.aniosSinNdvi.length ? ` (${d.aniosSinNdvi.join(' y ')})` : ''}; no se rellena ni se estima. ⚠ = algún renglón de cultivo con captura atípica en el informe fuente, sumado sin corregir. La comparación es descriptiva: más lámina y más vegetación el mismo año no prueban relación causal.</div>
</div>${pie()}</section>`;

    // ── Hoja D: metodología y límites
    const hojaD = `<section class="pagina">${corrida}<div class="cuerpo"><h2 style="margin-top:0"><span class="n">${++nSec}</span>Metodología, glosario y limitaciones</h2>
<div class="cols3"><div><h3>Definiciones</h3><dl class="def">
<dt>NDVI</dt><dd>Índice de vegetación de diferencia normalizada; mediana mensual de los píxeles limpios del polígono de cada módulo (Sentinel-2 L2A).</dd>
<dt>Pico</dt><dd>Mayor NDVI mensual de la temporada marzo–septiembre.</dd>
<dt>Banda típica</dt><dd>Rango entre el percentil 10 y el 90 de cada mes en los otros años elegidos (exige al menos tres).</dd>
<dt>Lámina</dt><dd>Volumen entregado entre superficie regada (m³/ha).</dd></dl></div>
<div><h3>Método</h3>
<p>Años elegidos: ${esc(d.anios.join(', '))}; año de interés: ${foco}. Serie homogénea desde marzo de 2021: máscara de nubes por píxel (SCL) y mediana mensual, la misma regla en todos los años.</p>
<p>La lectura en palabras compara el pico del año de interés contra el promedio de pico de los otros años elegidos (si su temporada está incompleta, la media de los mismos meses); una diferencia menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)} (cerca de media desviación entre años) se reporta como "en línea".</p>
<p>La superficie y el volumen salen del informe anual de distribución (ACUM_INF) al corte de septiembre; la correspondencia año del informe ↔ temporada de NDVI se toma año calendario a año calendario.</p></div>
<div><h3>Limitaciones</h3>
<p>• El NDVI es de la frontera del módulo, no de la parcela: compara años entre sí, no mide un cultivo.<br>
• Un mes con pocas escenas limpias se dibuja pero se marca ⚠; no se descarta.<br>
• ${d.aniosSinNdvi.length ? `${d.aniosSinNdvi.join(' y ')} sin NDVI` : 'Todos los años elegidos tienen NDVI'}${d.aniosSinSupVol.length ? `; ${d.aniosSinSupVol.join(' y ')} sin informe de superficie y volumen` : ''}: lo que falta se muestra S/D.<br>
• Renglones atípicos del informe fuente: se suman tal cual y se marcan.<br>
• Con menos de tres años no hay banda típica ni tendencia.<br>
• Una diferencia entre años puede deberse a calendario de siembra, nubes o clima, no solo al riego.<br>
• Que un año quede por debajo o por encima de lo habitual es una lectura descriptiva: no se explica solo por el volumen entregado y puede reflejar la programación del riego, el cierre del ciclo el 29 de septiembre o más pasos de satélite.</p></div></div>
${d.avisos.length ? `<h3>Avisos de este informe</h3>${d.avisos.slice(0, 8).map((a) => `<div class="aviso">${esc(a)}</div>`).join('')}${d.avisos.length > 8 ? `<p class="fuente">+ ${d.avisos.length - 8} aviso(s) más sobre meses con pocas observaciones.</p>` : ''}` : ''}
<div class="aviso"><b>Uso del documento:</b> producto de apoyo a la decisión. No sustituye aforos ni mediciones oficiales en campo.</div>
</div>${pie()}</section>`;

    return documentoHtml({
        titulo: `Comparativo interanual NDVI — SRL Unidad Conchos — ${rango}`,
        css: cssInforme({ formato: hoja }) + EXTRA_CSS,
        cuerpo: [hojaA, hojaB, hojaC, hojaD].join('\n'),
    });
}
