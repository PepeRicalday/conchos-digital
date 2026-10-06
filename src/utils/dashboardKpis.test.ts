import { describe, it, expect } from 'vitest';
import {
    extraccionTotalMedida, serieExtraccion, tendenciaSerie, desplazaDia, datosAlmacenamientoPresas, cumplimientoModulo,
    promedioSinNulos, alertaDesdeRegistro, fusionaAlertas, resumenAlertas, DIAS_ALERTA_VIGENTE, type AlertaSistema, type AlertaRegistroFila,
} from './dashboardKpis';

const presa = (nombre: string, cap: number, lectura: Record<string, unknown> | null) => ({ nombre, capacidad_max_mm3: cap, lectura } as never);

describe('extracción total — S/D no es 0', () => {
    it('sin ninguna medición → null (antes sumaba || 0 y mostraba 0.0 m³/s)', () => {
        const r = extraccionTotalMedida([presa('A', 100, null), presa('B', 50, { almacenamiento_mm3: 10 })]);
        expect(r).toEqual({ valorM3s: null, conMedicion: 0, total: 2 });
    });
    it('un 0 medido es un valor real', () => {
        expect(extraccionTotalMedida([presa('A', 1, { extraccion_total_m3s: 0 })]).valorM3s).toBe(0);
    });
    it('suma solo lo medido y declara cobertura', () => {
        const r = extraccionTotalMedida([presa('A', 1, { extraccion_total_m3s: 12.5 }), presa('B', 1, null), presa('C', 1, { extraccion_total_m3s: '7.5' })]);
        expect(r).toEqual({ valorM3s: 20, conMedicion: 2, total: 3 });
    });
});

describe('serie de 7 días con huecos', () => {
    it('días sin datos quedan null y el eje es continuo', () => {
        const s = serieExtraccion([
            { fecha: '2026-10-03', extraccion_total_m3s: 10 },
            { fecha: '2026-10-03', extraccion_total_m3s: 5 },
            { fecha: '2026-10-05', extraccion_total_m3s: null },
        ], '2026-10-05');
        expect(s).toHaveLength(7);
        expect(s[0].fecha).toBe('2026-09-29');
        expect(s[6].fecha).toBe('2026-10-05');
        expect(s.find((p) => p.fecha === '2026-10-03')!.total).toBe(15);
        expect(s[6].total).toBeNull(); // la fila existe pero sin valor
        expect(s[0].total).toBeNull();
    });
    it('desplazaDia cruza mes y año', () => {
        expect(desplazaDia('2026-03-01', -1)).toBe('2026-02-28');
        expect(desplazaDia('2026-01-01', -1)).toBe('2025-12-31');
    });
    it('tendencia con los dos últimos días con dato; sin base → null', () => {
        const mk = (...t: (number | null)[]) => t.map((total, i) => ({ fecha: `d${i}`, total }));
        expect(tendenciaSerie(mk(null, 10, null, 12))).toBe('rising');
        expect(tendenciaSerie(mk(10, 9.99))).toBe('stable');
        expect(tendenciaSerie(mk(10, 8))).toBe('falling');
        expect(tendenciaSerie(mk(null, null, 5))).toBeNull();
    });
});

describe('almacenamiento por presa y módulos', () => {
    it('presa sin lectura: actual y pct null (no 0)', () => {
        const d = datosAlmacenamientoPresas([presa('Boquilla', 2903, { almacenamiento_mm3: 702.5 }), presa('Madero', 324, null)] as never);
        expect(d[0].pct).toBeCloseTo(24.2, 1);
        expect(d[1]).toMatchObject({ actual: null, pct: null });
    });
    it('cumplimiento: sin volumen autorizado → null, sobregiro sin truncar', () => {
        expect(cumplimientoModulo(50, null)).toBeNull();
        expect(cumplimientoModulo(50, 0)).toBeNull();
        expect(cumplimientoModulo(null, 100)).toBeNull();
        expect(cumplimientoModulo(145, 100)).toBe(145);
    });
    it('promedio ignora nulos y devuelve null si no hay ninguno', () => {
        expect(promedioSinNulos([80, null, 100])).toBe(90);
        expect(promedioSinNulos([null])).toBeNull();
    });
});

describe('alertas: una sola fuente', () => {
    const ahora = Date.parse('2026-10-05T18:00:00Z');
    const fila = (over: Partial<AlertaRegistroFila>): AlertaRegistroFila => ({
        id: 'x1', tipo_riesgo: 'warning', categoria: 'infraestructura', titulo: 'Tensión en Red', mensaje: 'm', origen_id: 'PE-1',
        fecha_deteccion: '2026-03-20T10:00:00Z', ...over,
    });
    const viva = (id: string, type: AlertaSistema['type']): AlertaSistema => ({ id, type, title: id, message: '', timestamp: 'Ahora' });

    it('una alerta persistida de marzo es "pendiente antigua" y no infla lo accionable de hoy', () => {
        const antigua = alertaDesdeRegistro(fila({}), ahora);
        expect(antigua.antigua).toBe(true);
        const r = resumenAlertas(fusionaAlertas([viva('leak-1', 'critical')], [antigua]));
        expect(r).toMatchObject({ criticas: 1, avisos: 0, accionables: 1, antiguas: 1 });
    });
    it('la vigencia se corta en DIAS_ALERTA_VIGENTE', () => {
        const hace = (d: number) => new Date(ahora - d * 86_400_000).toISOString();
        expect(alertaDesdeRegistro(fila({ fecha_deteccion: hace(DIAS_ALERTA_VIGENTE - 1) }), ahora).antigua).toBe(false);
        expect(alertaDesdeRegistro(fila({ fecha_deteccion: hace(DIAS_ALERTA_VIGENTE + 1) }), ahora).antigua).toBe(true);
    });
    it('las agroclimáticas vigentes cuentan y traen su acción sugerida', () => {
        const a = alertaDesdeRegistro(
            fila({ tipo_riesgo: 'critical', categoria: 'agroclimatica', origen_id: 'CLIMA-helada-abc', fecha_deteccion: '2026-10-05T12:00:00Z' }),
            ahora, { helada: 'Proteger cultivos sensibles.' },
        );
        expect(a).toMatchObject({ antigua: false, accion: 'Proteger cultivos sensibles.', type: 'critical' });
        expect(resumenAlertas([a]).accionables).toBe(1);
    });
    it('no duplica ids entre vivas y persistidas; ordena críticas primero y antiguas al final', () => {
        const f = fusionaAlertas(
            [viva('a', 'warning'), viva('b', 'critical')],
            [alertaDesdeRegistro(fila({}), ahora), { ...viva('b', 'critical') }],
        );
        expect(f.map((x) => x.id)).toEqual(['b', 'a', 'reg-x1']);
    });
    it('severidad desconocida cae a informativa', () => {
        expect(alertaDesdeRegistro(fila({ tipo_riesgo: 'rara' }), ahora).type).toBe('info');
    });
});
