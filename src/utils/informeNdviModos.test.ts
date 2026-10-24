import { describe, expect, it } from 'vitest';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme } from './informeNdviDatos';
import { construirHtmlNdvi } from './informeNdviHtml';
import { configPorDefecto, normalizaConfig, paginasEstimadas, type ConfigInformeNdvi } from './informeNdviConfig';
import { svgBarrasDelta, svgBarrasPareadas, svgLineasSimples, svgPendienteSlope, signoDelta } from './informeNdviSvgComparativo';

const MESES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const MODS = [1, 2, 3, 4, 5, 12];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];
const FILAS: FilaNdviInforme[] = MODS.flatMap((m, i) => MESES.map((mes, k) => ({
    numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes, ndvi_medio: 0.1 + 0.05 * k + 0.03 * i, ndvi_desv: 0.08, kc_estimado: 0.3 + 0.05 * k,
    delta_ndvi: null, superficie_ha: SUP[i], fraccion_cobertura_activa: 0.6,
})));
const ctx = (): ContextoInforme => ({ volumenPorModulo: new Map(MODS.map((m) => [m, 10])), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 7, 14, 5), emisor: null, version: '2.23.0' });
const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: '' };
const cfg = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES), ...o });
const html = (c: ConfigInformeNdvi, f = FILAS) => construirHtmlNdvi(construirDatosNdvi(f, ctx(), c), LOGOS, '<svg></svg>');
const limpio = (h: string) => expect(h).not.toMatch(/NaN|undefined|\bnull\b/);
const hojas = (h: string) => (h.match(/class="pagina/g) ?? []).length;

describe('modo resumen', () => {
    it('no agrega la hoja de análisis aunque la sección esté marcada', () => {
        const h = html(cfg());
        expect(hojas(h)).toBe(4);
        expect(h).not.toContain('Tendencia del NDVI');
        expect(h).not.toContain('Comparativo —');
    });
});

// Serie de 6 años (2021–2026) para la tendencia interanual y el comparativo entre años.
const ANIOS = [2021, 2022, 2023, 2024, 2025, 2026];
const efecto = (m: number, a: number) => (m === 2 ? 0.03 * (a - 2021) : m === 1 && a === 2026 ? -0.06 : 0);
const MULTI: FilaNdviInforme[] = MODS.flatMap((m, i) => ANIOS.flatMap((a) => MESES.map((mes, k) => ({
    numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes: `${a}${mes.slice(4)}`, ndvi_medio: 0.2 + 0.05 * k + efecto(m, a), ndvi_desv: 0.08, kc_estimado: 0.3 + 0.05 * k,
    delta_ndvi: null, superficie_ha: SUP[i], fraccion_cobertura_activa: 0.6, n_escenas: 4, pct_pixeles_validos: 0.9,
}))));
const MESES_MULTI = [...new Set(MULTI.map((f) => f.mes))].sort();
const cfgM = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES_MULTI), ...o });

describe('modo tendencia', () => {
    it('serie de varios años: anomalía contra lo habitual + evolución año a año, sin pendiente intra-ciclo', () => {
        const h = html(cfgM({ modo: 'tendencia' }), MULTI);
        expect(hojas(h)).toBe(6); // el análisis de tendencia ocupa dos hojas físicas
        expect(h).toContain('Tendencia del NDVI');
        expect(h).toContain('Frente a lo habitual');
        expect(h).toContain('Año tras año');
        expect(h).toContain('Por debajo de lo habitual'); // Módulo 1 cae 0.06 en 2026
        expect(h).toContain('Sube año tras año'); // Módulo 2
        expect(h).not.toContain('Pendiente (NDVI/mes)');
        expect(h).not.toContain('Al alza');
        expect(h).toContain('Cómo leer este NDVI');
        expect(h).toContain('no es el NDVI de una parcela');
        limpio(h);
    });
    it('el reverdecimiento de marzo a septiembre ya no se confunde con una tendencia al alza', () => {
        // Año "normal" repetido seis veces: la serie sube de marzo a septiembre, pero no hay anomalía ni patrón año a año.
        const normal = MULTI.map((f) => ({ ...f, ndvi_medio: 0.2 + 0.05 * MESES.findIndex((m) => m.slice(5) === f.mes.slice(5)) }));
        const h = html(cfgM({ modo: 'tendencia' }), normal);
        expect(h).toContain('En línea con lo habitual');
        expect(h).not.toContain('Sube año tras año');
        expect(h).not.toContain('Por encima de lo habitual');
        limpio(h);
    });
    it('un solo año de serie: todo insuficiente y se dice, sin inventar tendencia', () => {
        const h = html(cfg({ modo: 'tendencia' }));
        expect(hojas(h)).toBe(6);
        expect(h).toContain('Insuficiente');
        expect(h).toContain('un solo año');
        expect(h).not.toContain('Sube año tras año');
        limpio(h);
    });
    it('un mes con pocas escenas limpias se marca de baja confianza', () => {
        const poco = MULTI.map((f) => (f.numero_modulo === 1 && f.mes === '2026-06' ? { ...f, n_escenas: 1 } : f));
        const h = html(cfgM({ modo: 'tendencia' }), poco);
        expect(h).toContain('Baja ⚠');
        expect(h).toContain('pocas observaciones');
    });
    it('desmarcar la sección Análisis quita la hoja', () => {
        const c = cfg({ modo: 'tendencia' });
        expect(hojas(html({ ...c, secciones: c.secciones.filter((s) => s !== 'analisis') }))).toBe(4);
    });
});

describe('modo comparativo', () => {
    it('periodo A vs B: slope chart, tabla de deltas con flechas y promedio SRL', () => {
        const h = html(cfg({ modo: 'comparativo' }));
        expect(hojas(h)).toBe(5);
        expect(h).toContain('Comparativo — Periodo A contra periodo B');
        expect(h).toContain('Diferencia B − A por módulo');
        expect(h).toMatch(/A · marzo 2026 a junio 2026/);
        expect(h).toMatch(/▲/);
        expect(h).toContain('Promedio SRL (simple)');
        limpio(h);
    });
    it('mes contra mes', () => {
        const h = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'mesVsMes', a: { desde: '2026-08', hasta: '2026-08' }, b: { desde: '2026-09', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } }));
        expect(h).toContain('Mes contra mes');
        expect(h).toMatch(/A · agosto 2026/);
        limpio(h);
    });
    it('periodos traslapados muestran la advertencia', () => {
        const h = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'periodos', a: { desde: '2026-03', hasta: '2026-06' }, b: { desde: '2026-05', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } }));
        expect(h).toContain('comparten meses');
    });
    it('un lado sin datos: S/D y sin porcentaje inventado', () => {
        const h = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'periodos', a: { desde: '2025-01', hasta: '2025-06' }, b: { desde: '2026-07', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } }));
        expect(h).toContain('no tiene datos');
        expect(h).toContain('S/D');
        limpio(h);
    });
    it('módulo contra módulo y módulo contra promedio SRL', () => {
        const hm = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'modulos', a: { desde: '', hasta: '' }, b: { desde: '', hasta: '' }, moduloA: 1, moduloB: 12 } }));
        expect(hm).toContain('Comparativo — Módulo 1 contra Módulo 12');
        expect(hm).toContain('supera');
        limpio(hm);
        const hs = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'vsSRL', a: { desde: '', hasta: '' }, b: { desde: '', hasta: '' }, moduloA: 3, moduloB: 12 } }));
        expect(hs).toContain('contra el promedio de los demás');
        expect(hs).toContain('Diferencia mensual contra el promedio de los demás');
        expect(hs).toContain('5 de 5');
        limpio(hs);
    });
});

describe('comparativo entre años', () => {
    const entreAnios = (o: Partial<ConfigInformeNdvi['comparacion']> = {}) => cfgM({
        modo: 'comparativo', preset: 'personalizado', desde: '2026-03', hasta: '2026-09',
        comparacion: { tipo: 'periodos', a: { desde: '2023-03', hasta: '2023-09' }, b: { desde: '2026-03', hasta: '2026-09' }, moduloA: 1, moduloB: 2, ...o },
    });
    it('mar–sep 2026 contra mar–sep 2023: diferencia B − A, etiquetas legibles y mayor aumento/descenso', () => {
        const h = html(entreAnios(), MULTI);
        expect(h).toContain('diferencia B − A');
        expect(h).toMatch(/A · marzo 2023 a septiembre 2023/);
        expect(h).toContain('Mayor aumento: Módulo 2');
        expect(h).toContain('Mayor descenso: Módulo 1');
        expect(h).not.toContain('comparten meses');
        expect(h).not.toContain('Mayor mejora');
        expect(h).not.toContain('pasó de');
        limpio(h);
    });
    it('si todo baja entre años no se habla de "mejora" ni de "mayor aumento"', () => {
        const baja = MULTI.map((f) => (f.mes.startsWith('2026') ? { ...f, ndvi_medio: f.ndvi_medio - 0.12 } : f));
        const h = html(entreAnios(), baja);
        expect(h).not.toContain('Mayor aumento');
        expect(h).toContain('Mayor descenso');
        limpio(h);
    });
    it('meses del año distintos: aviso de estacionalidad en el informe', () => {
        const h = html(entreAnios({ a: { desde: '2026-03', hasta: '2026-05' }, b: { desde: '2026-07', hasta: '2026-09' } }), MULTI);
        expect(h).toContain('estacional');
    });
    it('un módulo sin dato en un lado queda S/D, no 0', () => {
        const sin = MULTI.filter((f) => !(f.numero_modulo === 3 && f.mes.startsWith('2023')));
        const h = html(entreAnios(), sin);
        expect(h).toContain('S/D');
        limpio(h);
    });
    it('módulo contra módulo y contra el promedio de los demás funcionan sobre varios años', () => {
        const c = (tipo: 'modulos' | 'vsSRL') => cfgM({ modo: 'comparativo', preset: 'personalizado', desde: '2025-03', hasta: '2026-09', comparacion: { tipo, a: { desde: '', hasta: '' }, b: { desde: '', hasta: '' }, moduloA: 1, moduloB: 2 } });
        const hm = html(c('modulos'), MULTI);
        expect(hm).toContain('Comparativo — Módulo 1 contra Módulo 2');
        limpio(hm);
        const hv = html(c('vsSRL'), MULTI);
        expect(hv).toContain('contra el promedio de los demás');
        limpio(hv);
    });
});

describe('configuración con modos', () => {
    it('páginas estimadas: el modo no-resumen suma la hoja de análisis', () => {
        expect(paginasEstimadas(cfg())).toBe(4);
        expect(paginasEstimadas(cfg({ modo: 'tendencia' }))).toBe(6);
        expect(paginasEstimadas(cfg({ modo: 'comparativo', secciones: ['analisis'] }))).toBe(1);
    });
    it('un preset guardado sin modo/comparación se completa con los valores por defecto', () => {
        const { modo: _m, comparacion: _c, ...viejo } = cfg();
        const n = normalizaConfig(viejo as unknown as ConfigInformeNdvi, MESES);
        expect(n.modo).toBe('resumen');
        expect(n.comparacion.tipo).toBe('periodos');
        expect(n.comparacion.a.desde).toBe('2026-03'); // un solo año en la serie: cae a primera mitad del ciclo
    });
});

describe('gráficos comparativos', () => {
    it('slope chart, barras de diferencia, líneas y barras pareadas devuelven SVG; sin datos, vacío', () => {
        expect(svgPendienteSlope([{ etiqueta: 'M1', a: 0.2, b: 0.4 }, { etiqueta: 'M2', a: 0.3, b: 0.2 }], 'A', 'B')).toContain('<svg');
        expect(svgPendienteSlope([{ etiqueta: 'M1', a: null, b: null }], 'A', 'B')).toBe('');
        expect(svgBarrasDelta([{ etiqueta: 'a', valor: 0.1 }, { etiqueta: 'b', valor: -0.05 }, { etiqueta: 'c', valor: null }])).toContain('S/D');
        expect(svgBarrasDelta([{ etiqueta: 'a', valor: null }])).toBe('');
        expect(svgLineasSimples(MESES, [{ etiqueta: 'x', color: '#000', vals: [0.1, null, 0.3, 0.4, 0.5, 0.6, 0.7] }])).toContain('<svg');
        expect(svgLineasSimples([], [])).toBe('');
        expect(svgBarrasPareadas([{ etiqueta: 'NDVI', a: 0.3, b: null, max: 0.8, decimales: 2 }], 'M1', 'M2', '#00f', '#0f0')).toContain('S/D');
    });
    it('S/D es hueco: la línea se corta (dos trazos), nunca baja a 0; un eje largo se rotula espaciado', () => {
        const svg = svgLineasSimples(MESES, [{ etiqueta: 'x', color: '#000', vals: [0.2, 0.3, null, 0.5, 0.6, 0.7, 0.8] }]);
        expect((svg.match(/<path /g) ?? []).length).toBe(1);
        expect((svg.match(/ M/g) ?? []).length).toBe(1); // segundo tramo empieza con otro "M": no hay línea que cruce el hueco
        const largo = Array.from({ length: 36 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
        const sv = svgLineasSimples(largo, [{ etiqueta: 'x', color: '#000', vals: largo.map(() => 0.4) }]);
        expect((sv.match(/text-anchor="middle"/g) ?? []).length).toBeLessThan(largo.length / 2);
        expect(svgLineasSimples(['2021', '2022'], [{ etiqueta: 'x', color: '#000', vals: [0.2, 0.3] }], 620, 190, ['A', 'B'])).toContain('>B<');
    });
    it('signoDelta usa flechas y trata 0 como ■', () => {
        expect(signoDelta(0.054, 3)).toBe('▲ +0.054');
        expect(signoDelta(-0.136, 3)).toBe('▼ −0.136');
        expect(signoDelta(0.0001, 3)).toBe('■ 0.000');
    });
});
