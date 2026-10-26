import { describe, it, expect } from 'vitest';
import { semaforoHoras, tramoMasLargo, resumenSalir, escalasSvg, semaforoSvg, type HoraSemaforo } from './informePronosticoSalir';
import type { DatosPronostico } from './informePronosticoDatos';

const H = 3_600_000;
// 2026-10-26 14:00 UTC = 08:00 en Chihuahua (UTC-6): hora de día.
const T0 = Date.UTC(2026, 9, 26, 14, 0, 0);
const U = { vientoAvisoMs: 6, vientoCriticoMs: 10 };

type HoraMod = { ts: number; probPct: number | null; precipMm: number | null; vientoMs: number | null };
const datos = (horas: HoraMod[][]): DatosPronostico => ({
    ejeHoras: horas[0].map(h => h.ts),
    modulos: horas.map((hs, i) => ({ numero: i + 1, horas: hs })),
} as unknown as DatosPronostico);
const h = (i: number, probPct: number | null, precipMm: number | null = 0, vientoMs: number | null = 2): HoraMod => ({ ts: T0 + i * H, probPct, precipMm, vientoMs });

describe('semaforoHoras', () => {
    it('sin probabilidad de lluvia es "sin información", nunca "buen momento"', () => {
        expect(semaforoHoras(datos([[h(0, null)]]), U)[0].nivel).toBe('sin');
    });

    it('clasifica por lluvia y viento tomando el módulo más desfavorable', () => {
        const niveles = semaforoHoras(datos([
            [h(0, 10), h(1, 35), h(2, 70), h(3, 10, 0, 11), h(4, 10, 3), h(5, 10, 0, 7)],
            [h(0, 5), h(1, 5), h(2, 5), h(3, 5), h(4, 5), h(5, 5)],
        ]), U).map(x => x.nivel);
        expect(niveles).toEqual(['bueno', 'cuidado', 'evitar', 'evitar', 'evitar', 'cuidado']);
    });
});

describe('tramoMasLargo / resumenSalir', () => {
    const mk = (niveles: HoraSemaforo['nivel'][], diurna = true): HoraSemaforo[] => niveles.map((nivel, i) => ({ ts: T0 + i * H, nivel, diurna }));

    it('elige el tramo continuo más largo y exige mínimo de horas', () => {
        const v = tramoMasLargo(mk(['bueno', 'cuidado', 'bueno', 'bueno', 'bueno', 'evitar']), 'bueno', true);
        expect(v).toMatchObject({ desdeMs: T0 + 2 * H, hastaMs: T0 + 5 * H, horas: 3 });
        expect(tramoMasLargo(mk(['bueno', 'cuidado', 'bueno']), 'bueno', true)).toBeNull();
    });

    it('con soloDia ignora las horas de noche', () => {
        expect(tramoMasLargo(mk(['bueno', 'bueno', 'bueno'], false), 'bueno', true)).toBeNull();
    });

    it('sin información no inventa un horario', () => {
        const r = resumenSalir(mk(['sin', 'sin', 'sin']));
        expect(r.mejor).toMatch(/Sin información/);
        expect(r.evitar).toBeNull();
    });

    it('informa el tramo a evitar aunque sea de una sola hora', () => {
        expect(resumenSalir(mk(['bueno', 'bueno', 'evitar', 'bueno'])).evitar).toMatch(/Mejor evitar salir/);
    });
});

describe('SVG', () => {
    it('escalas: sin dato rotula "sin información" y con dato muestra el máximo', () => {
        expect(escalasSvg({ maxMmh: null, maxKmh: null })).toContain('sin información');
        const s = escalasSvg({ maxMmh: 4.3, maxKmh: 27 });
        expect(s).toContain('4.3 mm/h');
        expect(s).toContain('27 km/h');
    });

    it('semáforo: menos de 2 horas no dibuja nada', () => {
        expect(semaforoSvg([])).toBe('');
    });
});
