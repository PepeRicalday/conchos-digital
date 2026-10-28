import { describe, expect, it } from 'vitest';
import { aPantalla, barraEscala, colocarEtiquetas, descargarTeselas, hayChoque, teselasDeVista, urlTesela, vistaMapa } from './mapaTeselas';

const ESTACIONES = [
    { lat: 27.446795, lon: -106.219521 }, { lat: 27.912774, lon: -105.967941 }, { lat: 28.558909, lon: -105.422696 }, { lat: 29.570104, lon: -104.403175 },
    { lat: 27.5517, lon: -105.4375 }, { lat: 28.3364, lon: -105.5278 },
];

describe('vistaMapa y proyección', () => {
    it('elige el mayor zoom en que caben las 4 estaciones y las 2 presas, con todos los puntos dentro', () => {
        const v = vistaMapa(ESTACIONES, 720, 700, 90)!;
        expect(v.z).toBe(8);
        for (const p of ESTACIONES) {
            const [x, y] = aPantalla(v, p.lat, p.lon);
            expect(x).toBeGreaterThanOrEqual(90 - 1);
            expect(x).toBeLessThanOrEqual(720 - 90 + 1);
            expect(y).toBeGreaterThanOrEqual(90 - 1);
            expect(y).toBeLessThanOrEqual(700 - 90 + 1);
        }
    });
    it('el norte queda arriba y el este a la derecha (Ojinaga al NE de Boca del Río)', () => {
        const v = vistaMapa(ESTACIONES, 720, 700, 90)!;
        const boca = aPantalla(v, 27.446795, -106.219521), oji = aPantalla(v, 29.570104, -104.403175);
        expect(oji[1]).toBeLessThan(boca[1]);
        expect(oji[0]).toBeGreaterThan(boca[0]);
    });
    it('sin puntos válidos = null', () => {
        expect(vistaMapa([], 720, 700)).toBeNull();
        expect(vistaMapa([{ lat: NaN, lon: 1 }], 720, 700)).toBeNull();
    });
});

describe('teselas', () => {
    it('cubren toda la vista y la URL es la de Esri World_Topo_Map con {z}/{y}/{x}', () => {
        const v = vistaMapa(ESTACIONES, 720, 700, 90)!;
        const t = teselasDeVista(v);
        expect(t.length).toBeGreaterThanOrEqual(6);
        expect(t.length).toBeLessThanOrEqual(16);
        expect(Math.min(...t.map((q) => q.px))).toBeLessThanOrEqual(0);
        expect(Math.max(...t.map((q) => q.px)) + 256).toBeGreaterThanOrEqual(720);
        expect(urlTesela({ z: 8, x: 53, y: 107 })).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/8/107/53');
    });
    it('descargarTeselas nunca lanza: omite las que fallan y devuelve data URI de las buenas', async () => {
        const v = vistaMapa(ESTACIONES, 720, 700, 90)!;
        let n = 0;
        const falso = (async () => {
            n++;
            if (n % 2 === 0) return new Response('x', { status: 500 });
            return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), { status: 200 });
        }) as unknown as typeof fetch;
        const r = await descargarTeselas(v, { fetchFn: falso });
        expect(r.length).toBeGreaterThan(0);
        expect(r.length).toBeLessThan(teselasDeVista(v).length);
        expect(r.every((t) => t.uri.startsWith('data:image/png'))).toBe(true);
        const todasMal = (async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
        expect(await descargarTeselas(v, { fetchFn: todasMal })).toEqual([]);
        const noImagen = (async () => new Response(new Blob(['<html>'], { type: 'text/html' }), { status: 200 })) as unknown as typeof fetch;
        expect(await descargarTeselas(v, { fetchFn: noImagen })).toEqual([]);
    });
});

describe('barra de escala', () => {
    it('da una longitud «redonda» en km que cabe en el máximo de píxeles', () => {
        const e = barraEscala(8, 28.5, 170);
        expect([5, 10, 20, 25, 50, 100, 200]).toContain(e.km);
        expect(e.px).toBeLessThanOrEqual(170);
        expect(e.px).toBeGreaterThan(40);
    });
});

describe('colocarEtiquetas', () => {
    it('las 6 etiquetas reales (incluida la de dos líneas) no se solapan entre sí ni salen del mapa', () => {
        const v = vistaMapa(ESTACIONES, 720, 700, 90)!;
        const nombres = ['Boca del Río', 'Madero–Vírgenes', 'Babisas', 'Ojinaga'];
        // Mismo orden que la plantilla: primero las presas, luego las estaciones.
        const orden = [4, 5, 0, 1, 2, 3];
        const items = orden.map((i) => {
            const p = ESTACIONES[i];
            const [x, y] = aPantalla(v, p.lat, p.lon);
            return { id: String(i), x, y, r: 22, lineas: i < 4 ? [nombres[i]] : i === 4 ? ['P. La Boquilla'] : ['P. Fco. I. Madero', '(Las Vírgenes)'], tam: 28 };
        });
        const e = colocarEtiquetas(items, 720, 700);
        expect(e).toHaveLength(6);
        expect(hayChoque(e)).toBe(false);
        for (const t of e) {
            expect(t.caja.x0).toBeGreaterThanOrEqual(0);
            expect(t.caja.x1).toBeLessThanOrEqual(720);
            expect(t.caja.y0).toBeGreaterThanOrEqual(0);
            expect(t.caja.y1).toBeLessThanOrEqual(700);
        }
    });
});
