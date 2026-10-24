import { describe, expect, it } from 'vitest';
import { NDVI_RANGO } from './ndviRampa';
import {
    NDVI_RANGO as RANGO_REEXPORTADO, cargarSerieNdviV2, filasDeSerie, promedioSrl, serieSpark, textoNDe, valorIndice, type FilaNdviV2Completa,
} from './ndviSerie';

const v2 = (modulo: number, mes: string, med: number | null, extra: Partial<FilaNdviV2Completa> = {}): FilaNdviV2Completa => ({
    numero_modulo: modulo, nombre_modulo: `Módulo ${modulo}`, mes, ndvi_mediana: med, ndvi_medio: med, ndvi_min: 0, ndvi_max: 0.9, ndvi_desv: 0.1,
    ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: 0.5, n_escenas: 4, pct_pixeles_validos: 0.9, muestras_validas: 100,
    kc_estimado: 0.5, superficie_ha: 1000, ventana_desde: null, ventana_hasta: null, nubosidad_max_pct: 40, ...extra,
});

describe('NDVI_RANGO', () => {
    it('es una sola constante (reexportada) con eje 0–0.8', () => {
        expect(RANGO_REEXPORTADO).toBe(NDVI_RANGO);
        expect(NDVI_RANGO).toEqual([0, 0.8]);
    });
});

describe('filasDeSerie', () => {
    it('usa la mediana como ndvi_medio y descarta los meses S/D (no los vuelve 0)', () => {
        const f = filasDeSerie([v2(1, '2026-03', 0.2, { ndvi_medio: 0.9 }), v2(1, '2026-04', null)]);
        expect(f).toHaveLength(1);
        expect(f[0].ndvi_medio).toBe(0.2);
    });
    it('delta = contra el mes calendario inmediato anterior; con hueco o salto de año es null / correcto', () => {
        const f = filasDeSerie([
            v2(1, '2025-12', 0.30), v2(1, '2026-01', 0.25), v2(1, '2026-03', 0.40), // feb falta
            v2(1, '2026-04', null), v2(1, '2026-05', 0.50), // abril S/D: mayo no salta a marzo
        ]);
        const por = Object.fromEntries(f.map((x) => [x.mes, x.delta_ndvi]));
        expect(por['2025-12']).toBeNull();
        expect(por['2026-01']).toBeCloseTo(-0.05, 9);
        expect(por['2026-03']).toBeNull();
        expect(por['2026-05']).toBeNull();
    });
    it('conserva calidad del mes (escenas, % válidos)', () => {
        const [x] = filasDeSerie([v2(2, '2026-06', 0.5, { n_escenas: 1, pct_pixeles_validos: 0.3 })]);
        expect(x.n_escenas).toBe(1);
        expect(x.pct_pixeles_validos).toBe(0.3);
    });
});

describe('promedioSrl', () => {
    it('promedia solo los módulos con dato y devuelve n de total', () => {
        const p = promedioSrl([0.2, null, 0.4, undefined, 0.3, 0.5]);
        expect(p.valor).toBeCloseTo(0.35, 9);
        expect(p.n).toBe(4);
        expect(p.total).toBe(6);
        expect(textoNDe(p)).toBe('4 de 6 módulos');
    });
    it('sin ningún dato es S/D (null), no 0', () => {
        const p = promedioSrl([null, null]);
        expect(p.valor).toBeNull();
        expect(p.n).toBe(0);
    });
});

describe('valorIndice', () => {
    const fila = { numero_modulo: 1, nombre_modulo: 'Módulo 1', ndvi_medio: 0.5, ndvi_desv: 0.1, fraccion_cobertura_activa: 0.5, superficie_ha: 100 };
    it('NDVI, ICV e IHR; sin fila es S/D', () => {
        expect(valorIndice('ndvi', fila)).toBe(0.5);
        expect(valorIndice('icv', fila)).toBe(62);
        expect(valorIndice('ihr', fila)).toBe(80);
        expect(valorIndice('ndvi', undefined)).toBeNull();
        expect(valorIndice('icv', undefined)).toBeNull();
    });
});

describe('serieSpark', () => {
    const filas = [{ numero_modulo: 1, mes: '2026-01', ndvi_medio: 0.1 }, { numero_modulo: 1, mes: '2026-03', ndvi_medio: 0.3 }];
    it('toma los últimos n meses hasta el elegido y deja null donde no hay dato', () => {
        const r = serieSpark(filas, ['2026-01', '2026-02', '2026-03', '2026-04'], '2026-03', [1, 2], 3);
        expect(r.hasta).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(r.mapa.get(1)).toEqual([0.1, null, 0.3]);
        expect(r.mapa.get(2)).toEqual([null, null, null]);
    });
});

describe('cargarSerieNdviV2', () => {
    const clienteCon = (res: { data: unknown; error: { message: string } | null }) => ({
        from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve(res) }) }) }) }),
    }) as never;
    it('normaliza numéricos y distingue error de lectura de "sin datos"', async () => {
        const ok = await cargarSerieNdviV2(clienteCon({ data: [{ numero_modulo: '1', mes: '2026-03', ndvi_mediana: '0.31', ndvi_desv: null }], error: null }));
        expect(ok.error).toBeNull();
        expect(ok.filas[0].ndvi_mediana).toBe(0.31);
        expect(ok.filas[0].ndvi_desv).toBeNull();
        const mal = await cargarSerieNdviV2(clienteCon({ data: null, error: { message: 'boom' } }));
        expect(mal.error).toBe('boom');
        expect(mal.filas).toEqual([]);
    });
});

import { CLASES_ICV, CLASES_IHR, claseIndice, luminancia } from './ndviRampa';
describe('clases discretas ICV/IHR', () => {
    it('cortes iguales a los de indicesSrl y S/D sin clase', () => {
        expect(claseIndice('icv', 24.9)?.etiqueta).toBe('Crítico');
        expect(claseIndice('icv', 25)?.etiqueta).toBe('Regular');
        expect(claseIndice('icv', 100)?.etiqueta).toBe('Óptimo');
        expect(claseIndice('ihr', 59)?.etiqueta).toBe('Irregular');
        expect(claseIndice('ihr', 80)?.etiqueta).toBe('Homogéneo');
        expect(claseIndice('ihr', null)).toBeNull();
        expect(claseIndice('icv', Number.NaN)).toBeNull();
    });
    it('rampa de una dirección: luminosidad decreciente', () => {
        for (const cl of [CLASES_ICV, CLASES_IHR]) for (let i = 1; i < cl.length; i++) expect(luminancia(cl[i].color)).toBeLessThan(luminancia(cl[i - 1].color));
    });
});

import { deltaVsResto } from './ndviSerie';
describe('deltaVsResto', () => {
    it('compara cada módulo con el promedio de los demás con dato; S/D no entra ni cuenta como 0', () => {
        const d = deltaVsResto(new Map<number, number | null>([[1, 0.3], [2, 0.5], [3, null], [4, 0.4]]));
        expect(d.get(1)?.delta).toBeCloseTo(0.3 - 0.45, 9);
        expect(d.get(1)?.nResto).toBe(2);
        expect(d.get(3)?.delta).toBeNull();
        expect(d.get(3)?.nResto).toBe(3);
    });
    it('sin otro módulo con dato no hay referencia', () => {
        expect(deltaVsResto(new Map<number, number | null>([[1, 0.3], [2, null]])).get(1)?.delta).toBeNull();
    });
});
