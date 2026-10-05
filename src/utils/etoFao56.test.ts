import { describe, it, expect } from 'vitest';
import { etoFao56Diario, radiacionExtraterrestre, diaDelAnioDeFecha, elevacionPlausible } from '../../supabase/functions/clima-historico-satelital-sync/eto';

describe('ETₒ FAO-56 Penman-Monteith diaria', () => {
    it('reproduce el ejemplo 18 de FAO-56 (Bruselas, 6-jul) dentro de la tolerancia del método de HR media', () => {
        // FAO-56 Ej. 18: Tmax 21.5, Tmin 12.3, u2 2.078, Rs 22.07 MJ, z 100 m, 50.8° N, día 187 → ETₒ 3.88 mm/d
        // (el ejemplo usa HRmax/HRmin; aquí HR media 73.5 % → ea algo mayor, ETₒ ligeramente menor).
        const eto = etoFao56Diario({ tMax: 21.5, tMin: 12.3, tMedia: 16.9, hrMedia: 73.5, u2: 2.078, rsMj: 22.07, latitudDeg: 50.8, elevacionM: 100, diaAnio: 187 })!;
        expect(eto).toBeGreaterThan(3.6);
        expect(eto).toBeLessThan(4.1);
    });

    it('verano en el DR-005 da una demanda alta y verosímil (6-9 mm/d)', () => {
        const eto = etoFao56Diario({ tMax: 36, tMin: 20, tMedia: 28, hrMedia: 35, u2: 2.5, rsMj: 27, latitudDeg: 28.2, elevacionM: 1200, diaAnio: 200 })!;
        expect(eto).toBeGreaterThan(6);
        expect(eto).toBeLessThan(10);
    });

    it('invierno: demanda baja y nunca negativa', () => {
        const eto = etoFao56Diario({ tMax: 14, tMin: -2, tMedia: 6, hrMedia: 55, u2: 1.5, rsMj: 11, latitudDeg: 28.2, elevacionM: 1200, diaAnio: 5 })!;
        expect(eto).toBeGreaterThanOrEqual(0);
        expect(eto).toBeLessThan(2.5);
    });

    it('falta una entrada → null (S/D), nunca 0', () => {
        expect(etoFao56Diario({ tMax: 30, tMin: 15, tMedia: 22, hrMedia: 40, u2: 2, latitudDeg: 28, elevacionM: 1200, diaAnio: 100 })).toBeNull();
        expect(etoFao56Diario({})).toBeNull();
    });

    it('entradas incoherentes → null', () => {
        expect(etoFao56Diario({ tMax: 10, tMin: 20, tMedia: 15, hrMedia: 40, u2: 2, rsMj: 20, latitudDeg: 28, elevacionM: 1200, diaAnio: 100 })).toBeNull();
        expect(etoFao56Diario({ tMax: 30, tMin: 15, tMedia: 22, hrMedia: 140, u2: 2, rsMj: 20, latitudDeg: 28, elevacionM: 1200, diaAnio: 100 })).toBeNull();
    });

    it('Ra: máxima en verano austral/boreal esperado y positiva', () => {
        expect(radiacionExtraterrestre(28, 172)).toBeGreaterThan(radiacionExtraterrestre(28, 355));
        expect(radiacionExtraterrestre(28, 172)).toBeGreaterThan(38);
    });

    it('día del año y elevación plausible', () => {
        expect(diaDelAnioDeFecha('2026-01-01')).toBe(1);
        expect(diaDelAnioDeFecha('2026-10-05')).toBe(278);
        expect(elevacionPlausible(13000)).toBe(1200); // WeatherLink reporta ~10x: se descarta
        expect(elevacionPlausible(null)).toBe(1200);
        expect(elevacionPlausible(1120)).toBe(1120);
    });
});
