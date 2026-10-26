import { describe, it, expect } from 'vitest';
import { resumeVerificacion, type EntradaVerificacion, type FilaSkillLluviaCat } from './informePronosticoDatos';

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
