import { describe, expect, it } from 'vitest';
import {
  DIM, ID_BRAVO, ID_DISTRITO, ID_SALIDA, arcoEnRecorrido, disponerSistema, enPoligonalDistrito, grosorDeGasto, idEstacion, idLluvia, lluviaEnDistrito, lluviaPorRegion, poligonosDeGeojson,
  recorridoDelAgua, regionDePunto, regionesDeSubcuencas, textoGastoTramo, type EstacionSitio,
} from './sistemaCuenca';
import { normalizarCuerpo, type CuerpoAgua } from './cuerposAgua';
import type { PuntoLluvia } from './jcasCuenca';

const cuerpo = (id: string, orden: number, abajo: string | null, extra: Record<string, unknown> = {}): CuerpoAgua =>
  normalizarCuerpo({ id, nombre: id, etiqueta: id, orden_red: orden, aguas_abajo_id: abajo, rol: 'almacenamiento', ...extra });

/** Catálogo real de la cuenca (topología inicial): 9 cuerpos, Luis L. León cierra. */
const CATALOGO: CuerpoAgua[] = [
  cuerpo('SG', 10, 'PA', { corriente: 'Río Florido', latitud: 26.44, longitud: -105.56 }),
  cuerpo('PA', 20, 'LLL', { corriente: 'Río Florido', latitud: 26.55, longitud: -105.25 }),
  cuerpo('PZ', 30, 'LLL', { corriente: 'Río Parral', latitud: 26.9, longitud: -105.21 }),
  cuerpo('BOQ', 40, 'COL', { corriente: 'Río Conchos', presa_id: 'PRE-001', latitud: 27.5, longitud: -107.5 }),
  cuerpo('COL', 50, 'LLL', { corriente: 'Río Conchos', rol: 'reguladora' }),
  cuerpo('MAD', 60, 'LLL', { corriente: 'Río San Pedro', presa_id: 'PRE-002' }),
  cuerpo('CHU', 70, 'LLL', { corriente: 'Río Chuvíscar' }),
  cuerpo('REJ', 80, 'LLL', { corriente: 'Arroyo El Rejón' }),
  cuerpo('LLL', 90, null, { corriente: 'Río Conchos' }),
];
const ESTACIONES: EstacionSitio[] = [
  { id: 'BOCA', rol: 'entrada', presaId: 'PRE-001' },
  { id: 'VIR', rol: 'entrada', presaId: 'PRE-002' },
  { id: 'BAB', rol: 'rio', presaId: null },
  { id: 'OJI', rol: 'salida', presaId: null },
];

const cuadro = (x0: number, y0: number, x1: number, y1: number) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const FC = {
  features: [
    { properties: { cuenca: 'R. FLORIDO', subcuenca: 'a', area_km2: 100 }, geometry: { type: 'Polygon', coordinates: cuadro(-106, 26, -105, 27) } },
    { properties: { cuenca: 'R. FLORIDO', subcuenca: 'b', area_km2: 50 }, geometry: { type: 'MultiPolygon', coordinates: [cuadro(-105, 26, -104, 27)] } },
    { properties: { cuenca: 'R. CONCHOS - P. DE LA BOQUILLA', subcuenca: 'c', area_km2: 300 }, geometry: { type: 'Polygon', coordinates: cuadro(-108, 27, -107, 28) } },
    { properties: { cuenca: 'R. CONCHOS - OJINAGA', subcuenca: 'd', area_km2: 80 }, geometry: { type: 'Polygon', coordinates: cuadro(-105, 29, -104, 30) } },
    { properties: { cuenca: '', subcuenca: 'sin cuenca' }, geometry: { type: 'Polygon', coordinates: cuadro(0, 0, 1, 1) } },
    { properties: { cuenca: 'X' }, geometry: null },
  ],
};

describe('regionesDeSubcuencas', () => {
  const regs = regionesDeSubcuencas(FC);
  it('agrupa las subcuencas por su cuenca, suma áreas y ordena de aguas arriba a aguas abajo', () => {
    expect(regs.map((r) => r.nombre)).toEqual(['Río Florido', 'Alto Conchos', 'Bajo Conchos']);
    expect(regs[0]).toMatchObject({ areaKm2: 150, nSubcuencas: 2, aLaSalida: false });
    expect(regs[0].poligonos).toHaveLength(2);
    expect(regs[2].aLaSalida).toBe(true);
  });
  it('ignora entidades sin cuenca o sin geometría y no falla con una entrada inválida', () => {
    expect(regionesDeSubcuencas(null)).toEqual([]);
    expect(regionesDeSubcuencas({ features: 'x' })).toEqual([]);
  });
  it('ubica un punto en su región; fuera de todas o sin coordenadas es null', () => {
    expect(regionDePunto(regs, -105.5, 26.5)).toBe('R. FLORIDO');
    expect(regionDePunto(regs, -100, 20)).toBeNull();
    expect(regionDePunto(regs, null, 26.5)).toBeNull();
  });
});

describe('lluviaPorRegion', () => {
  const regs = regionesDeSubcuencas(FC);
  const pt = (id: string, lon: number, lat: number, mm: number | null, sospechosa = false): PuntoLluvia => ({ id, fuente: 'jcas', nombre: id, lon, lat, mm, sospechosa });
  it('promedia cada región y lista las estaciones de dentro de mayor a menor', () => {
    const pts = [pt('a', -105.8, 26.2, 10), pt('b', -105.5, 26.5, 30), pt('c', -105.2, 26.8, 20), pt('d', -104.8, 26.4, 5), pt('e', -104.4, 26.6, 15), pt('f', -107.5, 27.5, 40)];
    const r = lluviaPorRegion(regs, pts, 30);
    const florido = r.find((x) => x.region.clave === 'R. FLORIDO')!;
    expect(florido.dentro.map((p) => p.id)).toEqual(['b', 'c', 'e', 'a', 'd']);
    expect(florido.areal.mm).not.toBeNull();
    expect(florido.areal.mm!).toBeGreaterThan(5);
    expect(florido.areal.mm!).toBeLessThan(30);
  });
  it('con pocas estaciones la región queda S/D con su motivo (nunca 0) y las sospechosas no cuentan', () => {
    const r = lluviaPorRegion(regs, [pt('a', -105.5, 26.5, 12), pt('z', -105.4, 26.4, 0, true)], 7);
    const florido = r[0];
    expect(florido.areal.mm).toBeNull();
    expect(florido.areal.motivoSD).toMatch(/estaci/);
    expect(florido.dentro.map((p) => p.id)).toEqual(['a']);
  });
  it('una ventana sin días completos es S/D', () => {
    expect(lluviaPorRegion(regs, [], 0)[0].areal).toMatchObject({ mm: null, ventanaDias: 0 });
  });
});

describe('disponerSistema', () => {
  const regs = regionesDeSubcuencas(FC);
  const regionDe = new Map<string, string | null>(CATALOGO.map((c) => [c.id, regionDePunto(regs, c.lon, c.lat)]));
  const d = disponerSistema(CATALOGO, regs, regionDe, ESTACIONES)!;
  const n = (id: string) => d.nodos.find((x) => x.id === id)!;
  const cy = (id: string) => n(id).y + n(id).h / 2;
  const cx = (id: string) => n(id).x + n(id).w / 2;

  it('el Conchos desemboca en el Río Bravo, después de la salida en Ojinaga, sin aforo propio', () => {
    expect(cy(ID_BRAVO)).toBe(cy(ID_SALIDA));
    expect(cx(ID_BRAVO)).toBeGreaterThan(cx(ID_SALIDA));
    expect(d.enlaces).toContainEqual([ID_SALIDA, ID_BRAVO]);
    expect(d.arcos.find((a) => a.de === ID_SALIDA)!.tipo).toBe('tramo');
  });

  it('entre la lluvia y el vaso de cabecera queda espacio para ver el escurrimiento por la estación', () => {
    const ll = n(idLluvia('R. CONCHOS - P. DE LA BOQUILLA')), boca = n(idEstacion('BOCA'));
    expect(boca.x - (ll.x + ll.w)).toBeGreaterThanOrEqual(34);
  });

  it('sin cuerpos no hay esquema', () => expect(disponerSistema([], [], new Map(), [])).toBeNull());

  it('el tronco del Conchos va en una sola línea, de la cabecera a la salida', () => {
    const tronco = ['BOQ', 'COL', 'conf:florido', 'conf:sanpedro', 'conf:chuviscar', idEstacion('BAB'), 'LLL', ID_SALIDA];
    expect(new Set(tronco.map(cy)).size).toBe(1);
    const xs = tronco.map((id) => n(id).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('la toma del canal (K-0) queda después de la reguladora y antes de la confluencia del Florido', () => {
    expect(d.toma).not.toBeNull();
    expect(d.toma!.cuerpoId).toBe('COL');
    expect(d.toma!.x).toBeGreaterThan(n('COL').x + n('COL').w);
    expect(d.toma!.x).toBeLessThan(cx('conf:florido'));
  });

  it('el Florido se une antes del distrito; el San Pedro y el Chuvíscar, después; Babisas queda tras las tres confluencias', () => {
    const z = n(ID_DISTRITO);
    expect(cx('conf:florido')).toBeLessThan(z.x + z.w);
    expect(cx('conf:sanpedro')).toBeGreaterThan(z.x + z.w);
    expect(cx('conf:chuviscar')).toBeGreaterThan(cx('conf:sanpedro'));
    const bab = n(idEstacion('BAB'));
    expect(bab.x).toBeGreaterThan(cx('conf:chuviscar'));
    expect(bab.x + bab.w).toBeLessThan(n('LLL').x);
    // Babisas NO está entre Madero y el distrito: lo que mide ya pasó por el distrito y por las tres confluencias.
    const arribaDeBabisas = recorridoDelAgua(d.enlaces, bab.id);
    for (const id of ['MAD', 'CHU', 'REJ', 'SG', 'PZ', 'BOQ', 'conf:florido', 'conf:sanpedro', 'conf:chuviscar']) expect(arribaDeBabisas.has(id), id).toBe(true);
    expect(d.enlaces).toContainEqual(['conf:chuviscar', bab.id]);
    expect(d.enlaces).toContainEqual([bab.id, 'LLL']);
    expect(d.enlaces.some(([de, a]) => de === 'MAD' && a === bab.id)).toBe(false);
  });

  it('cada afluente llega al Conchos por su confluencia, y los secundarios (Parral, El Rejón) por la de su río', () => {
    const destino = (id: string) => d.arcos.find((a) => a.id === `rio:${id}`)!.a;
    expect(destino('SG')).toBe('PA');
    expect(destino('PA')).toBe('conf:florido');
    expect(destino('PZ')).toBe('conf:florido');
    expect(destino('MAD')).toBe('conf:sanpedro');
    expect(destino('CHU')).toBe('conf:chuviscar');
    expect(destino('REJ')).toBe('conf:chuviscar');
    expect(destino('BOQ')).toBe('COL');
    expect(destino('LLL')).toBe(ID_SALIDA);
    // Florido por arriba del tronco; San Pedro y Chuvíscar por debajo, con el distrito entre el Conchos y el San Pedro.
    expect(cy('SG')).toBeLessThan(cy('BOQ'));
    expect(cy('PZ')).toBeLessThan(cy('BOQ'));
    expect(cy('MAD')).toBeGreaterThan(n(ID_DISTRITO).y + n(ID_DISTRITO).h);
    expect(n(ID_DISTRITO).y).toBeGreaterThan(cy('BOQ'));
    expect(cy('CHU')).toBeGreaterThan(cy('MAD'));
  });

  it('al distrito le entran la derivación de K-0 y la de Madero, y ningún vaso lo pisa', () => {
    const z = n(ID_DISTRITO);
    expect(d.arcos.filter((a) => a.tipo === 'canal').map((a) => a.de).sort()).toEqual(['COL', 'MAD']);
    for (const p of d.nodos.filter((x) => x.tipo !== 'distrito')) expect(p.x + p.w <= z.x || p.x >= z.x + z.w || p.y + p.h <= z.y || p.y >= z.y + z.h, p.id).toBe(true);
  });

  it('lo que sale de una confluencia es un tramo sin aforo; lo que sale de Babisas, un aforo', () => {
    expect(d.arcos.find((a) => a.de === 'conf:florido')!.tipo).toBe('tramo');
    expect(d.arcos.find((a) => a.de === idEstacion('BAB'))!.tipo).toBe('aforo');
    expect(d.arcos.every((a) => !/NaN|undefined/.test(a.d))).toBe(true);
  });

  it('la estación de entrada va antes de su vaso, sobre el mismo río; la de salida vive en el nodo de salida', () => {
    const boca = n(idEstacion('BOCA')), vir = n(idEstacion('VIR'));
    expect(boca.x + boca.w).toBeLessThan(n('BOQ').x);
    expect(boca.y + boca.h / 2).toBe(cy('BOQ'));
    expect(vir.y + vir.h / 2).toBe(cy('MAD'));
    expect(d.nodos.some((x) => x.id === idEstacion('OJI'))).toBe(false);
  });

  it('la lluvia de una región escurre a sus cabeceras; la de aguas abajo cuelga de la salida', () => {
    const fl = idLluvia('R. FLORIDO');
    expect(d.enlaces.filter(([de]) => de === fl).map(([, a]) => a).sort()).toEqual(['PZ', 'SG']);
    expect(n(fl).y + n(fl).h / 2).toBe((cy('SG') + cy('PZ')) / 2);
    expect(d.enlaces).toContainEqual([idLluvia('R. CONCHOS - P. DE LA BOQUILLA'), idEstacion('BOCA')]);
    expect(d.enlaces).toContainEqual([idEstacion('BOCA'), 'BOQ']);
    const bajo = n(idLluvia('R. CONCHOS - OJINAGA'));
    expect(d.enlaces).toContainEqual([bajo.id, ID_SALIDA]);
    expect(bajo.y + bajo.h).toBeLessThan(n(ID_SALIDA).y);
  });

  it('sin regiones dibuja el esquema sin nodos de lluvia', () => {
    const s = disponerSistema(CATALOGO, [], new Map(), ESTACIONES)!;
    expect(s.nodos.some((x) => x.tipo === 'lluvia')).toBe(false);
    expect(s.etapas.map((e) => e.titulo)).not.toContain('Lluvia');
  });

  it('ningún nodo se sale del lienzo ni se encima con otro', () => {
    for (const a of d.nodos) {
      expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(20);
      expect(a.x + a.w).toBeLessThanOrEqual(d.ancho); expect(a.y + a.h).toBeLessThanOrEqual(d.alto);
    }
    for (let i = 0; i < d.nodos.length; i++) for (let j = i + 1; j < d.nodos.length; j++) {
      const a = d.nodos[i], b = d.nodos[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} encima de ${b.id}`).toBe(true);
    }
  });

  it('un catálogo sin corrientes ni distrito también se dibuja (el que no descarga a nadie cierra)', () => {
    const s = disponerSistema([cuerpo('A', 1, 'B'), cuerpo('B', 2, null)], regs.filter((r) => r.aLaSalida), new Map(), [])!;
    expect(s.toma).toBeNull();
    expect(s.nodos.some((x) => x.tipo === 'distrito')).toBe(false);
    expect(Math.min(...s.nodos.map((x) => x.y))).toBeGreaterThanOrEqual(DIM.TOP);
    expect(s.arcos.every((a) => !/NaN/.test(a.d))).toBe(true);
    expect(recorridoDelAgua(s.enlaces, 'A').has(ID_SALIDA)).toBe(true);
  });

  it('un ciclo en el catálogo no cuelga la disposición', () => {
    expect(disponerSistema([cuerpo('A', 1, 'B'), cuerpo('B', 2, 'A'), cuerpo('C', 3, null)], [], new Map(), [])).not.toBeNull();
  });
});

describe('lluvia del distrito', () => {
  const dist = poligonosDeGeojson({ features: [{ geometry: { type: 'Polygon', coordinates: cuadro(-105.6, 26.2, -105.3, 26.6) } }, { geometry: null }] });
  const pt = (id: string, lon: number, lat: number, mm: number | null): PuntoLluvia => ({ id, fuente: 'weatherlink', nombre: id, lon, lat, mm });
  const pts = [pt('m1', -105.5, 26.4, 135), pt('sr', -105.4, 26.5, 123), pt('fuera', -105.9, 26.8, 60), pt('sd', -105.45, 26.45, null)];
  it('promedia solo las estaciones con dato de dentro de la poligonal', () => {
    const r = lluviaEnDistrito(dist, pts);
    expect(r.dentro.map((p) => p.id)).toEqual(['m1', 'sr']);
    expect(r.mm).toBe(129);
  });
  it('una estación a menos de 1.5 km del borde (contorno simplificado) cuenta como del distrito; a más, no', () => {
    expect(enPoligonalDistrito(dist, -105.3 + 0.007, 26.4)).toBe(true);
    expect(enPoligonalDistrito(dist, -105.3 + 0.05, 26.4)).toBe(false);
    expect(enPoligonalDistrito([], -105.5, 26.4)).toBe(false);
  });
  it('sin estaciones dentro es S/D, nunca 0', () => {
    expect(lluviaEnDistrito(dist, [pts[2]])).toEqual({ mm: null, dentro: [] });
    expect(lluviaEnDistrito([], pts).mm).toBeNull();
    expect(poligonosDeGeojson(null)).toEqual([]);
  });
  it('las estaciones del distrito no se listan en la región que lo rodea', () => {
    const regs = regionesDeSubcuencas(FC);
    const con = lluviaPorRegion(regs, pts, 30, dist)[0].dentro.map((p) => p.id);
    const sin = lluviaPorRegion(regs, pts, 30)[0].dentro.map((p) => p.id);
    expect(sin).toEqual(['m1', 'sr', 'fuera']);
    expect(con).toEqual(['fuera']);
  });
});

describe('recorridoDelAgua', () => {
  const enlaces: [string, string][] = [['ll', 'est'], ['est', 'a'], ['a', 'b'], ['x', 'b'], ['b', 'sal'], ['a', 'dist']];
  it('incluye todo lo de aguas arriba y aguas abajo, sin los ramales que no tocan al elemento', () => {
    expect([...recorridoDelAgua(enlaces, 'a')].sort()).toEqual(['a', 'b', 'dist', 'est', 'll', 'sal']);
    expect([...recorridoDelAgua(enlaces, 'x')].sort()).toEqual(['b', 'sal', 'x']);
    expect([...recorridoDelAgua(enlaces, 'sal')].sort()).toEqual(['a', 'b', 'est', 'll', 'sal', 'x']);
  });
  it('un id desconocido devuelve solo ese id, y un arco cuenta si sus dos extremos están', () => {
    const r = recorridoDelAgua(enlaces, 'x');
    expect([...recorridoDelAgua(enlaces, 'nada')]).toEqual(['nada']);
    expect(arcoEnRecorrido({ de: 'x', a: 'b' }, r)).toBe(true);
    expect(arcoEnRecorrido({ de: 'a', a: 'b' }, r)).toBe(false);
  });
});

describe('trazo y texto del gasto', () => {
  it('el grosor crece con el gasto y sin dato o en cero es el trazo fino', () => {
    expect(grosorDeGasto(null, 80)).toBe(1.6);
    expect(grosorDeGasto(0, 80)).toBe(1.6);
    expect(grosorDeGasto(80, 80)).toBe(9);
    expect(grosorDeGasto(500, 80)).toBe(9);
    expect(grosorDeGasto(20, 80)).toBeGreaterThan(grosorDeGasto(5, 80));
  });
  it('S/D para null (nunca 0) y el cero real se escribe', () => {
    expect(textoGastoTramo(null)).toBe('S/D');
    expect(textoGastoTramo(undefined)).toBe('S/D');
    expect(textoGastoTramo(0)).toBe('0.00');
    expect(textoGastoTramo(2.414)).toBe('2.41');
    expect(textoGastoTramo(76.34)).toBe('76.3');
  });
});
