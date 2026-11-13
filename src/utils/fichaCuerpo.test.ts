import { describe, expect, it } from 'vitest';
import { fichaCuerpo, type DatosFicha } from './fichaCuerpo';
import type { BalanceMensual, CierreMensual, CuerpoAgua } from './cuerposAgua';
import type { Anotacion } from './anotacionesCuenca';

const cuerpo = (x: Partial<CuerpoAgua>): CuerpoAgua => ({ id: 'A', etiqueta: 'A', idSerie: 'A', aqwpUbicacionId: null, aguasAbajoId: null, ...x } as CuerpoAgua);
const cierre = (x: Partial<CierreMensual>): CierreMensual => ({ cuerpoId: 'A', mes: '2026-10-01', almMm3: 10, pctNamo: 50, calidad: 'OK', fuenteAlm: 'SINA', detalle: {}, ...x } as CierreMensual);
const base = (x: Partial<DatosFicha> = {}): DatosFicha => ({ cuerpos: [cuerpo({}), cuerpo({ id: 'B', etiqueta: 'Río abajo', idSerie: 'B' })], cierres: [], balances: [], escenas: new Map(), huellas: new Map(), ...x });

describe('fichaCuerpo', () => {
  it('cuerpo inexistente: null', () => { expect(fichaCuerpo(base(), 'Z', undefined, [])).toBeNull(); });
  it('sin ningún dato: todo S/D, nada en cero', () => {
    const f = fichaCuerpo(base(), 'A', undefined, []);
    expect(f).toMatchObject({ hoy: null, ultimoCierre: null, satelite: null, balance: null, captura: null, cobertura: { conDato: 0, total: 0 } });
  });
  it('telemetría sin lectura del día: hoy existe pero vacío (S/D)', () => {
    expect(fichaCuerpo(base({ cuerpos: [cuerpo({ aqwpUbicacionId: 536 })] }), 'A', undefined, [])?.hoy).toEqual({ almMm3: null, pct: null, fecha: null });
  });
  it('el último cierre es el último con cifra y declara las fuentes y si está vencido', () => {
    const d = base({
      cuerpos: [cuerpo({}), cuerpo({ id: 'B', idSerie: 'B' })],
      cierres: [cierre({ mes: '2025-03-01', almMm3: 7 }), cierre({ mes: '2025-04-01', almMm3: null, calidad: 'SD' }), cierre({ cuerpoId: 'B', mes: '2026-10-01' })],
    });
    const f = fichaCuerpo(d, 'A', undefined, [])!;
    expect(f.ultimoCierre).toMatchObject({ mes: '2025-03-01', almMm3: 7, vencido: true });
    expect(f.cobertura).toEqual({ conDato: 1, total: 2 });
    expect(fichaCuerpo(d, 'B', undefined, [])!.ultimoCierre?.vencido).toBe(false);
  });
  it('lista cada fuente con dato del cierre', () => {
    const c = cierre({ detalle: { srl: { fecha: 'x', almacenamiento: 5 }, sina: { fecha: 'x', almacenamiento: 5.2 } } as never });
    expect(fichaCuerpo(base({ cierres: [c] }), 'A', undefined, [])!.ultimoCierre?.fuentes).toEqual([{ fuente: 'Reporte SRL/CILA', almMm3: 5 }, { fuente: 'SINA CONAGUA', almMm3: 5.2 }]);
  });
  it('satélite: espejo contra huella máxima', () => {
    const d = base({ escenas: new Map([['A', [{ fecha: '2026-09-01', areaKm2: 5, incertidumbreKm2: 0.1, separacionDebil: false }, { fecha: '2026-09-26', areaKm2: 4, incertidumbreKm2: 0.1, separacionDebil: false }]]]), huellas: new Map([['A', { areaKm2: 16 }]]) });
    expect(fichaCuerpo(d, 'A', undefined, [])!.satelite).toMatchObject({ llenadoPct: 25, escenas: 2, escena: { fecha: '2026-09-26' } });
  });
  it('satélite sin huella: el porcentaje es S/D, no 0', () => {
    const d = base({ escenas: new Map([['A', [{ fecha: '2026-09-26', areaKm2: 4, incertidumbreKm2: null, separacionDebil: false }]]]) });
    expect(fichaCuerpo(d, 'A', undefined, [])!.satelite?.llenadoPct).toBeNull();
  });
  it('balance: solo meses completos (OK), el más reciente', () => {
    const b = (mes: string, calidad: BalanceMensual['calidad'], entradas: number) => ({ cuerpoId: 'A', mes, calidad, entradas, salidaTotal: 1, evap: null, residuo: 0.1 } as BalanceMensual);
    const f = fichaCuerpo(base({ balances: [b('2026-08-01', 'OK', 3), b('2026-09-01', 'OK', 4), b('2026-10-01', 'PARCIAL', 9)] }), 'A', undefined, [])!;
    expect(f.balance).toMatchObject({ mes: '2026-09-01', entradas: 4, evap: null });
  });
  it('captura manual: la vigente más reciente', () => {
    const a = (id: number, fecha: string, anulada = false): Anotacion => ({ id, cuerpoId: 'A', tipo: 'captura', fecha, almMm3: 1, elevMsnm: null, origen: 'x', comentario: null, anulada, autorId: null, autor: null, creadoEn: '2026-11-01T00:00:00Z' });
    expect(fichaCuerpo(base(), 'A', undefined, [a(1, '2026-11-01'), a(2, '2026-11-10', true), a(3, '2026-11-05')])!.captura?.id).toBe(3);
  });
});
