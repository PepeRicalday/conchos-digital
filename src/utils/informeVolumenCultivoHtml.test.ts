import { describe, expect, it } from 'vitest';
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import {
    claveContenidoVC, construirHtmlVolumenCultivo, folioVolumenCultivo, svgLaminaMiniaturas, svgMezclaApilada, svgRangoCiclo, MODULOS_INFORME_VC,
    type DatosInformeVolumenCultivo,
} from './informeVolumenCultivoHtml';
import { laminaPorCultivo, referenciaCicloActual } from './volumenCultivo';

const f = (anio: number, modulo: number, cultivo: string, ha: number | null, miles: number | null, atipico = false): FilaSupVol =>
    ({ anio, numero_modulo: modulo, cultivo, superficie_ha: ha, volumen_miles_m3: miles, atipico });
const FILAS: FilaSupVol[] = [
    f(2020, 1, 'Alfalfa', 3000, 40000), f(2020, 1, 'Nogal', 1400, 18000), f(2020, 2, 'Maíz', 500, 4000),
    f(2021, 1, 'Alfalfa', 1500, 9000), f(2021, 1, 'Nogal', 1400, 9900),
    f(2022, 1, 'Alfalfa', 1800, 14000), f(2022, 1, 'Nogal', 1500, 13000, true),
    f(2023, 1, 'Alfalfa', 3200, 38000), f(2023, 1, 'Nogal', 1600, 19000),
    f(2024, 1, 'Alfalfa', 1700, 20000), f(2024, 1, 'Nogal', 1500, 13000), f(2024, 1, 'Sorgo', 9, 80),
];
const ACTUAL: VolumenActual = { porModulo: new Map([[1, 50]]), mesesPorModulo: new Map([[1, 7]]), mesesParciales: [], error: null };
const base = (o: Partial<DatosInformeVolumenCultivo> = {}): DatosInformeVolumenCultivo => ({
    filas: FILAS, volumenActual: ACTUAL, errorSupVol: null, emisor: 'Prueba', emitidoEn: new Date(2026, 10, 3, 10, 30), version: '9.9.9', ...o,
});
const LOGOS = { srl: 'data:image/svg+xml;base64,AAAA', sica: 'data:image/svg+xml;base64,BBBB' };
const MALOS = ['NaN', 'undefined', 'Infinity', '[object Object]', '>null<'];

describe('folio por hash', () => {
    it('mismo contenido → mismo hash; otro dato → otro hash; el emisor y la hora no cambian el hash', () => {
        const a = claveContenidoVC(base());
        expect(claveContenidoVC(base({ emisor: 'Otra persona', emitidoEn: new Date(2027, 0, 1) }))).toBe(a);
        expect(claveContenidoVC(base({ filas: FILAS.slice(1) }))).not.toBe(a);
        expect(folioVolumenCultivo(base())).toMatch(/^VCULT-[0-9A-F]{8}-20261103-1030$/);
    });
});

describe('construirHtmlVolumenCultivo', () => {
    const html = construirHtmlVolumenCultivo(base(), LOGOS);
    it('tiene hojas con «Pág. n de N» consistentes y el membrete dual', () => {
        const hojas = (html.match(/<section class="pagina">/g) ?? []).length;
        expect(hojas).toBeGreaterThanOrEqual(5);
        const pies = [...html.matchAll(/Pág\. (\d+) de (\d+)/g)];
        expect(pies).toHaveLength(hojas);
        pies.forEach((m, i) => { expect(Number(m[1])).toBe(i + 1); expect(Number(m[2])).toBe(hojas); });
        expect(html).toContain('mb-srl');
        expect(html).toContain('mb-sica');
        expect(html).toContain('mb-srl');
    });
    it('trae las secciones pedidas', () => {
        for (const t of ['Resumen ejecutivo', 'Agua entregada por hectárea, por cultivo', 'Mezcla de cultivos y cambio de superficie', 'Ciclo actual contra el rango 2020-2024', 'Celdas y renglones atípicos', 'Notas de fuente, método y trazabilidad']) expect(html).toContain(t);
        for (const t of ['ACUM_INF', 'corte', 'ciclo terminado', 'no están conciliadas', 'año calendario', 'no atribuye causas']) expect(html.toLowerCase()).toContain(t.toLowerCase());
    });
    it('no deja basura de formato ni lenguaje causal', () => {
        for (const m of MALOS) expect(html).not.toContain(m);
        expect(html).not.toMatch(/porque|debido a|por culpa|gracias a/i);
    });
    it('el folio impreso es el del hash y aparece en el pie y en la traza', () => {
        const folio = folioVolumenCultivo(base());
        expect((html.match(new RegExp(folio, 'g')) ?? []).length).toBeGreaterThan(3);
    });
    it('con la lámina esperada de la fuente: alfalfa 2024 = 20000/1700×10 = 118 cm', () => {
        expect(html).toContain('118');
    });
    it('sin ciclo actual o con error: S/D con aviso, no 0', () => {
        const sin = construirHtmlVolumenCultivo(base({ volumenActual: null }), LOGOS);
        expect(sin).toContain('no se cargó');
        expect(sin).not.toMatch(/Actual<\/th>[\s\S]*<td class="n">0/);
        const err = construirHtmlVolumenCultivo(base({ volumenActual: { ...ACTUAL, porModulo: new Map(), error: 'caída' } }), LOGOS);
        expect(err).toContain('caída');
    });
    it('sin filas: informe completo con S/D y el error de la fuente', () => {
        const v = construirHtmlVolumenCultivo(base({ filas: [], errorSupVol: 'timeout', volumenActual: null }), LOGOS);
        expect(v).toContain('timeout');
        for (const m of MALOS) expect(v).not.toContain(m);
        expect(v).toContain('Anexo');
    });
    it('el anexo de atípicos lista la captura atípica de la fuente y la muestra chica', () => {
        expect(html).toContain('captura atípica en el informe fuente');
        expect(html).toMatch(/superficie menor a 50 ha/);
    });
    it('escapa texto con HTML en el emisor', () => {
        const x = construirHtmlVolumenCultivo(base({ emisor: '<img src=x onerror=1>' }), LOGOS);
        expect(x).not.toContain('<img src=x');
    });
});

describe('gráficas SVG', () => {
    it('miniaturas: S/D escrito, barra hueca para muestra chica y aria-label con las cifras', () => {
        const series = laminaPorCultivo(FILAS, null);
        const svg = svgLaminaMiniaturas(series, [2020, 2021, 2022, 2023, 2024]);
        expect(svg).toContain('role="img"');
        expect(svg).toContain('S/D');
        expect(svg).toContain('fill="#fff" stroke="#7A5C14"');
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).toMatch(/Alfalfa: 2020 \d+ cm/);
        expect(svg).not.toContain('NaN');
        expect(svgLaminaMiniaturas([], [2020])).toBe('');
    });
    it('mezcla apilada: porcentajes escritos y año sin volumen = S/D', () => {
        const svg = svgMezclaApilada(FILAS, [2019, 2020]);
        expect(svg).toContain('S/D');
        expect(svg).toMatch(/\d+ %/);
        expect(svg).not.toContain('NaN');
    });
    it('rango del ciclo: módulo sin dato actual no dibuja rombo ni 0', () => {
        const refs = referenciaCicloActual(FILAS, ACTUAL, MODULOS_INFORME_VC);
        const svg = svgRangoCiclo(refs);
        expect(svg.match(/l-8 -9z/g)?.length).toBe(1);
        expect(svg).toContain('actual S/D');
        expect(svg).not.toContain('NaN');
    });
});

describe('«Otros N cultivos» y datos incompletos en el informe', () => {
    const MUCHOS: FilaSupVol[] = ['Alfalfa', 'Nogal', 'Maíz', 'Chile', 'Cacahuate', 'Varios', 'Trigo', 'Sandía', 'Avena'].map((c, i) => ({ anio: 2020, numero_modulo: 1, cultivo: c, superficie_ha: 100, volumen_miles_m3: c === 'Avena' ? null : 1000 - i * 50, atipico: false }));
    it('la leyenda enlista como texto visible los cultivos que agrupa «Otros» y la barra marca ⚠ si hay un renglón sin volumen', () => {
        const svg = svgMezclaApilada(MUCHOS, [2020]);
        expect(svg).toMatch(/Otros 2 cultivos \([^)]+\)<\/li>/);
        expect(svg).toContain('2020 ⚠</text>');
        expect(svg).toContain('El total y los porcentajes de ese año son sobre datos incompletos');
        expect(svg).not.toMatch(/title="[^"]*Trigo/);
    });
});

describe('informe: ⚠ por año vs nota única', () => {
    const fx = (anio: number, cultivo: string, vol: number | null): FilaSupVol => ({ anio, numero_modulo: 1, cultivo, superficie_ha: 100, volumen_miles_m3: vol, atipico: false });
    it('todos los años marcados: sin ⚠ junto a cada año y una sola nota general', () => {
        const svg = svgMezclaApilada([fx(2020, 'Alfalfa', 1000), fx(2020, 'Maíz', null), fx(2021, 'Alfalfa', 900), fx(2021, 'Chile', null)], [2020, 2021]);
        expect(svg).not.toMatch(/>202[01] ⚠<\/text>/);
        expect(svg.split('Todos los años traen renglones atípicos o sin volumen').length - 1).toBe(1);
    });
    it('solo algunos años marcados: se mantiene el ⚠ por año', () => {
        const svg = svgMezclaApilada([fx(2020, 'Alfalfa', 1000), fx(2020, 'Maíz', null), fx(2021, 'Alfalfa', 900)], [2020, 2021]);
        expect(svg).toContain('2020 ⚠</text>');
        expect(svg).not.toContain('2021 ⚠</text>');
        expect(svg).not.toContain('Todos los años traen');
    });
});

describe('identidad de cultivo en el informe', () => {
    const html = construirHtmlVolumenCultivo(base(), LOGOS);
    it('cada encabezado de fila de cultivo lleva su ícono y su nombre escrito', () => {
        for (const c of ['Alfalfa', 'Nogal', 'Sorgo']) expect(html, c).toMatch(new RegExp(`<th scope="row" class="cul"><svg class="ico-cul"[^>]*aria-hidden="true"[^]*?</svg>${c}</th>`));
    });
    it('la mezcla apilada usa el color claro de cada cultivo, trama para leer en blanco y negro y leyenda con ícono', () => {
        const svg = svgMezclaApilada(FILAS, [2020, 2021, 2022, 2023, 2024]);
        expect(svg).toContain('#2E7D32'); // alfalfa
        expect(svg).toContain('#7A4A1C'); // nogal
        expect(svg).toContain('<pattern id="tr-mz-nogal"');
        expect(svg).toContain('Sin ciclo: presas cerradas');
        expect(svg).toContain('2026</text>');
        expect(svg).toContain('Provisional: sin desglose por cultivo');
        expect(svg).toContain('Los porcentajes se redondean; pueden sumar 99 o 101 %');
        expect(svg).toContain('«Varios» = cultivos sin desglose en el informe');
        expect(svg).toMatch(/<ul class="ley" aria-label="Leyenda de cultivos"><li><i class="sw"[^>]*><\/i><svg class="ico-cul"/);
        expect(svg).not.toMatch(/NaN|undefined/);
    });
});
