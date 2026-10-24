/**
 * informeNdviSvg — gráficos SVG PUROS del informe de NDVI (plano coroplético, sparkline, serie mensual).
 * Sin librerías ni red. Color de datos = rampa agronómica de ndviRampa.ts (la misma de la pantalla); S/D = gris hachurado.
 */
import { numeroGeojsonDeSRL, MODULOS_SRL_IDS } from './modulosSRL';
import { colorNdvi, NDVI_RANGO, NDVI_TICKS } from './ndviRampa';
import { escSvg } from './informeHistoricoSvg';
import { mesLegible } from './informeBase';
import { cabeceraSvg, etiquetaLinea } from './informeNdviSvgComparativo';
import type { ModuloInforme } from './informeNdviDatos';

export type Anillo = [number, number][];
export type Contornos = Record<number, Anillo[]>;

const INK = '#1f2328', INK2 = '#57606a', GRID = '#e3e1dc';
const FONT = 'font-family="Segoe UI, Helvetica, Arial, sans-serif"';
const f1 = (n: number) => n.toFixed(1);

function submuestrea(anillo: Anillo, maxPuntos: number): Anillo {
    if (anillo.length <= maxPuntos) return anillo;
    const paso = anillo.length / maxPuntos;
    const salida: Anillo = [];
    for (let i = 0; i < maxPuntos; i++) salida.push(anillo[Math.floor(i * paso)]);
    salida.push(anillo[anillo.length - 1]); // cierra el anillo donde el original cierra
    return salida;
}

/** GeoJSON de modulos.geojson → anillos exteriores por Módulo SRL (el geojson no usa la numeración SRL). Submuestrea
 *  para no inflar el HTML con vértices invisibles a la escala del plano. */
export function contornosAAnillos(fc: GeoJSON.FeatureCollection | null, maxPuntosPorAnillo = 220): Contornos {
    const salida: Contornos = {};
    if (!fc) return salida;
    for (const srl of MODULOS_SRL_IDS) {
        const numeroGeojson = numeroGeojsonDeSRL(srl);
        const feature = fc.features.find((f) => Number(f.properties?.numero_modulo) === numeroGeojson);
        if (!feature) continue;
        const g = feature.geometry;
        const anillos: Anillo[] =
            g.type === 'Polygon' ? [g.coordinates[0] as Anillo] :
            g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0] as Anillo) : [];
        if (anillos.length) salida[srl] = anillos.map((a) => submuestrea(a, maxPuntosPorAnillo));
    }
    return salida;
}

interface Bbox { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number }

function bboxComun(anillos: Anillo[]): Bbox {
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

/**
 * Plano general con relleno opaco por clase NDVI, leyenda de escala (barra km), flecha de norte y fuente.
 * Devuelve '' si no hay contornos (el HTML muestra entonces un aviso, no un hueco silencioso).
 */
export function planoSvg(modulos: ModuloInforme[], contornos: Contornos, w = 520, h = 500): string {
    const todos = Object.values(contornos).flat();
    if (!todos.length) return '';
    const bb = bboxComun(todos);
    const spanLon = (bb.maxLon - bb.minLon) * bb.cosLat, spanLat = bb.maxLat - bb.minLat;
    const escala = Math.min(w / spanLon, h / spanLat); // px por grado de latitud
    const offX = (w - spanLon * escala) / 2, offY = (h - spanLat * escala) / 2;
    const px = (lon: number) => offX + (lon - bb.minLon) * bb.cosLat * escala;
    const py = (lat: number) => offY + (bb.maxLat - lat) * escala;
    const trazo = (a: Anillo) => `M${a.map(([lon, lat]) => `${f1(px(lon))},${f1(py(lat))}`).join('L')}Z`;

    const conContorno = modulos.filter((m) => contornos[m.numero]?.length);
    const anclas = conContorno.map((m) => {
        const principal = contornos[m.numero].reduce((a, b) => (areaAprox(b) > areaAprox(a) ? b : a));
        const lons = principal.map(([lon]) => lon), lats = principal.map(([, lat]) => lat);
        return {
            x: px((Math.min(...lons) + Math.max(...lons)) / 2), y: py((Math.min(...lats) + Math.max(...lats)) / 2),
            w: Math.max(40, m.nombre.length * 7.8), h: 36,
        };
    });
    const rotulos = separarRotulos(anclas, w, h);
    const piezas = conContorno.map((m, idx) => {
        const anillos = contornos[m.numero];
        const cx = rotulos[idx].x, cy = rotulos[idx].y;
        const fill = m.ndvi != null ? colorNdvi(m.ndvi) : 'url(#sd-hach)';
        return {
            path: `<path d="${anillos.map(trazo).join(' ')}" fill-rule="evenodd" fill="${fill}" stroke="#ffffff" stroke-width="1.4"/>`,
            // Las etiquetas se dibujan DESPUÉS de todos los polígonos: un vecino dibujado más tarde las tapaba.
            etiqueta: `<text x="${f1(cx)}" y="${f1(cy - 6)}" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}" stroke="#fff" stroke-width="3.5" paint-order="stroke" ${FONT}>${escSvg(m.nombre)}</text>
<text x="${f1(cx)}" y="${f1(cy + 12)}" text-anchor="middle" font-size="14" font-weight="700" fill="${INK}" stroke="#fff" stroke-width="3.5" paint-order="stroke" ${FONT}>${m.ndvi != null ? m.ndvi.toFixed(2) : 'S/D'}</text>`,
        };
    });
    const rellenos = piezas.map((p) => p.path).join('\n');
    const etiquetas = piezas.map((p) => p.etiqueta).join('\n');

    // Escala gráfica: px por km = escala / 111.32 (1° de latitud ≈ 111.32 km).
    const pxKm = escala / 111.32;
    const km = pxKm * 20 <= w * 0.3 ? 20 : 10;
    const barra = km * pxKm;
    const escalaSvg = `<g transform="translate(${f1(14)},${f1(h - 18)})">
  <rect x="0" y="0" width="${f1(barra / 2)}" height="5" fill="${INK}"/><rect x="${f1(barra / 2)}" y="0" width="${f1(barra / 2)}" height="5" fill="#fff" stroke="${INK}" stroke-width="0.8"/>
  <text x="0" y="-4" font-size="12" fill="${INK2}" ${FONT}>0</text><text x="${f1(barra)}" y="-4" font-size="12" text-anchor="end" fill="${INK2}" ${FONT}>${km} km</text></g>`;
    const norteSvg = `<g transform="translate(${f1(w - 22)},26)" aria-label="Norte">
  <path d="M0,-14 L6,6 L0,2 L-6,6 Z" fill="${INK}"/><text x="0" y="20" font-size="12" font-weight="700" text-anchor="middle" fill="${INK}" ${FONT}>N</text></g>`;

    const cab = cabeceraSvg('Plano general de los módulos SRL coloreados por NDVI', modulos.map((m) => `${m.nombre}: ${m.ndvi != null ? m.ndvi.toFixed(2) : 'S/D'}`).join('; '));
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" ${cab.attrs} style="background:#f6f5f2;border:1px solid ${GRID};border-radius:4px">${cab.tags}
<defs><pattern id="sd-hach" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e9e7e2"/><line x1="0" y1="0" x2="0" y2="8" stroke="#a8afb7" stroke-width="2"/></pattern></defs>
${rellenos}
${etiquetas}
${escalaSvg}${norteSvg}
</svg>`;
}

/** Tendencia mínima de un módulo (misma escala 0–0.8 en todos para poder compararlos). */
export function svgSparkline(valores: (number | null)[], w = 96, h = 26): string {
    const n = valores.length;
    if (n < 2 || valores.every((v) => v == null)) return '<span class="sd">sin serie</span>';
    const [lo, hi] = NDVI_RANGO, pad = 4;
    const x = (i: number) => pad + (i * (w - 2 * pad)) / (n - 1);
    const y = (v: number) => h - pad - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 2 * pad);
    let d = '', pen = false;
    valores.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
    const iUlt = (() => { for (let i = n - 1; i >= 0; i--) if (valores[i] != null) return i; return -1; })();
    const ult = iUlt >= 0 ? (valores[iUlt] as number) : null;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tendencia mensual de NDVI: ${valores.map((v) => (v == null ? 'S/D' : v.toFixed(2))).join(', ')}"><path d="${d}" fill="none" stroke="${INK2}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${
        ult != null ? `<circle cx="${f1(x(iUlt))}" cy="${f1(y(ult))}" r="3.2" fill="${colorNdvi(ult)}" stroke="${INK}" stroke-width="1"/>` : ''}</svg>`;
}

/** Serie mensual de NDVI por módulo (línea por módulo + promedio SRL) con etiqueta directa al final de cada línea. */
export function svgSerieModulos(meses: string[], modulos: ModuloInforme[], promedio: (number | null)[], w = 660, h = 270): string {
    if (meses.length < 1) return '';
    const L = 38, R = 66, T = 12, B = 28;
    const [lo, hi] = NDVI_RANGO;
    const x = (i: number) => L + (meses.length === 1 ? (w - L - R) / 2 : (i * (w - L - R)) / (meses.length - 1));
    const y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - T - B);
    const ticks = NDVI_TICKS;
    const grid = ticks.map((t) => `<line x1="${L}" y1="${f1(y(t))}" x2="${w - R}" y2="${f1(y(t))}" stroke="${GRID}"/><text x="${L - 6}" y="${f1(y(t) + 3)}" text-anchor="end" font-size="9" fill="${INK2}" ${FONT}>${t.toFixed(1)}</text>`).join('');
    const paso = Math.max(1, Math.ceil(meses.length / 12)); // con muchos meses solo se rotula uno de cada `paso`
    const ejeX = meses.map((m, i) => (i % paso === 0 || i === meses.length - 1 ? `<text x="${f1(x(i))}" y="${h - 9}" text-anchor="middle" font-size="9" fill="${INK2}" ${FONT}>${escSvg(mesLegible(m, true))}</text>` : '')).join('');
    const trazar = (vals: (number | null)[], color: string, ancho: number, dash = '') => {
        let d = '', pen = false;
        vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))} `; pen = true; });
        const pts = vals.map((v, i) => (v == null ? '' : `<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="${ancho > 2 ? 2.8 : 2.2}" fill="${color}"/>`)).join('');
        return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${ancho}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>${pts}` : '';
    };
    const series = [
        ...modulos.map((m) => ({ etiqueta: `M${m.numero}`, color: m.color, vals: m.serieNdvi, ancho: 1.6, dash: '' })),
        { etiqueta: 'SRL', color: INK, vals: promedio, ancho: 2.8, dash: '6 3' },
    ];
    const lineas = series.map((s) => trazar(s.vals, s.color, s.ancho, s.dash)).join('');
    // Etiqueta directa al final de la línea, con separación mínima para que no se encimen.
    const fin = series.map((s) => { let i = s.vals.length - 1; while (i >= 0 && s.vals[i] == null) i--; return i < 0 ? null : { ...s, yy: y(s.vals[i] as number), xx: x(i) }; })
        .filter((s): s is NonNullable<typeof s> => !!s).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < fin.length; i++) if (fin[i].yy - fin[i - 1].yy < 11) fin[i].yy = fin[i - 1].yy + 11;
    const etiquetas = fin.map((s) => etiquetaLinea(Math.min(s.xx, w - R) + 6, s.yy, s.etiqueta, s.color)).join('');
    const resumen = series.map((s) => { const v = s.vals.filter((x): x is number => x != null); return v.length ? `${s.etiqueta}: último ${v[v.length - 1].toFixed(2)} (de ${Math.min(...v).toFixed(2)} a ${Math.max(...v).toFixed(2)})` : `${s.etiqueta}: S/D`; }).join('; ');
    const cab = cabeceraSvg('Serie mensual de NDVI por módulo y promedio SRL', resumen);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" ${cab.attrs}>${cab.tags}${grid}${ejeX}${lineas}${etiquetas}</svg>`;
}
