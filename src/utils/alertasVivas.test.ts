import { describe, it, expect } from 'vitest';
import { construyeAlertasVivas, construyeChips, nombrarTramo, diasDesde, type EntradaAlertas } from './alertasVivas';

const AHORA = Date.parse('2026-10-05T18:00:00Z');
const base = (over: Partial<EntradaAlertas> = {}): EntradaAlertas => ({
    tomasVaradas: [], tramos: [], modulos: [], presas: [], protocolo: null, predictivas: [], ahoraMs: AHORA, ...over,
});
const presa = (id: string, cap: number, alm: number | null) => ({ id, nombre: id, capacidad_max_mm3: cap, lectura: alm == null ? null : { almacenamiento_mm3: alm, fecha: '2026-10-05' } });

describe('alertas vivas', () => {
    it('sin nada que reportar → "Sistema Estable" informativa', () => {
        const a = construyeAlertasVivas(base());
        expect(a).toHaveLength(1);
        expect(a[0]).toMatchObject({ id: 'ok', type: 'info' });
    });

    it('fuga material es crítica; pérdida baja es informativa; pérdida null dice S/D (no "0.00")', () => {
        const a = construyeAlertasVivas(base({
            tramos: [
                { km_inicio: 23, tramo_inicio: 'K23', tramo_fin: 'K29', eficiencia_pct: 51, q_perdida: 0.39 },
                { km_inicio: 40, eficiencia_pct: 80, q_perdida: 0.01 },
                { km_inicio: 50, eficiencia_pct: 70, q_perdida: null },
                { km_inicio: 60, eficiencia_pct: 95, q_perdida: 5 }, // eficiencia buena: no alerta
            ],
        }));
        expect(a.find(x => x.id === 'leak-23')!.type).toBe('critical');
        expect(a.find(x => x.id === 'leak-info-40')!.type).toBe('info');
        const sd = a.find(x => x.id === 'leak-info-50')!;
        expect(sd.message).toContain('S/D');
        expect(sd.message).not.toContain('0.00');
        expect(a.some(x => x.id.endsWith('-60'))).toBe(false);
    });

    it('presa sin lectura no genera alerta; nivel crítico se suprime en LLENADO', () => {
        expect(construyeAlertasVivas(base({ presas: [presa('A', 100, null)] })).map(x => x.id)).toEqual(['ok']);
        expect(construyeAlertasVivas(base({ presas: [presa('A', 100, 10)] })).some(x => x.id === 'dam-low-A')).toBe(true);
        const llenado = construyeAlertasVivas(base({ presas: [presa('A', 100, 10)], protocolo: { id: 'p', evento_tipo: 'LLENADO', fecha_inicio: '2026-10-01' } }));
        expect(llenado.some(x => x.id === 'dam-low-A')).toBe(false);
        expect(construyeAlertasVivas(base({ presas: [presa('B', 100, 95)] })).some(x => x.id === 'dam-high-B')).toBe(true);
    });

    it('sobregiro: tolerancia 10 % normal y 50 % en LLENADO', () => {
        const modulos = [{ id: 'm1', name: 'Módulo 1', current_flow: 1.3, target_flow: 1 }];
        expect(construyeAlertasVivas(base({ modulos })).some(x => x.id === 'ovf-m1')).toBe(true);
        expect(construyeAlertasVivas(base({ modulos, protocolo: { id: 'p', evento_tipo: 'LLENADO', fecha_inicio: null } })).some(x => x.id === 'ovf-m1')).toBe(false);
    });

    it('protocolo abierto > 30 días alerta; las predictivas no duplican una fuga real', () => {
        const a = construyeAlertasVivas(base({
            protocolo: { id: 'p1', evento_tipo: 'VACIADO', fecha_inicio: '2026-08-01T00:00:00Z' },
            tramos: [{ km_inicio: 23, eficiencia_pct: 50, q_perdida: 1 }],
            predictivas: [
                { id: 'pred-fuga-23', type: 'critical', title: 'dup', message: '', timestamp: '' },
                { id: 'pred-anomalia-40', type: 'warning', title: 'nueva', message: '', timestamp: '' },
            ],
        }));
        expect(a.some(x => x.id === 'proto-stale-p1')).toBe(true);
        expect(a.some(x => x.id === 'pred-fuga-23')).toBe(false);
        expect(a.some(x => x.id === 'pred-anomalia-40')).toBe(true);
    });

    it('helpers', () => {
        expect(nombrarTramo({ km_inicio: null })).toBe('Tramo KM s/d');
        expect(nombrarTramo({ tramo_inicio: 'K0', tramo_fin: 'K23' })).toBe('Tramo K0 → K23');
        expect(diasDesde('2026-10-01T18:00:00Z', AHORA)).toBe(4);
        expect(diasDesde(null, AHORA)).toBeNull();
    });
});

describe('chips de estado', () => {
    const entrada = (over = {}) => ({
        protocolo: null, diasProtocolo: null, almacenamiento: { parcial: false, presasConDato: 2, presasTotal: 2 },
        fuentesCaidas: [], frescuraPresas: [], ...over,
    });
    it('sin protocolo → chip ok', () => {
        expect(construyeChips(entrada())).toEqual([{ key: 'protocolo', sev: 'ok', texto: 'Sin protocolo activo' }]);
    });
    it('frescura POR presa: una al día no oculta a la vieja; orden crítico → ok', () => {
        const c = construyeChips(entrada({
            protocolo: { id: 'p', evento_tipo: 'VACIADO' }, diasProtocolo: 6,
            fuentesCaidas: ['Versiones'],
            frescuraPresas: [{ nombre: 'Boquilla', texto: 'hace 1 h', stale: false }, { nombre: 'Madero', texto: 'hace 3 días', stale: true }, { nombre: 'Otra', texto: null, stale: false }],
        }));
        expect(c[0]).toMatchObject({ key: 'fuentes-caidas', sev: 'crit' });
        expect(c.find(x => x.key === 'fresc-Madero')!.sev).toBe('warn');
        expect(c.find(x => x.key === 'fresc-Boquilla')!.sev).toBe('ok');
        expect(c.find(x => x.key === 'fresc-Otra')!.texto).toContain('sin lectura');
        expect(c[c.length - 1].sev).toBe('ok');
    });
    it('protocolo > 30 d pide revisar cierre', () => {
        const c = construyeChips(entrada({ protocolo: { id: 'p', evento_tipo: 'LLENADO', gasto_solicitado_m3s: 25 }, diasProtocolo: 40 }));
        expect(c[0]).toMatchObject({ sev: 'crit' });
        expect(c[0].texto).toContain('25 m³/s solicitados');
        expect(c[0].texto).toContain('revisar cierre');
    });
});
