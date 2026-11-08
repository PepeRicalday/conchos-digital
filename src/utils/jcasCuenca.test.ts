import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import {
    acumuladoLluvia, colapsarGrupos, deduplicarSitios, marcarSospechosos, lluviaAreal, lluviaArealCuenca, MIN_COBERTURA_PCT, type PuntoLluvia,
} from './jcasCuenca';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const p = (id: string, lat: number, lon: number, mm: number | null, fuente: PuntoLluvia['fuente'] = 'jcas'): PuntoLluvia => ({ id, fuente, nombre: id, lat, lon, mm });
const dias = (valores: (number | null)[], fin = '2026-11-07') => valores.map((v, i) => ({
    fecha: new Date(Date.parse(`${fin}T00:00:00Z`) - (valores.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), lluviaMm: v,
}));

describe('acumuladoLluvia', () => {
    it('suma la ventana y redondea a 0.1', () => {
        expect(acumuladoLluvia(dias([1.2, 0, 3.4, 0.2]), '2026-11-07', 4)).toEqual({ mm: 4.8, diasConDato: 4 });
    });
    it('menos del 80 % de días con dato → S/D (null), no una suma parcial', () => {
        const r = acumuladoLluvia(dias([5, null, null, null, 5]), '2026-11-07', 5);
        expect(r.mm).toBeNull();
        expect(r.diasConDato).toBe(2);
    });
    it('un 0 medido es dato (no S/D); un día ausente cuenta como falta', () => {
        expect(acumuladoLluvia(dias([0, 0, 0, 0, 0]), '2026-11-07', 5).mm).toBe(0);
        expect(acumuladoLluvia(dias([0, 0]), '2026-11-07', 5).mm).toBeNull();
    });
    it('ignora valores negativos o no finitos y días fuera de la ventana', () => {
        const l = [...dias([2, 2, 2, null]), { fecha: '2026-10-01', lluviaMm: 99 }, { fecha: '2026-11-07', lluviaMm: -5 }];
        expect(acumuladoLluvia(l, '2026-11-07', 4).mm).toBeNull(); // el -5 no cuenta como dato → 3/4 = 75 % < 80 %, y el 99 de octubre queda fuera
        expect(acumuladoLluvia([...dias([2, 2, 2, 2]), { fecha: '2026-11-06', lluviaMm: -5 }], '2026-11-07', 4).mm).toBe(8); // el dato válido se conserva
    });
});

describe('colapsarGrupos / deduplicarSitios', () => {
    it('tres estaciones de Chihuahua pesan una vez, con la mediana', () => {
        const g = colapsarGrupos([
            { ...p('a', 28.64, -106.078, 54.4), grupo: 'chihuahua' }, { ...p('b', 28.624, -106.099, 74.2), grupo: 'chihuahua' },
            { ...p('c', 28.683, -106.082, 82.2), grupo: 'chihuahua' }, p('parral', 26.93, -105.69, 10),
        ]);
        expect(g).toHaveLength(2);
        expect(g.find((x) => x.id === 'grupo:chihuahua')!.mm).toBe(74.2);
    });
    it('el grupo con todas S/D queda S/D', () => {
        const g = colapsarGrupos([{ ...p('a', 28.6, -106, null), grupo: 'x' }, { ...p('b', 28.7, -106, null), grupo: 'x' }]);
        expect(g[0].mm).toBeNull();
    });
    it('misma ciudad en dos fuentes: gana la estación propia', () => {
        const d = deduplicarSitios([p('jcas-camargo', 27.696, -105.174, 75), p('wl-camargo', 27.7, -105.17, 80, 'weatherlink')]);
        expect(d).toHaveLength(1);
        expect(d[0].fuente).toBe('weatherlink');
    });
});

describe('marcarSospechosos', () => {
    const vecinas = [p('coronado', 26.74, -105.16, 118), p('balleza', 26.95, -106.35, 62.8), p('jimenez', 27.12, -104.9, 88.6)];
    it('Parral con 0 mm en 30 días rodeada de 60–118 mm se excluye con motivo', () => {
        const r = marcarSospechosos([p('parral', 26.93, -105.69, 0), ...vecinas], 30);
        expect(r[0].sospechosa).toBe(true);
        expect(r[0].motivo).toMatch(/0 mm en 30 días.*3 estaciones vecinas/);
        expect(r.slice(1).every((x) => !x.sospechosa)).toBe(true);
    });
    it('en ventanas cortas un 0 es normal y no se marca', () => {
        expect(marcarSospechosos([p('parral', 26.93, -105.69, 0), ...vecinas], 7)[0].sospechosa).toBeUndefined();
    });
    it('con una sola vecina lluviosa no hay evidencia suficiente', () => {
        expect(marcarSospechosos([p('parral', 26.93, -105.69, 0), vecinas[0]], 30)[0].sospechosa).toBeUndefined();
    });
    it('un 0 sin vecinas cercanas (> 90 km) tampoco se marca', () => {
        expect(marcarSospechosos([p('lejos', 29.5, -107.9, 0), ...vecinas], 30)[0].sospechosa).toBeUndefined();
    });
});

describe('lluviaAreal en la cuenca real', () => {
    // Red repartida de forma razonable: norte, centro, sur, oeste y este.
    const red = [
        p('chih', 28.64, -106.08, 70), p('aldama', 28.84, -105.91, 70), p('satevo', 27.96, -106.11, 55), p('camargo', 27.7, -105.17, 75),
        p('vzaragoza', 27.46, -105.81, 29), p('jimenez', 27.12, -104.9, 89), p('balleza', 26.95, -106.35, 63), p('coronado', 26.74, -105.16, 118),
        p('borja', 27.9, -106.68, 34), p('sjuanito', 27.97, -107.6, 3), p('santaisabel', 28.34, -106.4, 53), p('ojinaga', 29.57, -104.4, 54),
    ];
    it('promedio areal razonable con buena cobertura', () => {
        const r = lluviaArealCuenca(c, red, 30);
        expect(r.mm).not.toBeNull();
        expect(r.mm!).toBeGreaterThan(30);
        expect(r.mm!).toBeLessThan(90);
        expect(r.coberturaPct).toBeGreaterThan(MIN_COBERTURA_PCT);
        expect(r.nEstaciones).toBe(12);
        expect(r.min!).toBeLessThanOrEqual(r.mm!);
        expect(r.max!).toBeGreaterThanOrEqual(r.mm!);
    });
    it('menos de 5 estaciones útiles → S/D con motivo, nunca 0', () => {
        const r = lluviaArealCuenca(c, red.slice(0, 4), 30);
        expect(r.mm).toBeNull();
        expect(r.motivoSD).toMatch(/solo 4/);
    });
    it('cinco estaciones apiñadas en un rincón no cubren la cuenca → S/D', () => {
        const rincon = [26.74, 26.8, 26.85, 26.9, 26.95].map((la, i) => p(`r${i}`, la, -105.2 - i * 0.02, 50));
        const r = lluviaArealCuenca(c, rincon, 30);
        expect(r.mm).toBeNull();
        expect(r.motivoSD).toMatch(/cubren solo/);
    });
    it('los pluviómetros sospechosos y las S/D no entran al promedio', () => {
        const con = [...red, { ...p('parral', 26.93, -105.69, 0), sospechosa: true }, p('sin-dato', 28, -106, null)];
        const r = lluviaArealCuenca(c, con, 30);
        expect(r.nEstaciones).toBe(12);
        expect(r.nExcluidas).toBe(1);
        expect(r.mm).toBe(lluviaArealCuenca(c, red, 30).mm);
    });
    it('un cuadrado simple: promedio de una lluvia uniforme es esa lluvia', () => {
        const cuadro: [number, number][][] = [[[-106, 27], [-105, 27], [-105, 28], [-106, 28], [-106, 27]]];
        const uni = [p('a', 27.2, -105.8, 40), p('b', 27.8, -105.2, 40), p('c', 27.5, -105.5, 40), p('d', 27.3, -105.3, 40), p('e', 27.7, -105.7, 40)];
        expect(lluviaAreal([cuadro], uni, 30).mm).toBe(40);
    });
});
