import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { type DemGrid, type PuntoCampo, elevacionDem } from './camposCuenca';
import { construirPlano } from './planosCuenca';
import type { LluviaAreal } from './jcasCuenca';
import { fmtLluvia } from './fmtLluvia';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const dem = JSON.parse(readFileSync('public/geo/cuenca_dem_grid.json', 'utf8')) as DemGrid;
const RED: [string, number, number, number][] = [
    ['Chihuahua', 28.64, -106.08, 55], ['Aldama', 28.84, -105.91, 70], ['Satevó', 27.96, -106.11, 55], ['Camargo', 27.7, -105.17, 76],
    ['V. Zaragoza', 27.46, -105.81, 29], ['Jiménez', 27.12, -104.9, 89], ['Balleza', 26.95, -106.35, 63], ['Coronado', 26.74, -105.16, 118],
];
const puntos: PuntoCampo[] = RED.map(([nombre, lat, lon, valor]) => ({ id: nombre, nombre, lat, lon, valor, elevM: elevacionDem(dem, lon, lat) }));
const areal = (o: Partial<LluviaAreal> = {}): LluviaAreal => ({ mm: 64.7, motivoSD: null, nEstaciones: 20, nExcluidas: 1, coberturaPct: 88, ventanaDias: 30, min: 3, max: 190, ...o });

describe('construirPlano · una sola cifra de lluvia areal', () => {
    it('con areal, el resumen numérico sale de arealDe y no del campo interpolado', () => {
        const sin = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos, contorno: c, dem });
        const con = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos, contorno: c, dem, areal: areal() });
        expect(con.resumen.media).toBe(64.7);
        expect(con.resumen.n).toBe(20);
        expect(con.resumen.coberturaPct).toBe(88);
        expect(con.resumen.min).toBe(3);
        expect(con.resumen.max).toBe(190);
        expect(con.resumen.nExcluidas).toBe(1);
        expect(sin.resumen.media).not.toBe(64.7); // el campo da otra cifra: ese era el 66 vs 64.7
        expect(con.bandas.length).toBe(sin.bandas.length); // el dibujo no cambia
    });
    it('areal S/D → media null (nunca se cae a la cifra del campo ni a 0)', () => {
        const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos, contorno: c, dem, areal: areal({ mm: null, motivoSD: 'solo 2 estaciones', min: null, max: null }) });
        expect(m.resumen.media).toBeNull();
    });
    it('no aplica a otras variables ni al pronóstico', () => {
        const temp = construirPlano({ variable: 'temperatura', periodo: { tipo: 'obs', dias: 30 }, puntos, contorno: c, dem, areal: areal() });
        const pron = construirPlano({ variable: 'lluvia', periodo: { tipo: 'pron', dias: 7 }, puntos, contorno: c, dem, areal: areal() });
        expect(temp.resumen.media).not.toBe(64.7);
        expect(pron.resumen.media).not.toBe(64.7);
    });
});

describe('fmtLluvia', () => {
    it('1 decimal bajo 10 mm: 0.3 no se lee «0»', () => {
        expect(fmtLluvia(0.3)).toMatch(/^0[.,]3$/);
        expect(fmtLluvia(0)).toMatch(/^0[.,]0$/);
    });
    it('entero desde 10 mm', () => {
        expect(fmtLluvia(64.7)).toBe('65');
        expect(fmtLluvia(10)).toBe('10');
    });
    it('null / undefined / NaN = S/D, nunca 0', () => {
        expect(fmtLluvia(null)).toBe('S/D');
        expect(fmtLluvia(undefined)).toBe('S/D');
        expect(fmtLluvia(NaN)).toBe('S/D');
    });
});
