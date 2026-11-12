import { describe, expect, it } from 'vitest';
import { analizarSeguimiento, filaLecturaPresas, filaSeguimiento, buscarPresa, fechaDeEncabezado, MARCA_SEGUIMIENTO } from './seguimientoPresas';

const parr = (nombre: string, pct: string, elev: string, alm: string, dif: string, namoE: string, namoV: string, ing: string, fecha = '11/11/2026') =>
  `-La presa ${nombre} a las 07:00 h del ${fecha} , se encuentra al ${pct}% con una elevación de ${elev} msnm, con un almacenamiento de ${alm} Millones de m³, ${dif} abajo el NAMO (${namoE} msnm, ${namoV} Millones de m³). con una extracción total de 0.00 m³/s, y un ingreso de ${ing} m³/s.`;

const TEXTO = [
  'Seguimiento de presas:', 'Dl Chihuahua 11 de noviembre 2026.', '',
  parr('Boquilla, Chih.', '29.07', '1299.02', '827.53', '2019.252', '1317.00', '2846.782', '22.581'),
  parr('Las Vírgenes', '54.81', '1234.05', '182.67', '150.649', '1239.90', '354.547', '21.806'),
  parr('El Granero', '12.91', '1018.18', '36.71', '247.67', '1034.80', '284.382', '0.903'),
  parr('A. González', '78.96', '2045.06', '62.65', '16.701', '2047.8', '79.354', '0.671'),
  parr('Las Lajas', '49.03', '1551.84', '40.82', '42.449', '1558.70', '83.266', '0.000'),
  parr('El Tintero', '51.87', '1697.20', '64.87', '60.202', '1703.00', '125.075', '0.000'),
  parr('Chihuahua', '38.24', '1534.45', '8.94', '14.443', '1540.82', '23.383', '0.000'),
  parr('El Rejón', '34.81', '1470.22', '2.27', '4.256', '1477.00', '6.528', '0.000'),
  parr('San Gabriel', '43.44', '1769.36', '106.59', '138.837', '1777.90', '245.431', '0.000'),
  parr('Pico de Águila', '52.16', '1611.70', '25.18', '23.098', '1616.90', '48.276', '0.000'),
].join('\n\n');

describe('seguimiento de presas: texto plano', () => {
  const r = analizarSeguimiento(TEXTO, '2026-11-11');
  it('detecta las 10 presas, todas válidas, sin faltantes', () => {
    expect(r.lecturas).toHaveLength(10);
    expect(r.lecturas.every((l) => l.valida)).toBe(true);
    expect(r.faltantes).toHaveLength(0);
    expect(r.fechaEncabezado).toBe('2026-11-11');
  });
  it('extrae todos los campos de Boquilla sin avisos', () => {
    const b = r.lecturas[0];
    expect(b).toMatchObject({ clave: 'boquilla', fecha: '2026-11-11', hora: '07:00', pct: 29.07, elevacionMsnm: 1299.02, almacenamientoMm3: 827.53, difNamoMm3: 2019.252, namoMsnm: 1317, namoMm3: 2846.782, extraccionM3s: 0, ingresoM3s: 22.581 });
    expect(b.avisos).toEqual([]);
  });
  it('«Las Vírgenes» es Madero y avisa que su NAMO del texto no es el de SICA', () => {
    const m = r.lecturas[1];
    expect(m.catalogo?.presaId).toBe('PRE-002');
    expect(m.avisos.some((a) => /NAMO del texto \(354\.547/.test(a.texto))).toBe(true);
    expect(m.avisos.some((a) => /no es almacenamiento ÷ NAMO/.test(a.texto))).toBe(true);
    expect(m.valida).toBe(true);
  });
  it('El Granero = Luis L. León; Pico de Águila resuelve; extracción 0.00 es dato, no S/D', () => {
    expect(r.lecturas[2].catalogo?.cuerpoId).toBe('CA-LLNCH');
    expect(r.lecturas[9].catalogo?.cuerpoId).toBe('CA-PAGCH');
    expect(r.lecturas.every((l) => l.extraccionM3s === 0)).toBe(true);
  });
  it('lecturas_presas: sin marca CILA (campo prevalece) y % sobre el NAMO de SICA', () => {
    const f = filaLecturaPresas(r.lecturas[1], 333.32, 'Gerencia');
    expect(f).toMatchObject({ presa_id: 'PRE-002', escala_msnm: 1234.05, almacenamiento_mm3: 182.67, porcentaje_llenado: 54.81, extraccion_total_m3s: 0 });
    expect(f?.notas).toContain(MARCA_SEGUIMIENTO);
    expect(f?.notas).not.toContain('CILA');
    expect(filaLecturaPresas(r.lecturas[3], 79.354, 'x')).toBeNull(); // A. González no es del distrito
  });
  it('seguimiento_presas guarda las 10', () => {
    expect(r.lecturas.map((l) => filaSeguimiento(l, 'x')).filter(Boolean)).toHaveLength(10);
  });
});

describe('validaciones', () => {
  it('texto vacío o sin presas', () => {
    expect(analizarSeguimiento('').lecturas).toHaveLength(0);
    expect(analizarSeguimiento('hola mundo').avisosGenerales[0].severidad).toBe('error');
  });
  it('presa desconocida y duplicada', () => {
    const r = analizarSeguimiento([parr('Xyz', '34.81', '1470.22', '2.27', '4.256', '1477.00', '6.528', '0'), parr('El Rejón', '34.81', '1470.22', '2.27', '4.256', '1477.00', '6.528', '0'), parr('El Rejón', '34.81', '1470.22', '2.27', '4.256', '1477.00', '6.528', '0')].join('\n'), '2026-11-11');
    expect(r.lecturas[0].valida).toBe(false);
    expect(r.lecturas[1].valida).toBe(true);
    expect(r.lecturas[2].valida).toBe(false);
  });
  it('fecha futura es error; faltantes se listan', () => {
    const r = analizarSeguimiento(parr('El Rejón', '34.81', '1470.22', '2.27', '4.256', '1477.00', '6.528', '0', '20/11/2026'), '2026-11-11');
    expect(r.lecturas[0].valida).toBe(false);
    expect(r.faltantes).toHaveLength(9);
  });
  it('cifras que no cuadran avisan', () => {
    const r = analizarSeguimiento(parr('El Rejón', '34.81', '1470.22', '2.27', '9.999', '1477.00', '6.528', '0'), '2026-11-11');
    expect(r.lecturas[0].avisos.some((a) => /no cuadra/.test(a.texto))).toBe(true);
  });
  it('arriba del NAMO es diferencia negativa', () => {
    const t = parr('El Rejón', '101', '1477.5', '6.6', '0.072', '1477.00', '6.528', '1').replace('abajo el', 'arriba del');
    expect(analizarSeguimiento(t).lecturas[0].difNamoMm3).toBeCloseTo(-0.072);
  });
  it('alias y encabezado', () => {
    expect(buscarPresa('Pico del Águila')?.clave).toBe('pico_aguila');
    expect(buscarPresa('Boquilla, Chih.')?.clave).toBe('boquilla');
    expect(fechaDeEncabezado('Dl Chihuahua 1 de diciembre 2026')).toBe('2026-12-01');
  });
});

import { aplicarSeguimiento } from './seguimientoPresas';
describe('prioridad sobre AQUARIUS', () => {
  const base = { ubicacionId: 540, fecha: '2026-11-10', almacenamientoMm3: 24, pctNamo: 49.7, namoMm3: 48.276, aportacionM3s: 0.1, extraccionTotalM3s: 0, estancado: true, diasIgual: 25, igualDesde: '2026-10-16' };
  it('sustituye si la captura es igual o más reciente y limpia «sin actualizar»', () => {
    const r = aplicarSeguimiento([base], [{ aqwpUbicacionId: 540, fecha: '2026-11-11', almacenamientoMm3: 25.18, ingresoM3s: 0, extraccionM3s: 0 }]);
    expect(r.estados[0]).toMatchObject({ fecha: '2026-11-11', almacenamientoMm3: 25.18, pctNamo: 52.16, aportacionM3s: 0, estancado: false, diasIgual: null });
    expect(r.sustituidas.get(540)).toBe('2026-11-11');
  });
  it('no sustituye si AQUARIUS es más nuevo', () => {
    const r = aplicarSeguimiento([{ ...base, fecha: '2026-11-12' }], [{ aqwpUbicacionId: 540, fecha: '2026-11-11', almacenamientoMm3: 25.18, ingresoM3s: 0, extraccionM3s: 0 }]);
    expect(r.estados[0].almacenamientoMm3).toBe(24);
    expect(r.sustituidas.size).toBe(0);
  });
});
