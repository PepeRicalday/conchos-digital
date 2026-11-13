import { describe, expect, it } from 'vitest';
import { cuerposSinTelemetria, numeroONull, ordenarAnotaciones, puedeAnular, ultimaCaptura, validarAnotacion, type Anotacion, type BorradorAnotacion } from './anotacionesCuenca';
import type { CuerpoAgua } from './cuerposAgua';

const cuerpo = (id: string, extra: Partial<CuerpoAgua> = {}): CuerpoAgua => ({ id, etiqueta: id, namoRefMm3: 20, aqwpUbicacionId: null, ...extra } as CuerpoAgua);
const CUERPOS = [cuerpo('CA-COLINA'), cuerpo('CA-PAZCH', { namoRefMm3: 8.8 }), cuerpo('PRE-001', { aqwpUbicacionId: 536, namoRefMm3: 2846 })];
const HOY = '2026-11-13';
const base: BorradorAnotacion = { tipo: 'captura', cuerpoId: 'CA-COLINA', fecha: '2026-11-12', alm: '12.5', elev: '', origen: 'Jefe de presa, por teléfono', comentario: '' };
const anot = (x: Partial<Anotacion>): Anotacion => ({ id: 1, cuerpoId: 'CA-COLINA', tipo: 'captura', fecha: '2026-11-01', almMm3: 10, elevMsnm: null, origen: 'x', comentario: null, anulada: false, autorId: 'u1', autor: 'A', creadoEn: '2026-11-01T10:00:00Z', ...x });

describe('numeroONull', () => {
  it('vacío es sin dato, nunca 0', () => { expect(numeroONull('')).toBeNull(); expect(numeroONull('   ')).toBeNull(); });
  it('acepta separador de miles y el cero explícito', () => { expect(numeroONull('1,234.5')).toBe(1234.5); expect(numeroONull('0')).toBe(0); });
  it('texto que no es número queda como NaN', () => { expect(numeroONull('doce')).toBeNaN(); });
});

describe('validarAnotacion', () => {
  it('una captura completa produce la fila a insertar', () => {
    const r = validarAnotacion(base, CUERPOS, HOY);
    expect(r.errores).toEqual({});
    expect(r.fila).toEqual({ cuerpo_id: 'CA-COLINA', tipo: 'captura', fecha: '2026-11-12', almacenamiento_mm3: 12.5, elevacion_msnm: null, origen: 'Jefe de presa, por teléfono', comentario: null });
  });
  it('una captura sin cifra no se guarda (ni como 0)', () => {
    const r = validarAnotacion({ ...base, alm: '', elev: '' }, CUERPOS, HOY);
    expect(r.fila).toBeNull(); expect(r.errores.alm).toMatch(/sin cifra/);
  });
  it('basta la elevación', () => {
    const r = validarAnotacion({ ...base, alm: '', elev: '1,231.40' }, CUERPOS, HOY);
    expect(r.fila?.almacenamiento_mm3).toBeNull(); expect(r.fila?.elevacion_msnm).toBe(1231.4);
  });
  it('rechaza fecha futura, negativos y cifras muy por encima del NAMO', () => {
    expect(validarAnotacion({ ...base, fecha: '2026-11-14' }, CUERPOS, HOY).errores.fecha).toMatch(/futura/);
    expect(validarAnotacion({ ...base, alm: '-1' }, CUERPOS, HOY).errores.alm).toMatch(/negativo/);
    expect(validarAnotacion({ ...base, alm: '31' }, CUERPOS, HOY).errores.alm).toMatch(/NAMO/);
    expect(validarAnotacion({ ...base, alm: '30' }, CUERPOS, HOY).errores.alm).toBeUndefined();
  });
  it('la captura exige origen', () => { expect(validarAnotacion({ ...base, origen: ' ' }, CUERPOS, HOY).errores.origen).toBeDefined(); });
  it('revisión: mes a primer día, exige comentario y no guarda cifras', () => {
    const b: BorradorAnotacion = { ...base, tipo: 'revision', fecha: '2026-10', alm: '99', comentario: '' };
    expect(validarAnotacion(b, CUERPOS, HOY).errores.comentario).toBeDefined();
    const r = validarAnotacion({ ...b, comentario: 'Cotejado con el reporte de CONAGUA' }, CUERPOS, HOY);
    expect(r.fila).toMatchObject({ tipo: 'revision', fecha: '2026-10-01', almacenamiento_mm3: null, origen: null });
  });
  it('cuerpo desconocido', () => { expect(validarAnotacion({ ...base, cuerpoId: 'X' }, CUERPOS, HOY).errores.cuerpoId).toBeDefined(); });
});

describe('lectura de anotaciones', () => {
  const filas = [anot({ id: 1, fecha: '2026-11-01' }), anot({ id: 2, fecha: '2026-11-10' }), anot({ id: 3, fecha: '2026-11-12', anulada: true }), anot({ id: 4, fecha: '2026-11-12', tipo: 'sospechosa' }), anot({ id: 5, fecha: '2026-11-11', cuerpoId: 'CA-PAZCH' })];
  it('la última captura ignora anuladas, otros tipos y otros cuerpos', () => { expect(ultimaCaptura(filas, 'CA-COLINA')?.id).toBe(2); expect(ultimaCaptura(filas, 'PRE-001')).toBeNull(); });
  it('a igual fecha gana la capturada después', () => { expect(ultimaCaptura([anot({ id: 7, creadoEn: '2026-11-01T09:00:00Z' }), anot({ id: 8, creadoEn: '2026-11-01T12:00:00Z' })], 'CA-COLINA')?.id).toBe(8); });
  it('ordena vigentes por fecha y deja las anuladas al final', () => { expect(ordenarAnotaciones(filas).map((a) => a.id)).toEqual([4, 5, 2, 1, 3]); });
  it('solo los cuerpos sin telemetría admiten captura manual', () => { expect(cuerposSinTelemetria(CUERPOS).map((c) => c.id)).toEqual(['CA-COLINA', 'CA-PAZCH']); });
  it('anular: SRL todas, ACU las propias, nadie las ya anuladas', () => {
    expect(puedeAnular(filas[0], 'SRL', 'otro')).toBe(true);
    expect(puedeAnular(filas[0], 'ACU', 'u1')).toBe(true);
    expect(puedeAnular(filas[0], 'ACU', 'otro')).toBe(false);
    expect(puedeAnular(filas[0], 'INVITADO', 'u1')).toBe(false);
    expect(puedeAnular(filas[2], 'SRL', 'u1')).toBe(false);
  });
});
