import { describe, it, expect } from 'vitest';
import { resumeVerificacion, resumeSemana, type EntradaVerificacion, type FilaSkillLluviaCat, type FilaPronosticoDiario, type ResumenDia } from './informePronosticoDatos';

const cat = (id: string, a: number, o: number, f: number, n: number): FilaSkillLluviaCat => ({
    estacion_id: id, estacion_nombre: id, dias: a + o + f + n, aciertos: a, omisiones: o, falsas_alarmas: f, correctos_negativos: n,
});
const entrada = (lluviaCat?: FilaSkillLluviaCat[]): EntradaVerificacion => ({ variables: [], lluviaDias: [], lluviaCat, corridasConservadas: 0 });

describe('resumeVerificacion · lluvia categórica', () => {
    it('suma estaciones y cuenta eventos = aciertos + omisiones', () => {
        const r = resumeVerificacion(entrada([cat('A', 1, 1, 2, 2), cat('B', 0, 1, 0, 5)]), new Set(), []);
        expect(r.lluviaCat).toEqual({ estacionDias: 12, aciertos: 1, omisiones: 2, falsasAlarmas: 2, eventos: 3 });
    });

    it('excluye estaciones sospechosas', () => {
        const r = resumeVerificacion(entrada([cat('A', 1, 0, 0, 4), cat('B', 0, 5, 0, 0)]), new Set(['B']), []);
        expect(r.lluviaCat).toEqual({ estacionDias: 5, aciertos: 1, omisiones: 0, falsasAlarmas: 0, eventos: 1 });
    });

    it('sin datos devuelve null (nunca ceros inventados)', () => {
        expect(resumeVerificacion(entrada(), new Set(), []).lluviaCat).toBeNull();
        expect(resumeVerificacion(entrada([]), new Set(), []).lluviaCat).toBeNull();
    });

    it('acepta numéricos como texto (así llegan de PostgREST)', () => {
        const fila = { ...cat('A', 2, 0, 1, 3), dias: '6', aciertos: '2', falsas_alarmas: '1' } as unknown as FilaSkillLluviaCat;
        expect(resumeVerificacion(entrada([fila]), new Set(), []).lluviaCat?.estacionDias).toBe(6);
    });
});

const dia = (est: string, fecha: string, o: Partial<FilaPronosticoDiario> = {}): FilaPronosticoDiario => ({
    estacion_id: est, fecha, temp_max_c: 25, temp_min_c: 12, precip_mm: 0, precip_prob_pct: 10, viento_max_ms: 4, ...o,
});

describe('resumeVerificacion · lluvias importantes', () => {
    const f = (estacion_nombre: string, dia: string, p: number, o: number) =>
        ({ estacion_id: estacion_nombre, estacion_nombre, dia, mm_pronosticado: String(p), mm_observado: String(o), error: String(p - o) });
    it('nombra cada día con lluvia observada ≥ 5 mm con lo emitido y lo medido por estación, el más reciente primero', () => {
        const r = resumeVerificacion({
            variables: [], corridasConservadas: 0,
            lluviaDias: [f('Módulo 1', '2026-10-25', 1.5, 21.8), f('Módulo 3', '2026-10-25', 0, 7.9), f('Boquilla', '2026-10-25', 2.6, 3),
                f('Módulo 1', '2026-10-24', 0.7, 0), f('Boquilla', '2026-10-23', 0, 6)],
        } as unknown as EntradaVerificacion, new Set(), []);
        expect(r.lluvia!.eventos.map(e => e.dia)).toEqual(['2026-10-25', '2026-10-23']);
        expect(r.lluvia!.eventos[0].estaciones[0]).toEqual({ estacion: 'Módulo 1', pronosticadoMm: 1.5, observadoMm: 21.8 });
        expect(r.lluvia!.eventos[0].estaciones).toHaveLength(3);
    });
});

describe('resumeSemana', () => {
    it('promedia la lluvia (no la suma), toma mediana de temperatura y máximo de probabilidad y viento', () => {
        const r = resumeSemana([
            dia('A', '2026-10-26', { precip_mm: 10, precip_prob_pct: 60, temp_max_c: 20, viento_max_ms: 5 }),
            dia('B', '2026-10-26', { precip_mm: 20, precip_prob_pct: 30, temp_max_c: 30, viento_max_ms: 9 }),
            dia('C', '2026-10-26', { precip_mm: 0, precip_prob_pct: 10, temp_max_c: 22, viento_max_ms: 3 }),
        ], new Set(), '2026-10-26');
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ lluviaMm: 10, probPct: 60, tMaxC: 22, vientoMaxMs: 9, estaciones: 3 });
    });

    it('descarta días pasados y estaciones sospechosas, y rotula confianza baja después del tercer día', () => {
        const filas = ['25', '26', '27', '28', '29', '30', '31'].map(d => dia('A', `2026-10-${d}`))
            .concat([dia('X', '2026-10-26', { precip_mm: 99 })]);
        const r = resumeSemana(filas, new Set(['X']), '2026-10-26');
        expect(r.map(x => x.fecha)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
        expect(r[0].lluviaMm).toBe(0);
        expect(r.map(x => x.confianza)).toEqual(['media', 'media', 'media', 'baja', 'baja', 'baja']);
    });

    it('un campo sin dato queda null (S/D), nunca 0; sin filas devuelve lista vacía', () => {
        const r = resumeSemana([dia('A', '2026-10-26', { viento_max_ms: null, precip_mm: null })], new Set(), '2026-10-26');
        expect(r[0].vientoMaxMs).toBeNull();
        expect(r[0].lluviaMm).toBeNull();
        expect(resumeSemana(undefined, new Set(), '2026-10-26')).toEqual([]);
    });

    it('la lluvia de hoy y de los días completos sale del pronóstico horario; el día cortado y los siguientes, de la tabla diaria', () => {
        const hz = (clave: string, etiqueta: string, parcial: boolean, mm: number | null, prob: number | null) =>
            ({ clave, etiqueta, parcial, lluviaPromMm: mm, probMaxPct: prob }) as unknown as ResumenDia;
        const filas = ['26', '27', '28', '29'].map(d => dia('A', `2026-10-${d}`, { precip_mm: 0, precip_prob_pct: 3, obtenido_en: '2026-10-26T06:25:00Z' }));
        const r = resumeSemana(filas, new Set(), '2026-10-26', [
            hz('2026-10-26', 'Hoy', true, 1.9, 34), hz('2026-10-27', 'Mañana', false, 14.4, 60), hz('2026-10-28', 'Pasado mañana', true, 0.2, 10),
        ]);
        expect(r.map(x => [x.lluviaMm, x.fuenteLluvia])).toEqual([[1.9, 'horario'], [14.4, 'horario'], [0, 'diario'], [0, 'diario']]);
        expect(r[0].lluviaParcial).toBe(true);
        expect(r[1].lluviaParcial).toBe(false);
        expect(r[1].probPct).toBe(60);
        expect(r[2].obtenidoEn).toBe('2026-10-26T06:25:00Z');
        expect(r[1].obtenidoEn).toBeNull();
    });
});
