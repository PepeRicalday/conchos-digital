/**
 * informeNdviHtml — plantilla PURA del informe técnico integrado de NDVI: (datos, logos, plano) → HTML autónomo.
 * UN solo documento con alcance configurable. Orden: hoja 1 = portada + RESUMEN EJECUTIVO (titular con su cautela, hallazgos,
 * estado por clase de vigor, qué revisar) · situación del periodo · tendencia y contraste · comparación entre años ·
 * comparación entre módulos (opcional) · módulo por módulo · anexos (serie, superficie y volumen, metodología, trazabilidad y firmas).
 * Las hojas se arman en una lista y "Pág. n de N" se calcula con las hojas realmente armadas. Marrón SRL = marca;
 * el color de datos es la rampa agronómica (ndviRampa.ts) y S/D va en gris. Sin red ni DOM: se prueba con vitest.
 */
import { CLASES_NDVI, NDVI_RANGO, claseNdvi, colorClaseNdvi, tintaSobre } from './ndviRampa';
import { CSS_MARCAS, PASOS_TINTA, colorPasoTinta, defsMarcadoresHtml, leyendaSistemaVisual, monogramaHtml } from './informeNdviMarcas';
import { miniPlanoModuloSvg, type Contornos } from './informeNdviSvg';
import { CSS_IMAGENES, CSS_LEYENDA_IM } from './informeNdviRasterImagen';
import { KC_BASE, KC_MAX, KC_MIN, KC_PENDIENTE } from './kcConstantes';
import { fmt, fmtMiles, SD } from './formato';
import {
    bloqueFirmas, cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, fechaLarga, mesLegible, pieInforme, tablaTrazabilidad, CSS_FUENTE_SVG, minificaCss, ultimoDiaIncluido, unificaFuenteSvg,
} from './informeBase';
import { svgSerieModulos, svgSparkline } from './informeNdviSvg';
import { signoDelta, svgBarrasDelta, svgBarrasPareadas, svgLineasSimples } from './informeNdviSvgComparativo';
import {
    MIN_ANIOS_REFERENCIA, MIN_ANIOS_TENDENCIA, Z_INUSUAL, fraseAnomalia, fraseEvolucion, textoReferencia, type AnomaliaPeriodo, type TendenciaModulo, type VsHabitual,
} from './informeNdviAnalisis';
import { UMBRAL_SIN_CAMBIO, MIN_ESCENAS_CONFIABLE, MIN_PCT_VALIDOS_CONFIABLE } from './ndviInteranual';
import { ROTULO_METODO_NDVI } from './ndviSerie';
import { r2CriticoAlfa05 } from './estadisticaHistorica';
import { rotuloBase } from './ndviPromedio';
import { etiquetaPeriodo, SECCIONES_NDVI } from './informeNdviConfig';
import { UMBRAL_REVISION_VIGOR, listaModulos } from './informeNdviResumen';
import { CSS_INTERANUAL, fraseInteranual, graficaPulsoSrlHtml, leyendaAnios, leyendaPulsoFicha, matricesSupVolHtml, pulsoModuloHtml, tablaPicosHtml } from './informeNdviInteranualHtml';
import type { InformeNdvi, ModuloInforme } from './informeNdviDatos';
import type { ClaseNdvi } from './ndviRampa';

/** Rango de las gráficas de NDVI, derivado de la constante (no escrito a mano). */
const ESCALA_NDVI = `${NDVI_RANGO[0]}–${NDVI_RANGO[1]}`;

export interface LogosInforme { srl: string; sica: string }

/** Piezas que arma otro módulo (la imagen satelital) y que la plantilla solo ubica en la hoja de situación. */
export interface ExtrasHtml {
    imagenes?: string;
    /** Contornos de los módulos: con ellos cada ficha lleva su mini-plano de ubicación (vectorial, sin red). */
    contornos?: Contornos;
    /** El plano trae relieve y contexto (canal, vecinos): la leyenda lo explica. */
    conContexto?: boolean;
}

function chipClase(c: ClaseNdvi | null): string {
    return c ? `<span class="chip"><i style="background:${c.color}"></i>${esc(c.etiqueta)}</span>` : '<span class="chip sd"><i class="hach"></i>S/D</span>';
}

/** Delta en tinta neutra con flecha (legible en B/N y para daltónicos): ▲ sube · ▼ baja · ■ sin cambio. */
function deltaTexto(d: number | null, decimales = 3): string {
    if (d == null || !Number.isFinite(d)) return `<span class="sd">${SD}</span>`;
    // Si el valor se imprimiría como 0.00 no se anuncia una subida o bajada (evita "▲ +0.00").
    if (Math.abs(d) < 0.5 * 10 ** -decimales) return `■ ${(0).toFixed(decimales)}`;
    return d > 0 ? `▲ +${d.toFixed(decimales)}` : `▼ −${Math.abs(d).toFixed(decimales)}`;
}

/** Pasos de la tinta única (blanco → marrón institucional) para ICV/IHR: se distingue de las clases NDVI y pesa una clase CSS por celda. */
const claseTinta = (v: number): string => `ct${Math.min(PASOS_TINTA - 1, Math.max(0, Math.floor((v / 100) * PASOS_TINTA)))}`;
const CSS_TINTA = Array.from({ length: PASOS_TINTA }, (_, i) => `td.ct${i}{background:${colorPasoTinta(i).fondo};color:${colorPasoTinta(i).texto};font-weight:700}`).join('\n');

function rangoClase(c: ClaseNdvi): string {
    return c.desde === -Infinity ? `< ${c.hasta.toFixed(2)}` : c.hasta === Infinity ? `≥ ${c.desde.toFixed(2)}` : `${c.desde.toFixed(2)}–${c.hasta.toFixed(2)}`;
}

function tablaCalor(titulo: string, d: InformeNdvi, valor: (m: ModuloInforme, i: number) => number | null, tinta: 'clase' | 'tinta', decimales: number, promedio?: (number | null)[], compacta = false): string {
    // Tablas compactas (de a dos por hoja): el año va solo si el periodo cruza de un año a otro.
    const mismoAnio = new Set(d.meses.map((m) => m.slice(0, 4))).size === 1;
    const cab = d.meses.map((m) => `<th class="n">${esc(compacta && mismoAnio ? mesLegible(m, true).split(' ')[0] : mesLegible(m, true))}</th>`).join('');
    const celda = (v: number | null) => {
        if (v == null) return '<td class="n sd hach">S/D</td>';
        return `<td class="n ${tinta === 'clase' ? `cv-${claseNdvi(v)?.clave ?? 'suelo'}` : claseTinta(v)}">${v.toFixed(decimales)}</td>`;
    };
    const filas = d.modulos.map((m) => `<tr><td>${monogramaHtml(m.numero)}${compacta ? '' : ` <b>${esc(m.nombre)}</b>`}</td>${d.meses.map((_, i) => celda(valor(m, i))).join('')}</tr>`).join('');
    const prom = promedio && d.modulos.length > 1 ? `<tr><td><b>Promedio SRL (${rotuloBase(d.basePromedio)})</b></td>${promedio.map((v) => celda(v)).join('')}</tr>` : '';
    return `<div class="tabla-wrap"><table class="compacta"><caption>${esc(titulo)}</caption><thead><tr><th>Módulo</th>${cab}</tr></thead><tbody>${filas}${prom}</tbody></table></div>`;
}

/** Celdas de NDVI por clase de vigor: una clase CSS por clase en vez de un estilo en línea por celda. */
const CSS_CLASES_CELDA = CLASES_NDVI.map((c) => `td.cv-${c.clave}{background:${c.color};color:${tintaSobre(c.color)};font-weight:700}`).join('\n');

/** Cifras de texto alineadas (lining-nums) en TODO el documento: el atajo `font:` de títulos, frases y KPI reinicia esta propiedad (y Georgia
 *  dibuja los 0 como "o"), por eso la regla es universal y con !important. Las columnas numéricas son monoespaciadas y no pierden alineación. */
const EXTRA_CSS = `
*{font-variant-numeric:lining-nums!important}
${CSS_FUENTE_SVG}
${CSS_CLASES_CELDA}
${CSS_TINTA}
${CSS_MARCAS}
.cuerpo>h2:not(:first-child){margin-top:12px}
.frase.titular{border-left:4px solid var(--inst);padding-left:8px}
.dist{display:flex;height:14px;border-radius:3px;overflow:hidden;border:1px solid var(--linea);margin:4px 0 2px}
.dist span{display:grid;place-items:center;font-size:7.5pt;font-weight:700;color:#1f2328}
.rank .fila{display:grid;grid-template-columns:54px 1fr 34px;gap:6px;align-items:center;margin:3px 0;font-size:8pt}
.rank .barra{height:11px;background:#f1f0ec;border:1px solid var(--linea);border-radius:2px;overflow:hidden}
.rank .barra i{display:block;height:100%;border-right:1px solid rgba(0,0,0,.45)}
.rank .barra i.hach{width:100%;border:0}
.chip i.hach{border:1px solid rgba(0,0,0,.35)}
.mapa{display:grid;grid-template-columns:470px minmax(0,1fr);gap:14px;align-items:start}
.mapa figure{margin:0}
.mapa .lado h3:first-child{margin-top:0}
.lado .promedio{border:1px solid var(--linea);border-top:3px solid var(--inst);border-radius:3px;padding:6px 8px;margin-top:8px}
.lado .promedio .v{font:700 18pt/1.1 Georgia,serif}
ol.hallazgos{margin:2px 0 6px;padding-left:18px;font-size:9pt}
ol.hallazgos li{margin-bottom:3px}
ul.revisar{margin:2px 0 4px;padding-left:16px;font-size:8.5pt}
ul.revisar li{margin-bottom:3px}
.cautela{margin-top:-2px}
table.compacta{font-size:7.5pt} table.compacta th{padding:3px 5px;font-size:7.5pt} table.compacta td{padding:2px 5px}
td.n,th.n{white-space:nowrap}
td.sd.hach{color:#2b3138;font-style:normal;font-weight:700;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff}
.pares{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pares.una{grid-template-columns:1fr}
.cols3.met{display:block;column-count:3;column-gap:14px}
.cols3.met>div{display:contents}
.cols3.met h3{break-after:avoid;margin-top:8px}.cols3.met h3:first-child{margin-top:0}
.cols3.met p,.cols3.met li,.cols3.met dd{break-inside:avoid}.cols3.met dt{break-after:avoid}
.mods{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mod{border:1px solid var(--linea);border-top:3px solid var(--ink);border-radius:3px;padding:5px 8px 4px;break-inside:avoid}
.mod h3{margin:0 0 2px;font-size:9.5pt;display:flex;align-items:center;gap:6px}
.mod h3 .mono{font-size:9.5pt;padding:0 5px 0 3px}
.mod .cab{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
.mod .cab>div:first-child{flex:1;min-width:0}
.mod .cab svg{display:block;flex:none}
.mod .fv{display:flex;align-items:baseline;gap:6px;margin:2px 0}
.mod .big{font:700 19pt/1 Georgia,serif}
.mod .dlt{font-size:7.5pt;color:var(--ink2)}
.mod .spark{margin-top:2px}
.mod .lect{font-size:8pt;line-height:1.3;color:var(--ink);margin:0 0 2px}
.mod dl{margin:3px 0 0;display:grid;grid-template-columns:auto auto;gap:1px 8px;font-size:7.5pt}
.mod dt{color:var(--ink2)} .mod dd{margin:0;text-align:right}
${CSS_INTERANUAL}
@media screen and (max-width:720px){.mapa,.pares,.mods{grid-template-columns:1fr}}
`;

const dd = (v: number | null, dec = 3) => (v == null ? `<span class="sd">${SD}</span>` : signoDelta(v, dec));
const pctTxt = (v: number | null) => (v == null ? SD : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} %`);
const ddHab = (h: VsHabitual) => (h.abs == null ? `<span class="sd">${SD}</span>` : signoDelta(h.abs, 3));

export function construirHtmlNdvi(d: InformeNdvi, logos: LogosInforme, plano: string, extras: ExtrasHtml = {}): string {
    const sec = new Set(d.config.secciones);
    const ind = new Set(d.config.indicadores);
    const ref = d.mesReferencia;
    const refTxt = mesLegible(ref);
    const base = rotuloBase(d.basePromedio);
    const periodoTxt = etiquetaPeriodo(d.config);
    const varios = d.modulos.length > 1;
    const an = d.analisis;
    const rs = d.resumen;
    const conDato = d.modulos.filter((m) => m.tieneDatoDelMes).length;
    const srl = an.tendencias.find((t) => t.id === 'srl') ?? (an.tendencias.length === 1 ? an.tendencias[0] : undefined);
    const nRefAnios = Math.max(0, an.aniosReferencia.length - 1);

    const paginas: { cabecera: string; cuerpo: string }[] = [];
    const corrida = `<div class="run"><span><b>SRL Unidad Conchos</b> · Informe técnico NDVI</span><span>${esc(d.folio)} · ${esc(refTxt)}</span></div>`;
    let nSec = 0;
    let nAnexo = 0;
    const letra = () => String.fromCharCode(65 + nAnexo++);
    const agrega = (cuerpo: string) => paginas.push({ cabecera: corrida, cuerpo });

    const clasePromedio = d.promedio != null ? CLASES_NDVI.find((c) => (d.promedio as number) >= c.desde && (d.promedio as number) < c.hasta) ?? null : null;
    const frontera = '<div class="aviso frontera"><b>Cómo leer este NDVI:</b> es la mediana mensual de los píxeles limpios de la frontera completa del módulo (incluye caminos, canales y suelo sin riego). Sirve para comparar meses y años del mismo módulo; no es el NDVI de una parcela y una diferencia no prueba su causa.</div>';
    const cautela = `<div class="aviso cautela"><b>Cautela:</b> ${esc(rs.cautela)}</div>`;

    // ── Hoja 1: portada compacta + RESUMEN EJECUTIVO
    {
        const dist = d.distribucion.reduce((s, x) => s + x.modulos.length, 0)
            ? d.distribucion.filter((x) => x.modulos.length).map((x) => `<span style="flex:${x.modulos.length};background:${x.clase.color};color:${tintaSobre(x.clase.color)}" title="${esc(x.clase.etiqueta)}">${x.modulos.length}</span>`).join('')
            : '';
        const AVISOS_MAX = 3;
        const avisosHtml = d.avisos.length
            ? d.avisos.slice(0, AVISOS_MAX).map((a) => `<div class="aviso"><b>${a.nivel === 'warn' ? 'Atención' : 'Nota'}:</b> ${esc(a.texto)}</div>`).join('') + (d.avisos.length > AVISOS_MAX ? `<div class="fuente">+ ${d.avisos.length - AVISOS_MAX} aviso(s) más en el anexo de trazabilidad.</div>` : '')
            : '<div class="aviso" style="border-left-color:#13866F;background:#effaf6;color:#0f5a49">Sin advertencias de calidad del dato en este corte.</div>';
        const revisar = rs.revisar.length
            ? `<ul class="revisar">${rs.revisar.map((r) => `<li><b>${esc(listaModulos(r.modulos))}:</b> ${esc(r.criterio)}${r.cifras && !/^M\d+$/.test(r.cifras) ? ` <span class="fuente">(${esc(r.cifras)})</span>` : ''}</li>`).join('')}</ul><p class="fuente">${esc(rs.accionRevisar)}</p>`
            : d.mesReferencia ? '<p>Ningún módulo cumple los criterios de revisión en este corte.</p>' : '<p class="sd">Sin datos en el periodo: no se pueden evaluar los criterios de revisión.</p>';
        agrega(`<div class="banda"><small>Centro de Inteligencia Agroclimática · SICA-005</small>
  <h1>Informe técnico de vigor de cultivos (NDVI)</h1>
  <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · ${d.modulos.length} ${d.modulos.length === 1 ? 'módulo' : 'módulos'} SRL</div></div>
<div class="datos">
  <div class="dato"><b>Periodo</b><span>${esc(periodoTxt)}</span></div>
  <div class="dato"><b>Mes de referencia</b><span>${esc(refTxt)}</span></div>
  <div class="dato"><b>Módulos con dato</b><span>${conDato} de ${d.modulos.length}</span></div>
  <div class="dato"><b>Promedio SRL</b><span>${esc(base)}</span></div>
</div>
<h2><span class="n">${++nSec}</span>Resumen ejecutivo</h2>
<p class="frase titular"><b>${esc(rs.titular)}</b></p>${cautela}
<h3>Hallazgos</h3>
${rs.hallazgos.length ? `<ol class="hallazgos">${rs.hallazgos.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : '<p class="sd">Sin hallazgos que reportar: no hay datos suficientes.</p>'}
<div class="cols">
  <div><h3>Estado del distrito por clase de vigor</h3>
    <div class="dist" role="img" aria-label="Distribución de módulos por clase de NDVI">${dist || '<span style="flex:1" class="sd hach">S/D</span>'}</div>
    <p class="fuente">${esc(rs.estado)}</p>
    <div class="kpi" style="margin-top:6px"><div class="et">${varios ? 'NDVI de la SRL' : 'NDVI del módulo'} · ${esc(refTxt)}</div><div class="v">${fmt(d.promedio, 2)}</div><div class="s">${chipClase(clasePromedio)}<br>${varios ? `Promedio ${esc(base)}. ${d.basePromedio === 'simple' ? `Ponderado por superficie: ${fmt(d.promedioPonderado, 2)}` : `Simple: ${fmt(d.promedioSimple, 2)}`}` : ''}</div></div></div>
  <div><h3>Qué revisar</h3>${revisar}${rs.criteriosRevision ? `<p class="fuente">${esc(rs.criteriosRevision)}</p>` : ''}</div>
</div>
<p class="fuente">${esc(rs.definicionSrl)}</p>
${avisosHtml}
<p class="nota-pie">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios. Fuente: Sentinel-2 L2A (Copernicus), Statistical API, polígono exacto de cada módulo; ${esc(ROTULO_METODO_NDVI)}. NDVI de la frontera del módulo, no de una parcela. Documento generado automáticamente por SICA-005.</p>`);
        paginas[0].cabecera = cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta: [
            { k: 'Folio', v: d.folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitidoEn) }, { k: 'Emitió', v: d.emisor },
            { k: 'Datos al', v: d.traza.corteDatos ? fechaLarga(d.traza.corteDatos) : SD }, { k: 'Versión', v: `SICA-005 v${d.version}` }] });
    }

    // ── Situación del periodo: plano + ranking
    if (sec.has('situacion')) {
        const rango = (xs: number[], f: (n: number) => string) => (xs.length ? (Math.min(...xs) === Math.max(...xs) ? f(xs[0]) : `${f(Math.min(...xs))}–${f(Math.max(...xs))}`) : SD);
        const escenas = rango(d.modulos.map((m) => m.nEscenas).filter((x): x is number => x != null), (n) => String(n));
        const validos = rango(d.modulos.map((m) => m.pctValidos).filter((x): x is number => x != null), (n) => `${Math.round(n * 100)} %`);
        const ventanaTxt = d.ventana.desde && d.ventana.hasta ? `del ${fechaLarga(d.ventana.desde)} al ${fechaLarga(ultimoDiaIncluido(d.ventana.hasta))}` : refTxt;
        const pie = `Fuente: Sentinel-2 L2A (Copernicus), mediana mensual de los píxeles limpios, ${esc(ventanaTxt)} · pasos de satélite por módulo: ${esc(escenas)} · píxeles válidos: ${esc(validos)}. NDVI de la frontera del módulo (incluye caminos, canales y suelo sin riego), no de parcela.${extras.conContexto ? ' Relieve: Copernicus DEM GLO-30. Canal Conchos y otros módulos del DR-005 como referencia.' : ''}`;
        const bloque = plano
            ? `<figure class="fig">${plano}<figcaption class="fuente">${pie}</figcaption></figure>`
            : '<div class="aviso"><b>Plano no disponible:</b> no se pudieron cargar los contornos de los módulos al generar el informe.</div>';
        const ranking = [...d.modulos].sort((a, b) => (b.ndvi ?? -1) - (a.ndvi ?? -1)).map((m) => `<div class="fila">
    <span>${monogramaHtml(m.numero)}</span><span class="barra">${m.ndvi != null ? `<i style="width:${Math.min(100, (m.ndvi / NDVI_RANGO[1]) * 100).toFixed(0)}%;background:${colorClaseNdvi(m.ndvi)}"></i>` : '<i class="hach"></i>'}</span>
    <span class="num">${fmt(m.ndvi, 2)}</span></div>`).join('');
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Situación del periodo — NDVI ${esc(refTxt)}</h2>
<div class="mapa"><div>${bloque}</div>
<div class="lado">${leyendaSistemaVisual(d.modulos, { indices: ind.has('icv') || ind.has('ihr'), plano: extras.conContexto ? { canal: true, vecinos: true, relieve: true } : undefined })}
  <div class="promedio"><div class="fuente" style="margin:0">${varios ? `NDVI de la SRL (promedio ${esc(base)})` : 'NDVI medio'}</div><div class="v">${fmt(d.promedio, 2)}</div><div class="fuente" style="margin:0">${chipClase(clasePromedio)}</div></div>
  <h3>Ranking de módulos</h3><div class="rank">${ranking}</div></div></div>
${frontera}
<p class="fuente">Las cifras de cada módulo están en la sección «Módulo por módulo».</p>`);
        if (d.config.imagenSatelital) {
            agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Imagen satelital por módulo — NDVI ${esc(refTxt)}</h2>
${extras.imagenes ?? '<div class="aviso"><b>Imagen satelital no disponible:</b> se solicitó incluirla, pero no se obtuvo al generar el informe; el documento sale sin ella.</div>'}`);
        }
    }

    // ── Tendencia y contraste (dos hojas)
    if (sec.has('tendencia')) {
        const lecturaAnom = (a: AnomaliaPeriodo) => (a.nConRef === 0 ? 'Insuficiente (sin referencia)' : a.direccion === 'arriba' ? '▲ Por encima de lo habitual'
            : a.direccion === 'abajo' ? '▼ Por debajo de lo habitual' : '■ En línea con lo habitual') + (a.fueraDeLoHabitual ? ` · a ${Z_INUSUAL} o más desviaciones` : '');
        const lecturaAnual = (t: TendenciaModulo) => { const m = t.evolucion.media; return m.patron === 'sube' ? '▲ Sube año tras año' : m.patron === 'baja' ? '▼ Baja año tras año'
            : m.patron === 'sin-patron' ? '■ Sin patrón claro' : `Insuficiente (n=${m.n})`; };
        const filasAn = an.tendencias.map((t) => { const a = t.anomalia; return `<tr${t.id === 'srl' ? ' style="font-weight:700"' : ''}><td>${esc(t.etiqueta)}${t.id === 'srl' ? ` <span class="fuente">(${esc(base)}${t.nModulos ? `; ${t.nModulos.n} de ${t.nModulos.total}` : ''})</span>` : ''}</td>
<td class="n">${fmt(a.mediaValor, 2)}</td><td class="n">${fmt(a.mediaRef, 2)}</td><td class="n">${dd(a.mediaAbs)}</td><td class="n">${pctTxt(a.pct)}</td>
<td class="n">${a.nConRef ? `${a.mesesArriba} / ${a.mesesAbajo} / ${a.mesesSimilar}` : SD}</td><td class="n">${a.minRef == null ? SD : a.minRef === a.maxRef ? a.minRef : `${a.minRef}–${a.maxRef}`}</td><td>${esc(lecturaAnom(a))}</td><td>${a.bajaConfianza ? 'Baja ⚠' : 'Aceptable'}</td></tr>`; }).join('');
        const motivos = [...new Set(an.tendencias.flatMap((t) => t.anomalia.motivos))].slice(0, 5);
        // El motivo que la frase del titular ya dice («Baja confianza: …») no se repite en un cuadro aparte.
        const fraseTit = srl ? fraseAnomalia(srl.anomalia, varios ? 'Promedio SRL' : (srl.etiqueta ?? '')) : '';
        const motivosAparte = motivos.filter((t) => !fraseTit.includes(t));
        const barras = svgBarrasDelta(an.tendencias.map((t) => ({ etiqueta: t.etiqueta, valor: t.anomalia.mediaAbs })), 3);
        const concil = rs.conciliacion.map((c) => `<tr><td>${esc(c.etiqueta)}</td><td class="n">${c.etiqueta.startsWith('Diferencia') ? dd(c.valor) : fmt(c.valor, 2)}</td><td>${esc(c.nota)}</td></tr>`).join('');
        const sujeto = varios ? 'Promedio SRL' : (srl?.etiqueta ?? '');
        const n1 = ++nSec;
        agrega(`<h2 style="margin-top:0"><span class="n">${n1}</span>Tendencia — ${esc(periodoTxt)} frente a lo habitual</h2>
${srl ? `<p class="frase">${esc(fraseAnomalia(srl.anomalia, sujeto))}</p>${cautela}` : '<p class="frase">No hay suficientes datos para describir la tendencia.</p>'}
<h3>Conciliación de cifras del NDVI de la SRL</h3>
<p class="fuente">${esc(rs.definicionSrl)} Las cifras que aparecen en este documento son distintas porque miden cosas distintas:</p>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Cifra</th><th class="n">Valor</th><th>Qué es</th></tr></thead><tbody>${concil}</tbody></table></div>
<h3>Frente a lo habitual (mismos meses de los demás años)</h3>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Módulo</th><th class="n">NDVI del periodo</th><th class="n">Habitual</th><th class="n">Diferencia</th><th class="n">%</th><th class="n">Meses ↑ / ↓ / =</th><th class="n">Años ref.</th><th>Lectura</th><th>Confianza</th></tr></thead><tbody>${filasAn}</tbody></table></div>
<figure class="fig" style="margin:0">${barras || '<div class="aviso">Sin diferencias para graficar.</div>'}
<figcaption class="fuente">Diferencia entre el NDVI del periodo y lo habitual de los mismos meses en otros años (derecha = por encima). ↑ / ↓ / = cuenta meses por encima, por debajo o en línea (menos de ${UMBRAL_SIN_CAMBIO.toFixed(2)}).${srl?.nModulos ? ` Promedio SRL: ${srl.nModulos.n} de ${srl.nModulos.total} módulos con referencia.` : ''}</figcaption></figure>
${motivosAparte.length ? `<div class="aviso"><b>Baja confianza en:</b> ${motivosAparte.map(esc).join(' · ')}</div>` : ''}`);

        // Hoja 2: año tras año + contraste contra el mismo periodo de otro año
        const aniosCols = [...new Set(an.tendencias.flatMap((t) => t.evolucion.anios.map((x) => x.anio)))].sort((x, y) => x - y);
        const celdaAnio = (t: TendenciaModulo, anio: number) => {
            const x = t.evolucion.anios.find((q) => q.anio === anio);
            if (!x || x.media == null) return `<td class="n sd">${SD}</td>`;
            return `<td class="n">${x.media.toFixed(2)}${x.completo ? '' : '*'}${x.pocoConfiable ? ' ⚠' : ''}</td>`;
        };
        const filasAnual = an.tendencias.map((t) => { const m = t.evolucion.media; return `<tr${t.id === 'srl' ? ' style="font-weight:700"' : ''}><td>${esc(t.etiqueta)}</td>
${aniosCols.map((a) => celdaAnio(t, a)).join('')}<td class="n">${m.sen == null ? SD : signoDelta(m.sen, 3)}</td><td class="n">${m.r2 == null ? SD : `${m.r2.toFixed(2)} (≥ ${(m.r2Umbral as number).toFixed(2)})`}</td><td>${esc(lecturaAnual(t))}</td></tr>`; }).join('');
        const lineasAnio = svgLineasSimples(aniosCols.map(String), an.tendencias.filter((t) => t.id === 'srl' || an.tendencias.length === 1).map((t) => ({
            etiqueta: t.id === 'srl' ? 'SRL' : `M${t.id}`, color: '#000', vals: aniosCols.map((a) => t.evolucion.anios.find((q) => q.anio === a)?.media ?? null),
            ...(t.id === 'srl' ? { ancho: 3 } : { modulo: Number(t.id) }),
        })), 700, 160, aniosCols.map(String));
        const c = an.contraste;
        const contraste = c
            ? (() => {
                const frase = c.promA == null || c.promB == null
                    ? 'Alguno de los dos periodos no tiene datos: no se puede calcular la diferencia.'
                    : `El NDVI medio ${varios ? `de la SRL (promedio ${base}) ` : ''}fue <b>${fmt(c.promA, 2)}</b> en ${esc(c.etiquetaA)} y <b>${fmt(c.promB, 2)}</b> en ${esc(c.etiquetaB)}: diferencia B − A ${deltaTexto(c.delta)}${c.pct != null ? ` (${pctTxt(c.pct)})` : ''}.${
                        c.delta != null && Math.abs(c.delta) < UMBRAL_SIN_CAMBIO ? ` Es una diferencia dentro de la variación normal entre años (menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}).` : ''}${
                        varios && c.mayorAumento ? ` Mayor aumento: ${esc(c.mayorAumento.nombre)} (${deltaTexto(c.mayorAumento.delta)}).` : ''}${varios && c.mayorDescenso ? ` Mayor descenso: ${esc(c.mayorDescenso.nombre)} (${deltaTexto(c.mayorDescenso.delta)}).` : ''}`;
                const filasC = c.filas.map((f) => `<tr><td><b>${esc(f.nombre)}</b></td><td class="n">${fmt(f.a, 2)}</td><td class="n">${fmt(f.b, 2)}</td><td class="n">${dd(f.delta)}</td><td class="n">${pctTxt(f.pct)}</td><td class="n">${ddHab(f.habA)}</td><td class="n">${ddHab(f.habB)}</td><td class="n">${f.nA} / ${f.nB}</td></tr>`).join('');
                return `<h3>Contraste contra el mismo periodo de ${c.anioA}</h3>
<p class="frase">${frase}</p>${c.avisos.map((t) => `<div class="aviso"><b>Atención:</b> ${esc(t)}</div>`).join('')}
<div class="tabla-wrap"><table class="compacta"><caption>Diferencia B − A por módulo (A = ${esc(c.etiquetaA)} · B = ${esc(c.etiquetaB)})</caption><thead><tr><th>Módulo</th><th class="n">A</th><th class="n">B</th><th class="n">B − A</th><th class="n">%</th><th class="n">A vs habitual</th><th class="n">B vs habitual</th><th class="n">Meses A/B</th></tr></thead><tbody>${filasC}
<tr style="font-weight:700"><td>Promedio SRL (${esc(base)}; ${c.nModulosA} de ${c.filas.length} módulos en A y ${c.nModulosB} en B)</td><td class="n">${fmt(c.promA, 2)}</td><td class="n">${fmt(c.promB, 2)}</td><td class="n">${dd(c.delta)}</td><td class="n">${pctTxt(c.pct)}</td><td class="n">${dd(c.habA)}</td><td class="n">${dd(c.habB)}</td><td></td></tr></tbody></table></div>
<p class="fuente">A y B cubren los mismos meses del año, por lo que la diferencia no es estacional. Cada lado es el promedio de los meses con dato del módulo; un módulo sin dato en un lado queda S/D. «vs habitual» compara cada lado con los demás años de referencia.</p>`;
            })()
            : `<h3>Contraste contra otro año</h3><p class="fuente">${d.config.contraste === 'ninguno' ? 'No se pidió contraste contra otro año.' : 'No hay datos del mismo periodo del año de contraste: no se puede comparar.'}</p>`;
        agrega(`<h2 style="margin-top:0">Tendencia — año tras año y contraste</h2>
<h3>Año tras año (media de la temporada marzo–septiembre)</h3>
${srl ? `<p class="frase">${esc(fraseEvolucion(srl.evolucion, varios ? 'Promedio SRL' : srl.etiqueta))}</p>` : ''}
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Módulo</th>${aniosCols.map((a) => `<th class="n">${a}</th>`).join('')}<th class="n">Cambio por año</th><th class="n">R² (mínimo)</th><th>Lectura</th></tr></thead><tbody>${filasAnual}</tbody></table></div>
<figure class="fig" style="margin:0">${lineasAnio || '<div class="aviso">Sin años para graficar.</div>'}<figcaption class="fuente">Media de la temporada ${varios ? `del promedio SRL (${esc(base)})` : 'del módulo'} por año; las cifras de cada módulo están en la tabla.</figcaption></figure>
<p class="fuente"><b>Cómo se lee:</b> «Frente a lo habitual» compara cada mes del periodo con el mismo mes de los demás años (mínimo ${MIN_ANIOS_REFERENCIA} años de referencia; aquí, ${nRefAnios}); de marzo a septiembre el NDVI sube siempre por el ciclo del cultivo, por eso no se mide una pendiente dentro del año. En «Año tras año» solo cuentan las temporadas completas (*: incompleta, no entra; ⚠: algún mes con pocas observaciones) y se dice que sube o baja únicamente si se cumplen los criterios del anexo de metodología. Con pocos años es una descripción, no una prueba ni una causa.</p>
${contraste}`);
    }

    // ── Comparación entre años (temporada marzo–septiembre)
    if (sec.has('interanual') && d.interanual) {
        const ia = d.interanual;
        const conBanda = ia.modulos.some((m) => m.clim.every((x) => x.p10 != null && x.p90 != null));
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparación entre años — temporada marzo–septiembre</h2>
<p class="frase">${esc(fraseInteranual(ia))}</p>
<p class="fuente">Años comparados: ${esc(ia.anios.join(', '))}; año de interés: ${ia.anioFoco}. Promedio SRL ${esc(base)}.</p>
<p class="fuente">NDVI de la frontera completa del módulo: compara años entre sí, no mide un cultivo.</p>
${tablaPicosHtml(ia)}
<h3>Pulso de la temporada${varios ? ` (promedio SRL ${esc(base)})` : ''}</h3>
<figure class="fig" style="margin:0">${graficaPulsoSrlHtml(ia)}${leyendaAnios(ia.anios, ia.anioFoco, false, false)}</figure>
${conBanda ? '' : '<p class="fuente">Con menos de tres años de referencia no se dibuja banda típica.</p>'}`);
    } else if (sec.has('interanual')) {
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Comparación entre años</h2><div class="aviso"><b>Sin comparación:</b> hacen falta al menos dos años con NDVI; la serie cargada no los tiene.</div>`);
    }

    // ── Comparación entre módulos (opcional)
    if (an.compModulos) {
        const c = an.compModulos;
        const n = ++nSec;
        if (c.kind === 'modulos') {
            const nd = c.indicadores[0];
            const frase = c.delta == null ? 'No hay datos suficientes para comparar los dos módulos.'
                : Math.abs(c.delta) < UMBRAL_SIN_CAMBIO
                    ? `${esc(c.A.nombre)} y ${esc(c.B.nombre)} tienen un NDVI medio casi igual en el periodo (${fmt(nd.a, 2)} y ${fmt(nd.b, 2)}; diferencia menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}); ${esc(c.A.nombre)} supera a ${esc(c.B.nombre)} en ${c.mesesAMayor} de ${c.mesesComunes} meses.`
                    : `${esc(c.B.nombre)} ${c.delta >= 0 ? 'supera' : 'queda por debajo de'} a ${esc(c.A.nombre)} por <b>${Math.abs(c.delta).toFixed(3)}</b> de NDVI medio en el periodo (${fmt(nd.b, 2)} contra ${fmt(nd.a, 2)}); ${esc(c.A.nombre)} supera a ${esc(c.B.nombre)} en ${c.mesesAMayor} de ${c.mesesComunes} meses.`;
            const filasM = c.meses.map((mes, i) => `<tr><td>${esc(mesLegible(mes, true))}</td><td class="n">${fmt(c.serieA[i], 2)}</td><td class="n">${fmt(c.serieB[i], 2)}</td><td class="n">${c.serieA[i] != null && c.serieB[i] != null ? dd((c.serieB[i] as number) - (c.serieA[i] as number)) : `<span class="sd">${SD}</span>`}</td></tr>`).join('');
            agrega(`<h2 style="margin-top:0"><span class="n">${n}</span>Comparación — ${esc(c.A.nombre)} contra ${esc(c.B.nombre)}</h2>
<p class="frase">${frase}</p>
<p class="fuente">Contra lo habitual de sus mismos meses: ${esc(c.A.nombre)} ${ddHab(c.habA)}, ${esc(c.B.nombre)} ${ddHab(c.habB)}.</p>
<figure class="fig" style="margin:0">${svgBarrasPareadas(c.indicadores.map((i) => ({ etiqueta: i.etiqueta, a: i.a, b: i.b, max: i.max, decimales: i.decimales })), c.A.nombre, c.B.nombre, '#3d444d', '#a3abb3') || ''}
<figcaption class="fuente">Promedio de cada indicador en el periodo (${esc(periodoTxt)}); cada barra usa la escala de su indicador (NDVI ${ESCALA_NDVI} · IHR 0–100). El Kc y el ICV no se comparan aparte: son el NDVI en otra escala y repetirían la misma lectura.</figcaption></figure>
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.A.nombre, color: '#000', vals: c.serieA, modulo: c.A.numero }, { etiqueta: c.B.nombre, color: '#000', vals: c.serieB, modulo: c.B.numero }]) || ''}</figure>
<div class="tabla-wrap"><table class="compacta"><caption>NDVI mensual (Δ = ${esc(c.B.nombre)} − ${esc(c.A.nombre)})</caption><thead><tr><th>Mes</th><th class="n">${esc(c.A.nombre)}</th><th class="n">${esc(c.B.nombre)}</th><th class="n">Δ</th></tr></thead><tbody>${filasM}</tbody></table></div>
${frontera}`);
        } else {
            const frase = c.difMedia == null ? 'No hay datos suficientes para comparar el módulo con el promedio de los demás.'
                : Math.abs(c.difMedia) < UMBRAL_SIN_CAMBIO
                    ? `${esc(c.modulo.nombre)} está en línea con el promedio de los otros ${c.totalOtros} módulos (diferencia media ${signoDelta(c.difMedia, 3)}, menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}).`
                    : `${esc(c.modulo.nombre)} ${c.difMedia >= 0 ? 'está por encima' : 'está por debajo'} del promedio de los otros ${c.totalOtros} módulos por <b>${Math.abs(c.difMedia).toFixed(3)}</b> de NDVI en promedio; lo supera por ${UMBRAL_SIN_CAMBIO.toFixed(2)} o más en ${c.mesesPorEncima} de ${c.mesesComunes} meses.`;
            const filasV = c.meses.map((mes, i) => `<tr><td>${esc(mesLegible(mes, true))}</td><td class="n">${fmt(c.serie[i], 2)}</td><td class="n">${fmt(c.srl[i], 2)}</td><td class="n">${c.nOtros[i]} de ${c.totalOtros}</td><td class="n">${dd(c.diferencia[i])}</td></tr>`).join('');
            agrega(`<h2 style="margin-top:0"><span class="n">${n}</span>Comparación — ${esc(c.modulo.nombre)} contra el promedio de los demás</h2>
<p class="frase">${frase}</p>
<p class="fuente">Contra lo habitual de sus mismos meses, ${esc(c.modulo.nombre)}: ${ddHab(c.hab)}.</p>
${c.composicionVariable ? '<div class="aviso"><b>Atención:</b> en algunos meses el promedio de referencia se calculó con menos módulos que el total (ver la columna «Módulos»).</div>' : ''}
<figure class="fig" style="margin:0">${svgLineasSimples(c.meses, [{ etiqueta: c.modulo.nombre, color: '#000', vals: c.serie, modulo: c.modulo.numero }, { etiqueta: 'Otros', color: '#000', vals: c.srl, ancho: 3 }]) || ''}
<figcaption class="fuente">La referencia es el promedio ${esc(rotuloBase(c.base))} de los otros ${c.totalOtros} módulos SRL (el módulo no entra en su propia referencia ni depende del filtro de módulos).</figcaption></figure>
<h3>Diferencia mensual contra el promedio de los demás (NDVI)</h3>
<figure class="fig" style="margin:0">${svgBarrasDelta(c.meses.map((mes, i) => ({ etiqueta: mesLegible(mes, true), valor: c.diferencia[i] })), 3) || ''}</figure>
<div class="tabla-wrap"><table class="compacta"><thead><tr><th>Mes</th><th class="n">${esc(c.modulo.nombre)}</th><th class="n">Otros</th><th class="n">Módulos</th><th class="n">Diferencia</th></tr></thead><tbody>${filasV}</tbody></table></div>
${frontera}`);
        }
    }

    // ── Módulo por módulo (fichas fusionadas con sus cifras)
    if (sec.has('modulos')) {
        const lecturaCorta = (m: ModuloInforme) => {
            if (!m.tieneDatoDelMes) return `Sin dato en ${refTxt}.`;
            const t = an.tendencias.find((x) => x.id === m.numero);
            const a = t?.anomalia;
            if (!a || a.mediaAbs == null) return 'Sin referencia suficiente para compararlo con lo habitual.';
            const dir = a.direccion === 'arriba' ? 'Por encima de lo habitual' : a.direccion === 'abajo' ? 'Por debajo de lo habitual' : 'En línea con lo habitual';
            return `${dir} (${signoDelta(a.mediaAbs, 3)}; ${textoReferencia(a)}).`;
        };
        const ficha = (m: ModuloInforme) => {
            const im = d.interanual?.modulos.find((x) => x.numero === m.numero);
            const foco = d.interanual?.anioFoco;
            const r = im?.resumenes[im.resumenes.length - 1];
            const grafico = d.interanual && im ? pulsoModuloHtml(d.interanual, im) : '';
            const spark = !grafico && d.meses.length > 1 ? svgSparkline(m.serieNdvi, 320, 70, d.meses) : '';
            const mini = extras.contornos ? miniPlanoModuloSvg(m.numero, d.modulos, extras.contornos, 58) : '';
            return `<div class="mod">
  <div class="cab"><div><h3>${monogramaHtml(m.numero)}<span>${esc(m.nombre)}</span></h3>
  <div class="fv"><span class="big">${fmt(m.ndvi, 2)}</span>${chipClase(m.clase)}</div>
  <div class="dlt">${deltaTexto(m.delta)}${m.delta != null && d.mesAnterior ? ` vs ${esc(mesLegible(d.mesAnterior))}` : ''}</div></div>${mini}</div>
  <p class="lect">${esc(lecturaCorta(m))}</p>
  <div>${grafico}</div>${spark ? `<div class="spark">${spark}</div>` : ''}
  <dl><dt>Superficie del módulo (polígono)</dt><dd class="num">${fmtMiles(m.superficieHa, 0)} ha</dd>
  ${r && foco ? `<dt>Pico ${foco}</dt><dd class="num">${fmt(r.pico, 3)}${r.mesPico ? ` · ${esc(r.mesPico)}` : ''}</dd><dt>Media de temporada ${foco}</dt><dd class="num">${fmt(r.media, 3)}</dd>` : ''}
  ${ind.has('kc') ? `<dt>Kc estimado</dt><dd class="num">${fmt(m.kc, 2)}</dd>` : ''}${ind.has('icv') ? `<dt>ICV (0–100)</dt><dd class="num">${fmt(m.icv, 0)}</dd>` : ''}${
                ind.has('ihr') ? `<dt>IHR (0–100)</dt><dd class="num">${m.ihr == null ? SD : m.ihrEnPiso ? '0 (piso)' : fmt(m.ihr, 0)}</dd>` : ''}${ind.has('iehp') ? `<dt>IEHP (ha/hm³)</dt><dd class="num">${fmt(m.iehp, 1)}</dd>` : ''}</dl></div>`;
        };
        const notas: string[] = [];
        if (ind.has('ihr') && d.nIhrEnPiso > 0) notas.push(`IHR 0 (piso): con NDVI bajo, la desviación entre píxeles iguala o supera a la mediana y el cociente deja de medir uniformidad; no indica riego heterogéneo. Esos módulos (${d.nIhrEnPiso}) no entran al promedio del IHR (${fmt(d.promedioIhr, 0)}).`);
        if (ind.has('kc')) notas.push('Kc de la frontera del módulo: no usar para programar riego.');
        if (ind.has('icv') || ind.has('kc')) notas.push('Kc e ICV son transformaciones lineales del NDVI: dicen lo mismo con otra escala.');
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Módulo por módulo — ${esc(refTxt)}</h2>
<div class="mods">${d.modulos.map(ficha).join('')}</div>
${d.interanual ? (d.interanual.modulos.every((m) => m.clim.every((c) => c.p10 != null && c.p90 != null)) ? leyendaPulsoFicha(d.interanual.anioFoco, true) : leyendaAnios(d.interanual.anios, d.interanual.anioFoco, d.interanual.modulos.some((m) => m.clim.every((c) => c.p10 != null && c.p90 != null)), d.interanual.modulos.some((m) => m.clim.some((c) => c.media != null)))) : ''}
<p class="fuente">${d.interanual ? `Gráfica: NDVI mensual de la temporada del año de interés contra lo típico de los otros años elegidos (escala ${ESCALA_NDVI}, igual en todos los módulos). ` : `Gráfica: NDVI mensual del periodo (escala ${ESCALA_NDVI}, igual en todos los módulos). `}Δ = diferencia contra el mes anterior de la serie. NDVI de la frontera del módulo.</p>
${notas.map((t) => `<p class="fuente">${esc(t)}</p>`).join('')}`);
    }

    // ── Anexo: serie histórica y tablas completas
    if (sec.has('anexoSerie')) {
        const calor = tablaCalor('NDVI mensual por módulo', d, (m, i) => m.serieNdvi[i], 'clase', 2, d.promedioPorMes);
        const pares: string[] = [];
        if (ind.has('icv')) pares.push(tablaCalor('ICV mensual (0–100)', d, (m, i) => m.serieIcv[i], 'tinta', 0, undefined, true));
        if (ind.has('ihr')) pares.push(tablaCalor('IHR mensual (0–100; 0 = piso del índice)', d, (m, i) => m.serieIhr[i], 'tinta', 0, undefined, true));
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Serie histórica, ${esc(mesLegible(d.meses[0] ?? null))}${d.meses.length > 1 ? ` a ${esc(refTxt)}` : ''}</h2>
<figure class="fig" style="margin:0">${svgSerieModulos(d.meses, d.modulos, d.promedioPorMes, 700, 200) || '<div class="aviso">Sin serie para graficar.</div>'}
<figcaption class="fuente">NDVI medio mensual. Cada módulo lleva su forma, su trazo y su monograma; línea negra gruesa = promedio SRL (${esc(base)}). Escala vertical ${ESCALA_NDVI}.</figcaption></figure>
${calor}${pares.length ? `<div class="pares${pares.length > 1 && d.meses.length > 7 ? ' una' : ''}">${pares.join('')}</div>` : ''}
<div class="fuente">Color de las celdas de NDVI = clase (misma leyenda del plano). ICV/IHR en tinta marrón: más oscuro = mayor valor. S/D = sin fila ese mes.</div>`);
    }

    // ── Anexo: superficie y volumen (solo con más de un año)
    let anexoSupVolOmitido = false;
    if (sec.has('anexoSupVol')) {
        if (d.interanual) {
            const av = d.interanual.avisos.filter((t) => !/pocas observaciones/.test(t));
            agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Superficie regada y volumen entregado por año</h2>
${matricesSupVolHtml(d.interanual)}
<div class="aviso">${av.slice(0, 6).map((t) => `${esc(t)} `).join('')}<b>Lectura con cuidado:</b> S/D también marca los años sin NDVI${d.interanual.aniosSinNdvi.length ? ` (${d.interanual.aniosSinNdvi.join(' y ')})` : ''}; ningún dato faltante se rellena ni se estima. La comparación es descriptiva: más lámina y más vegetación el mismo año no prueban relación causal.</div>`);
        } else anexoSupVolOmitido = true;
    }

    // ── Anexo: metodología, glosario y límites
    const hayMetodologia = sec.has('metodologia');
    if (hayMetodologia) {
        const p = d.parametros;
        const defs = [
            '<dt>NDVI</dt><dd>Índice de vegetación de diferencia normalizada: mediana mensual de los píxeles limpios (máscara de nubes por píxel) del polígono exacto de cada módulo (Sentinel-2 L2A, Statistical API). Es el NDVI de la frontera del módulo, no de una parcela.</dd>',
            `<dt>Clase de vigor</dt><dd>${CLASES_NDVI.map((c) => `${esc(c.etiqueta)} (${esc(rangoClase(c))})`).join(' · ')}.</dd>`,
            `<dt>NDVI de la SRL</dt><dd>${esc(rs.definicionSrl)}</dd>`,
            `<dt>Lo habitual</dt><dd>Promedio del mismo mes en los demás años de la referencia (${an.aniosReferencia.filter((a) => a !== an.anioRef).length ? esc(an.aniosReferencia.filter((a) => a !== an.anioRef).join(', ')) : 'S/D'}); exige al menos ${MIN_ANIOS_REFERENCIA} otros años con dato.</dd>`,
            ind.has('kc') ? `<dt>Kc estimado</dt><dd>Aproximación lineal NDVI→Kc: ${KC_BASE.toFixed(2)} + ${KC_PENDIENTE.toFixed(2)}·NDVI, acotado a ${KC_MIN.toFixed(2)}–${KC_MAX.toFixed(2)}. Kc de la frontera del módulo: no usar para programar riego.</dd>` : '',
            ind.has('icv') ? `<dt>ICV (0–100)</dt><dd>Condición vegetativa: escala lineal del NDVI con piso ${p.ndviPiso.toFixed(2)} (suelo desnudo) y techo ${p.ndviTecho.toFixed(2)} (vigor pleno).</dd>` : '',
            ind.has('ihr') ? '<dt>IHR (0–100)</dt><dd>Homogeneidad de riego: 100×(1 − desviación/mediana) del NDVI de los píxeles dentro del módulo. Un 0 es el piso del índice (la desviación iguala o supera a la mediana, típico con NDVI bajo) y no significa riego heterogéneo; esos valores no entran al promedio.</dd>' : '',
            ind.has('iehp') ? `<dt>IEHP (ha/hm³)</dt><dd>Hectáreas con cobertura activa (NDVI ≥ ${p.umbralActivo.toFixed(2)}) por hm³ entregado acumulado del ciclo.</dd>` : '',
            '<dt>Superficie</dt><dd>«Superficie del módulo (polígono)» es el área del contorno que se mide con el satélite; «Superficie regada (informe ACUM_INF)» es la que reporta el informe de distribución de la SRL. No son la misma cifra.</dd>',
        ].join('');
        const inicio = fechaLarga(d.ventana.desde), fin = fechaLarga(ultimoDiaIncluido(d.ventana.hasta));
        const limites = [
            `Promedio SRL ${d.basePromedio === 'ponderado' ? '<b>ponderado por superficie del polígono</b> (el simple se muestra aparte)' : '<b>simple</b> (cada módulo pesa igual; el ponderado por superficie se muestra aparte)'}; la misma base se usa en todos los cálculos del documento.`,
            ind.has('iehp') ? (d.volumenMesParcial ? 'El volumen del mes de referencia es <b>parcial</b>: el IEHP de este corte no es comparable con meses completos.' : 'El volumen entregado proviene de la carga institucional provisional de la SRL, no de la captura operativa diaria.') : '',
            d.variosAnios ? '' : 'La serie cargada abarca un solo año: no hay años anteriores para comparar.',
            `Con ${nRefAnios} ${nRefAnios === 1 ? 'año' : 'años'} de referencia, tendencias y diferencias son descriptivas: no prueban una causa.`,
            `El NDVI es de un mes calendario cerrado; no describe los últimos días.${d.traza.mesEnCurso ? ' El mes de referencia es el mes en curso y puede estar incompleto.' : ''}`,
            'La evapotranspiración real (ETa) y la temperatura superficial satelital no se incorporan a este informe.',
            'Un módulo sin dato del mes aparece como S/D; no se sustituye con otro mes.',
            `Un mes con menos de ${MIN_ESCENAS_CONFIABLE} pasos de satélite limpios o menos de ${Math.round(MIN_PCT_VALIDOS_CONFIABLE * 100)} % de píxeles válidos se muestra con ⚠; no se descarta.`,
            anexoSupVolOmitido ? 'El anexo de superficie y volumen se omitió: requiere al menos dos años de referencia.' : '',
        ].filter(Boolean);
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Metodología, glosario y límites</h2>
<div class="cols3 met"><div><h3>Definiciones</h3><dl class="def">${defs}</dl></div>
<div><h3>Método</h3>
<p>Periodo del informe: ${esc(periodoTxt)}. Ventana de cálculo del mes de referencia: del ${esc(inicio)} al ${esc(fin)} (la fecha final de la fuente es exclusiva). Filtro de nubosidad: ≤ ${d.nubosidadMaxPct != null ? d.nubosidadMaxPct.toFixed(0) : SD} %. Resolución nativa 10 m.</p>
<p>Clases de vigor: ${CLASES_NDVI.map((c) => esc(c.etiqueta)).join(' · ')} (límites ${CLASES_NDVI.slice(1).map((c) => c.desde.toFixed(2)).join(' / ')}). Se marca para revisión un módulo con NDVI bajo ${UMBRAL_REVISION_VIGOR.toFixed(2)}.</p>
<p>Serie: ${esc(ROTULO_METODO_NDVI)} (método ${esc(d.traza.metodo)}). No se mezcla con la serie anterior (promedio de 30 días sin máscara), que es otra magnitud.</p>
<p>«En línea con lo habitual» = diferencia menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}; «${Z_INUSUAL} o más desviaciones» describe un periodo más lejos de lo habitual que lo que suelen variar los otros años entre sí. La evolución año a año exige el R² crítico al 5 % (≈ ${r2CriticoAlfa05(Math.max(MIN_ANIOS_TENDENCIA, an.aniosReferencia.length)).toFixed(2)} con ${Math.max(MIN_ANIOS_TENDENCIA, an.aniosReferencia.length)} años).</p>
<p>Los cambios (Δ) se calculan contra el mes calendario inmediato anterior; si ese mes no tiene dato, el cambio queda S/D.</p></div>
<div><h3>Limitaciones</h3><ul style="margin:0;padding-left:14px">${limites.map((t) => `<li>${t}</li>`).join('')}</ul></div></div>
<div class="aviso"><b>Uso del documento:</b> producto de apoyo a la decisión. No sustituye aforos ni mediciones oficiales en campo.</div>`);

        // Trazabilidad, calidad del dato y firmas
        const alcanceTxt = SECCIONES_NDVI.filter((s) => sec.has(s.id)).map((s) => s.etiqueta).join('; ') + (d.config.compModulos ? '; Comparación entre módulos' : '');
        const traza = tablaTrazabilidad([
            { k: 'Folio', v: d.folio },
            { k: 'Emisión', v: `${fechaHoraLegible(d.emitidoEn)} · ${d.emisor}` },
            { k: 'Datos al', v: d.traza.corteDatos ? fechaLarga(d.traza.corteDatos) : 'S/D (la fuente no trae ventana)' },
            { k: 'Periodo', v: periodoTxt },
            { k: 'Alcance', v: `${d.traza.alcance} — ${alcanceTxt}` },
            { k: 'Módulos', v: d.modulos.map((m) => `M${m.numero}`).join(', ') },
            { k: 'Años comparados (el último es el de interés)', v: an.aniosReferencia.length ? an.aniosReferencia.join(', ') : 'S/D' },
            { k: 'Promedio SRL', v: base },
            { k: 'Método del NDVI', v: `${d.traza.metodo} — ${ROTULO_METODO_NDVI}` },
            { k: 'Versión de plantilla', v: d.traza.plantilla },
            { k: 'Versión de SICA-005', v: d.version },
            { k: 'Hash de configuración', v: d.traza.hashConfig },
            { k: 'Fuente', v: 'Sentinel-2 L2A (Copernicus), Statistical API; superficie y volumen anual: informe ACUM_INF de la SRL' },
            { k: 'Consultas fallidas', v: d.erroresConsulta.length ? d.erroresConsulta.map((e) => `${e.fuente}${e.mensaje ? ` (${e.mensaje})` : ''}`).join('; ') : 'Ninguna' },
        ]);
        const calidad = d.avisos.length ? d.avisos.slice(0, 10).map((a) => `<div class="aviso"><b>${a.nivel === 'warn' ? 'Atención' : 'Nota'}:</b> ${esc(a.texto)}</div>`).join('') : '<div class="aviso" style="border-left-color:#13866F;background:#effaf6;color:#0f5a49">Sin advertencias de calidad del dato en este corte.</div>';
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Trazabilidad y calidad del dato</h2>
${traza}
<h3>Calidad del dato</h3>${calidad}${d.avisos.length > 10 ? `<p class="fuente">+ ${d.avisos.length - 10} aviso(s) más.</p>` : ''}
${d.config.firmas ? `<h3>Firmas</h3>${bloqueFirmas({ nombres: { Elaboró: d.emisor } })}` : ''}`);
    }

    const total = paginas.length;
    const cuerpo = paginas.map((p, i) => `<section class="pagina">${p.cabecera}<div class="cuerpo">${p.cuerpo}</div>${pieInforme(`Folio ${d.folio} · SICA-005 v${d.version}`, i + 1, total)}</section>`).join('\n');
    return documentoHtml({
        titulo: `Informe técnico NDVI — SRL Unidad Conchos — ${periodoTxt}`,
        css: minificaCss(cssInforme({ formato: d.config.hoja }) + EXTRA_CSS + (d.config.imagenSatelital ? CSS_IMAGENES + CSS_LEYENDA_IM : '')),
        cuerpo: defsMarcadoresHtml() + unificaFuenteSvg(cuerpo),
        metas: { 'sica-folio': d.folio, 'sica-hash-config': d.traza.hashConfig, 'sica-metodo': d.traza.metodo, 'sica-plantilla': d.traza.plantilla, 'sica-datos-al': d.traza.corteDatos ?? 'S/D' },
    });
}
