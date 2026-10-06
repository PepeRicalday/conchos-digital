import { describe, it, expect } from 'vitest';
import { volumenCiclo, avanceDistrito, caudalModulo, rangoKmModulo, resumenTomas, mensajeMapaVacio, posicionKm } from './distribucion';

describe('volumen del ciclo por módulo', () => {
  it('sin volumen autorizado → null (antes dividía entre 1 y mostraba 0.00 disponibles)', () => {
    expect(volumenCiclo({ accumulated_vol: 30.15, authorized_vol: 0 })).toEqual({ consumidoMm3: 30.15, autorizadoMm3: null, disponibleMm3: null, pct: null });
    expect(volumenCiclo({ accumulated_vol: 5, authorized_vol: Number.NaN }).pct).toBeNull();
  });
  it('con autorizado: disponible y % (el sobregiro no se trunca)', () => {
    const v = volumenCiclo({ accumulated_vol: 34, authorized_vol: 40 });
    expect(v.disponibleMm3).toBe(6);
    expect(v.pct).toBeCloseTo(85, 6);
    const s = volumenCiclo({ accumulated_vol: 50, authorized_vol: 40 });
    expect(s.disponibleMm3).toBe(0);
    expect(s.pct).toBeCloseTo(125, 6);
  });
});

describe('avance del ciclo del distrito', () => {
  it('solo cuentan módulos con autorizado', () => {
    const r = avanceDistrito([{ accumulated_vol: 30, authorized_vol: 40 }, { accumulated_vol: 10, authorized_vol: 0 }, { accumulated_vol: 20, authorized_vol: 40 }]);
    expect(r).toMatchObject({ acumuladoMm3: 50, autorizadoMm3: 80, modulosConAutorizado: 2, modulosTotal: 3 });
    expect(r.pct).toBeCloseTo(62.5, 6);
  });
  it('ninguno con autorizado → todo null', () => {
    expect(avanceDistrito([{ accumulated_vol: 3, authorized_vol: 0 }])).toMatchObject({ acumuladoMm3: null, autorizadoMm3: null, pct: null, modulosConAutorizado: 0 });
    expect(avanceDistrito([]).pct).toBeNull();
  });
});

describe('caudal por módulo', () => {
  it('sin caudal objetivo → % null (antes el gauge usaba 1000 L/s para todos)', () => {
    const c = caudalModulo({ current_flow: 0.15, target_flow: 0 });
    expect(c).toMatchObject({ objetivoLps: null, pctObjetivo: null, operando: true });
    expect(c.lps).toBeCloseTo(150, 6);
  });
  it('con objetivo: % del objetivo, sin truncar', () => {
    const c = caudalModulo({ current_flow: 0.7, target_flow: 0.5 });
    expect(c.pctObjetivo).toBeCloseTo(140, 6);
    expect(caudalModulo({ current_flow: 0.05, target_flow: 0.5 }).operando).toBe(false);
  });
});

describe('tramo del módulo, tomas y mapa', () => {
  it('rango de km desde las tomas del módulo; sin tomas → null', () => {
    expect(rangoKmModulo({ delivery_points: [{ km: 12 }, { km: 3.5 }, { km: 40 }] })).toEqual([3.5, 40]);
    expect(rangoKmModulo({ delivery_points: [] })).toBeNull();
  });
  it('mensaje de mapa vacío explica la causa', () => {
    const r = resumenTomas(Array.from({ length: 177 }, () => ({ isCaptured: false, isOpen: false })));
    expect(r).toEqual({ total: 177, conCaptura: 0, abiertas: 0 });
    expect(mensajeMapaVacio(r, true)).toContain('0 de 177 tomas con captura hoy');
    expect(mensajeMapaVacio({ total: 177, conCaptura: 2, abiertas: 1 }, true)).toBeNull();
    expect(mensajeMapaVacio({ total: 0, conCaptura: 0, abiertas: 0 }, true)).toContain('No hay tomas');
  });
  it('posición de un km en el tramo; fuera de rango → null', () => {
    expect(posicionKm(52, 0, 104)).toBe(50);
    expect(posicionKm(10, 20, 40)).toBeNull();
    expect(posicionKm(10, 5, 5)).toBeNull();
  });
});
