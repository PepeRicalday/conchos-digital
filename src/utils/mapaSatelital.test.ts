import { describe, expect, it } from 'vitest';
import { componenteAnclada, contornoDeMascara, douglasPeuckerAnillo, lat2tile, lon2tile, mPorPxMercator, superficieDeMascara } from './mapaSatelital';

const ZOOM = 11;
const boquilla = { lat: 27.5517, lon: -105.4375 };

/** Máscara W×H con rectángulos [x0,y0,x1,y1) encendidos. */
function mascara(W: number, H: number, rects: [number, number, number, number][]) {
    const m = new Uint8Array(W * H);
    for (const [a, b, c, d] of rects) for (let y = b; y < d; y++) for (let x = a; x < c; x++) m[y * W + x] = 1;
    return m;
}

describe('mPorPxMercator', () => {
    it('≈ 67.8 m/px a z11 en La Boquilla', () => {
        expect(mPorPxMercator(boquilla.lat, ZOOM)).toBeCloseTo(67.8, 0);
    });
});

describe('componenteAnclada', () => {
    it('elige la mancha que contiene al ancla, no la más grande ni la primera del barrido', () => {
        const m = mascara(100, 100, [[0, 0, 60, 30], [70, 60, 90, 80]]);
        const c = componenteAnclada(m, 100, 100, 80, 70);
        expect(c.reduce((s, v) => s + v, 0)).toBe(20 * 20);
        expect(c[0]).toBe(0);
    });
    it('une brazos tocándose solo en diagonal (conectividad 8)', () => {
        const m = mascara(20, 20, [[0, 0, 5, 5], [5, 5, 10, 10]]);
        expect(componenteAnclada(m, 20, 20, 1, 1).reduce((s, v) => s + v, 0)).toBe(50);
    });
});

describe('contornoDeMascara', () => {
    it('recorre las dos mitades de una pesa unida por un cuello de 1 px (criterio de Jacob)', () => {
        // lóbulo izq 0-9, cuello y=5 x=10..14, lóbulo der 15-24
        const m = mascara(30, 12, [[0, 0, 10, 11], [10, 5, 15, 6], [15, 0, 25, 11]]);
        const c = contornoDeMascara(m, 30, 12);
        const xs = c.map(([x]) => x);
        expect(Math.min(...xs)).toBe(0);
        expect(Math.max(...xs)).toBe(24);
    });
});

describe('douglasPeuckerAnillo', () => {
    it('reduce un cuadrado muestreado densamente a sus esquinas', () => {
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) pts.push([i, 0]);
        for (let i = 0; i < 10; i++) pts.push([10, i]);
        for (let i = 10; i > 0; i--) pts.push([i, 10]);
        for (let i = 10; i > 0; i--) pts.push([0, i]);
        const s = douglasPeuckerAnillo(pts, 0.5);
        expect(s.length).toBe(4);
    });
});

describe('superficieDeMascara', () => {
    it('área con escala Mercator real (no la del bbox pedido) y contorno de la misma mancha', () => {
        // Mosaico 6×6 teselas que contiene a La Boquilla, como detectaSuperficieVaso.
        const x0 = Math.floor(lon2tile(boquilla.lon, ZOOM)) - 3, y0 = Math.floor(lat2tile(boquilla.lat, ZOOM)) - 3;
        const W = 6 * 256, H = 6 * 256;
        const ax = Math.round((lon2tile(boquilla.lon, ZOOM) - x0) * 256), ay = Math.round((lat2tile(boquilla.lat, ZOOM) - y0) * 256);
        // cuadrado de 200×200 px alrededor del ancla + una mancha grande lejana que NO es el vaso
        const m = mascara(W, H, [[ax - 100, ay - 100, ax + 100, ay + 100], [0, 0, 400, 300]]);
        const r = superficieDeMascara(m, W, H, x0, y0, ZOOM, boquilla);
        const esperado = (200 * 200 * mPorPxMercator(boquilla.lat, ZOOM) ** 2) / 1e6;
        expect(r.areaKm2).toBeGreaterThan(esperado * 0.99);
        expect(r.areaKm2).toBeLessThan(esperado * 1.01);
        // contorno: cerrado, 4 esquinas (+cierre) y centrado en el ancla
        expect(r.contorno.length).toBe(5);
        const lons = r.contorno.map(([lon]) => lon), lats = r.contorno.map(([, lat]) => lat);
        const cLon = (Math.min(...lons) + Math.max(...lons)) / 2, cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        expect(Math.abs(cLon - boquilla.lon)).toBeLessThan(0.001);
        expect(Math.abs(cLat - boquilla.lat)).toBeLessThan(0.001);
    });
});
