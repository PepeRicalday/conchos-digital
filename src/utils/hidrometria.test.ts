import { describe, it, expect } from 'vitest';
import {
    mm3ACaudalMedio, caudalAMm3, sumaDias, diasTranscurridos, entregadoSemana, construyeFilasSemana, ordenaPorDesviacion,
    resumenSemana, ultimaCapturaEntregas, parseCaudalCampo, solicitudesAEscribir, type EntradaSemana,
} from './hidrometria';

const INI = '2026-10-05'; // lunes
const FIN = '2026-10-11';
const mod = (id: string, extra = {}) => ({ id, short_code: id.toUpperCase(), name: `Módulo ${id}`, ...extra });

describe('conversiones y calendario', () => {
    it('Mm³ ↔ caudal medio son inversas', () => {
        expect(mm3ACaudalMedio(0.604800)).toBeCloseTo(1, 6);
        expect(caudalAMm3(1)).toBeCloseTo(0.6048, 6);
        expect(mm3ACaudalMedio(null)).toBeNull();
        expect(caudalAMm3(null)).toBeNull();
    });
    it('sumaDias cruza mes', () => { expect(sumaDias('2026-10-30', 3)).toBe('2026-11-02'); });
    it('días transcurridos: futura 0, en curso, terminada 7', () => {
        expect(diasTranscurridos(INI, FIN, '2026-10-04')).toBe(0);
        expect(diasTranscurridos(INI, FIN, '2026-10-05')).toBe(1);
        expect(diasTranscurridos(INI, FIN, '2026-10-08')).toBe(4);
        expect(diasTranscurridos(INI, FIN, '2026-10-11')).toBe(7);
        expect(diasTranscurridos(INI, FIN, '2026-11-01')).toBe(7);
    });
});

describe('entregado de la semana', () => {
    const entregas = [
        { modulo_id: 'm2', fecha: '2026-10-05', volumen_m3: 40000 },
        { modulo_id: 'm2', fecha: '2026-10-06', volumen_m3: '60000' },
        { modulo_id: 'm5', fecha: '2026-10-06', volumen_m3: null },
        { modulo_id: 'm2', fecha: '2026-09-30', volumen_m3: 99999 }, // otra semana
    ];
    it('suma los días anteriores a hoy y usa daily_vol para hoy (sin contar hoy dos veces)', () => {
        const r = entregadoSemana(entregas, 'm2', INI, FIN, '2026-10-06', 0.02);
        expect(r.mm3).toBeCloseTo(0.04 + 0.02, 6); // 05-oct de las filas + hoy en vivo; la fila del 06 se ignora
        expect(r.dias).toBe(2);
    });
    it('sin ninguna captura → null (no 0)', () => {
        expect(entregadoSemana(entregas, 'm5', INI, FIN, '2026-10-08', null)).toEqual({ mm3: null, dias: 0 });
        expect(entregadoSemana(entregas, 'm9', INI, FIN, '2026-10-08', 0)).toEqual({ mm3: null, dias: 0 });
    });
});

describe('filas de la semana', () => {
    const base = (over: Partial<EntradaSemana> = {}): EntradaSemana => ({
        modulos: [mod('m1'), mod('m2', { daily_vol: 0 })], solicitudes: [], entregas: [], inicio: INI, fin: FIN, hoy: '2026-10-07', ...over,
    });

    it('sin solicitud → programado null y estado "sin_solicitud" (antes 0.000 / 0.0 % en rojo)', () => {
        const f = construyeFilasSemana(base());
        expect(f[0]).toMatchObject({ programadoMm3: null, cumplimientoPct: null, estado: 'sin_solicitud' });
    });
    it('semana futura: todo null y "futura", nunca 0', () => {
        const f = construyeFilasSemana(base({ hoy: '2026-10-01', solicitudes: [{ modulo_id: 'm1', volumen_solicitado_mm3: 1 }] }));
        expect(f[0]).toMatchObject({ entregadoMm3: null, entregadoM3s: null, estado: 'futura' });
    });
    it('cumplimiento prorrateado a los días transcurridos', () => {
        // programado 0.7 Mm³/semana; al 3.er día debería ir en 0.3 Mm³; entregó 0.3 → 100 %
        const f = construyeFilasSemana(base({
            solicitudes: [{ modulo_id: 'm1', volumen_solicitado_mm3: 0.7 }],
            entregas: [{ modulo_id: 'm1', fecha: '2026-10-05', volumen_m3: 150000 }, { modulo_id: 'm1', fecha: '2026-10-06', volumen_m3: 150000 }],
        }));
        expect(f[0].cumplimientoPct).toBeCloseTo(100, 6);
        expect(f[0].estado).toBe('cumple');
    });
    it('con solicitud pero sin captura → "sin_dato"; bajo y sobre según 90/110', () => {
        const solicitudes = [{ modulo_id: 'm1', volumen_solicitado_mm3: 0.7 }, { modulo_id: 'm2', volumen_solicitado_mm3: 0.7 }];
        const sinCaptura = construyeFilasSemana(base({ solicitudes }));
        expect(sinCaptura.every((x) => x.estado === 'sin_dato')).toBe(true);
        const f = construyeFilasSemana(base({
            solicitudes,
            entregas: [{ modulo_id: 'm1', fecha: '2026-10-05', volumen_m3: 100000 }, { modulo_id: 'm2', fecha: '2026-10-05', volumen_m3: 400000 }],
        }));
        expect(f[0].estado).toBe('bajo'); // 0.1 de 0.3
        expect(f[1].estado).toBe('sobre'); // 0.4 de 0.3
    });
    it('ordena por desviación y deja sin solicitud al final', () => {
        const o = ordenaPorDesviacion([
            { moduloId: 'a', nombre: 'A', estado: 'sin_solicitud', cumplimientoPct: null },
            { moduloId: 'b', nombre: 'B', estado: 'cumple', cumplimientoPct: 100 },
            { moduloId: 'c', nombre: 'C', estado: 'bajo', cumplimientoPct: 40 },
        ] as never);
        expect(o.map((x) => x.nombre)).toEqual(['C', 'B', 'A']);
    });
});

describe('resumen y captura', () => {
    it('resumen solo compara módulos con solicitud Y captura', () => {
        const filas = construyeFilasSemana({
            modulos: [mod('m1'), mod('m2'), mod('m3')],
            solicitudes: [{ modulo_id: 'm1', volumen_solicitado_mm3: 0.7 }, { modulo_id: 'm2', volumen_solicitado_mm3: 0.7 }],
            entregas: [{ modulo_id: 'm1', fecha: '2026-10-05', volumen_m3: 150000 }, { modulo_id: 'm3', fecha: '2026-10-05', volumen_m3: 5000 }],
            inicio: INI, fin: FIN, hoy: '2026-10-06',
        });
        const r = resumenSemana(filas, INI, FIN, '2026-10-06');
        expect(r.modulosConSolicitud).toBe(2);
        expect(r.programadoMm3).toBeCloseTo(1.4, 6);
        expect(r.cumplimientoPct).toBeCloseTo((0.15 / 0.2) * 100, 4); // solo m1 es comparable
    });
    it('resumen sin solicitudes → null', () => {
        const r = resumenSemana(construyeFilasSemana({ modulos: [mod('m1')], solicitudes: [], entregas: [], inicio: INI, fin: FIN, hoy: '2026-10-06' }), INI, FIN, '2026-10-06');
        expect(r).toMatchObject({ programadoMm3: null, cumplimientoPct: null, modulosConSolicitud: 0 });
    });
    it('última captura de entregas', () => {
        expect(ultimaCapturaEntregas([{ modulo_id: 'a', fecha: '2026-10-04', volumen_m3: 5 }, { modulo_id: 'a', fecha: '2026-10-02', volumen_m3: 1 }, { modulo_id: 'a', fecha: '2026-10-05', volumen_m3: 0, gasto_m3s: 0 }])).toBe('2026-10-04');
        expect(ultimaCapturaEntregas([])).toBeNull();
    });
    it('el campo vacío NO escribe 0 Mm³; un 0 explícito sí; coma decimal admitida', () => {
        expect(parseCaudalCampo('')).toBeNull();
        expect(parseCaudalCampo('  ')).toBeNull();
        expect(parseCaudalCampo('abc')).toBeNull();
        expect(parseCaudalCampo('-1')).toBeNull();
        expect(parseCaudalCampo('0')).toBe(0);
        expect(parseCaudalCampo('0,5')).toBe(0.5);
        const w = solicitudesAEscribir({ m1: '1', m2: '', m3: '0' }, INI, FIN);
        expect(w).toHaveLength(2);
        expect(w.find((x) => x.modulo_id === 'm1')!.volumen_solicitado_mm3).toBeCloseTo(0.6048, 6);
        expect(w.find((x) => x.modulo_id === 'm3')!.volumen_solicitado_mm3).toBe(0);
        expect(w.some((x) => x.modulo_id === 'm2')).toBe(false);
    });
});
