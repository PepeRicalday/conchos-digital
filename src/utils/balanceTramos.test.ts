import { describe, it, expect } from 'vitest';
import {
    normalizaEscalas, normalizaTomas, propagaSifones, qTomasEntre, construyeBalance, resumenBalance, perdidaMaterial, ordenaPorSeveridad, estadoTramo,
    type EscalaBalance, type TomaBalance,
} from './balanceTramos';

const esc = (nombre: string, km: number, gasto: number | null): EscalaBalance => ({ escala_id: nombre, nombre, km, nivel: 1, gasto, seccion_nombre: '' });
const toma = (km: number, caudal: number): TomaBalance => ({ punto_id: `t${km}`, nombre: `T${km}`, km, caudal });

describe('normalización de datos', () => {
    it('una escala sin km se descarta (antes caía en K-0 y se mezclaba con la entrada)', () => {
        const r = normalizaEscalas([
            { escala_id: 'a', nombre: 'K-0', km: 0, gasto_calculado_m3s: '20' },
            { escala_id: 'b', nombre: 'Sin km', km: null, gasto_calculado_m3s: 5 },
            { escala_id: 'c', nombre: 'K-23', km: '23', gasto_calculado_m3s: null },
        ]);
        expect(r.sinKm).toBe(1);
        expect(r.escalas.map((e) => e.nombre)).toEqual(['K-0', 'K-23']);
        expect(r.escalas[1].gasto).toBeNull(); // sin gasto ≠ 0
        expect(r.escalas[0].gasto).toBe(20);
    });
    it('tomas: caudal nulo/0 o sin km no son tomas activas', () => {
        const r = normalizaTomas([
            { punto_id: '1', caudal_promedio: 0.5, puntos_entrega: { nombre: 'A', km: 10 } },
            { punto_id: '2', caudal_promedio: null, puntos_entrega: { nombre: 'B', km: 12 } },
            { punto_id: '3', caudal_promedio: 0, puntos_entrega: { nombre: 'C', km: 13 } },
            { punto_id: '4', caudal_promedio: 1, puntos_entrega: { nombre: 'D', km: null } },
        ]);
        expect(r.tomas).toHaveLength(1);
        expect(r.descartadas).toBe(3);
    });
});

describe('tomas por tramo', () => {
    const tomas = [toma(10, 1), toma(23, 2), toma(30, 4)];
    it('intervalo [a, b): la toma en el km de la escala siguiente va al tramo siguiente', () => {
        expect(qTomasEntre(tomas, 0, 23, false)).toBe(1);
        expect(qTomasEntre(tomas, 23, 30, false)).toBe(2);
    });
    it('el último tramo incluye el km final (antes se perdía)', () => {
        expect(qTomasEntre(tomas, 23, 30, true)).toBe(6);
    });
});

describe('balance por tramo', () => {
    it('balance normal: pérdidas = Qe − Qs − Qtomas', () => {
        const [b] = construyeBalance([esc('K-0', 0, 20), esc('K-23', 23, 15)], [toma(10, 3)], []);
        expect(b).toMatchObject({ sinDato: false, anomalo: false, cerrado: false });
        expect(b.q_perdidas).toBeCloseTo(2, 3);
        expect(b.eficiencia).toBeCloseTo(90, 1);
    });
    it('extremo sin gasto → sin dato (no fuga fabricada)', () => {
        const [b] = construyeBalance([esc('K-0', 0, 20), esc('K-23', 23, null)], [], []);
        expect(b.sinDato).toBe(true);
        expect(b.q_perdidas).toBe(0);
        expect(b.estado).toBe('sin_dato');
    });
    it('canal cerrado medido (Qe = 0) no es "sin dato"', () => {
        const [b] = construyeBalance([esc('K-0', 0, 0), esc('K-23', 23, 0)], [], []);
        expect(b.cerrado).toBe(true);
        expect(resumenBalance([b])).toMatchObject({ cerrados: 1, sinDato: 0 });
    });
    it('salida + tomas > entrada → anómalo, no fuga', () => {
        const [b] = construyeBalance([esc('K-0', 0, 10), esc('K-23', 23, 12)], [], []);
        expect(b.anomalo).toBe(true);
        expect(resumenBalance([b]).fugas).toBe(0);
    });
    it('resumen cuenta fugas reales y datos válidos', () => {
        const t = construyeBalance([esc('K-0', 0, 20), esc('K-23', 23, 10), esc('K-44', 44, 9.8), esc('K-64', 64, null)], [], []);
        const r = resumenBalance(t);
        expect(r.tramos).toBe(3);
        expect(r.fugas).toBe(1); // K-0→K-23 al 50 %
        expect(r.conDato).toBe(2);
        expect(r.sinDato).toBe(1);
    });
    it('ordena por severidad con sin dato y cerrados al final', () => {
        const t = construyeBalance([esc('A', 0, 20), esc('B', 10, 19.5), esc('C', 20, 10), esc('D', 30, null), esc('E', 40, 0)], [], []);
        const o = ordenaPorSeveridad(t).map((x) => x.estado);
        expect(o[0]).toBe('critico');
        expect(o[o.length - 1]).toBe('sin_dato');
    });
});

describe('sifón y umbral', () => {
    it('sin gasto en K-0 no se propaga a los sifones', () => {
        const e = [esc('K-0', 0, null), esc('K-23', 23, 1)];
        expect(propagaSifones(e)).toEqual(e);
    });
    it('umbral de pérdida material compartido (0.05 m³/s)', () => {
        expect(perdidaMaterial(0.04)).toBe(false);
        expect(perdidaMaterial(0.05)).toBe(true);
        expect(perdidaMaterial(null)).toBe(false);
    });
});

describe('estado visual del tramo', () => {
    it('cada caso tiene su propio texto (no solo color)', () => {
        const t = construyeBalance([esc('A', 0, 20), esc('B', 10, 19.9), esc('C', 20, 10), esc('D', 30, 11), esc('E', 40, null), esc('F', 50, 0), esc('G', 60, 0)], [], []);
        const e = t.map(estadoTramo);
        expect(e[0]).toMatchObject({ texto: 'Óptimo', tipo: 'ok' });
        expect(e[1]).toMatchObject({ tipo: 'crit' });       // 10/19.9 → 50 %
        expect(e[2]).toMatchObject({ texto: 'Dato anómalo', tipo: 'info' }); // 11 > 10
        expect(e[3]).toMatchObject({ texto: 'S/D', tipo: 'sd' });
        expect(e[4]).toMatchObject({ texto: 'S/D', tipo: 'sd' });
        expect(e[5]).toMatchObject({ texto: 'Cerrado (Q = 0)', tipo: 'sd' });
    });
});
