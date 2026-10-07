// INFORME DEL VASO — gráficos SVG (capa pura). Geometría sobre un encuadre común para que el tamaño del vaso sea comparable.
import { esc, SRL_MARRON } from './informeBase';
import type { EscenaVaso } from './informeVasoDatos';

type Anillo = [number, number][];
export interface BboxVaso { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number }

/** Encuadre común (con 10 % de margen) de varios anillos exteriores. */
export function bboxComun(anillos: Anillo[]): BboxVaso {
    const pts = anillos.flat();
    const lons = pts.map(([x]) => x), lats = pts.map(([, y]) => y);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const mLon = (maxLon - minLon) * 0.1 || 0.01, mLat = (maxLat - minLat) * 0.1 || 0.01;
    return { minLon: minLon - mLon, maxLon: maxLon + mLon, minLat: minLat - mLat, maxLat: maxLat + mLat, cosLat: Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) };
}

function proyecta(b: BboxVaso, w: number, h: number) {
    const spanLon = (b.maxLon - b.minLon) * b.cosLat, spanLat = b.maxLat - b.minLat;
    const k = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * k) / 2, offY = (h - spanLat * k) / 2;
    return { k, x: (lon: number) => offX + (lon - b.minLon) * b.cosLat * k, y: (lat: number) => offY + (b.maxLat - lat) * k };
}

/** Polígono (anillo exterior + islas visibles) como `d` de un path; islas menores a ~2.5 px se omiten. */
export function poligonoPath(coords: Anillo[], b: BboxVaso, w: number, h: number): string {
    const p = proyecta(b, w, h);
    return coords.map((anillo, i) => {
        if (i > 0) {
            const xs = anillo.map(([x]) => x);
            const ancho = (Math.max(...xs) - Math.min(...xs)) * b.cosLat * p.k;
            if (ancho * ancho < 6) return '';
        }
        return 'M' + anillo.map(([lon, lat]) => `${p.x(lon).toFixed(1)},${p.y(lat).toFixed(1)}`).join('L') + 'Z';
    }).filter(Boolean).join(' ');
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
const mesCorto = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' });

/** Un mini-mapa por escena sobre el mismo encuadre. */
export function galeriaSvg(escenas: EscenaVaso[]): string {
    if (!escenas.length) return '<p class="sd">Sin escenas en el periodo.</p>';
    const W = 200, H = 130;
    const b = bboxComun(escenas.map((e) => e.contorno_geojson.coordinates[0]));
    return '<div class="galeria">' + escenas.map((e) => `<figure class="mini">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contorno del vaso al ${esc(fechaCorta(e.fecha_escena))}, ${e.area_km2.toFixed(1)} kilómetros cuadrados"><rect width="${W}" height="${H}" fill="#fbfaf8"/>
<path d="${poligonoPath(e.contorno_geojson.coordinates, b, W, H)}" fill="${SRL_MARRON}29" stroke="${SRL_MARRON}" stroke-width="1.4" fill-rule="evenodd"/></svg>
<figcaption><b>${esc(fechaCorta(e.fecha_escena))}</b><span class="num">${e.area_km2.toFixed(1)} km²</span></figcaption></figure>`).join('') + '</div>';
}

/** Primera escena (línea punteada) contra la más reciente (relleno) superpuestas, con leyenda dentro del mismo bloque. */
export function comparativoSvg(a: EscenaVaso, z: EscenaVaso): string {
    const W = 640, H = 320;
    const b = bboxComun([a.contorno_geojson.coordinates[0], z.contorno_geojson.coordinates[0]]);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Comparativo de contornos entre ${esc(fechaCorta(a.fecha_escena))} y ${esc(fechaCorta(z.fecha_escena))}"><rect width="${W}" height="${H}" fill="#fbfaf8"/>
<path d="${poligonoPath(a.contorno_geojson.coordinates, b, W, H)}" fill="none" stroke="#57606a" stroke-width="2" stroke-dasharray="6 4" fill-rule="evenodd"/>
<path d="${poligonoPath(z.contorno_geojson.coordinates, b, W, H)}" fill="${SRL_MARRON}29" stroke="${SRL_MARRON}" stroke-width="2.5" fill-rule="evenodd"/></svg>
<div class="leyenda"><span><i class="l-dash"></i>Primera escena del periodo (${esc(fechaCorta(a.fecha_escena))}) · ${a.area_km2.toFixed(1)} km²</span><span><i class="l-fill"></i>Más reciente (${esc(fechaCorta(z.fecha_escena))}) · ${z.area_km2.toFixed(1)} km²</span></div>`;
}

/** Superficie sobre una imagen satelital real: el viewBox comparte la proporción del bbox para que no se desfase. */
export function contextoSvg(e: EscenaVaso, bbox: [number, number, number, number]): { w: number; h: number; path: string } {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const W = 680, H = Math.round(W / (((maxLon - minLon) * cosLat) / (maxLat - minLat)));
    return { w: W, h: H, path: poligonoPath(e.contorno_geojson.coordinates, { minLon, maxLon, minLat, maxLat, cosLat }, W, H) };
}

/** Área (línea sólida, eje izquierdo) y perímetro (punteada, eje derecho), con valor rotulado en cada punto del área. */
export function tendenciaSvg(escenas: EscenaVaso[]): string {
    if (escenas.length < 2) return '<p class="sd">Se requieren al menos 2 escenas para graficar la tendencia.</p>';
    const W = 680, H = 210, PL = 44, PR = 44, PT = 16, PB = 26, pw = W - PL - PR, ph = H - PT - PB, n = escenas.length;
    const x = (i: number) => PL + (i / (n - 1)) * pw;
    const rango = (v: number[]) => { let lo = Math.min(...v), hi = Math.max(...v); const pad = (hi - lo) * 0.15 || 0.5; lo -= pad; hi += pad; return { lo, hi }; };
    const ar = escenas.map((e) => e.area_km2), pe = escenas.map((e) => e.perimetro_km);
    const ra = rango(ar), rp = rango(pe);
    const ya = (v: number) => PT + ph - ((v - ra.lo) / (ra.hi - ra.lo)) * ph;
    const yp = (v: number) => PT + ph - ((v - rp.lo) / (rp.hi - rp.lo)) * ph;
    let rejilla = '', ejes = '';
    for (let i = 0; i <= 4; i++) {
        const y = PT + (i / 4) * ph;
        rejilla += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${PL + pw}" y2="${y.toFixed(1)}" stroke="#dcd9d2" stroke-width="0.6"/>`;
        ejes += `<text x="${PL - 5}" y="${(y + 3).toFixed(1)}" font-size="9" fill="${SRL_MARRON}" text-anchor="end">${(ra.hi - (i / 4) * (ra.hi - ra.lo)).toFixed(0)}</text>`
            + `<text x="${PL + pw + 5}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#8a6a4a">${(rp.hi - (i / 4) * (rp.hi - rp.lo)).toFixed(0)}</text>`;
    }
    const lin = (v: number[], f: (n: number) => number) => v.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${f(q).toFixed(1)}`).join(' ');
    const puntos = ar.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${ya(v).toFixed(1)}" r="3" fill="${SRL_MARRON}"/><text x="${x(i).toFixed(1)}" y="${(ya(v) - 7).toFixed(1)}" font-size="9" font-weight="700" fill="#1f2328" text-anchor="middle">${v.toFixed(1)}</text>`).join('');
    const eje = escenas.map((e, i) => `<text x="${x(i).toFixed(1)}" y="${H - 7}" font-size="9" fill="#57606a" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(mesCorto(e.fecha_escena))}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia de área y perímetro del vaso"><rect width="${W}" height="${H}" fill="#fbfaf8"/>${rejilla}${ejes}
<path d="${lin(ar, ya)}" fill="none" stroke="${SRL_MARRON}" stroke-width="2"/><path d="${lin(pe, yp)}" fill="none" stroke="#8a6a4a" stroke-width="1.6" stroke-dasharray="5 3"/>${puntos}${eje}</svg>
<div class="leyenda"><span><i class="l-fill"></i>Área (km², eje izquierdo)</span><span><i class="l-dash"></i>Perímetro (km, eje derecho)</span></div>`;
}
