import { describe, expect, it } from 'vitest';
import { ANIOS_CON_INFORME, ANIOS_REFERENCIA, RANGO_ACUM, RANGO_INFORME, TEXTO_SIN_CICLO, estadoAnio, listaAnios, rotuloAnio } from './estadoAnio';
import { cruceAnual, type FilaNdviV2, type FilaSupVol } from './ndviInteranual';
import { relacionVolumenNdvi, type VolumenActual } from './ndviVolumen';
import { construirInteranual } from './informeNdviInteranual';
import { matricesSupVolHtml } from './informeNdviInteranualHtml';
import { construirHtmlVolumenCultivo } from './informeVolumenCultivoHtml';
import {
    barrasSuperficieAnual, barrasVolumenAnual, cifraContraste, composicionAnual, contrasteRegimenes, fraseContrasteSuperficie, kpiCiclo, kpiLamina, kpiMezcla, laminaPorCultivo, lecturaVsTipico,
    listaAtipicos, matrizModuloAnio, mezclaCultivos, referenciaCicloActual, topConOtros,
} from './volumenCultivo';

const sv = (anio: number, modulo: number, cultivo: string, ha: number | null, miles: number | null, atipico = false): FilaSupVol =>
    ({ anio, numero_modulo: modulo, cultivo, superficie_ha: ha, volumen_miles_m3: miles, atipico });
const nd = (mes: string, v: number, modulo = 1): FilaNdviV2 => ({
    numero_modulo: modulo, mes, ndvi_mediana: v, ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: null, n_escenas: 4, pct_pixeles_validos: 1, superficie_ha: 100,
});

// Superficie por año: 2020 y 2023 altos; 2021, 2022 y 2024 bajos.
const FILAS: FilaSupVol[] = [
    sv(2020, 1, 'Alfalfa', 3000, 40000), sv(2020, 1, 'Nogal', 1400, 18000),
    sv(2021, 1, 'Alfalfa', 1500, 9000), sv(2021, 1, 'Nogal', 1400, 9900),
    sv(2022, 1, 'Alfalfa', 1800, 14000), sv(2022, 1, 'Nogal', 1500, 13000),
    sv(2023, 1, 'Alfalfa', 3200, 38000), sv(2023, 1, 'Nogal', 1600, 19000),
    sv(2024, 1, 'Alfalfa', 1700, 20000), sv(2024, 1, 'Nogal', 1500, 13000),
];
// Un renglón 2025 con 0 (captura de la fuente) no debe contar como dato.
const CON_2025_CERO: FilaSupVol[] = [...FILAS, sv(2025, 1, 'Alfalfa', 0, 0), sv(2025, 1, 'Nogal', 0, 0)];

describe('estadoAnio: catálogo único', () => {
    it('2020-2024 y 2026 con informe; 2025 sin ciclo; años posteriores provisionales; faltante real = sd', () => {
        expect(ANIOS_CON_INFORME).toEqual([2020, 2021, 2022, 2023, 2024, 2026]);
        for (const a of ANIOS_CON_INFORME) expect(estadoAnio(a).id).toBe('con-informe');
        expect(estadoAnio(2025).id).toBe('sin-ciclo');
        expect(estadoAnio(2027).id).toBe('provisional');
        expect(estadoAnio(2020, true).id).toBe('sd');
    });
    it('la referencia («año típico») son solo 2020-2024: 2026 se compara contra ella, no la forma', () => {
        expect(ANIOS_REFERENCIA).toEqual([2020, 2021, 2022, 2023, 2024]);
        expect(RANGO_ACUM).toBe('2020-2026');
    });
    it('solo los años con informe entran a mediana y ajuste', () => {
        expect(estadoAnio(2022)).toMatchObject({ entraAMediana: true, entraAAjuste: true, tieneVolumen: true });
        expect(estadoAnio(2025)).toMatchObject({ entraAMediana: false, entraAAjuste: false, tieneVolumen: false });
        expect(estadoAnio(2026)).toMatchObject({ entraAMediana: true, entraAAjuste: true, tieneVolumen: true });
        expect(estadoAnio(2027)).toMatchObject({ entraAMediana: false, entraAAjuste: false, tieneVolumen: true });
    });
    it('2025 nunca es sd, aunque se marque como faltante', () => {
        expect(estadoAnio(2025, true).id).toBe('sin-ciclo');
        expect(estadoAnio(2025).etiqueta).toBe('Sin ciclo: presas cerradas');
    });
    it('rótulos y rango salen del catálogo', () => {
        expect(RANGO_INFORME).toBe('2020-2024');
        expect(rotuloAnio(2025)).toBe('2025 · Sin ciclo');
        expect(rotuloAnio(2026)).toBe('2026');
        expect(rotuloAnio(2027)).toBe('2027 · Provisional');
        expect(rotuloAnio(2023)).toBe('2023');
        expect(listaAnios([2021, 2022, 2024])).toBe('2021, 2022 y 2024');
        expect(listaAnios([2020])).toBe('2020');
    });
});

describe('2025 sin ciclo no entra a ningún cálculo', () => {
    it('un renglón 2025 con 0 se trata como sin ciclo: ni lámina, ni mezcla, ni contraste, ni matriz', () => {
        const lam = laminaPorCultivo(CON_2025_CERO, null);
        expect(lam.flatMap(s => s.celdas).some(c => c.anio === 2025)).toBe(false);
        expect(mezclaCultivos(CON_2025_CERO, null, 2025)).toEqual([]);
        expect(contrasteRegimenes(CON_2025_CERO, null)).toEqual(contrasteRegimenes(FILAS, null));
        expect(matrizModuloAnio(CON_2025_CERO, [1])[0].celdas.map(c => c.anio)).toEqual([2020, 2021, 2022, 2023, 2024]);
        expect(listaAtipicos(CON_2025_CERO).some(a => a.anio === 2025)).toBe(false);
        expect(kpiLamina(CON_2025_CERO, null).anio).toBe(2024);
        expect(kpiMezcla(CON_2025_CERO, null, 2024).altosVsBajos?.altos).toEqual([2020, 2023]);
    });
    it('la mediana y el rango de un módulo no cambian por un 2025 con 0', () => {
        const a = referenciaCicloActual(FILAS, null, [1])[0], b = referenciaCicloActual(CON_2025_CERO, null, [1])[0];
        expect(b.minHm3).toBe(a.minHm3);
        expect(b.medianaHm3).toBe(a.medianaHm3);
        expect(b.historico.map(h => h.anio)).toEqual([2020, 2021, 2022, 2023, 2024]);
        expect(b.minHm3).toBeGreaterThan(0);
    });
    it('cruceAnual de 2025: sinCiclo, volumen y superficie null (nunca 0), aunque llegue un renglón', () => {
        const c = cruceAnual([nd('2025-05', 0.6)], CON_2025_CERO, 1, 2025);
        expect(c.sinCiclo).toBe(true);
        expect(c.volumenHm3).toBeNull();
        expect(c.superficieHa).toBeNull();
        expect(c.mediaNdvi).toBeCloseTo(0.6, 6);
        expect(cruceAnual([], FILAS, 1, 2024).sinCiclo).toBe(false);
    });
    it('2025 con NDVI y sin volumen no entra al ajuste volumen–NDVI y no cuenta como «temporada incompleta»', () => {
        const ndvi: FilaNdviV2[] = [];
        for (const [anio, k] of [[2021, 0.8], [2022, 0.9], [2023, 1.0], [2024, 1.1], [2025, 0.2]] as const) for (const mm of ['03', '04', '05', '06', '07', '08']) ndvi.push(nd(`${anio}-${mm}`, 0.3 * k));
        const rel = relacionVolumenNdvi(ndvi, FILAS, null, 1);
        expect(rel.puntos.map(p => p.anio)).toEqual([2021, 2022, 2023, 2024]);
        expect(rel.n).toBe(4);
        expect(rel.sinCiclo).toEqual([2025]);
        expect(rel.excluidos).not.toContain(2025);
        expect(rel.aniosAjuste).toEqual([2021, 2022, 2023, 2024]);
        // el NDVI bajo de 2025 no mueve la recta
        const sin2025 = relacionVolumenNdvi(ndvi.filter(f => !f.mes.startsWith('2025')), FILAS, null, 1);
        expect(rel.pendiente).toBe(sin2025.pendiente);
    });
});

describe('modelo del informe NDVI: 2025 no es S/D', () => {
    const ndvi: FilaNdviV2[] = [];
    for (const anio of [2024, 2025]) for (const mm of ['03', '05', '07']) ndvi.push(nd(`${anio}-${mm}`, 0.5));
    const m = construirInteranual({ ndvi, supVol: FILAS }, { anios: [2024, 2025], modulos: [1], base: 'simple' });
    it('lo reporta como año sin ciclo, no como faltante', () => {
        expect(m.aniosSinCiclo).toEqual([2025]);
        expect(m.aniosSinSupVol).not.toContain(2025);
        expect(m.avisos.some(a => a.includes('2025') && a.includes('sin ciclo de riego') && a.includes('no es un dato faltante'))).toBe(true);
        expect(m.avisos.some(a => /Sin informe de superficie y volumen para .*2025/.test(a))).toBe(false);
    });
    it('la columna 2025 de las matrices dice «Sin ciclo», no S/D ni 0, y el NDVI sí se muestra', () => {
        const html = matricesSupVolHtml(m);
        expect(html).toContain('Sin ciclo');
        expect(html).toContain('no mide riego de presa');
        const [sup, vol] = html.split('<caption>').slice(1, 3);
        for (const t of [sup, vol]) { expect(t).toContain('<i>Sin ciclo</i>'); expect(t).not.toMatch(/2025[^<]*S\/D/); }
    });
});

describe('atípicos y capturas en cero', () => {
    it('volumen 0 con superficie = captura atípica: no entra a la lámina ni a la media, pero se cuenta como cifra por revisar', () => {
        const filas = [sv(2020, 1, 'Sorgo', 300, 3000), sv(2021, 1, 'Sorgo', 300, 0, true), sv(2022, 1, 'Sorgo', 300, 3300)];
        const s = laminaPorCultivo(filas, null)[0];
        const c21 = s.celdas.find(c => c.anio === 2021)!;
        expect(c21.capturaCero).toBe(true);
        expect(c21.laminaCm).toBeNull();
        expect(s.mediaLaminaCm).toBeCloseTo(105, 0);
        const k = kpiLamina(filas, null);
        expect(k.alertas).toBe(1);
        expect(listaAtipicos(filas)[0].motivos.join(' ')).toContain('volumen 0');
    });
});

describe('frases de lectura (derivadas de los datos)', () => {
    it('superficie: «En 2020 y 2023 se regó … que en 2021, 2022 y 2024»', () => {
        const av = kpiMezcla(FILAS, null, 2024).altosVsBajos;
        const frase = fraseContrasteSuperficie(av)!;
        expect(frase.startsWith('En 2020 y 2023 se regó ')).toBe(true);
        expect(frase).toContain('que en 2021, 2022 y 2024.');
        expect(frase).not.toMatch(/×|razón|\bpp\b|porque|por eso|explica/);
        expect(fraseContrasteSuperficie(null)).toBeNull();
    });
    it('el cuantificador sale de la razón real', () => {
        const mk = (veces: number) => ({ altosHa: veces * 100, bajosHa: 100, veces, altos: [2020], bajos: [2021] });
        expect(fraseContrasteSuperficie(mk(2.3))).toContain('más del doble de superficie');
        expect(fraseContrasteSuperficie(mk(2.0))).toContain('el doble de superficie');
        expect(fraseContrasteSuperficie(mk(1.7))).toContain('casi el doble de superficie');
        expect(fraseContrasteSuperficie(mk(1.55))).toContain('1.6 veces la superficie');
        expect(cifraContraste(mk(2.3))).toBe('Más del doble');
        expect(cifraContraste(null)).toBeNull();
    });
    it('ciclo actual frente a un año típico: menos/más, sin causa; 2025 no cuenta', () => {
        const l = lecturaVsTipico(-18.4)!;
        expect(l.cifra).toBe('18 % menos');
        expect(l.frase).toContain('Menos agua que un año típico 2020-2024');
        expect(l.frase).toContain('2025 no cuenta: las presas estuvieron cerradas');
        expect(l.frase).not.toMatch(/ahorro|sequ[ií]a|por eso|explica/i);
        expect(lecturaVsTipico(7.6)!.cifra).toBe('8 % más');
        expect(lecturaVsTipico(0.2)!.tendencia).toBe('igual');
        expect(lecturaVsTipico(null)).toBeNull();
    });
    it('texto único de sin ciclo', () => {
        expect(TEXTO_SIN_CICLO).toContain('Sin ciclo');
        expect(TEXTO_SIN_CICLO).toContain('No es un dato faltante');
    });
});

describe('gráficas: datos para barras', () => {
    const ACTUAL: VolumenActual = { porModulo: new Map([[1, 40], [2, 10]]), mesesPorModulo: new Map([[1, 7], [2, 7]]), mesesParciales: [], error: null };
    it('barras por año: 2025 hueco (valor null) y 2026 provisional con la suma de módulos', () => {
        const b = barrasVolumenAnual(FILAS, ACTUAL, null, [1, 2, 3]);
        expect(b.map(x => x.anio)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        const b25 = b.find(x => x.anio === 2025)!;
        expect(b25.estado).toBe('sin-ciclo');
        expect(b25.valor).toBeNull();
        const b26 = b.find(x => x.anio === 2026)!;
        expect(b26.estado).toBe('provisional');
        expect(b26.valor).toBe(50);
        expect(b26.incompleto).toBe(true); // el módulo 3 no tiene meses
    });
    it('2026 sin lectura: faltante real (sd), nunca 0', () => {
        const b = barrasVolumenAnual(FILAS, null, null, [1]);
        expect(b[b.length - 1]).toMatchObject({ anio: 2026, estado: 'sd', valor: null });
    });
    it('superficie por año: 2025 hueco y sin barra de 2026', () => {
        const b = barrasSuperficieAnual(FILAS, null);
        expect(b.map(x => x.anio)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
        expect(b[5]).toMatchObject({ estado: 'sin-ciclo', valor: null });
        expect(b[0].valor).toBe(4400);
    });
    it('con el informe 2026 cargado: barra sólida de 2026 desde ACUM_INF, en orden, sin duplicar con la hoja SRL', () => {
        const F26 = [...FILAS, sv(2026, 1, 'Alfalfa', 1800, 21000), sv(2026, 1, 'Nogal', 1500, 14000)];
        const b = barrasVolumenAnual(F26, ACTUAL, null, [1, 2]);
        expect(b.map(x => x.anio)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(b[6]).toMatchObject({ anio: 2026, estado: 'con-informe', valor: 35 });
        expect(barrasSuperficieAnual(F26, null).map(x => x.anio)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    });
    it('con el informe 2026: la composición lo trae con desglose y 2025 queda entre 2024 y 2026', () => {
        const F26 = [...FILAS, sv(2026, 1, 'Alfalfa', 1800, 21000), sv(2026, 1, 'Nogal', 1500, 14000)];
        const c = composicionAnual(F26, null, 'volumen');
        expect(c.filas.map(f => `${f.anio}:${f.estado}`)).toEqual(['2020:con-informe', '2021:con-informe', '2022:con-informe', '2023:con-informe', '2024:con-informe', '2025:sin-ciclo', '2026:con-informe']);
        expect(c.filas[6].total).toBeCloseTo(35, 5);
        expect(composicionAnual(FILAS, null, 'volumen').filas.at(-1)).toMatchObject({ anio: 2026, estado: 'sin-desglose', total: null });
    });
    it('el ciclo 2026 se compara contra 2020-2024: su propio informe no entra al rango y se devuelve aparte', () => {
        const F26 = [...FILAS, sv(2026, 1, 'Alfalfa', 1800, 21000), sv(2026, 1, 'Nogal', 1500, 14000)];
        const [r] = referenciaCicloActual(F26, { porModulo: new Map([[1, 34]]), mesesPorModulo: new Map([[1, 7]]), mesesParciales: [], error: null }, [1]);
        expect(r.historico.map(h => h.anio)).toEqual([2020, 2021, 2022, 2023, 2024]);
        expect(r.maxHm3).toBe(58); // 2020: 40000 + 18000 miles m³; 2026 (35 hm³) no entra
        expect(r.informeHm3).toBeCloseTo(35, 5);
        // Se compara con la misma fuente de la referencia (ACUM_INF); la hoja SRL queda como contraste.
        expect(r).toMatchObject({ fuenteActual: 'informe', srlHm3: 34 });
        expect(r.actualHm3).toBeCloseTo(35, 5);
        expect(r.actualIncompleto).toBe(false);
        expect(r.difSrlInformeHm3).toBeCloseTo(-1, 5);
        // Sin informe del último año, el hueco lo cubre la hoja SRL (provisional).
        const sinInforme = referenciaCicloActual(FILAS, { porModulo: new Map([[1, 34]]), mesesPorModulo: new Map([[1, 7]]), mesesParciales: [], error: null }, [1])[0];
        expect(sinInforme).toMatchObject({ fuenteActual: 'srl', actualHm3: 34, informeHm3: null, difSrlInformeHm3: null });
        expect(referenciaCicloActual(FILAS, null, [1])[0]).toMatchObject({ fuenteActual: null, actualHm3: null, informeHm3: null, difSrlInformeHm3: null });
    });
    it('sin renglones no inventa años', () => {
        expect(barrasVolumenAnual([], ACTUAL, null, [1])).toEqual([]);
        expect(barrasSuperficieAnual([], null)).toEqual([]);
    });
    it('top 5 + «Otros»: ordenado, suma 100 y los cultivos agrupados se listan', () => {
        const filas = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => sv(2024, 1, c, 100, (7 - i) * 1000));
        const t = topConOtros(mezclaCultivos(filas, null, 2024), 'volumen', 5);
        expect(t).toHaveLength(6);
        expect(t.map(x => x.nombre).slice(0, 5)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(t[5]).toMatchObject({ nombre: 'Otros 2 cultivos', esOtros: true, cultivos: ['F', 'G'] });
        expect(t.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 6);
        expect(t[0].pct).toBeGreaterThan(t[4].pct);
    });
    it('el KPI de ciclo no cambia por 2025', () => {
        const k1 = kpiCiclo(referenciaCicloActual(FILAS, ACTUAL, [1]));
        const k2 = kpiCiclo(referenciaCicloActual(CON_2025_CERO, ACTUAL, [1]));
        expect(k2).toEqual(k1);
    });
});

describe('informe: textos de sin ciclo', () => {
    const html = construirHtmlVolumenCultivo({
        filas: CON_2025_CERO, volumenActual: { porModulo: new Map([[1, 50]]), mesesPorModulo: new Map([[1, 7]]), mesesParciales: [], error: null },
        errorSupVol: null, emisor: 'Prueba', emitidoEn: new Date(2026, 10, 3, 10, 30), version: '9.9.9',
    }, { srl: 'data:image/svg+xml;base64,AAAA', sica: 'data:image/svg+xml;base64,BBBB' });
    const texto = html.replace(/<[^>]+>/g, ' ');
    it('explica 2025 como sin ciclo y no como faltante', () => {
        expect(texto).toContain('2025: sin ciclo de riego');
        expect(texto).toContain('No es un dato faltante');
        expect(texto).not.toMatch(/2025[^.]{0,40}S\/D/);
        expect(texto).not.toMatch(/No hay informe de 2025|Sin informe ACUM_INF/);
    });
    it('sin jerga prohibida en el resumen', () => {
        expect(texto).not.toMatch(/\d\.\d×|\bpp\b|razón|Diferencia \(pp\)/);
        expect(texto).toContain('Cambio de superficie entre años');
        expect(texto).toContain('puntos de %');
    });
    it('2025 con 0 no cambia el contenido del informe más allá del aviso (mismos renglones útiles)', () => {
        expect(texto).toContain('Renglones de ACUM_INF');
        expect(html).toContain('Años cubiertos</th><td>2020, 2021, 2022, 2023, 2024</td>');
    });
});
