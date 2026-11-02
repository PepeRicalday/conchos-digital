import { describe, it, expect } from 'vitest';
import { resumenDias, condicionDe, cieloAhora, fraseResumen, fraseAhora, horaLocal } from './climaPronosticoDash';
import type { PuntoHora } from './dashboardExtra';

// 2026-11-02 12:00 en Chihuahua (UTC−6) = 18:00 UTC
const AHORA = Date.UTC(2026, 10, 2, 18, 0, 0);
const h = (offH: number, p: Partial<PuntoHora> = {}): PuntoHora => ({ t: AHORA + offH * 3_600_000, lluviaMm: 0, tempC: 20, probPct: 0, ...p });

describe('condicionDe', () => {
    it('S/D sin probabilidad ni lámina', () => expect(condicionDe(null, null)).toBe('sd'));
    it('lluvia probable ≥ 60 %', () => expect(condicionDe(70, 0)).toBe('lluvia'));
    it('lluvia posible 30–59 %', () => expect(condicionDe(40, 0)).toBe('posible'));
    it('seco con 0 % y 0 mm (0 real ≠ S/D)', () => expect(condicionDe(0, 0)).toBe('seco'));
});

describe('resumenDias', () => {
    it('separa hoy y mañana y toma máx/mín', () => {
        const horas = [...[0, 1, 2, 3, 4].map((i) => h(i, { tempC: 25 + i })), ...[13, 14, 15, 16].map((i) => h(i, { tempC: 10 + i, probPct: 80, lluviaMm: 1 }))];
        const [hoy, man] = resumenDias(horas, AHORA);
        expect(hoy.tMax).toBe(29); expect(hoy.tMin).toBe(25); expect(hoy.condicion).toBe('seco');
        expect(man.tMax).toBe(26); expect(man.condicion).toBe('lluvia');
    });
    it('pocas horas = S/D, nunca 0', () => {
        const [hoy, man] = resumenDias([h(0), h(1)], AHORA);
        expect(hoy.tMax).toBeNull(); expect(hoy.condicion).toBe('sd'); expect(man.horas).toBe(0);
    });
});

describe('cielo y frases', () => {
    it('sin nubosidad = no determinado', () => expect(cieloAhora(null, 12).tipo).toBe('sd'));
    it('noche despejada', () => expect(cieloAhora(5, 22).tipo).toBe('noche'));
    it('hora local de Chihuahua', () => expect(horaLocal(AHORA)).toBe(12));
    it('frase resumen con S/D', () => expect(fraseResumen(resumenDias([], AHORA))).toContain('sin pronóstico suficiente'));
    it('frase ahora: helada manda', () => expect(fraseAhora(cieloAhora(10, 5), -1, null, 0)).toBe('Riesgo de helada'));
});
