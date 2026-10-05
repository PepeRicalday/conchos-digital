import { describe, it, expect } from 'vitest';
import { estadoPorEdad, normalizaSalud, textoEdad, resumenRed, fraseRed, type FilaSaludRed } from './saludRed';

const fila = (over: Partial<FilaSaludRed> = {}): FilaSaludRed => ({
    estacion_id: 'e1', nombre: 'Módulo 1', rol: 'modulo', modulo_id: 'MOD-001',
    ultima_lectura: '2026-10-05T19:00:00Z', edad_min: 16, bloques_con_dato: 21, bloques_completos: 23,
    cobertura_48h_pct: '91.3', hueco_max_h_7d: '2.3', lecturas_7d: 105, bloques_2h: [true, false, true],
    estado: 'VIGENTE', temp_ultima_c: '25.6', desviacion_temp_c: '0.7', sospechosa: false, ...over,
});

describe('saludRed — un solo criterio de frescura (cron de 2 h)', () => {
    it('clasifica por edad con los umbrales 150 / 360 min', () => {
        expect(estadoPorEdad(0)).toBe('VIGENTE');
        expect(estadoPorEdad(150)).toBe('VIGENTE');
        expect(estadoPorEdad(151)).toBe('RETRASADA');
        expect(estadoPorEdad(360)).toBe('RETRASADA');
        expect(estadoPorEdad(361)).toBe('SIN_SEÑAL');
        expect(estadoPorEdad(null)).toBe('SIN_SEÑAL');
    });

    it('una estación con 100 min de antigüedad está vigente (con 20/60 min saldría "vencida")', () => {
        expect(estadoPorEdad(100)).toBe('VIGENTE');
    });

    it('normaliza los números que PostgREST devuelve como texto', () => {
        const s = normalizaSalud(fila());
        expect(s.coberturaPct).toBeCloseTo(91.3, 5);
        expect(s.huecoMaxH).toBeCloseTo(2.3, 5);
        expect(s.desviacionTempC).toBeCloseTo(0.7, 5);
        expect(s.bloques).toEqual([true, false, true]);
        expect(s.moduloId).toBe('MOD-001');
    });

    it('datos ausentes se quedan null (S/D), bloques vacíos si no hay arreglo', () => {
        const s = normalizaSalud(fila({ cobertura_48h_pct: null, desviacion_temp_c: null, bloques_2h: null, sospechosa: null }));
        expect(s.coberturaPct).toBeNull();
        expect(s.desviacionTempC).toBeNull();
        expect(s.bloques).toEqual([]);
        expect(s.sospechosa).toBe(false);
    });

    it('textoEdad', () => {
        expect(textoEdad(null)).toBe('sin lecturas');
        expect(textoEdad(0.2)).toBe('hace instantes');
        expect(textoEdad(16)).toBe('hace 16 min');
        expect(textoEdad(130)).toBe('hace 2 h 10 min');
        expect(textoEdad(120)).toBe('hace 2 h');
        expect(textoEdad(3 * 1440)).toBe('hace 3 d');
    });

    it('resumen y frase de la red', () => {
        const est = [
            normalizaSalud(fila({ estacion_id: 'a' })),
            normalizaSalud(fila({ estacion_id: 'b', estado: 'RETRASADA', edad_min: 200 })),
            normalizaSalud(fila({ estacion_id: 'c', estado: 'SIN_SEÑAL', edad_min: 800, cobertura_48h_pct: null })),
            normalizaSalud(fila({ estacion_id: 'd', sospechosa: true })),
        ];
        const r = resumenRed(est);
        expect(r).toMatchObject({ total: 4, vigentes: 2, retrasadas: 1, sinSenal: 1, sospechosas: 1 });
        expect(r.coberturaMediaPct).toBeCloseTo(91.3, 5); // la estación sin cobertura no cuenta como 0
        expect(fraseRed(r)).toBe('2 de 4 vigentes · 1 retrasada · 1 sin señal · 1 con lecturas sospechosas');
    });

    it('red vacía', () => {
        const r = resumenRed([]);
        expect(r.coberturaMediaPct).toBeNull();
        expect(fraseRed(r)).toBe('Sin estaciones configuradas');
    });
});
