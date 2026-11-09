import { describe, it, expect } from 'vitest';
import { acumularHorasFrio, extremosVentana, horasFrioDia, temporadaFrio } from './horasFrio';

const dia = (f: (h: number) => number | null) => Array.from({ length: 24 }, (_, h) => f(h));

describe('horasFrioDia', () => {
    it('cuenta horas ≤ 7.2 °C (el umbral cuenta) y horas de helada ≤ 0 °C', () => {
        const r = horasFrioDia(dia((h) => (h < 6 ? -1 : h < 9 ? 7.2 : h < 10 ? 7.3 : 15)));
        expect(r.horas).toBe(9); // 6 horas de −1 y 3 de 7.2; 7.3 no cuenta
        expect(r.helada).toBe(6);
        expect(r.tmin).toBe(-1);
        expect(r.tmax).toBe(15);
    });
    it('un día cálido da 0 horas frío (con dato completo, 0 es un valor real)', () => {
        expect(horasFrioDia(dia(() => 20)).horas).toBe(0);
    });
    it('con menos del 80 % de las 24 horas es S/D, no 0, pero conserva los extremos', () => {
        const r = horasFrioDia(dia((h) => (h < 12 ? 3 : null)));
        expect(r.horas).toBeNull();
        expect(r.helada).toBeNull();
        expect(r.horasConDato).toBe(12);
        expect(r.tmin).toBe(3);
    });
    it('20 de 24 horas es el mínimo aceptado', () => {
        expect(horasFrioDia(dia((h) => (h < 20 ? 5 : null))).horas).toBe(20);
        expect(horasFrioDia(dia((h) => (h < 19 ? 5 : null))).horas).toBeNull();
    });
    it('sin ninguna lectura todo es S/D', () => {
        const r = horasFrioDia(dia(() => null));
        expect(r).toMatchObject({ horas: null, helada: null, tmax: null, tmin: null, horasConDato: 0 });
    });
});

describe('temporadaFrio', () => {
    it('en noviembre-febrero está en curso y termina hoy', () => {
        expect(temporadaFrio('2026-11-09')).toEqual({ inicio: '2026-11-01', fin: '2026-11-09', enCurso: true });
        expect(temporadaFrio('2027-01-15')).toEqual({ inicio: '2026-11-01', fin: '2027-01-15', enCurso: true });
    });
    it('de marzo a octubre reporta la temporada que terminó (28 feb o 29 feb)', () => {
        expect(temporadaFrio('2027-06-01')).toEqual({ inicio: '2026-11-01', fin: '2027-02-28', enCurso: false });
        expect(temporadaFrio('2028-06-01').fin).toBe('2028-02-29');
    });
});

describe('acumularHorasFrio', () => {
    const dias = (n: number, h: number | null) => Array.from({ length: n }, (_, i) => ({ fecha: `2026-11-${String(i + 1).padStart(2, '0')}`, horas: h, helada: h == null ? null : 1 }));
    it('suma las horas de la temporada con cobertura suficiente', () => {
        const r = acumularHorasFrio(dias(9, 4), '2026-11-01', '2026-11-09');
        expect(r).toMatchObject({ horas: 36, helada: 9, diasConDato: 9, diasTotal: 9 });
    });
    it('menos del 80 % de los días con dato → S/D, nunca 0', () => {
        expect(acumularHorasFrio(dias(5, 4), '2026-11-01', '2026-11-09').horas).toBeNull(); // 5 de 9
        expect(acumularHorasFrio(dias(9, null), '2026-11-01', '2026-11-09').horas).toBeNull();
        expect(acumularHorasFrio([], '2026-11-01', '2026-11-09').horas).toBeNull();
    });
    it('7 de 9 días (78 %) no alcanza; 8 de 9 (89 %) sí', () => {
        expect(acumularHorasFrio(dias(7, 2), '2026-11-01', '2026-11-09').horas).toBeNull();
        expect(acumularHorasFrio(dias(8, 2), '2026-11-01', '2026-11-09').horas).toBe(16);
    });
    it('ignora días fuera de la ventana', () => {
        const r = acumularHorasFrio([...dias(9, 1), { fecha: '2026-10-30', horas: 24 }], '2026-11-01', '2026-11-09');
        expect(r.horas).toBe(9);
    });
});

describe('extremosVentana', () => {
    const d = (f: string, tmax: number | null, tmin: number | null) => ({ fecha: f, tmax, tmin });
    it('máxima = la mayor de las máximas y mínima = la menor de las mínimas', () => {
        const dias = [d('2026-11-03', 20, 4), d('2026-11-04', 22, 1), d('2026-11-05', 18, 6), d('2026-11-06', 19, 5), d('2026-11-07', 21, 3)];
        expect(extremosVentana(dias, '2026-11-07', 5)).toEqual({ tmax: 22, tmin: 1 });
    });
    it('con menos del 80 % de los días es S/D', () => {
        expect(extremosVentana([d('2026-11-07', 21, 3)], '2026-11-07', 7)).toEqual({ tmax: null, tmin: null });
    });
});
