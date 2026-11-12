import { describe, expect, it } from 'vitest';
import { balanceTramos, definirTramos, fuentesDeGastos, lecturasTramos, ORIGEN_TOMA_K0, type FuentesTramo } from './balanceTramosRio';
import { normalizarBalance, normalizarCuerpo, type BalanceMensual, type CuerpoAgua } from './cuerposAgua';

const c = (id: string, extra: Record<string, unknown> = {}): CuerpoAgua =>
  normalizarCuerpo({ id, nombre: id, etiqueta: id, cuenca_id: 'RH24', orden_red: 0, aqwp_ubicacion_id: 1, ...extra });

// Red real simplificada: SG → Pico → LLL ; Boquilla → Colina (regulador sin dato) → LLL ; Piedras Azules (sin telemetría) → LLL ; LLL sale de la cuenca.
const SG = c('CA-SGBDR', { etiqueta: 'San Gabriel', aguas_abajo_id: 'CA-PAGCH', orden_red: 10 });
const PICO = c('CA-PAGCH', { etiqueta: 'Pico del Águila', aguas_abajo_id: 'CA-LLNCH', orden_red: 20 });
const PAZ = c('CA-PAZCH', { etiqueta: 'Piedras Azules', aguas_abajo_id: 'CA-LLNCH', orden_red: 30, aqwp_ubicacion_id: null });
const BOQ = c(ORIGEN_TOMA_K0, { etiqueta: 'La Boquilla', aguas_abajo_id: 'CA-COLINA', orden_red: 40 });
const COLINA = c('CA-COLINA', { etiqueta: 'La Colina', rol: 'reguladora', aguas_abajo_id: 'CA-LLNCH', orden_red: 50, aqwp_ubicacion_id: null });
const MAD = c('CA-FIMCH', { etiqueta: 'F. I. Madero', aguas_abajo_id: 'CA-LLNCH', orden_red: 60 });
const LLL = c('CA-LLNCH', { etiqueta: 'Luis L. León', aguas_abajo_id: null, orden_red: 90 });
const CATALOGO = [SG, PICO, PAZ, BOQ, COLINA, MAD, LLL];

const bal = (cuerpoId: string, mes: string, extra: Record<string, unknown> = {}): BalanceMensual =>
  normalizarBalance({ cuerpo_id: cuerpoId, mes, dias_mes: 30, calidad: 'OK', ...extra });

const SIN_FUENTES: FuentesTramo = { ojinagaMes: () => null, k0Mes: () => null };
const RANGO = { desde: '2026-05-01', hasta: '2026-06-01' };

describe('definirTramos · salen del catálogo', () => {
  const tramos = definirTramos(CATALOGO);
  const porDestino = (id: string) => tramos.find((t) => t.destino.tipo === 'vaso' && t.destino.cuerpo.id === id);
  it('agrupa por el vaso de abajo y salta al regulador sin telemetría', () => {
    expect(porDestino('CA-PAGCH')?.origenes.map((o) => o.id)).toEqual(['CA-SGBDR']);
    expect(porDestino('CA-LLNCH')?.origenes.map((o) => o.id)).toEqual(['CA-PAGCH', ORIGEN_TOMA_K0, 'CA-FIMCH']);
  });
  it('un vaso sin telemetría queda como «sin medir» y el regulador no es ni origen ni aporte', () => {
    const t = porDestino('CA-LLNCH')!;
    expect(t.sinMedir.map((o) => o.id)).toEqual(['CA-PAZCH']);
    expect([...t.origenes, ...t.sinMedir].some((o) => o.id === 'CA-COLINA')).toBe(false);
  });
  it('el último vaso de la cadena cierra contra Ojinaga y va al final', () => {
    const ult = tramos[tramos.length - 1];
    expect(ult.destino.tipo).toBe('ojinaga');
    expect(ult.origenes.map((o) => o.id)).toEqual(['CA-LLNCH']);
  });
  it('solo el tramo que contiene a Boquilla descuenta la toma K-0', () => {
    expect(tramos.filter((t) => t.derivaK0).map((t) => t.destino.tipo === 'vaso' ? t.destino.cuerpo.id : 'ojinaga')).toEqual(['CA-LLNCH']);
  });
  it('con tres o más vasos de origen el nombre no los enumera', () => {
    expect(porDestino('CA-LLNCH')!.nombre).toBe('Vasos de arriba → Luis L. León');
    expect(porDestino('CA-PAGCH')!.nombre).toBe('San Gabriel → Pico del Águila');
  });
  it('un catálogo sin vasos medidos arriba no inventa tramos', () => {
    expect(definirTramos([c('X', { aqwp_ubicacion_id: null })])).toEqual([]);
  });
  it('un ciclo en aguas_abajo_id no cuelga el cálculo', () => {
    const a = c('A', { aguas_abajo_id: 'B' }), b = c('B', { aguas_abajo_id: 'A', aqwp_ubicacion_id: null });
    expect(() => definirTramos([a, b])).not.toThrow();
  });
});

describe('balanceTramos · S/D nunca es 0', () => {
  const [tSG] = definirTramos(CATALOGO).filter((t) => t.destino.tipo === 'vaso' && t.destino.cuerpo.id === 'CA-PAGCH');
  it('suma solo meses completos y calcula lo no medido = llega − liberado', () => {
    const r = balanceTramos([tSG], [
      bal('CA-SGBDR', '2026-05-01', { salida_total_mm3: 34.3 }), bal('CA-PAGCH', '2026-05-01', { entradas_mm3: 28.0 }),
      bal('CA-SGBDR', '2026-06-01', { salida_total_mm3: 5.5 }), bal('CA-PAGCH', '2026-06-01', { entradas_mm3: 9.9 }),
    ], RANGO, SIN_FUENTES)[0];
    expect(r.mesesCompletos).toBe(2);
    expect(r.liberado).toBeCloseTo(39.8);
    expect(r.llega).toBeCloseTo(37.9);
    expect(r.noMedido).toBeCloseTo(-1.9);
    expect(r.noMedidoPct).toBeCloseTo((-1.9 / 39.8) * 100, 1);
    expect(r.derivado).toBeNull();
  });
  it('un mes sin salida NO cuenta como cero: se descarta y se explica', () => {
    const r = balanceTramos([tSG], [
      bal('CA-SGBDR', '2026-05-01', { salida_total_mm3: null }), bal('CA-PAGCH', '2026-05-01', { entradas_mm3: 28.0 }),
      bal('CA-SGBDR', '2026-06-01', { salida_total_mm3: 5.5 }), bal('CA-PAGCH', '2026-06-01', { entradas_mm3: 9.9 }),
    ], RANGO, SIN_FUENTES)[0];
    expect(r.mesesCompletos).toBe(1);
    expect(r.liberado).toBeCloseTo(5.5);
    expect(r.meses[0]).toMatchObject({ completo: false, noMedido: null, motivo: 'sin salida de San Gabriel' });
    expect(r.descartes).toEqual([{ motivo: 'sin salida de San Gabriel', meses: 1 }]);
  });
  it('sin ningún mes completo todo queda null, no 0', () => {
    const r = balanceTramos([tSG], [], RANGO, SIN_FUENTES)[0];
    expect(r).toMatchObject({ mesesCompletos: 0, liberado: null, llega: null, noMedido: null, noMedidoPct: null });
  });
  it('si lo liberado es menos de 1 Mm³ el porcentaje es null (el cociente no dice nada)', () => {
    const r = balanceTramos([tSG], [bal('CA-SGBDR', '2026-05-01', { salida_total_mm3: 0.2 }), bal('CA-PAGCH', '2026-05-01', { entradas_mm3: 3 })], { desde: '2026-05-01', hasta: '2026-05-01' }, SIN_FUENTES)[0];
    expect(r.noMedido).toBeCloseTo(2.8);
    expect(r.noMedidoPct).toBeNull();
  });
});

describe('balanceTramos · derivación K-0 y Ojinaga', () => {
  const tramos = definirTramos(CATALOGO);
  const tLLL = tramos.find((t) => t.destino.tipo === 'vaso' && t.destino.cuerpo.id === 'CA-LLNCH')!;
  const tOj = tramos.find((t) => t.destino.tipo === 'ojinaga')!;
  const baseLLL = (mes: string) => [
    bal('CA-PAGCH', mes, { salida_total_mm3: 5 }), bal(ORIGEN_TOMA_K0, mes, { salida_total_mm3: 90 }), bal('CA-FIMCH', mes, { salida_total_mm3: 10 }),
    bal('CA-LLNCH', mes, { entradas_mm3: 40 }),
  ];
  it('descuenta la toma K-0: llega − (liberado − derivado)', () => {
    const r = balanceTramos([tLLL], baseLLL('2026-05-01'), { desde: '2026-05-01', hasta: '2026-05-01' }, { ojinagaMes: () => null, k0Mes: () => 70 })[0];
    expect(r.liberado).toBe(105);
    expect(r.derivado).toBe(70);
    expect(r.noMedido).toBeCloseTo(40 - (105 - 70)); // +5
    expect(r.noMedido).toBeCloseTo(5);
  });
  it('sin gasto medido en K-0 el mes se descarta aunque haya todo lo demás', () => {
    const r = balanceTramos([tLLL], baseLLL('2026-05-01'), { desde: '2026-05-01', hasta: '2026-05-01' }, SIN_FUENTES)[0];
    expect(r.mesesCompletos).toBe(0);
    expect(r.descartes[0].motivo).toBe('sin gasto medido en la toma K-0');
  });
  it('Ojinaga compara la salida de Luis L. León con el volumen del aforo', () => {
    const r = balanceTramos([tOj], [bal('CA-LLNCH', '2026-05-01', { salida_total_mm3: 20 })], { desde: '2026-05-01', hasta: '2026-05-01' }, { ojinagaMes: () => 26.5, k0Mes: () => null })[0];
    expect(r.liberado).toBe(20);
    expect(r.llega).toBe(26.5);
    expect(r.noMedido).toBeCloseTo(6.5);
    expect(r.derivado).toBeNull();
  });
  it('sin aforo en Ojinaga el mes queda incompleto', () => {
    const r = balanceTramos([tOj], [bal('CA-LLNCH', '2026-05-01', { salida_total_mm3: 20 })], { desde: '2026-05-01', hasta: '2026-05-01' }, SIN_FUENTES)[0];
    expect(r.mesesCompletos).toBe(0);
    expect(r.descartes[0].motivo).toBe('sin aforo en Ojinaga');
  });
});

describe('fuentesDeGastos · cobertura mínima', () => {
  const dias = (n: number, q: number) => Array.from({ length: n }, (_, i) => ({ fecha: `2026-05-${String(i + 1).padStart(2, '0')}`, valor: q }));
  it('un mes con 60 % o más de días da volumen = gasto medio × días del mes × 0.0864', () => {
    const f = fuentesDeGastos(null, dias(31, 10), '2026-11-12');
    expect(f.k0Mes('2026-05-01')).toBeCloseTo(10 * 31 * 0.0864);
  });
  it('con menos de 60 % de los días o sin serie es null (no 0)', () => {
    const f = fuentesDeGastos(dias(5, 10), dias(5, 10), '2026-11-12');
    expect(f.k0Mes('2026-05-01')).toBeNull();
    expect(f.ojinagaMes('2026-05-01')).toBeNull();
    expect(fuentesDeGastos(null, null, '2026-11-12').k0Mes('2026-05-01')).toBeNull();
  });
});

describe('lecturasTramos', () => {
  const [tSG] = definirTramos(CATALOGO).filter((t) => t.destino.tipo === 'vaso' && t.destino.cuerpo.id === 'CA-PAGCH');
  const resultado = (sale: number, entra: number) => balanceTramos([tSG], [bal('CA-SGBDR', '2026-05-01', { salida_total_mm3: sale }), bal('CA-PAGCH', '2026-05-01', { entradas_mm3: entra })], { desde: '2026-05-01', hasta: '2026-05-01' }, SIN_FUENTES);
  it('cuadra (≤ 10 %) → ok; revisar (> 25 %) → warn; en medio → info', () => {
    expect(lecturasTramos(resultado(100, 95), 'el ciclo')[0].tono).toBe('ok');
    expect(lecturasTramos(resultado(100, 80), 'el ciclo')[0].tono).toBe('info');
    expect(lecturasTramos(resultado(100, 60), 'el ciclo')[0].tono).toBe('warn');
  });
  it('explica el signo: negativo = llega menos; positivo = entró más', () => {
    expect(lecturasTramos(resultado(100, 60), 'el ciclo')[0].texto).toMatch(/llegó menos/);
    expect(lecturasTramos(resultado(60, 100), 'el ciclo')[0].texto).toMatch(/entró más/);
  });
  it('sin meses completos dice por qué y no da cifra', () => {
    const l = lecturasTramos(balanceTramos([tSG], [], RANGO, SIN_FUENTES), 'el ciclo')[0];
    expect(l.tono).toBe('info');
    expect(l.titulo).toMatch(/sin balance/);
    expect(l.texto).toMatch(/no se cuenta como cero/);
  });
  it('nombra el aporte que no se mide', () => {
    const tLLL = definirTramos(CATALOGO).find((t) => t.destino.tipo === 'vaso' && t.destino.cuerpo.id === 'CA-LLNCH')!;
    const r = balanceTramos([tLLL], [
      bal('CA-PAGCH', '2026-05-01', { salida_total_mm3: 5 }), bal(ORIGEN_TOMA_K0, '2026-05-01', { salida_total_mm3: 90 }), bal('CA-FIMCH', '2026-05-01', { salida_total_mm3: 10 }), bal('CA-LLNCH', '2026-05-01', { entradas_mm3: 40 }),
    ], { desde: '2026-05-01', hasta: '2026-05-01' }, { ojinagaMes: () => null, k0Mes: () => 70 });
    expect(lecturasTramos(r, 'el ciclo')[0].texto).toMatch(/Piedras Azules no se mide/);
  });
});
