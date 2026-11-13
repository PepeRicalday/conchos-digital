import { describe, it, expect } from 'vitest';
import {
  construirRedUnifrut, valorUnifrut, resumenColindantes, estadoDe, ubicacionUnifrut, COLINDANTE_KM,
  type FilaEstacionUnifrut, type FilaLecturaUnifrut,
} from './unifrutModelo';

const HOY = '2026-11-13'; // fin = 2026-11-12
const est = (id: string, nombre: string, dist: number, ult: string | null): FilaEstacionUnifrut => ({
  id_unifrut: id, nombre, municipio: 'CUAUHTEMOC', tipo: 'CAMB', latitud: 28.4, longitud: -106.8, altitud_m: 2000, zona: 'fuera', dist_limite_km: dist, ult_fecha: ult,
});
const dia = (n: number) => new Date(Date.parse('2026-11-12T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
const lec = (id: string, d: number, o: Partial<FilaLecturaUnifrut> = {}): FilaLecturaUnifrut => ({
  estacion_id: id, fecha: dia(d), lluvia_mm: 0, tmax_c: 20, tmin_c: 5, tmed_c: 12, viento_kmh: 6, viento_max_kmh: 20, eto_mm: 2, ...o,
});
const serie = (id: string, n: number, o: Partial<FilaLecturaUnifrut> = {}) => Array.from({ length: n }, (_, i) => lec(id, i, o));

describe('Unifrut · estado y clasificación', () => {
  it('vigente ≤ 3 días, atrasada 4-30, fuera de servicio > 30, sin datos sin fecha', () => {
    expect(estadoDe('2026-11-11', '2026-11-12').estado).toBe('vigente');
    expect(estadoDe('2026-11-09', '2026-11-12').estado).toBe('vigente');
    expect(estadoDe('2026-11-08', '2026-11-12')).toMatchObject({ estado: 'atrasada', atrasoDias: 4 });
    expect(estadoDe('2026-10-12', '2026-11-12').estado).toBe('fuera-servicio');
    expect(estadoDe(null, '2026-11-12').estado).toBe('sin-datos');
  });
  it('colindante = a ≤ 25 km del límite; todas son «fuera de la cuenca»', () => {
    const m = construirRedUnifrut([est('_a', 'A', 7, null), est('_b', 'B', COLINDANTE_KM, null), est('_c', 'C', 26, null)], [], HOY);
    expect(m.puntos.map((p) => p.colindante)).toEqual([true, true, false]);
    expect(ubicacionUnifrut(m.puntos[0])).toMatch(/colindante · ≈ 7 km/);
    expect(ubicacionUnifrut(m.puntos[2])).toBe('≈ 26 km del límite');
  });
  it('el día en curso o futuro nunca entra', () => {
    const m = construirRedUnifrut([est('_a', 'A', 5, null)], [lec('_a', -1, { lluvia_mm: 99 }), lec('_a', 0)], HOY);
    expect(m.puntos[0].lec.map((l) => l.fecha)).toEqual(['2026-11-12']);
  });
});

describe('Unifrut · valores por ventana', () => {
  const m = construirRedUnifrut([est('_a', 'A', 5, null)], serie('_a', 30, { lluvia_mm: 1 }), HOY);
  const p = m.puntos[0];
  it('lluvia y ETo se suman; Tmed y viento se promedian; Tmax/Tmin son extremos', () => {
    expect(valorUnifrut(p, 'lluvia', 7, m.fin)).toBe(7);
    expect(valorUnifrut(p, 'lluvia', 30, m.fin)).toBe(30);
    expect(valorUnifrut(p, 'eto', 7, m.fin)).toBe(14);
    expect(valorUnifrut(p, 'tmed', 7, m.fin)).toBe(12);
    expect(valorUnifrut(p, 'tmax', 7, m.fin)).toBe(20);
    expect(valorUnifrut(p, 'tmin', 7, m.fin)).toBe(5);
    expect(valorUnifrut(p, 'viento', 7, m.fin)).toBe(6);
  });
  it('ayer = el último día completo', () => {
    expect(valorUnifrut(p, 'lluvia', 1, m.fin)).toBe(1);
  });
  it('hoy es S/D (el portal no da día parcial)', () => {
    expect(valorUnifrut(p, 'lluvia', 'hoy', m.fin)).toBeNull();
  });
  it('menos del 80 % de los días con dato = S/D, nunca 0', () => {
    expect(valorUnifrut(p, 'lluvia', 60, m.fin)).toBeNull(); // solo hay 30 de 60 días
    const poca = construirRedUnifrut([est('_a', 'A', 5, null)], serie('_a', 5, { lluvia_mm: 2 }), HOY).puntos[0];
    expect(valorUnifrut(poca, 'lluvia', 7, m.fin)).toBeNull(); // 5 de 7 = 71 %
  });
  it('lluvia 0 real se suma como 0, un hueco (null) no cuenta como día con dato', () => {
    const conHuecos = construirRedUnifrut([est('_a', 'A', 5, null)], serie('_a', 7, { lluvia_mm: 0 }).map((l, i) => (i < 3 ? { ...l, lluvia_mm: null } : l)), HOY).puntos[0];
    expect(valorUnifrut(conHuecos, 'lluvia', 7, '2026-11-12')).toBeNull(); // 4 de 7 con dato
    expect(valorUnifrut(p, 'lluvia', 7, m.fin)).not.toBeNull();
  });
});

describe('Unifrut · resumen de colindantes (no es la lluvia areal de la cuenca)', () => {
  it('promedia solo colindantes vigentes con dato; exige ≥ 2 estaciones', () => {
    const e = [est('_a', 'A', 5, null), est('_b', 'B', 10, null), est('_c', 'C', 80, null)];
    const l = [...serie('_a', 7, { lluvia_mm: 1 }), ...serie('_b', 7, { lluvia_mm: 3 }), ...serie('_c', 7, { lluvia_mm: 50 })];
    const m = construirRedUnifrut(e, l, HOY);
    expect(resumenColindantes(m, 7)).toMatchObject({ n: 2, media: 14, min: 7, max: 21 }); // C (80 km) no entra
    const una = construirRedUnifrut(e.slice(0, 1), serie('_a', 7), HOY);
    expect(resumenColindantes(una, 7)).toMatchObject({ n: 1, media: null });
  });
  it('una colindante fuera de servicio no entra', () => {
    const e = [est('_a', 'A', 5, null), est('_b', 'B', 10, null)];
    const l = [...serie('_a', 7, { lluvia_mm: 1 }), ...Array.from({ length: 7 }, (_, i) => lec('_b', i + 40, { lluvia_mm: 9 }))];
    expect(resumenColindantes(construirRedUnifrut(e, l, HOY), 7).media).toBeNull();
  });
});
