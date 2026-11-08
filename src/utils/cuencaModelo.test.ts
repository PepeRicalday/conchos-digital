import { describe, it, expect } from 'vitest';
import { construirModeloCuenca, type EntradaModeloCuenca } from './cuencaModelo';
import type { EstadoUbicacion, FilaGrafica } from './aqwpCuenca';
import type { Climatologia } from '../hooks/useAqwpCuenca';

const est = (o: Partial<EstadoUbicacion> & { ubicacionId: number }): EstadoUbicacion => ({
  codigo: 'X', nombre: 'X', tipo: 'presa', presaId: null, fecha: '2026-11-06', almacenamientoMm3: null, estancado: false,
  diasIgual: null, igualDesde: null, namoMm3: null, muertoMm3: null, pctNamo: null, aportacionM3s: null,
  extraccionTotalM3s: null, vertidoM3s: null, gastoM3s: null, ...o,
});

const dia = (i: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);

/** Serie de N días que sube linealmente `paso` puntos porcentuales por día. */
const serie = (id: number, n: number, ini: number, paso: number): FilaGrafica[] =>
  Array.from({ length: n }, (_, i) => ({ fecha: dia(i), [String(id)]: ini + paso * i } as FilaGrafica));

const clim = (ubic: number, mediana: number, valores: number[], nAnios = 9): Climatologia => ({
  diaHoy: 311,
  banda: [{ ubicacionId: ubic, diaAnio: 311, nAnios, minimo: Math.min(...valores), p10: valores[0], p25: null, mediana, p75: null, p90: valores[valores.length - 1], maximo: Math.max(...valores) }],
  hoy: [{ ubicacionId: ubic, diaAnio: 311, nAnios, valores }],
});

const base = (over: Partial<EntradaModeloCuenca> = {}): EntradaModeloCuenca => ({
  estados: [est({ ubicacionId: 526, nombre: 'Luis L. León', almacenamientoMm3: 36.634, namoMm3: 284.382, muertoMm3: 23.634, extraccionTotalM3s: 0 })],
  serie: serie(526, 40, 10, 0.1), descartes: {}, climatologia: null, ...over,
});

describe('construirModeloCuenca', () => {
  it('Luis L. León: 5 % útil (físico) lo vuelve crítico aunque su % NAMO sea 12.9 %', () => {
    const [m] = construirModeloCuenca(base(), '2026-11-07');
    expect(m.util!.utilMm3).toBeCloseTo(13.0, 1);
    expect(m.util!.pctUtil).toBeCloseTo(5.0, 1);
    expect(m.semaforo.nivel).toBe('critico');
    expect(m.fila.pct).toBeCloseTo(12.9, 1);
  });

  it('con climatología: percentil, anomalía y la nota "n = 9 años"; con ella el semáforo histórico cuenta', () => {
    const c = clim(526, 230.7, [90.8, 97, 120, 150, 180, 200, 230.7, 250, 260, 289.5, 295]);
    const [m] = construirModeloCuenca(base({ climatologia: c }), '2026-11-07');
    expect(m.posicion!.percentil).toBe(0);
    expect(m.posicion!.nAnios).toBe(9);
    expect(m.posicion!.nota).toMatch(/n = 9 años/);
    expect(m.semaforo.motivos.join(' ')).toMatch(/Percentil 0/);
    expect(m.banda).not.toBeNull();
  });

  it('sin climatología: no hay posición ni banda (la UI rotula el rango de 12 meses) pero sí el rango propio', () => {
    const [m] = construirModeloCuenca(base(), '2026-11-07');
    expect(m.posicion).toBeNull();
    expect(m.banda).toBeNull();
    expect(m.rangoPropio).not.toBeNull();
  });

  it('con pocos años (5) hay rango histórico pero NO percentil', () => {
    const c = clim(526, 230.7, [90.8, 120, 200, 250, 295], 5);
    const [m] = construirModeloCuenca(base({ climatologia: c }), '2026-11-07');
    expect(m.posicion!.percentil).toBeNull();
    expect(m.posicion!.mediana).toBe(230.7);
  });

  it('tendencia Theil-Sen en Mm³/día desde la serie en %: +0.1 pp/día × NAMO 284 = +0.284 Mm³/día', () => {
    const [m] = construirModeloCuenca(base(), '2026-11-07');
    expect(m.tendencia!.pendienteMm3Dia).toBeCloseTo(0.284, 2);
    expect(m.cambio30Puntos).toBeCloseTo(3.0, 0);
  });

  it('una lectura sin actualizar NO da tendencia (pendiente 0 no significa estable) y conserva valor y marca', () => {
    const s: FilaGrafica[] = Array.from({ length: 40 }, (_, i) => ({ fecha: dia(i), '538_e': 38.2, '538': null } as unknown as FilaGrafica));
    const e = [est({ ubicacionId: 538, nombre: 'Chihuahua', almacenamientoMm3: 8.924, namoMm3: 23.383, muertoMm3: 0.739, estancado: true, diasIgual: 47, igualDesde: '2026-09-22', extraccionTotalM3s: 0.09 })];
    const [m] = construirModeloCuenca({ estados: e, serie: s, descartes: {}, climatologia: null }, '2026-11-07');
    expect(m.tendencia).toBeNull();
    expect(m.fila.sinActualizar).toBe(true);
    expect(m.fila.almacenamientoValido).toBe(8.924);
    expect(m.semaforo.calidad).toBe('sin_actualizar');
    expect(m.serie.every((p) => p.dudoso)).toBe(true);
    expect(m.serie.every((p) => p.pct === 38.2)).toBe(true);
  });

  it('presa sin NAMO ni muerto: útil S/D, sin banda, sin participación y el semáforo no inventa nada', () => {
    const e = [est({ ubicacionId: 539, nombre: 'El Rejón', almacenamientoMm3: 2.264, namoMm3: null })];
    const [m] = construirModeloCuenca({ estados: e, serie: [], descartes: {}, climatologia: null }, '2026-11-07');
    expect(m.util).toBeNull();
    expect(m.participacionNamo).toBeNull();
    expect(m.semaforo.nivel).toBe('sd');
    expect(m.serie).toEqual([]);
  });

  it('participación en el NAMO sumado de la cuenca', () => {
    const e = [est({ ubicacionId: 536, namoMm3: 2846.78, almacenamientoMm3: 819 }), est({ ubicacionId: 537, namoMm3: 333.318, almacenamientoMm3: 180 })];
    const m = construirModeloCuenca({ estados: e, serie: [], descartes: {}, climatologia: null }, '2026-11-07');
    expect(m[0].participacionNamo).toBeCloseTo(89.5, 1);
    expect(m[1].participacionNamo).toBeCloseTo(10.5, 1);
  });

  it('frescura: Boquilla/Madero (distrito) no se atrasan en fin de semana; las demás sí cuentan días corridos', () => {
    const e = [
      est({ ubicacionId: 536, presaId: 'PRE-001', fecha: '2026-11-06', almacenamientoMm3: 800, namoMm3: 2846 }), // viernes
      est({ ubicacionId: 541, fecha: '2026-11-06', almacenamientoMm3: 100, namoMm3: 245 }),
    ];
    const m = construirModeloCuenca({ estados: e, serie: [], descartes: {}, climatologia: null }, '2026-11-09'); // lunes
    const bq = m.find((x) => x.fila.ubicacionId === 536)!;
    const sg = m.find((x) => x.fila.ubicacionId === 541)!;
    expect(bq.atrasoDias).toBe(1);   // solo el lunes
    expect(sg.atrasoDias).toBe(3);   // vie → lun, días corridos
    expect(bq.frescura).toBe('al_dia');
    expect(sg.frescura).toBe('atrasada');
  });

  it('rotula San Gabriel con su estado y trae su ficha', () => {
    const e = [est({ ubicacionId: 541, nombre: 'San Gabriel', almacenamientoMm3: 106.594, namoMm3: 245.431, muertoMm3: 9.44 })];
    const [m] = construirModeloCuenca({ estados: e, serie: [], descartes: {}, climatologia: null }, '2026-11-07');
    expect(m.fila.etiqueta).toBe('San Gabriel, Dgo.');
    expect(m.meta!.rio).toBe('Florido');
  });

  it('pasa los descartes de atípicos de cada presa para rotularlos', () => {
    const d = { 537: [{ fecha: '2026-04-06', valor: 319.462, motivo: 'pico_aislado' as const, previo: 229.343, siguiente: 228.808 }] };
    const e = [est({ ubicacionId: 537, nombre: 'Madero', almacenamientoMm3: 180, namoMm3: 333 })];
    const [m] = construirModeloCuenca({ estados: e, serie: [], descartes: d, climatologia: null }, '2026-11-07');
    expect(m.descartes).toHaveLength(1);
    expect(m.descartes[0].fecha).toBe('2026-04-06');
  });
});
