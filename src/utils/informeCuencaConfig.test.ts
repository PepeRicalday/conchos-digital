import { describe, it, expect } from 'vitest';
import {
  configCuencaPorDefecto, pasaTamano, validarConfigCuenca, avisosConfigCuenca, etiquetaAlcance, UMBRAL_GRANDES_MM3, DATOS_INFORME,
} from './informeCuencaConfig';
import { ORDEN_PRESAS_CUENCA } from './aqwpCuenca';

const NAMOS: Record<number, number | null> = { 536: 2846.78, 537: 333.318, 541: 245.431, 540: 48.276, 526: 284.382, 538: 23.383, 539: 6.528 };

describe('configCuencaPorDefecto', () => {
  it('trae las 7 presas, todos los bloques, orden de cuenca y 12 meses', () => {
    const c = configCuencaPorDefecto();
    expect(c.presas).toEqual([...ORDEN_PRESAS_CUENCA]);
    expect(c.datos).toHaveLength(DATOS_INFORME.length);
    expect(c.orden).toBe('cuenca');
    expect(c.tamano).toBe('todas');
    expect(c.meses).toBe(12);
  });
  it('devuelve copias: modificar una no altera la siguiente', () => {
    const a = configCuencaPorDefecto(); a.presas.pop(); a.datos.pop();
    const b = configCuencaPorDefecto();
    expect(b.presas).toHaveLength(7);
    expect(b.datos).toHaveLength(DATOS_INFORME.length);
  });
});

describe('pasaTamano (umbral 100 Mm³)', () => {
  it('separa las 4 grandes de las 3 pequeñas con los NAMO reales', () => {
    const grandes = Object.entries(NAMOS).filter(([, n]) => pasaTamano(n, 'grandes')).map(([id]) => Number(id)).sort();
    const chicas = Object.entries(NAMOS).filter(([, n]) => pasaTamano(n, 'pequenas')).map(([id]) => Number(id)).sort();
    expect(grandes).toEqual([526, 536, 537, 541]);
    expect(chicas).toEqual([538, 539, 540]);
  });
  it('el límite exacto cuenta como grande', () => {
    expect(pasaTamano(UMBRAL_GRANDES_MM3, 'grandes')).toBe(true);
    expect(pasaTamano(UMBRAL_GRANDES_MM3, 'pequenas')).toBe(false);
  });
  it('sin NAMO no se puede clasificar: solo entra con "todas" (no se inventa el tamaño)', () => {
    expect(pasaTamano(null, 'todas')).toBe(true);
    expect(pasaTamano(null, 'grandes')).toBe(false);
    expect(pasaTamano(null, 'pequenas')).toBe(false);
    expect(pasaTamano(0, 'pequenas')).toBe(false);
  });
});

describe('validarConfigCuenca', () => {
  it('la configuración por defecto es válida', () => expect(validarConfigCuenca(configCuencaPorDefecto(), NAMOS)).toEqual([]));
  it('sin presas: error', () => {
    expect(validarConfigCuenca({ ...configCuencaPorDefecto(), presas: [] }, NAMOS)[0]).toMatch(/al menos una presa/);
  });
  it('sin bloques de datos: error', () => {
    expect(validarConfigCuenca({ ...configCuencaPorDefecto(), datos: [] }, NAMOS).join(' ')).toMatch(/bloque de datos/);
  });
  it('presas elegidas que no pertenecen a la clase de tamaño: error (no genera un informe vacío)', () => {
    const c = { ...configCuencaPorDefecto(), presas: [538, 539], tamano: 'grandes' as const };
    expect(validarConfigCuenca(c, NAMOS).join(' ')).toMatch(/clase de tamaño/);
  });
  it('una selección compatible con el tamaño es válida', () => {
    expect(validarConfigCuenca({ ...configCuencaPorDefecto(), presas: [536, 538], tamano: 'grandes' }, NAMOS)).toEqual([]);
  });
});

describe('avisosConfigCuenca', () => {
  const base = configCuencaPorDefecto();
  it('sin filtros y con climatología: sin avisos', () => {
    expect(avisosConfigCuenca(base, { totalPresas: 7, hayClimatologia: true, incluidas: 7 })).toEqual([]);
  });
  it('avisa "N de M presas" cuando se filtra: el total no es el de toda la cuenca', () => {
    const a = avisosConfigCuenca(base, { totalPresas: 7, hayClimatologia: true, incluidas: 3 });
    expect(a.join(' ')).toMatch(/3 de 7 presas/);
    expect(a.join(' ')).toMatch(/no de toda la cuenca/);
  });
  it('avisa si se pide histórico sin climatología', () => {
    expect(avisosConfigCuenca(base, { totalPresas: 7, hayClimatologia: false, incluidas: 7 }).join(' ')).toMatch(/climatología/);
    expect(avisosConfigCuenca({ ...base, datos: ['tabla'] }, { totalPresas: 7, hayClimatologia: false, incluidas: 7 })).toEqual([]);
  });
  it('avisa de la banda comprimida con 3 meses', () => {
    expect(avisosConfigCuenca({ ...base, meses: 3 }, { totalPresas: 7, hayClimatologia: true, incluidas: 7 }).join(' ')).toMatch(/3 meses/);
  });
});

describe('etiquetaAlcance', () => {
  it('"7 de 7 presas" sin filtro de tamaño y con él cuando aplica', () => {
    expect(etiquetaAlcance(configCuencaPorDefecto(), 7, 7)).toBe('7 de 7 presas');
    expect(etiquetaAlcance({ ...configCuencaPorDefecto(), tamano: 'grandes' }, 4, 7)).toBe('4 de 7 presas · grandes');
  });
});
