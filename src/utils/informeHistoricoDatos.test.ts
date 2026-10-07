import { describe, expect, it } from 'vitest';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import { avisosConfig, configPorDefecto, mesesDelPeriodo, validarConfig } from './informeHistoricoConfig';
import { prepararInforme } from './informeHistoricoDatos';

const fila = (fecha: string, alm: number | null, pct: number | null, presa = 'PRE-001'): FilaSerie => ({
    presa_id: presa, fecha, escala_msnm: alm == null ? null : 1280 + alm / 100, almacenamiento_mm3: alm, pct, fuente: 'HISTORICO', calidad: alm == null ? 'SIN_DATO' : 'OK',
    almacenamiento_reportado_mm3: alm, pct_reportado: pct,
});

/** Serie sintética: octubre de cada año 2022-2025 completo (volumen = año-2000 * 10) y octubre 2026 solo los días 5 y 6. */
function datos(): FilaSerie[] {
    const out: FilaSerie[] = [];
    for (const a of [2022, 2023, 2024, 2025]) for (let d = 1; d <= 31; d++) out.push(fila(`${a}-10-${String(d).padStart(2, '0')}`, (a - 2000) * 10, (a - 2000) / 2));
    out.push(fila('2026-10-05', 100, 3.5), fila('2026-10-06', 102, 3.6));
    return out;
}

const HOY = new Date('2026-10-06T18:00:00Z');

describe('configuración', () => {
    it('ciclo agrícola cruza el cambio de año (oct→sep)', () => {
        const m = mesesDelPeriodo({ tipo: 'cicloAgricola', mes: 1, mesIni: 1, mesFin: 12 });
        expect(m).toHaveLength(12);
        expect(m[0]).toEqual({ mes: 10, desfase: 0 });
        expect(m[3]).toEqual({ mes: 1, desfase: 1 });
        expect(m[11]).toEqual({ mes: 9, desfase: 1 });
    });

    it('validarConfig rechaza más de 3 años, año repetido y años inexistentes', () => {
        const c = configPorDefecto([2026, 2025, 2024, 2023], HOY);
        expect(validarConfig(c, [2026, 2025, 2024, 2023])).toEqual([]);
        expect(validarConfig({ ...c, aniosComparar: [2025, 2024, 2023, 2022] }, [2026, 2025, 2024, 2023, 2022]).join()).toMatch(/Máximo 3/);
        expect(validarConfig({ ...c, aniosComparar: [2026] }, [2026]).join()).toMatch(/repetirse/);
        expect(validarConfig({ ...c, aniosComparar: [1999] }, [2026]).join()).toMatch(/1999/);
        expect(validarConfig({ ...c, presas: [] }, [2026, 2025, 2024, 2023]).join()).toMatch(/presa/);
    });

    it('avisa al mezclar serie reportada con 2021', () => {
        const c = { ...configPorDefecto([2026, 2021], HOY), serie: 'reportada' as const, aniosComparar: [2021] };
        expect(avisosConfig(c).join()).toMatch(/no es comparable/);
    });
});

describe('prepararInforme', () => {
    const idx = indexarSerie(datos());
    const base = { ...configPorDefecto([2026, 2025, 2024, 2023, 2022], HOY), periodo: { tipo: 'mes' as const, mes: 10, mesIni: 1, mesFin: 12 }, presas: ['PRE-001' as const], metricas: ['volumen' as const, 'llenado' as const, 'deltaAparente' as const] };

    it('cierre del año base, posición y año parcial excluido de referencia', () => {
        const d = prepararInforme({ ...base, aniosComparar: [2025, 2024] }, idx, HOY);
        const vol = d.presas[0].bloques.find(b => b.metrica === 'volumen')!;
        expect(vol.cierreBase?.valor).toBe(102);
        // Base (2026) parcial: cobertura 2/6, pero siempre entra al ranking; 2022-2025 completos.
        expect(vol.series[0].parcial).toBe(true);
        expect(vol.ranking.map(r => r.anio)).toEqual([2022, 2023, 2024, 2025, 2026].sort((a, b) => (a === 2026 ? 102 : (a - 2000) * 10) - (b === 2026 ? 102 : (b - 2000) * 10)));
        expect(vol.posicion).toEqual({ posicion: 1, de: 5 }); // 102 Mm³ < todos los años previos (220-250)
        expect(vol.semaforo).toBe('rojo');
        expect(vol.anomalia?.n).toBe(4);
        expect(vol.vsPrevio?.anio).toBe(2025);
    });

    it('S/D se propaga como null, nunca 0', () => {
        const d = prepararInforme({ ...base, anioBase: 2026, aniosComparar: [2025] }, idx, HOY);
        const vol = d.presas[0].bloques[0];
        expect(vol.series[0].valores[0]).toBeNull(); // 1-oct-2026 sin lectura
        expect(vol.series[0].valores[4]).toBe(100); // 5-oct
        expect(vol.series[0].valores.every(v => v !== 0)).toBe(true);
    });

    it('mes sin ningún dato → cierre S/D y hallazgo lo dice', () => {
        const d = prepararInforme({ ...base, periodo: { tipo: 'mes', mes: 3, mesIni: 1, mesFin: 12 }, aniosComparar: [2025] }, idx, HOY);
        const vol = d.presas[0].bloques[0];
        expect(vol.cierreBase).toBeNull();
        expect(vol.semaforo).toBe('sd');
        expect(d.presas[0].hallazgos[0]).toMatch(/S\/D/);
    });

    it('Δ aparente por mes y huecos detectados en la cobertura', () => {
        const d = prepararInforme({ ...base, aniosComparar: [2025] }, idx, HOY);
        expect(d.presas[0].deltas).toHaveLength(1);
        const cal = d.presas[0].calidad[0];
        expect(cal.esperados).toBe(6); // días 1-6 de oct-2026 (el resto es futuro)
        expect(cal.conDato).toBe(2);
        expect(cal.huecos).toEqual([{ desde: '2026-10-01', hasta: '2026-10-04', dias: 4 }]);
    });
});
