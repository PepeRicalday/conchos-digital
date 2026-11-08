import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { arealDe, construirRedJcas, etiquetaVentana, valorObs, type FilaEstacionJcas, type FilaHoyJcas, type FilaLecturaJcas } from './jcasModelo';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const HOY = '2026-11-08'; // fin = 2026-11-07
const est = (id: number, nombre: string, latitud: number, longitud: number, o: Partial<FilaEstacionJcas> = {}): FilaEstacionJcas => ({
    id_jcas: id, nombre, latitud, longitud, altitud_m: null, zona: 'cuenca', grupo_ciudad: null, tiene_pluviometro: true, activa: true, ult_fecha: '2026-11-07', ...o,
});
const dias = (id: number, mmPorDia: number | null, n = 30, fin = '2026-11-07', temp: number | null = 18): FilaLecturaJcas[] =>
    Array.from({ length: n }, (_, i) => ({
        estacion_id: id, lluvia_mm: mmPorDia, temp_c: temp,
        fecha: new Date(Date.parse(`${fin}T00:00:00Z`) - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    }));

const red: FilaEstacionJcas[] = [
    est(2, 'CHIH_JCAS', 28.64, -106.078, { grupo_ciudad: 'chihuahua' }), est(13, 'CHIH_Potb', 28.624, -106.099, { grupo_ciudad: 'chihuahua' }),
    est(18, 'Aldama', 28.835, -105.911), est(3, 'Satevó', 27.956, -106.107), est(5, 'Camargo', 27.696, -105.174),
    est(7, 'Valle de Zaragoza', 27.456, -105.81), est(8, 'Jiménez', 27.116, -104.898), est(9, 'Balleza', 26.953, -106.346),
    est(4, 'Coronado', 26.738, -105.162), est(28, 'San Fco. de Borja', 27.901, -106.684), est(33, 'Santa Isabel', 28.341, -106.399),
    est(6, 'Parral', 26.931, -105.688), est(38, 'San Antonio', 28.603, -105.816, { tiene_pluviometro: false }),
    est(30, 'Ojinaga', 29.566, -104.406, { zona: 'salida' }),
];
const lecturas: FilaLecturaJcas[] = [
    ...dias(2, 2.0), ...dias(13, 2.5), ...dias(18, 2.3), ...dias(3, 1.8), ...dias(5, 2.5), ...dias(7, 1.0), ...dias(8, 3.0), ...dias(9, 2.1),
    ...dias(4, 3.9), ...dias(28, 1.1), ...dias(33, 1.8), ...dias(6, 0), ...dias(38, 0), ...dias(30, 1.8),
];

describe('construirRedJcas', () => {
    const m = construirRedJcas(red, lecturas, HOY, c.poligonos);
    const por = (n: string) => m.puntos.find((p) => p.nombre === n)!;

    it('el corte es ayer y los acumulados de 7 y 30 días salen de días completos', () => {
        expect(m.fin).toBe('2026-11-07');
        expect(por('Camargo').mm7).toBe(17.5);
        expect(por('Camargo').mm30).toBe(75);
    });
    it('sin pluviómetro → lluvia S/D (null), aunque el portal diga 0', () => {
        expect(por('San Antonio').sinPluviometro).toBe(true);
        expect(por('San Antonio').mm30).toBeNull();
        expect(por('San Antonio').mm7).toBeNull();
    });
    it('Parral (0 mm en 30 días con vecinas lluviosas) queda sospechosa y fuera del promedio', () => {
        expect(por('Parral').sospechosa).toBe(true);
        expect(por('Parral').motivo).toMatch(/0 mm en 30 días/);
        expect(m.areal30.nExcluidas).toBe(1);
    });
    it('las dos estaciones de Chihuahua pesan una vez en el promedio', () => {
        // 14 puntos − 1 sin pluviómetro − 1 sospechosa − 1 duplicado de grupo = 11
        expect(m.areal30.nEstaciones).toBe(11);
    });
    it('promedio areal con cobertura y rango razonables', () => {
        expect(m.areal30.mm).not.toBeNull();
        expect(m.areal30.mm!).toBeGreaterThan(30);
        expect(m.areal30.mm!).toBeLessThan(110);
        expect(m.areal7.mm).not.toBeNull();
        expect(m.areal30.coberturaPct).toBeGreaterThan(50);
    });
    it('estación atrasada: su ventana queda S/D y no cuenta como vigente', () => {
        const l2 = [...lecturas.filter((l) => l.estacion_id !== 8), ...dias(8, 3.0, 20, '2026-10-20')];
        const m2 = construirRedJcas(red.map((e) => (e.id_jcas === 8 ? { ...e, ult_fecha: '2026-10-20' } : e)), l2, HOY, c.poligonos);
        const j = m2.puntos.find((p) => p.nombre === 'Jiménez')!;
        expect(j.estado).toBe('atrasada');
        expect(j.atrasoDias).toBe(18);
        expect(j.mm7).toBeNull();
        expect(j.mm30).toBeNull();
        expect(m2.vigentes).toBe(m.vigentes - 1);
    });
    it('estación sin ninguna lectura → "sin-datos"', () => {
        const m3 = construirRedJcas([est(99, 'Nueva', 27.5, -105.5, { ult_fecha: null })], [], HOY, c.poligonos);
        expect(m3.puntos[0].estado).toBe('sin-datos');
        expect(m3.puntos[0].mm30).toBeNull();
        expect(m3.areal30.mm).toBeNull();
        expect(m3.areal30.motivoSD).toMatch(/solo 0/);
    });
    it('sin estaciones: S/D, nunca 0 mm', () => {
        const m4 = construirRedJcas([], [], HOY, c.poligonos);
        expect(m4.areal7.mm).toBeNull();
        expect(m4.areal30.mm).toBeNull();
        expect(m4.total).toBe(0);
    });
});

describe('promedios de temperatura, humedad y viento', () => {
    const conMedias = (n: number) => Array.from({ length: n }, (_, i) => ({
        estacion_id: 5, lluvia_mm: 0, temp_c: 10 + (i % 2), hum_pct: 60, viento_kmh: 5,
        fecha: new Date(Date.parse('2026-11-07T00:00:00Z') - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    }));
    it('promedia la ventana cuando hay ≥ 80 % de los días y devuelve S/D si no', async () => {
        const { mediaVentana } = await import('./jcasModelo');
        expect(mediaVentana(conMedias(30), 'hum_pct', '2026-11-07', 30)).toBe(60);
        expect(mediaVentana(conMedias(30), 'temp_c', '2026-11-07', 7)).toBeCloseTo(10.6, 1);
        expect(mediaVentana(conMedias(5), 'viento_kmh', '2026-11-07', 7)).toBeNull(); // 5 de 7 = 71 %
        expect(mediaVentana([], 'temp_c', '2026-11-07', 7)).toBeNull();
    });
    it('la red expone las medias y la elevación DEM por estación', () => {
        const m = construirRedJcas([est(5, 'Camargo', 27.696, -105.174, { elevacion_dem_m: 1226 })], conMedias(30), HOY, c.poligonos);
        expect(m.puntos[0].elevM).toBe(1226);
        expect(m.puntos[0].medias.hum30).toBe(60);
        expect(m.puntos[0].medias.viento7).toBe(5);
    });
});

describe('ventanas «hoy» (parcial) y «ayer»', () => {
    const hoyFila = (id: number, mm: number | null, temp: number | null = 14, fecha = '2026-11-08'): FilaHoyJcas =>
        ({ estacion_id: id, fecha, lluvia_mm: mm, temp_c: temp, hum_pct: 40, viento_kmh: 9, actualizado_en: '2026-11-08T18:35:00Z' });
    const filasHoy = [2, 13, 18, 3, 5, 7, 8, 9, 4, 28, 33, 6, 38, 30].map((id, i) => hoyFila(id, id === 38 ? 0 : i % 3 === 0 ? 14.6 : 2.4));
    const m = construirRedJcas(red, lecturas, HOY, c.poligonos, filasHoy);
    const por = (n: string) => m.puntos.find((p) => p.nombre === n)!;

    it('«ayer» es el último día completo (7-nov) y «hoy» el parcial (8-nov), sin mezclarse', () => {
        expect(por('Camargo').ayer.mm).toBe(2.5);
        expect(valorObs(por('Camargo'), 'lluvia', 1)).toBe(2.5);
        expect(m.fechaHoy).toBe('2026-11-08');
        expect(m.hoyEn).toBe('2026-11-08T18:35:00Z');
        expect(por('Camargo').mm7).toBe(17.5); // el acumulado de 7 días NO incluye el día parcial
        expect(por('Camargo').mm30).toBe(75);
    });
    it('hoy: sin pluviómetro es S/D; con pluviómetro lleva la cifra parcial', () => {
        expect(por('San Antonio').hoy?.mm).toBeNull();
        expect(valorObs(por('Camargo'), 'lluvia', 'hoy')).not.toBeNull();
        expect(valorObs(por('Camargo'), 'temperatura', 'hoy')).toBe(14);
        expect(valorObs(por('Camargo'), 'viento', 'hoy')).toBe(9);
    });
    it('hoy: una lectura de un día anterior no se arrastra (S/D, nunca 0)', () => {
        const viejo = construirRedJcas(red, lecturas, HOY, c.poligonos, filasHoy.map((f) => ({ ...f, fecha: '2026-11-07' })));
        expect(viejo.fechaHoy).toBeNull();
        expect(viejo.puntos.every((p) => p.hoy === null)).toBe(true);
        expect(valorObs(viejo.puntos[0], 'lluvia', 'hoy')).toBeNull();
        expect(viejo.arealHoy.mm).toBeNull();
    });
    it('sin tabla de hoy (por defecto) la red sigue funcionando con días completos', () => {
        const s = construirRedJcas(red, lecturas, HOY, c.poligonos);
        expect(s.fechaHoy).toBeNull();
        expect(s.areal30.mm).not.toBeNull();
        expect(arealDe(s, 'hoy').mm).toBeNull();
        expect(arealDe(s, 1).mm).not.toBeNull();
    });
    it('las estaciones propias suman a la lluvia observada y solo a ella', () => {
        const prop = (id: string, la: number, lo: number, d: [string, number][]) => d.map(([fecha, lluvia_mm]) => ({ estacion_id: id, nombre: id, latitud: la, longitud: lo, fecha, lluvia_mm, ult_lectura: '2026-11-08T19:45:00Z' }));
        const propias = [...prop('Módulo 1', 27.97, -105.28, [['2026-11-07', 18.8], ['2026-11-08', 10.2]]), ...prop('Fuera', 40, -90, [['2026-11-08', 99]])];
        const c1 = construirRedJcas(red, lecturas, HOY, c.poligonos, filasHoy, propias);
        expect(c1.propias).toHaveLength(1); // la de 40°N queda fuera de la cuenca
        expect(c1.propias[0].mmHoy).toBe(10.2);
        expect(c1.propias[0].mm1).toBe(18.8);
        expect(c1.propias[0].mm7).toBeNull(); // 2 días de 7: menos del 80 % → S/D, nunca 0
        expect(c1.arealHoy.nEstaciones).toBe(m.arealHoy.nEstaciones + 1);
    });
    it('areal de hoy con cobertura suficiente y rótulos de ventana', () => {
        expect(m.arealHoy.mm).not.toBeNull();
        expect(arealDe(m, 'hoy')).toBe(m.arealHoy);
        expect([etiquetaVentana('hoy'), etiquetaVentana(1), etiquetaVentana(7)]).toEqual(['hoy (parcial)', 'ayer', '7 d']);
    });
});
