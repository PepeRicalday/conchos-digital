import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseListado, parseMensaje, tsLectura } from '../../supabase/functions/goes-dcp-sync/parser';

const dir = 'supabase/functions/goes-dcp-sync/';
const leer = (f: string) => readFileSync(dir + f, 'latin1');

describe('listado DCP (dcpout.jsp)', () => {
  const t = parseListado(leer('dcpout.fixture.html'));
  it('una fila por transmisión horaria, con hora UTC desde el nombre del archivo', () => {
    expect(t.length).toBe(45);
    expect(t[0].ts_msg).toBe('2026-10-26T20:28:13.000Z');
    expect(t[0].codigo_falla).toBe('G');
    expect(t[0].senal_dbm).toBe(38);
  });
  it('marca el error de paridad', () => {
    const malo = t.find((x) => x.ts_msg === '2026-10-26T19:28:12.000Z')!;
    expect(malo.codigo_falla).toBe('?');
  });
});

describe('mensaje DCP (msg-html.jsp)', () => {
  it('Babisas: nivel y gasto con 3 lecturas, más antigua primero', () => {
    const { lecturas } = parseMensaje(leer('msg_babisas.fixture.html'));
    const gr = lecturas.filter((l) => l.codigo === 'GR');
    expect(gr.map((l) => l.valor)).toEqual([40.96, 31.65, 34.14]);
    expect(gr.every((l) => l.variable === 'gasto_m3s' && l.n === 3)).toBe(true);
    expect(lecturas.filter((l) => l.codigo === 'NI').map((l) => l.valor)).toEqual([6.251, 6.272, 6.274]);
    expect(lecturas.find((l) => l.codigo === 'PB')!.valor).toBe(896);
  });
  it('Ojinaga: formato propio N1/GR/VL con 4 lecturas', () => {
    const { lecturas } = parseMensaje(leer('msg_ojinaga.fixture.html'));
    expect(lecturas.filter((l) => l.codigo === 'N1').map((l) => l.valor)).toEqual([4.547, 4.562, 4.566, 4.587]);
    expect(lecturas.filter((l) => l.codigo === 'GR').length).toBe(4);
    expect(lecturas.some((l) => l.codigo === 'TA')).toBe(false);
  });
  it('mensaje corrupto: descarta la línea dañada, nunca la rellena con 0', () => {
    const { lecturas, descartadas } = parseMensaje(leer('msg_corrupto.fixture.html'));
    expect(descartadas).toContain('GR');
    expect(lecturas.some((l) => l.codigo === 'GR')).toBe(false);
    expect(lecturas.filter((l) => l.codigo === 'NI').map((l) => l.valor)).toEqual([6.257, 6.252, 6.273]);
  });
});

describe('hora de cada lectura', () => {
  it('Ojinaga 4 lecturas a 15 min terminando en el cuarto de hora previo a la transmisión', () => {
    const ts = [0, 1, 2, 3].map((i) => tsLectura('2026-10-26T20:28:00.000Z', i, 4, 15));
    expect(ts).toEqual([
      '2026-10-26T19:30:00.000Z', '2026-10-26T19:45:00.000Z',
      '2026-10-26T20:00:00.000Z', '2026-10-26T20:15:00.000Z',
    ]);
  });
});
