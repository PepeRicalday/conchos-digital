import { describe, it, expect, beforeEach, vi } from 'vitest';
import { r2CriticoAlfa05 } from './estadisticaHistorica';
import { MESES_TEMPORADA, type FilaNdviV2, type FilaSupVol } from './ndviInteranual';

// indicesSrl importa el cliente de Supabase; las pruebas puras no lo necesitan.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import {
    cargarVolumenActual, escalaEje, fraseActual, fraseRelacion, lecturaGeneral, relacionVolumenNdvi, reiniciarCacheVolumenActual, type VolumenActual,
} from './ndviVolumen';

// Matriz real (BD viva, 2026-10): volumen ACUM_INF (hm³) y NDVI medio mar–sep 2021–2024 por módulo; 2026 = hoja SRL + NDVI v2.
const MATRIZ: Record<number, { vol: number[]; ndvi: number[]; vol26: number; ndvi26: number }> = {
    1: { vol: [18.9, 27.4, 57.0, 33.0], ndvi: [0.289, 0.267, 0.309, 0.277], vol26: 30.2, ndvi26: 0.2275 },
    2: { vol: [24.7, 32.5, 73.6, 40.8], ndvi: [0.369, 0.366, 0.430, 0.387], vol26: 30.8, ndvi26: 0.2892 },
    3: { vol: [23.4, 34.1, 70.3, 40.6], ndvi: [0.421, 0.401, 0.474, 0.471], vol26: 29.2, ndvi26: 0.3892 },
    4: { vol: [30.0, 40.1, 79.8, 51.9], ndvi: [0.264, 0.224, 0.243, 0.209], vol26: 45.5, ndvi26: 0.1673 },
    5: { vol: [43.5, 63.2, 130.8, 79.1], ndvi: [0.276, 0.265, 0.309, 0.268], vol26: 60.9, ndvi26: 0.1871 },
    12: { vol: [15.2, 20.0, 45.6, 25.0], ndvi: [0.527, 0.504, 0.567, 0.528], vol26: 24.6, ndvi26: 0.4308 },
};
const ANIOS = [2021, 2022, 2023, 2024];

const fila = (modulo: number, mes: string, v: number | null): FilaNdviV2 => ({
    numero_modulo: modulo, mes, ndvi_mediana: v, ndvi_p10: null, ndvi_p90: null, fraccion_cobertura_activa: null,
    n_escenas: 4, pct_pixeles_validos: 1, superficie_ha: 100,
});
const ndviDe = (modulo: number, extra: Partial<Record<number, (number | null)[]>> = {}): FilaNdviV2[] => {
    const out: FilaNdviV2[] = [];
    const m = MATRIZ[modulo];
    ANIOS.forEach((a, i) => MESES_TEMPORADA.forEach(t => out.push(fila(modulo, `${a}-${t}`, m.ndvi[i]))));
    const v26 = extra[2026] ?? MESES_TEMPORADA.map(() => m.ndvi26);
    MESES_TEMPORADA.forEach((t, i) => out.push(fila(modulo, `2026-${t}`, v26[i])));
    return out;
};
const supVolDe = (modulo: number, atipico = false): FilaSupVol[] =>
    ANIOS.map((a, i) => ({ anio: a, numero_modulo: modulo, cultivo: 'X', superficie_ha: 1000, volumen_miles_m3: MATRIZ[modulo].vol[i] * 1000, atipico }));
const volActual = (over: Partial<VolumenActual> = {}): VolumenActual => ({
    porModulo: new Map(Object.entries(MATRIZ).map(([m, d]) => [Number(m), d.vol26])),
    mesesPorModulo: new Map(Object.keys(MATRIZ).map(m => [Number(m), 7])), mesesParciales: [], error: null, ...over,
});
const rel = (m: number, v: VolumenActual | null = volActual()) => relacionVolumenNdvi(ndviDe(m), supVolDe(m), v, m);

describe('relacionVolumenNdvi — matriz real', () => {
    it('M2: acompaña y es firme (r ≈ +0.98)', () => {
        const r = rel(2);
        expect(r.n).toBe(4);
        expect(r.r).toBeCloseTo(0.98, 2);
        expect(r.estado).toBe('acompaña');
        expect(r.firme).toBe(true);
        expect(r.r2!).toBeGreaterThanOrEqual(r2CriticoAlfa05(4));
        expect(fraseRelacion(r)).toMatch(/con firmeza/);
    });

    it('M4: sin relación (r ≈ −0.18), con signo negativo', () => {
        const r = rel(4);
        expect(r.r).toBeCloseTo(-0.18, 2);
        expect(r.estado).toBe('sin-relacion');
        expect(r.firme).toBe(false);
        expect(fraseRelacion(r)).toMatch(/Sin relación visible/);
    });

    it('M1, M3, M5 y M12 acompañan pero ninguno es firme con 4 años', () => {
        for (const m of [1, 3, 5, 12]) {
            const r = rel(m);
            expect(r.estado, `M${m}`).toBe('acompaña');
            expect(r.firme, `M${m}`).toBe(false);
            expect(fraseRelacion(r)).toMatch(/aún no es firme/);
        }
        expect(rel(1).r).toBeCloseTo(0.69, 1);
        expect(rel(3).r).toBeCloseTo(0.72, 1);
        expect(rel(5).r).toBeCloseTo(0.84, 1);
        expect(rel(12).r).toBeCloseTo(0.87, 1);
    });

    it('el punto 2026 queda fuera del ajuste y se compara con la recta (M2) o con el promedio (M4)', () => {
        const r2 = rel(2);
        expect(r2.puntos.map(p => p.anio)).toEqual([2021, 2022, 2023, 2024]);
        expect(r2.actual).not.toBeNull();
        expect(r2.actual!.provisional).toBe(true);
        expect(r2.actual!.volumenHm3).toBeCloseTo(30.8, 6);
        expect(r2.actual!.referencia).toBe('recta');
        expect(r2.actual!.desviacion!).toBeLessThan(-0.05);
        // ajustar de nuevo sin 2026 da lo mismo: no entró al ajuste
        const sin26 = relacionVolumenNdvi(ndviDe(2).filter(f => !f.mes.startsWith('2026')), supVolDe(2), null, 2);
        expect(sin26.pendiente).toBe(r2.pendiente);
        const r4 = rel(4);
        expect(r4.actual!.referencia).toBe('promedio');
        expect(r4.actual!.volumenHm3).toBeCloseTo(45.5, 6);
        expect(r4.actual!.ndviMedio).toBeCloseTo(0.167, 3);
        expect(fraseActual(r4)).toMatch(/por debajo del promedio de los años anteriores/);
        expect(rel(2).actual!.fueraDeRango).toBe(false);
    });

    it('las frases no afirman causa', () => {
        const textos = [2, 4, 1].flatMap(m => [fraseRelacion(rel(m)), fraseActual(rel(m))]);
        for (const t of textos) expect(t).not.toMatch(/porque|debido a|causa|provoc|gracias a|por culpa/i);
    });
});

describe('relacionVolumenNdvi — S/D y casos límite', () => {
    it('con menos de 3 años: sin evidencia, sin recta', () => {
        const sv = supVolDe(2).filter(s => s.anio <= 2022);
        const r = relacionVolumenNdvi(ndviDe(2), sv, volActual(), 2);
        expect(r.n).toBe(2);
        expect(r.estado).toBe('sin-evidencia');
        expect(r.pendiente).toBeNull();
        expect(r.r).toBeNull();
        expect(r.firme).toBe(false);
        expect(fraseRelacion(r)).toMatch(/Sin evidencia.*hay 2/);
        expect(r.actual?.desviacion ?? null).toBeNull();
    });

    it('volumen 2026 ausente o nulo: sin punto actual y motivo, nunca 0', () => {
        const sinMod = volActual({ porModulo: new Map([[1, 30.2]]) });
        const r = rel(2, sinMod);
        expect(r.actual).toBeNull();
        expect(r.motivoSinActual).toMatch(/Sin volumen 2026/);
        expect(fraseActual(r)).toMatch(/S\/D/);
        const sinCargar = rel(2, null);
        expect(sinCargar.actual).toBeNull();
        expect(sinCargar.motivoSinActual).toMatch(/no cargado/);
        // el ajuste de los años anteriores no depende del punto actual
        expect(sinCargar.firme).toBe(true);
    });

    it('error de lectura del volumen: sin punto y mensaje que no confunde con cero', () => {
        const r = rel(2, volActual({ error: 'timeout', porModulo: new Map() }));
        expect(r.actual).toBeNull();
        expect(r.motivoSinActual).toMatch(/No se pudo leer.*timeout.*No significa que sea cero/);
    });

    it('sin NDVI 2026 no hay punto actual', () => {
        const r = relacionVolumenNdvi(ndviDe(2).filter(f => !f.mes.startsWith('2026')), supVolDe(2), volActual(), 2);
        expect(r.actual).toBeNull();
        expect(r.motivoSinActual).toMatch(/Sin NDVI 2026/);
    });

    it('volumen nulo de un año anterior: ese año no es punto (no se cuenta como 0)', () => {
        const sv = supVolDe(2).map(s => (s.anio === 2023 ? { ...s, volumen_miles_m3: null } : s));
        const r = relacionVolumenNdvi(ndviDe(2), sv, volActual(), 2);
        expect(r.puntos.map(p => p.anio)).toEqual([2021, 2022, 2024]);
        expect(r.puntos.every(p => p.volumenHm3 > 0)).toBe(true);
    });

    it('temporada de NDVI incompleta (< 6 meses): se excluye del ajuste y se informa', () => {
        const ndvi = ndviDe(2).filter(f => !(f.mes.startsWith('2022-') && ['06', '07', '08', '09'].includes(f.mes.slice(5))));
        const r = relacionVolumenNdvi(ndvi, supVolDe(2), volActual(), 2);
        expect(r.excluidos).toEqual([2022]);
        expect(r.puntos.map(p => p.anio)).toEqual([2021, 2023, 2024]);
    });

    it('atípico: se marca en el punto sin corregir la cifra', () => {
        const r = relacionVolumenNdvi(ndviDe(3), supVolDe(3, true), volActual(), 3);
        expect(r.puntos.every(p => p.atipico)).toBe(true);
        expect(r.puntos[0].volumenHm3).toBeCloseTo(23.4, 6);
        expect(rel(3).puntos.every(p => !p.atipico)).toBe(true);
    });

    it('mes parcial o ventana incompleta del volumen provisional: se avisa, no se mezcla en silencio', () => {
        const parcial = rel(4, volActual({ mesesParciales: ['2026-09'] }));
        expect(parcial.actual!.volumenIncompleto).toBe(true);
        expect(fraseActual(parcial)).toMatch(/Volumen incompleto/);
        const faltan = rel(4, volActual({ mesesPorModulo: new Map([[4, 5]]) }));
        expect(faltan.actual!.volumenIncompleto).toBe(true);
        expect(rel(4).actual!.volumenIncompleto).toBe(false);
    });

    it('volumen fuera del rango de los años comparados se marca', () => {
        const alto = volActual({ porModulo: new Map([[2, 120]]) });
        expect(rel(2, alto).actual!.fueraDeRango).toBe(true);
    });
});

describe('lecturaGeneral', () => {
    it('resume 5 de 6, único firme M2, excepción M4 y el año actual', () => {
        const rels = [1, 2, 3, 4, 5, 12].map(m => rel(m));
        const t = lecturaGeneral(rels);
        expect(t).toMatch(/en 5 de 6 módulos/);
        expect(t).toMatch(/solo 4 años/);
        expect(t).toMatch(/único firme: M2/);
        expect(t).toMatch(/Excepción: M4/);
        expect(t).toMatch(/2026 el NDVI quedó por debajo de lo esperado en los 6 módulos/);
        expect(t).not.toMatch(/porque|debido a|causa/i);
    });
    it('sin evidencia en todos: S/D', () => {
        expect(lecturaGeneral([relacionVolumenNdvi([], [], null, 1)])).toMatch(/S\/D/);
    });
});

describe('cargarVolumenActual — una sola consulta y error visible', () => {
    beforeEach(() => reiniciarCacheVolumenActual());
    const ok = async () => ({
        porModulo: new Map([[1, 30.2]]), ultimoMesEsParcial: false, error: null, mesesPorModulo: new Map([[1, 7]]), mesesParciales: [] as string[],
    });

    it('reutiliza la misma respuesta (sin consultas duplicadas) y usa la ventana mar–sep', async () => {
        const c = vi.fn(ok);
        const [a, b] = await Promise.all([cargarVolumenActual(2026, c), cargarVolumenActual(2026, c)]);
        expect(c).toHaveBeenCalledTimes(1);
        expect(c).toHaveBeenCalledWith('2026-09', '2026-03');
        expect(a).toBe(b);
        expect(a.porModulo.get(1)).toBe(30.2);
    });

    it('un fallo se devuelve como error, no se cachea y no produce cero', async () => {
        const falla = vi.fn(async () => { throw new Error('sin red'); });
        const r = await cargarVolumenActual(2026, falla);
        expect(r.error).toBe('sin red');
        expect(r.porModulo.size).toBe(0);
        const c = vi.fn(ok);
        const r2 = await cargarVolumenActual(2026, c);
        expect(c).toHaveBeenCalledTimes(1);
        expect(r2.error).toBeNull();
    });

    it('error devuelto por la consulta tampoco se cachea', async () => {
        const malo = vi.fn(async () => ({ porModulo: new Map<number, number>(), ultimoMesEsParcial: false, error: 'RLS', mesesPorModulo: new Map<number, number>(), mesesParciales: [] as string[] }));
        const r = await cargarVolumenActual(2026, malo);
        expect(r.error).toBe('RLS');
        await cargarVolumenActual(2026, malo);
        expect(malo).toHaveBeenCalledTimes(2);
    });
});

describe('escalaEje', () => {
    it('da 3–4 marcas redondas que cubren los datos', () => {
        for (const m of [1, 2, 3, 4, 5, 12]) {
            const vols = [...MATRIZ[m].vol, MATRIZ[m].vol26];
            const e = escalaEje(vols)!;
            expect(e.ticks.length).toBeGreaterThanOrEqual(3);
            expect(e.ticks.length).toBeLessThanOrEqual(4);
            expect(e.min).toBeLessThanOrEqual(Math.min(...vols));
            expect(e.max).toBeGreaterThanOrEqual(Math.max(...vols));
        }
    });
    it('sin datos: null (S/D), no una escala inventada', () => {
        expect(escalaEje([])).toBeNull();
    });
});
