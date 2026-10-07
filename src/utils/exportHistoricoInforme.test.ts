import { describe, expect, it } from 'vitest';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import { configPorDefecto, SECCIONES_POR_DEFECTO, seccionesDe, SECCIONES, type ConfigInforme } from './informeHistoricoConfig';
import { prepararInforme } from './informeHistoricoDatos';
import { buildHTMLBasico, buildHTMLTecnico, nombreArchivoInforme } from './exportHistoricoInforme';
import { svgBarrasDelta, svgLineasComparadas, svgMapaCalor, svgSemaforo, svgTendencia } from './informeHistoricoSvg';

const fila = (presa: string, fecha: string, alm: number | null, pct: number | null): FilaSerie => ({
    presa_id: presa, fecha, escala_msnm: alm == null ? null : 1280 + alm / 100, almacenamiento_mm3: alm, pct, fuente: 'HISTORICO', calidad: alm == null ? 'SIN_DATO' : 'OK',
    almacenamiento_reportado_mm3: alm, pct_reportado: pct,
});

function datos(): FilaSerie[] {
    const out: FilaSerie[] = [];
    for (const presa of ['PRE-001', 'PRE-002']) {
        for (const a of [2022, 2023, 2024, 2025]) {
            for (const mes of [9, 10, 11]) {
                const dm = new Date(a, mes, 0).getDate();
                for (let d = 1; d <= dm; d++) {
                    // 2023: octubre sin datos (hueco) para probar S/D.
                    if (a === 2023 && mes === 10) continue;
                    const v = (a - 2000) * 10 + mes + (presa === 'PRE-002' ? 5 : 0);
                    out.push(fila(presa, `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, v, v / 5));
                }
            }
        }
        out.push(fila(presa, '2026-10-05', 100, 3.5), fila(presa, '2026-10-06', 102, 3.6));
    }
    return out;
}

const HOY = new Date('2026-10-06T18:00:00Z');
const idx = indexarSerie(datos());
const baseCfg = (o: Partial<ConfigInforme>): ConfigInforme => ({
    ...configPorDefecto([2026, 2025, 2024, 2023, 2022], HOY),
    periodo: { tipo: 'mes', mes: 10, mesIni: 1, mesFin: 12 },
    aniosComparar: [2025, 2023], metricas: ['volumen', 'llenado', 'deltaAparente'], ...o,
});
const limpio = (h: string) => {
    expect(h).not.toMatch(/NaN/);
    expect(h).not.toMatch(/undefined/);
    expect(h).not.toMatch(/>null</);
    expect(h).not.toMatch(/\bnull\b(?![^<]*<\/script)/);
    expect(h).not.toMatch(/window\.print/);
};

describe('Informe básico', () => {
    const cfg = baseCfg({ modalidad: 'basico', secciones: seccionesDe('basico') });
    const d = prepararInforme(cfg, idx, HOY);
    const h = buildHTMLBasico(d, 'data:image/png;base64,AAAA');

    it('sin NaN/undefined/null y con S/D', () => {
        limpio(h);
        expect(h).toContain('S/D');
    });
    it('una página por presa', () => {
        expect((h.match(/class="hoja pagina/g) ?? []).length).toBe(2);
        expect(h).toContain('La Boquilla');
        expect(h).toContain('Fco. I. Madero');
        expect(h).toContain('Posición histórica');
        expect(h).toContain('Comparativo contra el año previo');
    });
    it('sin logo usa la marca de texto', () => {
        const sinLogo = buildHTMLBasico(d, '');
        expect(sinLogo).toContain('UNIDAD CONCHOS');
        limpio(sinLogo);
    });
});

describe('Informe técnico', () => {
    const cfg = baseCfg({ modalidad: 'tecnico', secciones: seccionesDe('tecnico') });
    const d = prepararInforme(cfg, idx, HOY);
    const h = buildHTMLTecnico(d, '');
    it('sin valores inválidos y con S/D', () => {
        limpio(h);
        expect(h).toContain('S/D');
    });
    it('incluye todas las secciones pedidas, numeradas', () => {
        for (const s of seccionesDe('tecnico')) expect(h, s).toContain(SECCIONES[s].etiqueta);
        expect(h).toContain('Δ almacenamiento aparente — no es extracción ni aportación');
        expect(h).toContain('descriptiva, no predictiva');
        expect(h).toContain('Advertencia: percentiles frágiles');
        expect(h).toContain('<thead>');
    });
    it('solo renderiza las secciones elegidas', () => {
        const hh = buildHTMLTecnico(prepararInforme(baseCfg({ modalidad: 'tecnico', secciones: ['resumen', 'limitaciones'] }), idx, HOY), '');
        expect(hh).toContain('Limitaciones');
        expect(hh).not.toContain('Estacionalidad</h2>');
        expect(hh).not.toContain('Anexo: tabla de datos</h2>');
    });
    it('métricas ausentes: omite secciones sin error', () => {
        const hh = buildHTMLTecnico(prepararInforme(baseCfg({ modalidad: 'tecnico', metricas: ['deltaAparente'], secciones: seccionesDe('tecnico') }), idx, HOY), '');
        limpio(hh);
        expect(hh).toContain('Limitaciones');
    });
});

describe('SVG', () => {
    it('semáforo trae texto además del color', () => {
        expect(svgSemaforo('rojo')).toContain('ROJO');
        expect(svgSemaforo('sd')).toContain('S/D');
    });
    it('null rompe la línea (no se dibuja como 0) y gráficas vacías dicen S/D', () => {
        const b = prepararInforme(baseCfg({ modalidad: 'tecnico' }), idx, HOY).presas[0].bloques[0];
        const s = svgLineasComparadas(b);
        expect(s).toContain('<svg');
        expect(s).not.toMatch(/NaN/);
        const vacia = svgLineasComparadas({ ...b, series: b.series.map(x => ({ ...x, valores: x.valores.map(() => null) })) });
        expect(vacia).toContain('S/D');
        expect(svgMapaCalor([], b)).toContain('S/D');
        expect(svgBarrasDelta([])).toContain('S/D');
        expect(svgTendencia([], null)).toContain('S/D');
    });
});

describe('nombre de archivo', () => {
    it('sin acentos ni espacios', () => {
        const nombre = nombreArchivoInforme(baseCfg({ modalidad: 'tecnico' }));
        expect(nombre).toBe('Informe_Historico_Boquilla-Madero_2026-10_Tecnico.html');
        expect(nombreArchivoInforme(baseCfg({ periodo: { tipo: 'cicloAgricola', mes: 1, mesIni: 1, mesFin: 12 } }))).toBe('Informe_Historico_Boquilla-Madero_Ciclo2026-2027_Basico.html');
    });
});

import { writeFileSync } from 'node:fs';
describe('volcado visual', () => {
    it('escribe HTML', () => {
        const dir = process.env.INFORME_DUMP;
        if (!dir) return;
        writeFileSync(`${dir}/basico.html`, buildHTMLBasico(prepararInforme(baseCfg({ modalidad: 'basico', secciones: SECCIONES_POR_DEFECTO.basico }), idx, HOY), ''));
        writeFileSync(`${dir}/tecnico.html`, buildHTMLTecnico(prepararInforme(baseCfg({ modalidad: 'tecnico', secciones: seccionesDe('tecnico') }), idx, HOY), ''));
    });
});
