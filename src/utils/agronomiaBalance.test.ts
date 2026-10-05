import { describe, it, expect } from 'vitest';
import {
    EFICIENCIA_RODADO, KC_REFERENCIA, CULTIVOS_REFERENCIA, laminaNeta, laminaBruta, m3PorHa, lluviaEfectivaMm, laminasPorCultivo,
} from './agronomia';
import { balanceModulo, demandaDiariaM3, estadoPorCobertura, entregadoDelDia } from './balanceModulo';
import { superficieRiegoHa, numeroModuloDeId, SUPERFICIE_RIEGO_HA } from './modulosSRL';

describe('agronomia — lámina de riego (fuente única)', () => {
    it('ETc y lámina bruta con las constantes del distrito', () => {
        expect(laminaNeta(7)).toBeCloseTo(7 * KC_REFERENCIA, 6);
        expect(laminaBruta(7)).toBeCloseTo((7 * 0.85) / EFICIENCIA_RODADO, 6);
        expect(m3PorHa(laminaBruta(7))).toBeCloseTo(((7 * 0.85) / 0.7) * 10, 6);
    });

    it('sin ETₒ no hay lámina (null), nunca 0', () => {
        expect(laminaNeta(null)).toBeNull();
        expect(laminaBruta(undefined)).toBeNull();
        expect(m3PorHa(null)).toBeNull();
        expect(laminaNeta(-1)).toBeNull();
    });

    it('una ETₒ de 0 mm es una medición legítima, no un dato faltante', () => {
        expect(laminaNeta(0)).toBe(0);
        expect(laminaBruta(0)).toBe(0);
    });

    it('el maíz tiene UN solo Kc (0.75): antes 0.70 en la infografía y 0.75 en el informe', () => {
        expect(CULTIVOS_REFERENCIA.filter(c => c.nombre === 'Maíz')).toHaveLength(1);
        expect(CULTIVOS_REFERENCIA.find(c => c.nombre === 'Maíz')!.kc).toBe(0.75);
    });

    it('lámina por cultivo', () => {
        const l = laminasPorCultivo(8);
        expect(l).toHaveLength(4);
        expect(l.find(c => c.nombre === 'Alfalfa')!.brutaMm).toBeCloseTo((8 * 0.95) / 0.7, 6);
        expect(laminasPorCultivo(null).every(c => c.brutaMm === null && c.m3Ha === null)).toBe(true);
    });

    it('lluvia efectiva: 0 bajo el mínimo aprovechable, 80 % por encima, null sin dato', () => {
        expect(lluviaEfectivaMm(3)).toBe(0);
        expect(lluviaEfectivaMm(10)).toBe(8);
        expect(lluviaEfectivaMm(null)).toBeNull();
    });
});

describe('balanceModulo — demanda vs entrega', () => {
    it('demanda = ETc/eficiencia × 10 × ha', () => {
        expect(demandaDiariaM3({ etoMm: 7, haRiego: 1000 })).toBeCloseTo(((7 * 0.85) / 0.7) * 10 * 1000, 3);
    });

    it('la lluvia efectiva reduce la demanda y nunca la vuelve negativa', () => {
        const sin = demandaDiariaM3({ etoMm: 7, haRiego: 100 })!;
        const con = demandaDiariaM3({ etoMm: 7, haRiego: 100, lluviaMm: 10 })!;
        expect(con).toBeLessThan(sin);
        expect(demandaDiariaM3({ etoMm: 2, haRiego: 100, lluviaMm: 50 })).toBe(0);
    });

    it('sin ETₒ o sin hectáreas → demanda S/D', () => {
        expect(demandaDiariaM3({ etoMm: null, haRiego: 100 })).toBeNull();
        expect(demandaDiariaM3({ etoMm: 6, haRiego: null })).toBeNull();
        expect(demandaDiariaM3({ etoMm: 6, haRiego: 0 })).toBeNull();
    });

    it('clasifica déficit / equilibrio / superávit', () => {
        const base = { etoMm: 7, haRiego: 1000 };
        const dem = demandaDiariaM3(base)!;
        expect(balanceModulo({ ...base, entregadoM3: dem * 0.6 }).estado).toBe('DEFICIT');
        expect(balanceModulo({ ...base, entregadoM3: dem }).estado).toBe('EQUILIBRADO');
        expect(balanceModulo({ ...base, entregadoM3: dem * 1.4 }).estado).toBe('SUPERAVIT');
        expect(balanceModulo({ ...base, entregadoM3: dem * 0.6 }).saldoM3).toBeCloseTo(-dem * 0.4, 3);
    });

    it('sin registro de entrega (null) → S/D, no "déficit del 100 %"', () => {
        const b = balanceModulo({ etoMm: 7, haRiego: 1000, entregadoM3: null });
        expect(b.estado).toBe('SD');
        expect(b.coberturaPct).toBeNull();
        expect(b.saldoM3).toBeNull();
        expect(b.demandaM3).not.toBeNull();
    });

    it('un registro con 0 m³ sí es una entrega medida de cero (déficit real)', () => {
        const b = balanceModulo({ etoMm: 7, haRiego: 1000, entregadoM3: 0 });
        expect(b.estado).toBe('DEFICIT');
        expect(b.coberturaPct).toBe(0);
    });

    it('demanda cero (llovió) y nada entregado → cubierto', () => {
        const b = balanceModulo({ etoMm: 2, haRiego: 100, lluviaMm: 50, entregadoM3: 0 });
        expect(b.demandaM3).toBe(0);
        expect(b.coberturaPct).toBe(100);
        expect(b.estado).toBe('EQUILIBRADO');
    });

    it('estadoPorCobertura en los bordes', () => {
        expect(estadoPorCobertura(89.9)).toBe('DEFICIT');
        expect(estadoPorCobertura(90)).toBe('EQUILIBRADO');
        expect(estadoPorCobertura(110)).toBe('EQUILIBRADO');
        expect(estadoPorCobertura(110.1)).toBe('SUPERAVIT');
        expect(estadoPorCobertura(null)).toBe('SD');
    });

    it('entregadoDelDia: suma registros; sin registros es null (≠ 0)', () => {
        expect(entregadoDelDia([{ volumen_m3: '1000.5' }, { volumen_m3: 500 }])).toBe(1500.5);
        expect(entregadoDelDia([])).toBeNull();
        expect(entregadoDelDia([{ volumen_m3: null }])).toBeNull();
    });
});

describe('modulosSRL — superficie de riego', () => {
    it('superficie por módulo SRL y formato de id', () => {
        expect(superficieRiegoHa(5)).toBeCloseTo(11594.3, 1);
        expect(superficieRiegoHa(99)).toBeNull();
        expect(Object.keys(SUPERFICIE_RIEGO_HA)).toHaveLength(6);
        expect(numeroModuloDeId('MOD-005')).toBe(5);
        expect(numeroModuloDeId('MOD-012')).toBe(12);
        expect(numeroModuloDeId('otra')).toBeNull();
        expect(numeroModuloDeId(null)).toBeNull();
    });
});
