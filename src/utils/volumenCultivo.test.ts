import { describe, expect, it } from 'vitest';
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import {
    contrasteRegimenes, esAlfalfaNogal, kpiCiclo, kpiLamina, kpiMezcla, laminaCm, laminaPorCultivo, listaAtipicos, matrizModuloAnio, mezclaCultivos, referenciaCicloActual,
    type ReferenciaModulo,
} from './volumenCultivo';

const f = (anio: number, modulo: number, cultivo: string, ha: number | null, miles: number | null, atipico = false): FilaSupVol =>
    ({ anio, numero_modulo: modulo, cultivo, superficie_ha: ha, volumen_miles_m3: miles, atipico });

// Alfalfa real del distrito (ACUM_INF): 2024 = 6 086 ha y 111.57 hm³ → 183 cm.
const FILAS: FilaSupVol[] = [
    f(2020, 1, 'Alfalfa', 3000, 40000), f(2020, 1, 'Nogal', 1400, 18000),
    f(2021, 1, 'Alfalfa', 1500, 9000), f(2021, 1, 'Nogal', 1400, 9900),
    f(2022, 1, 'Alfalfa', 1800, 14000), f(2022, 1, 'Nogal', 1500, 13000),
    f(2023, 1, 'Alfalfa', 3200, 38000), f(2023, 1, 'Nogal', 1600, 19000),
    f(2024, 1, 'Alfalfa', 1700, 20000), f(2024, 1, 'Nogal', 1500, 13000),
    f(2024, 1, 'Sorgo', 9, 0), f(2024, 2, 'Alfalfa', 100, 1500),
];

describe('laminaCm', () => {
    it('miles de m³ / ha × 10 = cm', () => {
        expect(laminaCm(111570, 6086)).toBeCloseTo(183.3, 1);
    });
    it('S/D y superficie 0 devuelven null, nunca 0', () => {
        expect(laminaCm(null, 100)).toBeNull();
        expect(laminaCm(100, null)).toBeNull();
        expect(laminaCm(100, 0)).toBeNull();
    });
});

describe('laminaPorCultivo', () => {
    it('suma módulos cuando modulo es null y ordena por volumen', () => {
        const r = laminaPorCultivo(FILAS, null);
        expect(r[0].cultivo).toBe('Alfalfa');
        const c24 = r[0].celdas.find(c => c.anio === 2024)!;
        expect(c24.superficieHa).toBe(1800);
        expect(c24.volumenHm3).toBeCloseTo(21.5, 5);
    });
    it('muestra chica (<50 ha) se marca y no entra a la media', () => {
        const sorgo = laminaPorCultivo(FILAS, 1).find(s => s.cultivo === 'Sorgo')!;
        expect(sorgo.celdas[0].muestraChica).toBe(true);
        expect(sorgo.mediaLaminaCm).toBeNull();
    });
    it('marca la lámina que se aleja de los demás años', () => {
        const filas = [2020, 2021, 2022, 2023].map(a => f(a, 1, 'Maíz', 1000, 10000)).concat([f(2024, 1, 'Maíz', 1000, 25000), f(2019, 1, 'Maíz', 1000, 10200)]);
        const m = laminaPorCultivo(filas, 1)[0];
        expect(m.celdas.find(c => c.anio === 2024)!.laminaAtipica).toBe(true);
        expect(m.celdas.find(c => c.anio === 2020)!.laminaAtipica).toBe(false);
    });
    it('conserva la bandera atípica de la fuente', () => {
        const r = laminaPorCultivo([f(2021, 1, 'Chile', 200, 3000, true)], 1);
        expect(r[0].celdas[0].atipicoFuente).toBe(true);
    });
});

describe('mezclaCultivos', () => {
    it('los porcentajes suman 100 y se ordenan por volumen', () => {
        const r = mezclaCultivos(FILAS, 1, 2020);
        expect(r.map(x => x.cultivo)).toEqual(['Alfalfa', 'Nogal']);
        expect(r.reduce((a, x) => a + (x.pctVolumen ?? 0), 0)).toBeCloseTo(100, 6);
        expect(r[0].pctSuperficie).toBeCloseTo((3000 / 4400) * 100, 6);
    });
    it('año sin renglones → lista vacía', () => {
        expect(mezclaCultivos(FILAS, 1, 2019)).toEqual([]);
    });
});

describe('contrasteRegimenes', () => {
    it('separa 2020 y 2023 (altos) de 2021, 2022 y 2024 (bajos)', () => {
        const c = contrasteRegimenes(FILAS.filter(x => x.numero_modulo === 1 && x.cultivo !== 'Sorgo'), 1)!;
        expect(c.altos).toEqual([2020, 2023]);
        expect(c.bajos).toEqual([2021, 2022, 2024]);
        expect(c.cultivos.length).toBe(2);
    });
    it('sin contraste claro o con pocos años devuelve null', () => {
        const plano = [2020, 2021, 2022, 2023].map(a => f(a, 1, 'Maíz', 1000, 10000));
        expect(contrasteRegimenes(plano, 1)).toBeNull();
        expect(contrasteRegimenes(FILAS.filter(x => x.anio < 2022), 1)).toBeNull();
    });
});

describe('referenciaCicloActual', () => {
    const base = FILAS.filter(x => x.cultivo !== 'Sorgo');
    const act = (v: number | undefined, meses = 7, parciales: string[] = [], error: string | null = null): VolumenActual => ({
        porModulo: new Map(v == null ? [] : [[1, v]]), mesesPorModulo: new Map([[1, meses]]), mesesParciales: parciales, error,
    });
    it('rango y posición', () => {
        const r = referenciaCicloActual(base, act(50), [1])[0];
        expect(r.minHm3).toBeCloseTo(18.9, 5);
        expect(r.maxHm3).toBeCloseTo(58, 5);
        expect(r.posicion).toBe('dentro');
        expect(referenciaCicloActual(base, act(10), [1])[0].posicion).toBe('bajo-rango');
        expect(referenciaCicloActual(base, act(90), [1])[0].posicion).toBe('sobre-rango');
    });
    it('sin volumen o con error → sin-dato (no 0)', () => {
        expect(referenciaCicloActual(base, act(undefined), [1])[0].actualHm3).toBeNull();
        expect(referenciaCicloActual(base, act(50, 7, [], 'caída'), [1])[0].posicion).toBe('sin-dato');
        expect(referenciaCicloActual(base, null, [1])[0].posicion).toBe('sin-dato');
    });
    it('meses faltantes o parciales marcan incompleto', () => {
        expect(referenciaCicloActual(base, act(50, 6), [1])[0].actualIncompleto).toBe(true);
        expect(referenciaCicloActual(base, act(50, 7, ['2026-09']), [1])[0].actualIncompleto).toBe(true);
        expect(referenciaCicloActual(base, act(50), [1])[0].actualIncompleto).toBe(false);
    });
});

describe('kpiLamina', () => {
    it('lámina media del último año = volumen ÷ superficie del año; mayor lámina entre cultivos con muestra firme', () => {
        const k = kpiLamina(FILAS, null);
        expect(k.anio).toBe(2024);
        // 2024: Alfalfa 1800 ha / 21500 + Nogal 1500 / 13000 + Sorgo 9 / 0 → 34500 / 3309 × 10
        expect(k.laminaMediaCm).toBeCloseTo((34500 / 3309) * 10, 6);
        expect(k.cultivoMayor?.cultivo).toBe('Alfalfa');
        expect(k.cultivoMayor?.laminaCm).toBeCloseTo((21500 / 1800) * 10, 6);
    });
    it('cuenta las alertas igual que la tabla (⚠) y no cuenta celdas S/D', () => {
        const k = kpiLamina(FILAS, null);
        expect(k.alertas).toBeGreaterThanOrEqual(1); // Sorgo 9 ha = muestra chica
        expect(k.alertas).toBeLessThanOrEqual(k.celdas);
    });
    it('sin renglones → todo null, nunca 0', () => {
        const k = kpiLamina([], null);
        expect(k.anio).toBeNull();
        expect(k.laminaMediaCm).toBeNull();
        expect(k.cultivoMayor).toBeNull();
    });
    it('el cultivo de muestra chica no gana el máximo', () => {
        const k = kpiLamina([f(2024, 1, 'Maíz', 1000, 10000), f(2024, 1, 'Sandía', 5, 900)], null);
        expect(k.cultivoMayor?.cultivo).toBe('Maíz');
    });
});

describe('kpiMezcla', () => {
    it('reconoce alfalfa y nogal sin importar acentos ni mayúsculas', () => {
        expect(esAlfalfaNogal('Alfalfa')).toBe(true);
        expect(esAlfalfaNogal('NOGAL')).toBe(true);
        expect(esAlfalfaNogal('Algodón')).toBe(false);
    });
    it('% de volumen de alfalfa+nogal, superficie total y años altos contra bajos', () => {
        const base = FILAS.filter(x => x.numero_modulo === 1 && x.cultivo !== 'Sorgo');
        const k = kpiMezcla(base, 1, 2020);
        expect(k.pctVolumenAlfalfaNogal).toBeCloseTo(100, 6);
        expect(k.superficieTotalHa).toBe(4400);
        expect(k.altosVsBajos?.altos).toEqual([2020, 2023]);
        expect(k.altosVsBajos?.altosHa).toBeCloseTo((4400 + 4800) / 2, 6);
        expect(k.altosVsBajos?.bajosHa).toBeCloseTo((2900 + 3300 + 3200) / 3, 6);
        expect(k.altosVsBajos?.veces).toBeGreaterThan(1.4);
    });
    it('con otro cultivo el porcentaje baja; sin año devuelve null', () => {
        const k = kpiMezcla([f(2024, 1, 'Alfalfa', 100, 6000), f(2024, 1, 'Maíz', 100, 4000)], 1, 2024);
        expect(k.pctVolumenAlfalfaNogal).toBeCloseTo(60, 6);
        expect(k.altosVsBajos).toBeNull();
        const n = kpiMezcla(FILAS, null, null);
        expect(n.pctVolumenAlfalfaNogal).toBeNull();
        expect(n.superficieTotalHa).toBeNull();
    });
    it('año sin renglones → null, no 0', () => {
        const k = kpiMezcla(FILAS, null, 2019);
        expect(k.pctVolumenAlfalfaNogal).toBeNull();
        expect(k.superficieTotalHa).toBeNull();
    });
});

describe('kpiCiclo', () => {
    const ref = (modulo: number, posicion: ReferenciaModulo['posicion'], actualHm3: number | null, medianaHm3: number | null, actualIncompleto = false): ReferenciaModulo => ({
        modulo, historico: [], minHm3: 1, maxHm3: 100, medianaHm3, actualHm3, actualIncompleto, posicion,
        pctVsMediana: actualHm3 != null && medianaHm3 ? ((actualHm3 - medianaHm3) / medianaHm3) * 100 : null,
    });
    it('cuenta posiciones y compara el volumen contra la mediana de los mismos módulos', () => {
        const k = kpiCiclo([ref(1, 'dentro', 50, 40), ref(2, 'sobre-rango', 120, 80), ref(3, 'bajo-rango', 5, 20), ref(4, 'sin-dato', null, 30)]);
        expect([k.dentro, k.sobre, k.bajo, k.sinDato]).toEqual([1, 1, 1, 1]);
        expect(k.actualHm3).toBe(175);
        expect(k.medianaHm3).toBe(140); // el módulo 4 (sin actual) no entra a la mediana
        expect(k.pctVsMediana).toBeCloseTo(25, 6);
        expect(k.modulosConDato).toBe(3);
        expect(k.modulosTotal).toBe(4);
    });
    it('sin ningún dato actual → null y no 0', () => {
        const k = kpiCiclo([ref(1, 'sin-dato', null, 40), ref(2, 'sin-dato', null, 80)]);
        expect(k.actualHm3).toBeNull();
        expect(k.medianaHm3).toBeNull();
        expect(k.pctVsMediana).toBeNull();
        expect(k.sinDato).toBe(2);
    });
    it('si a un módulo con actual le falta la mediana no se compara; cuenta incompletos', () => {
        const k = kpiCiclo([ref(1, 'dentro', 50, 40, true), ref(2, 'dentro', 10, null)]);
        expect(k.actualHm3).toBe(60);
        expect(k.medianaHm3).toBeNull();
        expect(k.pctVsMediana).toBeNull();
        expect(k.incompletos).toBe(1);
    });
});

describe('listaAtipicos', () => {
    it('lista cada celda con motivo, con su motivo, ordenada por año', () => {
        const l = listaAtipicos([f(2022, 1, 'Chile', 200, 3000, true), f(2021, 1, 'Sorgo', 9, 100), f(2021, 1, 'Maíz', 1000, 10000)]);
        expect(l.map(x => `${x.anio}-${x.cultivo}`)).toEqual(['2021-Sorgo', '2022-Chile']);
        expect(l[1].motivos).toContain('captura atípica en el informe fuente');
        expect(l[0].motivos[0]).toMatch(/menor a 50 ha/);
    });
});

describe('matrizModuloAnio', () => {
    it('lámina media por módulo y año; módulo sin renglones del año → null', () => {
        const m = matrizModuloAnio(FILAS, [1, 3]);
        const c = m[0].celdas.find(x => x.anio === 2020)!;
        expect(c.superficieHa).toBe(4400);
        expect(c.laminaCm).toBeCloseTo((58000 / 4400) * 10, 6);
        expect(m[1].celdas.every(x => x.laminaCm === null && x.superficieHa === null)).toBe(true);
    });
});
