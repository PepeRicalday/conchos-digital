import { describe, it, expect } from 'vitest';
import {
  diaDelAnio, percentilEmpirico, posicionHistorica, normalizarClimatologia, normalizarClimatologiaHoy, volumenUtil, theilSen,
  participacionNamo, semaforoCuenca, anioInicioCiclo, lluviaCiclo, lluviaVsCicloAnterior, MIN_ANIOS_PERCENTIL,
  type ClimatologiaHoy,
} from './aqwpEstadistica';

const dias = (inicio: string, vals: (number | null)[]) =>
  vals.map((valor, i) => ({ fecha: new Date(Date.parse(`${inicio}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), valor }));

describe('diaDelAnio', () => {
  it('coincide con extract(doy): 7-nov-2026 = 311 (verificado contra la vista SQL)', () => {
    expect(diaDelAnio('2026-11-07')).toBe(311);
    expect(diaDelAnio('2026-01-01')).toBe(1);
    expect(diaDelAnio('2026-12-31')).toBe(365);
    expect(diaDelAnio('2024-12-31')).toBe(366);
  });
});

describe('percentilEmpirico', () => {
  const muestra = Array.from({ length: 10 }, (_, i) => (i + 1) * 10); // 10..100
  it('% de observaciones MENORES que el valor', () => {
    expect(percentilEmpirico(55, muestra, 9)).toBe(50);
    expect(percentilEmpirico(5, muestra, 9)).toBe(0);
    expect(percentilEmpirico(500, muestra, 9)).toBe(100);
  });
  it('con empates cuenta solo las estrictamente menores', () => {
    expect(percentilEmpirico(50, muestra, 9)).toBe(40);
  });
  it(`con menos de ${MIN_ANIOS_PERCENTIL} años NO es un percentil (null)`, () => {
    expect(percentilEmpirico(55, muestra, 7)).toBeNull();
    expect(percentilEmpirico(55, muestra, 8)).toBe(50);
  });
  it('sin valor o sin muestra: null, nunca 0', () => {
    expect(percentilEmpirico(null, muestra, 9)).toBeNull();
    expect(percentilEmpirico(10, [], 9)).toBeNull();
    expect(percentilEmpirico(NaN, muestra, 9)).toBeNull();
  });
});

describe('posicionHistorica (caso real 7-nov-2026)', () => {
  // Luis L. León: hoy 36.6; histórico mediana 230.7, mín 90.8, máx 295.0, p10 97.0, p90 289.5, n = 9 años
  const valores = [90.8, 97, 120, 150, 180, 200, 230.7, 250, 260, 289.5, 295];
  const hoy: ClimatologiaHoy = { ubicacionId: 526, diaAnio: 311, nAnios: 9, valores };
  const fila = normalizarClimatologia({ ubicacion_id: 526, dia_anio: 311, n_anios: 9, minimo: '90.8', p10: '97', p25: 150, mediana: '230.7', p75: 260, p90: '289.5', maximo: 295 });

  it('récord bajo: percentil 0, anomalía −194.1 Mm³ (−84.1 %) y la nota "n = 9 años"', () => {
    const r = posicionHistorica(36.634, hoy, fila)!;
    expect(r.percentil).toBe(0);
    expect(r.mediana).toBe(230.7);
    expect(r.anomaliaMm3).toBeCloseTo(-194.1, 1);
    expect(r.anomaliaPct).toBeCloseTo(-84.1, 1);
    expect(r.nota).toMatch(/n = 9 años/);
  });
  it('sin climatología o sin valor: null', () => {
    expect(posicionHistorica(36.6, null, fila)).toBeNull();
    expect(posicionHistorica(null, hoy, fila)).toBeNull();
    expect(posicionHistorica(36.6, { ...hoy, valores: [] }, fila)).toBeNull();
  });
  it('con pocos años da el rango pero no el percentil', () => {
    const r = posicionHistorica(150, { ...hoy, nAnios: 5 }, fila)!;
    expect(r.percentil).toBeNull();
    expect(r.mediana).toBe(230.7);
  });
  it('normaliza los numeric[] que llegan como strings y descarta basura', () => {
    const n = normalizarClimatologiaHoy({ ubicacion_id: '526', dia_anio: 311, n_anios: 9, valores: ['3', 1, null, 'x', '2.5'] });
    expect(n.valores).toEqual([1, 2.5, 3]);
    expect(normalizarClimatologiaHoy({ ubicacion_id: 1, dia_anio: 1, n_anios: 9 }).valores).toEqual([]);
  });
});

describe('volumenUtil (caso real Luis L. León)', () => {
  it('13.0 Mm³ útiles de 36.6 almacenados = 5 % útil, aunque el % del NAMO sea 12.9 %', () => {
    const r = volumenUtil(36.634, 23.634, 284.382)!;
    expect(r.utilMm3).toBeCloseTo(13.0, 1);
    expect(r.pctUtil).toBeCloseTo(5.0, 1);
    expect(r.capacidadUtilMm3).toBeCloseTo(260.75, 2);
    expect(Math.round((36.634 / 284.382) * 1000) / 10).toBeCloseTo(12.9, 1);
  });
  it('Boquilla: 713.7 útiles = 26 %', () => {
    const r = volumenUtil(819.803, 106.087, 2846.78)!;
    expect(r.utilMm3).toBeCloseTo(713.7, 1);
    expect(r.pctUtil).toBeCloseTo(26.0, 1);
  });
  it('bajo el volumen muerto: 0 útil y la marca bajoMuerto (no negativo)', () => {
    const r = volumenUtil(5, 9.44, 245.431)!;
    expect(r.utilMm3).toBe(0);
    expect(r.pctUtil).toBe(0);
    expect(r.bajoMuerto).toBe(true);
  });
  it('sin algún dato, o NAMO ≤ muerto: null', () => {
    expect(volumenUtil(null, 1, 10)).toBeNull();
    expect(volumenUtil(5, null, 10)).toBeNull();
    expect(volumenUtil(5, 1, null)).toBeNull();
    expect(volumenUtil(5, 10, 10)).toBeNull();
  });
});

describe('theilSen', () => {
  it('serie lineal +4.33 Mm³/día (Boquilla) → pendiente exacta', () => {
    const s = dias('2026-10-01', Array.from({ length: 30 }, (_, i) => 700 + 4.33 * i));
    const t = theilSen(s, 30)!;
    expect(t.pendienteMm3Dia).toBeCloseTo(4.33, 2);
    expect(t.n).toBe(30);
  });
  it('usa FECHAS reales: lecturas de lunes a viernes (saltos de 3 días) dan la misma pendiente', () => {
    const fechas = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
    const base = Date.parse('2026-10-05T00:00:00Z');
    const s = fechas.map((f) => ({ fecha: f, valor: 100 + 2 * ((Date.parse(`${f}T00:00:00Z`) - base) / 86_400_000) }));
    expect(theilSen(s, 30)!.pendienteMm3Dia).toBeCloseTo(2, 3);
  });
  it('es robusta a un pico aislado (Madero 06-abr-2026: 319 entre 229)', () => {
    const vals = [229.9, 229.7, 229.5, 319.462, 229.1, 228.9, 228.8];
    const t = theilSen(dias('2026-04-01', vals), 30)!;
    expect(Math.abs(t.pendienteMm3Dia)).toBeLessThan(0.5);
  });
  it('serie plana (lectura sin actualizar) = pendiente 0', () => {
    expect(theilSen(dias('2026-10-01', Array(20).fill(8.924)), 30)!.pendienteMm3Dia).toBe(0);
  });
  it('menos de 5 puntos con dato en la ventana: null', () => {
    expect(theilSen(dias('2026-10-01', [1, 2, 3, 4]), 30)).toBeNull();
    expect(theilSen(dias('2026-10-01', [1, null, null, 4, 5, null]), 30)).toBeNull();
    expect(theilSen([], 30)).toBeNull();
  });
  it('solo cuenta la ventana pedida (14 d) ignorando lo anterior', () => {
    const viejo = dias('2026-09-01', Array(20).fill(500));
    const nuevo = dias('2026-10-01', Array.from({ length: 14 }, (_, i) => 100 + 3 * i));
    expect(theilSen([...viejo, ...nuevo], 14)!.pendienteMm3Dia).toBeCloseTo(3, 2);
  });
});

describe('participacionNamo', () => {
  it('Boquilla pesa 75.2 % del NAMO de las 7 presas (2,846.78 de 3,788.1 Mm³; el "~79 %" del análisis previo era una aproximación errónea)', () => {
    const p = participacionNamo({ 536: 2846.78, 537: 333.318, 526: 284.382, 541: 245.431, 540: 48.276, 538: 23.383, 539: 6.528 });
    expect(p[536]).toBeCloseTo(75.2, 1);
    expect(p[537]).toBeCloseTo(8.8, 1);
    expect(Object.values(p).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
  it('ignora las presas sin NAMO (S/D) en vez de contarlas como 0', () => {
    const p = participacionNamo({ 1: 100, 2: null, 3: 100 });
    expect(p[2]).toBeUndefined();
    expect(p[1]).toBe(50);
  });
  it('vacío o todo S/D: sin participaciones', () => {
    expect(participacionNamo({})).toEqual({});
    expect(participacionNamo({ 1: null })).toEqual({});
  });
});

describe('semaforoCuenca', () => {
  const base = { pctUtil: 60, percentil: 60, nAnios: 9, tendenciaMm3Dia: 0, extraccionActiva: false, sinActualizar: false };
  it('todo bien = normal', () => expect(semaforoCuenca(base).nivel).toBe('normal'));
  it('físico: % útil < 10 crítico, < 25 bajo (Luis L. León 5 % → crítico)', () => {
    expect(semaforoCuenca({ ...base, pctUtil: 5, percentil: null }).nivel).toBe('critico');
    expect(semaforoCuenca({ ...base, pctUtil: 20, percentil: null }).nivel).toBe('bajo');
    expect(semaforoCuenca({ ...base, pctUtil: 25, percentil: null }).nivel).toBe('normal');
  });
  it('histórico: percentil ≤ 10 crítico, ≤ 25 bajo (Boquilla p11 = bajo-normal; Luis p0 = crítico)', () => {
    expect(semaforoCuenca({ ...base, percentil: 0 }).nivel).toBe('critico');
    expect(semaforoCuenca({ ...base, percentil: 10 }).nivel).toBe('critico');
    expect(semaforoCuenca({ ...base, percentil: 11 }).nivel).toBe('bajo');
    expect(semaforoCuenca({ ...base, percentil: 25 }).nivel).toBe('bajo');
    expect(semaforoCuenca({ ...base, percentil: 26 }).nivel).toBe('normal');
  });
  it('el nivel es el PEOR de los dos criterios', () => {
    expect(semaforoCuenca({ ...base, pctUtil: 50, percentil: 5 }).nivel).toBe('critico');
    expect(semaforoCuenca({ ...base, pctUtil: 8, percentil: 80 }).nivel).toBe('critico');
  });
  it('con pocos años el percentil no cuenta', () => {
    expect(semaforoCuenca({ ...base, percentil: 0, nAnios: 5 }).nivel).toBe('normal');
  });
  it('la tendencia solo puede BAJAR un nivel y solo con extracción activa', () => {
    expect(semaforoCuenca({ ...base, tendenciaMm3Dia: -2, extraccionActiva: true }).nivel).toBe('bajo');
    expect(semaforoCuenca({ ...base, pctUtil: 20, tendenciaMm3Dia: -2, extraccionActiva: true }).nivel).toBe('critico');
    expect(semaforoCuenca({ ...base, tendenciaMm3Dia: -2, extraccionActiva: false }).nivel).toBe('normal');
    expect(semaforoCuenca({ ...base, pctUtil: 5, percentil: 0, tendenciaMm3Dia: -2, extraccionActiva: true }).nivel).toBe('critico');
  });
  it('la tendencia NUNCA sube el nivel', () => {
    expect(semaforoCuenca({ ...base, pctUtil: 5, percentil: null, tendenciaMm3Dia: +9, extraccionActiva: true }).nivel).toBe('critico');
  });
  it('la calidad va aparte: sin actualizar no cambia el nivel ni lo vuelve S/D', () => {
    const r = semaforoCuenca({ ...base, pctUtil: 15, sinActualizar: true });
    expect(r.nivel).toBe('bajo');
    expect(r.calidad).toBe('sin_actualizar');
    expect(semaforoCuenca(base).calidad).toBe('ok');
  });
  it('sin ningún criterio disponible: S/D, nunca "normal"', () => {
    const r = semaforoCuenca({ ...base, pctUtil: null, percentil: null });
    expect(r.nivel).toBe('sd');
    expect(semaforoCuenca({ ...base, pctUtil: null, percentil: null, tendenciaMm3Dia: -5, extraccionActiva: true }).nivel).toBe('sd');
  });
  it('explica sus motivos', () => {
    expect(semaforoCuenca({ ...base, pctUtil: 5, percentil: 0 }).motivos.join(' ')).toMatch(/útil.*Percentil 0.*n = 9/s);
  });
});

describe('lluvia por ciclo', () => {
  it('el ciclo agrícola empieza el 1-oct', () => {
    expect(anioInicioCiclo('2026-10-01')).toBe(2026);
    expect(anioInicioCiclo('2026-09-30')).toBe(2025);
    expect(anioInicioCiclo('2026-01-15')).toBe(2025);
    expect(anioInicioCiclo('2025-12-31')).toBe(2025);
  });
  it('suma solo días con dato en la ventana; un día S/D no cuenta como 0', () => {
    const l = [{ fecha: '2025-10-01', valor: 5 }, { fecha: '2025-10-02', valor: 0 }, { fecha: '2025-10-03', valor: null }, { fecha: '2025-10-04', valor: 12.5 }, { fecha: '2025-11-30', valor: 99 }];
    const r = lluviaCiclo(l, 2025, 3);
    expect(r.mm).toBe(17.5);
    expect(r.diasConDato).toBe(3);
    expect(r.diasVentana).toBe(4);
    expect(r.diasConLluvia).toBe(2);
    expect(r.maxDiaMm).toBe(12.5);
    expect(r.cobertura).toBeCloseTo(0.75);
  });
  it('sin ningún dato: mm = null (S/D), no 0', () => {
    expect(lluviaCiclo([{ fecha: '2025-10-01', valor: null }], 2025, 10).mm).toBeNull();
    expect(lluviaCiclo([], 2025, 10).maxDiaMm).toBeNull();
  });
  it('compara dos ciclos sobre la misma ventana y avisa que n = 1', () => {
    const a = { mm: 331, diasConDato: 36, diasVentana: 40, diasConLluvia: 20, maxDiaMm: 35, cobertura: 0.9 };
    const b = { mm: 316, diasConDato: 38, diasVentana: 40, diasConLluvia: 18, maxDiaMm: 30, cobertura: 0.95 };
    const r = lluviaVsCicloAnterior(a, b)!;
    expect(r.difMm).toBe(15);
    expect(r.difPct).toBeCloseTo(4.7, 1);
    expect(r.nCiclosComparados).toBe(1);
    expect(r.nota).toMatch(/n = 1/);
  });
  it('con cobertura < 80 % en cualquiera de los dos NO compara (sería un artefacto)', () => {
    const buena = { mm: 100, diasConDato: 36, diasVentana: 40, diasConLluvia: 5, maxDiaMm: 10, cobertura: 0.9 };
    expect(lluviaVsCicloAnterior({ ...buena, cobertura: 0.5 }, buena)).toBeNull();
    expect(lluviaVsCicloAnterior(buena, { ...buena, cobertura: 0.79 })).toBeNull();
  });
  it('un ciclo anterior sin dato (Bajo Luis L. León 2024-25 todo nulo) no se compara', () => {
    const buena = { mm: 100, diasConDato: 36, diasVentana: 40, diasConLluvia: 5, maxDiaMm: 10, cobertura: 0.9 };
    expect(lluviaVsCicloAnterior(buena, { mm: null, diasConDato: 0, diasVentana: 40, diasConLluvia: 0, maxDiaMm: null, cobertura: 0 })).toBeNull();
  });
  it('el ciclo anterior en 0 mm da diferencia absoluta pero sin porcentaje (no divide entre 0) y con ADVERTENCIA', () => {
    const a = { mm: 10, diasConDato: 40, diasVentana: 40, diasConLluvia: 3, maxDiaMm: 5, cobertura: 1 };
    const b = { mm: 0, diasConDato: 40, diasVentana: 40, diasConLluvia: 0, maxDiaMm: 0, cobertura: 1 };
    const r = lluviaVsCicloAnterior(a, b)!;
    expect(r.difPct).toBeNull();
    expect(r.advertencia).toMatch(/0 mm.*no reportó/);
  });
  it('un ciclo anterior con lluvia real no lleva advertencia', () => {
    const a = { mm: 331, diasConDato: 36, diasVentana: 40, diasConLluvia: 20, maxDiaMm: 35, cobertura: 0.9 };
    const b = { mm: 316, diasConDato: 38, diasVentana: 40, diasConLluvia: 18, maxDiaMm: 30, cobertura: 0.95 };
    expect(lluviaVsCicloAnterior(a, b)!.advertencia).toBeNull();
  });
});
