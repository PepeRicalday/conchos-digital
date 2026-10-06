import { describe, it, expect } from 'vitest';
import { fmt, fmtMiles, fmtUnidad, fmtPct, fmtEdadMin, m3sALps, SD } from './formato';
import { clasificaConduccion, relacionEntregaEntrada } from './eficienciaCanal';
import { conduccionTramo } from './conduccion';

const ok = (gasto: number) => ({ gasto, fresca: true });

describe('formato — S/D nunca cero', () => {
    it('null/undefined/NaN/Infinity → S/D; un 0 real se conserva', () => {
        for (const v of [null, undefined, Number.NaN, Infinity]) expect(fmt(v as never)).toBe(SD);
        expect(fmt(0)).toBe('0.0');
        expect(fmt(12.345, 2)).toBe('12.35');
    });
    it('la unidad solo acompaña a un valor real', () => {
        expect(fmtUnidad(null, 'm³/s')).toBe('S/D');
        expect(fmtUnidad(0.85, 'm³/s', 2)).toBe('0.85 m³/s');
        expect(fmtPct(undefined)).toBe('S/D');
        expect(fmtPct(87.34)).toBe('87.3 %');
    });
    it('miles y L/s', () => {
        expect(fmtMiles(11594.3, 1)).toBe('11,594.3');
        expect(fmtMiles(null)).toBe('S/D');
        expect(m3sALps(0.85)).toBeCloseTo(850, 6);
        expect(m3sALps(null)).toBeNull();
    });
    it('edad legible', () => {
        expect(fmtEdadMin(null)).toBe('sin lectura');
        expect(fmtEdadMin(0.2)).toBe('hace instantes');
        expect(fmtEdadMin(45)).toBe('hace 45 min');
        expect(fmtEdadMin(130)).toBe('hace 2 h');
        expect(fmtEdadMin(3000)).toBe('hace 2 d');
    });
});

describe('clasificaConduccion — una sola eficiencia', () => {
    it('sin extremo vigente → S/D (nunca "0 %" ni alarma de fuga)', () => {
        const c = clasificaConduccion(conduccionTramo({ gasto: 20, fresca: false }, ok(17)));
        expect(c).toMatchObject({ nivel: 'sd', estado: 'sd', hayFuga: false });
    });
    it('salida > entrada → inconsistente, no un porcentaje (el caso 538 %)', () => {
        const c = clasificaConduccion(conduccionTramo(ok(0.158), ok(0.85)));
        expect(c).toMatchObject({ nivel: 'inconsistente', estado: 'info', hayFuga: false });
    });
    it('cortes 95/90/80 como getEfficiencyStatus', () => {
        const cl = (qs: number) => clasificaConduccion(conduccionTramo(ok(100), ok(qs)));
        expect(cl(96)).toMatchObject({ nivel: 'optimo', estado: 'ok', hayFuga: false });
        expect(cl(92)).toMatchObject({ nivel: 'atencion', estado: 'warn', hayFuga: false });
        expect(cl(85)).toMatchObject({ nivel: 'alerta', estado: 'crit', hayFuga: true });
        expect(cl(70)).toMatchObject({ nivel: 'critico', estado: 'crit', hayFuga: true });
    });
});

describe('relacionEntregaEntrada', () => {
    it('detecta la inconsistencia física', () => {
        expect(relacionEntregaEntrada(0.85, 0.158)).toMatchObject({ estado: 'inconsistente' });
        expect(relacionEntregaEntrada(0.85, 0.158).exceso).toBeCloseTo(0.692, 3);
    });
    it('coherente dentro de la tolerancia; S/D si falta un dato o la entrada es 0', () => {
        expect(relacionEntregaEntrada(10, 10.1).estado).toBe('coherente');
        expect(relacionEntregaEntrada(null, 10).estado).toBe('sd');
        expect(relacionEntregaEntrada(5, 0).estado).toBe('sd');
    });
});
