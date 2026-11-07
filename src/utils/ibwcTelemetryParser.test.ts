import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTelemetriaIbwc, cstAUtcIso, filtrarCadencia } from '../../supabase/functions/ibwc-telemetry-sync/parser';

const fixture = readFileSync('supabase/functions/ibwc-telemetry-sync/ibwc_08373000.fixture.txt', 'utf8');

describe('telemetría USIBWC (TelemetryTXT)', () => {
  const r = parseTelemetriaIbwc(fixture);

  it('identifica sitio y nombre desde el encabezado', () => {
    expect(r.sitio).toBe('08373000');
    expect(r.nombre).toBe('Rio Conchos Near Ojinaga, Chih.');
  });

  it('convierte CST fijo (UTC-6) a UTC: 16:00 CST = 22:00 UTC', () => {
    const l = r.lecturas.find((x) => x.ts_utc === '2026-11-07T22:00:00.000Z' && x.variable === 'nivel_m')!;
    expect(l.valor).toBe(1.488);
    expect(r.lecturas.find((x) => x.ts_utc === '2026-11-07T22:00:00.000Z' && x.variable === 'gasto_m3s')!.valor).toBe(1.42);
  });

  it('entrega las lecturas en orden ascendente', () => {
    const ts = r.lecturas.map((x) => x.ts_utc);
    expect(ts).toEqual([...ts].sort());
  });

  it('S/D (---, centinela -999999) y fechas imposibles se omiten, nunca se vuelven 0', () => {
    expect(r.lecturas.some((x) => x.valor === 0)).toBe(false);
    expect(r.lecturas.some((x) => x.ts_utc === '2026-11-05T06:15:00.000Z')).toBe(false); // fila "---"
    expect(r.lecturas.some((x) => x.valor < -900)).toBe(false);
    expect(r.descartadas).toBe(2); // "---" y 02/31
  });

  it('con nivel válido y gasto S/D conserva solo el nivel', () => {
    const t = '2026-11-05T06:00:00.000Z';
    expect(r.lecturas.find((x) => x.ts_utc === t && x.variable === 'nivel_m')?.valor).toBe(1.442);
    expect(r.lecturas.find((x) => x.ts_utc === t && x.variable === 'gasto_m3s')).toBeUndefined();
  });

  it('ignora líneas sin formato y texto vacío', () => {
    expect(parseTelemetriaIbwc('').lecturas).toEqual([]);
    expect(parseTelemetriaIbwc('<html>error</html>').lineasDatos).toBe(0);
  });

  it('la etiqueta CDT del encabezado (horario de verano) usa UTC-5; sin etiqueta asume CST', () => {
    const v = parseTelemetriaIbwc(['08373000 X', '  Date Time Stage Discharge', '         CDT       (meters)   (cms)', '07/15/2026   16:00   1.0   2.0'].join('\n'));
    expect(v.zona).toBe('CDT');
    expect(v.lecturas[0].ts_utc).toBe('2026-07-15T21:00:00.000Z');
    expect(parseTelemetriaIbwc('11/07/2026   16:00   1.0   2.0').lecturas[0].ts_utc).toBe('2026-11-07T22:00:00.000Z');
    expect(r.zona).toBe('CST');
  });

  it('cruce de medianoche: 20:00 CST ya es el día siguiente en UTC', () => {
    expect(cstAUtcIso(11, 30, 2026, 20, 0)).toBe('2026-12-01T02:00:00.000Z');
    expect(cstAUtcIso(2, 31, 2026, 10, 0)).toBeNull();
  });

  it('cadencia de 2 h: conserva solo horas pares (UTC = CST+6) y no altera con ≤15 min', () => {
    const t = parseTelemetriaIbwc(fixture).lecturas;
    const c = filtrarCadencia(t, 120);
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((l) => /T(0[02468]|1[02468]|2[02]):00:00\.000Z$/.test(l.ts_utc))).toBe(true);
    expect(filtrarCadencia(t, 15)).toHaveLength(t.length);
  });
});
