import { describe, it, expect } from 'vitest';
import { resumeVerificacion, resumeSemana, type EntradaVerificacion, type FilaSkillLluviaCat, type FilaPronosticoDiario } from './informePronosticoDatos';

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
});
