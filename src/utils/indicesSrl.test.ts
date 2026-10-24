import { describe, expect, it } from 'vitest';
import { calcICV, calcIEHP, calcIHR, calculaIndicesSrl, NDVI_PISO, NDVI_TECHO, type EntradaModuloSrl } from './indicesSrl';

const base: EntradaModuloSrl = {
    numeroModulo: 1, nombreModulo: 'Módulo 1', ndviMedio: 0.5, ndviDesv: 0.1, fraccionCoberturaActiva: 0.6, superficieHa: 1000, volumenAcumuladoHm3: 10,
};
const con = (o: Partial<EntradaModuloSrl>): EntradaModuloSrl => ({ ...base, ...o });

describe('ICV', () => {
    it('sin NDVI es S/D (null), nunca 0', () => {
        const r = calcICV(con({ ndviMedio: null }));
        expect(r.valor).toBeNull();
        expect(r.etiqueta).toBe('Sin dato');
    });
    it('escala lineal con piso y techo, acotada a 0-100', () => {
        expect(calcICV(con({ ndviMedio: NDVI_PISO })).valor).toBe(0);
        expect(calcICV(con({ ndviMedio: 0.01 })).valor).toBe(0);
        expect(calcICV(con({ ndviMedio: NDVI_TECHO })).valor).toBe(100);
        expect(calcICV(con({ ndviMedio: 0.95 })).valor).toBe(100);
        expect(calcICV(con({ ndviMedio: 0.425 })).valor).toBe(50);
    });
    it('cortes de etiqueta 25 / 50 / 75 (límite inferior inclusivo)', () => {
        const ndviPara = (icv: number) => NDVI_PISO + (icv / 100) * (NDVI_TECHO - NDVI_PISO);
        // 24.9 → 25 al redondear; se prueba justo antes y justo en el corte sobre el valor redondeado.
        expect(calcICV(con({ ndviMedio: ndviPara(24) })).etiqueta).toBe('Crítico');
        expect(calcICV(con({ ndviMedio: ndviPara(25) })).etiqueta).toBe('Regular');
        expect(calcICV(con({ ndviMedio: ndviPara(49) })).etiqueta).toBe('Regular');
        expect(calcICV(con({ ndviMedio: ndviPara(50) })).etiqueta).toBe('Bueno');
        expect(calcICV(con({ ndviMedio: ndviPara(74) })).etiqueta).toBe('Bueno');
        expect(calcICV(con({ ndviMedio: ndviPara(75) })).etiqueta).toBe('Óptimo');
    });
});

describe('IHR', () => {
    it('S/D si falta NDVI o desviación', () => {
        expect(calcIHR(con({ ndviMedio: null })).valor).toBeNull();
        expect(calcIHR(con({ ndviDesv: null })).valor).toBeNull();
    });
    it('NDVI <= 0.05 no permite evaluar dispersión relativa (S/D con motivo)', () => {
        const r = calcIHR(con({ ndviMedio: 0.05, ndviDesv: 0.01 }));
        expect(r.valor).toBeNull();
        expect(r.implicacion).toMatch(/insuficiente/);
        expect(calcIHR(con({ ndviMedio: 0.051, ndviDesv: 0.0051 })).valor).toBe(90);
    });
    it('100 × (1 − desv/NDVI), acotado a 0-100', () => {
        expect(calcIHR(con({ ndviMedio: 0.5, ndviDesv: 0.1 })).valor).toBe(80);
        expect(calcIHR(con({ ndviMedio: 0.5, ndviDesv: 0.9 })).valor).toBe(0);
        expect(calcIHR(con({ ndviMedio: 0.5, ndviDesv: 0 })).valor).toBe(100);
    });
    it('cortes de etiqueta 40 / 60 / 80', () => {
        const para = (ihr: number) => con({ ndviMedio: 0.5, ndviDesv: 0.5 * (1 - ihr / 100) });
        expect(calcIHR(para(39)).etiqueta).toBe('Muy irregular');
        expect(calcIHR(para(40)).etiqueta).toBe('Irregular');
        expect(calcIHR(para(59)).etiqueta).toBe('Irregular');
        expect(calcIHR(para(60)).etiqueta).toBe('Aceptable');
        expect(calcIHR(para(79)).etiqueta).toBe('Aceptable');
        expect(calcIHR(para(80)).etiqueta).toBe('Homogéneo');
    });
});

describe('IEHP', () => {
    it('hectáreas activas / hm³ acumulado', () => {
        const r = calcIEHP(con({ superficieHa: 1000, fraccionCoberturaActiva: 0.6, volumenAcumuladoHm3: 10 }));
        expect(r.valor).toBe(60);
        expect(r.etiqueta).toBe('600 ha activas');
    });
    it('sin superficie o sin cobertura es S/D', () => {
        expect(calcIEHP(con({ superficieHa: null })).valor).toBeNull();
        expect(calcIEHP(con({ fraccionCoberturaActiva: null })).valor).toBeNull();
    });
    it('sin volumen (null o 0) es "Sin volumen", nunca un número', () => {
        for (const v of [null, 0]) {
            const r = calcIEHP(con({ volumenAcumuladoHm3: v }));
            expect(r.valor).toBeNull();
            expect(r.etiqueta).toBe('Sin volumen');
        }
    });
});

describe('calculaIndicesSrl', () => {
    it('devuelve ICV, IHR e IEHP en ese orden', () => {
        expect(calculaIndicesSrl(base).map((i) => i.clave)).toEqual(['ICV', 'IHR', 'IEHP']);
    });
});
