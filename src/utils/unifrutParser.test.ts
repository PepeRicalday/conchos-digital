import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseInfo, parseDiario, parseHorario, numONull, dirAGrados, diasCompletos, hoyChihuahua, tieneDato, radWm2, FormatoUnifrutError,
} from '../../supabase/functions/unifrut-sync/parser';

const fx = (n: string) => readFileSync(`supabase/functions/unifrut-sync/fixtures/${n}`, 'utf8');
const fila = (c: string[]) => `<table id='Datatable'><tbody><tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr></tbody></table>`;

describe('UNIFRUT · getInfo', () => {
  it('Quinta Lupita: tipo, coordenadas y altitud', () => {
    const i = parseInfo('Quinta Lupita|CUAUHTEMOC|CAMB|28.444819|-106.877760|2029|qtl.jpg\n');
    expect(i).toMatchObject({ nombre: 'Quinta Lupita', municipio: 'CUAUHTEMOC', tipo: 'CAMB', altitud_m: 2029 });
    expect(i.latitud).toBeCloseTo(28.4448, 4);
  });
  it('altitud vacía → null, no 0', () => {
    expect(parseInfo('El Ojo|BACHINIVA|ADCON|28.988626|-107.399887||ojo.jpg').altitud_m).toBeNull();
  });
  it('falla si faltan campos o las coordenadas no son válidas', () => {
    expect(() => parseInfo('x|y')).toThrow(FormatoUnifrutError);
    expect(() => parseInfo('x|y|CAMB|abc|-106||f.jpg')).toThrow(FormatoUnifrutError);
  });
});

describe('UNIFRUT · número y rosa de vientos', () => {
  it('S/D = null, nunca 0', () => {
    for (const v of ['', '   ', '---', ':', null, undefined, 'abc']) expect(numONull(v)).toBeNull();
    expect(numONull('0')).toBe(0);
    expect(numONull('.234')).toBeCloseTo(0.234);
  });
  it('rosa de 16 vientos', () => {
    expect(dirAGrados('Norte')).toBe(0);
    expect(dirAGrados('Este-Sureste')).toBe(112.5);
    expect(dirAGrados('Oeste-Noroeste')).toBe(292.5);
    expect(dirAGrados('inventado')).toBeNull();
    expect(dirAGrados(null)).toBeNull();
  });
});

describe('UNIFRUT · reporte diario (fixture real Quinta Lupita, oct-2026)', () => {
  const { puntos, descartes } = parseDiario(fx('reporte_diario_qtl.html'));
  it('lee 1 fila por día y omite las filas Maximo/Minimo/Promedio', () => {
    expect(puntos.length).toBeGreaterThanOrEqual(20);
    expect(puntos.every((p) => /^2026-10-\d{2}$/.test(p.fecha))).toBe(true);
    expect(new Set(puntos.map((p) => p.fecha)).size).toBe(puntos.length);
    expect(descartes).toBe(0);
  });
  it('1-oct: temperaturas, viento, radiación y ETo según el portal', () => {
    const p = puntos.find((x) => x.fecha === '2026-10-01')!;
    expect(p).toMatchObject({ tmax_c: 24.4, tmax_hora: '15:05', tmin_c: 8.34, tmed_c: 16.1, hr_max_pct: 84.9, viento_dir: 'Norte', viento_dir_deg: 0, lluvia_mm: 0, eto_mm: 3.643 });
    expect(p.viento_kmh).toBeCloseTo(4.914);
    expect(p.viento_max_kmh).toBeCloseTo(20.7);
    expect(p.rad_kwm2).toBeCloseTo(0.234);
  });
  it('lluvia 0 real se conserva como 0 (distinto de S/D)', () => {
    expect(puntos.find((x) => x.fecha === '2026-10-01')!.lluvia_mm).toBe(0);
  });
});

describe('UNIFRUT · reporte horario (fixture real, 11-nov-2026)', () => {
  const { puntos } = parseHorario(fx('reporte_horario_qtl.html'));
  it('24 horas del día, sin filas de resumen', () => {
    expect(puntos).toHaveLength(24);
    expect(puntos.every((p) => p.fecha === '2026-11-11')).toBe(true);
  });
  it('primera hora: valores y presión en kPa', () => {
    expect(puntos[0]).toMatchObject({ hora: 1, temp_c: 6.027, hr_pct: 84.4, viento_dir: 'Este-Sureste', lluvia_mm: 0, presion_kpa: 97.5 });
  });
});

describe('UNIFRUT · sin datos y cambio de formato', () => {
  it('estación sin registros (El Ojo en noviembre) → 0 puntos, sin error', () => {
    expect(parseDiario(fx('reporte_vacio.html')).puntos).toHaveLength(0);
  });
  it('tabla distinta o fila corta → FormatoUnifrutError, no se adivina', () => {
    expect(() => parseDiario("<table class='otra'><tr><td>x</td></tr></table>")).toThrow(FormatoUnifrutError);
    expect(() => parseDiario(fila(['E', '2026-10-01', '20', '15:00']))).toThrow(FormatoUnifrutError);
    expect(() => parseHorario(fila(['E', '2026-10-01', 'xx', '1', '1', '1', 'Norte', '1', '1', '0', '0', '0', '97']))).toThrow(FormatoUnifrutError);
  });
  it('celdas vacías o ":" son null; no se convierten en 0', () => {
    const { puntos } = parseDiario(fila(['FACIATEC', '2026-07-12', '21.0', ':', '-2.8', ':', '9.8', '', '', '', '', 'Norte', ':', '', '', '0.0']));
    expect(puntos[0]).toMatchObject({ tmax_c: 21, tmax_hora: null, hr_max_pct: null, viento_kmh: null, rad_kwm2: null, lluvia_mm: null, eto_mm: 0 });
    expect(tieneDato(puntos[0])).toBe(true);
  });
  it('valores imposibles se descartan: Tmin>Tmax y temperatura 182.6 °C', () => {
    const a = parseDiario(fila(['G', '2026-07-12', '28.4', ':', '182.6', ':', '20', '100', '5.4', '23', '9.6', 'Noreste', ':', '236', '0', '4.1']));
    expect(a.puntos[0].tmin_c).toBeNull();
    expect(a.puntos[0].rad_kwm2).toBeNull(); // 236 en una CAMB (kW/m²) es imposible
    expect(a.descartes).toBeGreaterThanOrEqual(2);
  });
  it('ráfaga imposible (298 km/h en Quinta Lupita, mar-2026) y humedad negativa (Bachíniva) → null', () => {
    const a = parseDiario(fila(['Q', '2026-03-19', '20', ':', '5', ':', '12', '-59.04', '-52.1', '9', '298.3', 'Sur', ':', '0.2', '0', '3']));
    expect(a.puntos[0]).toMatchObject({ viento_max_kmh: null, hr_max_pct: null, hr_min_pct: null, tmax_c: 20, viento_kmh: 9 });
    expect(a.descartes).toBe(3);
  });
  it('anemómetro muerto (viento 0 y ráfaga 0, dirección fija) → viento S/D, el resto del día se conserva', () => {
    const a = parseDiario(fila(['Col. Álvaro Obregón', '2026-11-03', '24.85', '14:00', '2.4', '6:00', '11.7', '90', '20', '0', '0', 'Norte', ':', '0.2', '0', '4.0']));
    expect(a.puntos[0]).toMatchObject({ viento_kmh: null, viento_max_kmh: null, viento_dir: null, viento_dir_deg: null, tmax_c: 24.85, eto_mm: 4 });
    // solo el promedio en 0 con ráfaga real sí es calma legítima: se conserva
    const b = parseDiario(fila(['Q', '2026-11-03', '20', ':', '5', ':', '12', '90', '20', '0', '3.2', 'Sur', ':', '0.2', '0', '2']));
    expect(b.puntos[0].viento_kmh).toBe(0);
  });
  it('ADCON: la radiación en W/m² se acepta y no se multiplica', () => {
    const { puntos } = parseDiario(fila(['G', '2026-07-12', '28.4', ':', '10', ':', '20', '100', '5.4', '23', '9.6', 'Noreste', ':', '236.8', '0', '4.1']), 'ADCON');
    expect(puntos[0].rad_kwm2).toBeCloseTo(236.8);
    expect(radWm2(puntos[0].rad_kwm2, 'ADCON')).toBeCloseTo(236.8);
  });
  it('CAMB: 0.234 kW/m² → 234 W/m²; null sigue null', () => {
    expect(radWm2(0.234, 'CAMB')).toBe(234);
    expect(radWm2(null, 'CAMB')).toBeNull();
  });
});

describe('UNIFRUT · día completo y hora local', () => {
  it('hoyChihuahua usa UTC−6 (a las 00:25 locales todavía es "ayer" en UTC)', () => {
    expect(hoyChihuahua(new Date('2026-11-13T06:25:00Z'))).toBe('2026-11-13');
    expect(hoyChihuahua(new Date('2026-11-13T05:59:00Z'))).toBe('2026-11-12');
  });
  it('el día en curso y los futuros nunca entran como día completo', () => {
    const { puntos } = parseDiario(fx('reporte_diario_qtl.html'));
    const ref = new Date('2026-10-05T18:00:00Z'); // 5-oct 12:00 locales
    const ok = diasCompletos(puntos, ref);
    expect(ok.every((p) => p.fecha < '2026-10-05')).toBe(true);
    expect(ok.map((p) => p.fecha)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']); // el portal no publica 4-7 oct (huecos reales)
  });
  it('fila de relleno sin ninguna variable no cuenta como dato', () => {
    const { puntos } = parseDiario(fila(['X', '2026-07-12', '', '', '', '', '', '', '', '', '', '---', '', '', '', '']));
    expect(tieneDato(puntos[0])).toBe(false);
  });
});
