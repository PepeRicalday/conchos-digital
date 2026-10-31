import { describe, it, expect } from 'vitest';
import { modeloPerfilCanal, instanteDeLectura } from './perfilCanal';
import type { EscalaMeta, LecturaEscala } from './controlEscalasZonas';

const AHORA = Date.parse('2026-10-31T22:00:00Z'); // 16:00 hora de Chihuahua
const meta = (id: string, km: number, extra: Partial<EscalaMeta> = {}): EscalaMeta => ({ id, nombre: `K-${km}`, km, nivel_min_operativo: 2.8, nivel_max_operativo: 3.4, pzas_radiales: 0, ...extra });
const metas: EscalaMeta[] = [meta('a', 0), meta('b', 23), meta('c', 64), meta('d', 104, { nivel_max_operativo: 3.0 })];
const lec = (escala_id: string, fecha: string, hora: string, nivel: number | null, extra: Partial<LecturaEscala> = {}): LecturaEscala =>
    ({ escala_id, fecha, hora_lectura: hora, nivel_m: nivel, confirmada: true, gasto_calculado_m3s: null, ...extra });
const arrastre = (escala_id: string, nivel: number) => lec(escala_id, '2026-10-31', '00:00:00', nivel, { confirmada: false, creado_en: '2026-10-31T06:00:00Z' });

describe('instanteDeLectura', () => {
    it('interpreta fecha + hora en UTC−6', () => {
        expect(instanteDeLectura('2026-10-29', '08:31:10')).toBe(Date.parse('2026-10-29T14:31:10Z'));
        expect(instanteDeLectura(null, null)).toBeNull();
    });
});

describe('modeloPerfilCanal', () => {
    it('solo arrastre: 0 vigentes, sin medición de campo; el nivel del arrastre no es una medición', () => {
        const m = modeloPerfilCanal(metas, [arrastre('a', 0.2), arrastre('d', 0.8)], AHORA, true);
        expect(m.total).toBe(4);
        expect(m.conMedicion).toBe(0);
        expect(m.ultimaMedicionMs).toBeNull();
        const a = m.escalas.find((e) => e.id === 'a')!;
        expect(a.origen).toBe('arrastre');
        expect(a.nivelM).toBeNull();
        expect(a.nivelArrastreM).toBe(0.2);
        expect(a.estado).toBe('arrastre');
        expect(m.escalas.find((e) => e.id === 'b')!.estado).toBe('sd');
        expect(m.fueraDeRango).toBeNull();
        expect(m.conduccion.eficienciaPct).toBeNull();
    });
    it('la edad sale de fecha + hora_lectura, no de creado_en (arrastre promovido a confirmado)', () => {
        const l = lec('a', '2026-10-31', '15:30:00', 3.1, { creado_en: '2026-10-31T06:00:00Z' }); // medida hace 30 min
        const m = modeloPerfilCanal(metas, [l], AHORA, false);
        const a = m.escalas.find((e) => e.id === 'a')!;
        expect(a.vigente).toBe(true);
        expect(a.edadMin).toBeCloseTo(30, 0);
        expect(m.conMedicion).toBe(1);
    });
    it('medición vieja de campo: sigue mostrando su nivel pero no es vigente; estado stale', () => {
        const m = modeloPerfilCanal(metas, [lec('a', '2026-10-08', '17:43:00', 0.2), arrastre('a', 0.2)], AHORA, false);
        const a = m.escalas.find((e) => e.id === 'a')!;
        expect(a.origen).toBe('campo');
        expect(a.nivelM).toBe(0.2);
        expect(a.vigente).toBe(false);
        expect(a.estado).toBe('stale');
        expect(m.conMedicion).toBe(0);
        expect(m.ultimaMedicionMs).toBe(instanteDeLectura('2026-10-08', '17:43:00'));
    });
    it('mezcla vigente: en rango / bajo / alto y posición u dentro del rango', () => {
        const m = modeloPerfilCanal(metas, [lec('a', '2026-10-31', '15:00:00', 3.1), lec('b', '2026-10-31', '15:00:00', 2.5), lec('d', '2026-10-31', '15:00:00', 3.4)], AHORA, false);
        expect(m.conMedicion).toBe(3);
        expect(m.escalas.find((e) => e.id === 'a')).toMatchObject({ estado: 'en_rango' });
        expect(m.escalas.find((e) => e.id === 'a')!.u).toBeCloseTo(0.5, 2);
        expect(m.escalas.find((e) => e.id === 'b')!.estado).toBe('bajo');
        expect(m.escalas.find((e) => e.id === 'd')!.estado).toBe('alto');
        expect(m.fueraDeRango).toBe(2);
    });
    it('vaciado: el rango de riego no aplica → sin "fuera de rango"', () => {
        const m = modeloPerfilCanal(metas, [lec('a', '2026-10-31', '15:00:00', 0.2), lec('b', '2026-10-31', '15:00:00', 0.1)], AHORA, true);
        expect(m.conMedicion).toBe(2);
        expect(m.fueraDeRango).toBeNull();
        expect(m.escalas.find((e) => e.id === 'a')!.estado).toBe('vaciado');
    });
    it('escala de referencia (K-64): aporta nivel, nunca gasto', () => {
        const m = modeloPerfilCanal(metas, [lec('c', '2026-10-31', '15:00:00', 2.8, { gasto_metodo: 'curva_nivel', gasto_calculado_m3s: 53.28 })], AHORA, false);
        const c = m.escalas.find((e) => e.id === 'c')!;
        expect(c.referencia).toBe(true);
        expect(c.gastoM3s).toBeNull();
        expect(c.estado).toBe('referencia');
    });
    it('K-0 y K-104 vigentes con gasto → eficiencia; con K-0 viejo → S/D pero conserva el último aforo', () => {
        const q = (n: number) => ({ gasto_metodo: 'curva_nivel', gasto_calculado_m3s: n });
        const bien = modeloPerfilCanal(metas, [lec('a', '2026-10-31', '15:00:00', 3, q(40)), lec('d', '2026-10-31', '15:00:00', 2.9, q(36))], AHORA, false);
        expect(bien.conduccion.eficienciaPct).toBeCloseTo(90, 5);
        const viejo = modeloPerfilCanal(metas, [lec('a', '2026-10-08', '17:43:00', 0.2, q(0.158)), lec('d', '2026-10-31', '15:00:00', 2.9, q(36))], AHORA, false);
        expect(viejo.conduccion.eficienciaPct).toBeNull();
        expect(viejo.k0.gasto).toBeNull();
        expect(viejo.k0.ultimoAforoM3s).toBeCloseTo(0.158, 3);
        expect(viejo.k0.ultimoAforoMs).toBe(instanteDeLectura('2026-10-08', '17:43:00'));
    });
    it('sin escalas ni lecturas → modelo vacío sin romper', () => {
        const m = modeloPerfilCanal([], [], AHORA, false);
        expect(m.total).toBe(0);
        expect(m.conMedicion).toBe(0);
        expect(m.ultimaMedicionMs).toBeNull();
    });
});
