import { describe, it, expect } from 'vitest';
import {
  CICLO_POR_DEFECTO as C, tcmAAf, afAMm3, mm3AAf, diasCiclo, anioDelCiclo, rangoAnioCiclo, resuelvePeriodo, mesesDelCiclo,
  volumenPeriodo, avanceCiclo, metasEn, concilia, capturaPeriodo, serieAcumuladaPublicada, volumenMensual, lecturaAvance,
  brechaOficialVsPublicado, type EntregaDiaria, type Afluente,
} from './tratadoCiclo';

const AFL: Afluente[] = [
  { clave: 'conchos', nombre: 'Río Conchos', estacion: '08373000', orden: 1 },
  { clave: 'salado', nombre: 'Río Salado', estacion: '08-RSPC', orden: 2 },
];

describe('conversiones', () => {
  it('363,679 AF = 448.6 Mm³ (el PDF del IBWC dice 449)', () => {
    expect(afAMm3(363679)).toBeCloseTo(448.6, 1);
    expect(mm3AAf(afAMm3(1000))).toBeCloseTo(1000, 6);
  });
  it('1,750,000 AF = 2,158.6 Mm³ y 350,000 AF = 431.7 Mm³', () => {
    expect(afAMm3(1_750_000)).toBeCloseTo(2158.6, 1);
    expect(afAMm3(350_000)).toBeCloseTo(431.7, 1);
  });
  it('1000 TCM = 810.7 AF', () => expect(tcmAAf(1000)).toBeCloseTo(810.71, 1));
});

describe('ciclo 2025-2030', () => {
  it('dura 1826 días (25-oct-2025 → 24-oct-2030)', () => expect(diasCiclo(C)).toBe(1826));
  it('año del ciclo y rangos', () => {
    expect(anioDelCiclo(C, '2025-10-25')).toBe(1);
    expect(anioDelCiclo(C, '2026-10-24')).toBe(1);
    expect(anioDelCiclo(C, '2026-10-25')).toBe(2);
    expect(anioDelCiclo(C, '2030-10-24')).toBe(5);
    expect(anioDelCiclo(C, '2025-10-24')).toBeNull();
    expect(rangoAnioCiclo(C, 1)).toEqual({ desde: '2025-10-25', hasta: '2026-10-24' });
    expect(rangoAnioCiclo(C, 5)).toEqual({ desde: '2029-10-25', hasta: '2030-10-24' });
  });
  it('periodos se recortan a hoy y al ciclo', () => {
    const p = resuelvePeriodo(C, { tipo: 'ciclo' }, '2026-11-13');
    expect(p.desde).toBe('2025-10-25'); expect(p.hasta).toBe('2026-11-13'); expect(p.esActual).toBe(true);
    const m = resuelvePeriodo(C, { tipo: 'mes', mes: '2025-10' }, '2026-11-13');
    expect(m.desde).toBe('2025-10-25'); expect(m.hasta).toBe('2025-10-31');
    const m2 = resuelvePeriodo(C, { tipo: 'mes', mes: '2026-02' }, '2026-11-13');
    expect(m2.hasta).toBe('2026-02-28');
    const r = resuelvePeriodo(C, { tipo: 'rango', desde: '2026-03-10', hasta: '2026-03-01' }, '2026-11-13');
    expect(r.desde).toBe('2026-03-01'); expect(r.hasta).toBe('2026-03-10');
  });
  it('meses del ciclo, el más reciente primero', () => {
    const m = mesesDelCiclo(C, '2026-11-13');
    expect(m[0]).toBe('2026-11'); expect(m[m.length - 1]).toBe('2025-10'); expect(m.length).toBe(14);
  });
});

describe('avance oficial', () => {
  const corte = { fecha: '2026-11-07', acumuladoAf: 363679, acumuladoMcm: 449, deudaRemanenteAf: 861980 };
  it('contra la meta lineal y el ritmo requerido', () => {
    const a = avanceCiclo(C, [corte]);
    expect(a.diasTranscurridos).toBe(379);
    expect(a.pctCompromiso).toBeCloseTo(20.78, 1);
    expect(a.metaLinealAf).toBeCloseTo((1_750_000 * 379) / 1826, 0); // ≈ 363,224
    expect(a.estado).toBe('en_meta'); // 363,679 vs 363,224: dentro de 0.5 % del compromiso
    expect(a.faltanteAf).toBe(1_750_000 - 363679);
    expect(a.ritmoRequeridoAfDia).toBeCloseTo((1_750_000 - 363679) / a.diasRestantes!, 2);
    expect(a.metaConDeudaAf).toBeGreaterThan(a.metaLinealAf!);
    expect(a.proyeccionFinAf).toBeCloseTo((363679 / 379) * 1826, 0);
    expect(a.deudaRemanenteAf).toBe(861980);
  });
  it('sin corte: S/D, no 0', () => {
    const a = avanceCiclo(C, []);
    expect(a.estado).toBe('sd'); expect(a.acumuladoAf).toBeNull(); expect(a.pctCompromiso).toBeNull();
    expect(lecturaAvance(a)).toContain('S/D');
  });
  it('cambio entre cortes (los aumentos)', () => {
    const a = avanceCiclo(C, [corte, { fecha: '2026-10-31', acumuladoAf: 360000, acumuladoMcm: 444, deudaRemanenteAf: null }]);
    expect(a.deltaAf).toBe(3679); expect(a.deltaDias).toBe(7); expect(a.deltaAfSemana).toBeCloseTo(3679, 0);
  });
  it('atrasado y adelantado', () => {
    expect(avanceCiclo(C, [{ ...corte, acumuladoAf: 300000 }]).estado).toBe('atrasado');
    expect(avanceCiclo(C, [{ ...corte, acumuladoAf: 420000 }]).estado).toBe('adelante');
  });
  it('metas en una fecha', () => {
    expect(metasEn(C, '2030-10-24').lineal).toBeCloseTo(1_750_000, 0);
    expect(metasEn(C, '2030-10-24').conDeuda).toBeCloseTo(1_750_000 + 865_139, 0);
    expect(metasEn(C, '2025-10-24').lineal).toBe(0);
  });
});

describe('volumen publicado y conciliación', () => {
  const E: EntregaDiaria[] = [
    { afluente: 'conchos', fecha: '2026-03-01', tcm: 100 }, { afluente: 'conchos', fecha: '2026-03-02', tcm: 200 },
    { afluente: 'conchos', fecha: '2026-03-03', tcm: null },
    { afluente: 'salado', fecha: '2026-03-01', tcm: 50 },
  ];
  it('suma TCM, no rellena S/D y marca cota inferior', () => {
    const v = volumenPeriodo(E, AFL, '2026-03-01', '2026-03-03');
    expect(v.afluentes[0].mm3).toBeCloseTo(0.3, 6);
    expect(v.afluentes[0].dias).toBe(2);
    expect(v.afluentes[0].cobertura).toBeCloseTo(66.67, 1);
    expect(v.totalAf).toBeCloseTo(tcmAAf(350), 6);
    expect(v.cotaInferior).toBe(true);
  });
  it('afluente sin datos → null (S/D), nunca 0', () => {
    const v = volumenPeriodo([], AFL, '2026-03-01', '2026-03-03');
    expect(v.afluentes.every((a) => a.af == null && a.mm3 == null)).toBe(true);
    expect(v.totalAf).toBe(0);
    const c = concilia(v, [], []);
    expect(c.fuentes[0].mm3).toBeNull();
  });
  it('serie acumulada y mensual', () => {
    const s = serieAcumuladaPublicada(E, '2026-03-01', '2026-03-31');
    expect(s.map((p) => p.fecha)).toEqual(['2026-03-01', '2026-03-02']);
    expect(s[1].af).toBeCloseTo(tcmAAf(350), 6);
    const m = volumenMensual(E, '2026-03-01', '2026-03-31');
    expect(m).toHaveLength(1); expect(m[0].afluentes.conchos).toBeCloseTo(tcmAAf(300), 6);
  });
  it('Sutron fuera de rango se declara no confiable', () => {
    const v = volumenPeriodo([{ afluente: 'conchos', fecha: '2026-03-01', tcm: 100 }], AFL, '2026-03-01', '2026-03-01');
    // 100 TCM = 0.1 Mm³; un Sutron con 10 m³/s medio = 0.864 Mm³ → razón 8.6
    const c = concilia(v, [{ fecha: '2026-03-01', gastoMedio: 10, lecturas: 96 }], [], [{ afluente: 'conchos', fecha: '2026-03-01', tcm: 100 }]);
    expect(c.razonSicaIbwc).toBeCloseTo(8.64, 2);
    expect(c.sicaConfiable).toBe(false);
    expect(c.fuentes[2].nota).toContain('calibrar');
    const ok = concilia(v, [{ fecha: '2026-03-01', gastoMedio: 1.2, lecturas: 96 }], [], [{ afluente: 'conchos', fecha: '2026-03-01', tcm: 100 }]);
    expect(ok.diasComunesSica).toBe(1);
    expect(ok.sicaConfiable).toBe(true);
  });
  it('la razón SICA-IBWC se calcula solo en los días con ambos datos', () => {
    const E2: EntregaDiaria[] = [1, 2, 3, 4].map((d) => ({ afluente: 'conchos', fecha: `2026-03-0${d}`, tcm: 100 }));
    const v = volumenPeriodo(E2, AFL, '2026-03-01', '2026-03-04');
    // IBWC: 0.4 Mm³ en 4 días. Sutron solo el día 4 con 1.157 m³/s = 0.1 Mm³ → razón 1.0 contra el día común, no 0.25 contra el total
    const c = concilia(v, [{ fecha: '2026-03-04', gastoMedio: 0.1 / 0.0864, lecturas: 96 }], [], E2);
    expect(c.diasComunesSica).toBe(1);
    expect(c.razonSicaIbwc).toBeCloseTo(1, 3);
    expect(c.sicaConfiable).toBe(true);
  });
  it('captura CONAGUA: solo vigentes y completas dentro del periodo', () => {
    const caps = [
      { id: 1, desde: '2026-03-01', hasta: '2026-03-07', mm3: 5, fuente: 'CILA', comentario: null, autor: null, creadoEn: '', anulada: false },
      { id: 2, desde: '2026-03-01', hasta: '2026-03-07', mm3: 9, fuente: 'CILA', comentario: null, autor: null, creadoEn: '', anulada: true },
      { id: 3, desde: '2026-02-25', hasta: '2026-03-03', mm3: 4, fuente: 'CILA', comentario: null, autor: null, creadoEn: '', anulada: false },
    ];
    expect(capturaPeriodo(caps, '2026-03-01', '2026-03-31')).toEqual({ mm3: 5, n: 1 });
    expect(capturaPeriodo([], '2026-03-01', '2026-03-31')).toEqual({ mm3: null, n: 0 });
  });
  it('brecha oficial contra publicado', () => {
    const b = brechaOficialVsPublicado(E, C, { fecha: '2026-03-31', acumuladoAf: 1000, acumuladoMcm: null, deudaRemanenteAf: null });
    expect(b?.oficialAf).toBe(1000); expect(b!.difAf).toBeGreaterThan(0);
    expect(brechaOficialVsPublicado(E, C, null)).toBeNull();
  });
});
