import { describe, it, expect } from 'vitest';
import { construirInteranual, aniosConNdvi } from './informeNdviInteranual';
import { claveEstadoVol, fraseInteranual, lecturaVolumenModulosHtml, matricesSupVolHtml, svgPulso, tablaPicosHtml } from './informeNdviInteranualHtml';
import { avisosConfig, configPorDefecto, rangoDePreset } from './informeNdviConfig';
import type { FilaNdviV2, FilaSupVol } from './ndviInteranual';
import { relacionVolumenNdvi, type VolumenActual } from './ndviVolumen';

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
const cfg = (anios: number[], modulos: number[], base: 'simple' | 'ponderado' = 'simple') => ({ anios, modulos, base });

describe('comparación entre años (modelo)', () => {
    it('año sin informe de superficie/volumen queda S/D, no 0, y se avisa', () => {
        const m = construirInteranual({ ndvi, supVol }, cfg([2021, 2022, 2023, 2024], [1, 2]));
        const m1 = m.modulos.find((x) => x.numero === 1)!;
        expect(m1.cruce.find((c) => c.anio === 2024)!.volumenHm3).toBeNull();
        expect(m1.cruce.find((c) => c.anio === 2023)!.laminaM3Ha).toBe(7000);
        expect(m.avisos.some((a) => a.includes('Sin informe de superficie y volumen para 2024'))).toBe(true);
        expect(m.avisos.some((a) => a.includes('atípica'))).toBe(true);
        // Concordancia de número: un solo renglón atípico no se escribe «renglón(es) … tienen».
        expect(m.avisos).toContain('1 renglón del informe de superficie y volumen tiene captura atípica en la fuente: se suman tal cual y se marcan con ⚠.');
    });
    it('el año de interés es el último y la banda sale de los otros', () => {
        const m = construirInteranual({ ndvi, supVol }, cfg([2024, 2021, 2022, 2023], [1]));
        expect(m.anioFoco).toBe(2024);
        expect(m.modulos[0].lectura.direccion).toBe('arriba');
        expect(m.conteo.arriba).toBe(1);
        expect(aniosConNdvi(ndvi)).toEqual([2021, 2022, 2023, 2024]);
    });
    it('2020 sin NDVI aparece S/D y con aviso', () => {
        const m = construirInteranual({ ndvi, supVol: [sv(2020, 1, 900, 4000), ...supVol] }, cfg([2020, 2021, 2022], [1]));
        expect(m.modulos[0].resumenes[0].pico).toBeNull();
        expect(m.avisos.some((a) => a.startsWith('2020 no tiene NDVI'))).toBe(true);
    });
    it('el modelo trae la media de temporada por año y los años sin NDVI / sin superficie derivados de los datos', () => {
        const m = construirInteranual({ ndvi, supVol }, cfg([2020, 2021, 2022, 2023, 2024], [1, 2]));
        expect(m.mediaSrlPorAnio.find((x) => x.anio === 2021)).toMatchObject({ n: 2 });
        expect(m.mediaSrlPorAnio.find((x) => x.anio === 2020)).toEqual({ anio: 2020, media: null, n: 0 });
        expect(m.aniosSinNdvi).toEqual([2020]);
        expect(m.aniosSinSupVol).toEqual([2020, 2024]);
    });
    it('error al consultar superficie y volumen: todos los años quedan S/D y se avisa', () => {
        const m = construirInteranual({ ndvi, supVol: [], errorSupVol: true }, cfg([2023, 2024], [1]));
        expect(m.aniosSinSupVol).toEqual([2023, 2024]);
        expect(m.avisos.some((a) => a.includes('No se pudo consultar el informe de superficie y volumen'))).toBe(true);
    });
    it('el promedio SRL por año respeta la base elegida (ponderado por superficie del polígono)', () => {
        // Módulo 2 pesa 9 veces más que el 1 y vale el doble: el ponderado se acerca a él.
        const datos = [
            ...[2021, 2022, 2023].flatMap((a) => ['03', '05', '07'].map((mm) => f(`${a}-${mm}`, 0.2, 1, { superficie_ha: 100 }))),
            ...[2021, 2022, 2023].flatMap((a) => ['03', '05', '07'].map((mm) => f(`${a}-${mm}`, 0.4, 2, { superficie_ha: 900 }))),
        ];
        const s = construirInteranual({ ndvi: datos, supVol: [] }, cfg([2021, 2022, 2023], [1, 2], 'simple'));
        const p = construirInteranual({ ndvi: datos, supVol: [] }, cfg([2021, 2022, 2023], [1, 2], 'ponderado'));
        expect(s.picoSrlPorAnio[0].pico).toBeCloseTo(0.3, 9);
        expect(p.picoSrlPorAnio[0].pico).toBeCloseTo(0.38, 9);
        expect(p.mediaSrlPorAnio[0].media).toBeCloseTo(0.38, 9);
        expect(p.serieSrl[0].vals[0]).toBeCloseTo(0.38, 9);
        expect(p.base).toBe('ponderado');
    });
});

describe('comparación entre años (bloques HTML)', () => {
    const modelo = construirInteranual({ ndvi, supVol }, cfg([2021, 2022, 2023, 2024], [1, 2]));
    it('frase con el conteo, los años de referencia y la advertencia de que es descriptiva', () => {
        const t = fraseInteranual(modelo);
        expect(t).toMatch(/En 2024, \d de 2 módulos van por encima/);
        expect(t).toContain('Lectura descriptiva con 3 años de referencia');
        expect(fraseInteranual(construirInteranual({ ndvi: [], supVol: [] }, cfg([2023, 2024], [1])))).toContain('No hay datos suficientes');
    });
    it('tabla de picos: S/D visible, promedio rotulado con su base, umbrales de ⚠ desde constantes', () => {
        const t = tablaPicosHtml(construirInteranual({ ndvi, supVol }, cfg([2020, 2021, 2022], [1, 2], 'ponderado')));
        expect(t).toContain('S/D');
        expect(t).toContain('ponderado por superficie');
        expect(t).toMatch(/menos de 2 pasos de satélite limpios o menos de 50 % de píxeles válidos/);
        expect(t).not.toMatch(/NaN|undefined|null/);
    });
    it('matrices de superficie y volumen: rotulan la superficie regada (ACUM_INF) y marcan S/D sin 0', () => {
        const h = matricesSupVolHtml(modelo);
        expect(h).toContain('Superficie regada (informe ACUM_INF, ha)');
        expect(h).toContain('no es la superficie del polígono del módulo');
        expect(h).toContain('Media de NDVI de la temporada (mar–sep)');
        expect(h).toContain('class="n sd">S/D');
        expect(h).not.toMatch(/NaN|undefined|null/);
        expect(h).not.toContain('Pico de NDVI del año');
    });
    it('la matriz de lámina (m³/ha) ya no se imprime: es redundante con volumen y superficie', () => {
        const h = matricesSupVolHtml(modelo);
        expect(h).not.toContain('Lámina entregada');
        expect(h).toContain('Volumen entregado (hm³)');
    });
    it('svgPulso omite la banda con menos de 3 años y no dibuja nada para nulos', () => {
        const s = svgPulso({ anios: [2021], anioFoco: 2021, series: [{ anio: 2021, vals: [null, null, null, null, null, null, null] }], clim: [], titulo: 't' }, { w: 300, h: 130 });
        expect(s).toContain('<svg');
        expect(s).not.toContain('<circle');
    });
    it('svgPulso en ficha (mini): con banda típica no traza cada año previo y pesa mucho menos', () => {
        const vals = (k: number) => [0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4].map((v) => v + k);
        const m = {
            anios: [2021, 2022, 2023, 2024], anioFoco: 2024, titulo: 't',
            series: [2021, 2022, 2023, 2024].map((a, i) => ({ anio: a, vals: vals(i * 0.01) })),
            clim: vals(0).map((v) => ({ media: v, p10: v - 0.03, p90: v + 0.03 })),
        };
        const mini = svgPulso(m, { w: 300, h: 118, mini: true });
        const completo = svgPulso(m, { w: 300, h: 118 });
        expect((mini.match(/<path /g) ?? []).length).toBe(4); // banda, promedio, halo blanco y año de interés
        expect((completo.match(/<path /g) ?? []).length).toBe(7);
        expect(mini.length).toBeLessThan(completo.length * 0.7);
        expect(mini).toContain('>2024<');
    });
});

describe('config: ciclo y años', () => {
    it("preset 'ciclo' no arrastra oct–feb ni ciclos anteriores", () => {
        const meses = ['2025-11', '2025-12', '2026-01', '2026-03', '2026-04', '2026-09', '2026-10'];
        expect(rangoDePreset('ciclo', meses)).toEqual({ desde: '2026-03', hasta: '2026-10' });
    });
    it('el aviso de un solo año desaparece si la serie abarca más de un año', () => {
        const base = configPorDefecto(['2026-03']);
        const uno = avisosConfig(base, [{ mes: '2026-03', numero_modulo: 1 }]);
        const varios = avisosConfig(base, [{ mes: '2025-03', numero_modulo: 1 }, { mes: '2026-03', numero_modulo: 1 }]);
        expect(uno.some((a) => a.includes('un solo año'))).toBe(true);
        expect(varios.some((a) => a.includes('un solo año'))).toBe(false);
    });
});

describe('anexo B: lectura por módulo del volumen contra el NDVI', () => {
    // M1 sube con el volumen (4 años); M2 baja (sin relación); 2026 aparte, con volumen provisional.
    const nd: FilaNdviV2[] = [];
    const nivel: Record<number, number[]> = { 1: [0.2, 0.25, 0.3, 0.35, 0.3], 2: [0.4, 0.3, 0.38, 0.28, 0.2] };
    for (const m of [1, 2]) [2021, 2022, 2023, 2024, 2026].forEach((a, i) => { for (const mm of ['03', '04', '05', '06', '07', '08', '09']) nd.push(f(`${a}-${mm}`, nivel[m][i], m)); });
    const sup: FilaSupVol[] = [];
    [2021, 2022, 2023, 2024].forEach((a, i) => { sup.push(sv(a, 1, 1000, 5000 + i * 1000), sv(a, 2, 1000, 5000 + i * 1000)); });
    const vol = (error: string | null = null): VolumenActual => ({ porModulo: new Map([[1, 9.5]]), mesesPorModulo: new Map([[1, 7]]), mesesParciales: [], error });
    const rv = (va: VolumenActual | null) => ({ rels: [1, 2].map((m) => relacionVolumenNdvi(nd, sup, va, m)), incluyeActual: true, errorVolumenActual: va == null ? 'no se cargó' : va.error });

    it('cada módulo con estado en texto y símbolo, r con signo, años y +10 hm³; sin color', () => {
        const h = lecturaVolumenModulosHtml(rv(vol()));
        expect(h).toMatch(/M1<\/b>/);
        expect(h).toMatch(/[●◐] (Firme|Indicativa)/);
        expect(h).toMatch(/○ Sin relación/);
        expect(h).toMatch(/\+0\.\d\d/);
        expect(h).toMatch(/−0\.\d\d/);
        expect(h).toContain('no aplica');
        expect(h).not.toMatch(/style="[^"]*color|#[0-9a-f]{6}/i);
        expect(h).not.toMatch(/NaN|undefined|null/);
    });
    it('el punto 2026 es provisional y fuera del ajuste; un módulo sin volumen 2026 queda S/D, nunca 0', () => {
        const h = lecturaVolumenModulosHtml(rv(vol()));
        expect(h).toContain('2026 provisional (fuera del ajuste)');
        expect(h).toMatch(/9\.5 hm³ · [▲▼] [+−]0\.\d\d vs recta/);
        expect(h).toMatch(/<td><span class="sd">S\/D<\/span><\/td><\/tr>/); // M2 no tiene volumen 2026
        expect(h).not.toMatch(/0\.0 hm³/);
    });
    it('si la hoja SRL falla: aviso con el motivo y todo el 2026 en S/D', () => {
        const h = lecturaVolumenModulosHtml(rv({ porModulo: new Map(), mesesPorModulo: new Map(), mesesParciales: [], error: 'sin red' }));
        expect(h).toContain('No se pudo leer el volumen 2026 de la hoja SRL (sin red)');
        expect(h.match(/<span class="sd">S\/D<\/span>/g)?.length).toBe(2);
    });
    it('sin 2026 entre los años elegidos no hay columna del año actual', () => {
        const h = lecturaVolumenModulosHtml({ ...rv(vol()), incluyeActual: false });
        expect(h).not.toContain('provisional (fuera del ajuste)');
    });
    it('claveEstadoVol distingue los cuatro estados', () => {
        const poco = relacionVolumenNdvi(nd, sup.slice(0, 2), null, 1);
        expect(claveEstadoVol(poco)).toBe('sin-evidencia');
        expect(['firme', 'indicativa']).toContain(claveEstadoVol(rv(null).rels[0]));
        expect(claveEstadoVol(rv(null).rels[1])).toBe('sin-relacion');
    });
});
