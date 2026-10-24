import { describe, expect, it } from 'vitest';
import {
    MESES_CORTOS, MODULOS_GRAFICA, SIMBOLO_MODULO, mesesPromedioIncompleto, opcionGraficaPrincipal, promedioSrlAnio, seriesDeGrafica, serieAnio12,
    titularAnio, ultimoIdxMedido, type FilaMensual, type ParamsGrafica,
} from './ndviGrafica';
import type { FilaNdviV2 } from './ndviInteranual';

const filas: FilaMensual[] = [
    { numero_modulo: 1, mes: '2026-03', ndvi_medio: 0.2 }, { numero_modulo: 1, mes: '2026-05', ndvi_medio: 0.4 },
    { numero_modulo: 2, mes: '2026-03', ndvi_medio: 0.3 },
];
const base: ParamsGrafica = { vista: 'anio', anio: 2026, modulo: 1, filas, aniosDisponibles: [2025, 2026], ultimoMesSerie: '2026-05', angosto: false, reducirMovimiento: false };

describe('serieAnio12', () => {
    it('devuelve 12 posiciones con null (S/D) donde no hay lectura, nunca 0', () => {
        const s = serieAnio12(filas, 1, 2026);
        expect(s).toHaveLength(12);
        expect(s[2]).toBe(0.2); expect(s[3]).toBeNull(); expect(s[4]).toBe(0.4); expect(s[5]).toBeNull();
        expect(s.includes(0)).toBe(false);
    });
});

describe('promedio SRL por mes', () => {
    it('promedia solo los módulos con dato y da n de 6; sin ninguno es null', () => {
        const p = promedioSrlAnio(filas, MODULOS_GRAFICA, 2026);
        expect(p[2].valor).toBeCloseTo(0.25, 9); expect(p[2].n).toBe(2); expect(p[2].total).toBe(6);
        expect(p[3].valor).toBeNull(); expect(p[3].n).toBe(0);
    });
    it('avisa los meses con promedio incompleto, sin contar los vacíos', () => {
        expect(mesesPromedioIncompleto(filas, 2026, 4)).toEqual([{ mes: 'Mar', n: 2, total: 6 }, { mes: 'May', n: 1, total: 6 }]);
    });
});

describe('ultimoIdxMedido', () => {
    it('meses posteriores a la última lectura son "sin medir"; años anteriores completos', () => {
        expect(ultimoIdxMedido(2026, '2026-09')).toBe(8);
        expect(ultimoIdxMedido(2025, '2026-09')).toBe(11);
        expect(ultimoIdxMedido(2027, '2026-09')).toBe(-1);
    });
});

describe('opcionGraficaPrincipal', () => {
    it('S/D como hueco, aria activo, tooltip confinado, línea 0.30 y bandas de clases', () => {
        const o = opcionGraficaPrincipal(base) as any;
        expect(o.aria.enabled).toBe(true);
        expect(o.tooltip.confine).toBe(true);
        expect(o.tooltip.valueFormatter(null)).toBe('S/D');
        expect(o.tooltip.valueFormatter(0.33)).toBe('0.330');
        const lineas = o.series.filter((s: any) => s.name !== '_marcas');
        expect(lineas.every((s: any) => s.connectNulls === false)).toBe(true);
        expect(lineas.map((s: any) => s.name)).toEqual(['Módulo 1', 'Módulo 2', 'Módulo 3', 'Módulo 4', 'Módulo 5', 'Módulo 12', 'Promedio SRL']);
        const marcas = o.series.find((s: any) => s.name === '_marcas');
        expect(marcas.markLine.data[0].yAxis).toBe(0.3);
        expect(marcas.markArea.data.length).toBeGreaterThanOrEqual(5);
        expect(o.legend.data).not.toContain('_marcas');
    });
    it('cada módulo tiene símbolo propio (identidad sin color) y el promedio es punteado', () => {
        expect(new Set(Object.values(SIMBOLO_MODULO)).size).toBe(6);
        const o = opcionGraficaPrincipal(base) as any;
        expect(o.series.find((s: any) => s.name === 'Promedio SRL').lineStyle.type).toBe('dashed');
    });
    it('vista comparar: una serie por año y el año foco destacado', () => {
        const o = opcionGraficaPrincipal({ ...base, vista: 'comparar', modulo: 0 }) as any;
        const l = o.series.filter((s: any) => s.name !== '_marcas');
        expect(l.map((s: any) => s.name)).toEqual(['2025', '2026']);
        expect(l[1].lineStyle.width).toBeGreaterThan(l[0].lineStyle.width);
        expect(seriesDeGrafica({ ...base, vista: 'comparar', modulo: 1 })[1].valores[2]).toBe(0.2);
    });
    it('en angosto no dibuja etiquetas finales', () => {
        const o = opcionGraficaPrincipal({ ...base, angosto: true }) as any;
        expect(o.series[0].endLabel.show).toBe(false);
        expect(MESES_CORTOS).toHaveLength(12);
    });
});

describe('titularAnio', () => {
    const v2 = (m: number, mes: string, v: number): FilaNdviV2 => ({ numero_modulo: m, mes, ndvi_mediana: v, ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: null, n_escenas: 4, pct_pixeles_validos: 0.9, superficie_ha: 1 });
    it('describe sin afirmar causa y da el promedio SRL de las diferencias', () => {
        const d: FilaNdviV2[] = [];
        for (const a of [2021, 2022, 2023, 2024]) for (const m of ['03', '04', '05', '06', '07', '08', '09']) d.push(v2(1, `${a}-${m}`, 0.5), v2(2, `${a}-${m}`, 0.5));
        for (const m of ['03', '04', '05', '06', '07', '08', '09']) d.push(v2(1, `2026-${m}`, 0.4), v2(2, `2026-${m}`, 0.4));
        const t = titularAnio(d, [1, 2], 2026)!;
        expect(t.abajo).toBe(2);
        expect(t.promedioAbs).toBeCloseTo(-0.1, 9);
        expect(t.texto).toBe('2026 por debajo de lo habitual en los 2 módulos (−0.100 promedio SRL)');
        expect(t.texto).not.toMatch(/porque|debido|causa/i);
    });
    it('sin referencia es null', () => { expect(titularAnio([], [1], 2026)).toBeNull(); });
});

import { bandaMensual12, serieIndice12 } from './ndviGrafica';
describe('bandaMensual12', () => {
    const f = (a: number, v: number): FilaMensual => ({ numero_modulo: 1, mes: `${a}-05`, ndvi_medio: v });
    it('sin 3 otros años no hay banda; con 3 sí, y excluye el año foco', () => {
        const dos = bandaMensual12([f(2021, 0.2), f(2022, 0.3), f(2026, 0.9)], 1, [2021, 2022, 2026], 2026);
        expect(dos[4].p10).toBeNull(); expect(dos[4].media).toBeCloseTo(0.25, 9);
        const tres = bandaMensual12([f(2021, 0.2), f(2022, 0.3), f(2023, 0.4), f(2026, 0.9)], 1, [2021, 2022, 2023, 2026], 2026);
        expect(tres[4].p10).not.toBeNull(); expect(tres[4].p90).toBeLessThanOrEqual(0.4);
        expect(tres[0].media).toBeNull(); // mes sin datos de otros años: S/D, no 0
    });
});
describe('serieIndice12', () => {
    it('ICV por mes con S/D donde no hay fila', () => {
        const fila = { numero_modulo: 1, nombre_modulo: 'M1', mes: '2026-03', ndvi_medio: 0.425, ndvi_desv: 0.1, fraccion_cobertura_activa: 0.5, superficie_ha: 10 };
        const s = serieIndice12([fila], 'icv', 2026);
        expect(s[2]).toBe(50); expect(s[3]).toBeNull();
    });
});

import { ejeMeses, titularDeAnomalias } from './ndviGrafica';
describe('ejeMeses y titular con mayúscula', () => {
    it('en angosto rotula uno de cada dos meses; en ancho, todos', () => {
        expect((ejeMeses(true).axisLabel as { interval: number }).interval).toBe(1);
        expect((ejeMeses(false).axisLabel as { interval: number }).interval).toBe(0);
    });
    it('el titular empieza con mayúscula aunque el sujeto sea un periodo en minúsculas', () => {
        const t = titularDeAnomalias('marzo 2026 a septiembre 2026', 2026, [{ mediaAbs: -0.05, direccion: 'abajo' }, { mediaAbs: -0.07, direccion: 'abajo' }]);
        expect(t?.texto.startsWith('Marzo 2026')).toBe(true);
        expect(t?.texto).toContain('(−0.060 promedio SRL)');
    });
});
