import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseReporte, parseShef, parseTimestamp, num } from '../../supabase/functions/presas-cila-sync/parser';

const dir = 'supabase/functions/presas-cila-sync/';
const txt = readFileSync(dir + 'res_report.fixture.txt', 'utf8');
const shef = readFileSync(dir + 'res_report_shef.fixture.txt', 'utf8');

describe('parser reporte CILA', () => {
  it('extrae La Boquilla y Madero del reporte real', () => {
    const { lecturas, errores } = parseReporte(txt);
    expect(errores).toEqual([]);
    const b = lecturas.find((l) => l.presa_id === 'PRE-001')!;
    const m = lecturas.find((l) => l.presa_id === 'PRE-002')!;
    expect(b.almacenamiento_mm3).toBe(702.466);
    expect(b.extraccion_m3s).toBe(0);
    expect(b.pct_conservacion).toBeCloseTo(24.676, 2);
    expect(b.cap_conservacion_mm3).toBe(2846.78);
    expect(b.elev_conservacion_msnm).toBe(1317);
    expect(b.fecha).toBe('2026-10-05');
    expect(b.ts_reporte).toBe('2026-10-05T00:00:00-06:00');
    expect(m.almacenamiento_mm3).toBe(164.302);
    expect(m.pct_conservacion).toBeCloseTo(49.293, 2);
  });

  it('elevación N/A → null (nunca 0)', () => {
    const { lecturas } = parseReporte(txt);
    expect(lecturas.every((l) => l.elevacion_msnm === null)).toBe(true);
  });

  it('falla sin escribir si falta una presa', () => {
    const sin = txt.split('\n').filter((l) => !l.startsWith('Fco. I . Madero')).join('\n');
    const { lecturas, errores } = parseReporte(sin);
    expect(lecturas.map((l) => l.presa_id)).toEqual(['PRE-001']);
    expect(errores.join()).toContain('PRE-002');
  });

  it('rechaza almacenamiento mayor a la capacidad de inundación', () => {
    const malo = txt.replace('|702.466|', '|9999|');
    const { lecturas, errores } = parseReporte(malo);
    expect(lecturas.find((l) => l.presa_id === 'PRE-001')).toBeUndefined();
    expect(errores.join()).toContain('fuera de rango');
  });

  it('sin sección México devuelve error', () => {
    expect(parseReporte('basura').errores.length).toBe(1);
  });

  it('SHEF concuerda con el .txt', () => {
    const s = parseShef(shef);
    expect(s.LBQCH).toEqual({ storage: 702.466, release: 0 });
    expect(s.FIMCH).toEqual({ storage: 164.302, release: 0 });
  });

  it('helpers', () => {
    expect(parseTimestamp('05-Oct-2026 00:00')?.fecha).toBe('2026-10-05');
    expect(parseTimestamp('mal')).toBeNull();
    expect(num('N/A')).toBeNull();
    expect(num('')).toBeNull();
    expect(num('0')).toBe(0);
  });
});
