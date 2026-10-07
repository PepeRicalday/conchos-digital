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

describe('modo tendencia', () => {
    it('agrega la hoja de análisis con pendiente por módulo, criterio y nota de un solo ciclo', () => {
        const h = html(cfg({ modo: 'tendencia' }));
        expect(hojas(h)).toBe(5);
        expect(h).toContain('Pág. 5 de 5');
        expect(h).toContain('Tendencia del NDVI');
        expect(h).toContain('Pendiente (NDVI/mes)');
        expect(h).toContain('Al alza');
        expect(h).toContain('no es una comparación entre años');
        expect(h).toMatch(/al menos 4 meses con dato/);
        limpio(h);
    });
    it('desmarcar la sección Análisis quita la hoja', () => {
        const c = cfg({ modo: 'tendencia' });
        expect(hojas(html({ ...c, secciones: c.secciones.filter((s) => s !== 'analisis') }))).toBe(4);
    });
    it('periodo de 3 meses: solo pendiente descriptiva, sin declarar tendencia', () => {
        const h = html(cfg({ modo: 'tendencia', preset: 'personalizado', desde: '2026-07', hasta: '2026-09' }));
        expect(h).toContain('Descriptiva (n=3)');
        expect(h).not.toContain('Al alza');
        limpio(h);
    });
});

describe('modo comparativo', () => {
    it('periodo A vs B: slope chart, tabla de deltas con flechas y promedio SRL', () => {
        const h = html(cfg({ modo: 'comparativo' }));
        expect(hojas(h)).toBe(5);
        expect(h).toContain('Comparativo — Periodo A contra periodo B');
        expect(h).toContain('Diferencia B − A por módulo');
        expect(h).toMatch(/A · 2026-03 a 2026-06/);
        expect(h).toMatch(/▲/);
        expect(h).toContain('Promedio SRL (simple)');
        limpio(h);
    });
    it('mes contra mes', () => {
        const h = html(cfg({ modo: 'comparativo', comparacion: { tipo: 'mesVsMes', a: { desde: '2026-08', hasta: '2026-08' }, b: { desde: '2026-09', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } }));
        expect(h).toContain('Mes contra mes');
        expect(h).toMatch(/A · 2026-08/);
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
        expect(hs).toContain('contra el promedio SRL');
        expect(hs).toContain('Diferencia mensual contra el promedio SRL');
        limpio(hs);
    });
});

describe('configuración con modos', () => {
    it('páginas estimadas: el modo no-resumen suma la hoja de análisis', () => {
        expect(paginasEstimadas(cfg())).toBe(4);
        expect(paginasEstimadas(cfg({ modo: 'tendencia' }))).toBe(5);
        expect(paginasEstimadas(cfg({ modo: 'comparativo', secciones: ['analisis'] }))).toBe(1);
    });
    it('un preset guardado sin modo/comparación se completa con los valores por defecto', () => {
        const { modo: _m, comparacion: _c, ...viejo } = cfg();
        const n = normalizaConfig(viejo as unknown as ConfigInformeNdvi, MESES);
        expect(n.modo).toBe('resumen');
        expect(n.comparacion.tipo).toBe('periodos');
        expect(n.comparacion.a.desde).toBe('2026-03');
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
    it('signoDelta usa flechas y trata 0 como ■', () => {
        expect(signoDelta(0.054, 3)).toBe('▲ +0.054');
        expect(signoDelta(-0.136, 3)).toBe('▼ −0.136');
        expect(signoDelta(0.0001, 3)).toBe('■ 0.000');
    });
});
