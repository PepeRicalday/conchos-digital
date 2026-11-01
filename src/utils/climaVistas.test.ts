import { describe, it, expect } from 'vitest';
import { demanda24h, type FilaPronostico } from './dashboardExtra';
import { resumenVariables24h, vistaPorDefecto, severidadVista, puntoRocio } from './climaVistas';

const AHORA = Date.parse('2026-11-01T12:00:00Z');
const fila = (id: string, i: number, extra: Partial<FilaPronostico> = {}): FilaPronostico => ({
    estacion_id: id, valido_en: new Date(AHORA + (i + 1) * 3_600_000).toISOString(), corrida_en: '2026-11-01T11:00:00Z',
    precip_mm: 0, precip_prob_pct: 5, temp_c: 15, temp_c_corr: null, viento_ms: 2, viento_ms_corr: null, eto_fc_mm: 0.2,
    hum_rel_pct: 40, ...extra,
});
const dia = (id: string, extra: (i: number) => Partial<FilaPronostico> = () => ({})) => Array.from({ length: 24 }, (_, i) => fila(id, i, extra(i)));

describe('resumenVariables24h', () => {
    it('helada con el PEOR caso entre estaciones, no con el promedio', () => {
        // A llega a 1 °C a la hora 10; B se queda en 9 °C → promedio 5 °C (sin aviso), peor caso 1 °C (aviso)
        const d = demanda24h([...dia('A', (i) => ({ temp_c: i === 10 ? 1 : 12 })), ...dia('B', () => ({ temp_c: 9 }))], AHORA);
        const r = resumenVariables24h(d);
        expect(r.temp.tMin?.v).toBe(1);
        expect(r.temp.severidad).toBe('warn');
        expect(r.temp.horasBajoAviso).toBe(1);
        expect(vistaPorDefecto(r)).toBe('temp');
    });
    it('helada crítica ≤ 0 °C y prioridad sobre viento en aviso', () => {
        const d = demanda24h([...dia('A', (i) => ({ temp_c: i === 5 ? -1 : 10, viento_ms: 7 })), ...dia('B')], AHORA);
        const r = resumenVariables24h(d);
        expect(r.temp.severidad).toBe('crit');
        expect(r.viento.severidad).toBe('warn');
        expect(vistaPorDefecto(r)).toBe('temp');
    });
    it('viento: vale el peor de sostenido y ráfaga; usa la ráfaga corregida', () => {
        const d = demanda24h([...dia('A', () => ({ viento_ms: 3, viento_rafaga_ms: 20, viento_rafaga_ms_corr: 13 })), ...dia('B')], AHORA);
        const r = resumenVariables24h(d);
        expect(r.viento.rafaga?.v).toBe(13);
        expect(r.viento.severidad).toBe('warn');
        expect(vistaPorDefecto(r)).toBe('viento');
    });
    it('el viento de una estación de PRESA no dispara el aviso agrícola', () => {
        const filas = [...dia('M1', () => ({ viento_ms: 4 })), ...dia('M3', () => ({ viento_ms: 5 })), ...dia('PRESA', () => ({ viento_ms: 9 }))];
        expect(resumenVariables24h(demanda24h(filas, AHORA)).viento.severidad).toBe('warn');
        const r = resumenVariables24h(demanda24h(filas, AHORA, [], ['PRESA']));
        expect(r.viento.max?.v).toBe(5);
        expect(r.viento.severidad).toBe('ok');
    });
    it('lluvia probable con prob ≥ 60 % abre la vista de lluvia', () => {
        const d = demanda24h([...dia('A', () => ({ precip_mm: 0.3, precip_prob_pct: 70 })), ...dia('B', () => ({ precip_mm: 0.3, precip_prob_pct: 65 }))], AHORA);
        const r = resumenVariables24h(d);
        expect(r.lluvia.probable).toBe(true);
        expect(r.lluvia.mm).toBeCloseTo(7.2);
        expect(vistaPorDefecto(r)).toBe('lluvia');
    });
    it('S/D por vista: sin humedad no cae la tarjeta; con una sola estación no se afirma', () => {
        const d = demanda24h([...dia('A', () => ({ hum_rel_pct: null })), ...dia('B', () => ({ hum_rel_pct: null }))], AHORA);
        const r = resumenVariables24h(d);
        expect(r.hr.sd).toBe(true);
        expect(r.temp.sd).toBe(false);
        expect(r.eto.sd).toBe(false);
        const una = resumenVariables24h(demanda24h(dia('A'), AHORA));
        expect(una.temp.sd).toBe(true);
        expect(severidadVista(una, 'temp')).toBe('sd');
    });
    it('sin riesgos la vista por defecto es ETₒ; sin pronóstico todo es S/D', () => {
        expect(vistaPorDefecto(resumenVariables24h(demanda24h([...dia('A'), ...dia('B')], AHORA)))).toBe('eto');
        const nada = resumenVariables24h(null);
        expect(nada.eto.sd && nada.temp.sd && nada.lluvia.sd && nada.viento.sd && nada.hr.sd).toBe(true);
    });
    it('escarcha probable con HR ≥ 90 % y T ≤ aviso en la misma hora', () => {
        const d = demanda24h([...dia('A', (i) => ({ temp_c: i === 8 ? 2 : 12, hum_rel_pct: i === 8 ? 95 : 50 })), ...dia('B', () => ({ temp_c: 12 }))], AHORA);
        expect(resumenVariables24h(d).hr.escarcha).toBe(true);
    });
});

describe('puntoRocio', () => {
    it('Magnus: 20 °C y 50 % ≈ 9.3 °C', () => { expect(puntoRocio(20, 50)!).toBeCloseTo(9.3, 0); });
});
