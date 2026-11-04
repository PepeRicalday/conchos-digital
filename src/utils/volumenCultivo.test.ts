import { describe, expect, it } from 'vitest';
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import { infoCultivo } from './cultivos';
import {
    composicionAnual, contrasteRegimenes, esAlfalfaNogal, estadoCultivoEnAnio, marcaAnioIncompleto, notaIncompleta, notaTodosIncompletos, fraseCambioMezcla, kpiCiclo, kpiLamina, kpiMezcla, kpiTecnico, intensidadHidrica, lecturaIntensidad, reporteCiclo, laminaCm, laminaPorCultivo, listaAtipicos, matrizModuloAnio, mezclaCultivos, referenciaCicloActual,
    type ReferenciaModulo,
} from './volumenCultivo';

const f = (anio: number, modulo: number, cultivo: string, ha: number | null, miles: number | null, atipico = false): FilaSupVol =>
    ({ anio, numero_modulo: modulo, cultivo, superficie_ha: ha, volumen_miles_m3: miles, atipico });

// Alfalfa real del distrito (ACUM_INF): 2024 = 6 086 ha y 111.57 hm³ → 183 cm.
const FILAS: FilaSupVol[] = [
    f(2020, 1, 'Alfalfa', 3000, 40000), f(2020, 1, 'Nogal', 1400, 18000),
    f(2021, 1, 'Alfalfa', 1500, 9000), f(2021, 1, 'Nogal', 1400, 9900),
    f(2022, 1, 'Alfalfa', 1800, 14000), f(2022, 1, 'Nogal', 1500, 13000),
    f(2023, 1, 'Alfalfa', 3200, 38000), f(2023, 1, 'Nogal', 1600, 19000),
    f(2024, 1, 'Alfalfa', 1700, 20000), f(2024, 1, 'Nogal', 1500, 13000),
    f(2024, 1, 'Sorgo', 9, 0), f(2024, 2, 'Alfalfa', 100, 1500),
];

describe('laminaCm', () => {
    it('miles de m³ / ha × 10 = cm', () => {
        expect(laminaCm(111570, 6086)).toBeCloseTo(183.3, 1);
    });
    it('S/D y superficie 0 devuelven null, nunca 0', () => {
        expect(laminaCm(null, 100)).toBeNull();
        expect(laminaCm(100, null)).toBeNull();
        expect(laminaCm(100, 0)).toBeNull();
    });
});

describe('laminaPorCultivo', () => {
    it('suma módulos cuando modulo es null y ordena por volumen', () => {
        const r = laminaPorCultivo(FILAS, null);
        expect(r[0].cultivo).toBe('Alfalfa');
        const c24 = r[0].celdas.find(c => c.anio === 2024)!;
        expect(c24.superficieHa).toBe(1800);
        expect(c24.volumenHm3).toBeCloseTo(21.5, 5);
    });
    it('muestra chica (<50 ha) se marca y no entra a la media', () => {
        const sorgo = laminaPorCultivo(FILAS, 1).find(s => s.cultivo === 'Sorgo')!;
        expect(sorgo.celdas[0].muestraChica).toBe(true);
        expect(sorgo.mediaLaminaCm).toBeNull();
    });
    it('marca la lámina que se aleja de los demás años', () => {
        const filas = [2020, 2021, 2022, 2023].map(a => f(a, 1, 'Maíz', 1000, 10000)).concat([f(2024, 1, 'Maíz', 1000, 25000), f(2019, 1, 'Maíz', 1000, 10200)]);
        const m = laminaPorCultivo(filas, 1)[0];
        expect(m.celdas.find(c => c.anio === 2024)!.laminaAtipica).toBe(true);
        expect(m.celdas.find(c => c.anio === 2020)!.laminaAtipica).toBe(false);
    });
    it('conserva la bandera atípica de la fuente', () => {
        const r = laminaPorCultivo([f(2021, 1, 'Chile', 200, 3000, true)], 1);
        expect(r[0].celdas[0].atipicoFuente).toBe(true);
    });
});

describe('mezclaCultivos', () => {
    it('los porcentajes suman 100 y se ordenan por volumen', () => {
        const r = mezclaCultivos(FILAS, 1, 2020);
        expect(r.map(x => x.cultivo)).toEqual(['Alfalfa', 'Nogal']);
        expect(r.reduce((a, x) => a + (x.pctVolumen ?? 0), 0)).toBeCloseTo(100, 6);
        expect(r[0].pctSuperficie).toBeCloseTo((3000 / 4400) * 100, 6);
    });
    it('año sin renglones → lista vacía', () => {
        expect(mezclaCultivos(FILAS, 1, 2019)).toEqual([]);
    });
});

describe('contrasteRegimenes', () => {
    it('separa 2020 y 2023 (altos) de 2021, 2022 y 2024 (bajos)', () => {
        const c = contrasteRegimenes(FILAS.filter(x => x.numero_modulo === 1 && x.cultivo !== 'Sorgo'), 1)!;
        expect(c.altos).toEqual([2020, 2023]);
        expect(c.bajos).toEqual([2021, 2022, 2024]);
        expect(c.cultivos.length).toBe(2);
    });
    it('sin contraste claro o con pocos años devuelve null', () => {
        const plano = [2020, 2021, 2022, 2023].map(a => f(a, 1, 'Maíz', 1000, 10000));
        expect(contrasteRegimenes(plano, 1)).toBeNull();
        expect(contrasteRegimenes(FILAS.filter(x => x.anio < 2022), 1)).toBeNull();
    });
});

describe('referenciaCicloActual', () => {
    const base = FILAS.filter(x => x.cultivo !== 'Sorgo');
    const act = (v: number | undefined, meses = 7, parciales: string[] = [], error: string | null = null): VolumenActual => ({
        porModulo: new Map(v == null ? [] : [[1, v]]), mesesPorModulo: new Map([[1, meses]]), mesesParciales: parciales, error,
    });
    it('rango y posición', () => {
        const r = referenciaCicloActual(base, act(50), [1])[0];
        expect(r.minHm3).toBeCloseTo(18.9, 5);
        expect(r.maxHm3).toBeCloseTo(58, 5);
        expect(r.posicion).toBe('dentro');
        expect(referenciaCicloActual(base, act(10), [1])[0].posicion).toBe('bajo-rango');
        expect(referenciaCicloActual(base, act(90), [1])[0].posicion).toBe('sobre-rango');
    });
    it('sin volumen o con error → sin-dato (no 0)', () => {
        expect(referenciaCicloActual(base, act(undefined), [1])[0].actualHm3).toBeNull();
        expect(referenciaCicloActual(base, act(50, 7, [], 'caída'), [1])[0].posicion).toBe('sin-dato');
        expect(referenciaCicloActual(base, null, [1])[0].posicion).toBe('sin-dato');
    });
    it('meses faltantes o parciales marcan incompleto', () => {
        expect(referenciaCicloActual(base, act(50, 6), [1])[0].actualIncompleto).toBe(true);
        expect(referenciaCicloActual(base, act(50, 7, ['2026-09']), [1])[0].actualIncompleto).toBe(true);
        expect(referenciaCicloActual(base, act(50), [1])[0].actualIncompleto).toBe(false);
    });
});

describe('kpiLamina', () => {
    it('lámina media del último año = volumen ÷ superficie del año; mayor lámina entre cultivos con muestra firme', () => {
        const k = kpiLamina(FILAS, null);
        expect(k.anio).toBe(2024);
        // 2024: Alfalfa 1800 ha / 21500 + Nogal 1500 / 13000 + Sorgo 9 / 0 → 34500 / 3309 × 10
        expect(k.laminaMediaCm).toBeCloseTo((34500 / 3309) * 10, 6);
        expect(k.cultivoMayor?.cultivo).toBe('Alfalfa');
        expect(k.cultivoMayor?.laminaCm).toBeCloseTo((21500 / 1800) * 10, 6);
    });
    it('cuenta las alertas igual que la tabla (⚠) y no cuenta celdas S/D', () => {
        const k = kpiLamina(FILAS, null);
        expect(k.alertas).toBeGreaterThanOrEqual(1); // Sorgo 9 ha = muestra chica
        expect(k.alertas).toBeLessThanOrEqual(k.celdas);
    });
    it('sin renglones → todo null, nunca 0', () => {
        const k = kpiLamina([], null);
        expect(k.anio).toBeNull();
        expect(k.laminaMediaCm).toBeNull();
        expect(k.cultivoMayor).toBeNull();
    });
    it('el cultivo de muestra chica no gana el máximo', () => {
        const k = kpiLamina([f(2024, 1, 'Maíz', 1000, 10000), f(2024, 1, 'Sandía', 5, 900)], null);
        expect(k.cultivoMayor?.cultivo).toBe('Maíz');
    });
});

describe('kpiMezcla', () => {
    it('reconoce alfalfa y nogal sin importar acentos ni mayúsculas', () => {
        expect(esAlfalfaNogal('Alfalfa')).toBe(true);
        expect(esAlfalfaNogal('NOGAL')).toBe(true);
        expect(esAlfalfaNogal('Algodón')).toBe(false);
    });
    it('% de volumen de alfalfa+nogal, superficie total y años altos contra bajos', () => {
        const base = FILAS.filter(x => x.numero_modulo === 1 && x.cultivo !== 'Sorgo');
        const k = kpiMezcla(base, 1, 2020);
        expect(k.pctVolumenAlfalfaNogal).toBeCloseTo(100, 6);
        expect(k.superficieTotalHa).toBe(4400);
        expect(k.altosVsBajos?.altos).toEqual([2020, 2023]);
        expect(k.altosVsBajos?.altosHa).toBeCloseTo((4400 + 4800) / 2, 6);
        expect(k.altosVsBajos?.bajosHa).toBeCloseTo((2900 + 3300 + 3200) / 3, 6);
        expect(k.altosVsBajos?.veces).toBeGreaterThan(1.4);
    });
    it('con otro cultivo el porcentaje baja; sin año devuelve null', () => {
        const k = kpiMezcla([f(2024, 1, 'Alfalfa', 100, 6000), f(2024, 1, 'Maíz', 100, 4000)], 1, 2024);
        expect(k.pctVolumenAlfalfaNogal).toBeCloseTo(60, 6);
        expect(k.altosVsBajos).toBeNull();
        const n = kpiMezcla(FILAS, null, null);
        expect(n.pctVolumenAlfalfaNogal).toBeNull();
        expect(n.superficieTotalHa).toBeNull();
    });
    it('año sin renglones → null, no 0', () => {
        const k = kpiMezcla(FILAS, null, 2019);
        expect(k.pctVolumenAlfalfaNogal).toBeNull();
        expect(k.superficieTotalHa).toBeNull();
    });
});

describe('kpiCiclo', () => {
    const ref = (modulo: number, posicion: ReferenciaModulo['posicion'], actualHm3: number | null, medianaHm3: number | null, actualIncompleto = false): ReferenciaModulo => ({
        modulo, historico: [], minHm3: 1, maxHm3: 100, medianaHm3, actualHm3, fuenteActual: actualHm3 != null ? 'srl' : null, informeHm3: null, srlHm3: actualHm3, difSrlInformeHm3: null, actualIncompleto, posicion,
        pctVsMediana: actualHm3 != null && medianaHm3 ? ((actualHm3 - medianaHm3) / medianaHm3) * 100 : null,
    });
    it('cuenta posiciones y compara el volumen contra la mediana de los mismos módulos', () => {
        const k = kpiCiclo([ref(1, 'dentro', 50, 40), ref(2, 'sobre-rango', 120, 80), ref(3, 'bajo-rango', 5, 20), ref(4, 'sin-dato', null, 30)]);
        expect([k.dentro, k.sobre, k.bajo, k.sinDato]).toEqual([1, 1, 1, 1]);
        expect(k.actualHm3).toBe(175);
        expect(k.medianaHm3).toBe(140); // el módulo 4 (sin actual) no entra a la mediana
        expect(k.pctVsMediana).toBeCloseTo(25, 6);
        expect(k.modulosConDato).toBe(3);
        expect(k.modulosTotal).toBe(4);
    });
    it('sin ningún dato actual → null y no 0', () => {
        const k = kpiCiclo([ref(1, 'sin-dato', null, 40), ref(2, 'sin-dato', null, 80)]);
        expect(k.actualHm3).toBeNull();
        expect(k.medianaHm3).toBeNull();
        expect(k.pctVsMediana).toBeNull();
        expect(k.sinDato).toBe(2);
    });
    it('si a un módulo con actual le falta la mediana no se compara; cuenta incompletos', () => {
        const k = kpiCiclo([ref(1, 'dentro', 50, 40, true), ref(2, 'dentro', 10, null)]);
        expect(k.actualHm3).toBe(60);
        expect(k.medianaHm3).toBeNull();
        expect(k.pctVsMediana).toBeNull();
        expect(k.incompletos).toBe(1);
    });
});

describe('listaAtipicos', () => {
    it('lista cada celda con motivo, con su motivo, ordenada por año', () => {
        const l = listaAtipicos([f(2022, 1, 'Chile', 200, 3000, true), f(2021, 1, 'Sorgo', 9, 100), f(2021, 1, 'Maíz', 1000, 10000)]);
        expect(l.map(x => `${x.anio}-${x.cultivo}`)).toEqual(['2021-Sorgo', '2022-Chile']);
        expect(l[1].motivos).toContain('captura atípica en el informe fuente');
        expect(l[0].motivos[0]).toMatch(/menor a 50 ha/);
    });
});

describe('matrizModuloAnio', () => {
    it('lámina media por módulo y año; módulo sin renglones del año → null', () => {
        const m = matrizModuloAnio(FILAS, [1, 3]);
        const c = m[0].celdas.find(x => x.anio === 2020)!;
        expect(c.superficieHa).toBe(4400);
        expect(c.laminaCm).toBeCloseTo((58000 / 4400) * 10, 6);
        expect(m[1].celdas.every(x => x.laminaCm === null && x.superficieHa === null)).toBe(true);
    });
});

describe('composicionAnual (barras apiladas)', () => {
    const MIX: FilaSupVol[] = [
        ...FILAS,
        f(2020, 1, 'Maíz', 500, 4000), f(2021, 1, 'Maíz', 300, 2000), f(2022, 1, 'Chile', 200, 3000),
        f(2022, 1, 'Cebolla', 50, 500), f(2023, 1, 'Cebolla', 60, 700), f(2024, 1, 'Nogal ', 100, 1000),
        f(2025, 1, 'Alfalfa', 100, 0), // un renglón con 0 en un año sin ciclo no debe aparecer
    ];
    it('cada año con informe suma 100 % y el total es la suma de las partes', () => {
        for (const campo of ['volumen', 'superficie'] as const) {
            const c = composicionAnual(MIX, null, campo);
            for (const fila of c.filas.filter(x => x.estado === 'con-informe')) {
                expect(fila.partes.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(100, 6);
                expect(fila.partes.reduce((a, p) => a + p.valor, 0)).toBeCloseTo(fila.total as number, 6);
            }
        }
    });
    it('el total de 2020 en volumen es la suma de los renglones de la fuente (hm³)', () => {
        const c = composicionAnual(MIX, null, 'volumen');
        expect(c.filas.find(x => x.anio === 2020)?.total).toBeCloseTo((40000 + 18000 + 4000) / 1000, 6);
        expect(c.unidad).toBe('hm³');
        expect(composicionAnual(MIX, null, 'superficie').filas.find(x => x.anio === 2020)?.total).toBeCloseTo(3000 + 1400 + 500, 6);
    });
    it('2025 queda como hueco «sin ciclo» (sin total ni partes, nunca 0) y 2026 como «sin desglose»', () => {
        const c = composicionAnual(MIX, null, 'volumen');
        const f25 = c.filas.find(x => x.anio === 2025)!;
        expect(f25.estado).toBe('sin-ciclo');
        expect(f25.total).toBeNull();
        expect(f25.partes).toHaveLength(0);
        const f26 = c.filas.find(x => x.anio === 2026)!;
        expect(f26.estado).toBe('sin-desglose');
        expect(f26.total).toBeNull();
        expect(c.filas.map(x => x.anio)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    });
    it('un módulo sin renglones en un año da S/D (null), no 0 ni una barra vacía', () => {
        const c = composicionAnual(MIX, 2, 'volumen');
        expect(c.filas.find(x => x.anio === 2020)).toMatchObject({ estado: 'sd', total: null });
        expect(c.filas.find(x => x.anio === 2024)?.estado).toBe('con-informe');
    });
    it('los cultivos van en el orden fijo del catálogo, con «Otros» al final, y el nombre con espacios se unifica', () => {
        const c = composicionAnual(MIX, null, 'volumen', 3);
        expect(c.leyenda.map(l => l.nombre).slice(0, 3)).toEqual(['Alfalfa', 'Nogal', 'Maíz']);
        expect(c.leyenda[c.leyenda.length - 1].esOtros).toBe(true);
        expect(c.filas.find(x => x.anio === 2024)?.partes.find(p => p.nombre === 'Nogal')?.valor).toBeCloseTo(14, 6);
    });
    it('un volumen faltante (null) no se vuelve 0: el cultivo no aparece', () => {
        const c = composicionAnual([f(2020, 1, 'Alfalfa', 100, 1000), f(2020, 1, 'Maíz', 50, null)], null, 'volumen');
        const parte = c.filas.find(x => x.anio === 2020)!.partes;
        expect(parte.map(p => p.nombre)).toEqual(['Alfalfa']);
        expect(composicionAnual([], null, 'volumen').filas.every(x => x.estado !== 'con-informe')).toBe(true);
    });
    it('renglón con volumen nulo o 0 ≠ cultivo ausente: se marca la barra como incompleta y se explica', () => {
        const filas = [f(2020, 1, 'Alfalfa', 100, 1000), f(2020, 1, 'Maíz', 50, null), f(2020, 1, 'Chile', 20, 0), f(2021, 1, 'Alfalfa', 100, 1000)];
        const c = composicionAnual(filas, null, 'volumen');
        const a20 = c.filas.find(x => x.anio === 2020)!, a21 = c.filas.find(x => x.anio === 2021)!;
        expect(a20.sinCifra.sort()).toEqual(['Chile', 'Maíz']);
        expect(a20.incompleta).toBe(true);
        expect(a21.incompleta).toBe(false);
        expect(notaIncompleta(a21, 'volumen')).toBeNull();
        expect(notaIncompleta(a20, 'volumen')).toMatch(/⚠ 2020: el informe trae Chile, Maíz sin volumen\..*datos incompletos/);
        const l = (nombre: string) => ({ nombre, clave: infoCultivo(nombre).clave, esOtros: false, cultivos: [nombre] });
        expect(estadoCultivoEnAnio(a20, l('Maíz')).tipo).toBe('sin-cifra');
        expect(estadoCultivoEnAnio(a21, l('Maíz')).tipo).toBe('ausente');
        expect(estadoCultivoEnAnio(a20, l('Alfalfa')).tipo).toBe('parte');
    });
    it('un renglón atípico de la fuente también marca la barra como incompleta', () => {
        const c = composicionAnual([f(2020, 1, 'Alfalfa', 100, 1000, true), f(2020, 1, 'Maíz', 50, 400)], null, 'volumen');
        const a = c.filas.find(x => x.anio === 2020)!;
        expect(a.atipicos).toEqual(['Alfalfa']);
        expect(notaIncompleta(a, 'volumen')).toMatch(/captura atípica/);
    });
    it('si TODOS los años con informe están marcados: una nota única y sin ⚠ por año; si solo algunos, ⚠ por año', () => {
        const todos = composicionAnual([f(2020, 1, 'Alfalfa', 100, 1000), f(2020, 1, 'Maíz', 50, null), f(2021, 1, 'Alfalfa', 100, 1000, true), f(2021, 1, 'Maíz', 50, 400)], null, 'volumen');
        expect(todos.todosIncompletos).toBe(true);
        expect(todos.filas.filter(x => x.estado === 'con-informe').some(x => marcaAnioIncompleto(todos, x))).toBe(false);
        // el detalle del año sigue completo
        expect(notaIncompleta(todos.filas.find(x => x.anio === 2020)!, 'volumen')).toMatch(/Maíz sin volumen/);
        expect(notaTodosIncompletos('volumen')).toBe('Todos los años traen renglones atípicos o sin volumen en el informe fuente; los porcentajes son sobre lo capturado.');
        expect(notaTodosIncompletos('superficie')).toMatch(/sin superficie/);
        const algunos = composicionAnual([f(2020, 1, 'Alfalfa', 100, 1000), f(2020, 1, 'Maíz', 50, null), f(2021, 1, 'Alfalfa', 100, 1000)], null, 'volumen');
        expect(algunos.todosIncompletos).toBe(false);
        expect(algunos.filas.filter(x => marcaAnioIncompleto(algunos, x)).map(x => x.anio)).toEqual([2020]);
        // un solo año con informe: no hay «resto» con qué compararlo, se queda el ⚠ propio
        const uno = composicionAnual([f(2020, 1, 'Alfalfa', 100, 1000), f(2020, 1, 'Maíz', 50, null)], null, 'volumen');
        expect(uno.todosIncompletos).toBe(false);
    });
    it('un nombre compuesto («Maíz/Frijol») cae en «Otros» y no se cuenta como Maíz', () => {
        const c = composicionAnual([f(2020, 1, 'Maíz', 100, 1000), f(2020, 1, 'Maíz/Frijol', 40, 300)], null, 'volumen');
        expect(c.filas.find(x => x.anio === 2020)!.partes.map(p => p.nombre).sort()).toEqual(['Maíz', 'Otros']);
        expect(c.leyenda.filter(l => l.clave === 'otros').length).toBeLessThanOrEqual(1);
    });
    it('frase de cambio: simple, sin causas, con los años', () => {
        const fr = fraseCambioMezcla(composicionAnual(MIX, null, 'volumen'));
        expect(fr).toMatch(/^Entre el primer y el último año con informe, Alfalfa recibió \d+ % del agua entregada en 2020 y \d+ % en 2024 \(2025 sin ciclo\)\.$/);
        expect(fr).not.toMatch(/porque|debido|causa/i);
        expect(fraseCambioMezcla(composicionAnual(MIX, null, 'superficie'))).toMatch(/ocupó \d+ % de la superficie regada/);
        expect(fraseCambioMezcla(composicionAnual([], null, 'volumen'))).toBeNull();
    });
});

describe('kpiTecnico', () => {
    it('volumen, superficie y lámina del año, con variación frente al año anterior con informe (2025 se salta)', () => {
        const F = [f(2024, 1, 'Alfalfa', 1000, 10000), f(2026, 1, 'Alfalfa', 1200, 9000), f(2025, 1, 'Alfalfa', 0, 0)];
        const k = kpiTecnico(F, null, 2026);
        expect(k.anioAnterior).toBe(2024);
        expect(k.volumenHm3).toBeCloseTo(9, 5);
        expect(k.superficieHa).toBe(1200);
        expect(k.laminaMediaCm).toBeCloseTo(75, 5);
        expect(k.volumenVsAnteriorPct).toBeCloseTo(-10, 5);
        expect(k.superficieVsAnteriorPct).toBeCloseTo(20, 5);
    });
    it('sin año anterior o sin ciclo: null, nunca 0', () => {
        expect(kpiTecnico([f(2020, 1, 'Alfalfa', 100, 1000)], null, 2020)).toMatchObject({ anioAnterior: null, volumenVsAnteriorPct: null, superficieVsAnteriorPct: null });
        expect(kpiTecnico(FILAS, null, 2025)).toMatchObject({ volumenHm3: null, superficieHa: null, laminaMediaCm: null });
        expect(kpiTecnico(FILAS, null, null).volumenHm3).toBeNull();
    });
});

describe('intensidadHidrica', () => {
    it('índice = % del agua ÷ % de la superficie; solo muestra firme y con las dos cifras', () => {
        const m = mezclaCultivos([f(2024, 1, 'Alfalfa', 500, 8000), f(2024, 1, 'Nogal', 500, 2000), f(2024, 1, 'Sorgo', 10, 100), f(2024, 1, 'Chile', 100, null)], null, 2024);
        const r = intensidadHidrica(m);
        const alf = r.find(x => x.cultivo === 'Alfalfa')!, nog = r.find(x => x.cultivo === 'Nogal')!;
        expect(alf.indice).toBeGreaterThan(1);
        expect(nog.indice).toBeLessThan(1);
        expect(alf.laminaCm).toBeCloseTo(160, 5);
        expect(r.some(x => x.cultivo === 'Sorgo')).toBe(false); // 10 ha: muestra chica
        expect(r.some(x => x.cultivo === 'Chile')).toBe(false); // sin volumen: no se inventa
        expect(r[0].cultivo).toBe('Alfalfa'); // orden por agua
    });
    it('vacío si no hay datos', () => { expect(intensidadHidrica([])).toEqual([]); });
});

describe('reporteCiclo', () => {
    const F = [
        f(2024, 1, 'Alfalfa', 100, 5000), f(2024, 2, 'Alfalfa', 100, 5000),
        f(2026, 1, 'Alfalfa', 200, 6000), f(2026, 1, 'Nogal', 100, 4000),
        f(2026, 2, 'Nogal', 100, 8000),
    ];
    const refs = referenciaCicloActual(F, null, [1, 2]);
    it('autorizado contra entregado (ACUM_INF) por módulo, con cultivo líder y lámina', () => {
        const r = reporteCiclo(F, refs, new Map([[1, 12], [2, 10]]));
        const m1 = r.find(x => x.modulo === 1)!, m2 = r.find(x => x.modulo === 2)!;
        expect(m1.entregadoHm3).toBeCloseTo(10, 5);
        expect(m1.pctAutorizado).toBeCloseTo(83.33, 1);
        expect(m1.saldoHm3).toBeCloseTo(2, 5);
        expect(m1.superficieHa).toBe(300);
        expect(m1.laminaCm).toBeCloseTo(333.3, 1);
        expect(m1.cultivoLider).toMatchObject({ cultivo: 'Alfalfa' });
        expect(m2.saldoHm3).toBeCloseTo(2, 5);
        expect(m1.posicion).toBe('sobre-rango'); // referencia = solo 2024 (5 hm³); 10 hm³ queda arriba
        expect(m1.pctVsTipico).toBeCloseTo(100, 5);
    });
    it('total: suma solo módulos con autorizado y entregado; sin autorización queda S/D (null), no 0', () => {
        const t = reporteCiclo(F, refs, new Map([[1, 12]])).at(-1)!;
        expect(t.modulo).toBeNull();
        expect(t.entregadoHm3).toBeCloseTo(18, 5);
        expect(t.autorizadoHm3).toBe(12);
        expect(t.pctAutorizado).toBeCloseTo(83.33, 1); // 10 / 12: solo el M1 tiene las dos cifras
        const sin = reporteCiclo(F, refs, new Map()).at(-1)!;
        expect(sin).toMatchObject({ autorizadoHm3: null, pctAutorizado: null, saldoHm3: null });
    });
    it('saldo negativo si se entregó más de lo autorizado; módulo sin informe 2026 = null', () => {
        const r = reporteCiclo(F, refs, new Map([[1, 8], [2, 10]]));
        expect(r.find(x => x.modulo === 1)!.saldoHm3).toBeCloseTo(-2, 5);
        const sinInf = reporteCiclo(F.filter(x => x.anio !== 2026), referenciaCicloActual(F.filter(x => x.anio !== 2026), null, [1]), new Map([[1, 8]]));
        expect(sinInf[0]).toMatchObject({ entregadoHm3: null, pctAutorizado: null, saldoHm3: null, cultivoLider: null });
    });
});

describe('lecturaIntensidad', () => {
    it('palabras llanas, sin «×»: más, menos o lo justo (±5 %)', () => {
        expect(lecturaIntensidad(1.4)).toEqual({ cifra: '40 % más', tendencia: 'mas' });
        expect(lecturaIntensidad(0.5)).toEqual({ cifra: '50 % menos', tendencia: 'menos' });
        expect(lecturaIntensidad(1.03)).toEqual({ cifra: 'Lo justo', tendencia: 'justo' });
        expect(lecturaIntensidad(0.97).cifra).toBe('Lo justo');
        expect(lecturaIntensidad(1.4).cifra).not.toMatch(/×/);
    });
});
