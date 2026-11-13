import { describe, expect, it } from 'vitest';
import { construyeAlertasCuenca, type PresaCuencaAlerta } from './alertasCuenca';
import { evaluarFuentes } from './saludFuentes';

const AHORA = Date.parse('2026-11-13T20:00:00Z');
const presa = (x: Partial<PresaCuencaAlerta>): PresaCuencaAlerta => ({ etiqueta: 'P', delDistrito: false, pct: 50, sinActualizar: false, diasIgual: null, fecha: '2026-11-13', ...x });
const fuente = (clave: string, ultimoEn: string | null, esperadoMin: number, nombre = clave) => ({ clave, grupo: 'g', nombre, ultimoEn, esperadoMin });

describe('construyeAlertasCuenca', () => {
  it('sin problemas no genera alertas', () => {
    expect(construyeAlertasCuenca({ presas: [presa({}), presa({ delDistrito: true, pct: 10 })], fuentes: evaluarFuentes([fuente('aqwp', '2026-11-13T18:30:00Z', 1560)], AHORA) })).toEqual([]);
  });
  it('presa de la cuenca (no del distrito) bajo 20 % avisa con su cifra', () => {
    const a = construyeAlertasCuenca({ presas: [presa({ etiqueta: 'Pico del Águila', pct: 12.34 })], fuentes: null });
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe('cuenca-presa-critica');
    expect(a[0].message).toContain('Pico del Águila 12.3 %');
  });
  it('las presas del distrito no se duplican aquí', () => { expect(construyeAlertasCuenca({ presas: [presa({ delDistrito: true, pct: 5 })], fuentes: null })).toEqual([]); });
  it('S/D no es crítico: sin lectura no se afirma nada', () => { expect(construyeAlertasCuenca({ presas: [presa({ pct: null })], fuentes: null })).toEqual([]); });
  it('una lectura repetida no se avisa también como nivel crítico', () => {
    const a = construyeAlertasCuenca({ presas: [presa({ etiqueta: 'Chihuahua', pct: 8, sinActualizar: true, diasIgual: 52 })], fuentes: null });
    expect(a.map((x) => x.id)).toEqual(['cuenca-lectura-repetida']);
    expect(a[0].message).toContain('Chihuahua (52 d igual)');
  });
  it('fuentes: solo las sin actualizar; las GOES se excluyen (ya tienen su alerta)', () => {
    const fs = evaluarFuentes([
      fuente('satelite', '2026-09-26T17:46:00Z', 20160, 'Sentinel-2'),
      fuente('goes:X', '2026-11-12T00:00:00Z', 90, 'Boca del Río'),
      fuente('jcas', '2026-11-13T18:00:00Z', 120, 'JCAS'),
      fuente('cila', '2026-11-13T00:00:00Z', 1560, 'CILA'), // retraso (no basta para alertar)
    ], AHORA);
    const a = construyeAlertasCuenca({ presas: [], fuentes: fs });
    expect(a).toHaveLength(1);
    expect(a[0].message).toContain('Sentinel-2 (48 d)');
    expect(a[0].message).not.toContain('Boca del Río');
  });
  it('una fuente sin ninguna lectura es S/D, no «sin actualizar»', () => {
    expect(construyeAlertasCuenca({ presas: [], fuentes: evaluarFuentes([fuente('x', null, 60)], AHORA) })).toEqual([]);
  });
  it('fuentes null (aún no se sabe) no afirma nada', () => { expect(construyeAlertasCuenca({ presas: [], fuentes: null })).toEqual([]); });
  it('cierres que difieren: solo los de los 2 últimos meses, el más reciente primero', () => {
    const a = construyeAlertasCuenca({
      presas: [], fuentes: null, ahoraMs: Date.parse('2026-11-13T20:00:00Z'),
      cierresDifieren: [{ cuerpo: 'Chihuahua', mes: '2025-02-01', difMm3: 2.1 }, { cuerpo: 'La Boquilla', mes: '2026-10-01', difMm3: 5.64 }, { cuerpo: 'Madero', mes: '2026-09-01', difMm3: 1 }, { cuerpo: 'Viejo', mes: '2026-08-01', difMm3: 9 }],
    });
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe('cuenca-cierres-difieren');
    expect(a[0].message).toContain('La Boquilla (2026-10, 5.6 Mm³), Madero (2026-09, 1.0 Mm³)');
    expect(a[0].message).not.toContain('Viejo');
    expect(a[0].message).not.toContain('Chihuahua');
  });
  it('sin cierres recientes que difieran, o sin saberlo, no hay alerta', () => {
    const h = Date.parse('2026-11-13T20:00:00Z');
    expect(construyeAlertasCuenca({ presas: [], fuentes: null, ahoraMs: h, cierresDifieren: [{ cuerpo: 'X', mes: '2025-02-01', difMm3: 3 }] })).toEqual([]);
    expect(construyeAlertasCuenca({ presas: [], fuentes: null, ahoraMs: h, cierresDifieren: null })).toEqual([]);
    expect(construyeAlertasCuenca({ presas: [], fuentes: null, cierresDifieren: [{ cuerpo: 'X', mes: '2026-10-01', difMm3: 3 }] })).toEqual([]);
  });
  it('lista larga se resume', () => {
    const ps = ['A', 'B', 'C', 'D', 'E'].map((n) => presa({ etiqueta: n, pct: 5 }));
    expect(construyeAlertasCuenca({ presas: ps, fuentes: null })[0].message).toContain('A 5.0 %, B 5.0 %, C 5.0 % y 2 más');
  });
});
