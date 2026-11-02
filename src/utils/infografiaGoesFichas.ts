/**
 * infografiaGoesFichas — fichas técnicas por estación en HOJA DE PAPEL (Carta, media Carta y mitad de página), puras y sin red.
 * Portado de los prototipos de diseño verificados con PDF real (una ficha = una hoja, sin desbordes, texto mínimo 12 px a 96 dpi).
 *
 * Qué hoja para qué (medido, no opinado):
 *  - Carta vertical (816×1056): la ficha completa; se archiva y engrapa como expediente y su proporción (0.77) se parece a la de un celular.
 *  - Carta horizontal (1056×816): cuando la serie larga de gasto es lo principal (gráficas más anchas); obliga a girar el celular.
 *  - Mitad de página (816×528) y «dos por hoja»: versión compacta, un solo corte y sin desperdicio de papel; es la recomendada para tablero.
 *  - Media Carta vertical (528×816): compacta para carpeta pequeña.
 * Estructura: `.pagina` es la HOJA (lo que se imprime o se guarda como imagen: una ficha, o dos en «dos por hoja») y `.ficha` es cada ficha.
 * Reglas: S/D nunca 0; Babisas «< 15» con rangos; entradas a presa rotuladas; sin comparación presa↔río; sin trazo de río.
 */
import { fechaHoraLocal, fmt, fmtDelta, textoEdad, type CeldaEnlace } from './hidroEstaciones';
import { COBERTURA_MIN_CONFIABLE } from './hidroEstadistica';
import { ticksNice, ticksTiempo } from './informeGoesSvg';
import type { DatosEstacionInfoGoes, DatosInfografiaGoes, PuntoSerie, RangoStat, VariacionInfo } from './infografiaGoes';
import { dimensionHoja, type HojaInfografiaGoes } from './infografiaGoesConfig';

export interface OpcionesFicha { n: number; total: number; logo?: string; logoSica?: string }

const HORA = 3600000;
const OFFSET = -6 * HORA;
const AZUL = '#0B5FB0', VERDE = '#0F5C45', MARINO = '#0B2A4A', MARRON = '#6B2D2D', ORO = '#C9A227', TINTA = '#1B2733', TINTA2 = '#3A4856', AMBAR = '#7A4A00';

const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const SD = '<span class="sd">S/D</span>';
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

export function folioGoes(d: Pick<DatosInfografiaGoes, 'corteMs'>): string {
    const iso = new Date(d.corteMs + OFFSET).toISOString();
    return `GOES-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`;
}

const ENLACE = {
    en_linea: { clase: 'on', glifo: '●', texto: 'En línea' },
    retraso: { clase: 'ret', glifo: '▲', texto: 'Con retraso' },
    sin_transmision: { clase: 'off', glifo: '▲', texto: 'Sin transmisión' },
    sd: { clase: 'off', glifo: '?', texto: 'Sin mensajes' },
} as const;
const DIR = { sube: '▲', baja: '▼', estable: '►' } as const;

interface SegPunto { t: number; v: number; min: number; max: number }
function tramos(pts: SegPunto[], pasoMin: number): SegPunto[][] {
    const gap = Math.max(pasoMin * 60000 * 2.5, 100 * 60000);
    const segs: SegPunto[][] = [];
    let cur: SegPunto[] = [];
    for (const p of pts) { if (cur.length && p.t - cur[cur.length - 1].t > gap) { segs.push(cur); cur = []; } cur.push(p); }
    if (cur.length) segs.push(cur);
    return segs;
}
const validos = (s: PuntoSerie[]): SegPunto[] => s.filter((p) => Number.isFinite(p.v));

function barraCobertura(pct: number | null, W: number, claseTxt: string): string {
    if (pct == null || !Number.isFinite(pct)) return `<div class="${claseTxt}">${SD}</div>`;
    const ok = pct >= COBERTURA_MIN_CONFIABLE, parcial = !ok && pct >= 50;
    const col = ok ? '#1A7F4B' : parcial ? '#B45309' : '#B42318';
    const txt = ok ? '● Confiable' : parcial ? '▲ Parcial' : '■ Insuficiente';
    const m = (COBERTURA_MIN_CONFIABLE / 100) * W;
    return `<svg class="cobsvg" viewBox="0 0 ${W} 14" width="${W}" height="14" role="img" aria-label="Cobertura ${esc(fmt(pct, 0))} por ciento; la marca es el umbral de ${COBERTURA_MIN_CONFIABLE} por ciento"><rect y="3" width="${W}" height="8" rx="4" fill="#E8E5DD"/><rect y="3" width="${f1((Math.min(100, Math.max(0, pct)) / 100) * W)}" height="8" rx="4" fill="${col}"/><line x1="${f1(m)}" x2="${f1(m)}" y1="0" y2="14" stroke="${TINTA}" stroke-width="2"/></svg><span class="${claseTxt}" style="color:${col}">${txt}, ${esc(fmt(pct, 0))} %</span>`;
}

/** Tira de 24 h del enlace: lleno = mensaje bueno, con × = solo mensajes con falla, punteado = ninguno. */
function tira(celdas: CeldaEnlace[], W: number, alto: number, conRotulos: boolean): string {
    const n = celdas.length || 24, gap = 2, cw = (W - gap * (n - 1)) / n, h = conRotulos ? 16 : 12;
    let g = `<svg class="tira" viewBox="0 0 ${W} ${alto}" width="${W}" height="${alto}" role="img" aria-label="Mensajes recibidos en las últimas 24 horas">`;
    celdas.forEach((c, i) => {
        const cx = i * (cw + gap);
        if (c === 'bueno') g += `<rect x="${f1(cx)}" y="1" width="${f1(cw)}" height="${h}" rx="2" fill="#1A7F4B"/>`;
        else if (c === 'falla') g += `<rect x="${f1(cx)}" y="1" width="${f1(cw)}" height="${h}" rx="2" fill="#B45309"/><path d="M${f1(cx + 2)} 4 L${f1(cx + cw - 2)} ${h - 2} M${f1(cx + cw - 2)} 4 L${f1(cx + 2)} ${h - 2}" stroke="#fff" stroke-width="1.4"/>`;
        else g += `<rect x="${f1(cx + 0.5)}" y="1.5" width="${f1(cw - 1)}" height="${h - 1}" rx="2" fill="#fff" stroke="#8C95A0" stroke-dasharray="2 2"/>`;
    });
    if (conRotulos) {
        for (const [i, t] of [[0, '−24 h'], [12, '−12 h']] as [number, string][]) g += `<text x="${f1(i * (cw + gap))}" y="33" font-size="12" fill="${TINTA2}">${t}</text>`;
        g += `<text x="${W}" y="33" text-anchor="end" font-size="12" fill="${TINTA2}">ahora</text>`;
    }
    return g + '</svg>';
}

const cambioChip = (rot: string, v: VariacionInfo, dec: number, u: string): string =>
    v.dir === 'sd' || v.delta == null
        ? `<span class="cv"><i>${rot}</i> ${SD}</span>`
        : `<span class="cv"><i>${rot}</i> ${DIR[v.dir]} ${v.dir === 'estable' ? 'estable' : `${esc(fmtDelta(v.delta, dec))} ${esc(u)}`}</span>`;

type CampoStat = 'min' | 'max' | 'media' | 'mediana' | 'p10' | 'p90' | 'desv' | 'n';
const celdaStat = (r: RangoStat | null, dec: number, campo: CampoStat): string => {
    if (!r) return SD;
    if (campo === 'n') return esc(String(r.n));
    const v = r[campo];
    const base = v == null ? SD : esc(fmt(v, campo === 'desv' ? Math.max(dec, 2) : dec));
    return campo === 'min' ? `${base}<small>${esc(fechaHoraLocal(r.tMin))}</small>` : campo === 'max' ? `${base}<small>${esc(fechaHoraLocal(r.tMax))}</small>` : base;
};

/** Piezas comunes de una ficha (texto y valores); cada diseño decide dónde van. */
function piezas(e: DatosEstacionInfoGoes, d: DatosInfografiaGoes, anchoBarra: number) {
    const t = e.tec, enl = ENLACE[e.enlace.clave], apag = e.obsoleto;
    const ult = Math.max(e.ultimoNivel?.t ?? 0, e.ultimoGasto?.t ?? 0);
    const edadReg = ult ? Math.max(0, (d.corteMs - ult) / 60000) : null;
    const g = e.ultimoGasto;
    const gastoTxt = g == null ? SD : g.tipo === 'censurado' ? `&lt; ${esc(e.gastoRango?.umbral ?? 15)}` : esc(fmt(g.v, 1));
    const noRep = !!e.gastoRango && !e.gastoRango.representativo;
    const rolColor = e.entrada ? MARRON : VERDE;
    const pasoMin = Math.max(t.intervaloMin, 5);
    const sinCambios = [e.var24, e.var7].every((k) => k.nivel.dir === 'sd' && k.gasto.dir === 'sd');
    const cambios = sinCambios
        ? `<div class="camb"><span class="cl">Cambio en 24 h y 7 días</span><span class="cv">${SD} sin lecturas recientes para comparar</span></div>`
        : `<div class="camb"><span class="cl">En 24 h</span>${cambioChip('Nivel', e.var24.nivel, 2, 'm')}${cambioChip('Gasto', e.var24.gasto, 1, 'm³/s')}</div><div class="camb"><span class="cl">En 7 días</span>${cambioChip('Nivel', e.var7.nivel, 2, 'm')}${cambioChip('Gasto', e.var7.gasto, 1, 'm³/s')}</div>`;
    const ident = {
        nombre: esc(e.nombre), rol: `${e.entrada ? '▼' : '●'} ${esc(e.rolTexto)}`,
        meta: `DCP ${esc(e.id)}, ${e.lat != null && e.lon != null ? `${esc(fmt(e.lat, 4))}, ${esc(fmt(e.lon, 4))}` : 'ubicación pendiente'}. ${esc(d.etiquetaVentana)}.`,
        estado: `<div class="estado ${enl.clase}">${enl.glifo} ${enl.texto}${e.enlace.edadMin != null ? `, último mensaje ${esc(textoEdad(e.enlace.edadMin))}` : ''}</div>`,
        ult: apag ? `<div class="ult">▲ Último registro ${ult ? esc(fechaHoraLocal(ult)) : SD}${edadReg != null ? ` (${esc(textoEdad(edadReg))})` : ''}</div>` : '',
    };
    const hero = { gasto: gastoTxt, gastoCls: `${g?.tipo === 'censurado' ? ' lt' : ''}${g == null ? ' sdn' : ''}`, nivel: e.ultimoNivel ? esc(fmt(e.ultimoNivel.v, 2)) : SD, nivelCls: e.ultimoNivel ? '' : ' sdn' };

    const fila = (rot: string, campo: CampoStat) => `<tr><th scope="row">${rot}</th><td>${celdaStat(t.nivel, 2, campo)}</td><td>${celdaStat(t.gasto, 1, campo)}</td></tr>`;
    const gastoMedia = e.gastoRango ? `${esc(fmt(e.gastoRango.inf, 1))} a ${esc(fmt(e.gastoRango.sup, 1))}<small>rango</small>` : celdaStat(t.gasto, 1, 'media');
    const tabla = `<table class="stat"><caption>Estadística, ${esc(d.etiquetaVentana.toLowerCase())}</caption><thead><tr><th></th><th scope="col">Nivel (m)</th><th scope="col">Gasto (m³/s)${e.gastoRango ? '<small>solo sobre el umbral</small>' : ''}</th></tr></thead><tbody>${fila('Lecturas', 'n')}${fila('Mínimo', 'min')}${fila('Máximo', 'max')}<tr><th scope="row">Media</th><td>${celdaStat(t.nivel, 2, 'media')}</td><td>${gastoMedia}</td></tr>${fila('Mediana', 'mediana')}${fila('Percentil 10', 'p10')}${fila('Percentil 90', 'p90')}${fila('Desviación', 'desv')}</tbody></table>`;

    const vol = t.volumenRango ? `${esc(fmt(t.volumenRango.inf, 2))} a ${esc(fmt(t.volumenRango.sup, 2))} Mm³` : t.volumen ? `${esc(fmt(t.volumen.mm3, 2))} Mm³` : SD;
    const volNota = t.volumenRango ? 'rango: ceros como 0 y como umbral' : t.volumen ? `${esc(fmt(t.volumen.pctIntegrado, 0))} % del tiempo integrado` : 'sin tramos continuos';
    const indicadores = `<dl class="ind">
<div><dt>Pendiente del gasto</dt><dd>${t.pendienteGastoDia == null || noRep ? SD : `${esc(fmtDelta(t.pendienteGastoDia, 2))} m³/s por día`}</dd>${noRep ? '<dd class="n">gasto no representativo</dd>' : ''}</div>
<div><dt>Volumen integrado</dt><dd>${vol}</dd><dd class="n">${volNota}</dd></div>
<div><dt>Lecturas de gasto</dt><dd>${esc(String(t.lecturasGasto.recibidas))}</dd><dd class="n">${t.lecturasGasto.bajoUmbral ? `${esc(String(t.lecturasGasto.bajoUmbral))} bajo el umbral` : 'todas sobre el umbral'}</dd></div>
<div><dt>Cobertura</dt><dd>${barraCobertura(e.coberturaPct, anchoBarra, 'cob-txt')}</dd><dd class="n">${t.cobertura ? `${esc(String(t.cobertura.recibidas))} de ${esc(String(t.cobertura.esperadas))} lecturas, cada ${esc(String(t.intervaloMin))} min; la marca es el umbral de ${COBERTURA_MIN_CONFIABLE} %` : ''}</dd></div></dl>`;

    const en = t.enlace;
    const enlaceTxt = `${en.senalDbm == null ? 'Señal S/D' : `Señal ${esc(fmt(en.senalDbm, 0))} dBm`}. ${en.pctBuenos == null ? 'Sin mensajes' : `${esc(fmt(en.pctBuenos, 0))} % de los mensajes buenos (${esc(String(en.buenos))} de ${esc(String(en.total))})`}. Lleno = mensaje bueno; con × = falla; punteado = ninguno.`;
    const notas = [
        e.entrada ? 'Mide la ENTRADA a la presa, no la extracción.' : '',
        e.gastoRango ? `Gasto bajo el umbral del sensor (~${e.gastoRango.umbral} m³/s): el 0.00 que reporta no es caudal nulo (causa sin confirmar). La media y el volumen son rangos${noRep ? '; con más de la mitad de las lecturas bajo el umbral, el mínimo, el máximo y los percentiles describen solo el tiempo sobre el umbral' : ''}.` : '',
        apag ? `Estación sin transmisión: se muestra el último registro conocido (${ult ? esc(fechaHoraLocal(ult)) : 'S/D'}).` : '',
        noRep ? 'La cobertura es la de lo recibido: el gasto sigue siendo poco representativo.' : '',
    ].filter(Boolean);
    return { t, noRep, rolColor, pasoMin, cambios, ident, hero, tabla, indicadores, enlaceTxt, notas, apag, g, ult, edadReg, enl };
}

const logos = (op: OpcionesFicha, cls: { srl: string; sica: string }, dim: { srl: [number, number]; sica: [number, number] }): string => {
    const a = op.logo ? `<img class="${cls.srl}" src="${esc(op.logo)}" alt="SRL Unidad Conchos, Delicias" width="${dim.srl[0]}" height="${dim.srl[1]}">` : `<div class="${cls.srl} vac"></div>`;
    const b = op.logoSica ? `<img class="${cls.sica}" src="${esc(op.logoSica)}" alt="SICA 005" width="${dim.sica[0]}" height="${dim.sica[1]}">` : `<div class="${cls.sica} vac"></div>`;
    return a + b;
};

// ═════════════ CARTA: gráficas fluidas (ocupan el alto que deja la hoja; el texto no se escala) ═════════════

function graficaFluida(serie: PuntoSerie[], o: { desde: number; hasta: number; color: string; titulo: string; pasoMin: number; dec: number; marcas?: number }): string {
    const pts = validos(serie);
    if (pts.length < 2) return `<div class="gf gf-sd">${SD} sin lecturas suficientes en el periodo</div>`;
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { mn = Math.min(mn, p.min); mx = Math.max(mx, p.max); }
    const tk = ticksNice(mn, mx, 4);
    const lo = tk.lo, hi = tk.hi;
    const X = (t: number) => ((t - o.desde) / Math.max(1, o.hasta - o.desde)) * 100;
    const Y = (v: number) => (1 - (v - lo) / Math.max(1e-9, hi - lo)) * 100;
    const segs = tramos(pts, o.pasoMin);
    const p1 = (n: number) => (Math.round(n * 100) / 100).toString();
    let grid = '', ejeY = '', ejeX = '', trazos = '';
    for (const v of tk.t) {
        if (v < lo - 1e-9 || v > hi + 1e-9) continue;
        grid += `<i class="gz" style="top:${p1(Y(v))}%"></i>`;
        ejeY += `<b class="ty" style="top:${p1(Y(v))}%">${esc(fmt(v, tk.dec))}</b>`;
    }
    for (const k of ticksTiempo(o.desde, o.hasta, o.marcas ?? 6)) {
        const xx = X(k.t);
        if (xx < -0.1 || xx > 100.1) continue;
        grid += `<i class="gv" style="left:${p1(xx)}%"></i>`;
        ejeX += `<b class="tx" style="left:${p1(xx)}%">${esc(k.hora)}${k.dia ? `<em>${esc(k.dia)}</em>` : ''}</b>`;
    }
    for (const sg of segs) {
        if (sg.length < 2) continue;
        const arriba = sg.map((p) => `${p1(X(p.t) * 10)},${p1(Y(p.max) * 10)}`), abajo = sg.slice().reverse().map((p) => `${p1(X(p.t) * 10)},${p1(Y(p.min) * 10)}`);
        trazos += `<polygon points="${arriba.concat(abajo).join(' ')}" fill="${o.color}" fill-opacity=".16"/><polyline points="${sg.map((p) => `${p1(X(p.t) * 10)},${p1(Y(p.v) * 10)}`).join(' ')}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    }
    const u = pts[pts.length - 1];
    const izq = X(u.t) > 88, sobre = Y(u.v) > 22;
    const etq = `<b class="uv" style="left:${p1(X(u.t))}%;top:${p1(Y(u.v))}%;transform:translate(${izq ? 'calc(-100% - 8px)' : '8px'},${sobre ? '-135%' : '35%'})">${esc(fmt(u.v, Math.max(tk.dec, o.dec)))}</b>`;
    const puntos = segs.filter((sg) => sg.length === 1).map((sg) => `<u class="dot s" style="left:${p1(X(sg[0].t))}%;top:${p1(Y(sg[0].v))}%;background:${o.color}"></u>`).join('');
    return `<div class="gf" role="img" aria-label="${esc(o.titulo)}"><div class="gp">${grid}<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${trazos}</svg>${puntos}<u class="dot" style="left:${p1(X(u.t))}%;top:${p1(Y(u.v))}%;background:${o.color}"></u>${etq}${ejeY}${ejeX}</div></div>`;
}

const listaNotas = (notas: string[]): string => (notas.length ? `<ul class="notas">${notas.map((x) => `<li><span class="gl">▲</span>${x}</li>`).join('')}</ul>` : '');

function fichaCarta(e: DatosEstacionInfoGoes, d: DatosInfografiaGoes, orient: 'v' | 'h', op: OpcionesFicha): string {
    const W = orient === 'v' ? 736 : 568;
    const p = piezas(e, d, orient === 'v' ? 280 : 182);
    const gr = (ser: PuntoSerie[], o: { titulo: string; color: string; dec: number }) => graficaFluida(ser, { desde: d.desdeMs, hasta: d.hastaMs, pasoMin: p.pasoMin, marcas: orient === 'h' ? 7 : 6, ...o });
    const leyenda = orient === 'v' ? '<small>línea = promedio por intervalo; banda = mínimo a máximo</small>' : '<small>línea = promedio; banda = mín a máx</small>';
    const graficas = `${p.noRep || !p.t.serieGasto.length ? '' : `<div class="gb"><h3>Gasto, m³/s ${leyenda}</h3>${gr(p.t.serieGasto, { titulo: `Gasto de ${e.nombreCorto}`, color: AZUL, dec: 1 })}</div>`}
<div class="gb"><h3>Nivel, m ${p.noRep ? leyenda : ''}</h3>${gr(p.t.serieNivel, { titulo: `Nivel de ${e.nombreCorto}`, color: VERDE, dec: 2 })}${p.noRep ? `<p class="aviso-g">El gasto no se grafica: más de la mitad de las lecturas quedó bajo el umbral del sensor (~${e.gastoRango?.umbral ?? 15} m³/s) y la serie sin ceros engañaría.</p>` : ''}</div>`;
    const marca = `<header class="marca">${logos(op, { srl: 'lg-srl', sica: 'lg-sica' }, { srl: [55, 48], sica: [48, 48] })}<div class="mt"><b>SRL Unidad Conchos</b><span>Distrito de Riego 005 Delicias</span></div><div class="fn"><b>Estaciones hidrométricas GOES</b><span>Ficha técnica. ${esc(d.corteTexto)}</span></div></header>`;
    const pie = `<footer class="pie"><span>${esc(d.fuente)} Sin dato = S/D, nunca 0.</span><span class="fol">Folio ${esc(folioGoes(d))}, ficha ${op.n} de ${op.total}</span></footer>`;
    const ident = `<section class="ident" style="border-left-color:${p.rolColor}"><h2>${p.ident.nombre}</h2><div class="id-t"><div class="rol" style="color:${p.rolColor}">${p.ident.rol}</div><div class="meta">${p.ident.meta}</div>${p.ident.estado}${p.ident.ult}</div>
<div class="hero"><div><div class="lb">Gasto actual</div><div class="num${p.hero.gastoCls}">${p.hero.gasto}<span class="u">m³/s</span></div></div><div><div class="lb">Nivel actual</div><div class="num2${p.hero.nivelCls}">${p.hero.nivel}<span class="u">m</span></div></div></div></section>
<section class="cambios">${p.cambios}</section>`;
    const enlace = `<section class="enlace"><h3>Enlace satelital, últimas 24 h</h3>${tira(p.t.enlace.tira, W, 36, true)}<div class="enl-txt">${p.enlaceTxt}</div></section>`;
    const cuerpo = orient === 'v'
        ? `<section class="grafs">${graficas}</section><section class="datos"><div class="tb">${p.tabla}</div><div class="ib">${p.indicadores}</div></section>${enlace}`
        : `<section class="cuerpo"><div class="col-i"><div class="grafs">${graficas}</div>${enlace}</div><div class="col-d">${p.tabla}${p.indicadores}</div></section>`;
    return `<article class="ficha ${orient}${p.apag ? ' apag' : ''}" data-est="${esc(e.id)}">${marca}${ident}${cuerpo}${listaNotas(p.notas)}${pie}</article>`;
}

// ═════════════ MEDIA CARTA / MITAD DE PÁGINA: ficha compacta con gráfica SVG 1:1 ═════════════

function graficaCompacta(serie: PuntoSerie[], o: { W: number; H: number; desde: number; hasta: number; color: string; pasoMin: number; titulo: string; decVal: number; marcas: number }): string {
    const { W, H, desde, hasta, color } = o;
    const ml = 40, mr = 14, mt = 12, mb = 22;
    const pw = W - ml - mr, ph = H - mt - mb;
    const pts = validos(serie);
    if (pts.length < 2) return `<div class="grafica-sd" style="height:${H}px">${SD} sin lecturas suficientes en el periodo</div>`;
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { mn = Math.min(mn, p.min); mx = Math.max(mx, p.max); }
    const plana = mx - mn < 1e-9;
    const tk = ticksNice(mn, mx, H > 190 ? 4 : 3);
    const { lo, hi } = tk;
    const x = (t: number) => ml + ((t - desde) / Math.max(1, hasta - desde)) * pw;
    const y = (v: number) => mt + ph - ((v - lo) / Math.max(1e-9, hi - lo)) * ph;
    const segs = tramos(pts, o.pasoMin);
    let g = `<svg class="graf" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.titulo)}">`;
    for (const v of tk.t) {
        if (v < lo - 1e-9 || v > hi + 1e-9) continue;
        g += `<line x1="${ml}" x2="${ml + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="#E2DCCB" stroke-width="1"/><text x="${ml - 6}" y="${f1(y(v) + 4)}" text-anchor="end" font-size="12" fill="${TINTA2}">${esc(fmt(v, tk.dec))}</text>`;
    }
    const by = mt + ph;
    const ultimo = pts[pts.length - 1];
    // Silencio al final de la ventana: se dibuja como tal, no como una línea que «sigue».
    if (hasta - ultimo.t > 3 * HORA) {
        const x0 = x(ultimo.t);
        g += `<rect x="${f1(x0)}" y="${mt}" width="${f1(ml + pw - x0)}" height="${ph}" fill="#ECE9E2" fill-opacity=".7" stroke="#9AA3AC" stroke-dasharray="4 3"/>`;
        if (ml + pw - x0 > 70) g += `<text x="${f1((x0 + ml + pw) / 2)}" y="${f1(mt + ph / 2 + 4)}" text-anchor="middle" font-size="12" font-weight="700" fill="${TINTA2}">sin datos</text>`;
    }
    g += `<line x1="${ml}" x2="${ml + pw}" y1="${by}" y2="${by}" stroke="#9AA3AC" stroke-width="1.2"/>`;
    for (const k of ticksTiempo(desde, hasta, o.marcas)) {
        const xx = x(k.t);
        if (xx < ml - 1 || xx > ml + pw + 1) continue;
        const ancla = xx > ml + pw - 18 ? 'end' : xx < ml + 14 ? 'start' : 'middle';
        g += `<line x1="${f1(xx)}" x2="${f1(xx)}" y1="${by}" y2="${by + 4}" stroke="#9AA3AC" stroke-width="1.2"/><text x="${f1(xx)}" y="${by + 17}" text-anchor="${ancla}" font-size="12" fill="${TINTA2}">${esc(k.hora)}</text>`;
    }
    for (const sg of segs) {
        if (sg.length > 1) {
            const arriba = sg.map((p) => `${f1(x(p.t))},${f1(y(p.max))}`), abajo = sg.slice().reverse().map((p) => `${f1(x(p.t))},${f1(y(p.min))}`);
            g += `<polygon points="${arriba.concat(abajo).join(' ')}" fill="${color}" fill-opacity=".16"/><polyline points="${sg.map((p) => `${f1(x(p.t))},${f1(y(p.v))}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
        } else g += `<circle cx="${f1(x(sg[0].t))}" cy="${f1(y(sg[0].v))}" r="2.5" fill="${color}"/>`;
    }
    if (plana) g += `<text x="${f1(ml + 8)}" y="${f1(y(ultimo.v) - 8)}" font-size="12" font-weight="700" fill="${color}">Sin variación en la ventana</text>`;
    const ux = x(ultimo.t), uy = y(ultimo.v);
    g += `<circle cx="${f1(ux)}" cy="${f1(uy)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    const arribaEtq = uy - mt > 22;
    g += `<text x="${f1(Math.min(ux, ml + pw))}" y="${f1(arribaEtq ? uy - 10 : uy + 20)}" text-anchor="end" font-size="13" font-weight="800" fill="${color}" stroke="#fff" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${esc(fmt(ultimo.v, o.decVal))}</text>`;
    return g + '</svg>';
}

function fichaMedia(e: DatosEstacionInfoGoes, d: DatosInfografiaGoes, orient: 'v' | 'h', op: OpcionesFicha): string {
    const p = piezas(e, d, 92);
    const t = p.t;
    const cambio = (rot: string, v: VariacionInfo, dec: number, u: string) => (v.dir === 'sd' || v.delta == null
        ? `<div class="cmb"><i>${rot}</i> ${SD}</div>`
        : `<div class="cmb"><i>${rot}</i> ${DIR[v.dir]} ${v.dir === 'estable' ? 'estable' : `${esc(fmtDelta(v.delta, dec))} ${esc(u)}`}</div>`);
    const nombre = `<div class="id" style="border-left-color:${p.rolColor}"><h2>${esc(e.nombreCorto)}</h2><div class="rol">${e.entrada ? '▼' : '●'} ${esc(e.rolTexto)}</div>${p.ident.estado.replace('último mensaje ', '')}${p.apag ? `<div class="ult">Último registro ${p.ult ? esc(fechaHoraLocal(p.ult)) : SD}${p.edadReg != null ? ` (${esc(textoEdad(p.edadReg)).replace(/ /g, '&nbsp;')})` : ''}</div>` : ''}</div>`;
    const hero = `<div class="hero"><div class="hc"><div class="lb">Gasto</div><div class="gran${p.hero.gastoCls.includes('sdn') ? ' sdn' : ''}">${p.hero.gasto}<span class="u">m³/s</span></div>${cambio('24 h', e.var24.gasto, 1, 'm³/s')}${cambio('7 d', e.var7.gasto, 1, 'm³/s')}</div>
<div class="hc"><div class="lb">Nivel</div><div class="med${p.hero.nivelCls}">${p.hero.nivel}<span class="u">m</span></div>${cambio('24 h', e.var24.nivel, 2, 'm')}${cambio('7 d', e.var7.nivel, 2, 'm')}</div></div>`;
    const usaGasto = !p.noRep && t.serieGasto.length > 0;
    const W = orient === 'v' ? 468 : 480;
    // Alto de la gráfica según lo que más ocupa la ficha: Babisas (aviso del umbral de 3 líneas) sin transmisión suma además la línea «Último registro».
    const H = orient === 'v'
        ? (p.noRep ? (p.apag ? 165 : 180) : p.apag ? 190 : e.entrada ? 205 : 225)
        : (p.noRep ? (p.apag ? 148 : 165) : e.entrada ? 200 : 214);
    const titulo = usaGasto ? 'Gasto, m³/s' : 'Nivel, m';
    const sub = p.noRep ? 'No se grafica el gasto: está bajo el umbral del sensor.' : 'Línea: valor. Banda: mínimo a máximo del intervalo.';
    const graf = `<div class="graf-b"><div class="gtit"><h3>${titulo}</h3><small>${esc(sub)}</small></div>${graficaCompacta(usaGasto ? t.serieGasto : t.serieNivel, { W, H, desde: d.desdeMs, hasta: d.hastaMs, color: usaGasto ? AZUL : VERDE, pasoMin: p.pasoMin, titulo: `${titulo} de ${e.nombreCorto}`, decVal: usaGasto ? 1 : 2, marcas: W < 400 ? 4 : 6 })}</div>`;
    const cel = (r: RangoStat | null, dec: number, campo: 'min' | 'media' | 'max') => (!r || r[campo] == null ? SD : esc(fmt(r[campo], dec)));
    const p1090 = (r: RangoStat | null, dec: number) => (!r || r.p10 == null || r.p90 == null ? SD : `${esc(fmt(r.p10, dec))} a ${esc(fmt(r.p90, dec))}`);
    const filaS = (rot: string, u: string, r: RangoStat | null, dec: number) => `<tr><th scope="row">${rot}<small> ${u}</small></th><td>${cel(r, dec, 'min')}</td><td>${cel(r, dec, 'media')}</td><td>${cel(r, dec, 'max')}</td><td>${p1090(r, dec)}</td></tr>`;
    const gr = e.gastoRango;
    const filaGasto = gr
        ? `<tr class="rng"><th scope="row">Gasto<small> m³/s</small></th><td colspan="4"><b>Media entre ${esc(fmt(gr.inf, 1))} y ${esc(fmt(gr.sup, 1))}</b>; ${esc(fmt(gr.pctBajoUmbral, 0))} % bajo el umbral (${esc(String(t.lecturasGasto.bajoUmbral))} de ${esc(String(t.lecturasGasto.recibidas))})</td></tr>`
        : filaS('Gasto', 'm³/s', t.gasto, 1);
    const stat = `<table class="stat"><thead><tr><th></th><th scope="col">Mín</th><th scope="col">Prom</th><th scope="col">Máx</th><th scope="col">p10 a p90</th></tr></thead><tbody>${filaGasto}${filaS('Nivel', 'm', t.nivel, 2)}</tbody></table>`;
    const vol = t.volumenRango ? `${esc(fmt(t.volumenRango.inf, 2))} a ${esc(fmt(t.volumenRango.sup, 2))} Mm³` : t.volumen ? `${esc(fmt(t.volumen.mm3, 2))} Mm³` : SD;
    const volNota = t.volumenRango ? 'rango, ceros como 0 y como umbral' : t.volumen ? 'en tramos continuos' : 'sin tramos continuos';
    // Con gasto no representativo la pendiente se calcularía sobre pocas lecturas sobre el umbral: no se publica una tendencia que no existe.
    const pend = p.noRep ? `<div><i>Pendiente</i><b>${SD}</b><small>gasto no representativo</small></div>`
        : `<div><i>Pendiente del gasto</i><b>${t.pendienteGastoDia == null ? SD : esc(fmtDelta(t.pendienteGastoDia, 2))}</b><small>m³/s por día</small></div>`;
    const ind = `<div class="ind">${pend}<div><i>Volumen integrado</i><b>${vol}</b><small>${volNota}</small></div><div><i>Cobertura</i>${barraCobertura(e.coberturaPct, 92, 'cobtxt')}</div></div>`;
    const anchoTira = orient === 'v' ? 250 : 258;
    const senal = t.enlace.senalDbm == null ? 'Señal S/D' : `Señal ${esc(fmt(t.enlace.senalDbm, 0))} dBm`;
    const bu = t.enlace.pctBuenos == null ? 'sin mensajes' : `${esc(String(t.enlace.buenos))} de ${esc(String(t.enlace.total))} mensajes buenos`;
    const enlace = `<div class="enl"><span class="enl-t">Enlace, 24 h</span><span class="enl-l ea">−24 h</span>${tira(t.enlace.tira, anchoTira, 14, false)}<span class="enl-l eb">ahora</span></div><div class="enl-x">${senal}. ${bu}.</div>`;
    const li: string[] = [];
    if (gr) li.push(`<li><b>▲ Gasto bajo el umbral del sensor (~${esc(gr.umbral)} m³/s).</b> El 0.00 que reporta no es caudal nulo; causa sin confirmar. Media y volumen son rangos${p.noRep ? '; mín, máx y percentiles solo describen lo que está sobre el umbral' : ''}.</li>`);
    const notas = `${li.length ? `<ul class="notas">${li.join('')}</ul>` : ''}${e.entrada ? '<p class="nota-e">Mide la entrada a la presa, no la extracción.</p>' : ''}`;
    const cab = `<header class="enc">${logos(op, { srl: 'logo-img', sica: 'logo-sica' }, { srl: [46, 40], sica: [40, 40] })}<div class="marca"><b>SRL Unidad Conchos</b><span>Distrito de Riego 005 Delicias</span></div><div class="tit"><b>Ficha técnica</b><span>${esc(d.etiquetaVentana)}</span></div></header>`;
    const pie = `<footer class="pie"><div>Ficha ${op.n} de ${op.total}. ${esc(d.corteTexto)}.</div><div>DCP ${esc(e.id)}. Folio ${esc(folioGoes(d))}. Fuente: telemetría GOES, monitor Sutron. Versión resumida; la ficha completa está en tamaño Carta.</div></footer>`;
    const cuerpo = orient === 'v'
        ? `${nombre}${hero}${graf}${stat}${ind}${enlace}${notas}`
        : `<div class="cuerpo"><div class="izq">${nombre}${hero}${enlace}</div><div class="der">${graf}${stat}${ind}${notas}</div></div>`;
    return `<article class="ficha ${orient}${p.apag ? ' apag' : ''}" data-est="${esc(e.id)}">${cab}${cuerpo}${pie}</article>`;
}

// ═════════════ CSS ═════════════

const CSS_CARTA = `*{box-sizing:border-box;margin:0;padding:0}html,body{margin:0;background:#E9E6DC}
body{font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:${TINTA};font-size:13px;line-height:1.3;font-variant-numeric:tabular-nums}
.ficha{position:relative;background:#fff;padding:40px;display:flex;flex-direction:column;gap:9px;overflow:hidden}
.ficha::before{content:"";position:absolute;left:0;right:0;top:0;height:8px;background:${MARRON}}
.ficha::after{content:"";position:absolute;left:0;right:0;top:8px;height:3px;background:${ORO}}
.marca{display:flex;align-items:center;gap:10px;padding-top:2px}
.lg-srl{display:block;width:55px;height:48px;flex:none}.lg-sica{display:block;width:48px;height:48px;flex:none}.vac{border:1px dashed #B9B3A2}
.mt{flex:1;margin-left:4px;border-left:2px solid ${ORO};padding-left:12px}.mt b{display:block;font-size:17px;color:${MARRON};line-height:1.15}.mt span{display:block;font-size:13px;color:${TINTA2};margin-top:2px}
.fn{text-align:right;font-size:12px;color:${TINTA2}}.fn b{display:block;font-size:15px;color:${MARINO}}
.ident{display:grid;grid-template-columns:1fr auto;column-gap:20px;align-items:end;border-left:6px solid ${VERDE};padding:0 0 2px 16px}
.ident h2{grid-column:1/3}.id-t{min-width:0}h2{font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;color:${MARINO};line-height:1.05}
.rol{font-size:15px;font-weight:700;margin-top:4px}.meta{font-size:13px;color:${TINTA2};margin-top:3px}
.estado{font-size:14px;font-weight:700;margin-top:5px}.estado.on{color:#0B5A3A}.estado.ret,.estado.off{color:${AMBAR}}
.ult{font-size:15px;font-weight:800;color:${AMBAR};margin-top:3px}
.lb{font-size:13px;font-weight:600;color:${TINTA2}}
.hero{display:flex;gap:26px;align-items:flex-end}
.num{font-size:60px;font-weight:800;color:${AZUL};line-height:1;white-space:nowrap}.num.lt{font-size:54px}.num.sdn,.num2.sdn{font-size:34px}
.num .u,.num2 .u{font-size:16px;font-weight:700;margin-left:5px}.num2{font-size:44px;font-weight:800;color:${MARINO};line-height:1;white-space:nowrap}
.cambios{display:flex;flex-direction:column;gap:4px}
.camb{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:13px}.cl{font-weight:600;color:${TINTA2};min-width:84px}
.cv{white-space:nowrap;font-weight:800;color:${MARINO};background:#EEF2F6;border-radius:4px;padding:1px 8px}.cv i{font-style:normal;font-weight:600;color:${TINTA2}}
h3{font-size:14px;font-weight:700;color:${MARINO};margin:0 0 2px}h3 small{font-size:12px;font-weight:500;color:${TINTA2};margin-left:8px}
.grafs{flex:1 1 0;min-height:0;display:flex;flex-direction:column;gap:2px}.gb{flex:1 1 0;min-height:70px;display:flex;flex-direction:column}
.gf{position:relative;flex:1 1 0;min-height:40px;margin:4px 0 34px}.gf-sd{display:flex;align-items:center;justify-content:center;font-size:13px;color:${TINTA2};border:1px dashed #8C95A0;border-radius:4px}
.gp{position:absolute;left:50px;right:16px;top:8px;bottom:0;border-bottom:1px solid #8C95A0}.gp svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.gz{position:absolute;left:0;right:0;border-top:1px solid #E4E0D6;height:0}.gv{position:absolute;top:0;bottom:0;border-left:1px solid #EEEBE3;width:0}
.ty{position:absolute;right:100%;margin-right:6px;transform:translateY(-50%);font-size:12px;font-weight:400;color:${TINTA2};line-height:1;white-space:nowrap}
.tx{position:absolute;top:100%;margin-top:4px;transform:translateX(-50%);font-size:12px;font-weight:400;color:${TINTA2};line-height:14px;text-align:center;white-space:nowrap}.tx em{display:block;font-style:normal;font-weight:700}
.dot{position:absolute;display:block;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;border:1.5px solid #fff;text-decoration:none}.dot.s{width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border:0}
.uv{position:absolute;font-size:12px;font-weight:700;color:${MARINO};background:#fff;padding:0 2px;line-height:14px;white-space:nowrap}
.aviso-g{font-size:12.5px;color:${AMBAR};font-weight:600;margin-top:4px}
table.stat{border-collapse:collapse;width:100%;font-size:13px}.stat caption{text-align:left;font-size:14px;font-weight:700;color:${MARINO};padding-bottom:3px}
.stat th,.stat td{border-top:1px solid #DDD6BF;padding:1px 6px;text-align:right;font-weight:600;color:${MARINO};white-space:nowrap}.stat th[scope=row]{text-align:left;color:${TINTA2};padding-left:0}
.stat thead th{border-top:0;border-bottom:2px solid ${ORO};font-weight:800;vertical-align:bottom;line-height:1.15}
.stat small{font-size:12px;font-weight:500;color:${TINTA2};margin-left:6px}.stat thead small{display:block;margin:0}
dl.ind>div{padding:4px 0;border-top:1px solid #DDD6BF}dl.ind dt{font-size:13px;font-weight:600;color:${TINTA2}}dl.ind dd{font-size:16px;font-weight:800;color:${MARINO};line-height:1.2}dl.ind dd.n{font-size:12px;font-weight:500;color:${TINTA2}}
.cobsvg{display:block;margin:3px 0 2px}.cob-txt{display:block;font-size:14px;font-weight:800;white-space:nowrap}
.tira{display:block}.enl-txt{font-size:12.5px;color:${TINTA2};margin-top:2px}
.notas{list-style:none;background:#FFF6DC;border-left:4px solid #D9920B;padding:5px 10px;font-size:12.5px;line-height:1.35;color:#4A2E00}.notas li{margin:2px 0;display:flex;gap:6px}.notas .gl{flex:none;font-weight:800}
.pie{display:flex;justify-content:space-between;gap:20px;font-size:12px;color:${TINTA2};line-height:1.3;border-top:1px solid ${ORO};padding-top:5px;margin-top:auto}.pie .fol{white-space:nowrap;font-weight:600}
.apag .num,.apag .num2{color:#566370}
.sd{display:inline-block;border:1px solid #7A8591;border-radius:3px;padding:0 4px;font-weight:800;color:#3F4852;background:#E6E9EC;font-size:12px}
.ficha.v{width:816px;height:1056px}.v .datos{display:flex;gap:26px}.v .tb{flex:0 0 430px}.v .ib{flex:1}.v .cambios{flex-direction:row;gap:4px 24px;flex-wrap:wrap}
.ficha.h{width:1056px;height:816px}.h .cambios{flex-direction:row;gap:4px 24px;flex-wrap:wrap}
.h .cuerpo{display:flex;gap:28px;flex:1 1 0;min-height:0}.h .col-i{flex:0 0 568px;display:flex;flex-direction:column;gap:6px;min-height:0}.h .col-d{flex:1;display:flex;flex-direction:column;gap:10px}
.h dl.ind{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}.h h2{font-size:32px}.h .num{font-size:56px}.h .num2{font-size:42px}`;

const CSS_MEDIA = `*{box-sizing:border-box;margin:0;padding:0}html,body{margin:0;background:#E9E4D3}
body{font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:${TINTA};font-variant-numeric:tabular-nums;font-size:12px;line-height:1.3}
.ficha{position:relative;background:#FAF6EA;overflow:hidden;padding:30px;display:flex;flex-direction:column}
.ficha.v{width:528px;height:816px}.ficha.h{width:816px;height:528px}
.enc{display:flex;align-items:center;gap:8px;padding-bottom:7px;border-bottom:2px solid ${ORO};flex:none}
.logo-img,.logo-sica{display:block;flex:none}.logo-img{width:46px;height:40px}.logo-sica{width:40px;height:40px}.vac{border:1px dashed #B9B3A2}
.marca{margin-left:6px;line-height:1.15;flex:1;min-width:0}.marca b{display:block;font-size:15px;font-weight:700;color:${MARRON}}.marca span{display:block;font-size:12px;font-weight:600;color:${TINTA2}}
.tit{text-align:right;line-height:1.15;flex:none}.tit b{display:block;font-size:15px;font-weight:800;color:${VERDE}}.tit span{display:block;font-size:12px;font-weight:600;color:${TINTA2}}
.sd{display:inline-block;border:1.5px solid #7A8591;border-radius:5px;padding:0 5px;font-weight:800;color:#3F4852;background:#E6E9EC;font-size:12px;vertical-align:middle}
.id{border-left:6px solid ${VERDE};padding:1px 0 1px 10px;margin-top:9px;flex:none}.id h2{font-size:26px;font-weight:800;line-height:1.08;color:${MARINO}}
.rol{font-size:13px;font-weight:600;color:${TINTA2};margin-top:2px;line-height:1.25}
.estado{font-size:13px;font-weight:700;margin-top:3px}.estado.on{color:#0B5A3A}.estado.ret,.estado.off{color:${AMBAR}}
.ult{font-size:13px;font-weight:800;color:${AMBAR};margin-top:1px}
.hero{display:flex;gap:18px;margin-top:8px;flex:none}.hc{min-width:0}.hc:first-child{flex:1.25}.hc:last-child{flex:1}
.lb{font-size:13px;font-weight:600;color:${TINTA2};line-height:1.1}
.gran{font-size:56px;font-weight:800;line-height:1;color:${AZUL};white-space:nowrap;letter-spacing:-.5px}.med{font-size:40px;font-weight:800;line-height:1.1;color:${MARINO};white-space:nowrap}
.u{font-size:14px;font-weight:700;margin-left:5px;letter-spacing:0}.gran.sdn,.med.sdn{font-size:32px}
.cmb{font-size:13px;font-weight:800;color:${MARINO};margin-top:3px;white-space:nowrap}.cmb i{font-style:normal;font-weight:600;color:${TINTA2};display:inline-block;min-width:34px}
.apag .gran,.apag .med{color:#566370}
.graf-b{margin-top:8px;flex:none}.gtit{display:flex;align-items:baseline;gap:8px;justify-content:space-between}.gtit h3{font-size:14px;font-weight:700;color:${MARINO};white-space:nowrap}.gtit small{font-size:12px;color:${TINTA2};text-align:right;line-height:1.2}
.graf{display:block}.grafica-sd{display:flex;align-items:center;justify-content:center;border:1px dashed #9AA3AC;border-radius:6px;font-size:13px}
table.stat{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px;table-layout:fixed;flex:none}
.stat th,.stat td{border-top:1px solid #E1D6AE;padding:2px 4px;text-align:right;font-weight:700;color:${MARINO}}.stat thead th{border-top:0;font-size:12px;font-weight:700;color:${TINTA2};padding-bottom:1px}
.stat th[scope=row]{text-align:left;color:${MARINO};width:21%}.stat th small{font-size:12px;font-weight:600;color:${TINTA2}}.stat th:last-child,.stat td:last-child{width:28%}
.stat tr.rng td{text-align:left;font-weight:600;color:${TINTA2};line-height:1.25}.stat tr.rng b{color:${AMBAR}}
.ind{display:flex;gap:10px;margin-top:7px;flex:none}.ind>div{flex:1;min-width:0;border-top:2px solid ${ORO};padding-top:3px}
.ind i{display:block;font-style:normal;font-size:12px;font-weight:600;color:${TINTA2};line-height:1.15}.ind b{display:block;font-size:16px;font-weight:800;color:${MARINO};line-height:1.2}.ind small{display:block;font-size:12px;color:${TINTA2};line-height:1.15}
.cobsvg{display:block;margin-top:3px}.cobtxt{display:block;font-size:13px;font-weight:800}
.enl{display:flex;align-items:center;gap:6px;margin-top:8px;flex:none}.enl-t{font-size:12px;font-weight:700;color:${MARINO};white-space:nowrap}.enl-l{font-size:12px;color:${TINTA2};white-space:nowrap}.tira{display:block;flex:none}
.enl-x{font-size:12px;color:${TINTA2};margin-top:1px;flex:none}
.notas{margin:7px 0 0;padding:5px 9px;list-style:none;font-size:12px;line-height:1.28;color:#4A2E00;background:#FCEBC4;border:1.5px solid #D9920B;border-radius:6px;flex:none}.notas b{font-weight:800}
.nota-e{font-size:12px;color:${TINTA2};margin-top:6px;flex:none}
.pie{margin-top:auto;padding-top:5px;font-size:11px;line-height:1.3;color:${TINTA2};border-top:1px solid #E1D6AE;flex:none}
.ficha.h .cuerpo{display:flex;gap:18px;margin-top:2px;flex:1;min-height:0}.ficha.h .izq{width:258px;flex:none;display:flex;flex-direction:column}.ficha.h .der{width:480px;flex:none;display:flex;flex-direction:column}
.ficha.h .id{margin-top:8px}.ficha.h .id h2{font-size:24px}
.ficha.h .hero{flex-direction:column;gap:6px;margin-top:8px}.ficha.h .gran{font-size:52px}.ficha.h .med{font-size:34px}
.ficha.h .hc{display:block}.ficha.h .cmb{display:inline-block;margin-right:12px;margin-top:2px}
.ficha.h .graf-b{margin-top:8px}.ficha.h .enl{display:grid;grid-template-columns:1fr auto;gap:2px 6px}.ficha.h .enl-t{grid-column:1/-1}.ficha.h .tira{grid-column:1/-1;grid-row:2}.ficha.h .ea{grid-row:3;grid-column:1}.ficha.h .eb{grid-row:3;grid-column:2}`;

/** Hoja (`.pagina`): en pantalla centrada con aire; al imprimir, una por página sin margen. */
const CSS_HOJA = `.pagina{margin:18px auto;width:max-content;background:transparent}
.pagina.dos{width:816px;height:1056px;background:#FAF6EA;overflow:hidden}.pagina.dos .ficha+.ficha{border-top:1px dashed #A89F86}
@media print{html,body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pagina{margin:0!important;break-after:page;page-break-after:always}.pagina:last-child{break-after:auto;page-break-after:auto}}`;

const TAMANO_PAGINA: Record<HojaInfografiaGoes, string> = {
    pantalla: 'auto', 'carta-v': '8.5in 11in', 'carta-h': '11in 8.5in', 'media-v': '5.5in 8.5in', 'media-h': '8.5in 5.5in', 'mitad-2': '8.5in 11in',
};

export interface OpcionesFichasPapel { logo?: string; logoSica?: string }

/** Documento autónomo con una hoja por ficha (o por pareja de fichas en «dos por hoja»). Solo para hojas de papel. */
export function htmlFichasPapel(d: DatosInfografiaGoes, hoja: HojaInfografiaGoes, { logo = '', logoSica = '' }: OpcionesFichasPapel = {}): string {
    const dim = dimensionHoja(hoja);
    if (!dim.papel) throw new Error('htmlFichasPapel solo aplica a hojas de papel');
    const total = d.estaciones.length;
    const carta = hoja === 'carta-v' || hoja === 'carta-h';
    const orient: 'v' | 'h' = hoja === 'carta-v' || hoja === 'media-v' ? 'v' : 'h';
    const ficha = (e: DatosEstacionInfoGoes, i: number) => (carta ? fichaCarta : fichaMedia)(e, d, orient, { n: i + 1, total, logo, logoSica });
    const fichas = d.estaciones.map(ficha);
    const hojas: string[] = [];
    if (hoja === 'mitad-2') for (let i = 0; i < fichas.length; i += 2) hojas.push(`<div class="pagina dos">${fichas[i]}${fichas[i + 1] ?? ''}</div>`);
    else for (const f of fichas) hojas.push(`<div class="pagina">${f}</div>`);
    const css = `${carta ? CSS_CARTA : CSS_MEDIA}\n${CSS_HOJA}\n@page{size:${TAMANO_PAGINA[hoja]};margin:0}`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estaciones hidrométricas GOES, fichas técnicas</title><style>${css}</style></head><body>${hojas.join('\n')}</body></html>`;
}
