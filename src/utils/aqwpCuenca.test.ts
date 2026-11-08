import { describe, it, expect } from 'vitest';
import {
  normalizarEstado, filasPresas, agregadoCuenca, aportacionTotal, serieLlenado, restarDias, claveEstancada,
  ORDEN_PRESAS_CUENCA, type EstadoUbicacion,
} from './aqwpCuenca';

const est = (o: Partial<EstadoUbicacion> & { ubicacionId: number }): EstadoUbicacion => ({
  codigo: 'X', nombre: 'X', tipo: 'presa', presaId: null, fecha: '2026-11-07', almacenamientoMm3: null,
  estancado: false, diasIgual: null, igualDesde: null, namoMm3: null, muertoMm3: null, pctNamo: null, aportacionM3s: null,
  extraccionTotalM3s: null, vertidoM3s: null, gastoM3s: null, ...o,
});

describe('AQWP cuenca · normalizarEstado', () => {
  it('convierte numeric-string a número y vacío/null a null (nunca 0)', () => {
    const e = normalizarEstado({ ubicacion_id: 536, codigo: 'c', nombre: 'n', tipo: 'presa', presa_id: 'PRE-001',
      fecha: '2026-11-07', almacenamiento_mm3: '819.803', almacenamiento_estancado: false, namo_mm3: 2846.78,
      muerto_mm3: null, pct_namo: '', aportacion_m3s: '0', extraccion_total_m3s: undefined, vertido_m3s: 'x', gasto_m3s: null });
    expect(e.almacenamientoMm3).toBe(819.803);
    expect(e.aportacionM3s).toBe(0);          // un cero real sí es 0
    expect(e.pctNamo).toBeNull();
    expect(e.extraccionTotalM3s).toBeNull();
    expect(e.vertidoM3s).toBeNull();
  });
  it('estancado solo si es true literal', () => {
    expect(normalizarEstado({ ubicacion_id: 1, almacenamiento_estancado: null }).estancado).toBe(false);
    expect(normalizarEstado({ ubicacion_id: 1, almacenamiento_estancado: true }).estancado).toBe(true);
  });
});

describe('AQWP cuenca · filasPresas', () => {
  const estados = [
    est({ ubicacionId: 539, nombre: 'El Rejón', almacenamientoMm3: 2.264, namoMm3: 6.528 }),
    est({ ubicacionId: 536, nombre: 'La Boquilla', presaId: 'PRE-001', almacenamientoMm3: 819.803, namoMm3: 2846.78 }),
    est({ ubicacionId: 538, nombre: 'Chihuahua', almacenamientoMm3: 8.924, namoMm3: 23.383, estancado: true, pctNamo: 38.16 }),
    est({ ubicacionId: 230, nombre: 'Ojinaga', tipo: 'aforo', gastoM3s: 1.54 }),
  ];
  const filas = filasPresas(estados);

  it('ordena con las del distrito primero y excluye el aforo', () => {
    expect(filas.map((f) => f.ubicacionId)).toEqual([536, 538, 539].sort((a, b) => ORDEN_PRESAS_CUENCA.indexOf(a as never) - ORDEN_PRESAS_CUENCA.indexOf(b as never)));
    expect(filas[0].delDistrito).toBe(true);
  });
  it('% sobre el NAMO de CONAGUA vía presaMetrics', () => {
    expect(filas[0].pct).toBeCloseTo(28.797, 2);
    expect(filas[0].estado.clave).toBe('warn');
  });
  it('serie estancada = S/D: sin almacenamiento utilizable, sin % y sin estado', () => {
    const ch = filas.find((f) => f.ubicacionId === 538)!;
    expect(ch.almacenamientoValido).toBeNull();
    expect(ch.pct).toBeNull();
    expect(ch.estado.clave).toBe('sd');
  });
  it('sin NAMO ni % grabado → S/D (no 0 %)', () => {
    const f = filasPresas([est({ ubicacionId: 540, almacenamientoMm3: 25, namoMm3: null })])[0];
    expect(f.pct).toBeNull();
  });
});

describe('AQWP cuenca · agregados', () => {
  it('el agregado excluye estancadas y sin dato en vez de contarlas como 0', () => {
    const filas = filasPresas([
      est({ ubicacionId: 536, almacenamientoMm3: 800, namoMm3: 2000 }),
      est({ ubicacionId: 538, almacenamientoMm3: 9, namoMm3: 23, estancado: true }),
      est({ ubicacionId: 539, almacenamientoMm3: null, namoMm3: 6 }),
    ]);
    const a = agregadoCuenca(filas);
    expect(a.totalMm3).toBe(800);
    expect(a.presasConDato).toBe(1);
    expect(a.presasTotal).toBe(3);
    expect(a.parcial).toBe(true);
    expect(a.porcentaje).toBeCloseTo(40, 5);
  });
  it('sin ninguna lectura válida: total null', () => {
    expect(agregadoCuenca(filasPresas([est({ ubicacionId: 536, namoMm3: 100 })])).totalMm3).toBeNull();
  });
  it('aportación total suma solo las que tienen dato; ninguna → null', () => {
    const f = filasPresas([est({ ubicacionId: 536, aportacionM3s: 1.5 }), est({ ubicacionId: 537, aportacionM3s: 0 }), est({ ubicacionId: 538 })]);
    expect(aportacionTotal(f)).toEqual({ total: 1.5, conDato: 2 });
    expect(aportacionTotal(filasPresas([est({ ubicacionId: 538 })]))).toEqual({ total: null, conDato: 0 });
  });
});

describe('AQWP cuenca · serieLlenado', () => {
  const ubicDe = new Map([[1, 536], [2, 538]]);
  const namo = new Map<number, number | null>([[536, 2000], [538, 20]]);
  it('% del NAMO por presa y fecha, ordenado', () => {
    const s = serieLlenado([
      { datasetId: 1, fecha: '2026-11-02', valor: 1000, estancada: false },
      { datasetId: 1, fecha: '2026-11-01', valor: 500, estancada: false },
    ], ubicDe, namo);
    expect(s).toEqual([{ fecha: '2026-11-01', '536': 25 }, { fecha: '2026-11-02', '536': 50 }]);
  });
  it('estancada, sin valor o sin NAMO → null (la línea se corta)', () => {
    const s = serieLlenado([
      { datasetId: 2, fecha: '2026-11-01', valor: 8.9, estancada: true },
      { datasetId: 1, fecha: '2026-11-01', valor: null, estancada: false },
      { datasetId: 1, fecha: '2026-11-02', valor: 100, estancada: false },
    ], ubicDe, new Map([[536, null], [538, 20]]));
    expect(s[0]['538']).toBeNull();
    expect(s[0]['536']).toBeNull();
    expect(s[1]['536']).toBeNull();
  });
  it('estancada: la columna normal queda null y el valor va a la columna punteada (no se esconde)', () => {
    const s = serieLlenado([{ datasetId: 2, fecha: '2026-11-01', valor: 8.9, estancada: true }], ubicDe, namo);
    expect(s[0]['538']).toBeNull();
    expect(s[0][claveEstancada(538)]).toBe(44.5);
  });
  it('un día normal no crea la columna punteada', () => {
    const s = serieLlenado([{ datasetId: 1, fecha: '2026-11-01', valor: 500, estancada: false }], ubicDe, namo);
    expect(claveEstancada(536) in s[0]).toBe(false);
  });
  it('ignora datasets que no son de almacenamiento conocido', () => {
    expect(serieLlenado([{ datasetId: 99, fecha: '2026-11-01', valor: 1, estancada: false }], ubicDe, namo)).toEqual([]);
  });
});

describe('AQWP cuenca · restarDias', () => {
  it('cruza mes y año', () => {
    expect(restarDias('2026-11-07', 7)).toBe('2026-10-31');
    expect(restarDias('2026-01-03', 5)).toBe('2025-12-29');
    expect(restarDias('2026-11-07', 365)).toBe('2025-11-07');
  });
});

import { resumenLluvia, LLUVIA_FUERTE_MM } from './aqwpCuenca';

describe('AQWP cuenca · resumenLluvia', () => {
  const ubicDe = new Map([[1, 551], [2, 526], [3, 549]]);
  const L = (datasetId: number, fecha: string, valor: number | null) => ({ datasetId, fecha, valor, estancada: false });

  it('ventana de 7 días termina en el último día con dato; 0 mm (seco) ≠ S/D', () => {
    const r = resumenLluvia([L(1, '2026-11-07', 13.5), L(1, '2026-11-06', 0), L(1, '2026-11-05', null)], ubicDe);
    expect(r.hasta).toBe('2026-11-07');
    expect(r.fechas).toHaveLength(7);
    expect(r.fechas.at(-1)).toBe('2026-11-07');
    const v = r.filas[0];
    expect(v.dias.at(-1)).toBe(13.5);
    expect(v.dias.at(-2)).toBe(0);      // seco medido
    expect(v.dias.at(-3)).toBeNull();   // sin cobertura = S/D
    expect(v.dias[0]).toBeNull();       // sin fila = S/D
  });
  it('totales suman solo días con dato y declaran cuántos hubo (parcial)', () => {
    const r = resumenLluvia([L(1, '2026-11-07', 13.5), L(1, '2026-11-06', 2.04), L(1, '2026-11-05', null)], ubicDe);
    expect(r.filas[0].total7).toEqual({ mm: 15.5, conDato: 2, ventana: 7 });
    expect(r.filas[0].total30.conDato).toBe(2);
  });
  it('un pluviómetro sin ningún dato en la ventana: total S/D (null), no 0', () => {
    const r = resumenLluvia([L(1, '2026-11-07', 5), L(2, '2026-09-01', 8)], ubicDe);
    const luis = r.filas.find((f) => f.ubicacionId === 526)!;
    expect(luis.total7.mm).toBeNull();
    expect(luis.total30.mm).toBeNull();
  });
  it('orden aguas arriba → abajo y solo pluviómetros con filas', () => {
    const r = resumenLluvia([L(3, '2026-11-07', 1), L(1, '2026-11-07', 1), L(2, '2026-11-07', 1)], ubicDe);
    expect(r.filas.map((f) => f.ubicacionId)).toEqual([551, 526, 549]);
    expect(resumenLluvia([L(2, '2026-11-07', 1)], ubicDe).filas.map((f) => f.ubicacionId)).toEqual([526]);
  });
  it('serie30 trae 30 fechas con una columna por pluviómetro', () => {
    const r = resumenLluvia([L(1, '2026-11-07', 13.5), L(2, '2026-11-07', 4.7)], ubicDe);
    expect(r.serie30).toHaveLength(30);
    expect(r.serie30.at(-1)).toEqual({ fecha: '2026-11-07', '551': 13.5, '526': 4.7 });
    expect(r.serie30[0].fecha).toBe('2026-10-09');
  });
  it('sin ningún dato devuelve resumen vacío', () => {
    expect(resumenLluvia([L(1, '2026-11-07', null)], ubicDe)).toEqual({ fechas: [], hasta: null, filas: [], serie30: [] });
    expect(LLUVIA_FUERTE_MM).toBeGreaterThan(0);
  });
});

import { cuencaCompacta } from './aqwpCuenca';

describe('AQWP cuenca · cuencaCompacta (Dashboard)', () => {
  const ubicDe = new Map([[1, 551], [2, 526], [3, 549]]);
  const L = (datasetId: number, fecha: string, valor: number | null) => ({ datasetId, fecha, valor, estancada: false });
  const dias = (id: number, vals: (number | null)[]) => vals.map((v, i) => L(id, `2026-11-0${i + 1}`, v));
  const presas = [
    est({ ubicacionId: 536, almacenamientoMm3: 800, namoMm3: 2000 }),
    est({ ubicacionId: 538, almacenamientoMm3: 9, namoMm3: 23, estancado: true }),
  ];

  it('agrega presas con dato y cuenta las estancadas sin sumarlas', () => {
    const r = cuencaCompacta(presas, resumenLluvia([], ubicDe));
    expect(r.almacenadoMm3).toBe(800);
    expect(r.pct).toBeCloseTo(40, 5);
    expect(r.conDato).toBe(1);
    expect(r.total).toBe(2);
    expect(r.estancadas).toBe(1);
    expect(r.fecha).toBe('2026-11-07');
  });
  it('lluvia: promedio de pluviómetros con ≥4 días de dato; el de pocos días no entra', () => {
    const ll = resumenLluvia([
      ...dias(1, [0, 0, 10, 0, 0, 2, 3]),          // 15 mm, 7 días
      ...dias(2, [1, 1, 1, 1, 0, 0, 0]),           // 4 mm, 7 días
      ...dias(3, [5, null, null, null, null, null, 7]), // 2 de 7 días: S/D, no entra
    ], ubicDe);
    const r = cuencaCompacta(presas, ll);
    expect(r.lluvia.pluviometros).toBe(2);
    expect(r.lluvia.total).toBe(3);
    expect(r.lluvia.promedio7Mm).toBe(9.5);
    expect(r.lluvia.maxNombre).toBe('Villalba');
    expect(r.lluvia.maxMm).toBe(15);
  });
  it('sin pluviómetros válidos: lluvia S/D (null), nunca 0', () => {
    const r = cuencaCompacta(presas, resumenLluvia([L(1, '2026-11-07', null)], ubicDe));
    expect(r.lluvia.promedio7Mm).toBeNull();
    expect(r.lluvia.maxNombre).toBeNull();
    expect(r.lluvia.maxMm).toBeNull();
  });
  it('sin presas con dato: almacenamiento y % S/D', () => {
    const r = cuencaCompacta([est({ ubicacionId: 536, namoMm3: 100 })], resumenLluvia([], ubicDe));
    expect(r.almacenadoMm3).toBeNull();
    expect(r.pct).toBeNull();
  });
});

describe('AQWP cuenca · presas del distrito con valor repetido (se contrastan contra CILA)', () => {
  const madero = est({ ubicacionId: 537, nombre: 'Madero', presaId: 'PRE-002', almacenamientoMm3: 180.785, namoMm3: 333.318, estancado: true, pctNamo: 54.2 });
  const chihuahua = est({ ubicacionId: 538, nombre: 'Chihuahua', almacenamientoMm3: 8.924, namoMm3: 23.383, estancado: true, pctNamo: 38.2 });

  it('una presa del distrito estancada SÍ se usa y se marca "repetida" (no S/D)', () => {
    const f = filasPresas([madero])[0];
    expect(f.repetida).toBe(true);
    expect(f.excluida).toBe(false);
    expect(f.almacenamientoValido).toBe(180.785);
    expect(f.pct).toBeCloseTo(54.24, 1);
  });
  it('una estancada sin contraste (Chihuahua) sigue excluida como S/D', () => {
    const f = filasPresas([chihuahua])[0];
    expect(f.excluida).toBe(true);
    expect(f.repetida).toBe(false);
    expect(f.almacenamientoValido).toBeNull();
    expect(f.pct).toBeNull();
  });
  it('el total de la cuenca nunca queda por debajo de las presas del distrito', () => {
    const boq = est({ ubicacionId: 536, presaId: 'PRE-001', almacenamientoMm3: 819.803, namoMm3: 2846.78 });
    const filas = filasPresas([boq, madero, chihuahua]);
    const cuenca = agregadoCuenca(filas), distrito = agregadoCuenca(filas.filter((x) => x.delDistrito));
    expect(distrito.totalMm3).toBeCloseTo(1000.588, 3);
    expect(cuenca.totalMm3!).toBeGreaterThanOrEqual(distrito.totalMm3!);
    expect(cuenca.presasConDato).toBe(2);
    expect(cuenca.presasTotal).toBe(3);
  });
  it('cuencaCompacta solo cuenta como estancadas las excluidas', () => {
    const r = cuencaCompacta([madero, chihuahua], resumenLluvia([], new Map()));
    expect(r.estancadas).toBe(1);
    expect(r.almacenadoMm3).toBe(180.785);
  });
});
