/**
 * informeNdviSvg — gráficos SVG PUROS del informe de NDVI: plano cartográfico (relieve + clase de vigor), mini-plano de módulo,
 * sparkline con escala propia y serie mensual. Sin librerías ni red.
 * Reglas del sistema visual: el color de los DATOS es solo la clase discreta de vigor (CLASES_NDVI) y S/D va hachurado; los
 * módulos se identifican por monograma + forma (informeNdviMarcas.ts), no por color; todo texto SVG ≥ FS_MIN unidades
 * (cada figura se dibuja a su ancho nominal: 1 unidad = 1 px = 0.75 pt al imprimir).
 */
import { numeroGeojsonDeSRL, MODULOS_SRL_IDS } from './modulosSRL';
import { NDVI_RANGO, NDVI_TICKS, SD_FONDO, SD_TRAZO, colorClaseNdvi } from './ndviRampa';
import { escSvg } from './informeHistoricoSvg';
import { mesLegible } from './informeBase';
import { cabeceraSvg } from './informeNdviSvgComparativo';
import { FS_MIN, TRAZO_MODULO, formaDeModulo, formaSvg, rotuloModuloSvg, rotuloSrlSvg } from './informeNdviMarcas';
import { simplificarAnillosDP, type Punto } from './geoSimplifica';
import type { ModuloInforme } from './informeNdviDatos';

export type Anillo = [number, number][];
export type Contornos = Record<number, Anillo[]>;

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
const f1 = (n: number) => String(Number(n.toFixed(1)));

/** Trazo SVG en coordenadas relativas (M x,y l dx,dy …) a partir de puntos ya proyectados: ≈ 35 % menos bytes que el absoluto. Redondea el absoluto y resta, así que no acumula deriva. */
export function trazoRelativo(pts: [number, number][], cierra: boolean): string {
    if (!pts.length) return '';
    const r = pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
    let d = `M${f1(r[0][0])},${f1(r[0][1])}l`;
    const partes: string[] = [];
    for (let i = 1; i < r.length; i++) {
        const dx = Math.round((r[i][0] - r[i - 1][0]) * 10) / 10, dy = Math.round((r[i][1] - r[i - 1][1]) * 10) / 10;
        if (dx === 0 && dy === 0) continue;
        partes.push(`${f1(dx)},${f1(dy)}`);
    }
    d += partes.join(' ');
    return partes.length ? d + (cierra ? 'z' : '') : `M${f1(r[0][0])},${f1(r[0][1])}`;
}

/** Tolerancia de Douglas-Peucker de los contornos del plano (m): a la escala del informe 40 m son < 0.3 px. */
export const TOLERANCIA_CONTORNO_M = 75;
/** Tolerancia de los mini-planos de ficha (58 px para toda la SRL: 1 px ≈ 700 m): evita repetir ocho KB de vértices en cada ficha. */
const TOLERANCIA_MINI_M = 700;
const cacheMini = new WeakMap<Contornos, Contornos>();
function contornosMini(c: Contornos): Contornos {
    let r = cacheMini.get(c);
    if (!r) {
        r = {};
        for (const k of Object.keys(c)) r[Number(k)] = simplificarAnillosDP(c[Number(k)] as Punto[][], TOLERANCIA_MINI_M).map((a) => a.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))] as [number, number]));
        cacheMini.set(c, r);
    }
    return r;
}

/**
 * GeoJSON de modulos.geojson → anillos exteriores por Módulo SRL (el geojson no usa la numeración SRL), simplificados con
 * Douglas-Peucker en metros (los vértices compartidos entre módulos se conservan como anclas).
 */
export function contornosAAnillos(fc: GeoJSON.FeatureCollection | null, toleranciaM = TOLERANCIA_CONTORNO_M): Contornos {
    const salida: Contornos = {};
    if (!fc) return salida;
    const crudos: { srl: number; anillo: Anillo }[] = [];
    for (const srl of MODULOS_SRL_IDS) {
        const numeroGeojson = numeroGeojsonDeSRL(srl);
        const feature = fc.features.find((f) => Number(f.properties?.numero_modulo) === numeroGeojson);
        if (!feature) continue;
        const g = feature.geometry;
        const anillos: Anillo[] =
            g.type === 'Polygon' ? [g.coordinates[0] as Anillo] :
            g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0] as Anillo) : [];
        anillos.forEach((anillo) => crudos.push({ srl, anillo }));
    }
    const simples = simplificarAnillosDP(crudos.map((c) => c.anillo as Punto[]), toleranciaM);
    crudos.forEach((c, i) => { (salida[c.srl] ??= []).push(simples[i].map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))] as [number, number])); });
    return salida;
}

/** Contexto cartográfico del plano: relieve (JPEG incrustado), canal, río y los otros módulos del DR-005. */
export interface ContextoPlano {
    /** [minLon, minLat, maxLon, maxLat] CRS84 EXACTO del JPEG del relieve; fija también la extensión del plano. */
    bbox: [number, number, number, number];
    /** `data:image/jpeg;base64,...` (vacío = plano sin relieve). */
    relieveUri: string;
    canal: Punto[][];
    rio: Punto[][];
    vecinos: Punto[][];
}

interface Bbox { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number }

function bboxDeAnillos(anillos: Anillo[]): Bbox {
    const lons = anillos.flat().map(([lon]) => lon), lats = anillos.flat().map(([, lat]) => lat);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const mLon = (maxLon - minLon) * 0.08 || 0.01, mLat = (maxLat - minLat) * 0.08 || 0.01;
    return { minLon: minLon - mLon, maxLon: maxLon + mLon, minLat: minLat - mLat, maxLat: maxLat + mLat, cosLat: Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) };
}

function areaAprox(a: Anillo): number {
    let s = 0;
    for (let i = 0; i < a.length - 1; i++) s += a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1];
    return Math.abs(s) / 2;
}

/**
 * Separa rótulos rectangulares (centro x,y; ancho w; alto h) que se pisan: el centro de la caja envolvente de
 * módulos vecinos y alargados cae muy cerca (M3/M4, M2/M12). Empuja cada par solapado por el eje de menor
 * solape (a ambos lados por igual) hasta que no haya solapes o se agoten las pasadas, y mantiene cada
 * rótulo dentro del lienzo. Determinista y sin dependencias.
 */
export function separarRotulos(cajas: { x: number; y: number; w: number; h: number }[], ancho: number, alto: number, holgura = 3): { x: number; y: number }[] {
    const p = cajas.map((c) => ({ x: c.x, y: c.y }));
    for (let pasada = 0; pasada < 60; pasada++) {
        let hubo = false;
        for (let i = 0; i < cajas.length; i++) {
            for (let j = i + 1; j < cajas.length; j++) {
                const dx = p[j].x - p[i].x, dy = p[j].y - p[i].y;
                const solX = (cajas[i].w + cajas[j].w) / 2 + holgura - Math.abs(dx);
                const solY = (cajas[i].h + cajas[j].h) / 2 + holgura - Math.abs(dy);
                if (solX <= 0 || solY <= 0) continue;
                hubo = true;
                if (solY <= solX) {
                    const m = solY / 2 + 0.5, s = dy >= 0 ? 1 : -1;
                    p[i].y -= s * m; p[j].y += s * m;
                } else {
                    const m = solX / 2 + 0.5, s = dx >= 0 ? 1 : -1;
                    p[i].x -= s * m; p[j].x += s * m;
                }
            }
        }
        for (let i = 0; i < p.length; i++) {
            p[i].x = Math.min(ancho - cajas[i].w / 2, Math.max(cajas[i].w / 2, p[i].x));
            p[i].y = Math.min(alto - cajas[i].h / 2 - 22, Math.max(cajas[i].h / 2 + 4, p[i].y));
        }
        if (!hubo) break;
    }
    return p;
}

const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
function dentroDe(px: number, py: number, a: [number, number][]): boolean {
    let d = false;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        if ((a[i][1] > py) !== (a[j][1] > py) && px < ((a[j][0] - a[i][0]) * (py - a[i][1])) / (a[j][1] - a[i][1]) + a[i][0]) d = !d;
    }
    return d;
}
/** Punto del interior más alejado del borde (polo de inaccesibilidad, por rejilla con refinamiento): donde cabe mejor un rótulo. */
export function puntoInterior(a: [number, number][]): [number, number, number] {
    const xs = a.map((p) => p[0]), ys = a.map((p) => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let mejor: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2], dMejor = -1;
    for (let ronda = 0; ronda < 3; ronda++) {
        const N = 18, sx = (x1 - x0) / N, sy = (y1 - y0) / N;
        for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
            const x = x0 + i * sx, y = y0 + j * sy;
            if (!dentroDe(x, y, a)) continue;
            let d = Infinity;
            for (let k = 0; k < a.length - 1; k++) d = Math.min(d, distSeg(x, y, a[k][0], a[k][1], a[k + 1][0], a[k + 1][1]));
            if (d > dMejor) { dMejor = d; mejor = [x, y]; }
        }
        x0 = mejor[0] - sx * 1.5; x1 = mejor[0] + sx * 1.5; y0 = mejor[1] - sy * 1.5; y1 = mejor[1] + sy * 1.5;
    }
    return [mejor[0], mejor[1], Math.max(0, dMejor)];
}

/** Relleno del módulo: color discreto de su clase de vigor; S/D = hachurado (patrón del propio SVG). */
const rellenoClase = (ndvi: number | null, idHach: string) => colorClaseNdvi(ndvi) ?? `url(#${idHach})`;
const defsHachurado = (id: string) => `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${SD_FONDO}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${SD_TRAZO}" stroke-width="2"/></pattern>`;

/** Altura (u) reservada bajo el mapa para los rótulos de longitud y la escala gráfica. */
const MB = 50, ML = 50, MT = 8, MR = 8;

const grad = (v: number, eje: 'lon' | 'lat') => `${Math.abs(v).toFixed(1)}° ${eje === 'lon' ? (v < 0 ? 'O' : 'E') : (v >= 0 ? 'N' : 'S')}`;

/**
 * Plano cartográfico de los módulos: relieve (si hay contexto), vecinos del DR-005 en gris, canal Conchos, módulos al 86 % de
 * opacidad con el color de su clase de vigor, rótulos (forma + M# + NDVI) sin solape con línea guía, retícula con coordenadas,
 * escala gráfica de 4 segmentos y norte. El lienzo se ajusta a la forma alargada de la SRL: alto = el que pida el mapa (hasta `hMax`).
 * Devuelve '' si no hay contornos (el HTML muestra entonces un aviso, no un hueco silencioso).
 */
export function planoSvg(modulos: ModuloInforme[], contornos: Contornos, w = 470, hMax = 700, contexto?: ContextoPlano | null): string {
    const todos = Object.values(contornos).flat();
    if (!todos.length) return '';
    const caja = contexto?.bbox;
    const bb: Bbox = caja
        ? { minLon: caja[0], minLat: caja[1], maxLon: caja[2], maxLat: caja[3], cosLat: Math.cos(((caja[1] + caja[3]) / 2) * Math.PI / 180) }
        : bboxDeAnillos(todos);
    const spanLon = (bb.maxLon - bb.minLon) * bb.cosLat, spanLat = bb.maxLat - bb.minLat;
    const aw = w - ML - MR, ahMax = hMax - MT - MB;
    const escala = Math.min(aw / spanLon, ahMax / spanLat); // unidades por grado de latitud
    const mw = spanLon * escala, mh = spanLat * escala;
    const ox = ML + (aw - mw) / 2, oy = MT;
    const h = Math.round(oy + mh + MB);
    const px = (lon: number) => ox + (lon - bb.minLon) * bb.cosLat * escala;
    const py = (lat: number) => oy + (bb.maxLat - lat) * escala;
    const proyecta = (a: [number, number][]): [number, number][] => a.map(([lon, lat]) => [px(lon), py(lat)]);
    const trazo = (a: [number, number][]) => trazoRelativo(proyecta(a), true);
    const linea = (a: [number, number][]) => trazoRelativo(proyecta(a), false);

    // Capa base: relieve
    const relieve = contexto?.relieveUri
        ? `<image href="${contexto.relieveUri}" x="${f1(px(contexto.bbox[0]))}" y="${f1(py(contexto.bbox[3]))}" width="${f1(px(contexto.bbox[2]) - px(contexto.bbox[0]))}" height="${f1(py(contexto.bbox[1]) - py(contexto.bbox[3]))}" preserveAspectRatio="none"/>`
        : `<rect x="${f1(ox)}" y="${f1(oy)}" width="${f1(mw)}" height="${f1(mh)}" fill="#f1f0ec"/>`;
    const vecinos = (contexto?.vecinos ?? []).map((a) => `<path d="${trazo(a)}" fill="#8b9097" fill-opacity=".30" stroke="#fff" stroke-width=".8" stroke-opacity=".8"/>`).join('');
    // Retícula tenue sobre el relieve y bajo los módulos
    const lonTicks: number[] = [], latTicks: number[] = [];
    for (let v = Math.ceil(bb.minLon * 10) / 10; v < bb.maxLon; v = Math.round((v + 0.1) * 10) / 10) lonTicks.push(v);
    for (let v = Math.ceil(bb.minLat * 10) / 10; v < bb.maxLat; v = Math.round((v + 0.1) * 10) / 10) latTicks.push(v);
    const reticula = [
        ...lonTicks.map((v) => `<line x1="${f1(px(v))}" y1="${f1(oy)}" x2="${f1(px(v))}" y2="${f1(oy + mh)}"/>`),
        ...latTicks.map((v) => `<line x1="${f1(ox)}" y1="${f1(py(v))}" x2="${f1(ox + mw)}" y2="${f1(py(v))}"/>`),
    ].join('');
    const canal = (contexto?.canal ?? []).map((t) => linea(t as [number, number][])).join('');
    const rio = (contexto?.rio ?? []).map((t) => linea(t as [number, number][])).join('');

    // Módulos
    const porNumero = new Map(modulos.map((m) => [m.numero, m]));
    const piezas = MODULOS_SRL_IDS.filter((n) => contornos[n]?.length).map((n) => {
        const m = porNumero.get(n);
        const d = contornos[n].map(trazo).join('');
        const fill = m ? rellenoClase(m.ndvi, 'plano-hach') : '#d7d6d1';
        return `<path d="${d}" fill="${fill}" fill-opacity="${m ? '.86' : '.7'}" fill-rule="evenodd" stroke="${INK}" stroke-width=".8" stroke-opacity=".7" stroke-linejoin="round"/>`;
    }).join('');

    // Rótulos: marcador + M# + NDVI en una píldora blanca; si el rótulo se desplaza, queda unido a su módulo por una línea guía.
    const conContorno = modulos.filter((m) => contornos[m.numero]?.length);
    const info = conContorno.map((m) => {
        const principal = contornos[m.numero].reduce((a, b) => (areaAprox(b) > areaAprox(a) ? b : a));
        // El polo de inaccesibilidad se busca en unidades del plano (no en grados): su radio dice si el rótulo cabe dentro del módulo.
        const [ix, iy, radio] = puntoInterior(proyecta(principal));
        const valor = m.ndvi != null ? m.ndvi.toFixed(2) : 'S/D';
        const rot = rotuloModuloSvg(m.numero, 0, 0);
        const wVal = valor.length * FS_MIN * 0.6;
        const ancho = rot.w + 4 + wVal + 8;
        // Módulo angosto (el rótulo taparía su color): el rótulo se va al costado libre con línea guía.
        const angosto = radio < 17;
        const ax = ix - ox, ay = iy - oy;
        const tx = angosto ? (ax > mw / 2 ? mw - ancho / 2 - 6 : ancho / 2 + 6) : ax;
        return { m, ax, ay, tx, valor, rot, wVal, w: ancho, h: 20 };
    });
    const pos = separarRotulos(info.map((i) => ({ x: i.tx, y: i.ay, w: i.w, h: i.h })), mw, mh + 22);
    const rotulos = info.map((i, k) => {
        const cx = ox + pos[k].x, cy = oy + pos[k].y;
        const lejos = Math.hypot(pos[k].x - i.ax, pos[k].y - i.ay) > 14;
        const guia = lejos ? `<line x1="${f1(ox + i.ax)}" y1="${f1(oy + i.ay)}" x2="${f1(cx)}" y2="${f1(cy)}" stroke="${INK}" stroke-width="1"/><circle cx="${f1(ox + i.ax)}" cy="${f1(oy + i.ay)}" r="2.6" fill="${INK}" stroke="#fff" stroke-width="1"/>` : '';
        const x0 = cx - i.w / 2;
        const rot = rotuloModuloSvg(i.m.numero, x0 + 5, cy);
        return `${guia}<rect x="${f1(x0)}" y="${f1(cy - i.h / 2)}" width="${f1(i.w)}" height="${i.h}" rx="3" fill="#fff" fill-opacity=".95" stroke="${INK}" stroke-width=".8"/>${rot.svg}<text x="${f1(x0 + 5 + rot.w + 4 + i.wVal / 2)}" y="${f1(cy + FS_MIN * 0.35)}" text-anchor="middle" font-size="${FS_MIN}" font-weight="700" fill="${INK}">${i.valor}</text>`;
    }).join('');

    // Marco, coordenadas, escala de 4 segmentos y norte
    const etLon = lonTicks.filter((v) => px(v) > ox + 22 && px(v) < ox + mw - 22)
        .map((v) => `<line x1="${f1(px(v))}" y1="${f1(oy + mh)}" x2="${f1(px(v))}" y2="${f1(oy + mh + 4)}" stroke="${INK2}"/><text x="${f1(px(v))}" y="${f1(oy + mh + 15)}" text-anchor="middle" font-size="${FS_MIN}" fill="${INK2}">${grad(v, 'lon')}</text>`).join('');
    const etLat = latTicks.filter((v) => py(v) > oy + 8 && py(v) < oy + mh - 8)
        .map((v) => `<line x1="${f1(ox - 4)}" y1="${f1(py(v))}" x2="${f1(ox)}" y2="${f1(py(v))}" stroke="${INK2}"/><text x="${f1(ox - 6)}" y="${f1(py(v) + 3.5)}" text-anchor="end" font-size="${FS_MIN}" fill="${INK2}">${grad(v, 'lat')}</text>`).join('');
    const pxKm = escala / 111.32; // 1° de latitud ≈ 111.32 km
    const km = [50, 25, 20, 10].find((k) => k * pxKm <= aw * 0.45) ?? 10;
    const seg = (km * pxKm) / 4;
    const yEsc = oy + mh + 27;
    const segmentos = [0, 1, 2, 3].map((i) => `<rect x="${f1(ox + i * seg)}" y="${yEsc}" width="${f1(seg)}" height="5" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width=".8"/>`).join('');
    const marcasEsc = [0, 1, 2, 3, 4].map((i) => `<text x="${f1(ox + i * seg)}" y="${yEsc + 17}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="${FS_MIN}" fill="${INK2}">${i === 4 ? `${km} km` : (km / 4) * i}</text>`).join('');
    const norte = `<g transform="translate(${f1(ox + mw - 22)},${f1(oy + 26)})" aria-label="Norte"><circle r="17" fill="#fff" fill-opacity=".85"/><path d="M0,-13 L5.5,3 L0,0 L-5.5,3 Z" fill="${INK}"/><text y="14" font-size="${FS_MIN}" font-weight="700" text-anchor="middle" fill="${INK}">N</text></g>`;

    const resumen = modulos.map((m) => `Módulo ${m.numero}: ${m.ndvi != null ? m.ndvi.toFixed(2) : 'S/D'}`).join('; ');
    const cab = cabeceraSvg('Plano de los módulos SRL por clase de vigor (NDVI)', resumen);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}
<defs>${defsHachurado('plano-hach')}<clipPath id="plano-clip"><rect x="${f1(ox)}" y="${f1(oy)}" width="${f1(mw)}" height="${f1(mh)}"/></clipPath></defs>
<g clip-path="url(#plano-clip)">${relieve}${vecinos}<g stroke="#fff" stroke-opacity=".55" stroke-width=".6">${reticula}</g>
${rio ? `<path d="${rio}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"/><path d="${rio}" fill="none" stroke="${INK2}" stroke-width="1.6" stroke-linejoin="round"/>` : ''}
${piezas}
${canal ? `<path d="${canal}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round"/><path d="${canal}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="7 2.5" stroke-linejoin="round"/>` : ''}
${rotulos}${norte}</g>
<rect x="${f1(ox)}" y="${f1(oy)}" width="${f1(mw)}" height="${f1(mh)}" fill="none" stroke="${INK}" stroke-width="1"/>
${etLon}${etLat}${segmentos}${marcasEsc}
</svg>`;
}

/** Mini-plano de un módulo para su ficha: la SRL en gris tenue y el módulo con el color de su clase de vigor. Sin texto. */
export function miniPlanoModuloSvg(numero: number, modulos: ModuloInforme[], contornosCompletos: Contornos, w = 64): string {
    const contornos = contornosMini(contornosCompletos);
    const todos = Object.values(contornos).flat();
    if (!todos.length || !contornos[numero]?.length) return '';
    const bb = bboxDeAnillos(todos);
    const spanLon = (bb.maxLon - bb.minLon) * bb.cosLat, spanLat = bb.maxLat - bb.minLat;
    const k = w / spanLon, h = Math.round(spanLat * k);
    const px = (lon: number) => (lon - bb.minLon) * bb.cosLat * k, py = (lat: number) => (bb.maxLat - lat) * k;
    const trazo = (a: Anillo) => trazoRelativo(a.map(([lon, lat]) => [px(lon), py(lat)]), true);
    const m = modulos.find((x) => x.numero === numero);
    const otros = MODULOS_SRL_IDS.filter((n) => n !== numero && contornos[n]?.length).map((n) => `<path d="${contornos[n].map(trazo).join('')}" fill="#d7d6d1" stroke="#fff" stroke-width=".6"/>`).join('');
    const propio = `<path d="${contornos[numero].map(trazo).join('')}" fill="${m ? rellenoClase(m.ndvi, `mp-hach-${numero}`) : '#d7d6d1'}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Ubicación del Módulo ${numero} en la SRL"><defs>${defsHachurado(`mp-hach-${numero}`)}</defs>${otros}${propio}</svg>`;
}

/**
 * Tendencia mínima de un módulo con ESCALA PROPIA (de su mínimo a su máximo, con holgura): a escala común 0–0.8 la línea de
 * un módulo estable queda casi plana. Marca el mínimo y el máximo con su valor; el último punto va con el color de su clase.
 */
export function svgSparkline(valores: (number | null)[], w = 300, h = 54, meses?: string[]): string {
    const n = valores.length;
    if (n < 2 || valores.every((v) => v == null)) return '<span class="sd">sin serie</span>';
    const validos = valores.filter((v): v is number => v != null);
    const lo0 = Math.min(...validos), hi0 = Math.max(...validos);
    const holgura = Math.max((hi0 - lo0) * 0.15, 0.02);
    const lo = lo0 - holgura, hi = hi0 + holgura;
    const L = 10, R = 46, T = 16, B = 26;
    const x = (i: number) => L + (i * (w - L - R)) / (n - 1);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
    let d = '', pen = false;
    valores.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
    const iMin = valores.findIndex((v) => v === lo0), iMax = valores.findIndex((v) => v === hi0);
    let iUlt = n - 1; while (iUlt >= 0 && valores[iUlt] == null) iUlt--;
    const ult = valores[iUlt] as number;
    const marca = (i: number, v: number, arriba: boolean, rot: string) => {
        const cerca = x(i) < L + 26; // en el borde izquierdo el rótulo arranca en el punto (no se sale del dibujo)
        return `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="2.6" fill="#fff" stroke="${INK}" stroke-width="1.2"/><text x="${f1(cerca ? x(i) - 3 : x(i))}" y="${f1(y(v) + (arriba ? -6 : 14))}" text-anchor="${cerca ? 'start' : 'middle'}" font-size="${FS_MIN}" fill="${INK}">${rot}${v.toFixed(2)}</text>`;
    };
    const marcas = lo0 === hi0 ? '' : marca(iMin, lo0, false, 'mín ') + marca(iMax, hi0, true, 'máx ');
    const ejeMes = meses && meses.length === n ? `<text x="${L - 3}" y="${h - 1}" font-size="${FS_MIN}" fill="${INK2}">${escSvg(mesLegible(meses[0], true))}</text><text x="${f1(x(n - 1))}" y="${h - 1}" text-anchor="middle" font-size="${FS_MIN}" fill="${INK2}">${escSvg(mesLegible(meses[n - 1], true))}</text>` : '';
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" role="img" aria-label="Tendencia mensual de NDVI (escala propia del módulo): ${valores.map((v) => (v == null ? 'S/D' : v.toFixed(2))).join(', ')}"><path d="${d}" fill="none" stroke="${INK2}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${marcas}<circle cx="${f1(x(iUlt))}" cy="${f1(y(ult))}" r="4.2" fill="${colorClaseNdvi(ult) ?? SD_FONDO}" stroke="${INK}" stroke-width="1.2"/><text x="${f1(x(iUlt) + 8)}" y="${f1(y(ult) + 3.5)}" font-size="${FS_MIN}" font-weight="700" fill="${INK}">${ult.toFixed(2)}</text>${ejeMes}</svg>`;
}

/** Estilo de línea de un módulo en gráficas: dos tintas alternas, trazo propio, marcador propio. Sin color de módulo. */
const tintaModulo = (numero: number) => ([1, 3, 5].includes(numero) ? INK : '#59616b');

/** Serie mensual de NDVI por módulo (marcador + trazo propios por módulo, promedio SRL en negro grueso) con etiqueta directa al final. */
export function svgSerieModulos(meses: string[], modulos: ModuloInforme[], promedio: (number | null)[], w = 700, h = 230): string {
    if (meses.length < 1) return '';
    const L = 40, R = 58, T = 12, B = 30;
    const [lo, hi] = NDVI_RANGO;
    const x = (i: number) => L + (meses.length === 1 ? (w - L - R) / 2 : (i * (w - L - R)) / (meses.length - 1));
    const y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - T - B);
    const grid = NDVI_TICKS.map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 6}" y="${f1(y(t) + 3.5)}" text-anchor="end" font-size="${FS_MIN}" fill="${INK2}">${t.toFixed(1)}</text>`).join('');
    const paso = Math.max(1, Math.ceil(meses.length / 10)); // con muchos meses solo se rotula uno de cada `paso`
    const ejeX = meses.map((m, i) => (i % paso === 0 || i === meses.length - 1 ? `<text x="${f1(x(i))}" y="${h - 9}" text-anchor="middle" font-size="${FS_MIN}" fill="${INK2}">${escSvg(mesLegible(m, true))}</text>` : '')).join('');
    const camino = (vals: (number | null)[]) => {
        let d = '', pen = false;
        vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        return d;
    };
    const lineasMod = modulos.map((m) => {
        const d = camino(m.serieNdvi);
        if (!d) return '';
        const tinta = tintaModulo(m.numero), dash = TRAZO_MODULO[m.numero];
        const pts = m.serieNdvi.map((v, i) => (v == null ? '' : formaSvg(formaDeModulo(m.numero), x(i), y(v), 3.6, `fill="#fff" stroke="${tinta}" stroke-width="1.3"`))).join('');
        return `<path d="${d}" fill="none" stroke="${tinta}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>${pts}`;
    }).join('');
    const dProm = camino(promedio);
    const lineaProm = dProm ? `<path d="${dProm}" fill="none" stroke="#000" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
    const series: { tipo: 'mod' | 'srl'; numero: number; vals: (number | null)[] }[] = [
        ...modulos.map((m) => ({ tipo: 'mod' as const, numero: m.numero, vals: m.serieNdvi })),
        { tipo: 'srl' as const, numero: 0, vals: promedio },
    ];
    // Etiqueta directa al final de la línea, con separación mínima para que no se encimen.
    const fin = series.map((s) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { ...s, yy: y(s.vals[i] as number), xx: x(i) }; })
        .filter((s): s is NonNullable<typeof s> => !!s).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < fin.length; i++) if (fin[i].yy - fin[i - 1].yy < 17) fin[i].yy = fin[i - 1].yy + 17;
    const etiquetas = fin.map((s) => (s.tipo === 'srl' ? rotuloSrlSvg(Math.min(s.xx, w - R) + 7, s.yy).svg : rotuloModuloSvg(s.numero, Math.min(s.xx, w - R) + 7, s.yy).svg)).join('');
    const resumen = series.map((s) => { const v = s.vals.filter((q): q is number => q != null); const et = s.tipo === 'srl' ? 'SRL' : `M${s.numero}`; return v.length ? `${et}: último ${v[v.length - 1].toFixed(2)} (de ${Math.min(...v).toFixed(2)} a ${Math.max(...v).toFixed(2)})` : `${et}: S/D`; }).join('; ');
    const cab = cabeceraSvg('Serie mensual de NDVI por módulo y promedio SRL', resumen);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;display:block" ${cab.attrs}>${cab.tags}${grid}${ejeX}${lineasMod}${lineaProm}${etiquetas}</svg>`;
}
