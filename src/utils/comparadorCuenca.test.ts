import { describe, expect, it } from 'vitest';
import { aniosConDato, compararAnios, compararVasos, slotDe, tramosContinuos } from './comparadorCuenca';
import type { CierreMensual, CuerpoAgua } from './cuerposAgua';

const cu = (id: string, etiqueta = id): CuerpoAgua => ({ id, etiqueta, nombre: etiqueta } as CuerpoAgua);
const ci = (cuerpoId: string, mes: string, pctNamo: number | null): CierreMensual => ({ cuerpoId, mes, pctNamo } as CierreMensual);
const CUERPOS = [cu('A'), cu('B'), cu('C')];

describe('compararVasos', () => {
  const cierres = [ci('A', '2026-01-01', 50), ci('A', '2026-03-01', 40), ci('B', '2026-02-01', 70), ci('B', '2026-03-01', null)];
  it('línea de tiempo continua: el mes sin cierre es hueco, no 0', () => {
    const m = compararVasos(CUERPOS, cierres, ['A', 'B']);
    expect(m.xs.map((x) => x.etiqueta)).toEqual(['ene 26', 'feb 26', 'mar 26']);
    expect(m.series[0].puntos.map((p) => p.v)).toEqual([50, null, 40]);
    expect(m.series[1].puntos.map((p) => p.v)).toEqual([null, 70, null]);
    expect(m.series[0].conDato).toBe(2);
  });
  it('el color sigue al cuerpo, no a su orden de selección', () => {
    expect(compararVasos(CUERPOS, cierres, ['B', 'A']).series.map((s) => s.slot)).toEqual([1, 0]);
    expect(slotDe(CUERPOS, 'C')).toBe(2);
  });
  it('máximo 4 series', () => {
    const muchos = ['a', 'b', 'c', 'd', 'e'].map((i) => cu(i));
    expect(compararVasos(muchos, [ci('a', '2026-01-01', 10)], muchos.map((c) => c.id)).series).toHaveLength(4);
  });
  it('sin ningún dato: ejes vacíos y series sin puntos', () => {
    const m = compararVasos(CUERPOS, [], ['A']);
    expect(m.xs).toEqual([]);
    expect(m.series[0].conDato).toBe(0);
  });
  it('un cierre sobre el NAMO sube el techo del eje sin recortar el dato', () => {
    expect(compararVasos(CUERPOS, [ci('A', '2026-01-01', 103.2)], ['A']).max).toBe(110);
    expect(compararVasos(CUERPOS, [ci('A', '2026-01-01', 90)], ['A']).max).toBe(100);
  });
});

describe('compararAnios', () => {
  const cierres = [ci('A', '2025-10-01', 30), ci('A', '2026-10-01', 45), ci('A', '2026-11-01', null), ci('B', '2026-10-01', 99)];
  it('mismo mes calendario, un año por línea', () => {
    const m = compararAnios(CUERPOS[0], cierres, [2026, 2025]);
    expect(m.xs).toHaveLength(12);
    expect(m.series.map((s) => s.nombre)).toEqual(['2026', '2025']);
    expect(m.series[0].puntos[9].v).toBe(45);
    expect(m.series[1].puntos[9].v).toBe(30);
    expect(m.series[0].puntos[10].v).toBeNull();
    expect(m.series[0].puntos[0].v).toBeNull();
  });
  it('años con dato del cuerpo, del más reciente al más antiguo', () => {
    expect(aniosConDato(cierres, 'A')).toEqual([2026, 2025]);
    expect(aniosConDato(cierres, 'Z')).toEqual([]);
  });
});

describe('tramosContinuos', () => {
  it('un hueco corta la línea', () => {
    const p = [1, null, 3, 4, null].map((v, x) => ({ x, v, etiqueta: '' }));
    expect(tramosContinuos(p).map((t) => t.map((q) => q.v))).toEqual([[1], [3, 4]]);
  });
});
