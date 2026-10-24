import { describe, it, expect } from 'vitest';
import { construirInteranual, validarInteranual, aniosConNdvi } from './informeNdviInteranual';
import { construirHtmlInteranual, svgPulso } from './informeNdviInteranualHtml';
import { avisosConfig, configPorDefecto, rangoDePreset } from './informeNdviConfig';
import type { FilaNdviV2, FilaSupVol } from './ndviInteranual';

const f = (mes: string, v: number | null, modulo = 1, extra: Partial<FilaNdviV2> = {}): FilaNdviV2 => ({
    numero_modulo: modulo, mes, ndvi_mediana: v, ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: null,
    n_escenas: 4, pct_pixeles_validos: 1, superficie_ha: 100, ...extra,
});
const ndvi: FilaNdviV2[] = [];
for (const [anio, k] of [[2021, 0.8], [2022, 0.9], [2023, 1.0], [2024, 1.1]] as const) {
    for (const m of [1, 2]) for (const mm of ['03', '05', '07']) ndvi.push(f(`${anio}-${mm}`, 0.3 * k * (mm === '07' ? 1.2 : 1), m));
}
const sv = (anio: number, modulo: number, sup: number | null, vol: number | null, atipico = false): FilaSupVol => ({ anio, numero_modulo: modulo, cultivo: 'Maíz', superficie_ha: sup, volumen_miles_m3: vol, atipico });
const supVol: FilaSupVol[] = [sv(2021, 1, 1000, 5000), sv(2022, 1, 1000, 6000, true), sv(2023, 1, 1000, 7000)];
const ctx = { ahora: new Date('2026-10-23T12:00:00'), emisor: null, version: '9.9.9', logoSrlOk: true };

describe('informe interanual (modelo)', () => {
    it('año sin informe de superficie/volumen queda S/D, no 0, y se avisa', () => {
        const m = construirInteranual({ ndvi, supVol }, { anios: [2021, 2022, 2023, 2024], modulos: [1, 2] }, ctx);
        const m1 = m.modulos.find((x) => x.numero === 1)!;
        expect(m1.cruce.find((c) => c.anio === 2024)!.volumenHm3).toBeNull();
        expect(m1.cruce.find((c) => c.anio === 2023)!.laminaM3Ha).toBe(7000);
        expect(m.avisos.some((a) => a.includes('Sin informe de superficie y volumen para 2024'))).toBe(true);
        expect(m.avisos.some((a) => a.includes('atípica'))).toBe(true);
    });
    it('el año de interés es el último y la banda sale de los otros', () => {
        const m = construirInteranual({ ndvi, supVol }, { anios: [2024, 2021, 2022, 2023], modulos: [1] }, ctx);
        expect(m.anioFoco).toBe(2024);
        expect(m.modulos[0].lectura.direccion).toBe('arriba');
        expect(m.conteo.arriba).toBe(1);
    });
    it('valida: al menos dos años y un módulo', () => {
        expect(validarInteranual([2024], [1], ndvi).length).toBe(1);
        expect(validarInteranual([2023, 2024], [], ndvi).length).toBe(1);
        expect(validarInteranual([2023, 2024], [1], ndvi)).toEqual([]);
        expect(aniosConNdvi(ndvi)).toEqual([2021, 2022, 2023, 2024]);
    });
    it('2020 sin NDVI aparece S/D y con aviso', () => {
        const m = construirInteranual({ ndvi, supVol: [sv(2020, 1, 900, 4000), ...supVol] }, { anios: [2020, 2021, 2022], modulos: [1] }, ctx);
        expect(m.modulos[0].resumenes[0].pico).toBeNull();
        expect(m.avisos.some((a) => a.startsWith('2020 no tiene NDVI'))).toBe(true);
    });
});

describe('informe interanual (HTML)', () => {
    const modelo = construirInteranual({ ndvi, supVol }, { anios: [2021, 2022, 2023, 2024], modulos: [1, 2] }, ctx);
    const html = construirHtmlInteranual(modelo, { srl: 'data:image/png;base64,AAAA', sica: '' });
    it('tiene 4 hojas, logo SRL, S/D y nota de frontera; sin NaN/undefined ni "un solo ciclo"', () => {
        expect((html.match(/class="pagina"/g) ?? []).length).toBe(4);
        expect(html).toContain('S R L');
        expect(html).toContain('data:image/png;base64,AAAA');
        expect(html).toContain('frontera completa de cada módulo');
        expect(html).toContain('S/D');
        expect(html).not.toMatch(/NaN|undefined|Infinity/);
        expect(html.toLowerCase()).not.toContain('un solo ciclo');
    });
    it('svgPulso omite la banda con menos de 3 años y no dibuja nada para nulos', () => {
        const s = svgPulso({ anios: [2021], anioFoco: 2021, series: [{ anio: 2021, vals: [null, null, null, null, null, null, null] }], clim: [], titulo: 't' }, { w: 300, h: 130 });
        expect(s).toContain('<svg');
        expect(s).not.toContain('<circle');
    });
});

describe('informe interanual: media junto al pico', () => {
    it('el modelo trae la media de temporada por año y los años sin NDVI / sin superficie derivados de los datos', () => {
        const m = construirInteranual({ ndvi, supVol }, { anios: [2020, 2021, 2022, 2023, 2024], modulos: [1, 2] }, ctx);
        expect(m.mediaSrlPorAnio.find((x) => x.anio === 2021)).toMatchObject({ n: 2 });
        expect(m.mediaSrlPorAnio.find((x) => x.anio === 2020)).toEqual({ anio: 2020, media: null, n: 0 });
        expect(m.aniosSinNdvi).toEqual([2020]);
        expect(m.aniosSinSupVol).toEqual([2020, 2024]);
    });
    it('el HTML muestra la tabla de medias y la sección de superficie/volumen usa la media, no el pico', () => {
        const m = construirInteranual({ ndvi, supVol }, { anios: [2021, 2022, 2023, 2024], modulos: [1, 2] }, ctx);
        const h = construirHtmlInteranual(m, { srl: '', sica: '' });
        expect(h).toContain('Media de NDVI de la temporada (mar–sep)');
        expect(h).not.toContain('Pico de NDVI del año');
        expect(h).not.toMatch(/NaN|undefined|null/);
        expect(h).not.toContain('2020 no tiene NDVI'); // texto fijo eliminado: se deriva de los datos
    });
    it('la leyenda de la gráfica general no promete "promedio de los otros años" si no se dibuja', () => {
        const m = construirInteranual({ ndvi, supVol }, { anios: [2023, 2024], modulos: [1] }, ctx);
        const h = construirHtmlInteranual(m, { srl: '', sica: '' });
        const hojaA = h.slice(0, h.indexOf('Un año contra los demás, módulo por módulo'));
        expect(hojaA).not.toContain('Promedio de los otros años');
    });
});

describe('config: ciclo e interanual', () => {
    it("preset 'ciclo' no arrastra oct–feb ni ciclos anteriores", () => {
        const meses = ['2025-11', '2025-12', '2026-01', '2026-03', '2026-04', '2026-09', '2026-10'];
        expect(rangoDePreset('ciclo', meses)).toEqual({ desde: '2026-03', hasta: '2026-10' });
    });
    it('el aviso de un solo año desaparece si la serie abarca más de un año', () => {
        const base = { ...configPorDefecto(['2026-03']), modo: 'comparativo' as const };
        const uno = avisosConfig(base, [{ mes: '2026-03', numero_modulo: 1 }]);
        const varios = avisosConfig(base, [{ mes: '2025-03', numero_modulo: 1 }, { mes: '2026-03', numero_modulo: 1 }]);
        expect(uno.some((a) => a.includes('un solo año'))).toBe(true);
        expect(varios.some((a) => a.includes('un solo año'))).toBe(false);
    });
});
