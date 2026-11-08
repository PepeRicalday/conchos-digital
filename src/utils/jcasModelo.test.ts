import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { construirRedJcas, type FilaEstacionJcas, type FilaLecturaJcas } from './jcasModelo';

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
