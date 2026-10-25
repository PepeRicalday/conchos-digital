/**
 * informeNdviInteranualHtml — gráficos SVG y bloques HTML PUROS de la comparación entre años del informe técnico de NDVI
 * (los arma informeNdviHtml.ts dentro del documento integrado). Año de interés = NEGRO GRUESO con halo blanco (el marrón es
 * solo de la marca); los demás años, un solo matiz azul pizarra de claro a oscuro (más reciente = más oscuro) con un marcador
 * de forma por año al final de la línea y su año escrito, así que nada depende solo del color. S/D en gris itálico, nunca 0.
 */
import { fmt, fmtMiles, SD } from './formato';
import { esc } from './informeBase';
import { FS_MIN } from './informeNdviMarcas';
import { formaSvg, type FormaMarcador } from './informeNdviMarcas';
import { SIMBOLOS_ANIO } from './ndviGrafica';
import { ETIQUETA_MES, MESES_TEMPORADA, MIN_ESCENAS_CONFIABLE, MIN_MESES_ANIO_COMPLETO, MIN_PCT_VALIDOS_CONFIABLE } from './ndviInteranual';
import { NDVI_RANGO, NDVI_TICKS } from './ndviRampa';
import { rotuloBase } from './ndviPromedio';
import type { ModeloInteranual, ModuloInteranual } from './informeNdviInteranual';
import { cabeceraSvg } from './informeNdviSvgComparativo';

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
/** Un solo matiz (azul pizarra), cinco pasos de luminosidad: el más reciente es el más oscuro. */
const RAMPA_PREVIOS = ['#9db6d4', '#7a9cc2', '#5b82b0', '#436a99', '#2f527f'];
/** Año de interés: negro grueso (definido y explicado en la leyenda). */
export const COLOR_ANIO_INFORME = '#000000';
const NDVI_MAX = NDVI_RANGO[1];
/** Coordenada con un decimal y sin el ".0" sobrante (el SVG pesa ≈ 8 % menos). */
const f1 = (n: number) => String(Number(n.toFixed(1)));

export const colorPrevioImpreso = (i: number, total: number): string => {
    const n = RAMPA_PREVIOS.length;
    return RAMPA_PREVIOS[total <= 1 ? n - 1 : Math.min(n - 1, Math.round((i / (total - 1)) * (n - 1)))];
};

const sdSpan = `<span class="sd">${SD}</span>`;
const celda = (txt: string) => (txt === SD ? sdSpan : esc(txt));
/** Celda numérica: el S/D lleva la clase en la propia celda (menos marcas que un span por celda). */
const tdN = (txt: string, extra = '') => (txt === SD ? `<td class="n sd">${SD}</td>` : `<td class="n">${esc(txt)}${extra}</td>`);
const signo = (v: number, d: number) => `${v >= 0 ? '▲ +' : '▼ −'}${Math.abs(v).toFixed(d)}`;

interface OpcionesPulso { w: number; h: number; mini?: boolean }

/** Pulso estacional: banda típica (p10–p90) detrás, años previos finos con su etiqueta, año de interés grueso en marrón SRL. */
export function svgPulso(m: { anios: number[]; anioFoco: number; series: { anio: number; vals: (number | null)[] }[]; clim: { media: number | null; p10: number | null; p90: number | null }[]; titulo: string }, o: OpcionesPulso): string {
    const { w, h } = o;
    const L = o.mini ? 30 : 36, R = o.mini ? 38 : 44, T = 8, B = 22;
    const x = (i: number) => L + (i * (w - L - R)) / (MESES_TEMPORADA.length - 1);
    const y = (v: number) => T + (1 - Math.min(NDVI_MAX, Math.max(0, v)) / NDVI_MAX) * (h - T - B);
    const fs = FS_MIN;
    const camino = (vals: (number | null)[]) => {
        let d = '', pen = false;
        vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        return d;
    };
    // Modo mini (una ficha por módulo): solo 3 marcas en Y y 3 en X, y la etiqueta del año de interés; la leyenda de años va fuera de la gráfica.
    const ticks = o.mini ? [0, 0.4, 0.8] : NDVI_TICKS;
    const grid = ticks.map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 4}" y="${f1(y(t) + 3)}" text-anchor="end" font-size="${fs}" fill="${INK2}">${t.toFixed(1)}</text>`).join('');
    const ejeX = MESES_TEMPORADA.map((mm, i) => (!o.mini || i === 0 || i === 3 || i === MESES_TEMPORADA.length - 1
        ? `<text x="${f1(x(i))}" y="${h - 5}" text-anchor="middle" font-size="${fs}" fill="${INK2}">${ETIQUETA_MES[mm]}</text>` : '')).join('');
    const conBanda = m.clim.length > 0 && m.clim.every((c) => c.p10 != null && c.p90 != null);
    const banda = conBanda
        ? `<path d="M${m.clim.map((c, i) => `${f1(x(i))} ${f1(y(c.p90 as number))}`).join(' L')} L${[...m.clim].reverse().map((c, k) => `${f1(x(m.clim.length - 1 - k))} ${f1(y(c.p10 as number))}`).join(' L')} Z" fill="#d9d6cf" opacity="0.8"/>`
        : '';
    const prom = m.clim.some((c) => c.media != null) ? `<path d="${camino(m.clim.map((c) => c.media))}" fill="none" stroke="${INK2}" stroke-width="1.2" stroke-dasharray="4 3"/>` : '';
    const previos = m.series.filter((s) => s.anio !== m.anioFoco);
    // En la ficha (mini) con banda típica, el trazo de cada año previo sería ruido y peso: la banda p10–p90 y el promedio ya los resumen.
    const lineas = (o.mini && conBanda ? [] : previos).map((s, i) => {
        const c = colorPrevioImpreso(i, previos.length);
        return `<path d="${camino(s.vals)}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
    }).join('');
    const foco = m.series.find((s) => s.anio === m.anioFoco);
    const lineaFoco = foco ? `<path d="${camino(foco.vals)}" fill="none" stroke="#fff" stroke-width="5.2" stroke-linejoin="round" stroke-linecap="round"/><path d="${camino(foco.vals)}" fill="none" stroke="${COLOR_ANIO_INFORME}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${
        foco.vals.map((v, i) => (v == null || (o.mini && i !== foco.vals.length - 1) ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="3.2" fill="${COLOR_ANIO_INFORME}" stroke="#fff" stroke-width="1"/>`)).join('')}` : '';
    // Etiqueta del año al final de cada línea (último mes con dato), separadas verticalmente para que no se encimen.
    const fin = m.series.filter((s) => !o.mini || s.anio === m.anioFoco).map((s) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { anio: s.anio, xx: x(i), yy: y(s.vals[i] as number) }; })
        .filter((s): s is { anio: number; xx: number; yy: number } => !!s).sort((p, q) => p.yy - q.yy)
        .map((s) => ({ ...s, y0: s.yy }));
    // Separación de rótulos: el del año de interés queda en el sitio de su punto y los demás se apartan de él y entre sí.
    const paso = fs + 3;
    for (let pasada = 0; pasada < 40; pasada++) {
        let hubo = false;
        for (let k = 1; k < fin.length; k++) {
            const falta = paso - (fin[k].yy - fin[k - 1].yy);
            if (falta <= 0) continue;
            hubo = true;
            const aFoco = fin[k - 1].anio === m.anioFoco, bFoco = fin[k].anio === m.anioFoco;
            if (aFoco) fin[k].yy += falta; else if (bFoco) fin[k - 1].yy -= falta; else { fin[k - 1].yy -= falta / 2; fin[k].yy += falta / 2; }
        }
        if (!hubo) break;
    }
    const etiquetas = fin.map((s) => {
        const esFoco = s.anio === m.anioFoco;
        const iPrev = previos.findIndex((q) => q.anio === s.anio);
        const forma = esFoco ? '' : formaSvg(SIMBOLOS_ANIO[(iPrev + 1) % SIMBOLOS_ANIO.length] as FormaMarcador, s.xx + 7, s.yy, 3.2, `fill="${colorPrevioImpreso(iPrev, previos.length)}" stroke="${INK}" stroke-width=".8"`);
        return `${forma}<text x="${f1(s.xx + (esFoco ? 6 : 13))}" y="${f1(s.yy + fs * 0.35)}" font-size="${fs}" ${esFoco ? 'font-weight="700"' : ''} fill="${INK}">${s.anio}</text>`;
    }).join('');
    const picos = m.series.map((s) => { const v = s.vals.filter((x): x is number => x != null); return v.length ? `${s.anio}: pico ${Math.max(...v).toFixed(3)}` : `${s.anio}: S/D`; }).join('; ');
    const cab = cabeceraSvg(m.titulo, picos);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}${grid}${ejeX}${banda}${prom}${lineas}${lineaFoco}${etiquetas}</svg>`;
}

/** CSS propio de los bloques entre años (lo compartido —.run, .banda, .datos, .frase, .cols3…— vive en informeBase). */
export const CSS_INTERANUAL = `
.aviso.frontera{border-left-color:#59616b;background:#f3f3f1;color:var(--ink);border-color:#d6d4cf}
.aviso.frontera b{color:var(--ink)}
table.compacta tr.foco td,table.compacta tr.foco th{background:#ecebe7;font-weight:700}
.ley{display:flex;flex-wrap:wrap;gap:3px 14px;list-style:none;padding:0;margin:4px 0 0;font-size:7.5pt}
.ley li{display:inline-flex;align-items:center;gap:5px}
.ley i{display:inline-block;width:18px;height:3px}
.ley i.b{height:9px;background:#d9d6cf} .ley i.p{height:0;border-top:1.5px dashed ${INK2};background:none}
`;

/** Leyenda de los pulsos de las fichas: año de interés, promedio de los otros años y banda típica (los años previos no se trazan uno a uno). */
export const leyendaPulsoFicha = (foco: number, conBanda: boolean): string =>
    `<ul class="ley" aria-label="Leyenda del pulso"><li><i style="background:${COLOR_ANIO_INFORME};height:4px"></i><b>${foco}</b> (año de interés, negro grueso)</li><li><i class="p"></i>Promedio de los otros años</li>${conBanda ? '<li><i class="b"></i>Banda típica (p10–p90)</li>' : ''}</ul>`;

export const leyendaAnios = (anios: number[], foco: number, conBanda: boolean, conPromedio = true): string => {
    const prev = anios.filter((a) => a !== foco);
    return `<ul class="ley" aria-label="Leyenda de años">${prev.map((a, i) => `<li><i style="background:${colorPrevioImpreso(i, prev.length)}"></i>${a}</li>`).join('')}<li><i style="background:${COLOR_ANIO_INFORME};height:4px"></i><b>${foco}</b> (año de interés, negro grueso)</li>${conPromedio ? '<li><i class="p"></i>Promedio de los otros años</li>' : ''}${conBanda ? '<li><i class="b"></i>Banda típica (p10–p90)</li>' : ''}</ul>`;
};

/** Frase del conteo de módulos contra su propia referencia; dice con cuántos años se compara y que es descriptiva. */
export function fraseInteranual(d: ModeloInteranual): string {
    const foco = d.anioFoco;
    const varios = d.modulos.length > 1;
    const sinRef = d.conteo.arriba + d.conteo.abajo + d.conteo.similar === 0;
    if (sinRef) return `No hay datos suficientes para comparar ${foco} contra los otros años elegidos (S/D).`;
    const nRef = d.anios.length - 1;
    return `En ${foco}, ${d.conteo.arriba} de ${d.modulos.length} ${varios ? 'módulos van' : 'módulo va'} por encima del promedio de pico de sus otros años, ${d.conteo.abajo} por debajo y ${d.conteo.similar} en línea${d.conteo.sd ? ` (${d.conteo.sd} sin dato)` : ''}.${
        d.mayorAlza ? ` Mayor alza: Módulo ${d.mayorAlza.modulo} (${signo(d.mayorAlza.abs, 3)}).` : ''}${d.mayorBaja ? ` Mayor baja: Módulo ${d.mayorBaja.modulo} (${signo(d.mayorBaja.abs, 3)}).` : ''} Lectura descriptiva con ${nRef} ${nRef === 1 ? 'año' : 'años'} de referencia.`;
}

/** Tabla de pico por año y módulo con la fila del año de interés contra los demás. */
export function tablaPicosHtml(d: ModeloInteranual): string {
    const foco = d.anioFoco;
    const varios = d.modulos.length > 1;
    const th = 'text-align:left;background:none;color:inherit;text-transform:none;font-size:7.5pt;white-space:nowrap';
    const filaPico = (a: number, i: number) => `<tr${a === foco ? ' class="foco"' : ''}><th scope="row" style="${th}">${a}</th>${
        d.modulos.map((m) => tdN(fmt(m.resumenes[i].pico, 3), m.resumenes[i].pocoConfiables.length ? ' ⚠' : '')).join('')}<td class="n"><b>${celda(fmt(d.picoSrlPorAnio[i].pico, 3))}</b>${d.picoSrlPorAnio[i].pico != null && d.picoSrlPorAnio[i].n < d.modulos.length ? ` <small>(${d.picoSrlPorAnio[i].n} de ${d.modulos.length})</small>` : ''}</td></tr>`;
    const filaAn = `<tr><th scope="row" style="${th}">${foco} vs otros años</th>${
        d.modulos.map((m) => `<td class="n">${m.lectura.anomalia ? esc(signo(m.lectura.anomalia.abs, 3)) : sdSpan}</td>`).join('')}<td class="n"><b>${d.anomaliaPicoSrl ? esc(signo(d.anomaliaPicoSrl.abs, 3)) : sdSpan}</b></td></tr>`;
    return `<div class="tabla-wrap"><table class="compacta"><caption>Pico de NDVI por año y módulo (temporada marzo–septiembre)</caption><thead><tr><th>Año</th>${
        d.modulos.map((m) => `<th class="n">M${m.numero}</th>`).join('')}<th class="n">Promedio${varios ? ` SRL (${esc(rotuloBase(d.base))})` : ''}</th></tr></thead><tbody>${d.anios.map(filaPico).join('')}${filaAn}</tbody></table></div>
<p class="fuente">Pico = mes de mayor NDVI de la temporada. Promedio SRL ${esc(rotuloBase(d.base))} de los módulos con dato. ▲▼ = pico de ${foco} menos el promedio de pico de los otros años elegidos. ⚠ = algún mes con menos de ${MIN_ESCENAS_CONFIABLE} pasos de satélite limpios o menos de ${Math.round(MIN_PCT_VALIDOS_CONFIABLE * 100)} % de píxeles válidos.</p>`;
}

/** Gráfica general del pulso de la temporada (promedio SRL de los módulos elegidos, un trazo por año). */
export function graficaPulsoSrlHtml(d: ModeloInteranual): string {
    return svgPulso({ anios: d.anios, anioFoco: d.anioFoco, series: d.serieSrl, clim: [], titulo: 'NDVI medio mensual de los módulos elegidos, por año' }, { w: 700, h: 250 });
}

/** Matrices de superficie regada, volumen, lámina y media de NDVI por módulo y año (anexo de superficie y volumen). */
export function matricesSupVolHtml(d: ModeloInteranual): string {
    const matriz = (titulo: string, valor: (c: ModuloInteranual['cruce'][number]) => string, nota: string) => `<div class="tabla-wrap"><table class="compacta"><caption>${esc(titulo)}</caption><thead><tr><th>Módulo</th>${
        d.anios.map((a) => `<th class="n">${a}</th>`).join('')}</tr></thead><tbody>${d.modulos.map((m) => `<tr><td><b>${esc(m.nombre)}</b></td>${
        m.cruce.map((c) => tdN(valor(c), c.atipicos > 0 ? ' ⚠' : '')).join('')}</tr>`).join('')}</tbody></table></div>${nota ? `<p class="fuente">${nota}</p>` : ''}`;
    const ultimoSup = d.modulos.flatMap((m) => m.cruce).filter((c) => c.volumenHm3 != null).reduce<number | null>((mx, c) => (mx == null || c.anio > mx ? c.anio : mx), null);
    return `<p class="frase">${ultimoSup != null ? `El informe de superficie y volumen (ACUM_INF) cubre hasta ${ultimoSup}.` : 'Ninguno de los años elegidos tiene informe de superficie y volumen (S/D).'} La tabla permite ver, año contra año, el volumen entregado junto a la vegetación; no prueba relación entre ambos.</p>
${matriz('Superficie regada (informe ACUM_INF, ha)', (c) => fmtMiles(c.superficieHa, 0), 'Informe de distribución al corte de septiembre, suma de cultivos; no es la superficie del polígono del módulo. El volumen está en miles de m³ convertidos a hm³ y la lámina es volumen dividido entre la superficie regada del mismo informe.')}
${matriz('Volumen entregado (hm³)', (c) => fmt(c.volumenHm3, 1), '')}
${matriz('Lámina entregada (m³ por hectárea regada)', (c) => fmtMiles(c.laminaM3Ha, 0), '')}
${matriz('Media de NDVI de la temporada (mar–sep)', (c) => fmt(c.mediaNdvi, 3), `Media = promedio de los meses con dato de marzo a septiembre; se usa la media y no el pico porque dentro de cada módulo la media acompaña al volumen entregado y el pico no. Una temporada con menos de ${MIN_MESES_ANIO_COMPLETO} meses con dato (p. ej. el año en curso) no es comparable con un año completo.`)}`;
}

/** Pulso de un módulo para su ficha: temporada contra los otros años (banda típica y promedio de referencia). */
export function pulsoModuloHtml(d: ModeloInteranual, m: ModuloInteranual): string {
    return svgPulso({ anios: d.anios, anioFoco: d.anioFoco, series: m.series, clim: m.clim, titulo: `${m.nombre}: NDVI mensual por año` }, { w: 320, h: 74, mini: true });
}
