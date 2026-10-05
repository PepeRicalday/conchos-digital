import { describe, it, expect } from 'vitest';
import {
    indexarSerie, valorMetrica, aniosDisponibles, serieMes, serieAnio, deltaMes, cierresPorAnio,
    posicionHistorica, matrizMensual, extremos, calidadMes, mismaFecha, diaDelAnio, diasDelMes, formatearNumero,
    type FilaSerie,
} from './historicoPresas';

const fila = (fecha: string, alm: number | null, extra: Partial<FilaSerie> = {}): FilaSerie => ({
    presa_id: 'PRE-001', fecha, escala_msnm: alm == null ? null : 1300 + alm / 1000, almacenamiento_mm3: alm,
    pct: alm == null ? null : alm / 28.46782, fuente: 'HISTORICO', calidad: 'OK',
    almacenamiento_reportado_mm3: alm == null ? null : alm + 10, pct_reportado: alm == null ? null : alm / 28.9, ...extra,
});

const datos = (): FilaSerie[] => [
    fila('2024-09-29', 500), fila('2024-09-30', 510),
    fila('2024-10-01', 512), fila('2024-10-15', 540), fila('2024-10-31', 560),
    fila('2025-10-01', 900), fila('2025-10-31', 950),
    fila('2023-10-10', 300),
];

describe('calendario', () => {
    it('días del mes y día del año alineado (bisiesto fijo)', () => {
        expect(diasDelMes(2024, 2)).toBe(29);
        expect(diasDelMes(2025, 2)).toBe(28);
        expect(diaDelAnio(3, 1)).toBe(60); // 1-mar siempre en la misma posición, sea o no bisiesto
    });
});

describe('S/D nunca cero', () => {
    it('un día sin dato es null, no 0', () => {
        const idx = indexarSerie(datos());
        const s = serieMes(idx['PRE-001'], 2024, 10, 'volumen', 'normalizada');
        expect(s).toHaveLength(31);
        expect(s[1]).toBeNull(); // 2-oct sin lectura
        expect(s[0]).toBe(512);
    });
    it('formatearNumero muestra S/D para null', () => {
        expect(formatearNumero(null)).toBe('S/D');
        expect(formatearNumero(0, 1)).toBe('0.0'); // un cero real sí se muestra
    });
    it('FUERA_DE_RANGO no grafica la elevación', () => {
        const idx = indexarSerie([fila('2025-03-08', 433, { calidad: 'FUERA_DE_RANGO', escala_msnm: 1241.4, almacenamiento_mm3: null })]);
        expect(valorMetrica(idx['PRE-001'].get('2025-03-08'), 'elevacion', 'normalizada')).toBeNull();
    });
});

describe('series normalizada vs reportada', () => {
    it('elige la columna según el tipo de serie', () => {
        const p = indexarSerie(datos())['PRE-001'].get('2024-10-01');
        expect(valorMetrica(p, 'volumen', 'normalizada')).toBe(512);
        expect(valorMetrica(p, 'volumen', 'reportada')).toBe(522);
        expect(valorMetrica(p, 'elevacion', 'reportada')).toBeCloseTo(1300.512, 3); // la elevación es medida: igual en ambas
    });
});

describe('deltaMes — convención SRL (último del mes − último del mes anterior)', () => {
    it('usa el cierre del mes previo', () => {
        const d = deltaMes(indexarSerie(datos())['PRE-001'], 2024, 10, 'volumen', 'normalizada')!;
        expect(d.base).toBe('mes-anterior');
        expect(d.delta).toBe(560 - 510);
        expect(d.desde.fecha).toBe('2024-09-30');
    });
    it('sin mes previo usa el primer día del propio mes', () => {
        const d = deltaMes(indexarSerie(datos())['PRE-001'], 2025, 10, 'volumen', 'normalizada')!;
        expect(d.base).toBe('primer-dia');
        expect(d.delta).toBe(50);
    });
    it('una sola lectura → S/D (null), nunca 0.0', () => {
        const idx = indexarSerie([fila('2026-10-05', 700)]);
        expect(deltaMes(idx['PRE-001'], 2026, 10, 'volumen', 'normalizada')).toBeNull();
    });
    it('mes sin datos → null', () => {
        expect(deltaMes(indexarSerie(datos())['PRE-001'], 2022, 5, 'volumen', 'normalizada')).toBeNull();
    });
});

describe('contexto histórico', () => {
    const idx = indexarSerie(datos());
    it('años disponibles en orden descendente', () => {
        expect(aniosDisponibles(idx)).toEqual([2025, 2024, 2023]);
    });
    it('cierres por año ordenados y posición del año base', () => {
        const c = cierresPorAnio(idx['PRE-001'], [2025, 2024, 2023], 10, 'volumen', 'normalizada');
        expect(c.map(x => x.anio)).toEqual([2023, 2024, 2025]);
        expect(posicionHistorica(c, 2024)).toEqual({ posicion: 2, de: 3 });
        expect(posicionHistorica(c, 2020)).toBeNull();
    });
    it('un solo año con dato → sin posición', () => {
        const c = cierresPorAnio(idx['PRE-001'], [2025], 10, 'volumen', 'normalizada');
        expect(posicionHistorica(c, 2025)).toBeNull();
    });
    it('extremos del registro', () => {
        const e = extremos(idx['PRE-001'], 'volumen', 'normalizada')!;
        expect(e.max).toEqual({ fecha: '2025-10-31', valor: 950 });
        expect(e.min).toEqual({ fecha: '2023-10-10', valor: 300 });
    });
});

describe('matriz mensual y calidad', () => {
    const idx = indexarSerie(datos());
    it('cierra cada mes con su último dato y deja S/D donde no hay', () => {
        const m = matrizMensual(idx['PRE-001'], [2024], 'volumen', 'normalizada').get(2024)!;
        expect(m).toHaveLength(12);
        expect(m[9].valor).toBe(560);   // octubre
        expect(m[9].dias).toBe(3);
        expect(m[0].valor).toBeNull();  // enero sin datos
    });
    it('calidad del mes: con dato, sin dato, atípicos', () => {
        const filas = [...datos(), fila('2024-10-20', 9999, { calidad: 'REVISAR' })];
        const q = calidadMes(indexarSerie(filas)['PRE-001'], 2024, 10);
        expect(q.diasMes).toBe(31);
        expect(q.conDato).toBe(4);
        expect(q.sinDato).toBe(27);
        expect(q.atipicos).toBe(1);
    });
});

describe('serieAnio', () => {
    it('alinea por día del año', () => {
        const s = serieAnio(indexarSerie(datos())['PRE-001'], 2024, 'volumen', 'normalizada');
        expect(s).toHaveLength(366);
        expect(s[diaDelAnio(10, 1)]).toBe(512);
        expect(s[diaDelAnio(1, 1)]).toBeNull();
    });
});

describe('mismaFecha', () => {
    const idx = indexarSerie(datos());
    it('toma el día exacto cuando existe', () => {
        const r = mismaFecha(idx['PRE-001'], 10, 31, [2025, 2024], 'volumen', 'normalizada');
        expect(r.find(x => x.anio === 2025)).toMatchObject({ valor: 950, desfaseDias: 0 });
    });
    it('usa el dato más cercano dentro de la tolerancia e informa el desfase', () => {
        const r = mismaFecha(idx['PRE-001'], 10, 3, [2024], 'volumen', 'normalizada');
        expect(r[0]).toMatchObject({ fecha: '2024-10-01', desfaseDias: -2, valor: 512 });
    });
    it('sin dato cercano el año no aparece (S/D)', () => {
        expect(mismaFecha(idx['PRE-001'], 6, 15, [2024, 2025], 'volumen', 'normalizada')).toEqual([]);
    });
});

describe('prioridad de fuentes', () => {
    it('CAMPO prevalece sobre HISTORICO en la misma fecha', () => {
        const idx = indexarSerie([fila('2026-03-07', 1000), fila('2026-03-07', 1083, { fuente: 'CAMPO' })]);
        expect(idx['PRE-001'].get('2026-03-07')?.alm).toBe(1083);
    });
});
