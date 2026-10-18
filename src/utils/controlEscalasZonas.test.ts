import { describe, it, expect } from 'vitest';
import { construirZonas, type EscalaMeta, type LecturaEscala } from './controlEscalasZonas';

const AHORA = Date.UTC(2026, 9, 18, 18, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const sec = [{ id: 'S1', nombre: 'Zona 1', color: '#38bdf8' }];
const esc = (id: string, km: number, extra: Partial<EscalaMeta> = {}): EscalaMeta => ({
    id, nombre: id, km, seccion_id: 'S1', nivel_min_operativo: 2.8, nivel_max_operativo: 3.4, capacidad_max: 4, pzas_radiales: 0, ancho: 0, alto: 0, ...extra,
});
const op = (extra = {}) => ({ fecha: '2026-10-18', esHoy: true, vaciado: false, ahoraMs: AHORA, ...extra });
const auto = (id: string, nivel: number): LecturaEscala => ({ escala_id: id, fecha: '2026-10-18', hora_lectura: '00:00:00', creado_en: iso(AHORA - 3_600_000), nivel_m: nivel, confirmada: false, radiales_json: [], gasto_calculado_m3s: null });

describe('construirZonas', () => {
    it('fila autogenerada: nivel visible pero sin alerta ni promedio (arrastre)', () => {
        const [z] = construirZonas([esc('K-23', 23)], sec, [auto('K-23', 0.15)], [], op());
        expect(z.scales[0]).toMatchObject({ currentLevel: 0.15, estado: 'arrastre', alerta: false, origen: 'arrastre', gasto: null });
    });

    it('fecha pasada sin resumen => S/D (no rellena con la lectura más reciente)', () => {
        const [z] = construirZonas([esc('K-23', 23)], sec, [], [], op({ esHoy: false, fecha: '2026-10-01' }));
        expect(z.scales[0].currentLevel).toBeNull();
        expect(z.scales[0].estado).toBe('sd');
    });

    it('lectura de campo reciente fuera de rango => alerta con magnitud', () => {
        const l: LecturaEscala = { ...auto('K-23', 2.5), confirmada: true };
        const [z] = construirZonas([esc('K-23', 23)], sec, [l], [], op());
        expect(z.scales[0]).toMatchObject({ estado: 'bajo', alerta: true });
        expect(z.scales[0].desviacionM).toBeCloseTo(-0.3);
    });

    it('en vaciado una lectura de campo baja no alarma', () => {
        const l: LecturaEscala = { ...auto('K-23', 0.2), confirmada: true };
        const [z] = construirZonas([esc('K-23', 23)], sec, [l], [], op({ vaciado: true }));
        expect(z.scales[0]).toMatchObject({ estado: 'vaciado', alerta: false });
    });

    it('escala de referencia: nunca gasto ni alerta', () => {
        const l: LecturaEscala = { ...auto('K-64', 1), confirmada: true, gasto_calculado_m3s: 53 };
        const [z] = construirZonas([esc('K-64', 64)], sec, [l], [], op());
        expect(z.scales[0]).toMatchObject({ referencia: true, gasto: null, alerta: false, estado: 'referencia' });
    });

    it('compuertas sin radiales_json en lectura confirmada => S/D, gasto crudo (no 0 inventado)', () => {
        const l: LecturaEscala = { ...auto('K-0', 3), confirmada: true, gasto_calculado_m3s: null };
        const [z] = construirZonas([esc('K-0', 0, { pzas_radiales: 12, ancho: 1.5, alto: 1.8 })], sec, [l], [], op());
        expect(z.scales[0].aperturas.every(a => a === null)).toBe(true);
        expect(z.scales[0].gasto).toBeNull();
    });

    it('ordena zonas y escalas por km', () => {
        const zs = construirZonas([esc('B', 50), esc('A', 10)], sec, [], [], op());
        expect(zs[0].scales.map(s => s.name)).toEqual(['A', 'B']);
    });
});
