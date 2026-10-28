/**
 * infografiaGoesHtml — plantilla HTML autónoma de la infografía «Estaciones hidrométricas (GOES)».
 *
 * Se rasteriza a PNG (rasterizaHtml: iframe oculto + <svg><foreignObject> + canvas), por eso: CSS en <style> en línea, sin
 * fuentes web, sin JS, sin filter/backdrop-filter ni position:fixed; los logos y las teselas del mapa entran como data URI.
 * Se diseña a 1080 px de ancho (WhatsApp la muestra a ancho de pantalla: a 390 px el factor es 0.36, de modo que el texto esencial
 * va a 30 px o más para quedar sobre ~11 px legibles). Regla rectora: S/D nunca cero; jamás se imprime NaN/undefined/null.
 * El MAPA es real: teselas Esri World_Topo_Map con marcadores en las ubicaciones registradas y, si se tienen, el contorno del
 * espejo de agua de las presas (estimado por imagen satelital en Manejo de vaso). No se dibuja ningún trazo de río propio ni
 * se afirma conexión entre puntos. Sin teselas (red caída) queda un fondo liso con los marcadores y la nota «sin imagen base».
 */
import { fechaHoraLocal, fmt, fmtDelta, textoEdad, type CeldaEnlace } from './hidroEstaciones';
import type { DatosEstacionInfoGoes, DatosInfografiaGoes, PuntoSerie, RangoStat, VariacionInfo } from './infografiaGoes';
import { contenidoEfectivo, dimensionHoja, type ConfigInfografiaGoes } from './infografiaGoesConfig';
import { htmlFichasPapel } from './infografiaGoesFichas';
import { ticksNice, ticksTiempo } from './informeGoesSvg';
import { COBERTURA_MIN_CONFIABLE } from './hidroEstadistica';
import {
    TESELA_ATRIBUCION, TESELA_PX, aPantalla, barraEscala, colocarEtiquetas, vistaMapa,
    type TeselaConUri, type VistaMapa,
} from './mapaTeselas';

export const ANCHO_INFOGRAFIA_GOES = 1080;
export const MAPA_ANCHO = 1008;
export const MAPA_ALTO = 700;

const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const SD = '<span class="sd">S/D</span>';

const AZUL = '#0B5FB0';
/** Presas del mapa (coordenadas de la tabla `presas`; nombre con el que las conoce el distrito). */
export const PRESAS_MAPA = [
    { id: 'PRE-001', lineas: ['P. La Boquilla'], lat: 27.5517, lon: -105.4375 },
    { id: 'PRE-002', lineas: ['P. Fco. I. Madero', '(Las Vírgenes)'], lat: 28.3364, lon: -105.5278 },
] as const;

const ENLACE = {
    en_linea: { clase: 'on', glifo: '●', texto: 'En línea' },
    retraso: { clase: 'ret', glifo: '▲', texto: 'Con retraso' },
    sin_transmision: { clase: 'off', glifo: '▲', texto: 'Sin transmisión' },
    sd: { clase: 'off', glifo: '?', texto: 'Sin mensajes' },
} as const;

const DIR = { sube: '▲', baja: '▼', estable: '►' } as const;
/** «Nivel ▲ +0.08 m». Estable no lleva unidad (no tiene sentido «estable m»). */
const cambio = (rotulo: string, v: VariacionInfo, dec: number, unidad: string): string =>
    v.dir === 'sd' || v.delta == null
        ? `<span class="cv"><i>${rotulo}</i> ${SD}</span>`
        : `<span class="cv"><i>${rotulo}</i> ${DIR[v.dir]} ${v.dir === 'estable' ? 'estable' : `${esc(fmtDelta(v.delta, dec))} ${esc(unidad)}`}</span>`;

/** Forma de la serie en la ventana, sin ejes (los extremos van en texto grande aparte). Serie plana o corta: no se dibuja. */
function spark(puntos: { t: number; v: number }[], apagada: boolean): string {
    const W = 452, H = 84, p = 10;
    if (puntos.length < 2) return '';
    const vs = puntos.map((q) => q.v);
    const mn = Math.min(...vs), mx = Math.max(...vs);
    if (mx - mn < 1e-9) return '<div class="plana">Sin variación en la ventana</div>';
    const t0 = puntos[0].t, t1 = puntos[puntos.length - 1].t || t0 + 1;
    const pts = puntos.map((q) => [p + ((W - 2 * p) * (q.t - t0)) / Math.max(1, t1 - t0), p + (H - 2 * p) * (1 - (q.v - mn) / (mx - mn))]);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    const u = pts[pts.length - 1];
    const col = apagada ? '#7A8591' : AZUL;
    return `<svg class="spk" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Forma de la serie en la ventana"><path d="${d} L${u[0].toFixed(1)},${H - p} L${p},${H - p} Z" fill="${col}" fill-opacity=".13"/><path d="${d}" fill="none" stroke="${col}" stroke-width="4" stroke-linejoin="round"/><circle cx="${u[0].toFixed(1)}" cy="${u[1].toFixed(1)}" r="7" fill="${col}" stroke="#fff" stroke-width="3"/></svg>`;
}

function tarjeta(e: DatosEstacionInfoGoes, d: DatosInfografiaGoes, conSpark = true): string {
    const enl = ENLACE[e.enlace.clave];
    const apag = e.obsoleto;
    const ult = Math.max(e.ultimoNivel?.t ?? 0, e.ultimoGasto?.t ?? 0);
    const g = e.ultimoGasto;
    // Un decimal: la precisión de la estación no sustenta más (y coincide con mín/prom/máx).
    const gastoTxt = g == null ? SD : g.tipo === 'censurado' ? `&lt; ${esc(e.gastoRango?.umbral ?? 15)}` : esc(fmt(g.v, 1));
    const glifoRol = e.entrada ? '▼' : '●';
    const v = d.ventana === '24h' ? e.var24 : d.ventana === '7d' ? e.var7 : null;
    // Con ambas variaciones S/D (estación sin transmisión) la fila no aporta: el estado ya lo dice la tarjeta.
    const filaCambio = v && (v.nivel.dir !== 'sd' || v.gasto.dir !== 'sd')
        ? `<div class="camb"><span class="cl">En ${esc(d.etiquetaVentana)}</span>${cambio('Nivel', v.nivel, 2, 'm')}${cambio('Gasto', v.gasto, 1, 'm³/s')}</div>`
        : v ? '' : '<div class="camb"><span class="cl">El cambio se calcula a 24 h y 7 d</span></div>';
    const rango = e.gastoRango
        ? `<div class="mpm rng"><b>${esc(fmt(e.gastoRango.inf, 1))} a ${esc(fmt(e.gastoRango.sup, 1))} m³/s</b> de gasto medio${e.gastoRango.representativo ? '' : ' (poco representativo)'}; ${esc(fmt(e.gastoRango.pctBajoUmbral, 0))} % de las lecturas bajo el umbral</div>`
        : e.gasto
            ? `<div class="mpm">Gasto en ${esc(d.etiquetaVentana)}: mín <b>${esc(fmt(e.gasto.min, 1))}</b>, prom <b>${esc(fmt(e.gasto.media, 1))}</b>, máx <b>${esc(fmt(e.gasto.max, 1))}</b></div>`
            : `<div class="mpm">Gasto en la ventana: ${SD}</div>`;
    const nota = e.gastoRango ? '<div class="nota-c"><b>▲ Bajo el umbral del sensor.</b> El 0.00 que reporta no es caudal nulo (causa sin confirmar).</div>' : '';
    const cob = e.coberturaPct != null ? ` Cobertura ${esc(fmt(e.coberturaPct, 0))} %.` : '';
    // Antigüedad del REGISTRO respecto al corte (no la del mensaje, que es otro reloj).
    const edadReg = ult ? Math.max(0, (d.corteMs - ult) / 60000) : null;
    return `<section class="card${apag ? ' apag' : ''}" style="border-top-color:${e.entrada ? '#6B2D2D' : '#0F5C45'}">
<div class="nm">${esc(e.nombreCorto)}</div><div class="rol">${glifoRol} ${esc(e.rolTexto)}</div>
<div class="estado ${enl.clase}">${enl.glifo} ${enl.texto}${e.enlace.edadMin != null ? `, ${esc(textoEdad(e.enlace.edadMin))}` : ''}.${cob}</div>
${apag ? `<div class="ult">Último registro ${ult ? esc(fechaHoraLocal(ult)) : SD}${edadReg != null ? ` (${esc(textoEdad(edadReg))})` : ''}</div>` : ''}
<div class="lb">Gasto</div><div class="num${g?.tipo === 'censurado' ? ' lt' : ''}${g == null ? ' sdn' : ''}">${gastoTxt}<span class="u">m³/s</span></div>
<div class="niv"><span class="lb">Nivel</span> <b>${e.ultimoNivel ? esc(fmt(e.ultimoNivel.v, 2)) : SD}</b><span class="u2">m</span></div>
${filaCambio}${rango}${conSpark ? spark(e.spark, apag) : ''}${nota}</section>`;
}

/** Contorno del espejo de agua de una presa (anillo [lon, lat] estimado por imagen satelital) y su superficie. */
export interface VasoContorno { id: string; areaKm2: number; contorno: [number, number][] }

export const INSET_ANCHO = 492;
export const INSET_ALTO = 340;
const NOMBRE_PRESA: Record<string, string> = { 'PRE-001': 'La Boquilla', 'PRE-002': 'Fco. I. Madero (Las Vírgenes)' };

/** Vista ampliada del recuadro de un vaso: la que mejor encuadra su contorno (a escala regional un espejo de ~50 km² es una mancha de 7 px). */
export function vistaVaso(v: VasoContorno): VistaMapa | null {
    if (v.contorno.length < 4) return null;
    return vistaMapa(v.contorno.map(([lon, lat]) => ({ lat, lon })), INSET_ANCHO, INSET_ALTO, 30, 12);
}

/** Recuadro de un vaso: teselas reales ampliadas + contorno + presa + escala. Sin teselas, el contorno sobre fondo liso. */
function recuadroVaso(v: VasoContorno, teselas: TeselaConUri[]): string {
    const vista = vistaVaso(v);
    if (!vista) return '';
    const f = (n: number) => n.toFixed(1);
    const presa = PRESAS_MAPA.find((p) => p.id === v.id);
    const base = teselas.map((t) => `<image href="${esc(t.uri)}" x="${f(t.px)}" y="${f(t.py)}" width="${TESELA_PX}" height="${TESELA_PX}" preserveAspectRatio="none"/>`).join('');
    const d = v.contorno.map(([lon, lat], i) => { const [x, y] = aPantalla(vista, lat, lon); return `${i ? 'L' : 'M'}${f(x)},${f(y)}`; }).join('');
    const pxy = presa ? aPantalla(vista, presa.lat, presa.lon) : null;
    const marca = pxy && pxy[0] > 12 && pxy[0] < INSET_ANCHO - 12 && pxy[1] > 12 && pxy[1] < INSET_ALTO - 12
        ? `<rect x="${f(pxy[0] - 14)}" y="${f(pxy[1] - 14)}" width="28" height="28" rx="4" fill="#0B2A4A" stroke="#fff" stroke-width="3"/>` : '';
    const latC = v.contorno.reduce((a, q) => a + q[1], 0) / v.contorno.length;
    const e = barraEscala(vista.z, latC, 150);
    return `<figure class="inset"><svg viewBox="0 0 ${INSET_ANCHO} ${INSET_ALTO}" width="${INSET_ANCHO}" height="${INSET_ALTO}" role="img" aria-label="Espejo de agua de ${esc(NOMBRE_PRESA[v.id] ?? v.id)}">
<defs><clipPath id="ic${esc(v.id)}"><rect width="${INSET_ANCHO}" height="${INSET_ALTO}" rx="14"/></clipPath></defs>
<g clip-path="url(#ic${esc(v.id)})"><rect width="${INSET_ANCHO}" height="${INSET_ALTO}" fill="#E9EEF1"/>${base}<path d="${d}Z" fill="${AZUL}" fill-opacity=".35" stroke="${AZUL}" stroke-width="3" stroke-dasharray="9 5" stroke-linejoin="round"/>${marca}</g>
<rect width="${INSET_ANCHO}" height="${INSET_ALTO}" rx="14" fill="none" stroke="#C9A227" stroke-width="3"/>
<g transform="translate(22,${INSET_ALTO - 40})"><path d="M0 0v12h${f(e.px)}v-12" fill="none" stroke="#0B2A4A" stroke-width="4"/><text x="${f(e.px / 2)}" y="-8" text-anchor="middle" font-size="26" font-weight="800" fill="#0B2A4A" stroke="#fff" stroke-width="7" paint-order="stroke">${e.km} km</text></g></svg>
<figcaption><b>${esc(NOMBRE_PRESA[v.id] ?? v.id)}</b> Espejo de agua estimado: ${esc(fmt(v.areaKm2, 1))} km²</figcaption></figure>`;
}

/** Vista del mapa para las estaciones con coordenadas y las dos presas; null si hay menos de 2 estaciones ubicadas. */
export function vistaInfografiaGoes(estaciones: DatosEstacionInfoGoes[]): VistaMapa | null {
    const con = estaciones.filter((e) => num(e.lat) && num(e.lon));
    if (con.length < 2) return null;
    return vistaMapa([...con.map((e) => ({ lat: e.lat as number, lon: e.lon as number })), ...PRESAS_MAPA.map((p) => ({ lat: p.lat, lon: p.lon }))], MAPA_ANCHO, MAPA_ALTO, 80);
}

/** Mapa real: teselas + contorno del vaso + marcadores geométricos con etiquetas sin solape. Sin trazos de río propios. */
function mapa(estaciones: DatosEstacionInfoGoes[], teselas: TeselaConUri[], vasos: VasoContorno[]): { svg: string; hayBase: boolean } {
    const vista = vistaInfografiaGoes(estaciones);
    if (!vista) return { svg: `<div class="mapa-sd">${SD} ubicaciones pendientes</div>`, hayBase: false };
    const f = (n: number) => n.toFixed(1);
    const con = estaciones.filter((e) => num(e.lat) && num(e.lon));
    const marcadores = [
        ...PRESAS_MAPA.map((p) => ({ id: p.id, tipo: 'presa' as const, xy: aPantalla(vista, p.lat, p.lon), lineas: [...p.lineas] })),
        ...con.map((e) => ({ id: e.id, tipo: (e.entrada ? 'entrada' : 'rio') as 'entrada' | 'rio', xy: aPantalla(vista, e.lat as number, e.lon as number), lineas: [e.nombreCorto] })),
    ];
    const etiquetas = colocarEtiquetas(marcadores.map((m) => ({ id: m.id, x: m.xy[0], y: m.xy[1], r: 26, lineas: m.lineas, tam: 34 })), MAPA_ANCHO, MAPA_ALTO);
    const base = teselas.map((t) => `<image href="${esc(t.uri)}" x="${f(t.px)}" y="${f(t.py)}" width="${TESELA_PX}" height="${TESELA_PX}" preserveAspectRatio="none"/>`).join('');
    // Contorno del espejo de agua: relleno translúcido (no tapa el topónimo de la tesela) y trazo punteado, que lo distingue del icono de presa.
    const contornos = vasos.filter((v) => v.contorno.length >= 4).map((v) => {
        const d = v.contorno.map(([lon, lat], i) => { const [x, y] = aPantalla(vista, lat, lon); return `${i ? 'L' : 'M'}${f(x)},${f(y)}`; }).join('');
        return `<path d="${d}Z" fill="${AZUL}" fill-opacity=".35" stroke="${AZUL}" stroke-width="3" stroke-dasharray="9 5" stroke-linejoin="round"/>`;
    }).join('');
    const marca = (m: typeof marcadores[number]): string => {
        const [x, y] = m.xy;
        if (m.tipo === 'entrada') return `<path d="M${f(x - 26)},${f(y - 22)}h52l-26,48z" fill="#C2570C" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>`;
        if (m.tipo === 'rio') return `<circle cx="${f(x)}" cy="${f(y)}" r="22" fill="#0F5C45" stroke="#fff" stroke-width="4"/>`;
        return `<rect x="${f(x - 22)}" y="${f(y - 22)}" width="44" height="44" rx="6" fill="#0B2A4A" stroke="#fff" stroke-width="4"/>`;
    };
    const lab = (e: ReturnType<typeof colocarEtiquetas>[number]): string =>
        `<text text-anchor="${e.anchor}" font-size="${e.tam}" font-weight="800" fill="#0B2A4A" stroke="#fff" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${e.lineas.map((l, i) => `<tspan x="${f(e.x)}" y="${f(e.y + i * e.tam * 1.15)}">${esc(l)}</tspan>`).join('')}</text>`;
    const centro = vista.oy + vista.alto / 2;
    const latCentro = (Math.atan(Math.sinh(Math.PI * (1 - (2 * centro) / (TESELA_PX * 2 ** vista.z)))) * 180) / Math.PI;
    const esc_ = barraEscala(vista.z, latCentro, 190);
    const hayBase = teselas.length > 0;
    const svg = `<svg viewBox="0 0 ${MAPA_ANCHO} ${MAPA_ALTO}" width="${MAPA_ANCHO}" height="${MAPA_ALTO}" role="img" aria-label="Mapa de ubicación de las estaciones y las presas">
<defs><clipPath id="mc"><rect width="${MAPA_ANCHO}" height="${MAPA_ALTO}" rx="18"/></clipPath></defs>
<g clip-path="url(#mc)"><rect width="${MAPA_ANCHO}" height="${MAPA_ALTO}" fill="#E9EEF1"/>${base}${contornos}
${marcadores.map(marca).join('')}${etiquetas.map(lab).join('')}</g>
<rect width="${MAPA_ANCHO}" height="${MAPA_ALTO}" rx="18" fill="none" stroke="#C9A227" stroke-width="4"/>
${hayBase ? `<g transform="translate(34,${MAPA_ALTO - 56})"><path d="M0 0v16h${f(esc_.px)}v-16" fill="none" stroke="#0B2A4A" stroke-width="5"/><text x="${f(esc_.px / 2)}" y="-10" text-anchor="middle" font-size="30" font-weight="800" fill="#0B2A4A" stroke="#fff" stroke-width="8" paint-order="stroke">${esc_.km} km</text></g>` : ''}
<g transform="translate(${MAPA_ANCHO - 50},84)"><path d="M0 44V-8M-13 8L0 -10L13 8" stroke="#0B2A4A" stroke-width="6" fill="none" stroke-linejoin="round"/><text x="0" y="-24" text-anchor="middle" font-size="32" font-weight="800" fill="#0B2A4A" stroke="#fff" stroke-width="8" paint-order="stroke">N</text></g></svg>`;
    return { svg, hayBase };
}

const CSS = `*{box-sizing:border-box;margin:0;padding:0}html,body{margin:0;background:#FAF6EA}
body{width:1080px;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#1B2733;font-variant-numeric:tabular-nums}
.pagina{width:1080px;padding:30px 36px 0;background:#FAF6EA}
.enc{display:flex;align-items:center;gap:22px}.logo-img{display:block;width:110px;height:96px;flex:none}.logo-sica{display:block;width:92px;height:96px;flex:none}
.sep{width:2px;height:80px;background:#C9A227;flex:none}
.marca b{display:block;font-size:32px;font-weight:700;color:#6B2D2D;line-height:1.1}.marca span{display:block;font-size:28px;font-weight:600;color:#3A4856;margin-top:4px}
h1{font-size:62px;line-height:1.05;font-weight:800;color:#0F5C45;margin-top:22px}
.fila{display:flex;gap:16px;align-items:stretch;margin:14px 0 20px}
.sello{flex:1;border:3px solid;border-radius:14px;padding:10px 20px;line-height:1.2}.sello b{display:block;font-size:36px;font-weight:800}.sello span{display:block;font-size:30px;font-weight:600}
.sello.ok{border-color:#1B8A5A;background:#DDF3E6;color:#0B5A3A}.sello.warn{border-color:#D9920B;background:#FCEBC4;color:#7A4A00}
.corte{border:3px solid #0B2A4A;border-radius:14px;padding:10px 20px;background:#fff;line-height:1.2;font-size:30px;font-weight:600;color:#0B2A4A;text-align:center}.corte b{display:block;font-size:34px;font-weight:800}
.mapacol svg{display:block}.atrib{font-size:24px;color:#3A4856;line-height:1.3;margin-top:8px}
.leyenda{display:flex;flex-wrap:wrap;gap:8px 26px;margin:12px 0 4px;font-size:30px;font-weight:600;color:#0B2A4A}.lg{display:flex;align-items:center;gap:10px}.lg svg{flex:none}
.nota-m{font-size:26px;line-height:1.3;color:#3A4856;margin:6px 0 18px}
.insets{display:flex;gap:24px;margin:0 0 24px}.inset{width:492px;margin:0}.inset svg{display:block}.inset figcaption{font-size:28px;line-height:1.25;color:#3A4856;margin-top:8px}.inset figcaption b{display:block;color:#0B2A4A;font-size:30px}
.inset-sd{align-self:flex-start;background:#fff;border:2px dashed #9AA3AC;border-radius:14px;padding:18px 20px}.inset-sd figcaption{margin-top:0}
.lectura{background:#0B2A4A;color:#fff;border-radius:16px;padding:24px 30px;margin-bottom:24px}.lectura h2{font-size:34px;color:#F2E3A6;margin-bottom:10px}
.lectura p{font-size:32px;line-height:1.3;font-weight:500;margin:0 0 12px}
.grid{display:flex;flex-wrap:wrap;gap:24px}
.card{width:492px;background:#fff;border:2px solid #E1D6AE;border-top:12px solid #0F5C45;border-radius:14px;padding:16px 20px 18px}
.nm{font-size:42px;font-weight:700;line-height:1.1;color:#0B2A4A}.rol{font-size:28px;font-weight:600;color:#3A4856;margin-top:4px;line-height:1.2}
.estado{font-size:28px;font-weight:600;margin-top:10px;line-height:1.25}.estado.on{color:#0B5A3A}.estado.ret,.estado.off{color:#7A4A00}
.ult{font-size:30px;font-weight:800;color:#7A4A00;margin-top:6px;line-height:1.2}
.lb{font-size:28px;font-weight:600;color:#3A4856;margin-top:10px}
.num{font-size:88px;font-weight:800;color:${AZUL};line-height:1.02;white-space:nowrap}.num.lt{font-size:80px}.num .u{font-size:32px;font-weight:700;margin-left:8px}.num.sdn{font-size:60px}
.niv{display:flex;align-items:baseline;gap:12px;margin-top:2px}.niv .lb{margin-top:0}.niv b{font-size:52px;font-weight:800;color:#0B2A4A}.u2{font-size:30px;font-weight:700;color:#0B2A4A}
.camb{display:flex;flex-wrap:wrap;gap:6px 10px;margin:12px 0 8px;padding:10px 0;border-top:1px solid #E1D6AE;font-size:28px}
.cl{font-weight:600;color:#3A4856;width:100%}.cv{white-space:nowrap;font-weight:800;color:#0B2A4A;background:#EEF2F6;border-radius:8px;padding:2px 10px}.cv i{font-style:normal;font-weight:600;color:#3A4856}
.mpm{font-size:28px;line-height:1.3;color:#3A4856;margin:4px 0 8px}.mpm b{color:#0B2A4A;font-weight:800}.mpm.rng b{color:#7A4A00;font-size:32px}
.spk{display:block;width:100%;height:auto;margin-top:4px}.plana{font-size:28px;color:#3A4856;margin-top:4px}
.nota-c{margin-top:10px;background:#FCEBC4;border:2px solid #D9920B;border-radius:10px;padding:10px 14px;font-size:28px;color:#4A2E00;line-height:1.3}
.apag .num,.apag .niv b,.apag .u2{color:#566370}.apag .cv{background:#E6E9EC}
.pie{font-size:26px;color:#3A4856;padding:22px 0 8px;line-height:1.35}.folio{font-size:26px;color:#3A4856;text-align:right;padding:0 0 26px}
.sd{display:inline-block;border:2px solid #7A8591;border-radius:8px;padding:0 8px;font-weight:800;color:#3F4852;background:#E6E9EC;font-size:.8em;vertical-align:middle}
.mapa-sd{width:1008px;height:260px;display:flex;align-items:center;justify-content:center;font-size:30px;background:#F4F8FB;border:3px solid #C9A227;border-radius:18px}`;

// ── Ficha técnica por estación ─────────────────────────────────────────────────

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const fT = (ms: number): string => fechaHoraLocal(ms);

/** Gráfica con ejes legibles (texto de 24 px a 1080 de ancho): eje de tiempo local, banda mín–máx y huecos que cortan la línea. */
function grafica(serie: PuntoSerie[], o: { desde: number; hasta: number; unidad: string; titulo: string; color: string; pasoMin: number }): string {
    const W = 1008, H = 340, ml = 104, mr = 26, mt = 30, mb = 76;
    const pw = W - ml - mr, ph = H - mt - mb;
    const pts = serie.filter((p) => Number.isFinite(p.v));
    if (pts.length < 2) return `<div class="grafica-sd">${SD} sin lecturas suficientes en el periodo</div>`;
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { mn = Math.min(mn, p.min); mx = Math.max(mx, p.max); }
    const tk = ticksNice(mn, mx, 4);
    const lo = tk.lo, hi = tk.hi;
    const x = (t: number) => ml + ((t - o.desde) / Math.max(1, o.hasta - o.desde)) * pw;
    const y = (v: number) => mt + ph - ((v - lo) / Math.max(1e-9, hi - lo)) * ph;
    const gap = Math.max(o.pasoMin * 60000 * 2.5, 100 * 60000);
    const segs: PuntoSerie[][] = [];
    let cur: PuntoSerie[] = [];
    for (const p of pts) { if (cur.length && p.t - cur[cur.length - 1].t > gap) { segs.push(cur); cur = []; } cur.push(p); }
    if (cur.length) segs.push(cur);
    let g = `<svg class="graf" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.titulo)}">`;
    for (const v of tk.t) {
        if (v < lo - 1e-9 || v > hi + 1e-9) continue;
        g += `<line x1="${ml}" x2="${ml + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="#E7E4DE" stroke-width="2"/><text x="${ml - 10}" y="${f1(y(v) + 8)}" text-anchor="end" font-size="24" fill="#3A4856">${esc(fmt(v, tk.dec))}</text>`;
    }
    // La unidad va en el título de la gráfica («Gasto, m³/s»): rotularla también sobre el eje se encima con la marca superior.
    const by = mt + ph;
    g += `<line x1="${ml}" x2="${ml + pw}" y1="${by}" y2="${by}" stroke="#9AA3AC" stroke-width="2"/>`;
    for (const k of ticksTiempo(o.desde, o.hasta)) {
        const xx = x(k.t);
        if (xx < ml - 1 || xx > ml + pw + 1) continue;
        g += `<line x1="${f1(xx)}" x2="${f1(xx)}" y1="${by}" y2="${by + 7}" stroke="#9AA3AC" stroke-width="2"/><text x="${f1(xx)}" y="${by + 31}" text-anchor="middle" font-size="24" fill="#3A4856">${esc(k.hora)}</text>${k.dia ? `<text x="${f1(xx)}" y="${by + 58}" text-anchor="middle" font-size="24" font-weight="700" fill="#3A4856">${esc(k.dia)}</text>` : ''}`;
    }
    for (const sg of segs) {
        if (sg.length > 1) {
            const arriba = sg.map((p) => `${f1(x(p.t))},${f1(y(p.max))}`), abajo = sg.slice().reverse().map((p) => `${f1(x(p.t))},${f1(y(p.min))}`);
            g += `<polygon points="${arriba.concat(abajo).join(' ')}" fill="${o.color}" fill-opacity=".14"/>`;
            g += `<polyline points="${sg.map((p) => `${f1(x(p.t))},${f1(y(p.v))}`).join(' ')}" fill="none" stroke="${o.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
        } else g += `<circle cx="${f1(x(sg[0].t))}" cy="${f1(y(sg[0].v))}" r="5" fill="${o.color}"/>`;
    }
    const u = pts[pts.length - 1];
    return g + `<circle cx="${f1(x(u.t))}" cy="${f1(y(u.v))}" r="8" fill="${o.color}" stroke="#fff" stroke-width="3"/></svg>`;
}

/** Tira de 24 h del enlace: lleno = mensaje bueno, con × = solo mensajes con falla, punteado = ninguno. */
function tiraEnlace(celdas: CeldaEnlace[]): string {
    const n = celdas.length || 24, W = 1008, gap = 4, cw = (W - gap * (n - 1)) / n;
    let g = `<svg class="tira" viewBox="0 0 ${W} 84" width="${W}" height="84" role="img" aria-label="Mensajes recibidos en las últimas 24 horas">`;
    celdas.forEach((c, i) => {
        const cx = i * (cw + gap);
        if (c === 'bueno') g += `<rect x="${f1(cx)}" y="2" width="${f1(cw)}" height="34" rx="4" fill="#1A7F4B"/>`;
        else if (c === 'falla') g += `<rect x="${f1(cx)}" y="2" width="${f1(cw)}" height="34" rx="4" fill="#B45309"/><path d="M${f1(cx + 4)} 10 L${f1(cx + cw - 4)} 28 M${f1(cx + cw - 4)} 10 L${f1(cx + 4)} 28" stroke="#fff" stroke-width="3"/>`;
        else g += `<rect x="${f1(cx + 1)}" y="3" width="${f1(cw - 2)}" height="32" rx="4" fill="#fff" stroke="#9AA3AC" stroke-width="2" stroke-dasharray="4 4"/>`;
    });
    for (const [i, t] of [[0, '−24 h'], [12, '−12 h']] as [number, string][]) g += `<text x="${f1(i * (cw + gap))}" y="70" font-size="24" fill="#3A4856">${t}</text>`;
    return g + `<text x="${W}" y="70" text-anchor="end" font-size="24" fill="#3A4856">ahora</text></svg>`;
}

/** Barra de cobertura 0 a 100 % con la marca del umbral de confiabilidad y glifo + texto (no depende solo del color). */
function barraCobertura(pct: number | null): string {
    if (pct == null || !Number.isFinite(pct)) return `<div class="cob-sd">Cobertura ${SD}</div>`;
    const ok = pct >= COBERTURA_MIN_CONFIABLE, parcial = !ok && pct >= 50;
    const col = ok ? '#1A7F4B' : parcial ? '#B45309' : '#B42318';
    const txt = ok ? '● Confiable' : parcial ? '▲ Parcial' : '■ Insuficiente';
    const W = 440, m = (COBERTURA_MIN_CONFIABLE / 100) * W;
    return `<svg class="cobsvg" viewBox="0 0 ${W} 26" width="${W}" height="26" role="img" aria-label="Cobertura ${esc(fmt(pct, 0))} por ciento"><rect y="6" width="${W}" height="14" rx="7" fill="#ECE9E2"/><rect y="6" width="${f1((Math.min(100, Math.max(0, pct)) / 100) * W)}" height="14" rx="7" fill="${col}"/><line x1="${f1(m)}" x2="${f1(m)}" y1="0" y2="26" stroke="#1B2733" stroke-width="3"/></svg><div class="cob-txt" style="color:${col}">${txt}, ${esc(fmt(pct, 0))} %</div>`;
}

type CampoStat = 'min' | 'max' | 'media' | 'mediana' | 'p10' | 'p90' | 'desv' | 'n';
const celdaStat = (r: RangoStat | null, dec: number, campo: CampoStat): string => {
    if (!r) return SD;
    if (campo === 'n') return esc(String(r.n));
    const v = r[campo];
    const base = v == null ? SD : esc(fmt(v, campo === 'desv' ? Math.max(dec, 2) : dec));
    return campo === 'min' ? `${base}<small>${esc(fT(r.tMin))}</small>` : campo === 'max' ? `${base}<small>${esc(fT(r.tMax))}</small>` : base;
};

/** Una ficha independiente por estación: lectura actual, gráfica con ejes, tabla estadística, indicadores y enlace. */
function fichaTecnica(e: DatosEstacionInfoGoes, d: DatosInfografiaGoes, cfg: ConfigInfografiaGoes, n: number, total: number, encabezado: string): string {
    const enl = ENLACE[e.enlace.clave];
    const t = e.tec;
    const rolColor = e.entrada ? '#6B2D2D' : '#0F5C45';
    const apag = e.obsoleto;
    const ult = Math.max(e.ultimoNivel?.t ?? 0, e.ultimoGasto?.t ?? 0);
    const edadReg = ult ? Math.max(0, (d.corteMs - ult) / 60000) : null;
    const g = e.ultimoGasto;
    const gastoTxt = g == null ? SD : g.tipo === 'censurado' ? `&lt; ${esc(e.gastoRango?.umbral ?? 15)}` : esc(fmt(g.v, 1));
    const v24 = e.var24, v7 = e.var7;
    const cambios = [
        v24.nivel.dir !== 'sd' || v24.gasto.dir !== 'sd' ? `<div class="camb"><span class="cl">En 24 h</span>${cambio('Nivel', v24.nivel, 2, 'm')}${cambio('Gasto', v24.gasto, 1, 'm³/s')}</div>` : '',
        v7.nivel.dir !== 'sd' || v7.gasto.dir !== 'sd' ? `<div class="camb"><span class="cl">En 7 días</span>${cambio('Nivel', v7.nivel, 2, 'm')}${cambio('Gasto', v7.gasto, 1, 'm³/s')}</div>` : '',
    ].join('');
    const noRep = !!e.gastoRango && !e.gastoRango.representativo;
    const pasoMin = Math.max(t.intervaloMin, 5);
    // Babisas con más de la mitad bajo el umbral: el gasto sin ceros engaña, se grafica solo el nivel.
    const graficas = [
        !noRep && t.serieGasto.length ? `<h3>Gasto, m³/s</h3>${grafica(t.serieGasto, { desde: d.desdeMs, hasta: d.hastaMs, unidad: 'm³/s', titulo: `Gasto de ${e.nombreCorto}`, color: AZUL, pasoMin })}` : '',
        `<h3>Nivel, m</h3>${grafica(t.serieNivel, { desde: d.desdeMs, hasta: d.hastaMs, unidad: 'm', titulo: `Nivel de ${e.nombreCorto}`, color: '#0F5C45', pasoMin })}`,
    ].join('');
    const gastoMediaTxt = e.gastoRango ? `${esc(fmt(e.gastoRango.inf, 1))} a ${esc(fmt(e.gastoRango.sup, 1))}` : celdaStat(t.gasto, 1, 'media');
    const fila = (rot: string, campo: CampoStat): string =>
        `<tr><th scope="row">${rot}</th><td>${celdaStat(t.nivel, 2, campo)}</td><td>${celdaStat(t.gasto, 1, campo)}</td></tr>`;
    const tabla = cfg.estadistica
        ? `<table class="stat"><caption>Estadística del periodo, ${esc(d.etiquetaVentana)}</caption><thead><tr><th></th><th scope="col">Nivel (m)</th><th scope="col">Gasto (m³/s)${e.gastoRango ? '<small>solo sobre el umbral</small>' : ''}</th></tr></thead><tbody>
${fila('Lecturas', 'n')}${fila('Mínimo', 'min')}${fila('Máximo', 'max')}<tr><th scope="row">Media</th><td>${celdaStat(t.nivel, 2, 'media')}</td><td>${gastoMediaTxt}${e.gastoRango ? '<small>rango por lecturas bajo el umbral</small>' : ''}</td></tr>${fila('Mediana', 'mediana')}${fila('Percentil 10', 'p10')}${fila('Percentil 90', 'p90')}${fila('Desviación', 'desv')}</tbody></table>`
        : '';
    const vol = t.volumenRango ? `${esc(fmt(t.volumenRango.inf, 2))} a ${esc(fmt(t.volumenRango.sup, 2))} Mm³` : t.volumen ? `${esc(fmt(t.volumen.mm3, 2))} Mm³` : SD;
    const volNota = t.volumenRango ? 'rango: ceros como 0 y como umbral' : t.volumen ? `${esc(fmt(t.volumen.pctIntegrado, 0))} % del tiempo integrado` : 'sin tramos continuos';
    const indicadores = cfg.estadistica
        ? `<div class="ind"><div><i>Pendiente del gasto</i><b>${t.pendienteGastoDia == null || noRep ? SD : `${esc(fmtDelta(t.pendienteGastoDia, 2))} m³/s`}</b><small>${noRep ? 'gasto no representativo' : 'por día'}</small></div>
<div><i>Volumen integrado</i><b>${vol}</b><small>${volNota}</small></div>
<div><i>Lecturas de gasto</i><b>${esc(String(t.lecturasGasto.recibidas))}</b><small>${t.lecturasGasto.bajoUmbral ? `${esc(String(t.lecturasGasto.bajoUmbral))} bajo el umbral` : 'todas sobre el umbral'}</small></div>
<div><i>Cobertura</i>${barraCobertura(e.coberturaPct)}<small>${t.cobertura ? `${esc(String(t.cobertura.recibidas))} de ${esc(String(t.cobertura.esperadas))} lecturas recibidas, cada ${esc(String(t.intervaloMin))} min` : ''}${noRep ? '. Es la cobertura de lo recibido: el gasto sigue siendo poco representativo' : ''}</small></div></div>`
        : '';
    const enlaceBloque = cfg.enlace
        ? `<h3>Enlace satelital, últimas 24 h</h3>${tiraEnlace(t.enlace.tira)}<div class="enl-txt">${t.enlace.senalDbm == null ? 'Señal S/D' : `Señal ${esc(fmt(t.enlace.senalDbm, 0))} dBm`}. ${t.enlace.pctBuenos == null ? 'Sin mensajes' : `${esc(fmt(t.enlace.pctBuenos, 0))} % de los mensajes buenos (${esc(String(t.enlace.buenos))} de ${esc(String(t.enlace.total))})`}.</div>`
        : '';
    const notas = [
        e.entrada ? 'Mide la ENTRADA a la presa, no la extracción.' : '',
        e.gastoRango ? `Gasto bajo el umbral del sensor (~${e.gastoRango.umbral} m³/s): el 0.00 que reporta no es caudal nulo (causa sin confirmar). La media y el volumen son rangos${noRep ? '; con más de la mitad de las lecturas bajo el umbral, el mínimo, el máximo y los percentiles describen solo el tiempo sobre el umbral' : ''}.` : '',
        apag ? `Estación sin transmisión: se muestra el último registro conocido (${ult ? esc(fT(ult)) : 'S/D'}).` : '',
    ].filter(Boolean).map((x) => `<li>${x}</li>`).join('');
    return `<div class="pagina tec">${encabezado}
<div class="tec-cab" style="border-top-color:${rolColor}"><h2>${esc(e.nombre)}</h2><div class="rol">${e.entrada ? '▼' : '●'} ${esc(e.rolTexto)}</div>
<div class="meta">DCP ${esc(e.id)}${e.lat != null && e.lon != null ? `, ${esc(fmt(e.lat, 4))}, ${esc(fmt(e.lon, 4))}` : ', ubicación pendiente'}. Periodo: ${esc(d.etiquetaVentana)}.</div>
<div class="estado ${enl.clase}">${enl.glifo} ${enl.texto}${e.enlace.edadMin != null ? `, ${esc(textoEdad(e.enlace.edadMin))}` : ''}.</div></div>
<div class="tec-actual">${apag ? `<div class="ult">Último registro ${ult ? esc(fT(ult)) : SD}${edadReg != null ? ` (${esc(textoEdad(edadReg))})` : ''}</div>` : ''}
<div class="tec-hero"><div><div class="lb">Gasto</div><div class="num${g?.tipo === 'censurado' ? ' lt' : ''}${g == null ? ' sdn' : ''}">${gastoTxt}<span class="u">m³/s</span></div></div><div><div class="lb">Nivel</div><div class="num2${e.ultimoNivel ? '' : ' sdn'}">${e.ultimoNivel ? esc(fmt(e.ultimoNivel.v, 2)) : SD}<span class="u2">m</span></div></div></div>${cambios}</div>
${graficas}${tabla}${indicadores}${enlaceBloque}${notas ? `<ul class="notas-t">${notas}</ul>` : ''}
<div class="folio-t">Ficha ${n} de ${total}. ${esc(d.corteTexto)}.</div></div>`;
}

const CSS_TEC = `
.pagina{margin:0 auto 28px}
.pagina.tec{padding-bottom:20px}.enc.compacto{gap:16px}.enc.compacto .logo-img{width:82px;height:72px}.enc.compacto .logo-sica{width:70px;height:72px}.enc.compacto .sep{height:60px}.enc.compacto .marca b{font-size:28px}.enc.compacto .marca span{font-size:26px}
.tec-cab{background:#fff;border:2px solid #E1D6AE;border-top:12px solid #0F5C45;border-radius:14px;padding:16px 24px;margin-top:18px}.tec-cab h2{font-size:54px;font-weight:800;color:#0B2A4A;line-height:1.05}
.tec-cab .meta{font-size:26px;color:#3A4856;margin-top:6px;line-height:1.3}.tec-cab .rol{font-size:30px}
.tec-actual{margin-top:16px}.tec-hero{display:flex;gap:40px;align-items:flex-end}.tec-hero .num{font-size:104px}.tec-hero .num2{font-size:76px;font-weight:800;color:#0B2A4A;line-height:1}
.tec-actual .camb{margin:10px 0 0;padding:8px 0;flex-wrap:nowrap;align-items:center}.tec-actual .cl{width:auto;flex:none;min-width:150px}
h3{font-size:32px;font-weight:700;color:#0B2A4A;margin:20px 0 6px}.graf{display:block;width:100%;height:auto}.grafica-sd{font-size:28px;color:#3A4856;padding:40px 0;text-align:center;border:2px dashed #9AA3AC;border-radius:12px}
table.stat{width:100%;border-collapse:collapse;margin-top:22px;font-size:28px}.stat caption{text-align:left;font-size:32px;font-weight:700;color:#0B2A4A;padding-bottom:8px}
.stat th,.stat td{border-top:1px solid #E1D6AE;padding:6px 10px;text-align:right;font-weight:600;color:#0B2A4A}.stat th[scope=row]{text-align:left;color:#3A4856}.stat thead th{border-top:0;font-size:28px;font-weight:800;vertical-align:bottom}
.stat small{display:block;font-size:26px;font-weight:500;color:#3A4856}
.ind{display:flex;flex-wrap:wrap;gap:14px;margin-top:20px}.ind>div{width:497px;background:#fff;border:2px solid #E1D6AE;border-radius:12px;padding:12px 16px}
.ind i{display:block;font-style:normal;font-size:28px;font-weight:600;color:#3A4856}.ind b{display:block;font-size:42px;font-weight:800;color:#0B2A4A;line-height:1.15}.ind small{display:block;font-size:26px;color:#3A4856;line-height:1.25}
.cobsvg{display:block;margin-top:8px;width:100%;height:auto}.cob-txt{font-size:30px;font-weight:800;margin-top:2px}.cob-sd{font-size:30px;margin-top:4px}
.tira{display:block;width:100%;height:auto}.enl-txt{font-size:28px;color:#3A4856;margin-top:4px}
.notas-t{margin:20px 0 0;padding:12px 16px 12px 40px;font-size:28px;line-height:1.35;color:#4A2E00;background:#FCEBC4;border:2px solid #D9920B;border-radius:10px}.notas-t li{margin:4px 0}
.folio-t{font-size:26px;color:#3A4856;text-align:right;margin-top:18px}
@media print{html,body{background:#FAF6EA!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pagina{margin:0!important;break-after:page;page-break-after:always}.pagina:last-child{break-after:auto;page-break-after:auto}}`;

export interface OpcionesInfografiaGoes {
    /** Logo institucional del sistema SICA 005 (public/logos/SICA005.png) como data URI; sin él, hueco vacío. */
    logoSica?: string;
    /** Contornos de vaso (Manejo de vaso: detectaSuperficieVaso). Sin ellos solo se marcan las presas. */
    vasos?: VasoContorno[];
    /** Logo OFICIAL de la SRL (public/logos/logo-srl.png) como data URI. Sin él queda el hueco vacío: nunca se recrea a mano. */
    logo?: string;
    /** Teselas del mapa ya descargadas (descargarTeselas). Vacío = sin imagen base. */
    teselas?: TeselaConUri[];
    /** Teselas de cada recuadro de vaso, por id de presa (vistaVaso + descargarTeselas). */
    teselasVaso?: Record<string, TeselaConUri[]>;
    /** Filtros de contenido (formato, plano, vasos, lectura…). Por defecto: resumen completo, como la versión rápida. */
    config?: ConfigInfografiaGoes;
}

const CONFIG_RESUMEN: ConfigInfografiaGoes = {
    formato: 'resumen', hoja: 'pantalla', estaciones: [], periodo: { tipo: '24h', desde: '', hasta: '' },
    mapa: true, vasos: true, lectura: true, minigraficas: true, estadistica: false, enlace: false,
};

/**
 * Sin object-fit en los logos (Safari/iPad no lo respeta dentro de foreignObject): ancho y alto fijos, como en la infografía de presas.
 * Devuelve un documento con una o varias `.pagina` de 1080 px: cada una se exporta como imagen u hoja propia (PNG, PDF o HTML).
 */
export function htmlInfografiaGoes(d: DatosInfografiaGoes, { logo = '', logoSica = '', teselas = [], vasos = [], teselasVaso = {}, config }: OpcionesInfografiaGoes = {}): string {
    const cfg = contenidoEfectivo(config ?? CONFIG_RESUMEN);
    // Hojas de papel (Carta, media Carta, mitad de página): fichas técnicas con su propia plantilla, una hoja por ficha.
    if (cfg.formato === 'tecnico' && dimensionHoja(cfg.hoja).papel) return htmlFichasPapel(d, cfg.hoja, { logo, logoSica });
    const tecnico = cfg.formato === 'tecnico';
    const r = d.resumen;
    const ok = r.enLinea === r.total;
    const conEdad = d.estaciones.filter((e) => e.enlace.edadMin != null);
    // Con alguna estación callada, el sello nombra a la peor: «el mensaje más reciente» de otra daría una falsa tranquilidad.
    const peor = conEdad.length ? conEdad.reduce((a, b) => ((b.enlace.edadMin as number) > (a.enlace.edadMin as number) ? b : a)) : null;
    const detalleSello = peor == null ? 'Sin mensajes (S/D)' : ok ? `Último mensaje más antiguo: ${textoEdad(peor.enlace.edadMin)}` : `${peor.nombreCorto}: último mensaje ${textoEdad(peor.enlace.edadMin)}`;
    const lectura = d.lectura.map((p) => `<p>${esc(p)}</p>`).join('');
    const logoImg = logo ? `<img class="logo-img" src="${esc(logo)}" alt="SRL Unidad Conchos, Delicias" width="110" height="96">` : '<div class="logo-img"></div>';
    const logoSicaImg = logoSica ? `<img class="logo-sica" src="${esc(logoSica)}" alt="SICA 005, Distrito 005" width="92" height="96">` : '<div class="logo-sica"></div>';
    const encabezado = (compacto: boolean) => `<div class="enc${compacto ? ' compacto' : ''}">${logoImg}<div class="sep"></div>${logoSicaImg}<div class="marca"><b>SRL Unidad Conchos</b><span>Distrito de Riego 005 Delicias</span></div></div>`;
    const m = cfg.mapa ? mapa(d.estaciones, teselas, cfg.vasos ? vasos : []) : null;
    const hayMapa = !!m && m.svg.startsWith('<svg');
    const vasosOk = cfg.mapa && cfg.vasos ? vasos.filter((v) => v.contorno.length >= 4) : [];
    const hayBabisas = d.estaciones.some((e) => e.gastoRango);
    const leyenda = m == null ? '' : hayMapa
        ? `<div class="leyenda"><span class="lg"><svg width="36" height="34"><path d="M3 3h30l-15 28z" fill="#C2570C"/></svg>Entrada a presa</span><span class="lg"><svg width="34" height="34"><circle cx="17" cy="17" r="13" fill="#0F5C45"/></svg>Estación de río</span><span class="lg"><svg width="34" height="34"><rect x="3" y="3" width="28" height="28" rx="4" fill="#0B2A4A"/></svg>Presa</span>${vasosOk.length ? `<span class="lg"><svg width="40" height="34"><path d="M4 24C8 9 22 5 36 11C32 26 16 31 4 24Z" fill="${AZUL}" fill-opacity=".35" stroke="${AZUL}" stroke-width="3" stroke-dasharray="6 4"/></svg>Espejo de agua</span>` : ''}</div>
<div class="nota-m">Solo se marcan ubicaciones registradas; no se dibuja el trazo de los ríos.${vasosOk.length ? ` El espejo de agua es una estimación por imagen satelital (fecha de la escena S/D; ${vasosOk.map((v) => `${v.id === 'PRE-001' ? 'La Boquilla' : 'Fco. I. Madero'} ${fmt(v.areaKm2, 1)} km²`).join(', ')}), no una medición de campo.` : ''}${hayBabisas ? ' Babisas está sobre el Río San Pedro, hacia la presa El Granero (fuera del mapa).' : ''}</div>`
        : `<div class="nota-m">Ubicaciones pendientes: ${SD}</div>`;
    const atrib = m == null ? '' : m.hayBase ? `<div class="atrib">${esc(TESELA_ATRIBUCION)}</div>` : hayMapa ? '<div class="atrib">Sin imagen base: ubicaciones aproximadas, sin escala.</div>' : '';
    // Un recuadro ampliado por vaso con contorno; el que no se pudo estimar se declara S/D (no se reutiliza uno viejo).
    const presasSinContorno = Object.keys(NOMBRE_PRESA).filter((id) => !vasosOk.some((v) => v.id === id));
    const recuadros = vasosOk.length > 0
        ? `<div class="insets">${vasosOk.map((v) => recuadroVaso(v, teselasVaso[v.id] ?? [])).join('')}${presasSinContorno.map((id) => `<figure class="inset inset-sd"><figcaption><b>${esc(NOMBRE_PRESA[id])}</b> Espejo de agua: ${SD} (no se pudo estimar por imagen satelital)</figcaption></figure>`).join('')}</div>` : '';
    const local = new Date(d.corteMs - 6 * 3600000).toISOString();
    const folio = `GOES-${local.slice(0, 10).replace(/-/g, '')}-${local.slice(11, 16).replace(':', '')}`;
    const franja = `<h1>Estaciones hidrométricas${tecnico ? ', ficha técnica' : ''}</h1>
<div class="fila"><div class="sello ${ok ? 'ok' : 'warn'}"><b>${ok ? '●' : '▲'} ${esc(r.enLinea)} de ${esc(r.total)} ${ok ? 'en línea' : 'transmiten'}</b><span>${esc(detalleSello)}</span></div><div class="corte"><b>${esc(d.corteTexto.replace(/^Corte: /, ''))}</b>${esc(d.etiquetaVentana)}</div></div>`;
    const bloquePlano = m ? `<div class="mapacol">${m.svg}${atrib}</div>${leyenda}\n${recuadros}` : '';
    const bloqueLectura = cfg.lectura ? `<div class="lectura"><h2>Lectura</h2>${lectura}</div>` : '';
    const pie = `<div class="pie">${esc(d.fuente)} Cobertura: lecturas recibidas frente a las esperadas en el periodo. ${d.limitaciones.map(esc).join(' ')}</div>`;
    const tarjetas = `<div class="grid">${d.estaciones.map((e) => tarjeta(e, d, cfg.minigraficas)).join('')}</div>`;

    const paginas: string[] = [];
    if (!tecnico) {
        paginas.push(`<div class="pagina">${encabezado(false)}${franja}${bloquePlano}${bloqueLectura}${tarjetas}${pie}<div class="folio">Folio ${esc(folio)}</div></div>`);
    } else {
        if (cfg.mapa || cfg.lectura) paginas.push(`<div class="pagina">${encabezado(false)}${franja}${bloquePlano}${bloqueLectura}${tarjetas}${pie}<div class="folio">Folio ${esc(folio)}, panorama</div></div>`);
        d.estaciones.forEach((e, i) => paginas.push(fichaTecnica(e, d, cfg, i + 1, d.estaciones.length, encabezado(true))));
    }
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estaciones hidrométricas GOES</title><style>${CSS}${CSS_TEC}</style></head><body>${paginas.join('\n')}</body></html>`;
}

/** Base del nombre de archivo (sin extensión): estaciones-goes-tecnico-7d-2026-10-27-1800 (fecha y hora de Chihuahua, UTC-6 fijo). */
export function nombreBaseInfografiaGoes(d: Pick<DatosInfografiaGoes, 'ventana' | 'corteMs'>, formato: 'resumen' | 'tecnico' = 'resumen', hoja: string = 'pantalla'): string {
    const iso = new Date(d.corteMs - 6 * 3600000).toISOString();
    return `estaciones-goes-${formato === 'tecnico' ? 'tecnico-' : ''}${formato === 'tecnico' && hoja !== 'pantalla' ? `${hoja}-` : ''}${d.ventana}-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/** Nombre de archivo del PNG con fecha y hora de Chihuahua: estaciones-goes-24h-2026-10-27-1800.png (Chihuahua: UTC-6 fijo). */
export function nombreArchivoInfografiaGoes(d: Pick<DatosInfografiaGoes, 'ventana' | 'corteMs'>): string {
    const iso = new Date(d.corteMs - 6 * 3600000).toISOString();
    return `estaciones-goes-${d.ventana}-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.png`;
}
