import { describe, it, expect } from 'vitest';
import type { ModeloRedJcas, PuntoPropio, PuntoRedJcas } from './jcasModelo';
import { construirRedUnifrut, type FilaEstacionUnifrut, type FilaLecturaUnifrut } from './unifrutModelo';
import { construirEstacionesClima, fmtValorEstacion, ofreceVariable, reporta, resumenPorRed, resumenVisible, ROTULO_RED, valorEstacion } from './estacionesClima';

const dia = (n: number) => new Date(Date.parse('2026-11-12T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
const jcas = (id: number, nombre: string, o: Partial<PuntoRedJcas> = {}): PuntoRedJcas => ({
  id, nombre, lat: 28.6, lon: -106.1, altitudM: 1400, zona: 'cuenca', grupo: null, sinPluviometro: false, mm7: 14, mm30: 60, diasConDato30: 30, ultFecha: '2026-11-12', atrasoDias: 0, estado: 'vigente',
  sospechosa: false, motivo: null, tempUltima: 15, elevM: 1400, ayer: { mm: 2, temp: 14, hum: 50, viento: 6 }, hoy: { mm: 0.4, temp: 13, hum: 55, viento: 5 }, hoyEn: '2026-11-13T07:00:00Z',
  medias: { temp7: 15, temp30: 16, hum7: 52, hum30: 54, viento7: 7, viento30: 8 }, frio: { tmaxHoy: 20, tminHoy: 5, tmax7: 24, tmin7: 3, tmin1: 4, tmin30: 1, horasFrio: 120, horasHelada: 0, desde: '2026-11-01', diasConDato: 12, diasTotal: 12, estimada: false }, ...o,
});
const propia = (id: string, nombre: string): PuntoPropio => ({
  id, nombre, lat: 28.1, lon: -105.5, mmHoy: 1.2, mm1: 3, mm7: 9, mm30: 40, ultFecha: '2026-11-12', hoyEn: null, ayer: { mm: 3, temp: 12, hum: 60, viento: 4 }, hoy: { mm: 1.2, temp: 11, hum: 62, viento: 3 },
  medias: { temp7: 13, temp30: 14, hum7: 58, hum30: 60, viento7: 5, viento30: 5 }, tempUltima: 13,
});
const red = (): ModeloRedJcas => ({
  puntos: [jcas(1, 'Aldama'), jcas(2, 'Parral', { sospechosa: true, motivo: '0 mm' }), jcas(3, 'San Antonio', { sinPluviometro: true })],
  fin: '2026-11-12', areal7: {} as never, areal30: {} as never, areal1: {} as never, arealHoy: {} as never, fechaHoy: null, hoyEn: null, propias: [propia('p1', 'Riego Meoqui')], vigentes: 3, total: 3, conLluvia: 2,
});
const estU = (id: string, nombre: string, dist: number, ult: string): FilaEstacionUnifrut => ({ id_unifrut: id, nombre, municipio: 'CUAUHTEMOC', tipo: 'CAMB', latitud: 28.4, longitud: -106.8, altitud_m: 2000, zona: 'fuera', dist_limite_km: dist, ult_fecha: ult });
const lecs = (id: string, n: number): FilaLecturaUnifrut[] => Array.from({ length: n }, (_, i) => ({ estacion_id: id, fecha: dia(i), lluvia_mm: 1, tmax_c: 20, tmin_c: 3, tmed_c: 11, viento_kmh: 5, viento_max_kmh: 15, eto_mm: 2 }));
const unif = () => construirRedUnifrut([estU('_a', 'Quinta Lupita', 7, '2026-11-12'), estU('_b', 'Apagada', 5, '2026-07-12')], lecs('_a', 40), '2026-11-13');

describe('estaciones de clima · modelo único', () => {
  const m = construirEstacionesClima(red(), unif());
  const por = (n: string) => m.estaciones.find((e) => e.nombre === n)!;
  it('reúne las tres fuentes con su clasificación', () => {
    expect(m.estaciones.filter((e) => e.fuente === 'jcas')).toHaveLength(3);
    expect(m.estaciones.filter((e) => e.fuente === 'propia')).toHaveLength(1);
    expect(m.estaciones.filter((e) => e.fuente === 'unifrut')).toHaveLength(2);
    expect(new Set(m.estaciones.map((e) => e.clave)).size).toBe(m.estaciones.length);
    expect(m.finJcas).toBe('2026-11-12');
    expect(m.finUnifrut).toBe('2026-11-12');
  });
  it('reporta: vigentes y atrasadas sí; fuera de servicio no', () => {
    expect(reporta(por('Quinta Lupita'))).toBe(true);
    expect(reporta(por('Apagada'))).toBe(false);
  });
  it('lluvia de JCAS, propia y Unifrut con la misma definición por ventana', () => {
    expect(valorEstacion(por('Aldama'), 'lluvia', 7, m.finUnifrut)).toBe(14);
    expect(valorEstacion(por('Riego Meoqui'), 'lluvia', 'hoy', m.finUnifrut)).toBe(1.2);
    expect(valorEstacion(por('Quinta Lupita'), 'lluvia', 7, m.finUnifrut)).toBe(7);
  });
  it('pluviómetro excluido o ausente = S/D en lluvia, pero su temperatura sigue valiendo', () => {
    expect(valorEstacion(por('Parral'), 'lluvia', 30, m.finUnifrut)).toBeNull();
    expect(valorEstacion(por('San Antonio'), 'lluvia', 30, m.finUnifrut)).toBeNull();
    expect(valorEstacion(por('Parral'), 'temperatura', 7, m.finUnifrut)).toBe(15);
  });
  it('otras variables: temperatura, T mín, viento, humedad y horas frío', () => {
    const a = por('Aldama');
    expect(valorEstacion(a, 'temperatura', 7, null)).toBe(15);
    expect(valorEstacion(a, 'tmin', 7, null)).toBe(3);
    expect(valorEstacion(a, 'viento', 30, null)).toBe(8);
    expect(valorEstacion(a, 'humedad', 7, null)).toBe(52);
    expect(valorEstacion(a, 'horasFrio', 30, null)).toBe(120);
  });
  it('Unifrut: «hoy» S/D, sin humedad ni horas frío; sí temperatura, T mín y viento', () => {
    const u = por('Quinta Lupita');
    expect(valorEstacion(u, 'lluvia', 'hoy', m.finUnifrut)).toBeNull();
    expect(valorEstacion(u, 'humedad', 7, m.finUnifrut)).toBeNull();
    expect(valorEstacion(u, 'horasFrio', 30, m.finUnifrut)).toBeNull();
    expect(valorEstacion(u, 'temperatura', 7, m.finUnifrut)).toBe(11);
    expect(valorEstacion(u, 'tmin', 7, m.finUnifrut)).toBe(3);
    expect(valorEstacion(u, 'viento', 7, m.finUnifrut)).toBe(5);
    expect(ofreceVariable(u, 'humedad')).toBe(false);
    expect(ofreceVariable(u, 'viento')).toBe(true);
    expect(ofreceVariable(por('Aldama'), 'humedad')).toBe(true);
  });
  it('resumen de las visibles: media simple con ≥ 2 con dato, si no S/D (nunca 0)', () => {
    const j = m.estaciones.filter((e) => e.fuente === 'jcas');
    expect(resumenVisible(j, 'temperatura', 7, null)).toMatchObject({ conDato: 3, media: 15 });
    expect(resumenVisible(j, 'lluvia', 30, null)).toMatchObject({ n: 3, conDato: 1, media: null }); // solo Aldama tiene pluviómetro útil
    expect(resumenVisible([], 'lluvia', 30, null)).toMatchObject({ conDato: 0, media: null, min: null });
  });
  it('formato con unidad y S/D', () => {
    expect(fmtValorEstacion('lluvia', 12.34)).toBe('12.3 mm');
    expect(fmtValorEstacion('humedad', 52.4)).toBe('52 %');
    expect(fmtValorEstacion('viento', null)).toBe('S/D');
  });
  it('sin ninguna red devuelve vacío', () => {
    expect(construirEstacionesClima(null, null).estaciones).toEqual([]);
  });
});

describe('estaciones de clima · resumen por red (tarjeta del Dashboard)', () => {
  const m = construirEstacionesClima(red(), unif());
  it('rotula las tres redes: Distrito, JCAS y Unifrut', () => {
    expect(ROTULO_RED).toEqual({ propia: 'Distrito', jcas: 'JCAS', unifrut: 'Unifrut' });
  });
  it('cuenta las que reportan y promedia solo con ≥ 2 con dato (si no, S/D)', () => {
    const r = resumenPorRed(m, 'temperatura', 7);
    expect(r.jcas).toMatchObject({ alDia: 3, conDato: 3, media: 15 });
    expect(r.propia).toMatchObject({ alDia: 1, conDato: 1, media: null }); // una sola propia: no hay media
    expect(r.unifrut).toMatchObject({ alDia: 1, media: null }); // la apagada no cuenta y con una no se promedia
  });
  it('lluvia: el pluviómetro excluido o ausente de JCAS no entra; Unifrut en «hoy» es S/D', () => {
    expect(resumenPorRed(m, 'lluvia', 30).jcas).toMatchObject({ alDia: 3, conDato: 1, media: null });
    expect(resumenPorRed(m, 'lluvia', 'hoy').unifrut.conDato).toBe(0);
  });
  it('sin ninguna red, todo en cero y S/D', () => {
    const r = resumenPorRed(construirEstacionesClima(null, null), 'lluvia', 1);
    expect(Object.values(r).every((x) => x.alDia === 0 && x.media === null)).toBe(true);
  });
});
