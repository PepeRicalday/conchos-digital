import { describe, expect, it } from 'vitest';
import { anclarSerie, cambioEn, lecturasPresas, periodoInicial, rangosPeriodo, type PuntoSerie, salidaPorCiclo } from './cuencaAnalisis';

const serie: PuntoSerie[] = [
  { fecha: '2026-10-13', v: 1000 },
  { fecha: '2026-11-11', v: 1180 },
];

describe('anclarSerie: el cambio parte de la cifra que se muestra', () => {
  it('agrega el total de hoy cuando es más reciente que la serie', () => {
    const s = anclarSerie(serie, { fecha: '2026-11-13', v: 1194 });
    expect(s).toHaveLength(3);
    expect(s[2]).toEqual({ fecha: '2026-11-13', v: 1194 });
    // 1194 (indicador) − 1000 (hace 31 días) = +194, no los +180 de la serie sin anclar
    expect(cambioEn(s, 30)?.delta).toBeCloseTo(194, 6);
    expect(cambioEn(serie, 30)?.delta).toBeCloseTo(180, 6);
  });
  it('sustituye el último punto si es del mismo día', () => {
    const s = anclarSerie(serie, { fecha: '2026-11-11', v: 1190 });
    expect(s).toHaveLength(2);
    expect(s[1].v).toBe(1190);
  });
  it('no toca la serie con total nulo, sin fecha o más viejo que el último punto', () => {
    expect(anclarSerie(serie, { fecha: '2026-11-13', v: null })).toBe(serie);
    expect(anclarSerie(serie, { fecha: null, v: 1194 })).toBe(serie);
    expect(anclarSerie(serie, { fecha: '2026-11-01', v: 1194 })).toBe(serie);
  });
  it('no modifica la serie original', () => {
    anclarSerie(serie, { fecha: '2026-11-13', v: 1194 });
    expect(serie).toHaveLength(2);
  });
});

describe('periodo con el que abre el balance', () => {
  it('con menos de 3 meses de ciclo abre el ciclo anterior y lo pone primero', () => {
    expect(periodoInicial('2026-10-05')).toBe('cicloAnt');
    expect(periodoInicial('2026-11-13')).toBe('cicloAnt');
    const r = rangosPeriodo('2026-11-13');
    expect(r[0]).toMatchObject({ clave: 'cicloAnt', etiqueta: 'Ciclo 2025-2026', desde: '2025-10-01', hasta: '2026-09-01' });
    expect(r[0].enCurso).toBeUndefined();
    expect(r[1]).toMatchObject({ clave: 'ciclo', etiqueta: 'Ciclo 2026-2027', desde: '2026-10-01', hasta: '2026-11-01', enCurso: true });
  });
  it('desde diciembre abre el ciclo en curso y lo pone primero', () => {
    expect(periodoInicial('2026-12-01')).toBe('ciclo');
    expect(periodoInicial('2027-06-15')).toBe('ciclo');
    expect(periodoInicial('2027-09-30')).toBe('ciclo');
    const r = rangosPeriodo('2027-06-15');
    expect(r[0]).toMatchObject({ clave: 'ciclo', etiqueta: 'Ciclo 2026-2027', hasta: '2027-06-01', enCurso: true });
    expect(r[1].clave).toBe('cicloAnt');
  });
  it('conserva los cinco periodos', () => {
    expect(rangosPeriodo('2026-11-13').map((x) => x.clave).sort()).toEqual(['12m', '24m', 'ciclo', 'cicloAnt', 'todo']);
  });
});

describe('lecturasPresas: años de historia sin número fijo', () => {
  const presas = [{ etiqueta: 'La Boquilla', pct: 29.2, cambio30Puntos: 5, percentil: 20, sinActualizar: false, atrasoDias: 0 }];
  it('dice los años que recibe', () => {
    const t = lecturasPresas(presas, 10).find((l) => l.titulo === 'Frente a su historia')?.texto;
    expect(t).toMatch(/Historia de 10 años/);
  });
  it('sin el dato no inventa un número', () => {
    const t = lecturasPresas(presas).find((l) => l.titulo === 'Frente a su historia')?.texto;
    expect(t).toMatch(/Historia corta/);
    expect(t).not.toMatch(/\d+ años/);
  });
});

describe('salidaPorCiclo', () => {
  const dias = (desde: string, hasta: string, v: number | null): { fecha: string; valor: number | null }[] => {
    const out: { fecha: string; valor: number | null }[] = [];
    for (let t = Date.parse(`${desde}T12:00:00Z`); t <= Date.parse(`${hasta}T12:00:00Z`); t += 86_400_000) out.push({ fecha: new Date(t).toISOString().slice(0, 10), valor: v });
    return out;
  };
  it('sin lecturas: no hay ciclos', () => { expect(salidaPorCiclo([], '2026-11-13')).toEqual([]); });
  it('ciclo completo a 1 m³/s: 365 días × 0.0864 = 31.5 Mm³; el ciclo en curso va primero y se marca', () => {
    const l = [...dias('2024-10-01', '2025-09-30', 1), ...dias('2025-10-01', '2026-11-13', 2)];
    const c = salidaPorCiclo(l, '2026-11-13');
    expect(c.map((x) => x.clave)).toEqual(['2026-2027', '2025-2026', '2024-2025']);
    expect(c[0]).toMatchObject({ enCurso: true });
    expect(c[2].total.mm3).toBeCloseTo(365 * 0.0864, 3);
    expect(c[1].total.gastoMedio).toBeCloseTo(2, 6);
  });
  it('«a la misma fecha»: 1 oct al 13 nov en cada ciclo (44 días)', () => {
    const l = [...dias('2024-10-01', '2025-09-30', 1), ...dias('2026-10-01', '2026-11-13', 3)];
    const c = salidaPorCiclo(l, '2026-11-13');
    expect(c.find((x) => x.clave === '2024-2025')!.aLaFecha.diasPeriodo).toBe(44);
    expect(c.find((x) => x.clave === '2024-2025')!.aLaFecha.mm3).toBeCloseTo(44 * 0.0864, 3);
    expect(c[0].aLaFecha.mm3).toBeCloseTo(44 * 3 * 0.0864, 3);
  });
  it('un ciclo con menos de 60 % de días con aforo no tiene volumen estimado, solo el observado', () => {
    const l = [...dias('2023-10-01', '2023-12-31', 1), ...dias('2026-10-01', '2026-11-13', 1)];
    const c = salidaPorCiclo(l, '2026-11-13').find((x) => x.clave === '2023-2024')!;
    expect(c.total.mm3).toBeNull();
    expect(c.total.mm3Observado).toBeCloseTo(92 * 0.0864, 3);
  });
  it('un ciclo sin ningún aforo en medio queda S/D (no 0)', () => {
    const l = [...dias('2022-10-01', '2022-10-10', 1), ...dias('2026-10-01', '2026-11-13', 1)];
    const c = salidaPorCiclo(l, '2026-11-13').find((x) => x.clave === '2024-2025')!;
    expect(c.total.mm3).toBeNull(); expect(c.total.mm3Observado).toBeNull();
  });
});
