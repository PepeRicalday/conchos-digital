import { describe, expect, it } from 'vitest';
import {
  cadenciaTexto, evaluarFuente, evaluarFuentes, haceTexto, lecturasSalud, normalizarFuente, resumenSalud, type FuenteSalud,
} from './saludFuentes';

const AHORA = Date.parse('2026-11-12T23:00:00Z');
const hace = (min: number) => new Date(AHORA - min * 60000).toISOString();
const f = (clave: string, ultimoEn: string | null, esperadoMin: number, extra: Partial<FuenteSalud> = {}): FuenteSalud =>
  ({ clave, grupo: 'G', nombre: clave, ultimoEn, esperadoMin, ...extra });

describe('evaluarFuente · umbrales 1.5 × y 3 × lo esperado', () => {
  it('dentro de 1.5 × es al día (incluido el límite)', () => {
    expect(evaluarFuente(f('a', hace(30), 60), AHORA).estado).toBe('al_dia');
    expect(evaluarFuente(f('a', hace(90), 60), AHORA).estado).toBe('al_dia');
  });
  it('entre 1.5 × y 3 × es retraso; pasado 3 × es sin actualizar (mismos 90 / 180 min de la red GOES)', () => {
    expect(evaluarFuente(f('a', hace(91), 60), AHORA).estado).toBe('retraso');
    expect(evaluarFuente(f('a', hace(180), 60), AHORA).estado).toBe('retraso');
    expect(evaluarFuente(f('a', hace(181), 60), AHORA).estado).toBe('sin_actualizar');
  });
  it('sin dato (null, fecha inválida o cadencia 0) es S/D y NUNCA al día', () => {
    expect(evaluarFuente(f('a', null, 60), AHORA)).toMatchObject({ estado: 'sd', edadMin: null, razon: null });
    expect(evaluarFuente(f('a', 'no-es-fecha', 60), AHORA).estado).toBe('sd');
    expect(evaluarFuente(f('a', hace(5), 0), AHORA).estado).toBe('sd');
  });
  it('un dato «del futuro» por desfase de reloj no da edad negativa', () => {
    const e = evaluarFuente(f('a', new Date(AHORA + 5 * 60000).toISOString(), 60), AHORA);
    expect(e.edadMin).toBe(0);
    expect(e.estado).toBe('al_dia');
  });
});

describe('evaluarFuentes · lo peor primero', () => {
  const ev = evaluarFuentes([
    f('ok', hace(10), 60), f('retraso', hace(120), 60), f('caida-leve', hace(200), 60), f('caida-grave', hace(1000), 60), f('sd', null, 60),
  ], AHORA);
  it('ordena sin actualizar, sin dato, retraso y al día; dentro de un estado, la más pasada primero', () => {
    expect(ev.map((x) => x.clave)).toEqual(['caida-grave', 'caida-leve', 'sd', 'retraso', 'ok']);
  });
  it('resumen: cuenta por estado y el tono sale del peor', () => {
    expect(resumenSalud(ev)).toEqual({ total: 5, alDia: 1, retraso: 1, sinActualizar: 2, sd: 1, tono: 'crit' });
    expect(resumenSalud(ev.filter((x) => x.estado === 'retraso' || x.estado === 'al_dia')).tono).toBe('warn');
    expect(resumenSalud(ev.filter((x) => x.estado === 'al_dia')).tono).toBe('ok');
    expect(resumenSalud([]).tono).toBe('sd');
  });
});

describe('normalizarFuente', () => {
  it('lleva timestamptz a ISO y deja null lo que no hay', () => {
    expect(normalizarFuente({ clave: 'x', grupo: 'G', nombre: 'X', ultimo_en: '2026-11-12 21:28:00+00', esperado_min: '60' }))
      .toEqual({ clave: 'x', grupo: 'G', nombre: 'X', ultimoEn: '2026-11-12T21:28:00.000Z', esperadoMin: 60 });
    expect(normalizarFuente({ clave: 'x', ultimo_en: null, esperado_min: 60 }).ultimoEn).toBeNull();
    expect(normalizarFuente({ clave: 'x', ultimo_en: 'basura', esperado_min: 60 }).ultimoEn).toBeNull();
  });
});

describe('textos', () => {
  it('haceTexto', () => {
    expect(haceTexto(null)).toBe('S/D');
    expect(haceTexto(0.3)).toBe('ahora');
    expect(haceTexto(45)).toBe('hace 45 min');
    expect(haceTexto(180)).toBe('hace 3 h');
    expect(haceTexto(60 * 24 * 47)).toBe('hace 47 d');
  });
  it('cadenciaTexto', () => {
    expect(cadenciaTexto(60)).toBe('cada 60 min');
    expect(cadenciaTexto(120)).toBe('cada 2 h');
    expect(cadenciaTexto(360)).toBe('cada 6 h');
    expect(cadenciaTexto(1560)).toBe('a diario');
    expect(cadenciaTexto(20160)).toBe('cada 14 d');
    expect(cadenciaTexto(0)).toBe('S/D');
  });
});

describe('lecturasSalud', () => {
  it('todo al día → una sola lectura ok', () => {
    const l = lecturasSalud(evaluarFuentes([f('a', hace(5), 60), f('b', hace(10), 60)], AHORA));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ tono: 'ok', titulo: 'Las 2 fuentes están al día' });
  });
  it('solo habla de lo que no está al día, con su edad y su cadencia', () => {
    const l = lecturasSalud(evaluarFuentes([f('a', hace(5), 60), f('b', hace(300), 60, { nombre: 'Babisas' })], AHORA));
    expect(l).toHaveLength(1);
    expect(l[0].tono).toBe('crit');
    expect(l[0].titulo).toBe('Babisas: sin actualizar');
    expect(l[0].texto).toMatch(/hace 5 h/);
    expect(l[0].texto).toMatch(/cada 60 min/);
  });
  it('una fuente sin dato lo dice sin inventar edad', () => {
    const l = lecturasSalud(evaluarFuentes([f('a', null, 60, { nombre: 'JCAS' })], AHORA));
    expect(l[0].tono).toBe('info');
    expect(l[0].texto).toMatch(/Nunca ha entregado/);
  });
  it('sin filas (la vista no respondió) no afirma que todo esté bien', () => {
    const l = lecturasSalud([]);
    expect(l[0].tono).toBe('info');
    expect(l[0].titulo).toMatch(/Sin información/);
  });
});
