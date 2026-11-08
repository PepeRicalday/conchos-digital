import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  parseNumero, parseCsvExport, parseMexResScript, fechaMexRes, detectarEstancamiento, urlExport,
} from '../../supabase/functions/aqwp-sync/parser';
import { descomprimirPrimero } from '../../supabase/functions/aqwp-sync/zip';

const f = (fecha: string, valor: number | null) => ({ fecha, valor });
const dias = (v: (number | null)[], desde = 1) => v.map((x, i) => f(`2026-11-${String(desde + i).padStart(2, '0')}`, x));

describe('AQWP · parseNumero', () => {
  it('acepta coma decimal (es) y punto decimal (en)', () => {
    expect(parseNumero('819,803')).toBe(819.803);
    expect(parseNumero('819.803')).toBe(819.803);
    expect(parseNumero('1,234.5')).toBe(1234.5);
    expect(parseNumero('1.234,5')).toBe(1234.5);
  });
  it('S/D nunca es 0', () => {
    for (const v of ['', '  ', 'S/D', 'N/A', 'NaN', null, undefined, 'abc']) expect(parseNumero(v)).toBeNull();
    expect(parseNumero('0')).toBe(0); // un cero real sí es 0
  });
});

describe('AQWP · parseCsvExport', () => {
  const es = '#Conjunto de datos Exportar;\r\nSello de tiempo (UTC-06:00);Valor (Mm³)\r\n2026-11-06 00:00:00;8,924\r\n2026-11-07 00:00:00;\r\nData are being provided with the understanding they are provisional.';
  const en = '#Dataset Export,\r\nTimestamp (UTC-06:00),Value\r\n2026-11-06 00:00:00,8.924\r\n2026-11-07 00:00:00,\r\nData are being provided, provisional.';
  it('formato es (; y coma decimal)', () => {
    expect(parseCsvExport(es)).toEqual([f('2026-11-06', 8.924), f('2026-11-07', null)]);
  });
  it('formato en (, y punto decimal)', () => {
    expect(parseCsvExport(en)).toEqual([f('2026-11-06', 8.924), f('2026-11-07', null)]);
  });
  it('descarta la marca de hueco NaN de 00:00:01 y no duplica la fecha (caso real Boquilla 2015)', () => {
    const t = '2015-05-01 00:00:00,2262.141\r\n2015-05-01 00:00:01,NaN\r\n2015-06-01 00:00:00,2083.085\r\n2015-06-01 00:00:01,NaN';
    expect(parseCsvExport(t)).toEqual([f('2015-05-01', 2262.141), f('2015-06-01', 2083.085)]);
  });
  it('fecha repetida: gana la fila con valor, sin importar el orden', () => {
    expect(parseCsvExport('2020-08-20 00:00:01,6.5\r\n2020-08-20 00:00:00,\r\n')).toEqual([f('2020-08-20', 6.5)]);
  });
  it('un S/D real a medianoche se conserva como null', () => {
    expect(parseCsvExport('2020-08-21 00:00:00,')).toEqual([f('2020-08-21', null)]);
  });
  it('ignora cabecera y aviso legal', () => {
    expect(parseCsvExport('x\r\nSello;Valor\r\nData are...')).toEqual([]);
  });
  it('horario con hora: toma el día del sello sin convertir zona', () => {
    expect(parseCsvExport('2026-11-08 01:40:00,1018.78')).toEqual([f('2026-11-08', 1018.78)]);
  });
});

describe('AQWP · ZIP', () => {
  it('descomprime el primer archivo (deflate)', async () => {
    const txt = 'a;b\r\n2026-11-07 00:00:00;1,5';
    const comp = deflateRawSync(Buffer.from(txt));
    const nombre = Buffer.from('x.csv');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(txt.length, 22); h.writeUInt16LE(nombre.length, 26);
    const zip = new Uint8Array(Buffer.concat([h, nombre, comp, Buffer.alloc(30)]));
    expect(await descomprimirPrimero(zip)).toBe(txt);
  });
  it('ZIP vacío (22 bytes) = sin datos; basura = error', async () => {
    expect(await descomprimirPrimero(new Uint8Array(22))).toBe('');
    await expect(descomprimirPrimero(new Uint8Array(60))).rejects.toThrow(/ZIP/);
  });
});

describe('AQWP · MexResScript', () => {
  const cab = {
    Identifier: 'Identifier', Location: 'Location', Date: 'Date', DeadStorage: 'd', ConservationStorage: 'c',
    VolumeStorage: 'v', DeltaVolume: 'dv', PercentConservation: 'p', DischargeInflow: 'i', DischargeRelease: 'r',
    DischargeSpill: 's', DischargeTotal: 't',
  };
  const fila = { ...cab, Identifier: 'CHUCH', Location: 'Chihuahua', Date: '07-nov.-2026 00:00', VolumeStorage: '8,924',
    PercentConservation: '38,164478', DischargeInflow: '0,136647', DischargeRelease: '0,09', DischargeSpill: '' };
  it('normaliza decimales con coma, fecha en español y S/D', () => {
    const r = parseMexResScript({ Data: [cab, fila] });
    expect(r).toEqual([{ id: 'CHUCH', presa: 'Chihuahua', fecha: '2026-11-07', almacenamiento_mm3: 8.924,
      pct_conservacion: 38.164478, aportacion_m3s: 0.136647, extraccion_m3s: 0.09, vertido_m3s: null }]);
  });
  it('falla (no escribe basura) si cambia el formato', () => {
    const { VolumeStorage: _omit, ...sinCol } = cab;
    expect(() => parseMexResScript({ Data: [sinCol, fila] })).toThrow(/cambió de formato/);
    expect(() => parseMexResScript({ Data: [cab] })).toThrow(/sin filas/);
    expect(() => parseMexResScript({})).toThrow();
  });
  it('fechas es/en', () => {
    expect(fechaMexRes('07-nov.-2026 00:00')).toBe('2026-11-07');
    expect(fechaMexRes('07-Nov-2026 00:00')).toBe('2026-11-07');
    expect(fechaMexRes('1-ene.-2027')).toBe('2027-01-01');
    expect(fechaMexRes('basura')).toBeNull();
  });
});

describe('AQWP · detectarEstancamiento', () => {
  it('caso real Chihuahua: 8.924 × 7 días con aportación 0.137 y extracción 0.09 → estancada', () => {
    const alm = dias([8.924, 8.924, 8.924, 8.924, 8.924, 8.924, 8.924]);
    const ap = dias(Array(7).fill(0.137)), ex = dias(Array(7).fill(0.09));
    expect(detectarEstancamiento(alm, ap, ex).size).toBe(7);
  });
  it('embalse realmente quieto (flujos mínimos, caso El Rejón 0.011 m³/s) NO se marca', () => {
    const alm = dias(Array(7).fill(2.264));
    expect(detectarEstancamiento(alm, dias(Array(7).fill(0.011)), dias(Array(7).fill(0))).size).toBe(0);
  });
  it('menos de 4 días iguales no se marca', () => {
    const alm = dias([8.9, 8.9, 8.9, 9.0, 9.1]);
    expect(detectarEstancamiento(alm, dias(Array(5).fill(0.5)), dias(Array(5).fill(0))).size).toBe(0);
  });
  it('serie que sí varía no se marca', () => {
    const alm = dias([819.1, 819.3, 819.5, 819.8, 820.1]);
    expect(detectarEstancamiento(alm, dias(Array(5).fill(1.8)), dias(Array(5).fill(0))).size).toBe(0);
  });
  it('sin datos de flujo no se afirma estancamiento', () => {
    expect(detectarEstancamiento(dias(Array(6).fill(5.5)), [], []).size).toBe(0);
  });
  it('S/D repetido (null) no cuenta como valor estancado', () => {
    expect(detectarEstancamiento(dias(Array(6).fill(null)), dias(Array(6).fill(1)), dias(Array(6).fill(1))).size).toBe(0);
  });
  it('marca solo el tramo repetido, no el resto', () => {
    const alm = dias([10, 11, 12, 12, 12, 12, 13]);
    const ap = dias(Array(7).fill(0.5)), ex = dias(Array(7).fill(0));
    expect([...detectarEstancamiento(alm, ap, ex)].sort()).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  });
});

describe('AQWP · urlExport', () => {
  it('usa el Title exacto y DateRange=Custom con fechas', () => {
    const u = new URL(urlExport('Total Storage.CONAGUA-Daily-Storage@08-CHUCH-CONAGUA', '2026-10-01', '2026-11-09'));
    expect(u.searchParams.get('DataSet')).toBe('Total Storage.CONAGUA-Daily-Storage@08-CHUCH-CONAGUA');
    expect(u.searchParams.get('DateRange')).toBe('Custom');
    expect(u.searchParams.get('StartTime')).toBe('2026-10-01T00:00:00.000-06:00');
    expect(u.searchParams.get('Timezone')).toBe('-6');
  });
  it('sin fechas pide el histórico completo', () => {
    expect(new URL(urlExport('x@y')).searchParams.get('DateRange')).toBe('EntirePeriodOfRecord');
  });
});

import { parseCsvRaw, precipitacionDiaria } from '../../supabase/functions/aqwp-sync/parser';

/** Muestras cada 10 min de un día con el acumulado dado por función de la hora decimal. */
const dia10min = (fecha: string, f: (h: number) => number) =>
  Array.from({ length: 144 }, (_, i) => {
    const h = Math.floor(i / 6), m = (i % 6) * 10;
    return { ts: `${fecha} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`, valor: f(i / 6) };
  });

describe('AQWP · parseCsvRaw', () => {
  it('conserva el sello completo y descarta NaN y vacíos', () => {
    const t = 'x\r\n2026-11-07 10:00:00,110.6\r\n2026-11-07 10:00:01,NaN\r\n2026-11-07 10:10:00,\r\n2026-11-07 10:20:00,110.8';
    expect(parseCsvRaw(t)).toEqual([{ ts: '2026-11-07 10:00:00', valor: 110.6 }, { ts: '2026-11-07 10:20:00', valor: 110.8 }]);
  });
  it('acepta formato es (; y coma decimal)', () => {
    expect(parseCsvRaw('2026-11-07 10:00:00;110,6')).toEqual([{ ts: '2026-11-07 10:00:00', valor: 110.6 }]);
  });
});

describe('AQWP · precipitacionDiaria (acumulado de pluviómetro)', () => {
  const HOY = '2026-11-10';
  it('día seco con ruido plano = 0 mm (no S/D)', () => {
    expect(precipitacionDiaria(dia10min('2026-11-05', () => 110.6), HOY)).toEqual([{ fecha: '2026-11-05', valor: 0 }]);
  });
  it('lluvia = suma de incrementos positivos', () => {
    const r = precipitacionDiaria(dia10min('2026-11-07', (h) => 100 + (h >= 12 ? 13.5 : 0)), HOY);
    expect(r).toEqual([{ fecha: '2026-11-07', valor: 13.5 }]);
  });
  it('ignora bajadas (deriva) y reinicio a 0', () => {
    const r = precipitacionDiaria(dia10min('2026-11-07', (h) => (h < 8 ? 100 + h : h < 12 ? 95 : h < 14 ? 0 : 2)), HOY);
    expect(r[0].valor).toBeLessThan(15); // solo cuentan las subidas reales, nunca negativo
    expect(r[0].valor!).toBeGreaterThanOrEqual(0);
  });
  it('pico absurdo (1481 mm) se ignora: salto mayor a maxIncMm', () => {
    const m = dia10min('2026-11-07', () => 110);
    m[50].valor = 1481;
    expect(precipitacionDiaria(m, HOY)).toEqual([{ fecha: '2026-11-07', valor: 0 }]);
  });
  it('día con menos de 18 horas con muestra = S/D (no afirma 0 mm)', () => {
    const m = dia10min('2026-11-06', () => 110).filter((x) => Number(x.ts.slice(11, 13)) < 10);
    expect(precipitacionDiaria(m, HOY)).toEqual([{ fecha: '2026-11-06', valor: null }]);
  });
  it('omite el día en curso (incompleto)', () => {
    expect(precipitacionDiaria(dia10min(HOY, () => 110), HOY)).toEqual([]);
  });
  it('el incremento entre dos días cuenta en el día de la muestra nueva', () => {
    const a = dia10min('2026-11-05', () => 100), b = dia10min('2026-11-06', () => 104);
    expect(precipitacionDiaria([...b, ...a], HOY)).toEqual([{ fecha: '2026-11-05', valor: 0 }, { fecha: '2026-11-06', valor: 4 }]);
  });
  it('varios días ordenados aunque lleguen desordenados', () => {
    const r = precipitacionDiaria([...dia10min('2026-11-07', () => 1), ...dia10min('2026-11-05', () => 1)], HOY);
    expect(r.map((x) => x.fecha)).toEqual(['2026-11-05', '2026-11-07']);
  });
});
