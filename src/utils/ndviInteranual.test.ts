import { describe, it, expect } from 'vitest';
import {
    UMBRAL_SIN_CAMBIO, anomaliaPareada, anomaliaPico, aniosDisponibles, colorAnioPrevio, lecturaAnio, climatologiaMensual, cruceAnual, esMesConfiable, resumenAnio, serieAnio, tendenciaPico,
    type FilaNdviV2, type FilaSupVol,
} from './ndviInteranual';

const f = (mes: string, v: number | null, extra: Partial<FilaNdviV2> = {}, modulo = 1): FilaNdviV2 => ({
    numero_modulo: modulo, mes, ndvi_mediana: v, ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: null,
    n_escenas: 4, pct_pixeles_validos: 1, superficie_ha: 100, ...extra,
});

const filas: FilaNdviV2[] = [
    f('2021-03', 0.2), f('2021-04', 0.3), f('2021-05', 0.4),
    f('2022-03', 0.25), f('2022-04', null), f('2022-05', 0.5),
    f('2023-03', 0.3), f('2023-04', 0.4), f('2023-05', 0.6, { n_escenas: 1 }),
    f('2021-12', 0.9), // fuera de temporada: no cuenta
    f('2021-03', 0.99, {}, 2), // otro módulo
];

describe('ndviInteranual', () => {
    it('lista años del módulo solo con meses de temporada', () => {
        expect(aniosDisponibles(filas, 1)).toEqual([2021, 2022, 2023]);
    });

    it('serie anual deja null donde no hay dato (nunca 0)', () => {
        const s = serieAnio(filas, 1, 2022);
        expect(s[0]).toBe(0.25);
        expect(s[1]).toBeNull();
        expect(s[2]).toBe(0.5);
        expect(s[3]).toBeNull();
    });

    it('resumen: pico, mes pico y meses con dato; el hueco no baja la media', () => {
        const r = resumenAnio(filas, 1, 2022);
        expect(r.pico).toBe(0.5);
        expect(r.mesPico).toBe('May');
        expect(r.mesesConDato).toBe(2);
        expect(r.media).toBeCloseTo(0.375, 6);
    });

    it('año sin datos: todo S/D', () => {
        const r = resumenAnio(filas, 1, 2019);
        expect(r.pico).toBeNull();
        expect(r.media).toBeNull();
        expect(r.mesPico).toBeNull();
        expect(r.mesesConDato).toBe(0);
    });

    it('marca meses poco confiables', () => {
        expect(resumenAnio(filas, 1, 2023).pocoConfiables).toEqual(['May']);
        expect(esMesConfiable(undefined)).toBe(false);
        expect(esMesConfiable({ n_escenas: 3, pct_pixeles_validos: 0.4 })).toBe(false);
        expect(esMesConfiable({ n_escenas: null, pct_pixeles_validos: null })).toBe(true);
    });

    it('climatología excluye el año indicado y no da banda con <3 años', () => {
        const c = climatologiaMensual(filas, 1, 2023);
        expect(c[0].media).toBeCloseTo(0.225, 6); // (0.2 + 0.25) / 2
        expect(c[0].p10).toBeNull();
        const c3 = climatologiaMensual(filas, 1);
        expect(c3[0].n).toBe(3);
        expect(c3[0].p10).not.toBeNull();
    });

    it('temporada incompleta: compara la media de los mismos meses (no un pico parcial contra picos completos)', () => {
        const a = anomaliaPico(filas, 1, 2023);
        expect(a).not.toBeNull();
        // 2023 tiene 3 meses (<6): media de mar-abr-may = 0.4333; solo 2021 tiene esos 3 meses (0.3); 2022 tiene abril S/D y no entra.
        expect(a!.promedio).toBeCloseTo(0.3, 6);
        expect(a!.n).toBe(1);
        expect(a!.abs).toBeCloseTo(0.4333333 - 0.3, 6);
        expect(anomaliaPareada(filas, 1, 2023)!.meses).toEqual(['Mar', 'Abr', 'May']);
        expect(lecturaAnio(filas, 1, 2023).texto).toContain('temporada incompleta');
    });

    it('temporada completa (≥6 meses): pico contra picos de los otros años', () => {
        const completo = (anio: number, v: number) => ['03', '04', '05', '06', '07', '08', '09'].map((m, i) => f(`${anio}-${m}`, v + 0.05 * i));
        const serie = [...completo(2021, 0.2), ...completo(2022, 0.3), ...completo(2023, 0.4)];
        const a = anomaliaPico(serie, 1, 2023);
        expect(a!.promedio).toBeCloseTo(0.55, 6); // picos 0.5 y 0.6
        expect(a!.abs).toBeCloseTo(0.15, 6); // pico 0.7
        expect(lecturaAnio(serie, 1, 2023).texto).not.toContain('incompleta');
    });

    it('UMBRAL_SIN_CAMBIO: justo por debajo es "similar", en el umbral ya es arriba/abajo', () => {
        const dos = (v: number) => [f('2021-05', 0.4), f('2022-05', 0.4), f('2023-05', v)];
        expect(lecturaAnio(dos(0.4 + UMBRAL_SIN_CAMBIO - 0.001), 1, 2023).direccion).toBe('similar');
        expect(lecturaAnio(dos(0.4 + UMBRAL_SIN_CAMBIO + 0.001), 1, 2023).direccion).toBe('arriba');
        expect(lecturaAnio(dos(0.4 - UMBRAL_SIN_CAMBIO - 0.001), 1, 2023).direccion).toBe('abajo');
    });

    it('cruce: filas con volumen/superficie nulos en todos los renglones dan null, no 0', () => {
        const sv: FilaSupVol[] = [{ anio: 2021, numero_modulo: 1, cultivo: 'Maíz', superficie_ha: null, volumen_miles_m3: null, atipico: false }];
        const c = cruceAnual(filas, sv, 1, 2021);
        expect(c.superficieHa).toBeNull();
        expect(c.volumenHm3).toBeNull();
        expect(c.laminaM3Ha).toBeNull();
        const parcial: FilaSupVol[] = [...sv, { anio: 2021, numero_modulo: 1, cultivo: 'Chile', superficie_ha: 10, volumen_miles_m3: null, atipico: false }];
        expect(cruceAnual(filas, parcial, 1, 2021).superficieHa).toBe(10);
        expect(cruceAnual(filas, parcial, 1, 2021).volumenHm3).toBeNull();
    });

    it('tendencia del pico exige 3 años', () => {
        expect(tendenciaPico(filas, 1)).not.toBeNull();
        expect(tendenciaPico(filas.filter(x => !x.mes.startsWith('2023')), 1)).toBeNull();
    });

    it('cruce: año sin informe de superficie/volumen queda null, no 0', () => {
        const sv: FilaSupVol[] = [
            { anio: 2021, numero_modulo: 1, cultivo: 'Maíz', superficie_ha: 100, volumen_miles_m3: 1000, atipico: false },
            { anio: 2021, numero_modulo: 1, cultivo: 'Chile', superficie_ha: 50, volumen_miles_m3: 500, atipico: true },
        ];
        const c21 = cruceAnual(filas, sv, 1, 2021);
        expect(c21.superficieHa).toBe(150);
        expect(c21.volumenHm3).toBeCloseTo(1.5, 6);
        expect(c21.laminaM3Ha).toBeCloseTo(10000, 6);
        expect(c21.haPorHm3).toBeCloseTo(100, 6);
        expect(c21.atipicos).toBe(1);
        const c22 = cruceAnual(filas, sv, 1, 2022);
        expect(c22.superficieHa).toBeNull();
        expect(c22.volumenHm3).toBeNull();
        expect(c22.haPorHm3).toBeNull();
        expect(c22.picoNdvi).toBe(0.5);
        const c20 = cruceAnual(filas, sv, 1, 2020);
        expect(c20.picoNdvi).toBeNull();
    });

    it('lectura en palabras: arriba, abajo, sin referencia y S/D', () => {
        const base = [f('2021-05', 0.4), f('2022-05', 0.4), f('2023-05', 0.6)];
        expect(lecturaAnio(base, 1, 2023).direccion).toBe('arriba');
        expect(lecturaAnio(base, 1, 2023).texto).toContain('por encima');
        expect(lecturaAnio(base, 1, 2021).direccion).toBe('abajo');
        expect(lecturaAnio([f('2021-05', 0.4)], 1, 2021).direccion).toBeNull();
        expect(lecturaAnio(base, 1, 2020).texto).toContain('S/D');
        expect(lecturaAnio([f('2021-05', 0.4), f('2022-05', 0.41)], 1, 2022).direccion).toBe('similar');
    });

    it('color de año previo es estable y acotado', () => {
        expect(colorAnioPrevio(0, 5)).not.toBe(colorAnioPrevio(4, 5));
        expect(colorAnioPrevio(0, 1)).toBeTruthy();
    });
});
