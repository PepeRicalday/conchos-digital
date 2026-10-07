import { describe, expect, it } from 'vitest';
import {
    avisosConfig, configPorDefecto, conPreset, filtrarFilas, inicioCiclo, mesReferenciaDe, mesesDisponibles, normalizaConfig,
    paginasEstimadas, rangoDePreset, validarConfig, type ConfigInformeNdvi,
} from './informeNdviConfig';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme } from './informeNdviDatos';
import { construirHtmlNdvi } from './informeNdviHtml';

const MESES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const MODS = [1, 2, 3, 4, 5, 12];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];
const fila = (mod: number, mes: string, ndvi: number): FilaNdviInforme => ({
    numero_modulo: mod, nombre_modulo: `Módulo ${mod}`, mes, ndvi_medio: ndvi, ndvi_desv: 0.08, kc_estimado: 0.15 + 1.1 * ndvi,
    delta_ndvi: null, superficie_ha: SUP[MODS.indexOf(mod)], fraccion_cobertura_activa: 0.6,
});
// NDVI creciente 0.10 → 0.40 en el ciclo para el módulo 1; los demás 0.1 más.
const FILAS: FilaNdviInforme[] = MODS.flatMap((m, i) => MESES.map((mes, k) => fila(m, mes, 0.1 + 0.05 * k + 0.02 * i)));
const ctx = (o: Partial<ContextoInforme> = {}): ContextoInforme => ({
    volumenPorModulo: new Map(MODS.map((m) => [m, 10])), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true,
    ahora: new Date(2026, 9, 7, 14, 5), emisor: null, version: '2.23.0', ...o,
});
const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: '' };
const cfg = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES), ...o });

describe('presets de periodo', () => {
    it('resuelven sobre los meses disponibles', () => {
        expect(rangoDePreset('mesRef', MESES)).toEqual({ desde: '2026-09', hasta: '2026-09' });
        expect(rangoDePreset('ultimos3', MESES)).toEqual({ desde: '2026-07', hasta: '2026-09' });
        expect(rangoDePreset('ciclo', MESES)).toEqual({ desde: '2026-03', hasta: '2026-09' });
        expect(rangoDePreset('mitad1', MESES)).toEqual({ desde: '2026-03', hasta: '2026-06' });
        expect(rangoDePreset('mitad2', MESES)).toEqual({ desde: '2026-07', hasta: '2026-09' });
        expect(rangoDePreset('ciclo', [])).toBeNull();
    });
    it('un preset guardado se reaplica sobre los meses nuevos; uno personalizado se respeta', () => {
        const guardado = conPreset(cfg(), 'mesRef', MESES);
        expect(normalizaConfig(guardado, [...MESES, '2026-10']).hasta).toBe('2026-10');
        const pers = { ...cfg(), preset: 'personalizado' as const, desde: '2026-04', hasta: '2026-05' };
        expect(normalizaConfig(pers, [...MESES, '2026-10'])).toMatchObject({ desde: '2026-04', hasta: '2026-05' });
    });
    it('el ciclo agrícola corre de marzo a septiembre', () => {
        expect(inicioCiclo('2026-09')).toBe('2026-03');
        expect(inicioCiclo('2026-03')).toBe('2026-03');
        expect(inicioCiclo('2027-02')).toBe('2026-03');
    });
});

describe('filtrado y validación', () => {
    it('filtra por periodo y por módulos (inclusivo)', () => {
        const c = cfg({ desde: '2026-05', hasta: '2026-07', modulos: [1, 12] });
        const f = filtrarFilas(FILAS, c);
        expect(f).toHaveLength(2 * 3);
        expect(mesesDisponibles(f)).toEqual(['2026-05', '2026-06', '2026-07']);
        expect(mesReferenciaDe(FILAS, c)).toBe('2026-07');
    });
    it('errores que bloquean: sin módulos, sin secciones, periodo invertido, rango sin datos', () => {
        expect(validarConfig(cfg({ modulos: [] }), FILAS)).toContain('Elige al menos un módulo.');
        expect(validarConfig(cfg({ secciones: [] }), FILAS)).toContain('Elige al menos una sección.');
        expect(validarConfig(cfg({ desde: '2026-09', hasta: '2026-04', preset: 'personalizado' }), FILAS).join(' ')).toMatch(/posterior/);
        expect(validarConfig(cfg({ desde: '2027-01', hasta: '2027-03', preset: 'personalizado' }), FILAS).join(' ')).toMatch(/No hay lecturas/);
        expect(validarConfig(cfg(), FILAS)).toEqual([]);
    });
    it('avisos: módulo sin dato en el mes de referencia y un solo módulo', () => {
        const sinM12 = FILAS.filter((f) => !(f.numero_modulo === 12 && f.mes === '2026-09'));
        expect(avisosConfig(cfg(), sinM12).join(' ')).toMatch(/Módulo 12/);
        expect(avisosConfig(cfg({ modulos: [3] }), FILAS).join(' ')).toMatch(/un solo módulo/i);
    });
    it('páginas estimadas según las secciones elegidas', () => {
        expect(paginasEstimadas(cfg())).toBe(4);
        expect(paginasEstimadas(cfg({ secciones: ['portada', 'resumen'] }))).toBe(1);
        expect(paginasEstimadas(cfg({ secciones: ['plano', 'serie'] }))).toBe(2);
    });
});

describe('modelo filtrado', () => {
    it('periodo de un mes: el cambio se calcula contra el mes anterior de TODA la serie', () => {
        const d = construirDatosNdvi(FILAS, ctx(), cfg({ preset: 'mesRef', desde: '2026-09', hasta: '2026-09' }));
        expect(d.meses).toEqual(['2026-09']);
        expect(d.mesAnterior).toBe('2026-08');
        expect(d.modulos[0].delta).toBeCloseTo(0.05, 6);
        expect(d.tendencia).toBeCloseTo(0.05, 6);
    });
    it('subconjunto de módulos: solo esos aparecen y el promedio sale de ellos', () => {
        const d = construirDatosNdvi(FILAS, ctx(), cfg({ modulos: [1, 2] }));
        expect(d.modulos.map((m) => m.numero)).toEqual([1, 2]);
        const esperado = ((0.1 + 0.3) + (0.12 + 0.3)) / 2;
        expect(d.promedioSimple).toBeCloseTo(esperado, 6);
    });
    it('base ponderada: la cifra principal es la ponderada y la serie mensual también', () => {
        const dS = construirDatosNdvi(FILAS, ctx(), cfg({ basePromedio: 'simple' }));
        const dP = construirDatosNdvi(FILAS, ctx(), cfg({ basePromedio: 'ponderado' }));
        expect(dS.promedio).toBeCloseTo(dS.promedioSimple!, 9);
        expect(dP.promedio).toBeCloseTo(dP.promedioPonderado!, 9);
        expect(dP.promedio).not.toBeCloseTo(dS.promedio!, 4);
        expect(dP.promedioPorMes).toHaveLength(7);
    });
    it('sin filtros equivale al informe de siempre (ciclo completo, 6 módulos)', () => {
        const d = construirDatosNdvi(FILAS, ctx());
        expect(d.modulos).toHaveLength(6);
        expect(d.meses).toHaveLength(7);
        expect(d.mesReferencia).toBe('2026-09');
    });
});

describe('HTML configurable', () => {
    const html = (c: ConfigInformeNdvi, f = FILAS) => construirHtmlNdvi(construirDatosNdvi(f, ctx(), c), LOGOS, '<svg></svg>');
    it('hojas y numeración dinámicas según las secciones', () => {
        const h = html(cfg({ secciones: ['resumen', 'metodologia'] }));
        expect((h.match(/class="pagina/g) ?? []).length).toBe(2);
        expect(h).toContain('Pág. 2 de 2');
        expect(h).not.toContain('Fichas por módulo');
    });
    it('indicadores desactivados no aparecen en fichas, anexo ni glosario', () => {
        const h = html(cfg({ indicadores: ['icv'] }));
        expect(h).not.toContain('Kc estimado');
        expect(h).not.toContain('IHR (0–100)');
        expect(h).not.toContain('IEHP (ha/hm³)');
        expect(h).toContain('ICV mensual');
        expect(h).not.toContain('IHR mensual');
    });
    it('un solo módulo: sin promedio SRL ni ranking de varios', () => {
        const h = html(cfg({ modulos: [3] }));
        expect(h).not.toContain('Promedio SRL (simple)');
        expect(h).toContain('NDVI medio');
        expect(h).not.toMatch(/NaN|undefined|\bnull\b/);
    });
    it('periodo de un mes: sin sparkline ni serie multimes rota', () => {
        const h = html(cfg({ preset: 'mesRef', desde: '2026-09', hasta: '2026-09' }));
        expect(h).not.toMatch(/NaN|undefined|\bnull\b/);
        expect(h).toContain('septiembre 2026');
    });
    it('base ponderada se rotula en el informe', () => {
        const h = html(cfg({ basePromedio: 'ponderado' }));
        expect(h).toContain('Promedio SRL (ponderado)');
        expect(h).toContain('ponderado por superficie');
    });
    it('hoja A4 cambia el tamaño de página', () => {
        expect(html(cfg({ hoja: 'a4' }))).toContain('size:A4 portrait');
        expect(html(cfg())).toContain('size:letter portrait');
    });
});
