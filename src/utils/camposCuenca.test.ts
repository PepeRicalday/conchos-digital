import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { construirCampo, elevacionDem, regresionAltitud, type DemGrid, type PuntoCampo } from './camposCuenca';
import { regionMayorQue } from './isolineas';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const dem = JSON.parse(readFileSync('public/geo/cuenca_dem_grid.json', 'utf8')) as DemGrid;
const p = (id: string, lat: number, lon: number, valor: number | null, o: Partial<PuntoCampo> = {}): PuntoCampo => ({ id, nombre: id, lat, lon, valor, ...o });

const RED: [string, number, number][] = [
    ['chih', 28.64, -106.08], ['aldama', 28.84, -105.91], ['satevo', 27.96, -106.11], ['camargo', 27.7, -105.17], ['vzaragoza', 27.46, -105.81],
    ['jimenez', 27.12, -104.9], ['balleza', 26.95, -106.35], ['coronado', 26.74, -105.16], ['borja', 27.9, -106.68], ['sjuanito', 27.97, -107.6],
    ['santaisabel', 28.34, -106.4], ['parral', 26.93, -105.69], ['ojinaga', 29.57, -104.4], ['sanantonio', 28.6, -105.82],
];

describe('elevacionDem', () => {
    it('devuelve elevaciones plausibles dentro de la cuenca y null lejos de la malla', () => {
        const e = elevacionDem(dem, -106.08, 28.64)!;
        expect(e).toBeGreaterThan(1200);
        expect(e).toBeLessThan(1700);
        expect(elevacionDem(dem, -120, 20)).toBeNull();
        expect(elevacionDem(null, -106, 28)).toBeNull();
    });
    it('Ojinaga es la parte más baja y San Juanito de las más altas', () => {
        expect(elevacionDem(dem, -104.406, 29.566)!).toBeLessThan(1000);
        expect(elevacionDem(dem, -107.6, 27.973)!).toBeGreaterThan(2000);
    });
});

describe('regresionAltitud', () => {
    it('recupera una recta exacta con R² = 1', () => {
        const r = regresionAltitud([1000, 1500, 2000, 2500].map((e) => ({ elev: e, valor: 5 + 0.01 * e })))!;
        expect(r.b).toBeCloseTo(0.01, 6);
        expect(r.r2).toBeCloseTo(1, 6);
    });
    it('sin varianza o con pocos puntos → null', () => {
        expect(regresionAltitud([{ elev: 1, valor: 1 }, { elev: 2, valor: 1 }, { elev: 3, valor: 1 }])).toBeNull();
        expect(regresionAltitud([{ elev: 1, valor: 1 }])).toBeNull();
    });
});

describe('construirCampo', () => {
    it('campo uniforme: la media y los extremos son ese valor y la cobertura es alta', () => {
        const f = construirCampo(RED.map(([n, la, lo]) => p(n, la, lo, 40)), c);
        expect(f.motivoSD).toBeNull();
        expect(f.media!).toBeCloseTo(40, 6);
        expect(f.min!).toBeCloseTo(40, 6);
        expect(f.max!).toBeCloseTo(40, 6);
        expect(f.coberturaPct).toBeGreaterThan(80);
        expect(f.nEstaciones).toBe(14);
    });
    it('menos de 5 estaciones útiles → S/D con motivo (nunca 0)', () => {
        const f = construirCampo(RED.slice(0, 4).map(([n, la, lo]) => p(n, la, lo, 10)), c);
        expect(f.motivoSD).toMatch(/solo 4/);
        expect(f.media).toBeNull();
    });
    it('cinco estaciones apiñadas no cubren la cuenca → S/D', () => {
        const rincon = [26.74, 26.8, 26.85, 26.9, 26.95].map((la, i) => p(`r${i}`, la, -105.2 - i * 0.02, 50));
        expect(construirCampo(rincon, c).motivoSD).toMatch(/cubren solo/);
    });
    it('sospechosas y S/D no cuentan', () => {
        const pts = [...RED.map(([n, la, lo]) => p(n, la, lo, 30)), p('mala', 27.5, -105.5, 0, { sospechosa: true }), p('sd', 28, -106, null)];
        const f = construirCampo(pts, c);
        expect(f.nEstaciones).toBe(14);
        expect(f.media!).toBeCloseTo(30, 6);
    });
    it('la máscara de cobertura deja sin pintar donde no hay estación a ≤ 90 km (norte con una sola estación lejana)', () => {
        const sur = RED.filter(([, la]) => la < 28).map(([n, la, lo]) => p(n, la, lo, 20));
        const f = construirCampo(sur, c, { minCoberturaPct: 0 });
        const { nx, ny, lat1, paso } = f.malla;
        // celdas dentro de la cuenca al norte de 29.3° de latitud: a más de 150 km de cualquier estación del sur
        let norte = 0, cubiertasNorte = 0;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            if (f.dentro[j * nx + i] && lat1 - j * paso > 29.3) { norte++; cubiertasNorte += f.cubierta[j * nx + i]; }
        }
        expect(norte).toBeGreaterThan(20);
        expect(cubiertasNorte).toBe(0);
        expect(f.coberturaPct).toBeLessThan(100);
    });
    it('piso y techo: la humedad no pasa de 100 ni baja de 0', () => {
        const f = construirCampo(RED.map(([n, la, lo], k) => p(n, la, lo, k % 2 ? 99 : 98)), c, { piso: 0, techo: 100 });
        expect(f.max!).toBeLessThanOrEqual(100);
        expect(f.min!).toBeGreaterThanOrEqual(0);
    });
});

describe('ajuste por altitud', () => {
    const conElev = (fn: (e: number) => number) => RED.map(([n, la, lo]) => {
        const e = elevacionDem(dem, lo, la)!;
        return p(n, la, lo, fn(e), { elevM: e });
    });
    const base12 = [...RED, ['x1', 27.3, -105.4], ['x2', 28.2, -105.6], ['x3', 27.6, -106.4]] as [string, number, number][];
    const puntos = (fn: (e: number) => number) => base12.map(([n, la, lo]) => { const e = elevacionDem(dem, lo, la)!; return p(n, la, lo, fn(e), { elevM: e }); });

    it('temperatura = recta de la altitud (R² = 1): se aplica y el campo sigue al relieve', () => {
        const f = construirCampo(puntos((e) => 30 - 0.0065 * e), c, { dem, ajusteAltitud: 'auto' });
        expect(f.ajuste.aplicado).toBe(true);
        expect(f.ajuste.r2!).toBeGreaterThan(0.99);
        expect(f.ajuste.pendientePor100m!).toBeCloseTo(-0.65, 1);
        const i = Math.round((-107.6 - f.malla.lon0) / f.malla.paso), j = Math.round((f.malla.lat1 - 27.97) / f.malla.paso);
        const esperado = 30 - 0.0065 * elevacionDem(dem, -107.6, 27.97)!;
        expect(Math.abs(f.malla.valores[j * f.malla.nx + i] - esperado)).toBeLessThan(1.5);
    });
    it('valores sin relación con la altitud (R² bajo): no se aplica y se explica', () => {
        const ruido = [3, 90, 12, 71, 5, 60, 33, 8, 77, 21, 45, 66, 2, 54, 39, 17, 81];
        let k = 0;
        const f = construirCampo(puntos(() => ruido[k++ % ruido.length]), c, { dem, ajusteAltitud: 'auto' });
        expect(f.ajuste.aplicado).toBe(false);
        expect(f.ajuste.motivo).toMatch(/R² = /);
    });
    it('menos de 12 estaciones con elevación: no se aplica aunque el ajuste sea perfecto', () => {
        const f = construirCampo(conElev((e) => 30 - 0.0065 * e).slice(0, 10), c, { dem, ajusteAltitud: 'auto' });
        expect(f.ajuste.aplicado).toBe(false);
        expect(f.ajuste.motivo).toMatch(/mínimo 12/);
    });
    it('sin DEM o sin solicitarlo: IDW simple', () => {
        expect(construirCampo(puntos((e) => e), c, { ajusteAltitud: 'auto' }).ajuste.motivo).toMatch(/sin DEM/);
        expect(construirCampo(puntos((e) => e), c, { dem }).ajuste.aplicado).toBe(false);
    });
});

describe('campo → isolíneas', () => {
    it('las isoyetas de un campo con gradiente norte-sur son anillos que cruzan la cuenca', () => {
        const f = construirCampo(RED.map(([n, la, lo]) => p(n, la, lo, (la - 26) * 20)), c);
        const r = regionMayorQue(f.malla, 40);
        expect(r.length).toBeGreaterThanOrEqual(1);
    });
});
