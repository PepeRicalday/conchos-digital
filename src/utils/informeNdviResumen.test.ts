import { describe, expect, it } from 'vitest';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme } from './informeNdviDatos';
import { UMBRAL_REVISION_VIGOR, listaModulos } from './informeNdviResumen';
import { configPorDefecto, type ConfigInformeNdvi } from './informeNdviConfig';
import { CAUTELA_TITULAR } from './ndviGrafica';
import { CLASES_NDVI } from './ndviRampa';

const MESES = ['03', '04', '05', '06', '07', '08', '09'];
const MODS = [1, 2, 3, 4, 5, 12];
const ANIOS = [2021, 2022, 2023, 2024, 2025, 2026];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];
// efecto de 2026 por módulo (M1 y M4 caen; M2 sube; el resto en línea)
const EF: Record<number, number> = { 1: -0.08, 2: 0.06, 4: -0.07 };
function serie(o: { base?: Record<number, number>; sinSep?: number[]; pocas?: number } = {}): FilaNdviInforme[] {
    return MODS.flatMap((m, i) => ANIOS.flatMap((a) => MESES.map((mm, k) => ({ m, i, a, mm, k })))).filter((x) => !(x.a === 2026 && x.mm === '09' && o.sinSep?.includes(x.m))).map(({ m, i, a, mm, k }) => ({
        numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes: `${a}-${mm}`,
        ndvi_medio: (o.base?.[m] ?? 0.2) + 0.05 * k + (a === 2026 ? EF[m] ?? 0 : 0), ndvi_desv: 0.07, kc_estimado: null, delta_ndvi: null,
        superficie_ha: SUP[i], fraccion_cobertura_activa: 0.5, n_escenas: a === 2026 && mm === '09' && m === o.pocas ? 1 : 4, pct_pixeles_validos: 0.9,
        ventana_desde: `${a}-${mm}-01`, ventana_hasta: mm === '09' ? `${a}-10-01` : `${a}-${mm}-28`, nubosidad_max_pct: 40,
    }));
}
const ctx = (): ContextoInforme => ({ volumenPorModulo: new Map(), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 24, 9, 0), emisor: null, version: 't' });
const meses = (f: FilaNdviInforme[]) => [...new Set(f.map((x) => x.mes))].sort();
const dato = (f = serie(), o: Partial<ConfigInformeNdvi> = {}) => construirDatosNdvi(f, ctx(), { ...configPorDefecto(meses(f)), ...o });

describe('resumen ejecutivo: titular, hallazgos y revisar', () => {
    it('el titular es la anomalía del periodo y la cautela es la constante oficial', () => {
        const r = dato().resumen;
        expect(r.titular).toMatch(/^Periodo marzo 2026 a septiembre 2026 frente a lo habitual: 2 por debajo, 1 por encima y 3 en línea \(de 6 módulos\)/);
        expect(r.cautela).toBe(CAUTELA_TITULAR);
    });
    it('sin años de referencia el titular dice el nivel del mes y que no hay con qué compararlo', () => {
        const r = dato(serie().filter((x) => x.mes.startsWith('2026'))).resumen;
        expect(r.titular).toContain('no hay años de referencia suficientes para decir si es habitual');
        expect(r.cautela).toBe(CAUTELA_TITULAR);
    });
    it('sin ningún dato no inventa cifras', () => {
        const r = dato([], { desde: '2026-03', hasta: '2026-09' }).resumen;
        expect(r.titular).toBe('No hay datos de NDVI suficientes para este corte.');
        expect(r.hallazgos).toEqual([]);
        expect(r.revisar).toEqual([]);
        expect(r.conciliacion.every((c) => c.valor == null || Number.isFinite(c.valor))).toBe(true);
    });
    it('entre 3 y 5 hallazgos, todos con cifra', () => {
        const h = dato().resumen.hallazgos;
        expect(h.length).toBeGreaterThanOrEqual(3);
        expect(h.length).toBeLessThanOrEqual(5);
        for (const t of h) expect(t, t).toMatch(/\d/);
    });
    it('con un solo módulo siguen saliendo hallazgos (sin comparar contra otros módulos)', () => {
        const r = dato(serie(), { modulos: [3] }).resumen;
        expect(r.hallazgos.length).toBeGreaterThanOrEqual(3);
        expect(r.hallazgos.join(' ')).not.toContain('Mayor vigor en');
    });
    it('estado del distrito por clase de vigor', () => {
        const r = dato().resumen;
        expect(r.estado).toMatch(/^septiembre 2026: \d de 6 módulos en /);
        expect(r.estado).toContain('(M');
    });
    it('qué revisar: criterios derivados de constantes; el umbral de vigor es el inicio de la clase "medio"', () => {
        expect(UMBRAL_REVISION_VIGOR).toBe(CLASES_NDVI.find((c) => c.clave === 'medio')!.desde);
        const r = dato().resumen;
        expect(r.criteriosRevision).toContain('bajo 0.30');
        expect(r.criteriosRevision).toContain('0.02 o más por debajo de lo habitual');
        expect(r.revisar[0]).toMatchObject({ modulos: [1, 4], criterio: 'por debajo de lo habitual' });
        expect(r.accionRevisar).toMatch(/no indica la causa/);
    });
    it('vigor bajo + por debajo de lo habitual se prioriza sobre lo demás; sin dato y poco confiable se reportan', () => {
        const r = dato(serie({ base: { 4: 0.0 }, sinSep: [12], pocas: 5 })).resumen;
        expect(r.revisar[0].criterio).toBe('vigor bajo y por debajo de lo habitual');
        expect(r.revisar[0].modulos).toContain(4);
        expect(r.revisar.some((x) => x.criterio === 'Sin dato en septiembre 2026' && x.modulos.includes(12))).toBe(true);
        expect(r.hallazgos.join(' ')).toMatch(/sin dato: M12/);
        expect(r.hallazgos.join(' ')).toMatch(/pocas observaciones limpias: M5/);
    });
    it('ninguna frase afirma causas', () => {
        const d = dato(serie({ base: { 4: 0.0 }, sinSep: [12] }));
        const txt = [d.resumen.titular, ...d.resumen.hallazgos, d.resumen.estado, ...d.resumen.revisar.map((x) => `${x.criterio} ${x.cifras}`), d.resumen.accionRevisar].join(' ');
        expect(txt).not.toMatch(/porque|debido a|a causa de|se debe|por culpa|provocad|ocasionad/i);
    });
    it('lista de módulos legible', () => {
        expect(listaModulos([4])).toBe('M4');
        expect(listaModulos([4, 5])).toBe('M4 y M5');
        expect(listaModulos([1, 4, 12])).toBe('M1, M4 y M12');
    });
});

describe('conciliación del NDVI de la SRL y su base', () => {
    it('cuatro cifras distintas rotuladas: mes, habitual, diferencia y pico medio', () => {
        const r = dato().resumen;
        const et = r.conciliacion.map((c) => c.etiqueta);
        expect(et[0]).toBe('Mes de referencia (septiembre 2026)');
        expect(et.some((e) => e.startsWith('Media del periodo'))).toBe(true);
        expect(et).toContain('Habitual (mismos meses, otros años)');
        expect(et).toContain('Diferencia contra lo habitual');
        expect(et.some((e) => e.startsWith('Pico medio 2026'))).toBe(true);
        for (const c of r.conciliacion) { expect(c.valor, c.etiqueta).not.toBeNull(); expect(c.nota.length).toBeGreaterThan(10); }
    });
    it('un mes solo: no hay "media del periodo" aparte', () => {
        const r = dato(serie(), { desde: '2026-09', hasta: '2026-09' }).resumen;
        expect(r.conciliacion.some((c) => c.etiqueta.startsWith('Media del periodo ('))).toBe(false);
    });
    it('la base elegida cambia las cifras y se imprime en la definición', () => {
        const s = dato(serie(), { basePromedio: 'simple' }), p = dato(serie(), { basePromedio: 'ponderado' });
        expect(s.resumen.definicionSrl).toContain('promedio simple');
        expect(p.resumen.definicionSrl).toContain('ponderado');
        expect(s.resumen.conciliacion[0].valor).not.toBeCloseTo(p.resumen.conciliacion[0].valor as number, 4);
        expect(s.resumen.titular).not.toContain('ponderado');
        expect(p.resumen.titular).toContain('promedio SRL ponderado por superficie');
    });
});

describe('modelo: IHR en piso, mes en curso y corte de datos', () => {
    it('IHR = 0 se marca como piso y no entra al promedio del IHR (nunca se promedia como medición)', () => {
        const f = serie().map((x) => (x.numero_modulo === 4 && x.mes === '2026-09' ? { ...x, ndvi_medio: 0.2, ndvi_desv: 0.5 } : x));
        const d = dato(f);
        expect(d.modulos.find((m) => m.numero === 4)).toMatchObject({ ihr: 0, ihrEnPiso: true });
        expect(d.nIhrEnPiso).toBe(1);
        const con = d.modulos.filter((m) => !m.ihrEnPiso).map((m) => m.ihr as number);
        expect(d.promedioIhr).toBeCloseTo(con.reduce((a, b) => a + b, 0) / con.length, 9);
    });
    it('corte de datos = último día de la ventana (la fecha final es exclusiva) y mes en curso solo cuando aplica', () => {
        const d = dato();
        expect(d.traza.corteDatos).toBe('2026-09-30');
        expect(d.traza.mesEnCurso).toBe(false);
        const enCurso = construirDatosNdvi(serie(), { ...ctx(), ahora: new Date(2026, 8, 15) }, { ...configPorDefecto(meses(serie())) });
        expect(enCurso.traza.mesEnCurso).toBe(true);
        expect(enCurso.avisos.some((a) => a.texto.includes('mes en curso'))).toBe(true);
        expect(d.avisos.some((a) => a.texto.includes('mes en curso'))).toBe(false);
    });
    it('un mes con pocas escenas limpias se declara en el aviso con nombre de mes legible (no ISO)', () => {
        const d = dato(serie({ pocas: 5 }));
        const a = d.avisos.find((x) => x.texto.includes('pocas observaciones'));
        expect(a?.texto).toContain('M5');
        expect(a?.texto).toContain('septiembre 2026');
        expect(a?.texto).not.toMatch(/\d{4}-\d{2}/);
    });
});

describe('resumen ejecutivo: redacción sin ambigüedad (auditoría Playwright del informe integrado)', () => {
    it('vigor bajo en un módulo que NO está por debajo de lo habitual se dice sin ambigüedad', () => {
        // M5 queda en 0.25 (< 0.30) en septiembre pero sin efecto de 2026: en línea con sus propios años.
        const r = dato(serie({ base: { 5: -0.05 } })).resumen;
        const it = r.revisar.find((x) => x.modulos.includes(5));
        expect(it?.criterio).toBe('vigor bajo, aunque no por debajo de lo habitual de sus meses');
        expect(r.revisar.map((x) => x.criterio).join(' ')).not.toContain('en línea o por encima');
    });
    it('una diferencia B − A que redondea a cero no lleva signo (no es un aumento)', () => {
        const h = dato(serie(), { modulos: [3] }).resumen.hallazgos.join(' ');
        expect(h).toMatch(/diferencia B − A 0\.000/);
        expect(h).not.toContain('+0.000');
        expect(h).not.toContain('−0.000');
    });
});
