import { describe, it, expect } from 'vitest';
import { modeloSuficiencia, muertoDePresa, serieTotalCiclo, bandaHistorica, DEMANDA_REF_PROVISIONAL_MM3, type PresaEntrada } from './suficiencia';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import type { PuntoCurva } from './presaNiveles';

const curva = (pares: [number, number][]): PuntoCurva[] => pares.map(([e, v]) => ({ elevacion_msnm: e, volumen_mm3: v, area_ha: null }));
// Boquilla: cota muerta oficial 1278.9 m → 95.9 Mm³ en esta curva de prueba
const curvaBoq = curva([[1250, 10], [1278.9, 95.9], [1300, 1000]]);
const curvaMad = curva([[1223.75, 36.34], [1240, 200], [1250, 333]]);
const boq = (alm: number | null): PresaEntrada => ({ id: 'PRE-001', nombre: 'Boquilla', almacenadoMm3: alm, capacidadMm3: 2847, curva: curvaBoq });
const mad = (alm: number | null): PresaEntrada => ({ id: 'PRE-002', nombre: 'Madero', almacenadoMm3: alm, capacidadMm3: 333, curva: curvaMad });

const fila = (presa_id: string, fecha: string, alm: number | null): FilaSerie => ({ presa_id, fecha, escala_msnm: null, almacenamiento_mm3: alm, pct: null, fuente: 'HISTORICO', calidad: 'OK', almacenamiento_reportado_mm3: alm, pct_reportado: null });

describe('muertoDePresa', () => {
    it('Boquilla: volumen de la curva en la cota muerta oficial', () => {
        const m = muertoDePresa('PRE-001', curvaBoq);
        expect(m.oficial).toBe(true);
        expect(m.mm3).toBeCloseTo(95.9, 1);
    });
    it('Madero: sin cota muerta oficial usa el piso de la curva y se marca estimado', () => {
        const m = muertoDePresa('PRE-002', curvaMad);
        expect(m).toEqual({ mm3: 36.34, oficial: false });
    });
    it('sin curva → S/D', () => { expect(muertoDePresa('PRE-002', [])).toEqual({ mm3: null, oficial: false }); });
});

describe('modeloSuficiencia', () => {
    const base = { hoyISO: '2026-10-31', indice: null };
    it('presas cerradas → pre-ciclo; útil = almacenado − muerto; cobertura contra la demanda provisional', () => {
        const m = modeloSuficiencia({ ...base, presas: [boq(803.8), mad(177.3)], extraccionM3s: 0 });
        expect(m.modo).toBe('preciclo');
        expect(m.utilTotalMm3).toBeCloseTo(803.8 - 95.9 + 177.3 - 36.34, 1);
        expect(m.cobertura).toBeCloseTo((m.utilTotalMm3 as number) / DEMANDA_REF_PROVISIONAL_MM3, 3);
        expect(m.estado.texto).toBe('Suficiente');
        expect(m.aviso.join(' ')).toContain('Madero');
        expect(m.aviso.join(' ')).toContain('provisional');
    });
    it('una presa sin lectura → total S/D (no se suma parcial)', () => {
        const m = modeloSuficiencia({ ...base, presas: [boq(803.8), mad(null)], extraccionM3s: 0 });
        expect(m.utilTotalMm3).toBeNull();
        expect(m.cobertura).toBeNull();
        expect(m.estado.tipo).toBe('sd');
    });
    it('demanda de referencia ausente → no inventa cobertura', () => {
        const m = modeloSuficiencia({ ...base, presas: [boq(803.8), mad(177.3)], extraccionM3s: 0, demandaRefMm3: null });
        expect(m.cobertura).toBeNull();
        expect(m.estado.tipo).toBe('info');
    });
    it('cobertura baja → atención / crítico', () => {
        expect(modeloSuficiencia({ ...base, presas: [boq(550), mad(100)], extraccionM3s: 0 }).estado.texto).toBe('Atención'); // ≈ 518/506 = 1.02
        expect(modeloSuficiencia({ ...base, presas: [boq(480), mad(100)], extraccionM3s: 0 }).estado.texto).toBe('Crítico'); // ≈ 448/506 = 0.89
    });
    it('temporada: compara los días que alcanza con los que faltan al 30-sep', () => {
        const m = modeloSuficiencia({ hoyISO: '2026-04-01', indice: null, presas: [boq(803.8), mad(177.3)], extraccionM3s: 33 });
        expect(m.modo).toBe('temporada');
        expect(m.diasAlcance).toBeCloseTo((m.utilTotalMm3 as number) / (33 * 0.0864), 1);
        expect(m.diasRestantes).toBe(182);
        expect(m.estado.texto).toBe('Alcanza al 30-sep');
        const poco = modeloSuficiencia({ hoyISO: '2026-04-01', indice: null, presas: [boq(150), mad(60)], extraccionM3s: 33 });
        expect(poco.estado.tipo).toBe('crit');
    });
    it('extracción S/D → pre-ciclo con aviso, no temporada', () => {
        const m = modeloSuficiencia({ ...base, presas: [boq(803.8), mad(177.3)], extraccionM3s: null });
        expect(m.modo).toBe('preciclo');
        expect(m.aviso).toContain('Extracción sin dato');
    });
});

describe('histórico del total', () => {
    // 4 ciclos con una lectura diaria de las 2 presas; el total del 31-oct de cada ciclo es 100·k
    const filas: FilaSerie[] = [];
    for (const [anio, total] of [[2021, 400], [2022, 800], [2023, 1200], [2024, 1600]] as const) {
        for (let d = 0; d < 366; d++) {
            const f = new Date(Date.UTC(anio, 9, 1 + d)).toISOString().slice(0, 10);
            if (f > `${anio + 1}-09-30`) break;
            filas.push(fila('PRE-001', f, total * 0.8), fila('PRE-002', f, total * 0.2));
        }
    }
    const indice = indexarSerie(filas);
    it('suma las dos presas solo cuando ambas tienen dato', () => {
        const s = serieTotalCiclo(indexarSerie([fila('PRE-001', '2022-10-01', 10), fila('PRE-001', '2022-10-02', 10), fila('PRE-002', '2022-10-02', 5)]), 2022);
        expect(s[0]).toBeNull();
        expect(s[1]).toBe(15);
    });
    it('banda y posición: hoy contra los ciclos pasados en el mismo día', () => {
        const idx2 = indexarSerie([...filas, fila('PRE-001', '2025-10-31', 500), fila('PRE-002', '2025-10-31', 200)]);
        const b = bandaHistorica(idx2, '2025-10-31');
        expect(b).not.toBeNull();
        expect(b!.ciclosUsados).toBe(4);
        expect(b!.posicion).toEqual({ posicion: 2, de: 5 }); // hoy 700: solo el ciclo de 400 está por debajo
    });
    it('menos de 3 ciclos comparables → sin banda (S/D)', () => {
        expect(bandaHistorica(indexarSerie(filas.filter((f) => f.fecha < '2023-10-01')), '2025-10-31')).toBeNull();
        expect(bandaHistorica(null, '2025-10-31')).toBeNull();
        expect(indice).toBeTruthy();
    });
});
