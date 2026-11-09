import { describe, it, expect } from 'vitest';
import { escalaDe } from './escalasCuenca';
import { colorBanda, VARIABLES_PLANO } from './paletasClima';
import { tituloPlano } from './planosCuenca';
import { valorObs, FRIO_VACIO, type PuntoConValores } from './jcasModelo';
import { consensoPorPunto, valorPronosticoPeriodo, type FilaPronostico } from './cuencaPronostico';
import { configClimaPorDefecto, cuentaPlanos, VARIABLES_INFORME } from './informeClimaCuencaConfig';

const vacio = { mm: null, temp: null, hum: null, viento: null };
const punto = (frio: Partial<typeof FRIO_VACIO>): PuntoConValores => ({
    hoy: null, ayer: vacio, medias: { temp7: 15, temp30: 15, hum7: 60, hum30: 60, viento7: 3, viento30: 3 }, mm7: null, mm30: null, largas: undefined, frio: { ...FRIO_VACIO, ...frio },
});

describe('planos de T mínima y horas frío', () => {
    it('escalas: crecientes, con base declarada y sin hablar de «normal»', () => {
        for (const v of ['tmin', 'horasFrio'] as const) {
            const e = escalaDe(v);
            expect([...e.niveles].sort((a, b) => a - b)).toEqual(e.niveles);
            expect(new Set(e.niveles).size).toBe(e.niveles.length);
            expect(e.base).toMatch(/n = 570|sin base registrada/);
            expect(e.base).not.toMatch(/normal|percentil|anomal/i);
        }
        expect(escalaDe('tmin').niveles).toContain(0); // el corte de helada
    });
    it('paletas de 8 pasos; la mínima va del frío (oscuro) al cálido (claro)', () => {
        expect(VARIABLES_PLANO.tmin.rampa).toHaveLength(8);
        expect(VARIABLES_PLANO.horasFrio.rampa).toHaveLength(8);
        const claro = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
        expect(claro(colorBanda('tmin', 0, 10))).toBeLessThan(claro(colorBanda('tmin', 10, 10)));
        expect(claro(colorBanda('horasFrio', 0, 10))).toBeGreaterThan(claro(colorBanda('horasFrio', 10, 10)));
    });
    it('títulos', () => {
        expect(tituloPlano('horasFrio', { tipo: 'obs', dias: 30 })).toMatch(/Horas frío acumuladas/);
        expect(tituloPlano('tmin', { tipo: 'obs', dias: 7 })).toBe('Temperatura mínima observada · últimos 7 días');
        expect(tituloPlano('tmin', { tipo: 'pron', dias: 7 })).toBe('Temperatura mínima pronosticada · próximos 7 días');
    });
    it('valorObs: T mínima por ventana y horas frío de la temporada; sin serie = S/D, nunca 0', () => {
        const p = punto({ tminHoy: 2, tmin1: 3, tmin7: -1, tmin30: -2, horasFrio: 120 });
        expect(valorObs(p, 'tmin', 'hoy')).toBe(2);
        expect(valorObs(p, 'tmin', 1)).toBe(3);
        expect(valorObs(p, 'tmin', 7)).toBe(-1);
        expect(valorObs(p, 'tmin', 30)).toBe(-2);
        expect(valorObs(p, 'tmin', 60)).toBeNull(); // ventana larga: no hay extremos
        expect(valorObs(p, 'horasFrio', 7)).toBe(120);
        expect(valorObs(p, 'horasFrio', 'ciclo')).toBe(120);
        const sin = punto({});
        expect(valorObs(sin, 'tmin', 7)).toBeNull();
        expect(valorObs(sin, 'horasFrio', 30)).toBeNull();
        expect(valorObs({ ...sin, frio: undefined }, 'horasFrio', 30)).toBeNull();
    });
    it('pronóstico: T mínima = la menor mínima del periodo; horas frío no se pronostican', () => {
        const fila = (fecha: string, tmin: number, modelo: string): FilaPronostico => ({ punto_id: 'a', modelo, fecha, precip_mm: 0, temp_media_c: 10, hum_media_pct: 50, viento_medio_kmh: 5, temp_max_c: 20, temp_min_c: tmin });
        const filas = ['2026-11-10', '2026-11-11', '2026-11-12'].flatMap((f, i) => ['ecmwf', 'gfs', 'icon'].map((m) => fila(f, [4, -1, 2][i], m)));
        const d = consensoPorPunto(filas, 'a', '2026-11-10');
        expect(valorPronosticoPeriodo(d, 'tmin', '2026-11-10', 3).valor).toBe(-1);
        expect(valorPronosticoPeriodo(d, 'tmin', '2026-11-10', 7).valor).toBeNull(); // 3 de 7 días: menos del 80 %
        expect(valorPronosticoPeriodo(d, 'horasFrio', '2026-11-10', 3).valor).toBeNull();
    });
    it('informe: variables opcionales (no cambian el informe por defecto) y horas frío solo observadas', () => {
        const c = configClimaPorDefecto();
        expect(c.variables).toEqual(['lluvia', 'temperatura', 'viento', 'humedad']);
        expect(cuentaPlanos(c)).toBe(8);
        expect(VARIABLES_INFORME.map((v) => v.id)).toEqual(expect.arrayContaining(['tmin', 'horasFrio']));
        expect(cuentaPlanos({ ...c, variables: [...c.variables, 'tmin', 'horasFrio'] })).toBe(8 + 2 + 1); // tmin obs+pron, horas frío solo obs
    });
});
