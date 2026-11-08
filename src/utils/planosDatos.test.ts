import { describe, it, expect } from 'vitest';
import { puntosObservados, puntosPronostico, type PuntoCuenca } from './planosDatos';
import type { ModeloRedJcas, PuntoRedJcas } from './jcasModelo';
import type { FilaPronostico } from './cuencaPronostico';

const pr = (o: Partial<PuntoRedJcas>): PuntoRedJcas => ({
    id: 5, nombre: 'Camargo', lat: 27.7, lon: -105.17, altitudM: 1250, zona: 'cuenca', grupo: null, sinPluviometro: false, mm7: 10, mm30: 75, diasConDato30: 30,
    ultFecha: '2026-11-07', atrasoDias: 0, estado: 'vigente', sospechosa: false, motivo: null, tempUltima: 15, elevM: 1226, ayer: { mm: null, temp: null, hum: null, viento: null }, hoy: null, hoyEn: null, 
    medias: { temp7: 14, temp30: 16, hum7: 50, hum30: 55, viento7: 6, viento30: 7 }, ...o,
});
const red = (ps: PuntoRedJcas[]) => ({ puntos: ps } as unknown as ModeloRedJcas);

describe('puntosObservados con estaciones propias', () => {
    const m = { puntos: [pr({})], propias: [{ id: 'wl:a', nombre: 'Módulo 3', lat: 28.2, lon: -105.38, mmHoy: 20, mm1: 8, mm7: 30, mm30: 60, ultFecha: '2026-11-08', hoyEn: null }] } as unknown as ModeloRedJcas;
    it('la lluvia incluye las propias; la temperatura no', () => {
        expect(puntosObservados(m, 'lluvia', 'hoy').map((x) => x.nombre)).toContain('Módulo 3');
        expect(puntosObservados(m, 'lluvia', 'hoy').find((x) => x.nombre === 'Módulo 3')!.valor).toBe(20);
        expect(puntosObservados(m, 'temperatura', 30).map((x) => x.nombre)).not.toContain('Módulo 3');
    });
});

describe('puntosObservados', () => {
    it('toma la variable y la ventana pedidas', () => {
        const p = (v: 'lluvia' | 'temperatura' | 'viento' | 'humedad', d: 7 | 30) => puntosObservados(red([pr({})]), v, d)[0].valor;
        expect(p('lluvia', 7)).toBe(10); expect(p('lluvia', 30)).toBe(75);
        expect(p('temperatura', 7)).toBe(14); expect(p('humedad', 30)).toBe(55); expect(p('viento', 7)).toBe(6);
    });
    it('el pluviómetro sospechoso solo se excluye de la lluvia, no de temperatura/humedad/viento', () => {
        const r = red([pr({ sospechosa: true })]);
        expect(puntosObservados(r, 'lluvia', 30)[0].sospechosa).toBe(true);
        expect(puntosObservados(r, 'temperatura', 30)[0].sospechosa).toBe(false);
    });
    it('sin pluviómetro: la lluvia viene S/D (null), pero la temperatura sí vale', () => {
        const r = red([pr({ sinPluviometro: true, mm7: null, mm30: null })]);
        expect(puntosObservados(r, 'lluvia', 30)[0].valor).toBeNull();
        expect(puntosObservados(r, 'temperatura', 30)[0].valor).toBe(16);
    });
    it('conserva elevación DEM y grupo', () => {
        const x = puntosObservados(red([pr({ grupo: 'chihuahua' })]), 'lluvia', 7)[0];
        expect(x.elevM).toBe(1226);
        expect(x.grupo).toBe('chihuahua');
    });
});

describe('puntosPronostico', () => {
    const puntos: PuntoCuenca[] = [{ id: 'jcas:5', nombre: 'Camargo', lat: 27.7, lon: -105.17, elevM: 1226, grupo: null, fuente: 'jcas' }];
    const f = (modelo: string, fecha: string, mm: number | null): FilaPronostico => ({ punto_id: 'jcas:5', modelo, fecha, precip_mm: mm, temp_media_c: 15, hum_media_pct: 60, viento_medio_kmh: 8 });
    const dias = ['2026-11-08', '2026-11-09', '2026-11-10'];
    const filas = dias.flatMap((d, i) => ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'].map((m) => f(m, d, [7, 1, 0][i])));
    it('suma la mediana de los 3 días y promedia las demás variables', () => {
        expect(puntosPronostico(puntos, filas, 'lluvia', 3, '2026-11-08')[0].valor).toBe(8);
        expect(puntosPronostico(puntos, filas, 'temperatura', 3, '2026-11-08')[0].valor).toBe(15);
    });
    it('periodo más largo que los datos: S/D, no una suma parcial', () => {
        expect(puntosPronostico(puntos, filas, 'lluvia', 7, '2026-11-08')[0].valor).toBeNull();
    });
});
