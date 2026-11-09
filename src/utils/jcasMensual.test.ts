import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { construirMensual, etiquetaMes, type EstacionMensual, type FilaMensualJcas } from './jcasMensual';
import { diasCubiertos, construirRedJcas, type FilaEstacionJcas, type FilaLecturaJcas } from './jcasModelo';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const SITIOS: [number, string, number, number, string | null][] = [
    [1, 'CHIH_A', 28.64, -106.08, 'chihuahua'], [11, 'CHIH_B', 28.62, -106.1, 'chihuahua'], [2, 'Aldama', 28.84, -105.91, null], [3, 'Satevó', 27.96, -106.11, null],
    [4, 'Camargo', 27.7, -105.17, null], [5, 'Zaragoza', 27.46, -105.81, null], [6, 'Parral', 26.93, -105.69, null], [7, 'Jiménez', 27.12, -104.9, null], [8, 'Balleza', 26.95, -106.35, null],
];
const est = (): EstacionMensual[] => SITIOS.map(([id, nombre, lat, lon, grupo]) => ({ id, nombre, lat, lon, grupo, sinPluviometro: false }));
const fila = (id: number, mes: string, lluvia: number | null, temp: number | null = 20): FilaMensualJcas => ({ estacion_id: id, mes: `${mes}-01`, lluvia_mm: lluvia, temp_c: temp, hum_pct: 50, viento_kmh: 4 });

describe('resumen mes a mes (JCAS mensual)', () => {
    it('etiqueta corta del mes', () => { expect(etiquetaMes('2026-07')).toBe('jul 26'); expect(etiquetaMes('2025-11')).toBe('nov 25'); });
    it('un registro por mes, ordenado, con lluvia areal y medias entre ciudades', () => {
        const filas = SITIOS.flatMap(([id]) => [fila(id, '2026-06', 60), fila(id, '2026-05', 5)]);
        const m = construirMensual(est(), filas, c.poligonos);
        expect(m.map((x) => x.mes)).toEqual(['2026-05', '2026-06']);
        expect(m[1].lluvia.mm).toBeCloseTo(60, 0);
        expect(m[0].lluvia.mm).toBeCloseTo(5, 0);
        expect(m[1].temp).toBe(20); expect(m[1].hum).toBe(50); expect(m[1].viento).toBe(4);
        expect(m[1].etiqueta).toBe('jun 26');
    });
    it('Parral (excluida) no cuenta a la lluvia; sin estaciones suficientes el mes es S/D con motivo, nunca 0', () => {
        const solo = [fila(6, '2026-03', 40), fila(1, '2026-03', 3), fila(2, '2026-03', 4)];
        const m = construirMensual(est(), solo, c.poligonos)[0];
        expect(m.lluvia.mm).toBeNull();
        expect(m.lluvia.motivoSD).toMatch(/solo \d+ estación/);
        expect(m.temp).toBe(20); // la temperatura de Parral sí vale (solo su lluvia está excluida)
        expect(construirMensual(est(), [fila(6, '2026-03', 40), fila(1, '2026-03', 3)], c.poligonos)[0].temp).toBeNull(); // menos de 3 ciudades con temperatura: S/D
    });
    it('las estaciones de una ciudad pesan una vez', () => {
        const filas = [...SITIOS.map(([id]) => fila(id, '2026-04', id === 1 || id === 11 ? 100 : 10, id === 1 || id === 11 ? 30 : 10))];
        const m = construirMensual(est(), filas, c.poligonos)[0];
        // 8 ciudades (Chihuahua una vez): temperatura media = (30 + 7×10) / 8 = 12.5, no el promedio de 9 estaciones
        expect(m.temp).toBe(12.5);
    });
    it('un mes sin lluvia registrada en las filas es S/D, no 0', () => {
        const filas = SITIOS.map(([id]) => fila(id, '2026-02', null));
        expect(construirMensual(est(), filas, c.poligonos)[0].lluvia.mm).toBeNull();
    });
});

describe('días de historia que cubren una ventana larga', () => {
    const e: FilaEstacionJcas[] = SITIOS.map(([id, nombre, latitud, longitud, g]) => ({ id_jcas: id, nombre, latitud, longitud, altitud_m: null, zona: 'cuenca', grupo_ciudad: g, tiene_pluviometro: true, activa: true, ult_fecha: '2026-11-07' }));
    const lec = (n: number): FilaLecturaJcas[] => SITIOS.flatMap(([id]) => Array.from({ length: n }, (_, i) => ({ estacion_id: id, fecha: new Date(Date.parse('2026-11-07T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10), lluvia_mm: 1, temp_c: 15 })));
    it('con 31 días de historia: 31 de 60, 31 de 90 y 31 de 38 (ciclo)', () => {
        const m = construirRedJcas(e, lec(31), '2026-11-08', c.poligonos);
        expect(diasCubiertos(m, 60)).toEqual({ con: 31, de: 60 });
        expect(diasCubiertos(m, 90)).toEqual({ con: 31, de: 90 });
        expect(diasCubiertos(m, 'ciclo')).toEqual({ con: 31, de: 38 });
        expect(diasCubiertos(m, 30)).toBeNull();
    });
});
