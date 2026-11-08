import { describe, it, expect } from 'vitest';
import {
  anchoTanque, alturaRelleno, posicionMuerto, serieSemanal, cambioPuntos, bandaEnPct, rangoPropio, ordenarPresas,
  type PuntoSemanal,
} from './cuencaViz';
import type { FilaClimatologia } from './aqwpEstadistica';

const dia = (inicio: string, i: number) => new Date(Date.parse(`${inicio}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

describe('anchoTanque (∝ √NAMO con piso)', () => {
  const MAX = 2846.78;
  it('Boquilla ocupa el máximo; las pequeñas no se vuelven una rendija', () => {
    expect(anchoTanque(MAX, MAX)).toBe(240);
    const rejon = anchoTanque(6.528, MAX);
    expect(rejon).toBeGreaterThanOrEqual(56);
    expect(rejon).toBeLessThan(80);
  });
  it('es monótono: más capacidad = más ancho', () => {
    const w = [6.528, 23.383, 48.276, 245.431, 284.382, 333.318, 2846.78].map((n) => anchoTanque(n, MAX));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThan(w[i - 1]);
  });
  it('la raíz cuadrada comprime: Boquilla (8.5× el NAMO de Madero) NO es 8.5× más ancha', () => {
    const r = anchoTanque(MAX, MAX) / anchoTanque(333.318, MAX);
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeLessThan(3);
  });
  it('sin NAMO: el piso (no se inventa un tamaño)', () => {
    expect(anchoTanque(null, MAX)).toBe(56);
    expect(anchoTanque(0, MAX)).toBe(56);
    expect(anchoTanque(100, 0)).toBe(56);
  });
  it('un NAMO mayor que el máximo no se sale del tanque', () => {
    expect(anchoTanque(9999, MAX)).toBe(240);
  });
});

describe('relleno y volumen muerto', () => {
  it('relleno acotado a 0-100; S/D = 0 de altura (el tanque se dibuja vacío con trama)', () => {
    expect(alturaRelleno(28.8)).toBe(28.8);
    expect(alturaRelleno(140)).toBe(100);
    expect(alturaRelleno(-5)).toBe(0);
    expect(alturaRelleno(null)).toBe(0);
    expect(alturaRelleno(NaN)).toBe(0);
  });
  it('línea del muerto = muerto/NAMO (Boquilla 106.1/2846.8 = 3.7 %)', () => {
    expect(posicionMuerto(106.087, 2846.78)).toBeCloseTo(3.73, 1);
    expect(posicionMuerto(null, 100)).toBeNull();
    expect(posicionMuerto(5, null)).toBeNull();
    expect(posicionMuerto(5, 0)).toBeNull();
  });
});

describe('serieSemanal', () => {
  it('reduce 365 diarios a ~52 semanales conservando el último dato de cada bloque', () => {
    const f = Array.from({ length: 365 }, (_, i) => ({ fecha: dia('2025-11-08', i), valor: i }));
    const s = serieSemanal(f, 12);
    expect(s.length).toBeGreaterThanOrEqual(52);
    expect(s.length).toBeLessThanOrEqual(54);
    expect(s[s.length - 1].pct).toBe(364);
    expect(s[s.length - 1].fecha).toBe(dia('2025-11-08', 364));
  });
  it('un hueco de semanas no inventa datos: no genera bloque', () => {
    const f = [...Array.from({ length: 14 }, (_, i) => ({ fecha: dia('2026-01-01', i), valor: 10 })), { fecha: '2026-03-01', valor: 12 }];
    const s = serieSemanal(f, 12);
    expect(s.every((p) => p.pct != null)).toBe(true);
    expect(s[s.length - 1].pct).toBe(12);
    expect(s.length).toBeLessThan(5);
  });
  it('un null no pisa un dato del mismo bloque, pero un bloque solo-null queda S/D', () => {
    const s = serieSemanal([{ fecha: '2026-11-03', valor: 40 }, { fecha: '2026-11-04', valor: null }, { fecha: '2026-10-10', valor: null }], 12);
    expect(s.find((p) => p.fecha === '2026-11-03')?.pct).toBe(40);
    expect(s.find((p) => p.fecha === '2026-10-10')?.pct).toBeNull();
  });
  it('marca como dudoso el bloque cuyo último dato viene de un tramo sin actualizar', () => {
    const s = serieSemanal([{ fecha: '2026-11-06', valor: 38.2, dudoso: true }], 12);
    expect(s[0].dudoso).toBe(true);
  });
  it('sin datos: vacío', () => expect(serieSemanal([], 12)).toEqual([]));
  it('no incluye datos fuera de los meses pedidos', () => {
    const f = [{ fecha: '2024-01-01', valor: 1 }, { fecha: '2026-11-01', valor: 2 }];
    expect(serieSemanal(f, 3).map((p) => p.pct)).toEqual([2]);
  });
});

describe('cambioPuntos', () => {
  const mk = (vals: (number | null)[]): PuntoSemanal[] => vals.map((pct, i) => ({ fecha: dia('2026-09-01', i * 7), pct, dudoso: false }));
  it('diferencia en puntos porcentuales frente a hace ~30 días', () => {
    const s = mk([30, 31, 32, 33, 34, 36, 38, 40]); // semanal: 8 puntos = 49 días
    expect(cambioPuntos(s, 28)).toBeCloseTo(40 - 34, 1);
  });
  it('sin suficientes datos o sin punto cercano: null', () => {
    expect(cambioPuntos(mk([30]), 30)).toBeNull();
    expect(cambioPuntos(mk([null, null, null]), 30)).toBeNull();
    expect(cambioPuntos(mk([30, 31]), 90)).toBeNull();
  });
});

describe('bandaEnPct', () => {
  const clim: FilaClimatologia[] = [{ ubicacionId: 526, diaAnio: 311, nAnios: 9, minimo: 90.8, p10: 97, p25: 150, mediana: 230.7, p75: 260, p90: 289.5, maximo: 295 }];
  it('convierte la banda de Mm³ a % del NAMO ACTUAL, alineada por día del año', () => {
    const b = bandaEnPct(clim, ['2026-11-07'], 284.382)!;
    expect(b[0].mediana).toBeCloseTo(81.1, 1);
    expect(b[0].p10).toBeCloseTo(34.1, 1);
    expect(b[0].p90).toBeCloseTo(101.8, 1);
  });
  it('un día sin climatología queda en null (no se inventa banda)', () => {
    expect(bandaEnPct(clim, ['2026-03-01'], 284.382)![0].mediana).toBeNull();
  });
  it('sin climatología, sin NAMO o con NAMO 0: null (la UI rotula el rango de 12 meses)', () => {
    expect(bandaEnPct(undefined, ['2026-11-07'], 100)).toBeNull();
    expect(bandaEnPct([], ['2026-11-07'], 100)).toBeNull();
    expect(bandaEnPct(clim, ['2026-11-07'], null)).toBeNull();
    expect(bandaEnPct(clim, ['2026-11-07'], 0)).toBeNull();
  });
});

describe('rangoPropio', () => {
  it('mín y máx de los últimos 12 meses ignorando S/D', () => {
    const s: PuntoSemanal[] = [{ fecha: 'a', pct: 20, dudoso: false }, { fecha: 'b', pct: null, dudoso: false }, { fecha: 'c', pct: 55, dudoso: false }];
    expect(rangoPropio(s)).toEqual({ min: 20, max: 55 });
    expect(rangoPropio([])).toBeNull();
  });
});

describe('ordenarPresas', () => {
  const f = [
    { ubicacionId: 1, pct: 54, namoMm3: 333, atrasoDias: 0 },
    { ubicacionId: 2, pct: 29, namoMm3: 2846, atrasoDias: 1 },
    { ubicacionId: 3, pct: null, namoMm3: 245, atrasoDias: 47 },
    { ubicacionId: 4, pct: 13, namoMm3: 284, atrasoDias: null },
  ];
  it('cuenca: conserva el orden recibido y no muta', () => {
    const copia = [...f];
    expect(ordenarPresas(f, 'cuenca').map((x) => x.ubicacionId)).toEqual([1, 2, 3, 4]);
    expect(f).toEqual(copia);
  });
  it('llenado: la menos llena primero; los S/D al final', () => {
    expect(ordenarPresas(f, 'llenado').map((x) => x.ubicacionId)).toEqual([4, 2, 1, 3]);
  });
  it('volumen (tamaño): mayor NAMO primero', () => {
    expect(ordenarPresas(f, 'volumen').map((x) => x.ubicacionId)).toEqual([2, 1, 4, 3]);
  });
  it('frescura: la más atrasada primero; sin fecha al final', () => {
    expect(ordenarPresas(f, 'frescura').map((x) => x.ubicacionId)).toEqual([3, 2, 1, 4]);
  });
});
