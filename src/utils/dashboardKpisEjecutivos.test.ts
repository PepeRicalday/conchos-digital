import { describe, it, expect } from 'vitest';
import {
    estadoPresas, diasSuficiencia, avanceCiclo, brechaCiclo, estadoModulo, demandaRiego, confianzaTablero, tendenciaTexto, estadoGoes, estadoNdvi,
} from './dashboardKpisEjecutivos';

describe('estadoPresas (umbrales únicos 20/40)', () => {
    it.each([[null, 'sd'], [10, 'crit'], [30.9, 'warn'], [55, 'ok']])('%s → %s', (pct, tipo) => {
        expect(estadoPresas(pct as number | null).tipo).toBe(tipo);
    });
});

describe('diasSuficiencia', () => {
    it('sin almacenamiento o sin extracción medida → S/D (nunca 0)', () => {
        expect(diasSuficiencia(null, 5)).toMatchObject({ dias: null, estado: { tipo: 'sd' } });
        expect(diasSuficiencia(900, null)).toMatchObject({ dias: null, estado: { tipo: 'sd' } });
    });
    it('extracción 0 (presas cerradas) → estado propio, sin infinito ni 0', () => {
        const r = diasSuficiencia(981, 0);
        expect(r.dias).toBeNull();
        expect(r.estado).toMatchObject({ tipo: 'info', texto: 'Presas cerradas' });
    });
    it('calcula días y semáforo', () => {
        // 100 Mm³ a 10 m³/s = 100 / (10·0.0864) = 115.7 d
        expect(diasSuficiencia(100, 10).dias).toBeCloseTo(115.74, 1);
        expect(diasSuficiencia(100, 10).estado.tipo).toBe('ok');
        expect(diasSuficiencia(40, 10).estado.tipo).toBe('warn');   // 46 d
        expect(diasSuficiencia(20, 10).estado.tipo).toBe('crit');   // 23 d
    });
});

describe('ciclo', () => {
    it('ciclo concluido: 100 % y sin juicio de ritmo', () => {
        const c = avanceCiclo('2026-10-31', '2025-10-01', '2026-09-30');
        expect(c).toMatchObject({ pct: 100, concluido: true });
        expect(brechaCiclo(78.6, c).estado).toMatchObject({ tipo: 'info', texto: 'Ciclo concluido' });
        expect(brechaCiclo(104, c).estado.texto).toBe('Sobregiro');
    });
    it('a mitad de ciclo compara contra el avance con tolerancia', () => {
        const c = avanceCiclo('2026-04-01', '2025-10-01', '2026-09-30');
        expect(c.pct).toBeGreaterThan(48); expect(c.pct).toBeLessThan(52);
        expect(brechaCiclo(50, c).estado.texto).toBe('En ritmo');
        expect(brechaCiclo(75, c).estado.texto).toBe('Adelantado');
        expect(brechaCiclo(20, c).estado.texto).toBe('Atrasado');
    });
    it('sin fechas o sin entregado → S/D', () => {
        expect(avanceCiclo('2026-04-01', null, null).pct).toBeNull();
        expect(brechaCiclo(null, avanceCiclo('2026-04-01', '2025-10-01', '2026-09-30')).estado.tipo).toBe('sd');
        expect(brechaCiclo(40, avanceCiclo('2026-04-01', null, null)).estado.tipo).toBe('sd');
    });
    it('estadoModulo da una letra y texto', () => {
        const c = avanceCiclo('2026-10-31', '2025-10-01', '2026-09-30');
        expect(estadoModulo(89, c)).toMatchObject({ letra: 'C' });
        expect(estadoModulo(null, c)).toMatchObject({ letra: '—', estado: { tipo: 'sd' } });
    });
});

describe('demandaRiego', () => {
    it('ETo menos lluvia, sin negativos', () => {
        expect(demandaRiego(2.2, 0.2).netaMm).toBeCloseTo(2.0);
        expect(demandaRiego(1, 5).netaMm).toBe(0);
    });
    it('sin ETo → S/D; sin lluvia → no afirma neta', () => {
        expect(demandaRiego(null, 1)).toMatchObject({ netaMm: null, estado: { tipo: 'sd' } });
        expect(demandaRiego(3, null).estado.texto).toBe('Sin dato de lluvia');
    });
    it('clasifica baja/media/alta', () => {
        expect(demandaRiego(1.5, 0).estado.texto).toBe('Baja');
        expect(demandaRiego(4, 0).estado.texto).toBe('Media');
        expect(demandaRiego(7, 0).estado.texto).toBe('Alta');
    });
});

describe('confianzaTablero', () => {
    it('ignora fuentes aún desconocidas (null) y lista las caídas', () => {
        const r = confianzaTablero([{ clave: 'a', nombre: 'Presas', ok: true }, { clave: 'b', nombre: 'GOES', ok: false }, { clave: 'c', nombre: 'Clima', ok: null }]);
        expect(r).toMatchObject({ pct: 50, vigentes: 1, total: 2, caidas: ['GOES'] });
        expect(r.fuentes).toHaveLength(3);
        expect(r.estado.tipo).toBe('warn');
    });
    it('sin ninguna fuente conocida → S/D', () => {
        expect(confianzaTablero([{ clave: 'a', nombre: 'x', ok: null }]).pct).toBeNull();
    });
    it('todas vigentes → confiable', () => {
        expect(confianzaTablero([{ clave: 'a', nombre: 'x', ok: true }]).estado.tipo).toBe('ok');
    });
});

describe('tendenciaTexto', () => {
    it('describe subida, bajada y estable con texto', () => {
        expect(tendenciaTexto([930, null, 950, 981], 'Mm³', 1).texto).toBe('Sube 51.0 Mm³ en 4 d');
        expect(tendenciaTexto([10, 8], 'm', 0.5).dir).toBe('baja');
        expect(tendenciaTexto([5, 5.1], 'm', 0.5).dir).toBe('estable');
        expect(tendenciaTexto([null, 3], 'm', 0.5).dir).toBe('sd');
    });
});

describe('estadoGoes', () => {
    it('clasifica por estaciones que transmiten', () => {
        expect(estadoGoes(0, 4)).toMatchObject({ tipo: 'crit', texto: 'Sin transmisión' });
        expect(estadoGoes(2, 4).tipo).toBe('warn');
        expect(estadoGoes(4, 4).tipo).toBe('ok');
    });
    it('sin estaciones o sin dato → S/D', () => {
        expect(estadoGoes(null, 4).tipo).toBe('sd');
        expect(estadoGoes(0, 0).tipo).toBe('sd');
    });
});

describe('estadoNdvi', () => {
    it('compara la anomalía con ±0.05', () => {
        expect(estadoNdvi(-0.071).texto).toBe('Bajo lo normal');
        expect(estadoNdvi(0.02).texto).toBe('Normal');
        expect(estadoNdvi(0.09).texto).toBe('Sobre lo normal');
    });
    it('sin anomalía no afirma nada', () => {
        expect(estadoNdvi(null)).toEqual({ tipo: 'info', texto: 'Sin referencia' });
    });
});
