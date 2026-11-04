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
import { RANGO_INFORME, RANGO_ACUM, ANIOS_SIN_CICLO, ANIO_INFORME_FIN, TEXTO_SIN_CICLO, esAnioSinCiclo } from './estadoAnio';
import { fondoTramaCss, iconoCultivoG, iconoCultivoSvg, infoCultivo, patronTrama } from './cultivos';
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import {
    UMBRAL_HA_MUESTRA, Z_ATIPICA, cifraContraste, contrasteRegimenes, fraseContrasteSuperficie, kpiCiclo, lecturaVsTipico, kpiLamina, kpiMezcla, laminaPorCultivo, listaAtipicos, matrizModuloAnio, mezclaCultivos,
    referenciaCicloActual, composicionAnual, notaIncompleta, marcaAnioIncompleto, NOTA_TODOS_INCOMPLETOS, type PosicionCiclo, type ReferenciaModulo, type SerieCultivo,
} from './volumenCultivo';

export const MODULOS_INFORME_VC = [1, 2, 3, 4, 5, 12];
export const TITULO_INFORME_VC = `Consumo por año, módulo y cultivo (ACUM_INF ${RANGO_ACUM})`;
const NOTA_SIN_CICLO = `${ANIOS_SIN_CICLO.join(', ')}: ${TEXTO_SIN_CICLO.replace(/^Sin ciclo: /, 'sin ciclo de riego, ')} No tiene cifras de volumen ni superficie y no entra a promedios, año típico ni rangos.`;
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
/** Encabezado de fila de un cultivo: ícono en su color y nombre escrito. */
const cultivoTh = (nombre: string): string => `<th scope="row" class="cul">${iconoCultivoSvg(nombre, 12, infoCultivo(nombre).colorClaro)}${esc(nombre)}</th>`;
const tdN = (txt: string, extra = '') => (txt === SD ? `<td class="n sd">${SD}</td>` : `<td class="n">${esc(txt)}${extra}</td>`);
const TXT_POS: Record<PosicionCiclo, string> = { 'bajo-rango': '▼ Debajo del rango', dentro: '● Dentro del rango', 'sobre-rango': '▲ Arriba del rango', 'sin-dato': 'Sin dato (S/D)' };

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
        const col = infoCultivo(s.cultivo).colorClaro;
        const ox = (i % 3) * (PW + GAP), oy = Math.floor(i / 3) * PH;
        const barras = anios.map((a, k) => {
            const c = s.celdas.find((x) => x.anio === a);
            const cx = 4 + slot * k + slot / 2;
            const rotA = `<text x="${f1(cx)}" y="${base + 13}" text-anchor="middle" font-size="${FS}" fill="${INK2}">${a}</text>`;
            if (!c || c.laminaCm == null) return `<text x="${f1(cx)}" y="${base - 4}" text-anchor="middle" font-size="${FS}" font-style="italic" fill="#6a737d">S/D</text>${rotA}`;
            const h = Math.max(2, (c.laminaCm / maxL) * alto);
            const marca = c.laminaAtipica || c.atipicoFuente || c.muestraChica ? ' ⚠' : '';
            const rect = c.muestraChica
                ? `<rect x="${f1(cx - bw / 2)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="2" fill="#fff" stroke="${col}" stroke-width="1.6"/>`
                : `<rect x="${f1(cx - bw / 2)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="2" fill="${col}"/>`;
            return `${rect}<text x="${f1(cx)}" y="${f1(base - h - 3)}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}">${Math.round(c.laminaCm)}${marca}</text>${rotA}`;
        }).join('');
        return `<g transform="translate(${ox} ${oy})">${iconoCultivoG(s.cultivo, 3, -1, 16, col)}<text x="23" y="12" font-size="11.5" font-weight="700" fill="${INK}">${esc(s.cultivo)}</text><line x1="4" x2="${PW - 4}" y1="${base}" y2="${base}" stroke="${GRID}"/>${barras}</g>`;
    }).join('');
    const resumen = top.map((s) => `${s.cultivo}: ${anios.map((a) => { const c = s.celdas.find((x) => x.anio === a); return `${a} ${c?.laminaCm != null ? `${Math.round(c.laminaCm)} cm` : 'S/D'}`; }).join(', ')}`).join('. ');
    return `<svg viewBox="0 0 ${W} ${filas * PH}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Agua entregada por hectárea, en centímetros, por año de los ${top.length} cultivos que más agua reciben. ${esc(resumen)}"><title>Agua entregada por hectárea (cm) por cultivo y año, misma escala desde cero</title>${paneles}</svg>`;
}

/** Cultivo con color, ícono y trama en una leyenda HTML (se lee también en blanco y negro). */
const leyendaCultivo = (nombre: string, esOtros = false, titulo?: string): string => {
    const i = esOtros ? infoCultivo('Otros') : infoCultivo(nombre);
    return `<li${titulo ? ` title="${esc(titulo)}"` : ''}><i class="sw" style="background:${fondoTramaCss(i.trama, i.colorClaro, 'rgba(0,0,0,.38)')}"></i>${iconoCultivoSvg(i.nombre, 12, i.colorClaro)}${esc(nombre)}</li>`;
};

/**
 * Barras 100 % apiladas por año, con los cultivos de siempre en el mismo orden, su color, su trama (legible en blanco y negro) y su porcentaje escrito.
 * 2025 sale como hueco «sin ciclo»; un año sin renglones, S/D. Leyenda con ícono y nombre.
 */
export function svgMezclaApilada(filas: FilaSupVol[], anios: number[]): string {
    if (!anios.length) return '';
    const comp = composicionAnual(filas, null, 'volumen');
    const W = 660, X0 = 54, X1 = 566, RH = 28;
    const extra = ANIOS_SIN_CICLO.filter((a) => !anios.includes(a));
    const tramas = new Map(comp.leyenda.map((l) => { const i = infoCultivo(l.esOtros ? 'Otros' : l.nombre); return [l.clave + l.nombre, { id: `tr-mz-${i.clave}`, i }] as const; }));
    const defs = [...tramas.values()].filter((t) => t.i.trama !== 'liso').map((t) => patronTrama(t.id, t.i.trama, 'rgba(0,0,0,.34)')).join('');
    // 2026 ya trae desglose del informe; «sin desglose» solo si ese año faltara en la base. Filas en orden cronológico (2025 queda entre 2024 y 2026).
    const filasAnio = [...anios.map((a) => ({ a, sin: false, prov: false })), ...extra.map((a) => ({ a, sin: true, prov: false })), ...(anios.includes(ANIO_INFORME_FIN) ? [] : [{ a: ANIO_INFORME_FIN, sin: false, prov: true }])].sort((x, y) => x.a - y.a);
    const rows = filasAnio.map(({ a, sin, prov }, i) => {
        const y = 6 + i * RH;
        if (prov) return `<text x="4" y="${y + 15}" font-size="${FS}" font-weight="700" fill="${INK}">${a}</text><rect x="${X0}" y="${y}" width="${X1 - X0}" height="20" rx="6" fill="none" stroke="${INK2}" stroke-width="1.2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/><text x="${X0 + 8}" y="${y + 14.5}" font-size="${FS}" font-style="italic" fill="${INK2}">Provisional: sin desglose por cultivo</text>`;
        if (sin) return `<text x="4" y="${y + 15}" font-size="${FS}" font-weight="700" fill="${INK}">${a}</text><rect x="${X0}" y="${y}" width="${X1 - X0}" height="20" rx="6" fill="none" stroke="${INK2}" stroke-width="1.2" stroke-dasharray="4 3"/><text x="${X0 + 8}" y="${y + 14.5}" font-size="${FS}" font-style="italic" fill="${INK2}">Sin ciclo: presas cerradas</text>`;
        const fila = comp.filas.find((x) => x.anio === a && x.estado === 'con-informe');
        if (!fila || !fila.total) return `<text x="4" y="${y + 15}" font-size="${FS}" font-weight="700" fill="${INK}">${a}</text><text x="${X0}" y="${y + 15}" font-size="${FS}" font-style="italic" fill="#6a737d">S/D</text>`;
        let x = X0;
        const segs = fila.partes.map((p) => {
            const w = (p.pct / 100) * (X1 - X0);
            const ini = x; x += w;
            if (w < 0.5) return '';
            const t = tramas.get(p.clave + p.nombre) ?? { id: '', i: infoCultivo(p.nombre) };
            const ww = Math.max(0, w - 2);
            const pillW = w > 78 ? 40 : 25, cx = ini + ww / 2;
            const etiqueta = w > 30
                ? `<rect x="${f1(cx - pillW / 2)}" y="${y + 3.5}" width="${pillW}" height="13" rx="4" fill="#fff" fill-opacity=".92"/>${w > 78 ? iconoCultivoG(p.nombre, cx - pillW / 2 + 3, y + 4.5, 11, t.i.colorClaro) : ''}<text x="${f1(w > 78 ? cx + 5 : cx)}" y="${y + 13.6}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}">${p.pct.toFixed(0)} %</text>`
                : '';
            return `<rect x="${f1(ini)}" y="${y}" width="${f1(ww)}" height="20" rx="4" fill="${t.i.colorClaro}"/>${t.i.trama !== 'liso' ? `<rect x="${f1(ini)}" y="${y}" width="${f1(ww)}" height="20" rx="4" fill="url(#${t.id})"/>` : ''}${etiqueta}`;
        }).join('');
        return `<text x="4" y="${y + 15}" font-size="${FS}" font-weight="700" fill="${INK}">${a}${marcaAnioIncompleto(comp, fila) ? ' ⚠' : ''}</text>${segs}<text x="${X1 + 6}" y="${y + 15}" font-size="${FS}" fill="${INK2}">${fmt(fila.total, 0)} hm³</text>`;
    }).join('');
    const desc = anios.map((a) => { const k = kpiMezcla(filas, null, a); return `${a}: alfalfa y nogal ${k.pctVolumenAlfalfaNogal != null ? `${Math.round(k.pctVolumenAlfalfaNogal)} %` : 'S/D'} del agua entregada`; }).join('; ');
    const avisos = comp.todosIncompletos
        ? [`⚠ ${NOTA_TODOS_INCOMPLETOS}`]
        : comp.filas.filter((x) => x.estado === 'con-informe' && anios.includes(x.anio)).map((x) => notaIncompleta(x, 'volumen')).filter((n): n is string => !!n);
    const alto = filasAnio.length * RH + 8;
    return `<svg viewBox="0 0 ${W} ${alto}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Parte del agua entregada que recibe cada cultivo, por año. ${esc(desc)}"><title>Parte del agua entregada que recibe cada cultivo en cada año</title><defs>${defs}</defs>${rows}</svg>
<ul class="ley" aria-label="Leyenda de cultivos">${comp.leyenda.map((l) => leyendaCultivo(l.esOtros ? `${l.nombre} (${l.cultivos.join(', ')})` : l.nombre, l.esOtros)).join('')}</ul>
<p class="fuente">Los porcentajes se redondean; pueden sumar 99 o 101 %. «Varios» = cultivos sin desglose en el informe.${avisos.map((n) => ` ${esc(n)}`).join('')}</p>`;
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
        const txt = `Rango ${fmt(r.minHm3, 1)}–${fmt(r.maxHm3, 1)} · año típico ${fmt(r.medianaHm3, 1)} · actual ${r.actualHm3 != null ? `${fmt(r.actualHm3, 1)} hm³` : SD}`;
        return `${rot}<line x1="${X0}" x2="${X1}" y1="${cy}" y2="${cy}" stroke="${GRID}"/><rect x="${f1(x(r.minHm3))}" y="${cy - 6}" width="${f1(Math.max(2, x(r.maxHm3) - x(r.minHm3)))}" height="12" rx="2" fill="#c9ced6"/>${med}${act}<text x="${X1 + 22}" y="${cy + 4}" font-size="${FS}" fill="${INK}">${esc(txt)}</text>`;
    }).join('');
    const desc = refs.map((r) => `Módulo ${r.modulo}: ${r.actualHm3 != null ? `${fmt(r.actualHm3, 1)} hm³, ${TXT_POS[r.posicion].replace(/^[▲▼●] /, '').toLowerCase()}` : 'sin dato actual'}`).join('; ');
    return `<svg viewBox="0 0 ${W} ${refs.length * RH + 8}" width="100%" style="max-width:${W}px;display:block" role="img" aria-label="Ciclo actual contra el rango ${RANGO_INFORME} por módulo. ${esc(desc)}"><title>Ciclo actual contra el rango ${RANGO_INFORME} por módulo (escala propia de cada módulo)</title>${rows}</svg>
<ul class="ley" aria-label="Leyenda"><li><i class="b"></i>Rango ${RANGO_INFORME}</li><li><i class="m"></i>Año típico</li><li><i class="r"></i>Ciclo ${ANIO_INFORME_FIN} (rombo; hueco = bajo el mínimo)</li></ul>`;
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
.mini i{display:block;height:100%;background:var(--cu,${AZUL});border-radius:2px}
.mini.hueca i{background:#fff;box-shadow:inset 0 0 0 1px var(--cu,${AZUL})}
.ley{display:flex;flex-wrap:wrap;gap:3px 14px;list-style:none;padding:0;margin:4px 0 0;font-size:7.5pt}
.ley li{display:inline-flex;align-items:center;gap:5px}
.ley i{display:inline-block;width:16px;height:9px;border-radius:2px}
.ley i.sw{width:18px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.25)} .ley .ico-cul{margin-right:-2px}
th.cul .ico-cul{margin-right:4px}
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
    // Un renglón de un año sin ciclo (2025) no es dato: se descarta antes de cualquier cálculo o tabla.
    const filas = d.filas.filter((f) => !esAnioSinCiclo(f.anio));
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
    // El último año ya está en el informe ACUM_INF (ciclo terminado): se compara con la misma fuente que la referencia; la hoja SRL queda como contraste.
    const cicloInforme = refs.some((r) => r.fuenteActual === 'informe');
    const soloSrl = refs.some((r) => r.fuenteActual === 'srl');
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
            haz.push(`En ${kl.anio}, el agua entregada por hectárea en el distrito fue ${kl.laminaMediaCm != null ? `de ${fmt(kl.laminaMediaCm, 0)} cm` : 'S/D'}${kl.cultivoMayor ? `; el cultivo que más agua recibió por hectárea fue ${kl.cultivoMayor.cultivo} (${fmt(kl.cultivoMayor.laminaCm, 0)} cm)` : ''}.`);
        }
        if (km.pctVolumenAlfalfaNogal != null) haz.push(`Alfalfa y nogal suman ${fmt(km.pctVolumenAlfalfaNogal, 0)} % del agua entregada en ${anioUlt}.`);
        if (km.altosVsBajos) haz.push(`${fraseContrasteSuperficie(km.altosVsBajos)} Superficie media de los años de más superficie: ${fmtMiles(km.altosVsBajos.altosHa, 0)} ha; de los años de menos superficie: ${fmtMiles(km.altosVsBajos.bajosHa, 0)} ha.`);
        haz.push(NOTA_SIN_CICLO);
        // Con dato, el ciclo actual ya está en las tarjetas «Módulos dentro del rango» y «Frente a un año típico»; solo el S/D se repite aquí para que no pase en silencio.
        if (!kc.modulosConDato) haz.push('Ciclo actual: S/D (el informe ACUM_INF no trae el último año y no se pudo leer la hoja SRL; no se estima ni se llena con cero).');
        if (atipicos.length) haz.push(`${nHaz(atipicos.length, 'celda', 'celdas')} por revisar, marcadas con ⚠ (cifra lejos de los demás años, superficie menor a ${UMBRAL_HA_MUESTRA} ha o captura atípica en la fuente); se listan en el anexo A y no se corrigen.`);
        const kpiHtml = (et: string, v: string | null, unidad: string, ctx: string, texto = false) =>
            `<div class="kpi${v == null ? ' sd' : ''}"><div class="et">${esc(et)}</div><div class="v${texto ? ' t' : ''}">${v == null ? SD : esc(v)}${v != null && unidad ? `<small>${esc(unidad)}</small>` : ''}</div><div class="s">${ctx}</div></div>`;
        agrega(`<div class="banda"><small>Centro de Inteligencia Agroclimática · SICA 005</small>
  <h1>Consumo por año, módulo y cultivo <span style="white-space:nowrap">(ACUM_INF ${RANGO_ACUM})</span></h1>
  <div class="sub">Distrito de Riego 005 Delicias, Chihuahua · 6 módulos SRL · informe estadístico descriptivo</div></div>
<div class="datos">
  <div class="dato"><b>Años cubiertos</b><span>${esc(periodo)}</span></div>
  <div class="dato"><b>Renglones de la fuente</b><span>${fmtMiles(filas.length, 0)}</span></div>
  <div class="dato"><b>Cultivos</b><span>${series.length || SD}</span></div>
  <div class="dato"><b>Ciclo actual</b><span>${cicloInforme && !soloSrl ? `${ANIO_INFORME_FIN} · ACUM_INF (terminado)` : d.volumenActual && !d.volumenActual.error ? 'Provisional (hoja SRL)' : 'S/D'}</span></div>
</div>
<h2><span class="n">${++nSec}</span>Resumen ejecutivo</h2>
${sinDatos ? `<div class="aviso"><b>Sin datos:</b> ${d.errorSupVol ? `no se pudo leer el informe ACUM_INF (${esc(d.errorSupVol)}). Esto no significa que no haya datos.` : 'el informe ACUM_INF no tiene renglones cargados.'} Todas las secciones aparecen como S/D.</div>` : ''}
<div class="kpis tres">
${kpiHtml(`Agua por hectárea ${kl.anio ?? ''}`.trim(), kl.laminaMediaCm != null ? fmt(kl.laminaMediaCm, 0) : null, 'cm', 'Entregada, no lo que gastó la planta; todo el distrito')}
${kpiHtml('Cultivo que más agua recibe por hectárea', kl.cultivoMayor?.cultivo ?? null, '', kl.cultivoMayor ? `<b>${fmt(kl.cultivoMayor.laminaCm, 0)} cm</b> en ${kl.anio} (cultivos de ${UMBRAL_HA_MUESTRA} ha o más)` : 'Sin cultivo con superficie suficiente', true)}
${kpiHtml('Cifras por revisar', kl.celdas ? String(kl.alertas) : null, kl.celdas ? `de ${kl.celdas}` : '', 'Se muestran marcadas, no se corrigen')}
${kpiHtml('Alfalfa y nogal', km.pctVolumenAlfalfaNogal != null ? fmt(km.pctVolumenAlfalfaNogal, 0) : null, '% del agua entregada', `en ${anioUlt ?? 'S/D'}, todo el distrito`)}
${kpiHtml(`Superficie regada ${anioUlt ?? ''}`.trim(), km.superficieTotalHa != null ? fmtMiles(km.superficieTotalHa, 0) : null, 'ha', 'Suma de cultivos del informe ACUM_INF')}
${kpiHtml('Cambio de superficie entre años', cifraContraste(km.altosVsBajos), '', km.altosVsBajos ? `<b>${fmtMiles(km.altosVsBajos.altosHa, 0)} ha</b> contra <b>${fmtMiles(km.altosVsBajos.bajosHa, 0)} ha</b> en promedio (años de más y de menos superficie).` : 'Sin contraste claro', true)}
${kpiHtml('Módulos dentro del rango', kc.modulosConDato ? `${kc.dentro} de ${kc.modulosTotal}` : null, '', kc.modulosConDato ? `${kc.sobre} arriba del máximo · ${kc.bajo} debajo del mínimo${kc.sinDato ? ` · ${kc.sinDato} S/D` : ''}` : 'Ciclo actual sin dato', true)}
${kpiHtml(cicloInforme && !soloSrl ? `Agua entregada en el ciclo ${ANIO_INFORME_FIN}` : 'Volumen actual (mar–sep)', kc.actualHm3 != null ? fmt(kc.actualHm3, 1) : null, cicloInforme && !soloSrl ? 'hm³' : 'hm³ provisional', kc.modulosConDato && kc.modulosConDato < kc.modulosTotal ? `Suma de ${kc.modulosConDato} de ${kc.modulosTotal} módulos con dato` : cicloInforme && !soloSrl ? 'Informe ACUM_INF, ciclo terminado; la hoja SRL se muestra aparte como contraste' : 'Hoja SRL, sin conciliar con ACUM_INF')}
${kpiHtml(`Frente a un año típico ${RANGO_INFORME}`, kc.pctVsMediana != null ? `${sg(kc.pctVsMediana, 0)} %` : null, '', kc.medianaHm3 != null ? `${esc(lecturaVsTipico(kc.pctVsMediana)?.frase ?? '')}` : 'Sin base de comparación')}
</div>
<h3>Lo que dicen las cifras</h3>
${haz.length ? `<ol class="hallazgos">${haz.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : '<p class="sd">Sin hallazgos que reportar: no hay datos suficientes.</p>'}
<div class="aviso frontera"><b>Cómo leer este informe:</b> es agua entregada por hectárea (volumen ÷ superficie), no consumo de la planta ni eficiencia. Describe las cifras de ACUM_INF; no atribuye causas.</div>`);
        paginas[0].cabecera = cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: 'Distrito de Riego 005', meta });
    }

    // ── Lámina por cultivo
    {
        const maxL = Math.max(1, ...series.flatMap((s) => s.celdas.map((c) => c.laminaCm ?? 0)));
        const filasTabla = series.map((s) => `<tr>${cultivoTh(s.cultivo)}${anios.map((a) => {
            const c = s.celdas.find((x) => x.anio === a);
            if (!c || c.laminaCm == null) return `<td class="n sd">${SD}</td>`;
            const marca = c.laminaAtipica || c.atipicoFuente || c.muestraChica;
            return `<td class="n${c.laminaAtipica || c.atipicoFuente ? ' alerta' : ''}">${fmt(c.laminaCm, 0)}${marca ? ' ⚠' : ''}<span class="mini${c.muestraChica ? ' hueca' : ''}" style="--cu:${infoCultivo(s.cultivo).colorClaro}"><i style="width:${Math.max(3, (c.laminaCm / maxL) * 100).toFixed(0)}%"></i></span><small>${fmtMiles(c.superficieHa, 0)} ha</small></td>`;
        }).join('')}${s.mediaLaminaCm != null ? tdN(fmt(s.mediaLaminaCm, 0)) : tdN(SD)}</tr>`).join('');
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Agua entregada por hectárea, por cultivo</h2>
${series.length ? `<figure class="fig" style="margin:0 0 6px">${svgLaminaMiniaturas(series, anios)}</figure>
<p class="fuente">Los seis cultivos que más agua reciben, con una sola escala desde cero. Barra hueca = superficie menor a ${UMBRAL_HA_MUESTRA} ha (poca superficie). ⚠ = cifra por revisar: lejos de los demás años, poca superficie o captura atípica en la fuente.</p>
<div class="tabla-wrap"><table class="compacta"><caption>Agua entregada por hectárea (cm) = volumen ÷ superficie, todo el distrito (la superficie va debajo de cada cifra)</caption><thead><tr><th>Cultivo</th>${anios.map((a) => `<th class="n">${a}</th>`).join('')}<th class="n">Promedio</th></tr></thead><tbody>${filasTabla}</tbody></table></div>
<p class="fuente">2025 no tiene cifras: sin ciclo, no es dato faltante. El promedio usa solo años con ${UMBRAL_HA_MUESTRA} ha o más. Atípica = a más de ${Z_ATIPICA} desviaciones de los otros años del mismo cultivo (mínimo 4 años).</p>`
    : `<div class="aviso"><b>S/D:</b> no hay renglones del informe ACUM_INF cargados para calcular el agua por hectárea. Es un dato que falta cargar, no un año sin riego.</div>`}`);
    }

    // ── Mezcla y contraste
    {
        const m = anioUlt != null ? mezclaCultivos(filas, null, anioUlt) : [];
        const filasMezcla = m.map((p) => `<tr>${cultivoTh(p.cultivo)}${tdN(p.superficieHa != null ? fmtMiles(p.superficieHa, 0) : SD)}${tdN(p.pctSuperficie != null ? fmt(p.pctSuperficie, 1) : SD)}${tdN(p.volumenHm3 != null ? fmt(p.volumenHm3, 1) : SD)}${tdN(p.pctVolumen != null ? fmt(p.pctVolumen, 1) : SD)}</tr>`).join('');
        const filasContr = contraste ? contraste.cultivos.slice(0, 8).map((c) => `<tr>${cultivoTh(c.cultivo)}${tdN(c.pctVolAltos != null ? fmt(c.pctVolAltos, 1) : SD)}${tdN(c.pctVolBajos != null ? fmt(c.pctVolBajos, 1) : SD)}${tdN(c.deltaPp != null ? sg(c.deltaPp, 1) : SD)}</tr>`).join('') : '';
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Mezcla de cultivos y cambio de superficie entre años</h2>
${anios.length ? `<h3>Parte del agua que recibe cada cultivo, por año</h3><figure class="fig" style="margin:0 0 4px">${svgMezclaApilada(filas, anios)}</figure><p class="fuente">${esc(NOTA_SIN_CICLO)}</p>` : ''}
${m.length ? `<div class="tabla-wrap"><table class="compacta"><caption>Peso por cultivo, ${anioUlt}, todo el distrito</caption><thead><tr><th>Cultivo</th><th class="n">Superficie (ha)</th><th class="n">% de la superficie</th><th class="n">Agua (hm³)</th><th class="n">% del agua</th></tr></thead><tbody>${filasMezcla}</tbody></table></div>` : `<div class="aviso"><b>S/D:</b> sin renglones del informe ACUM_INF cargados para la mezcla (dato por cargar, no un año sin riego).</div>`}
${contraste ? `<div class="tabla-wrap"><table class="compacta"><caption>Años de más superficie (${contraste.altos.join(', ')}) y de menos superficie (${contraste.bajos.join(', ')}): parte del agua que recibió cada cultivo</caption><thead><tr><th>Cultivo</th><th class="n">% del agua, más superficie</th><th class="n">% del agua, menos superficie</th><th class="n">Diferencia (puntos de %)</th></tr></thead><tbody>${filasContr}</tbody></table></div>
<p class="fuente">Los años de «más superficie» y de «menos superficie» se separan por la superficie total regada (punto medio entre el año con menos y el año con más; superficie por año: ${contraste.superficiePorAnio.map((s) => `${s.anio} ${fmtMiles(s.ha, 0)} ha`).join(', ')}). Es una descripción: no dice por qué cambió la superficie.</p>`
    : '<div class="aviso frontera"><b>Sin contraste claro entre años:</b> se pide al menos 4 años y que el de más superficie tenga 1.5 veces la del de menos. No se inventa uno.</div>'}`);
    }

    // ── Ciclo actual
    {
        const mat = matrizModuloAnio(filas, MODULOS_INFORME_VC);
        const filasMod = mat.map((m) => `<tr><th scope="row" class="cul">Módulo ${m.modulo}</th>${m.celdas.map((c) => (c.laminaCm == null ? `<td class="n sd">${SD}</td>` : `<td class="n">${fmt(c.laminaCm, 0)}<small>${fmtMiles(c.superficieHa, 0)} ha · ${fmt(c.volumenHm3, 1)} hm³</small></td>`)).join('')}</tr>`).join('');
        const tablaMod = `<h3>Agua por hectárea en cada módulo, ${periodo}</h3><div class="tabla-wrap"><table class="compacta"><caption>Agua por hectárea en cada módulo, todos los cultivos (cm; superficie y volumen debajo)</caption><thead><tr><th>Módulo</th>${anios.map((a) => `<th class="n">${a}</th>`).join('')}</tr></thead><tbody>${filasMod}</tbody></table></div>`;
        const filasCiclo = refs.map((r) => `<tr><th scope="row" class="cul">Módulo ${r.modulo}</th>${tdN(r.minHm3 != null ? fmt(r.minHm3, 1) : SD)}${tdN(r.medianaHm3 != null ? fmt(r.medianaHm3, 1) : SD)}${tdN(r.maxHm3 != null ? fmt(r.maxHm3, 1) : SD)}${r.actualHm3 != null ? `<td class="n">${fmt(r.actualHm3, 1)}${r.actualIncompleto ? ' ⚠' : ''}</td>` : `<td class="n sd">${SD}</td>`}${tdN(r.pctVsMediana != null ? `${sg(r.pctVsMediana, 0)} %` : SD)}${r.srlHm3 != null ? `<td class="n">${fmt(r.srlHm3, 1)}${r.difSrlInformeHm3 != null && Math.abs(r.difSrlInformeHm3) >= 0.05 ? `<small>${sg(r.difSrlInformeHm3, 1)} hm³ frente al informe</small>` : ''}</td>` : `<td class="n sd">${SD}</td>`}<td>${esc(TXT_POS[r.posicion])}${r.actualIncompleto ? ' · volumen incompleto' : ''}</td></tr>`).join('');
        const aviso = cicloInforme ? ''
            : d.volumenActual == null
            ? '<div class="aviso"><b>S/D:</b> el volumen provisional del ciclo actual no se cargó al generar el informe. Queda sin dato, no en cero.</div>'
            : d.volumenActual.error ? `<div class="aviso"><b>S/D:</b> no se pudo leer el volumen de la hoja SRL (${esc(d.volumenActual.error)}). El ciclo actual queda sin dato, no en cero.</div>` : '';
        agrega(`<h2 style="margin-top:0"><span class="n">${++nSec}</span>Ciclo actual contra el rango ${RANGO_INFORME}</h2>
${aviso}<figure class="fig" style="margin:0 0 4px">${svgRangoCiclo(refs)}</figure>
<div class="tabla-wrap"><table class="compacta"><caption>Agua entregada por ciclo y módulo (hm³): ciclo ${ANIO_INFORME_FIN} contra ${RANGO_INFORME}${cicloInforme ? ', con la hoja SRL (mar–sep) como contraste' : ' (hoja SRL provisional)'}</caption><thead><tr><th>Módulo</th><th class="n">Mínimo</th><th class="n">Año típico</th><th class="n">Máximo</th><th class="n">Ciclo ${ANIO_INFORME_FIN}</th><th class="n">Frente al año típico</th><th class="n">Hoja SRL (mar–sep)</th><th>Lectura</th></tr></thead><tbody>${filasCiclo}</tbody></table></div>
<p class="fuente">${cicloInforme ? `El ciclo ${ANIO_INFORME_FIN} y ${RANGO_INFORME} salen del mismo informe ACUM_INF, así que se comparan entre iguales; su desglose por cultivo está en la sección de mezcla.` : 'La hoja SRL no desglosa por cultivo: la comparación es solo por módulo.'} ⚠ = faltan meses de la ventana mar–sep o alguno es parcial; ese volumen no es comparable con un año completo. Con 5 años el rango es una referencia, no un intervalo estadístico. ${esc(NOTA_SIN_CICLO)}</p>
<div class="aviso"><b>Fuentes distintas:</b> ${cicloInforme ? `la hoja SRL (mar–sep) no está conciliada con el informe ACUM_INF (corte de septiembre)` : `${RANGO_INFORME} sale de ACUM_INF (corte de septiembre) y el ciclo actual de la hoja SRL, provisional; ambas no están conciliadas`}; una diferencia entre ellas puede ser de método y no del agua entregada.</div>
${anios.length ? tablaMod : ''}`);
    }

    // ── Anexo A: atípicos
    {
        const f = atipicos.map((a) => `<tr>${cultivoTh(a.cultivo)}<td class="n">${a.anio}</td>${tdN(a.laminaCm != null ? fmt(a.laminaCm, 0) : SD)}${tdN(a.superficieHa != null ? fmtMiles(a.superficieHa, 0) : SD)}<td>${esc(a.motivos.join('; '))}</td></tr>`).join('');
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Celdas y renglones atípicos</h2>
<p>Se muestran tal como vienen en la fuente; ninguna cifra se corrige, se omite ni se sustituye. La fuente marca ${nHaz(renglonesAtipicosFuente, 'renglón', 'renglones')} de ${fmtMiles(filas.length, 0)} como captura atípica.</p>
${atipicos.length ? `<div class="tabla-wrap"><table class="compacta"><caption>Celdas cultivo-año con ⚠ (${atipicos.length})</caption><thead><tr><th>Cultivo</th><th class="n">Año</th><th class="n">Agua por hectárea (cm)</th><th class="n">Superficie (ha)</th><th>Motivo</th></tr></thead><tbody>${f}</tbody></table></div>` : '<div class="aviso ok">Ninguna celda cultivo-año cumple los criterios de alerta.</div>'}`);
    }

    // ── Anexo B: notas de fuente, método y trazabilidad
    {
        const traza = tablaTrazabilidad([
            { k: 'Folio', v: folio },
            { k: 'Emisión', v: `${fechaHoraLegible(d.emitidoEn)} · ${d.emisor}` },
            { k: 'Años cubiertos', v: anios.length ? anios.join(', ') : 'S/D' },
            { k: 'Renglones de ACUM_INF', v: String(filas.length) },
            { k: 'Ciclo actual', v: cicloInforme && !soloSrl ? `${ANIO_INFORME_FIN}: informe ACUM_INF (ciclo terminado). Hoja SRL como contraste.` : d.volumenActual && !d.volumenActual.error ? `Hoja SRL, provisional${d.volumenActual.mesesParciales.length ? ` (meses parciales: ${d.volumenActual.mesesParciales.join(', ')})` : ''}` : 'S/D' },
            { k: 'Versión de plantilla', v: PLANTILLA },
            { k: 'Versión de SICA 005', v: d.version },
            { k: 'Hash del contenido', v: hash },
            { k: 'Consulta de la fuente', v: d.errorSupVol ? `Fallida: ${d.errorSupVol}` : 'Sin errores' },
        ]);
        agrega(`<h2 style="margin-top:0">Anexo ${letra()} — Notas de fuente, método y trazabilidad</h2>
<div class="cols3"><div><h3>Fuente</h3><ul style="margin:0;padding-left:14px">
<li><b>ACUM_INF ${RANGO_ACUM}:</b> informe anual de la SRL con superficie y volumen por módulo y cultivo, con corte de septiembre.</li>
<li><b>${ANIO_INFORME_FIN} (ciclo terminado):</b> viene del mismo informe ACUM_INF. La hoja SRL (mar–sep) solo se usa para comparar el ciclo contra el año típico ${RANGO_INFORME}; ambas fuentes no están conciliadas.</li>
<li><b>${ANIOS_SIN_CICLO.join(', ')}:</b> sin ciclo de riego (las presas no se abrieron); no es un dato faltante.</li>
<li><b>Año calendario:</b> se asume que cada año del informe es el año calendario de su corte; la fuente no lo declara por renglón.</li>
<li>Los módulos son 1, 2, 3, 4, 5 y 12; el distrito es su suma.</li></ul></div>
<div><h3>Método</h3>
<p>Agua entregada por hectárea (cm) = volumen (miles de m³) ÷ superficie (ha) × 10.</p>
<p>Años de «más superficie» y de «menos superficie»: punto medio entre la superficie total mínima y máxima, solo si el máximo es al menos 1.5 veces el mínimo y hay 4 años o más.</p>
<p>Ciclo ${ANIO_INFORME_FIN}: volumen del informe ACUM_INF por módulo contra el mínimo, el año típico (la mediana) y el máximo de ${RANGO_INFORME}; si el informe del año falta, se usa la suma de mar–sep de la hoja SRL.</p>
<p>Un dato faltante es S/D; nunca se muestra como 0.</p></div>
<div><h3>Límites</h3><ul style="margin:0;padding-left:14px">
<li>Descriptivo: no atribuye causas a los cambios entre años.</li>
<li>Es agua entregada por hectárea, no consumo de la planta ni eficiencia de riego.</li>
<li>Con 5 años no hay inferencia estadística; el rango es una referencia.</li>
<li>La cifra de un cultivo con menos de ${UMBRAL_HA_MUESTRA} ha es poco representativa y se marca.</li></ul></div></div>
<h3>Trazabilidad</h3>${traza}
<p class="nota-pie">Dirigido a: CONAGUA · Distrito de Riego 005 · Asociaciones de usuarios. Fuente: informe ACUM_INF de la SRL (corte de septiembre) y, como contraste, la hoja SRL (mar–sep). Documento generado automáticamente por SICA 005.</p>
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
