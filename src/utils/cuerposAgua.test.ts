import { describe, expect, it } from 'vitest';
import {
  aniosDisponibles, anillosDeGeojson, celdaCierre, construirRed, coberturaDeCuerpo, csvCierres, etiquetaMes, evaporacionMes, indexarCierres, longitudEscala,
  mesesDe, normalizarBalance, normalizarCierre, normalizarCuerpo, ordenarCuerpos, proyeccionPara, resumenResiduo, rutaDeAnillos, serieBalance, separacionDebil, ultimoCierreConDato, variacionEnCiclo,
  type BalanceMensual, type CierreMensual, type CuerpoAgua, type Par,
} from './cuerposAgua';

const cuerpo = (id: string, extra: Record<string, unknown> = {}): CuerpoAgua =>
  normalizarCuerpo({ id, nombre: id, etiqueta: id, cuenca_id: 'RH24-CONCHOS', orden_red: 0, ...extra });
const cierre = (cuerpoId: string, mes: string, extra: Record<string, unknown> = {}): CierreMensual =>
  normalizarCierre({ cuerpo_id: cuerpoId, mes, fecha_cierre: mes, calidad: 'OK', almacenamiento_mm3: 10, pct_namo: 50, elevacion_msnm: 1000.5, detalle: {}, ...extra });

describe('normalizadores · S/D nunca es 0', () => {
  it('numeric de PostgREST llega como string y vacío es null', () => {
    const c = normalizarCierre({ cuerpo_id: 'CA-A', mes: '2025-05-01', fecha_cierre: '2025-05-31', almacenamiento_mm3: '132.99', elevacion_msnm: null, pct_namo: '', calidad: 'OK', detalle: {} });
    expect(c.almMm3).toBe(132.99);
    expect(c.elevMsnm).toBeNull();
    expect(c.pctNamo).toBeNull();
  });
  it('el detalle conserva cada fuente que tuvo dato y descarta basura', () => {
    const c = normalizarCierre({
      cuerpo_id: 'CA-A', mes: '2021-06-01', fecha_cierre: '2021-06-30', calidad: 'DIFIERE',
      detalle: { srl: { fecha: '2021-06-30', almacenamiento: 80.214, origen: 'HISTORICO' }, sina: { fecha: '2021-06-30', almacenamiento: '74.887', elevacion: 1227.86 }, otra: { x: 1 } },
    });
    expect(c.detalle.srl?.almacenamiento).toBe(80.214);
    expect(c.detalle.sina?.almacenamiento).toBe(74.887);
    expect(c.detalle.aqwp).toBeUndefined();
    expect(Object.keys(c.detalle)).toEqual(['srl', 'sina']);
  });
  it('id_serie del cuerpo sin presa operativa es su propio id', () => {
    expect(cuerpo('CA-PAGCH').idSerie).toBe('CA-PAGCH');
    expect(cuerpo('CA-LBQCH', { presa_id: 'PRE-001', id_serie: 'PRE-001' }).idSerie).toBe('PRE-001');
  });
});

describe('celdaCierre', () => {
  it('formatea por métrica y marca S/D cuando falta el dato', () => {
    expect(celdaCierre(cierre('A', '2025-01-01', { almacenamiento_mm3: 441.197 }), 'mm3').texto).toBe('441');
    expect(celdaCierre(cierre('A', '2025-01-01', { almacenamiento_mm3: 4.801 }), 'mm3').texto).toBe('4.8');
    expect(celdaCierre(cierre('A', '2025-01-01', { pct_namo: 72.31 }), 'pct').texto).toMatch(/^72[.,]3 %$/);
    expect(celdaCierre(cierre('A', '2025-01-01', { elevacion_msnm: 1291.2 }), 'elev').texto).toMatch(/1[,.\s]?291[.,]20/);
    const sd = celdaCierre(cierre('A', '2025-05-01', { almacenamiento_mm3: null, calidad: 'SD' }), 'mm3');
    expect(sd).toMatchObject({ texto: 'S/D', sd: true });
  });
  it('un mes sin renglón también es S/D', () => {
    expect(celdaCierre(undefined, 'mm3')).toMatchObject({ texto: 'S/D', sd: true, cierre: null });
  });
  it('el cero verdadero se muestra como 0, no como S/D', () => {
    expect(celdaCierre(cierre('A', '2025-01-01', { almacenamiento_mm3: 0 }), 'mm3').sd).toBe(false);
  });
});

describe('meses y cobertura', () => {
  const cs = [cierre('A', '2021-12-01'), cierre('A', '2022-01-01'), cierre('A', '2022-02-01', { almacenamiento_mm3: null, calidad: 'SD' }), cierre('B', '2022-01-01')];
  it('lista años descendente y meses ascendentes', () => {
    expect(aniosDisponibles(cs)).toEqual([2022, 2021]);
    expect(mesesDe(cs, 2022)).toEqual(['2022-01-01', '2022-02-01']);
    expect(mesesDe(cs, null)).toEqual(['2021-12-01', '2022-01-01', '2022-02-01']);
  });
  it('indexa por cuerpo|mes', () => {
    expect(indexarCierres(cs).get('B|2022-01-01')?.cuerpoId).toBe('B');
  });
  it('cuenta meses con dato, S/D, difiere, repetido y por fuente', () => {
    const r = coberturaDeCuerpo([
      cierre('A', '2022-01-01', { fuente_alm: 'SINA' }), cierre('A', '2022-02-01', { calidad: 'REPETIDO', fuente_alm: 'SINA' }),
      cierre('A', '2022-03-01', { calidad: 'DIFIERE', fuente_alm: 'SRL' }), cierre('A', '2022-04-01', { almacenamiento_mm3: null, calidad: 'SD' }),
    ]);
    expect(r).toMatchObject({ total: 4, conDato: 3, sd: 1, difiere: 1, repetido: 1 });
    expect(r.porFuente).toEqual({ SRL: 1, SINA: 2, AQWP: 0 });
  });
  it('último cierre con dato ignora los S/D finales', () => {
    const u = ultimoCierreConDato([cierre('A', '2025-04-01'), cierre('A', '2025-05-01', { almacenamiento_mm3: null, calidad: 'SD' })]);
    expect(u?.mes).toBe('2025-04-01');
    expect(ultimoCierreConDato([cierre('A', '2025-05-01', { almacenamiento_mm3: null, calidad: 'SD' })])).toBeNull();
  });
  it('etiquetas de mes en español', () => {
    expect(etiquetaMes('2026-09-01')).toBe('sep');
    expect(etiquetaMes('2026-09-01', true)).toBe('sep 26');
  });
});

describe('csvCierres', () => {
  it('lleva BOM, deja vacío el S/D y no inventa ceros', () => {
    const csv = csvCierres(
      [cuerpo('A', { etiqueta: 'San Gabriel, Dgo.', orden_red: 10 })],
      [cierre('A', '2025-05-01', { almacenamiento_mm3: null, elevacion_msnm: null, pct_namo: null, calidad: 'SD' })],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const filas = csv.trim().split('\n');
    expect(filas).toHaveLength(2);
    expect(filas[1].startsWith('A,"San Gabriel, Dgo.",2025-05,')).toBe(true);
    expect(filas[1]).toContain(',SD,');
    expect(filas[1]).not.toMatch(/,0,/);
  });
});

describe('red río–presa', () => {
  const cs = [
    cuerpo('LLN', { orden_red: 90 }), cuerpo('SGB', { orden_red: 10, aguas_abajo_id: 'PAG' }), cuerpo('PAG', { orden_red: 20, aguas_abajo_id: 'LLN' }),
    cuerpo('LBQ', { orden_red: 40, aguas_abajo_id: 'COL' }), cuerpo('COL', { orden_red: 50, aguas_abajo_id: 'LLN' }),
  ];
  it('calcula los saltos a la salida y los afluentes de cada nodo', () => {
    const r = construirRed(cs);
    const n = (id: string) => r.find((x) => x.cuerpo.id === id)!;
    expect(n('LLN').nivel).toBe(0);
    expect(n('PAG').nivel).toBe(1);
    expect(n('SGB').nivel).toBe(2);
    expect(n('LBQ').nivel).toBe(2);
    expect(n('LLN').hijos).toEqual(['COL', 'PAG']);
  });
  it('ordena aguas arriba → aguas abajo', () => {
    expect(ordenarCuerpos(cs).map((c) => c.id)).toEqual(['SGB', 'PAG', 'LBQ', 'COL', 'LLN']);
  });
  it('un ciclo en el catálogo no cuelga la función', () => {
    const r = construirRed([cuerpo('A', { aguas_abajo_id: 'B' }), cuerpo('B', { aguas_abajo_id: 'A' })]);
    expect(r).toHaveLength(2);
  });
  it('un destino que no existe se trata como salida', () => {
    expect(construirRed([cuerpo('A', { aguas_abajo_id: 'FANTASMA' })])[0].nivel).toBe(0);
  });
});

describe('geometría para dibujar', () => {
  const cuadro: Par[] = [[-105.5, 28], [-105.49, 28], [-105.49, 28.01], [-105.5, 28.01], [-105.5, 28]];
  it('extrae anillos de Polygon y MultiPolygon y descarta basura', () => {
    expect(anillosDeGeojson({ type: 'Polygon', coordinates: [cuadro, cuadro] })).toHaveLength(2);
    expect(anillosDeGeojson({ type: 'MultiPolygon', coordinates: [[cuadro], [cuadro]] })).toHaveLength(2);
    expect(anillosDeGeojson({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
    expect(anillosDeGeojson(null)).toEqual([]);
  });
  it('proyecta dentro del recuadro conservando la proporción (el norte arriba)', () => {
    const p = proyeccionPara([cuadro], 200, 100, 10)!;
    expect(p.y(28.01)).toBeLessThan(p.y(28));
    for (const [lon, lat] of cuadro) {
      expect(p.x(lon)).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(p.x(lon)).toBeLessThanOrEqual(190 + 1e-6);
      expect(p.y(lat)).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(p.y(lat)).toBeLessThanOrEqual(90 + 1e-6);
    }
    // 0.01° de longitud a 28° mide ~0.98 km y 0.01° de latitud ~1.11 km: el dibujo es más alto que ancho
    expect(Math.abs(p.y(28) - p.y(28.01))).toBeGreaterThan(Math.abs(p.x(-105.5) - p.x(-105.49)));
  });
  it('sin anillos no hay proyección', () => {
    expect(proyeccionPara([], 100, 100)).toBeNull();
  });
  it('la ruta cierra cada anillo con Z', () => {
    const p = proyeccionPara([cuadro], 100, 100)!;
    expect(rutaDeAnillos([cuadro, cuadro], p).match(/Z/g)).toHaveLength(2);
  });
  it('la barra de escala es 1, 2 o 5 por una potencia de 10', () => {
    for (const mPorPx of [3, 17, 55, 140, 800]) {
      const e = longitudEscala(mPorPx);
      expect([1, 2, 5, 10]).toContain(Number((e.metros / 10 ** Math.floor(Math.log10(e.metros))).toFixed(6)));
      expect(e.px).toBeGreaterThan(20);
    }
    expect(longitudEscala(100).etiqueta).toMatch(/km|m/);
  });
});

describe('evaporación de agua libre · informativa, S/D nunca es 0', () => {
  const fila = (extra: Record<string, unknown> = {}) => normalizarBalance({
    cuerpo_id: 'CA-LBQCH', mes: '2026-08-01', dias_mes: 31, calidad: 'OK', evap_mm3: '13.86', evap_bajo_mm3: '10.16', evap_alto_mm3: '15.94', evap_dias: 29, evap_lamina_mm: '268.9', ...extra,
  });
  it('normaliza central, rango, días y lámina desde strings de PostgREST', () => {
    const e = evaporacionMes(fila());
    expect(e).toEqual({ mm3: 13.86, bajo: 10.16, alto: 15.94, dias: 29, laminaMm: 268.9 });
    expect(e!.bajo).toBeLessThanOrEqual(e!.mm3);
    expect(e!.alto).toBeGreaterThanOrEqual(e!.mm3);
  });
  it('sin estación o con menos de la mitad de los días llega null y se queda S/D (no 0)', () => {
    const sd = fila({ evap_mm3: null, evap_bajo_mm3: null, evap_alto_mm3: null, evap_dias: null, evap_lamina_mm: null });
    expect(sd.evap).toBeNull();
    expect(evaporacionMes(sd)).toBeNull();
  });
  it('un rango incompleto no se presenta como cifra', () => {
    expect(evaporacionMes(fila({ evap_alto_mm3: null }))).toBeNull();
  });
  it('no toca el residuo ni el error de cierre: la evaporación es informativa', () => {
    const b = fila({ residuo_mm3: '10.9', error_cierre_mm3: null });
    expect(b.residuo).toBe(10.9);
    expect(b.errorCierre).toBeNull();
  });
});

describe('balance', () => {
  const b = (cuerpoId: string, mes: string, extra: Partial<BalanceMensual> = {}): BalanceMensual => ({
    cuerpoId, mes, sIni: 1, sFin: 2, deltaS: 1, entradas: 65, salidaTotal: 2.4, extraccion: 2.4, vertido: 0, diasMes: 31, diasAportacion: 30, diasSalida: 30,
    coberturaPct: 96.8, evap: null, evapBajo: null, evapAlto: null, evapDias: null, evapLaminaMm: null, residuo: 13, errorCierre: null, calidad: 'OK', ...extra,
  });
  it('devuelve los últimos n meses del cuerpo en orden cronológico', () => {
    const s = serieBalance([b('A', '2025-12-01'), b('A', '2025-10-01'), b('B', '2025-11-01'), b('A', '2025-11-01')], 'A', 2);
    expect(s.map((x) => x.mes)).toEqual(['2025-11-01', '2025-12-01']);
  });
  it('el residuo solo promedia meses OK y se expresa contra las entradas', () => {
    const r = resumenResiduo([b('A', '2025-01-01', { residuo: 10, entradas: 100 }), b('A', '2025-02-01', { residuo: 20, entradas: 100 }), b('A', '2025-03-01', { calidad: 'PARCIAL', residuo: 999 }), b('A', '2025-04-01', { calidad: 'SD', residuo: null })]);
    expect(r).toEqual({ nMeses: 2, mediaMm3: 15, pctEntradas: 15 });
    expect(resumenResiduo([b('A', '2025-04-01', { calidad: 'SD', residuo: null })])).toBeNull();
  });
});

describe('variacionEnCiclo', () => {
  const cs = [cuerpo('A', { orden_red: 10 }), cuerpo('B', { orden_red: 20 }), cuerpo('C', { orden_red: 30 })];
  const cie = [
    cierre('A', '2026-09-01', { almacenamiento_mm3: 100, pct_namo: 40 }), cierre('A', '2026-10-01', { almacenamiento_mm3: 120, pct_namo: 48 }),
    cierre('B', '2026-09-01', { almacenamiento_mm3: 50, pct_namo: 60 }), // ciclo recién iniciado: sin cierre posterior
    cierre('C', '2025-03-01', { almacenamiento_mm3: 6, pct_namo: 70 }), // dato vencido: no cuenta como posterior al inicio
  ];
  it('calcula el cambio desde el 30-sep hasta el último cierre con dato', () => {
    const v = variacionEnCiclo(cs, cie, 2026);
    expect(v[0]).toMatchObject({ deltaPct: 8, deltaMm3: 20 });
    expect(v[0].inicio?.mes).toBe('2026-09-01');
    expect(v[0].actual?.mes).toBe('2026-10-01');
  });
  it('sin cierre posterior o sin dato de inicio el cambio es S/D (null), nunca 0', () => {
    const v = variacionEnCiclo(cs, cie, 2026);
    expect(v[1]).toMatchObject({ actual: null, deltaPct: null, deltaMm3: null });
    expect(v[2]).toMatchObject({ inicio: null, actual: null, deltaPct: null });
  });
});

describe('separacionDebil', () => {
  it('marca separación débil con eta < 0.8 o umbral fijo; con buena separación o sin dato no afirma nada', () => {
    expect(separacionDebil({ umbrales: { eta_ndwi: 0.702, eta_mndwi: 0.626, fijo: false } })).toBe(true);
    expect(separacionDebil({ umbrales: { eta_ndwi: 0.9, eta_mndwi: 0.75 } })).toBe(true);
    expect(separacionDebil({ umbrales: { eta_ndwi: 0.86, eta_mndwi: 0.882, fijo: false } })).toBe(false);
    expect(separacionDebil({ umbrales: { fijo: true } })).toBe(true);
    expect(separacionDebil(null)).toBe(false);
    expect(separacionDebil({})).toBe(false);
  });
});
