import { describe, expect, it } from 'vitest';
import { construirRegistroDia, posPct } from './registroDiaClima';
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import type { EstacionSalud } from './saludRed';

const HOY = '2026-11-01';
const est = (id: string, nombre: string, l: Partial<NonNullable<EstacionConLectura['lectura']>> | null, fecha = HOY): EstacionConLectura =>
    ({ id, nombre, rol: 'modulo', enLinea: true, edadHoras: 0.5, lectura: l ? { fecha, temp_c: null, temp_max_c: null, temp_min_c: null, viento_rafaga_ms: null, lluvia_dia_mm: null, eto_mm: null, ...l } : null } as unknown as EstacionConLectura);
const salud = (id: string, estado: EstacionSalud['estado'], sospechosa = false): EstacionSalud =>
    ({ id, nombre: id, rol: null, moduloId: null, ultimaLectura: null, edadMin: 40, coberturaPct: 90, huecoMaxH: 1, lecturas7d: 1, bloques: [], estado, sospechosa, desviacionTempC: null });

describe('registro del día (clima)', () => {
    it('extremos de la red con su estación; ETo media solo de estaciones con dato', () => {
        const r = construirRegistroDia([
            est('a', 'Boquilla', { temp_c: 20, temp_max_c: 30, temp_min_c: 15, viento_rafaga_ms: 5.4, lluvia_dia_mm: 0, eto_mm: 4 }),
            est('b', 'Módulo 5', { temp_c: 22, temp_max_c: 31, temp_min_c: 14.7, viento_rafaga_ms: 2, lluvia_dia_mm: 1.2, eto_mm: 3 }),
        ], [salud('a', 'VIGENTE'), salud('b', 'VIGENTE')], HOY);
        expect(r.conDato).toBe(2);
        expect(r.extremos.tmax).toEqual({ valor: 31, estacion: 'Módulo 5' });
        expect(r.extremos.tmin).toEqual({ valor: 14.7, estacion: 'Módulo 5' });
        expect(r.extremos.rafaga).toEqual({ valor: 5.4, estacion: 'Boquilla' });
        expect(r.extremos.lluvia).toEqual({ valor: 1.2, estacion: 'Módulo 5' });
        expect(r.extremos.etoMedia).toBeCloseTo(3.5);
        expect(r.escala).toEqual({ min: 13, max: 32 });
    });

    it('S/D (null), nunca 0: lectura de otro día, estación sin señal o sin lectura', () => {
        const r = construirRegistroDia([
            est('vieja', 'Ayer', { temp_max_c: 33, lluvia_dia_mm: 5 }, '2026-10-31'),
            est('caida', 'Caída', { temp_max_c: 35 }),
            est('nada', 'Sin lectura', null),
        ], [salud('vieja', 'VIGENTE'), salud('caida', 'SIN_SEÑAL'), salud('nada', 'SIN_SEÑAL')], HOY);
        expect(r.conDato).toBe(0);
        for (const f of r.filas) {
            expect(f.conDato).toBe(false);
            expect([f.tmaxC, f.tminC, f.tempC, f.rafagaMs, f.lluviaMm, f.etoMm]).toEqual([null, null, null, null, null, null]);
        }
        expect(r.extremos.tmax).toBeNull();
        expect(r.extremos.etoMedia).toBeNull();
        expect(r.escala).toBeNull();
    });

    it('una estación sospechosa se muestra pero no gana los extremos de la red', () => {
        const r = construirRegistroDia([
            est('s', 'Sospechosa', { temp_max_c: 45, temp_min_c: 2 }),
            est('ok', 'Buena', { temp_max_c: 30, temp_min_c: 15 }),
        ], [salud('s', 'VIGENTE', true), salud('ok', 'VIGENTE')], HOY);
        expect(r.filas.find((f) => f.id === 's')?.tmaxC).toBe(45);
        expect(r.extremos.tmax?.estacion).toBe('Buena');
        expect(r.extremos.tmin?.estacion).toBe('Buena');
    });

    it('posPct acota a 0–100', () => {
        expect(posPct(13, { min: 13, max: 33 })).toBe(0);
        expect(posPct(23, { min: 13, max: 33 })).toBe(50);
        expect(posPct(99, { min: 13, max: 33 })).toBe(100);
    });
});
