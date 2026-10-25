import { describe, expect, it } from 'vitest';
import {
    anomaliaDelPeriodo, aFilasV2, compararModulos, compararPeriodos, compararVsSrl, construirAnalisis, evolucionInteranual, fraseAnomalia, fraseEvolucion,
    patronAnual, tendenciasDelPeriodo, textoReferencia, type FilaAnalisis,
} from './informeNdviAnalisis';
import { configPorDefecto, desplazaAnios, resolverContraste, validarConfig, type ConfigInformeNdvi } from './informeNdviConfig';
import { UMBRAL_SIN_CAMBIO } from './ndviInteranual';

const MODS = [1, 2, 3, 4, 5, 12];
const ANIOS = [2021, 2022, 2023, 2024, 2025, 2026];
const MM = ['03', '04', '05', '06', '07', '08', '09'];
const forma = (k: number) => 0.2 + 0.05 * k; // reverdecimiento estacional mar → sep
// Efecto del año: M2 sube 0.03 por año; M3 sube y baja sin dirección; M1 cae 0.06 solo en 2026; el resto sin efecto.
const efecto = (m: number, a: number) => (m === 2 ? 0.03 * (a - 2021) : m === 3 ? [0, 0.05, -0.03, 0.04, -0.02, 0.03][a - 2021] : m === 1 && a === 2026 ? -0.06 : 0);

const fila = (m: number, mes: string, v: number, extra: Partial<FilaAnalisis> = {}): FilaAnalisis => ({
    numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes, ndvi_medio: v, ndvi_desv: 0.08, kc_estimado: null, superficie_ha: 1000,
    fraccion_cobertura_activa: 0.6, n_escenas: 4, pct_pixeles_validos: 0.9, ...extra,
});
const serie = (anios = ANIOS, mods = MODS): FilaAnalisis[] =>
    mods.flatMap((m) => anios.flatMap((a) => MM.map((mm, k) => fila(m, `${a}-${mm}`, forma(k) + efecto(m, a)))));

const FILAS = serie();
const MESES_ALL = [...new Set(FILAS.map((f) => f.mes))].sort();
const MESES_2026 = MM.map((mm) => `2026-${mm}`);
const cfg = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES_ALL), preset: 'personalizado', desde: '2026-03', hasta: '2026-09', ...o });

describe('patronAnual (evolución año a año)', () => {
    const pts = (ys: (number | null)[], x0 = 2021) => ys.map((y, i) => ({ x: x0 + i, y }));
    it('sube: ajuste fuerte, mismo signo y cambio de punta a punta ≥ umbral', () => {
        const p = patronAnual(pts([0.30, 0.33, 0.36, 0.39, 0.42, 0.45]));
        expect(p.patron).toBe('sube');
        expect(p.sen).toBeCloseTo(0.03, 9);
        expect(p.cambioTotal).toBeCloseTo(0.15, 9);
        expect(p.r2).toBeCloseTo(1, 9);
        expect(p.r2Umbral).toBeCloseTo(0.811 ** 2, 3);
        expect(patronAnual(pts([0.45, 0.42, 0.39, 0.36, 0.33, 0.30])).patron).toBe('baja');
    });
    it('sin patrón: sube y baja sin dirección sostenida', () => {
        const p = patronAnual(pts([0.30, 0.40, 0.28, 0.41, 0.29, 0.40]));
        expect(p.patron).toBe('sin-patron');
        expect(p.r2).not.toBeNull();
    });
    it('un cambio total menor al umbral de "sin cambio" no se declara aunque el ajuste sea perfecto', () => {
        // pendiente 0.003/año × 5 años = 0.015 < 0.02
        const p = patronAnual(pts([0.300, 0.303, 0.306, 0.309, 0.312, 0.315]));
        expect(p.r2).toBeCloseTo(1, 6);
        expect(Math.abs(p.cambioTotal as number)).toBeLessThan(UMBRAL_SIN_CAMBIO);
        expect(p.patron).toBe('sin-patron');
    });
    it('con 4 años hace falta R² ≥ 0.90: 0.85 no basta', () => {
        const p = patronAnual(pts([0.30, 0.38, 0.34, 0.45], 2023));
        expect(p.n).toBe(4);
        expect(p.r2 as number).toBeLessThan(0.9025);
        expect(p.patron).toBe('sin-patron');
    });
    it('menos de 3 años (o con S/D): insuficiente, sin pendiente (nunca 0)', () => {
        const p = patronAnual(pts([0.3, 0.4, null]));
        expect(p.n).toBe(2);
        expect(p.patron).toBe('insuficiente');
        expect(p.pendiente).toBeNull();
        expect(p.sen).toBeNull();
        expect(patronAnual([]).patron).toBe('insuficiente');
    });
    it('Theil–Sen no se deja arrastrar por un año atípico (aviso: la regresión sí cambia)', () => {
        const p = patronAnual(pts([0.30, 0.33, 0.36, 0.39, 0.42, 0.80]));
        expect(p.sen).toBeCloseTo(0.03, 2);
        expect(p.pendiente as number).toBeGreaterThan(0.06);
    });
});

describe('evolucionInteranual', () => {
    const v2 = aFilasV2(FILAS);
    it('media y pico por año; M2 sube año tras año, M3 no tiene patrón', () => {
        const e2 = evolucionInteranual(v2, 2, 2026);
        expect(e2.anios.map((a) => a.anio)).toEqual(ANIOS);
        expect(e2.media.patron).toBe('sube');
        expect(e2.pico.patron).toBe('sube');
        expect(evolucionInteranual(v2, 3, 2026).media.patron).toBe('sin-patron');
        expect(evolucionInteranual(v2, 4, 2026).media.patron).toBe('sin-patron'); // plano
    });
    it('una temporada incompleta (<6 meses) no entra a la tendencia', () => {
        const parcial = aFilasV2([...FILAS.filter((f) => f.numero_modulo === 2 && f.mes < '2026'), ...FILAS.filter((f) => f.numero_modulo === 2 && f.mes.startsWith('2026')).slice(0, 4)]);
        const e = evolucionInteranual(parcial, 2, 2026);
        const a26 = e.anios.find((a) => a.anio === 2026)!;
        expect(a26.completo).toBe(false);
        expect(a26.mesesConDato).toBe(4);
        expect(e.media.n).toBe(5);
    });
    it('respeta el año de referencia (años posteriores no entran)', () => {
        expect(evolucionInteranual(v2, 2, 2023).anios.map((a) => a.anio)).toEqual([2021, 2022, 2023]);
    });
    it('sin datos del módulo: sin años, insuficiente', () => {
        const e = evolucionInteranual(v2, 99, 2026);
        expect(e.anios).toEqual([]);
        expect(e.media.patron).toBe('insuficiente');
    });
});

describe('anomalía del periodo contra la climatología', () => {
    const v2 = aFilasV2(FILAS);
    it('M1 cae 0.06 en 2026: por debajo de lo habitual en los 7 meses', () => {
        const a = anomaliaDelPeriodo(v2, 1, MESES_2026);
        expect(a.nConRef).toBe(7);
        expect(a.mediaAbs).toBeCloseTo(-0.06, 9);
        expect(a.direccion).toBe('abajo');
        expect(a.mesesAbajo).toBe(7);
        expect(a.mesesArriba).toBe(0);
        expect(a.minRef).toBe(5);
        expect(a.bajaConfianza).toBe(false);
        expect(fraseAnomalia(a, 'El Módulo 1')).toContain('por debajo de lo habitual');
    });
    it('el reverdecimiento estacional NO cuenta como anomalía: M4 (año normal) queda en línea', () => {
        const a = anomaliaDelPeriodo(v2, 4, MESES_2026);
        expect(a.direccion).toBe('similar');
        expect(a.mediaAbs).toBeCloseTo(0, 9);
        expect(a.mesesSimilar).toBe(7);
    });
    it('M2 va por encima de lo habitual (sube año tras año) y lo dice sin hablar de causas', () => {
        const a = anomaliaDelPeriodo(v2, 2, MESES_2026);
        expect(a.direccion).toBe('arriba');
        const f = fraseAnomalia(a, 'El Módulo 2');
        expect(f).toContain('por encima de lo habitual');
        expect(f).not.toMatch(/porque|debido|causa/i);
    });
    it('frontera de "en línea": justo debajo del umbral es similar, justo encima es arriba/abajo', () => {
        const con = (delta: number) => {
            const f = FILAS.filter((x) => x.numero_modulo === 4).map((x) => (x.mes.startsWith('2026') ? { ...x, ndvi_medio: x.ndvi_medio + delta } : x));
            return anomaliaDelPeriodo(aFilasV2(f), 4, MESES_2026);
        };
        expect(con(UMBRAL_SIN_CAMBIO - 0.001).direccion).toBe('similar');
        expect(con(UMBRAL_SIN_CAMBIO + 0.001).direccion).toBe('arriba');
        expect(con(-UMBRAL_SIN_CAMBIO - 0.001).direccion).toBe('abajo');
    });
    it('referencia: con 2 otros años no se calcula (S/D); con 3 se calcula pero de baja confianza; con 4 es confiable', () => {
        const mes = ['2026-06'];
        const con = (anios: number[]) => anomaliaDelPeriodo(aFilasV2(serie(anios, [1])), 1, mes);
        const a2 = con([2025, 2024, 2026]);
        expect(a2.nConRef).toBe(0);
        expect(a2.mediaAbs).toBeNull();
        expect(a2.direccion).toBeNull();
        expect(a2.bajaConfianza).toBe(true);
        expect(fraseAnomalia(a2, 'M1')).toContain('sin referencia suficiente');
        const a3 = con([2023, 2024, 2025, 2026]);
        expect(a3.nConRef).toBe(1);
        expect(a3.minRef).toBe(3);
        expect(a3.bajaConfianza).toBe(true);
        const a4 = con([2022, 2023, 2024, 2025, 2026]);
        expect(a4.minRef).toBe(4);
        expect(a4.bajaConfianza).toBe(false);
    });
    it('meses con pocas escenas limpias bajan la confianza', () => {
        const f = FILAS.filter((x) => x.numero_modulo === 1).map((x) => (x.mes === '2026-06' ? { ...x, n_escenas: 1 } : x));
        const a = anomaliaDelPeriodo(aFilasV2(f), 1, MESES_2026);
        expect(a.bajaConfianza).toBe(true);
        expect(a.motivos.join(' ')).toMatch(/pocas observaciones/);
    });
    it('un mes S/D del periodo se descarta (no es 0) y se avisa', () => {
        const f = FILAS.filter((x) => x.numero_modulo === 1 && x.mes !== '2026-05');
        const a = anomaliaDelPeriodo(aFilasV2(f), 1, MESES_2026);
        expect(a.nConRef).toBe(6);
        expect(a.mediaAbs).toBeCloseTo(-0.06, 9); // no se arrastra hacia cero por el hueco
        expect(a.motivos.join(' ')).toMatch(/no tiene dato \(S\/D\)|no tienen dato \(S\/D\)/);
    });
    it('meses fuera de marzo–septiembre no se comparan y se avisa', () => {
        const a = anomaliaDelPeriodo(v2, 1, ['2025-11', '2025-12', ...MESES_2026]);
        expect(a.nPeriodo).toBe(7);
        expect(a.motivos.join(' ')).toMatch(/fuera de marzo–septiembre/);
    });
});

describe('tendencias del periodo y orquestación', () => {
    const t = tendenciasDelPeriodo(FILAS, cfg(), MESES_2026);
    it('una fila por módulo + Promedio SRL con "n de m"', () => {
        expect(t).toHaveLength(7);
        const srl = t[t.length - 1];
        expect(srl.id).toBe('srl');
        expect(srl.nModulos).toEqual({ n: 6, total: 6 });
        expect(srl.evolucion.anios.every((a) => a.nModulos === 6)).toBe(true);
    });
    it('un solo módulo: sin promedio SRL', () => {
        expect(tendenciasDelPeriodo(FILAS, cfg({ modulos: [3] }), MESES_2026)).toHaveLength(1);
    });
    it('hasta el año del último mes del periodo; construirAnalisis lo expone junto con los años de referencia', () => {
        const r = construirAnalisis(FILAS, cfg(), MESES_2026);
        expect(r.anioRef).toBe(2026);
        expect(r.aniosReferencia).toEqual(ANIOS);
        expect(r.compModulos).toBeNull();
    });
    it('los años elegidos acotan la referencia: con 2021–2022 y 2026 no hay 3 años de referencia', () => {
        const r = construirAnalisis(FILAS, cfg({ anios: [2021, 2022] }), MESES_2026);
        expect(r.aniosReferencia).toEqual([2021, 2022, 2026]);
        expect(r.tendencias[0].anomalia.nConRef).toBe(0);
    });
    it('una serie de solo un año: todo S/D / insuficiente, sin inventar tendencia', () => {
        const f1 = serie([2026]);
        const tt = tendenciasDelPeriodo(f1, cfg(), MESES_2026);
        expect(tt[0].evolucion.media.patron).toBe('insuficiente');
        expect(tt[0].anomalia.mediaAbs).toBeNull();
        expect(fraseEvolucion(tt[0].evolucion, 'El Módulo 1')).toMatch(/insuficiente/i);
    });
    it('lectura del año a año en palabras, sin causalidad', () => {
        const m2 = t.find((x) => x.id === 2)!;
        expect(fraseEvolucion(m2.evolucion, 'El Módulo 2')).toMatch(/ha ido subiendo/);
        const m3 = t.find((x) => x.id === 3)!;
        expect(fraseEvolucion(m3.evolucion, 'El Módulo 3')).toMatch(/sin patrón claro/);
        expect(fraseEvolucion(m2.evolucion, 'x')).toMatch(/no una causa/);
    });
    it('la certeza se matiza con n≈5: la frase dice con cuántos años se compara y que es descriptiva', () => {
        const m1 = t.find((x) => x.id === 1)!.anomalia;
        expect(m1.maxRef).toBe(5);
        expect(textoReferencia(m1)).toBe('referencia de 5 años');
        expect(fraseAnomalia(m1, 'Módulo 1')).toContain('referencia de 5 años');
        const lejos = { ...m1, fueraDeLoHabitual: true };
        const f = fraseAnomalia(lejos, 'Módulo 1');
        expect(f).toMatch(/lectura descriptiva/);
        expect(f).not.toMatch(/fuera de lo habitual/);
    });
});

describe('promedio SRL: la base elegida se respeta en todos los cálculos', () => {
    // Superficies muy distintas: el ponderado pesa casi todo en el módulo 5.
    const conSup = (f: FilaAnalisis) => ({ ...f, superficie_ha: ({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 10000, 12: 100 } as Record<number, number>)[f.numero_modulo] });
    const F = FILAS.map(conSup);
    const simple = cfg({ basePromedio: 'simple' }), pond = cfg({ basePromedio: 'ponderado' });
    it('anomalía SRL (y su evolución año a año) cambian con la base', () => {
        const s = tendenciasDelPeriodo(F, simple, MESES_2026).find((x) => x.id === 'srl')!;
        const p = tendenciasDelPeriodo(F, pond, MESES_2026).find((x) => x.id === 'srl')!;
        // M5 no tiene efecto: ponderado ≈ 0; simple arrastra el −0.06 de M1 y el +0.15 de M2
        expect(Math.abs(p.anomalia.mediaAbs as number)).toBeLessThan(Math.abs(s.anomalia.mediaAbs as number));
        expect(p.anomalia.mediaAbs as number).toBeCloseTo(0, 2);
        const sMedia = s.evolucion.anios.find((a) => a.anio === 2026)!.media as number;
        const pMedia = p.evolucion.anios.find((a) => a.anio === 2026)!.media as number;
        expect(pMedia).not.toBeCloseTo(sMedia, 3);
    });
    it('contraste y módulo contra promedio usan la misma base', () => {
        const a = { desde: '2025-03', hasta: '2025-09' }, b = { desde: '2026-03', hasta: '2026-09' };
        const cs = compararPeriodos(F, simple, a, b), cp = compararPeriodos(F, pond, a, b);
        expect(cs.base).toBe('simple'); expect(cp.base).toBe('ponderado');
        expect(cp.delta as number).toBeCloseTo(0, 2); // M5 domina y no cambia entre años
        expect(cs.delta as number).not.toBeCloseTo(cp.delta as number, 3);
        const vs = (c: ConfigInformeNdvi) => compararVsSrl(F, { ...c, compModulos: { tipo: 'vsSRL', moduloA: 1, moduloB: 2 } }, MESES_2026)!;
        expect(vs(simple).base).toBe('simple');
        expect(vs(pond).srl[0] as number).not.toBeCloseTo(vs(simple).srl[0] as number, 3);
    });
});

describe('contraste contra el mismo periodo de otro año', () => {
    const a = { desde: '2023-03', hasta: '2023-09' }, b = { desde: '2026-03', hasta: '2026-09' };
    it('mar–sep 2026 contra mar–sep 2023: diferencia B − A por módulo, sin avisos y con "vs habitual" de cada lado', () => {
        const r = compararPeriodos(FILAS, cfg(), a, b);
        expect(r.avisos).toEqual([]);
        expect([r.anioA, r.anioB]).toEqual([2023, 2026]);
        const m1 = r.filas.find((f) => f.numero === 1)!;
        expect(m1.delta).toBeCloseTo(-0.06, 9);
        expect(m1.habB.abs).toBeCloseTo(-0.06, 9);
        expect(m1.habB.direccion).toBe('abajo');
        expect(m1.habA.abs).toBeCloseTo(0.012, 9); // 2023 contra los otros años, que incluyen el 2026 más bajo
        const m2 = r.filas.find((f) => f.numero === 2)!;
        expect(m2.delta).toBeCloseTo(0.09, 9); // efecto 0.15 - 0.06
        expect(r.etiquetaA).toBe('marzo 2023 a septiembre 2023');
        expect(r.mayorAumento?.numero).toBe(2);
        expect(r.mayorDescenso?.numero).toBe(1);
        expect(r.habB).not.toBeNull();
    });
    it('si todo baja no hay "mayor aumento" (no se llama mejora a una caída)', () => {
        const baja = FILAS.map((f) => (f.mes.startsWith('2026') ? { ...f, ndvi_medio: f.ndvi_medio - 0.1 } : f));
        const r = compararPeriodos(baja, cfg(), a, b);
        expect(r.mayorAumento).toBeNull();
        expect(r.mayorDescenso).not.toBeNull();
        expect(r.delta as number).toBeLessThan(0);
    });
    it('una diferencia menor al umbral no se reporta como aumento ni descenso', () => {
        const casi = FILAS.map((f) => (f.mes.startsWith('2026') ? { ...f, ndvi_medio: f.ndvi_medio + UMBRAL_SIN_CAMBIO - 0.005 } : f));
        const r = compararPeriodos(casi.filter((f) => f.numero_modulo === 4), cfg({ modulos: [4] }), a, b);
        expect(r.mayorAumento).toBeNull();
        expect(r.mayorDescenso).toBeNull();
    });
    it('cantidades de meses distintas se avisan', () => {
        const r = compararPeriodos(FILAS, cfg(), { desde: '2025-03', hasta: '2025-09' }, { desde: '2026-03', hasta: '2026-06' });
        expect(r.avisos.join(' ')).toMatch(/7 meses con dato y B 4/);
    });
    it('un lado sin datos queda S/D (nunca 0)', () => {
        const r = compararPeriodos(FILAS, cfg({ modulos: [1] }), { desde: '2019-03', hasta: '2019-09' }, b);
        expect(r.filas[0].a).toBeNull();
        expect(r.filas[0].delta).toBeNull();
        expect(r.promA).toBeNull();
        expect(r.delta).toBeNull();
    });
    it('el contraste automático toma el año anterior y se omite si ese periodo no tiene datos', () => {
        expect(construirAnalisis(FILAS, cfg(), MESES_2026).contraste?.anioA).toBe(2025);
        expect(construirAnalisis(FILAS, cfg({ contraste: 2023 }), MESES_2026).contraste?.anioA).toBe(2023);
        expect(construirAnalisis(FILAS, cfg({ contraste: 'ninguno' }), MESES_2026).contraste).toBeNull();
        expect(construirAnalisis(serie([2026]), cfg(), MESES_2026).contraste).toBeNull();
    });
});

describe('comparación entre módulos (opcional)', () => {
    const conComp = (tipo: 'modulos' | 'vsSRL', moduloA: number, moduloB = 2): ConfigInformeNdvi => cfg({ compModulos: { tipo, moduloA, moduloB } });
    it('módulo contra módulo: NDVI e IHR y cada uno contra lo habitual', () => {
        const r = compararModulos(FILAS, conComp('modulos', 1), MESES_2026)!;
        expect(r.indicadores.map((i) => i.clave)).toEqual(['ndvi', 'ihr']);
        expect(r.delta as number).toBeGreaterThan(0.15);
        expect(r.mesesAMayor).toBe(0);
        expect(r.mesesComunes).toBe(7);
        expect(r.habA.direccion).toBe('abajo');
        expect(r.habB.direccion).toBe('arriba');
    });
    it('sin configuración de comparación devuelve null', () => {
        expect(compararModulos(FILAS, cfg(), MESES_2026)).toBeNull();
        expect(compararVsSrl(FILAS, cfg(), MESES_2026)).toBeNull();
    });
    it('módulo contra el promedio de los OTROS módulos, con n por mes', () => {
        const r = compararVsSrl(FILAS, conComp('vsSRL', 1), MESES_2026)!;
        expect(r.totalOtros).toBe(5);
        expect(r.nOtros.every((n) => n === 5)).toBe(true);
        // M1 vale forma-0.06; los otros 5 promedian forma + (0.15+0.03+0+0+0)/5 = forma + 0.036
        expect(r.diferencia[0]).toBeCloseTo(-0.06 - 0.036, 9);
        expect(r.composicionVariable).toBe(false);
        expect(r.mesesPorEncima).toBe(0);
        expect(r.hab.direccion).toBe('abajo');
    });
    it('vs promedio: si un módulo no tiene un mes, el promedio usa los que hay y lo declara', () => {
        const f = FILAS.filter((x) => !(x.numero_modulo === 5 && x.mes === '2026-06'));
        const r = compararVsSrl(f, conComp('vsSRL', 1), MESES_2026)!;
        const i = MESES_2026.indexOf('2026-06');
        expect(r.nOtros[i]).toBe(4);
        expect(r.composicionVariable).toBe(true);
        const sinOtros = compararVsSrl(FILAS.filter((x) => x.numero_modulo === 1), conComp('vsSRL', 1), MESES_2026)!;
        expect(sinOtros.srl.every((v) => v === null)).toBe(true);
        expect(sinOtros.difMedia).toBeNull();
    });
});

describe('configuración del alcance', () => {
    it('desplazaAnios y resolverContraste', () => {
        expect(desplazaAnios({ desde: '2026-03', hasta: '2026-09' }, -1)).toEqual({ desde: '2025-03', hasta: '2025-09' });
        const k = resolverContraste({ desde: '2026-03', hasta: '2026-09', contraste: 2023 }, FILAS);
        expect(k?.a).toEqual({ desde: '2023-03', hasta: '2023-09' });
        expect(resolverContraste({ desde: '2026-03', hasta: '2026-09', contraste: 2026 }, FILAS)).toBeNull();
    });
    it('valida que los módulos A/B estén entre los módulos elegidos', () => {
        const c = cfg({ modulos: [1, 3], compModulos: { tipo: 'modulos', moduloA: 1, moduloB: 2 } });
        expect(validarConfig(c, FILAS).join(' ')).toMatch(/Módulo 2 de la comparación no está entre los módulos elegidos/);
        expect(validarConfig({ ...c, compModulos: { tipo: 'modulos', moduloA: 1, moduloB: 3 } }, FILAS)).toEqual([]);
        expect(validarConfig({ ...c, compModulos: { tipo: 'modulos', moduloA: 3, moduloB: 3 } }, FILAS).join(' ')).toMatch(/dos módulos distintos/);
    });
    it('la tendencia no exige un mínimo de meses dentro del ciclo (basta un mes con dato)', () => {
        expect(validarConfig(cfg({ desde: '2026-08', hasta: '2026-09' }), FILAS)).toEqual([]);
    });
});
