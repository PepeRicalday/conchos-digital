import { describe, expect, it } from 'vitest';
import type { MapaPresa, PuntoDia } from './historicoPresas';
import {
    anioInicioCiclo, bandaCiclos, ciclosHistoricos, coberturaSerie, crucesUmbral, diaDeCiclo, fechaDeCiclo, posicionEnCiclos,
    proyectarCiclo, rellenarHuecos, ritmoActual, serieCiclo, ultimoDiaCiclo,
} from './analiticaPresas';

const punto = (fecha: string, alm: number | null): PuntoDia =>
    ({ fecha, escala: null, alm, pct: null, almRep: null, pctRep: null, fuente: 'HISTORICO', calidad: 'OK' });

/** Mapa con un volumen por día desde `ini` hasta `fin` (fn recibe el índice de día). null = sin dato. */
function mapa(ini: string, fin: string, fn: (i: number) => number | null): MapaPresa {
    const m: MapaPresa = new Map();
    const t0 = Date.parse(ini + 'T00:00:00Z');
    const n = Math.round((Date.parse(fin + 'T00:00:00Z') - t0) / 86400000);
    for (let i = 0; i <= n; i++) {
        const f = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
        const v = fn(i);
        if (v != null) m.set(f, punto(f, v));
    }
    return m;
}

describe('calendario del ciclo (1-oct → 30-sep)', () => {
    it('asigna cada fecha a su ciclo', () => {
        expect(anioInicioCiclo('2026-10-01')).toBe(2026);
        expect(anioInicioCiclo('2026-09-30')).toBe(2025);
        expect(anioInicioCiclo('2027-01-15')).toBe(2026);
        expect(anioInicioCiclo('2027-09-30')).toBe(2026);
    });
    it('día de ciclo e inversa', () => {
        expect(diaDeCiclo('2026-10-01', 2026)).toBe(0);
        expect(diaDeCiclo('2026-10-14', 2026)).toBe(13);
        expect(fechaDeCiclo(2026, 13)).toBe('2026-10-14');
        expect(ultimoDiaCiclo(2026)).toBe(364); // 2027 no bisiesto
        expect(ultimoDiaCiclo(2023)).toBe(365); // incluye 29-feb-2024
    });
});

describe('serieCiclo, cobertura y huecos', () => {
    it('S/D donde no hay dato, nunca 0', () => {
        const m = mapa('2024-10-01', '2024-10-10', i => (i === 3 ? null : 100 + i));
        const s = serieCiclo(m, 2024);
        expect(s[2]).toBe(102);
        expect(s[3]).toBeNull();
        expect(s[20]).toBeNull();
    });
    it('rellena solo huecos cortos y no extrapola', () => {
        const s = [null, 10, null, null, 40, null, null, null, null, null, null, null, null, null, null, null, 100];
        const r = rellenarHuecos(s, 3);
        expect(r[0]).toBeNull();
        expect(r[2]).toBeCloseTo(20); expect(r[3]).toBeCloseTo(30);
        expect(r[5]).toBeNull(); // hueco largo
    });
    it('cobertura del ciclo', () => {
        const m = mapa('2024-10-01', '2025-09-30', i => (i % 2 === 0 ? 100 : null));
        expect(coberturaSerie(serieCiclo(m, 2024), 2024)).toBeCloseTo(0.5, 1);
    });
});

describe('ciclos históricos', () => {
    it('descarta ciclos con poca cobertura y los informa', () => {
        const m: MapaPresa = new Map([
            ...mapa('2021-10-01', '2021-10-11', () => 500), // ciclo 2021-22: 11 días
            ...mapa('2022-10-01', '2023-09-30', () => 600),
        ]);
        const r = ciclosHistoricos(m, 2026);
        expect(r.usados.map(c => c.anioInicio)).toEqual([2022]);
        expect(r.excluidos.map(c => c.anioInicio)).toEqual([2021]);
    });
});

describe('banda, posición y proyección', () => {
    // 4 ciclos pasados con tendencia lineal distinta: vol(d) = base + pend * d
    const ciclos = [
        { a: 2022, base: 800, pend: -1.0 },
        { a: 2023, base: 500, pend: 0.5 },
        { a: 2024, base: 300, pend: -0.2 },
        { a: 2025, base: 700, pend: -0.6 },
    ];
    const m: MapaPresa = new Map();
    for (const c of ciclos) for (const [k, v] of mapa(`${c.a}-10-01`, `${c.a + 1}-09-30`, i => c.base + c.pend * i)) m.set(k, v);
    const { usados } = ciclosHistoricos(m, 2026);

    it('usa los 4 ciclos y arma la envolvente', () => {
        expect(usados).toHaveLength(4);
        const b = bandaCiclos(usados);
        expect(b[0].min).toBe(300);
        expect(b[0].max).toBe(800);
        expect(b[100].n).toBe(4);
    });

    it('posición del volumen de hoy (1 = el más bajo)', () => {
        expect(posicionEnCiclos(250, usados, 13)).toEqual({ posicion: 1, de: 5 });
        expect(posicionEnCiclos(10_000, usados, 13)).toEqual({ posicion: 5, de: 5 });
        expect(posicionEnCiclos(null, usados, 13)).toBeNull();
    });

    it('proyecta con el cambio de cada ciclo, no con su nivel', () => {
        const p = proyectarCiclo(usados, 2026, '2026-10-14', 700, 90, 2846.78)!;
        expect(p.valorHoy).toBe(700);
        expect(p.trayectorias).toHaveLength(4);
        // a +90 d: 700 + 90 * pendiente → min (−1.0) = 610, max (+0.5) = 745
        const f = p.puntos[90];
        expect(f.min).toBeCloseTo(610, 5);
        expect(f.max).toBeCloseTo(745, 5);
        expect(p.puntos[0].min).toBe(700);
        expect(p.puntos[0].max).toBe(700);
    });

    it('limita el horizonte al fin del ciclo y acota a [0, capacidad]', () => {
        const p = proyectarCiclo(usados, 2026, '2026-10-14', 700, 9999, 710)!;
        expect(p.horizonteDias).toBe(364 - 13);
        expect(Math.max(...p.puntos.map(x => x.max ?? 0))).toBeLessThanOrEqual(710);
        expect(Math.min(...p.puntos.map(x => x.min ?? 0))).toBeGreaterThanOrEqual(0);
    });

    it('S/D (null) sin volumen de hoy o con pocas trayectorias', () => {
        expect(proyectarCiclo(usados, 2026, '2026-10-14', null, 90, 2846)).toBeNull();
        expect(proyectarCiclo(usados.slice(0, 2), 2026, '2026-10-14', 700, 90, 2846)).toBeNull();
    });

    it('cruce de umbral por escenario', () => {
        const p = proyectarCiclo(usados, 2026, '2026-10-14', 700, 300, 2846)!;
        const c = crucesUmbral(p, 600);
        const seco = c.find(x => x.escenario === 'seco')!;
        expect(seco.k).toBe(100); // 700 − 1.0·100 = 600
        expect(seco.fecha).toBe(fechaDeCiclo(2026, 13 + 100));
        expect(c.find(x => x.escenario === 'humedo')!.k).toBeNull(); // el húmedo sube
    });
});

describe('ritmo actual', () => {
    it('ritmo del ciclo en curso y mediana histórica del mismo tramo', () => {
        const m: MapaPresa = new Map();
        for (const a of [2022, 2023, 2024]) for (const [k, v] of mapa(`${a}-10-01`, `${a + 1}-09-30`, i => 500 + 1 * i)) m.set(k, v);
        for (const [k, v] of mapa('2026-10-01', '2026-10-14', i => 700 + 2 * i)) m.set(k, v);
        const { usados } = ciclosHistoricos(m, 2026);
        const r = ritmoActual(serieCiclo(m, 2026), 2026, 13, usados)!;
        expect(r.mm3PorDia).toBeCloseTo(2, 5);
        expect(r.historicoMediana).toBeCloseTo(1, 5);
        expect(r.hasta).toBe('2026-10-14');
    });
    it('S/D con una sola lectura', () => {
        const m = mapa('2026-10-14', '2026-10-14', () => 700);
        expect(ritmoActual(serieCiclo(m, 2026), 2026, 13, [])).toBeNull();
    });
});
