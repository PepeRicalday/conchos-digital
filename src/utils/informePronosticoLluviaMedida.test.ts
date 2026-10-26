import { describe, it, expect } from 'vitest';
import { lluviaMedidaPorHora, type LecturaObs } from './informePronosticoDatos';

const H = 3_600_000;
// Chihuahua = UTC-6 todo el año. 2026-10-25 08:00 local = 14:00 UTC.
const T0 = Date.UTC(2026, 9, 25, 14, 0, 0);
const eje = (desde: number, horas: number) => Array.from({ length: horas }, (_, i) => desde + i * H);
const lec = (id: string, hUtc: number, mm: number | null, dia = 25): LecturaObs =>
    ({ estacionId: id, ts: Date.UTC(2026, 9, dia, hUtc, 0, 0), tempC: null, vientoMs: null, lluviaDiaMm: mm });
const suma = (bs: { media: number | null }[]) => bs.reduce((a, b) => a + (b.media ?? 0), 0);

describe('lluviaMedidaPorHora', () => {
    it('reparte el incremento del acumulado entre las horas del intervalo y conserva el total del día', () => {
        // Módulo 1 el 25 oct: 0 → 2 → 10 → 21.8 mm (contador diario).
        const { bandas, totalPorEstacion } = lluviaMedidaPorHora(
            [lec('m1', 14, 0), lec('m1', 18, 2), lec('m1', 22, 10), lec('m1', 2, 21.8, 26)], eje(T0, 19));
        expect(totalPorEstacion.get('m1')).toBeCloseTo(21.8, 5);
        // Las 4 horas entre 22:00Z y 02:00Z llevan 11.8 / 4 mm cada una.
        expect(bandas.find(b => b.ts === Date.UTC(2026, 9, 25, 23))!.media).toBeCloseTo(2.95, 5);
        expect(suma(bandas)).toBeCloseTo(21.8, 5);
    });

    it('antes de la primera lectura del día no hay dato; no se rellena con 0', () => {
        const { bandas } = lluviaMedidaPorHora([lec('m1', 20, 1.5)], eje(T0, 8));
        // Primera lectura del día a las 14:00 locales: reparte 1.5 mm desde las 00:00 locales, pero el hueco es > 6 h → sin dato.
        expect(bandas.every(b => b.media == null)).toBe(true);
    });

    it('reinicio de medianoche: el primer valor del día nuevo se reparte desde las 00:00 locales y el null de arrastre no cuenta', () => {
        const lecturas = [lec('m1', 5, 21.8, 26), lec('m1', 7, null, 26), lec('m1', 8, 0.4, 26)];
        const { totalPorEstacion, bandas } = lluviaMedidaPorHora(lecturas, eje(Date.UTC(2026, 9, 26, 4), 6));
        expect(totalPorEstacion.get('m1')).toBeCloseTo(0.4, 5);
        // 00:00 local = 06:00 UTC: 0.4 mm en 2 h = 0.2 mm/h.
        expect(bandas.find(b => b.ts === Date.UTC(2026, 9, 26, 6))!.media).toBeCloseTo(0.2, 5);
        expect(bandas.find(b => b.ts === Date.UTC(2026, 9, 26, 4))!.media).toBeNull();
    });

    it('un contador que baja dentro del mismo día no inventa lluvia', () => {
        const { totalPorEstacion } = lluviaMedidaPorHora([lec('m1', 14, 5), lec('m1', 16, 3), lec('m1', 18, 3)], eje(T0, 6));
        expect(totalPorEstacion.get('m1') ?? 0).toBe(0);
    });

    it('promedia y toma el máximo entre estaciones por hora', () => {
        const { bandas } = lluviaMedidaPorHora(
            [lec('a', 14, 0), lec('a', 16, 4), lec('b', 14, 0), lec('b', 16, 0)], eje(T0, 3));
        const b = bandas.find(x => x.ts === T0 + H)!;
        expect(b.max).toBeCloseTo(2, 5);
        expect(b.media).toBeCloseTo(1, 5);
        expect(b.min).toBeCloseTo(0, 5);
    });

    it('sin lecturas todo es null', () => {
        const { bandas, totalPorEstacion } = lluviaMedidaPorHora([], eje(T0, 3));
        expect(bandas.every(b => b.media == null)).toBe(true);
        expect(totalPorEstacion.size).toBe(0);
    });
});
