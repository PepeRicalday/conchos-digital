/**
 * informeVolumenCultivoHtml — documento PURO (sin red, sin DOM) del informe estadístico «Consumo por año, módulo y cultivo
 * (ACUM_INF 2020-2024)». Mismo patrón que el informe técnico de NDVI: hojas Carta en una lista, «Pág. n de N» con las hojas
 * realmente armadas, folio por hash del contenido, membrete dual SRL/SICA (escudo SRL marrón institucional) y tablas con S/D
 * en gris itálico, nunca 0. Descriptivo: no atribuye causas. Los renglones atípicos del informe fuente se avisan, no se corrigen.
 *
 * Gráficas (SVG sin color como único portador de significado): miniaturas de lámina por cultivo con la misma escala desde
 * cero, barras apiladas de la mezcla del volumen con su porcentaje escrito y rango 2020-2024 con el ciclo actual (rombo).
 */
import { fmt, fmtMiles, SD } from './formato';
import {
    bloqueFirmas, cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, folioConPartes, hashCorto, minificaCss, pieInforme, tablaTrazabilidad, unificaFuenteSvg,
} from './informeBase';
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import {
    UMBRAL_HA_MUESTRA, Z_ATIPICA, contrasteRegimenes, esAlfalfaNogal, kpiCiclo, kpiLamina, kpiMezcla, laminaPorCultivo, listaAtipicos, matrizModuloAnio, mezclaCultivos,
    referenciaCicloActual, type PosicionCiclo, type ReferenciaModulo, type SerieCultivo,
} from './volumenCultivo';

export const MODULOS_INFORME_VC = [1, 2, 3, 4, 5, 12];
export const TITULO_INFORME_VC = 'Consumo por año, módulo y cultivo (ACUM_INF 2020-2024)';
const PLANTILLA = 'volumen-cultivo-v1';

export interface DatosInformeVolumenCultivo {
    filas: FilaSupVol[];
    volumenActual: VolumenActual | null;
    /** Mensaje si no se pudo leer ACUM_INF (la sección sale S/D con aviso, nunca vacía en silencio). */
    errorSupVol: string | null;
    emisor: string;
    emitidoEn: Date;
    version: string;
}
export interface LogosVC { srl: string; sica: string }

const INK = '#1f2328', INK2 = '#57606a', GRID = '#dcd9d2', AZUL = '#0A5BB0';
const f1 = (n: number) => String(Number(n.toFixed(1)));
const FS = 10.4;
const sg = (v: number, d = 0) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
const tdN = (txt: string, extra = '') => (txt === SD ? `<td class="n sd">${SD}</td>` : `<td class="n">${esc(txt)}${extra}</td>`);
const TXT_POS: Record<PosicionCiclo, string> = { 'bajo-rango': '▼ Bajo el mínimo', dentro: '● Dentro del rango', 'sobre-rango': '▲ Sobre el máximo', 'sin-dato': 'Sin dato (S/D)' };

/** Folio por hash del contenido (mismos datos → mismo folio, sin importar el emisor ni la hora). */
export function claveContenidoVC(d: Pick<DatosInformeVolumenCultivo, 'filas' | 'volumenActual' | 'errorSupVol'>): string {
    const filas = d.filas.map((f) => `${f.anio}|${f.numero_modulo}|${f.cultivo}|${f.superficie_ha ?? ''}|${f.volumen_miles_m3 ?? ''}|${f.atipico ? 1 : 0}`).join(';');
    const act = d.volumenActual ? [...d.volumenActual.porModulo.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => `${m}:${v}`).join(',') + `#${d.volumenActual.mesesParciales.join(',')}#${d.volumenActual.error ?? ''}` : 'sin-actual';
    return hashCorto(`${PLANTILLA}#${filas}#${act}#${d.errorSupVol ?? ''}`);
}
export const folioVolumenCultivo = (d: DatosInformeVolumenCultivo): string => folioConPartes('VCULT', [claveContenidoVC(d)], d.emitidoEn);
export const nombreArchivoVolumenCultivo = (d: DatosInformeVolumenCultivo): string => `informe-consumo-cultivo-acum-inf-${d.emitidoEn.getFullYear()}-${String(d.emitidoEn.getMonth() + 1).padStart(2, '0')}-${String(d.emitidoEn.getDate()).padStart(2, '0')}.html`;

// ───────────────────────── Gráficas SVG ─────────────────────────

/** Miniaturas de lámina por año de los cultivos de mayor volumen. Escala común desde cero; barra hueca = superficie bajo el umbral; S/D escrito. */
export function svgLaminaMiniaturas(series: SerieCultivo[], anios: number[]): string {
    const top = series.slice(0, 6);
    if (!top.length || !anios.length) return '';
    const W = 660, PW = 208, GAP = 18, PH = 116, filas = Math.ceil(top.length / 3);
    const maxL = Math.max(1, ...top.flatMap((s) => s.celdas.map((c) => c.laminaCm ?? 0)));
    const base = 88, alto = 58, slot = (PW - 8) / anios.length, bw = Math.min(28, slot - 8);
    const paneles = top.map((s, i) => {
        const ox = (i % 3) * (PW + GAP), oy = Math.floor(i / 3) * PH;
        const barras = anios.map((a, k) => {
            const c = s.celdas.find((x) => x.anio === a);
            const cx = 4 + slot * k + slot / 2;
            const rotA = `<text x="${f1(cx)}" y="${base + 13}" text-anchor="middle" font-size="${FS}" fill="${INK2}">${a}</text>`;
            if (!c || c.laminaCm == null) return `<text x="${f1(cx)}" y="${base - 4}" text-anchor="middle" font-size="${FS}" font-style="italic" fill="#6a737d">S/D</text>${rotA}`;
            const h = Math.max(2, (c.laminaCm / maxL) * alto);
            const marca = c.laminaAtipica || c.atipicoFuente || c.muestraChica ? ' ⚠' : '';
            const rect = c.muestraChica
                ? `<rect x="${f1(cx - bw / 2)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="2" fill="#fff" stroke="${AZUL}" stroke-width="1.6"/>`
                : `<rect x="${f1(cx - bw / 2)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="2" fill="${AZUL}"/>`;
            return `${rect}<text x="${f1(cx)}" y="${f1(base - h - 3)}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}">${Math.round(c.laminaCm)}${marca}</text>${rotA}`;
        }).join('');
        return `<g transform="translate(${ox} ${oy})"><text x="4" y="12" font-size="11.5" font-weight="700" fill="${INK}">${esc(s.cultivo)}</text><line x1="4" x2="${PW - 4}" y1="${base}" y2="${base}" stroke="${GRID}"/>${barras}</g>`;
    }).join('');
    const resumen = top.map((s) => `${s.cultivo}: ${anios.map((a) => { const c = s.celdas.find((x) => x.anio === a); return `${a} ${c?.laminaCm != null ? `${Math.round(c.laminaCm)} cm` : 'S/D'}`; }).join(', ')}`).join('. ');
    return `<svg viewBox="0 0 ${W} ${filas * PH}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Lámina bruta en centímetros por año de los ${top.length} cultivos de mayor volumen. ${esc(resumen)}"><title>Lámina bruta (cm) por cultivo y año, misma escala desde cero</title>${paneles}</svg>`;
}

const COL_ALFALFA = '#1f6f14', COL_NOGAL = '#7a4a1c', COL_OTROS = '#5b6573';
/** Barras 100 % apiladas por año: alfalfa, nogal y el resto de cultivos, con su porcentaje escrito dentro del segmento cuando cabe. */
export function svgMezclaApilada(filas: FilaSupVol[], anios: number[]): string {
    if (!anios.length) return '';
    const W = 660, X0 = 168, X1 = 650, RH = 28;
    const rows = anios.map((a, i) => {
        const m = mezclaCultivos(filas, null, a);
        const tot = m.reduce((s, x) => s + (x.volumenHm3 ?? 0), 0);
        const alf = m.filter((x) => x.cultivo.toLowerCase().startsWith('alfalfa')).reduce((s, x) => s + (x.volumenHm3 ?? 0), 0);
        const nog = m.filter((x) => esAlfalfaNogal(x.cultivo) && !x.cultivo.toLowerCase().startsWith('alfalfa')).reduce((s, x) => s + (x.volumenHm3 ?? 0), 0);
        const y = 6 + i * RH;
        if (!tot) return `<text x="4" y="${y + 15}" font-size="${FS}" fill="${INK}">${a}</text><text x="${X0}" y="${y + 15}" font-size="${FS}" font-style="italic" fill="#6a737d">S/D</text>`;
        const partes = [{ v: alf, c: COL_ALFALFA, n: 'Alfalfa' }, { v: nog, c: COL_NOGAL, n: 'Nogal' }, { v: Math.max(0, tot - alf - nog), c: COL_OTROS, n: 'Otros' }];
        let x = X0;
        const segs = partes.map((p) => {
            const w = (p.v / tot) * (X1 - X0);
            const ini = x; x += w;
            if (w < 0.5) return '';
            const pct = (p.v / tot) * 100;
            return `<rect x="${f1(ini)}" y="${y}" width="${f1(Math.max(0, w - 2))}" height="20" rx="2" fill="${p.c}"/>${w > 40 ? `<text x="${f1(ini + (w - 2) / 2)}" y="${y + 14.5}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="#fff">${pct.toFixed(0)} %</text>` : ''}`;
        }).join('');
        return `<text x="4" y="${y + 15}" font-size="${FS}" font-weight="700" fill="${INK}">${a}</text><text x="${X0 - 6}" y="${y + 15}" text-anchor="end" font-size="${FS}" fill="${INK2}">${fmt(tot, 0)} hm³</text>${segs}`;
    }).join('');
    const desc = anios.map((a) => { const k = kpiMezcla(filas, null, a); return `${a}: alfalfa y nogal ${k.pctVolumenAlfalfaNogal != null ? `${Math.round(k.pctVolumenAlfalfaNogal)} %` : 'S/D'} del volumen`; }).join('; ');
    return `<svg viewBox="0 0 ${W} ${anios.length * RH + 8}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Participación en el volumen por año. ${esc(desc)}"><title>Participación de alfalfa, nogal y otros cultivos en el volumen de cada año</title>${rows}</svg>
<ul class="ley" aria-label="Leyenda"><li><i style="background:${COL_ALFALFA}"></i>Alfalfa</li><li><i style="background:${COL_NOGAL}"></i>Nogal</li><li><i style="background:${COL_OTROS}"></i>Otros cultivos</li></ul>`;
}

/** Rango 2020-2024 (banda), mediana (raya) y ciclo actual (rombo) por módulo; escala propia de cada módulo desde cero. Los números van escritos a la derecha. */
export function svgRangoCiclo(refs: ReferenciaModulo[]): string {
    if (!refs.length) return '';
    const W = 660, X0 = 44, X1 = 380, RH = 30;
    const rows = refs.map((r, i) => {
        const y = 4 + i * RH, cy = y + 14;
        const rot = `<text x="4" y="${cy + 4}" font-size="${FS}" font-weight="700" fill="${INK}">M${r.modulo}</text>`;
        if (r.minHm3 == null || r.maxHm3 == null) return `${rot}<text x="${X0}" y="${cy + 4}" font-size="${FS}" font-style="italic" fill="#6a737d">S/D</text>`;
        const tope = Math.max(r.maxHm3, r.actualHm3 ?? 0) * 1.05;
        const x = (v: number) => X0 + (v / tope) * (X1 - X0);
        const act = r.actualHm3 != null ? `<path d="M${f1(x(r.actualHm3))} ${cy - 9}l8 9l-8 9l-8 -9z" fill="${r.posicion === 'bajo-rango' ? '#fff' : AZUL}" stroke="${INK}" stroke-width="1.6"/>` : '';
        const med = r.medianaHm3 != null ? `<line x1="${f1(x(r.medianaHm3))}" x2="${f1(x(r.medianaHm3))}" y1="${cy - 8}" y2="${cy + 8}" stroke="${INK2}" stroke-width="2.2"/>` : '';
        const txt = `Rango ${fmt(r.minHm3, 1)}–${fmt(r.maxHm3, 1)} · mediana ${fmt(r.medianaHm3, 1)} · actual ${r.actualHm3 != null ? `${fmt(r.actualHm3, 1)} hm³` : SD}`;
        return `${rot}<line x1="${X0}" x2="${X1}" y1="${cy}" y2="${cy}" stroke="${GRID}"/><rect x="${f1(x(r.minHm3))}" y="${cy - 6}" width="${f1(Math.max(2, x(r.maxHm3) - x(r.minHm3)))}" height="12" rx="2" fill="#c9ced6"/>${med}${act}<text x="${X1 + 22}" y="${cy + 4}" font-size="${FS}" fill="${INK}">${esc(txt)}</text>`;
    }).join('');
    const desc = refs.map((r) => `Módulo ${r.modulo}: ${r.actualHm3 != null ? `${fmt(r.actualHm3, 1)} hm³, ${TXT_POS[r.posicion].replace(/^[▲▼●] /, '').toLowerCase()}` : 'sin dato actual'}`).join('; ');
    return `<svg viewBox="0 0 ${W} ${refs.length * RH + 8}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Ciclo actual contra el rango 2020-2024 por módulo. ${esc(desc)}"><title>Ciclo actual contra el rango 2020-2024 por módulo (escala propia de cada módulo)</title>${rows}</svg>
<ul class="ley" aria-label="Leyenda"><li><i class="b"></i>Rango 2020-2024</li><li><i class="m"></i>Mediana</li><li><i class="r"></i>Ciclo actual provisional (rombo; hueco = bajo el mínimo)</li></ul>`;
}

// ───────────────────────── Estilos propios ─────────────────────────

const EXTRA_CSS = `
.kpis.tres{grid-template-columns:repeat(3,1fr)} .kpis.cuatro{grid-template-columns:repeat(4,1fr)}
.kpi .v small{font:600 8.5pt var(--marca);color:var(--ink2);margin-left:4px}
.kpi .v.t{font-size:14pt}
.kpi .s b{color:var(--ink)}
.kpi.sd .v{color:var(--sd);font-style:italic}
table.compacta{font-size:8pt} table.compacta th,table.compacta td{padding:2px 5px}
table.compacta td.n small{display:block;font:7.5pt "Segoe UI",Arial,sans-serif;color:var(--ink2)}
td.alerta{font-weight:700}
tbody th.cul{background:none;color:var(--ink);text-transform:none;letter-spacing:0;font-size:8pt;text-align:left;white-space:nowrap;border-bottom:1px solid var(--linea)}
tbody tr:nth-child(even) th.cul{background:#F6F9FC}
.mini{display:block;height:3px;margin:2px 0 0 auto;width:48px;background:#e6e3dc;border-radius:2px}
.mini i{display:block;height:100%;background:${AZUL};border-radius:2px}
.mini.hueca i{background:#fff;box-shadow:inset 0 0 0 1px ${AZUL}}
.ley{display:flex;flex-wrap:wrap;gap:3px 14px;list-style:none;padding:0;margin:4px 0 0;font-size:7.5pt}
.ley li{display:inline-flex;align-items:center;gap:5px}
.ley i{display:inline-block;width:16px;height:9px;border-radius:2px}
.ley i.b{background:#c9ced6} .ley i.m{width:3px;height:12px;background:${INK2}} .ley i.r{width:10px;height:10px;transform:rotate(45deg);background:${AZUL};border:1.5px solid ${INK};border-radius:0}
.hallazgos{margin:0 0 6px;padding-left:18px} .hallazgos li{margin-bottom:3px}
.aviso.ok{border-left-color:#13866F;background:#effaf6;color:#0f5a49}
.aviso.frontera{border-left-color:#59616b;background:#f3f3f1;color:var(--ink);border-color:#d6d4cf}
.aviso.frontera b{color:var(--ink)}
@media screen and (max-width:720px){.kpis.tres,.kpis.cuatro{grid-template-columns:1fr 1fr}.fig{overflow-x:auto;-webkit-overflow-scrolling:touch}.fig svg{min-width:660px}.pie-pagina .pie-org{display:none}.run{flex-wrap:wrap;gap:2px 10px}}
`;

// ───────────────────────── Documento ─────────────────────────

const nHaz = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function construirHtmlVolumenCultivo(d: DatosInformeVolumenCultivo, logos: LogosVC): string {
    const folio = folioVolumenCultivo(d);
    const hash = claveContenidoVC(d);
    const filas = d.filas;
    const paginas: { cabecera: string; cuerpo: string }[] = [];
    const corrida = `<div class="run"><span><b>SRL Unidad Conchos</b> · Informe estadístico de consumo por cultivo</span><span>${esc(folio)}</span></div>`;
    const agrega = (cuerpo: string) => paginas.push({ cabecera: corrida, cuerpo });
    let nSec = 0, nAnexo = 0;
    const letra = () => String.fromCharCode(65 + nAnexo++);

    const anios = [...new Set(filas.map((f) => f.anio))].sort((a, b) => a - b);
    const anioUlt = anios.length ? anios[anios.length - 1] : null;
    const periodo = anios.length ? `${anios[0]}-${anioUlt}` : 'S/D';
    const kl = kpiLamina(filas, null);
    const km = kpiMezcla(filas, null, anioUlt);
    const refs = referenciaCicloActual(filas, d.volumenActual, MODULOS_INFORME_VC);
    const kc = kpiCiclo(refs);
    const series = laminaPorCultivo(filas, null);
    const contraste = contrasteRegimenes(filas, null);
    const atipicos = listaAtipicos(filas);
    const renglonesAtipicosFuente = filas.filter((f) => f.atipico).length;
    const sinDatos = filas.length === 0;
    const meta = [
        { k: 'Folio', v: folio }, { k: 'Emisión', v: fechaHoraLegible(d.emitidoEn) }, { k: 'Emitió', v: d.emisor },
        { k: 'Fuente', v: 'ACUM_INF (corte septiembre)' }, { k: 'Versión', v: `SICA 005 v${d.version}` },
    ];

    // ── Hoja 1: portada + resumen ejecutivo
    {
        const haz: string[] = [];
        if (kl.anio != null) {
            haz.push(`En ${kl.anio}, la lámina bruta media del distrito fue ${kl.laminaMediaCm != null ? `de ${fmt(kl.laminaMediaCm, 0)} cm` : 'S/D'}${kl.cultivoMayor ? `; el cultivo de mayor lámina fue ${kl.cultivoMayor.cultivo} (${fmt(kl.cultivoMayor.laminaCm, 0)} cm)` : ''}.`);
        }
        if (km.pctVolumenAlfalfaNogal != null) haz.push(`Alfalfa y nogal suman ${fmt(km.pctVolumenAlfalfaNogal, 0)} % del volumen de ${anioUlt}.`);
        if (km.altosVsBajos) haz.push(`La superficie regada de los años ${km.altosVsBajos.altos.join(' y ')} (media ${fmtMiles(km.altosVsBajos.altosHa, 0)} ha) es ${fmt(km.altosVsBajos.veces, 1)} veces la de ${km.altosVsBajos.bajos.join(', ')} (media ${fmtMiles(km.altosVsBajos.bajosHa, 0)} ha). Es una descripción de las cifras del informe: no se explica el porqué.`);
        if (kc.modulosConDato) haz.push(`Ciclo actual (provisional): ${kc.dentro} de ${kc.modulosTotal} módulos dentro del rango 2020-2024, ${kc.sobre} sobre el máximo y ${kc.bajo} bajo el mínimo${kc.sinDato ? `, ${kc.sinDato} sin dato` : ''}.`);
        else haz.push('Ciclo actual: S/D (no se pudo leer el volumen provisional de la hoja SRL; no se estima ni se llena con cero).');
        if (atipicos.length) haz.push(`${nHaz(atipicos.length, 'celda marcada', 'celdas marcadas')} con ⚠ (lámina lejos de los demás años, superficie menor a ${UMBRAL_HA_MUESTRA} ha o captura atípica en la fuente); se listan en el anexo A y no se corrigen.`);
        const kpiHtml = (et: string, v: string | null, unidad: string, ctx: string, texto = false) =>
            `<div class="kpi${v == null ? ' sd' : ''}"><div class="et">${esc(et)}</div><div class="v${texto ? ' t' : ''}">${v == null ? SD : esc(v)}${v != null && unidad ? `<small>${esc(unidad)}</small>` : ''}</div><div class="s">${ctx}</div></div>`;
        agrega(`<div class="banda"><small>Centro de Inteligencia Agroclimática · SICA 005</small>
  <h1>Consumo por año, módulo y cultivo <span style="white-space:nowrap">(ACUM_INF 2020-2024)</span></h1>
  <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · 6 módulos SRL · informe estadístico descriptivo</div></div>
<div class="datos">
  <div class="dato"><b>Años cubiertos</b><span>${esc(periodo)}</span></div>
  <div class="dato"><b>Renglones de la fuente</b><span>${fmtMiles(filas.length, 0)}</span></div>
  <div class="dato"><b>Cultivos</b><span>${series.length || SD}</span></div>
  <div class="dato"><b>Ciclo actual</b><span>${d.volumenActual && !d.volumenActual.error ? 'Provisional (hoja SRL)' : 'S/D'}</span></div>
</div>
<h2><span class="n">${++nSec}</span>Resumen ejecutivo</h2>
${sinDatos ? `<div class="aviso"><b>Sin datos:</b> ${d.errorSupVol ? `no se pudo leer el informe ACUM_INF (${esc(d.errorSupVol)}). Esto no significa que no haya datos.` : 'el informe ACUM_INF no tiene renglones cargados.'} Todas las secciones aparecen como S/D.</div>` : ''}
<div class="kpis tres">
${kpiHtml(`Lámina media ${kl.anio ?? ''}`.trim(), kl.laminaMediaCm != null ? fmt(kl.laminaMediaCm, 0) : null, 'cm', 'Volumen ÷ superficie, todo el distrito')}
${kpiHtml('Cultivo de mayor lámina', kl.cultivoMayor?.cultivo ?? null, '', kl.cultivoMayor ? `<b>${fmt(kl.cultivoMayor.laminaCm, 0)} cm</b> en ${kl.anio} (cultivos de ${UMBRAL_HA_MUESTRA} ha o más)` : 'Sin cultivo con superficie suficiente', true)}
${kpiHtml('Celdas con ⚠', kl.celdas ? String(kl.alertas) : null, kl.celdas ? `de ${kl.celdas}` : '', 'Se muestran, no se corrigen')}
${kpiHtml('Alfalfa + nogal', km.pctVolumenAlfalfaNogal != null ? fmt(km.pctVolumenAlfalfaNogal, 0) : null, '% del volumen', `${anioUlt ?? 'S/D'}, todo el distrito`)}
${kpiHtml(`Superficie total ${anioUlt ?? ''}`.trim(), km.superficieTotalHa != null ? fmtMiles(km.superficieTotalHa, 0) : null, 'ha', 'Suma de cultivos del informe ACUM_INF')}
${kpiHtml('Años altos contra bajos', km.altosVsBajos ? `${fmt(km.altosVsBajos.veces, 1)}×` : null, '', km.altosVsBajos ? `<b>${fmtMiles(km.altosVsBajos.altosHa, 0)} ha</b> (${km.altosVsBajos.altos.join(', ')}) frente a <b>${fmtMiles(km.altosVsBajos.bajosHa, 0)} ha</b> (${km.altosVsBajos.bajos.join(', ')})` : 'Sin contraste claro')}
${kpiHtml('Módulos dentro del rango', kc.modulosConDato ? `${kc.dentro} de ${kc.modulosTotal}` : null, '', kc.modulosConDato ? `${kc.sobre} sobre el máximo · ${kc.bajo} bajo el mínimo${kc.sinDato ? ` · ${kc.sinDato} S/D` : ''}` : 'Ciclo actual sin dato', true)}
${kpiHtml('Volumen actual (mar–sep)', kc.actualHm3 != null ? fmt(kc.actualHm3, 1) : null, 'hm³ provisional', kc.modulosConDato && kc.modulosConDato < kc.modulosTotal ? `Suma de ${kc.modulosConDato} de ${kc.modulosTotal} módulos con dato` : 'Hoja SRL, sin conciliar con ACUM_INF')}
${kpiHtml('Contra la mediana', kc.pctVsMediana != null ? `${sg(kc.pctVsMediana, 0)} %` : null, '', kc.medianaHm3 != null ? `Mediana 2020-2024 de esos módulos: <b>${fmt(kc.medianaHm3, 1)} hm³</b>` : 'Sin base de comparación')}
</div>
<h3>Hallazgos</h3>
${haz.length ? `<ol class="hallazgos">${haz.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : '<p class="sd">Sin hallazgos que reportar: no hay datos suficientes.</p>'}
<div class="aviso frontera"><b>Cómo leer este informe:</b> es lámina bruta entregada (volumen del informe ÷ superficie), no consumo de la planta ni eficiencia. Describe qué dicen las cifras de ACUM_INF; no atribuye causas a los cambios entre años.</div>
<p class="nota-pie">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios. Fuente: informe ACUM_INF de la SRL (corte de septiembre) y hoja SRL provisional para el ciclo actual. Documento generado automáticamente por SICA 005.</p>`);
        paginas[0].cabecera = cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta });
    }

    // ── Lámina por cultivo
    {
        const maxL = Math.max(1, ...series.flatMap((s) => s.celdas.map((c) => c.laminaCm ?? 0)));
        const filasTabla = series.map((s) => `<tr><th scope="row" class="cul">${esc(s.cultivo)}</th>${anios.map((a) => {
            const c = s.celdas.find((x) => x.anio === a);
            if (!c || c.laminaCm == null) return `<td class="n sd">${SD}</td>`;
            const marca = c.laminaAtipica || c.atipicoFuente || c.muestraChica;
            return `<td class="n${c.laminaAtipica || c.atipicoFuente ? ' alerta' : ''}">${fmt(c.laminaCm, 0)}${marca ? ' ⚠' : ''}<span class="mini${c.muestraChica ? ' hueca' : ''}"><i style="width:${Math.max(3, (c.laminaCm / maxL) * 100).toFixed(0)}%"></i></span><small>${fmtMiles(c.superficieHa, 0)} ha</small></td>`;
        }).join('')}${s.mediaLaminaCm != null ? tdN(fmt(s.mediaLaminaCm, 0)) : tdN(SD)}</tr>`).join('');
        const mat = matrizModuloAnio(filas, MODULOS_INFORME_VC);
        const filasMod = mat.map((m) => `<tr><th scope="row" class="cul">Módulo ${m.modulo}</th>${m.celdas.map((c) => (c.laminaCm == null ? `<td class="n sd">${SD}</td>` : `<td class="n">${fmt(c.laminaCm, 0)}<small>${fmtMiles(c.superficieHa, 0)} ha · ${fmt(c.volumenHm3, 1)} hm³</small></td>`)).join('')}</tr>`).join('');
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Lámina por cultivo</h2>
${series.length ? `<figure class="fig" style="margin:0 0 6px">${svgLaminaMiniaturas(series, anios)}</figure>
<p class="fuente">Los seis cultivos de mayor volumen, con una sola escala desde cero. Barra hueca = superficie menor a ${UMBRAL_HA_MUESTRA} ha (muestra pequeña). ⚠ = lámina lejos de los demás años, muestra pequeña o captura atípica en la fuente.</p>
<div class="tabla-wrap"><table class="compacta"><caption>Lámina bruta (cm) = volumen ÷ superficie, todo el distrito (la superficie va debajo de cada cifra)</caption><thead><tr><th>Cultivo</th>${anios.map((a) => `<th class="n">${a}</th>`).join('')}<th class="n">Media</th></tr></thead><tbody>${filasTabla}</tbody></table></div>
<p class="fuente">La media usa solo los años con superficie de ${UMBRAL_HA_MUESTRA} ha o más. Una lámina se marca como atípica cuando se aleja más de ${Z_ATIPICA} desviaciones de la de los otros años del mismo cultivo (se pide al menos 4 años).</p>
<div class="tabla-wrap"><table class="compacta"><caption>Lámina media por módulo, todos los cultivos (cm; superficie y volumen debajo)</caption><thead><tr><th>Módulo</th>${anios.map((a) => `<th class="n">${a}</th>`).join('')}</tr></thead><tbody>${filasMod}</tbody></table></div>`
    : `<div class="aviso"><b>S/D:</b> no hay renglones del informe ACUM_INF para calcular la lámina.</div>`}`);
    }

    // ── Mezcla y contraste
    {
        const m = anioUlt != null ? mezclaCultivos(filas, null, anioUlt) : [];
        const filasMezcla = m.map((p) => `<tr><th scope="row" class="cul">${esc(p.cultivo)}</th>${tdN(p.superficieHa != null ? fmtMiles(p.superficieHa, 0) : SD)}${tdN(p.pctSuperficie != null ? fmt(p.pctSuperficie, 1) : SD)}${tdN(p.volumenHm3 != null ? fmt(p.volumenHm3, 1) : SD)}${tdN(p.pctVolumen != null ? fmt(p.pctVolumen, 1) : SD)}</tr>`).join('');
        const filasContr = contraste ? contraste.cultivos.slice(0, 8).map((c) => `<tr><th scope="row" class="cul">${esc(c.cultivo)}</th>${tdN(c.pctVolAltos != null ? fmt(c.pctVolAltos, 1) : SD)}${tdN(c.pctVolBajos != null ? fmt(c.pctVolBajos, 1) : SD)}${tdN(c.deltaPp != null ? sg(c.deltaPp, 1) : SD)}</tr>`).join('') : '';
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Mezcla de cultivos y contraste entre años altos y bajos</h2>
${anios.length ? `<h3>Participación en el volumen por año</h3><figure class="fig" style="margin:0 0 4px">${svgMezclaApilada(filas, anios)}</figure>` : ''}
${m.length ? `<div class="tabla-wrap"><table class="compacta"><caption>Peso por cultivo, ${anioUlt}, todo el distrito</caption><thead><tr><th>Cultivo</th><th class="n">Superficie (ha)</th><th class="n">% sup.</th><th class="n">Volumen (hm³)</th><th class="n">% vol.</th></tr></thead><tbody>${filasMezcla}</tbody></table></div>` : `<div class="aviso"><b>S/D:</b> sin renglones para la mezcla.</div>`}
${contraste ? `<div class="tabla-wrap"><table class="compacta"><caption>Años altos (${contraste.altos.join(', ')}) contra años bajos (${contraste.bajos.join(', ')}): peso de cada cultivo en el volumen</caption><thead><tr><th>Cultivo</th><th class="n">% vol. altos</th><th class="n">% vol. bajos</th><th class="n">Diferencia (pp)</th></tr></thead><tbody>${filasContr}</tbody></table></div>
<p class="fuente">Los años «altos» y «bajos» se separan por la superficie total regada (punto medio entre el mínimo y el máximo; superficie por año: ${contraste.superficiePorAnio.map((s) => `${s.anio} ${fmtMiles(s.ha, 0)} ha`).join(', ')}). Es una descripción: no dice por qué cambió la superficie.</p>`
    : '<div class="aviso frontera"><b>Sin contraste claro:</b> se pide al menos 4 años y una superficie máxima 1.5 veces la mínima. No se inventa uno.</div>'}`);
    }

    // ── Ciclo actual
    {
        const filasCiclo = refs.map((r) => `<tr><th scope="row" class="cul">Módulo ${r.modulo}</th>${tdN(r.minHm3 != null ? fmt(r.minHm3, 1) : SD)}${tdN(r.medianaHm3 != null ? fmt(r.medianaHm3, 1) : SD)}${tdN(r.maxHm3 != null ? fmt(r.maxHm3, 1) : SD)}${r.actualHm3 != null ? `<td class="n">${fmt(r.actualHm3, 1)}${r.actualIncompleto ? ' ⚠' : ''}</td>` : `<td class="n sd">${SD}</td>`}${tdN(r.pctVsMediana != null ? `${sg(r.pctVsMediana, 0)} %` : SD)}<td>${esc(TXT_POS[r.posicion])}${r.actualIncompleto ? ' · volumen incompleto' : ''}</td></tr>`).join('');
        const aviso = d.volumenActual == null
            ? '<div class="aviso"><b>S/D:</b> el volumen provisional del ciclo actual no se cargó al generar el informe. Queda sin dato, no en cero.</div>'
            : d.volumenActual.error ? `<div class="aviso"><b>S/D:</b> no se pudo leer el volumen de la hoja SRL (${esc(d.volumenActual.error)}). El ciclo actual queda sin dato, no en cero.</div>` : '';
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Ciclo actual contra el rango 2020-2024</h2>
${aviso}<figure class="fig" style="margin:0 0 4px">${svgRangoCiclo(refs)}</figure>
<div class="tabla-wrap"><table class="compacta"><caption>Volumen entregado mar–sep por módulo (hm³): ciclo actual provisional contra 2020-2024</caption><thead><tr><th>Módulo</th><th class="n">Mín.</th><th class="n">Mediana</th><th class="n">Máx.</th><th class="n">Actual</th><th class="n">vs mediana</th><th>Lectura</th></tr></thead><tbody>${filasCiclo}</tbody></table></div>
<p class="fuente">La hoja SRL no desglosa por cultivo: la comparación es solo por módulo. ⚠ = faltan meses de la ventana mar–sep o alguno es parcial; ese volumen no es comparable con un año completo. Con 5 años el rango es una referencia, no un intervalo estadístico.</p>
<div class="aviso"><b>Fuentes distintas:</b> 2020-2024 sale de ACUM_INF (corte de septiembre) y el ciclo actual de la hoja SRL, provisional. Ambas no están conciliadas; una diferencia entre ellas puede ser de método y no del agua entregada.</div>`);
    }

    // ── Anexo A: atípicos
    {
        const f = atipicos.map((a) => `<tr><th scope="row" class="cul">${esc(a.cultivo)}</th><td class="n">${a.anio}</td>${tdN(a.laminaCm != null ? fmt(a.laminaCm, 0) : SD)}${tdN(a.superficieHa != null ? fmtMiles(a.superficieHa, 0) : SD)}<td>${esc(a.motivos.join('; '))}</td></tr>`).join('');
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Celdas y renglones atípicos</h2>
<p>Se muestran tal como vienen en la fuente; ninguna cifra se corrige, se omite ni se sustituye. La fuente marca ${nHaz(renglonesAtipicosFuente, 'renglón', 'renglones')} de ${fmtMiles(filas.length, 0)} como captura atípica.</p>
${atipicos.length ? `<div class="tabla-wrap"><table class="compacta"><caption>Celdas cultivo-año con ⚠ (${atipicos.length})</caption><thead><tr><th>Cultivo</th><th class="n">Año</th><th class="n">Lámina (cm)</th><th class="n">Superficie (ha)</th><th>Motivo</th></tr></thead><tbody>${f}</tbody></table></div>` : '<div class="aviso ok">Ninguna celda cultivo-año cumple los criterios de alerta.</div>'}`);
    }

    // ── Anexo B: notas de fuente, método y trazabilidad
    {
        const traza = tablaTrazabilidad([
            { k: 'Folio', v: folio },
            { k: 'Emisión', v: `${fechaHoraLegible(d.emitidoEn)} · ${d.emisor}` },
            { k: 'Años cubiertos', v: anios.length ? anios.join(', ') : 'S/D' },
            { k: 'Renglones de ACUM_INF', v: String(filas.length) },
            { k: 'Ciclo actual', v: d.volumenActual && !d.volumenActual.error ? `Hoja SRL, provisional${d.volumenActual.mesesParciales.length ? ` (meses parciales: ${d.volumenActual.mesesParciales.join(', ')})` : ''}` : 'S/D' },
            { k: 'Versión de plantilla', v: PLANTILLA },
            { k: 'Versión de SICA 005', v: d.version },
            { k: 'Hash del contenido', v: hash },
            { k: 'Consulta de la fuente', v: d.errorSupVol ? `Fallida: ${d.errorSupVol}` : 'Sin errores' },
        ]);
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Notas de fuente, método y trazabilidad</h2>
<div class="cols3"><div><h3>Fuente</h3><ul style="margin:0;padding-left:14px">
<li><b>ACUM_INF 2020-2024:</b> informe anual de la SRL con superficie y volumen por módulo y cultivo, con corte de septiembre.</li>
<li><b>2026 (ciclo actual):</b> hoja SRL, provisional y no conciliada con ACUM_INF.</li>
<li><b>Año calendario:</b> se asume que cada año del informe es el año calendario de su corte; la fuente no lo declara por renglón.</li>
<li>Los módulos son 1, 2, 3, 4, 5 y 12; el distrito es su suma.</li></ul></div>
<div><h3>Método</h3>
<p>Lámina bruta (cm) = volumen (miles de m³) ÷ superficie (ha) × 10.</p>
<p>Años «altos» y «bajos»: punto medio entre la superficie total mínima y máxima, solo si el máximo es al menos 1.5 veces el mínimo y hay 4 años o más.</p>
<p>Ciclo actual: suma de mar–sep por módulo contra el mínimo, la mediana y el máximo de 2020-2024.</p>
<p>Un dato faltante es S/D; nunca se muestra como 0.</p></div>
<div><h3>Límites</h3><ul style="margin:0;padding-left:14px">
<li>Descriptivo: no atribuye causas a los cambios entre años.</li>
<li>Es lámina entregada, no consumo de la planta ni eficiencia de riego.</li>
<li>Con 5 años no hay inferencia estadística; el rango es una referencia.</li>
<li>La lámina de un cultivo con menos de ${UMBRAL_HA_MUESTRA} ha es poco representativa y se marca.</li></ul></div></div>
<h3>Trazabilidad</h3>${traza}
<h3>Firmas</h3>${bloqueFirmas({ nombres: { Elaboró: d.emisor } })}`);
    }

    const total = paginas.length;
    const cuerpo = paginas.map((p, i) => `<section class="pagina">${p.cabecera}<div class="cuerpo">${p.cuerpo}</div>${pieInforme(`Folio ${folio} · SICA 005 v${d.version}`, i + 1, total)}</section>`).join('\n');
    return documentoHtml({
        titulo: `${TITULO_INFORME_VC} — SRL Unidad Conchos`,
        css: minificaCss(cssInforme({ formato: 'letter' }) + EXTRA_CSS),
        cuerpo: unificaFuenteSvg(cuerpo),
        metas: { 'sica-folio': folio, 'sica-plantilla': PLANTILLA, 'sica-hash': hash },
    });
}
