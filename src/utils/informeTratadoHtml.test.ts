import { describe, it, expect } from 'vitest';
import { construirDatosTratado, configTratadoPorDefecto, htmlInformeTratado, type FormatoInformeTratado } from './informeTratadoHtml';
import { marcasEscala, svgAvance, svgMensual, svgBarraAvance, PALETA_PAPEL } from './tratadoGraficas';
import { CICLO_POR_DEFECTO, volumenMensual, type Afluente, type EntregaDiaria } from './tratadoCiclo';
import type { DatosTratado } from '../hooks/useTratadoCiclo';

const AFL: Afluente[] = [
  { clave: 'conchos', nombre: 'Río Conchos', estacion: '08373000', orden: 1 },
  { clave: 'salado', nombre: 'Río Salado', estacion: '08-RSPC', orden: 2 },
];
function datos(conCorte = true): DatosTratado {
  const entregas: EntregaDiaria[] = [];
  for (let d = 0; d < 40; d++) {
    const f = new Date(Date.UTC(2025, 9, 25 + d)).toISOString().slice(0, 10);
    entregas.push({ afluente: 'conchos', fecha: f, tcm: d % 7 === 3 ? null : 120 + d });
    entregas.push({ afluente: 'salado', fecha: f, tcm: 30 });
  }
  return {
    ciclo: CICLO_POR_DEFECTO, afluentes: AFL, entregas, sutron: [{ fecha: '2025-10-30', gastoMedio: 40, lecturas: 96 }], capturas: [],
    cortes: conCorte ? [{ fecha: '2025-11-30', acumuladoAf: 21000, acumuladoMcm: 26, deudaRemanenteAf: 861980 }] : [],
    ultimaSync: { en: '2025-12-01T10:00:00Z', ok: true, error: null }, fallos: [],
  };
}
const MALO = /NaN|undefined|Infinity|\bnull\b/;

describe('gráficas del Tratado', () => {
  it('escala bonita', () => {
    expect(marcasEscala(2158)).toEqual({ max: 2500, paso: 500 });
    expect(marcasEscala(0).max).toBeGreaterThan(0);
  });
  it('SVG sin NaN ni undefined, con o sin datos', () => {
    const d = datos();
    const pub = [{ fecha: '2025-11-01', af: 1000 }, { fecha: '2025-11-30', af: 9000 }];
    const a = svgAvance({ ciclo: d.ciclo, dominioDesde: d.ciclo.inicio, dominioHasta: d.ciclo.fin, publicada: pub, cortes: d.cortes, paleta: PALETA_PAPEL, mostrarDeuda: true, hoy: '2025-12-01' });
    expect(a).toContain('<svg'); expect(a).not.toMatch(MALO);
    const vacio = svgAvance({ ciclo: d.ciclo, dominioDesde: d.ciclo.inicio, dominioHasta: d.ciclo.fin, publicada: [], cortes: [], paleta: PALETA_PAPEL, hoy: '2025-12-01' });
    expect(vacio).not.toMatch(MALO);
    expect(svgMensual({ filas: [], afluentes: AFL, paleta: PALETA_PAPEL })).toContain('S/D');
    expect(svgMensual({ filas: volumenMensual(d.entregas, '2025-10-25', '2025-12-31'), afluentes: AFL, paleta: PALETA_PAPEL })).not.toMatch(MALO);
    expect(svgBarraAvance(null, null, PALETA_PAPEL)).toContain('S/D');
    expect(svgBarraAvance(20.8, 20.75, PALETA_PAPEL)).not.toMatch(MALO);
  });
});

describe('informe del Tratado (HTML)', () => {
  const emitido = new Date('2025-12-01T16:00:00Z');
  const base = { logoSrl: '', logoSica: '', emitido };
  for (const formato of ['carta', 'png', 'lamina'] as FormatoInformeTratado[]) {
    it(`formato ${formato}: sin basura y con folio y cifra oficial`, () => {
      const d = construirDatosTratado(configTratadoPorDefecto(), datos(), '2025-12-01', emitido);
      const html = htmlInformeTratado(d, { ...base, formato });
      expect(html).not.toMatch(MALO);
      expect(html).toContain('TRATADO-1944');
      expect(html).toContain('21,000');
      expect(html).toContain('Tratado de Aguas de 1944');
    });
  }
  it('carta completa lleva firmas y trazabilidad; «solo infografía» no', () => {
    const d = construirDatosTratado(configTratadoPorDefecto(), datos(), '2025-12-01', emitido);
    const completo = htmlInformeTratado(d, { ...base, formato: 'carta' });
    expect(completo).toContain('Trazabilidad'); expect(completo).toContain('class="firmas"');
    const info = htmlInformeTratado(construirDatosTratado({ ...configTratadoPorDefecto(), contenido: 'infografia' }, datos(), '2025-12-01', emitido), { ...base, formato: 'carta' });
    expect(info).not.toContain('Trazabilidad'); expect(info).not.toContain('class="firmas"');
  });
  it('sin corte oficial: S/D, nunca 0', () => {
    const d = construirDatosTratado(configTratadoPorDefecto(), datos(false), '2025-12-01', emitido);
    const html = htmlInformeTratado(d, { ...base, formato: 'carta' });
    expect(html).toContain('S/D'); expect(html).not.toMatch(MALO);
  });
  it('periodo mensual y año', () => {
    for (const periodo of [{ tipo: 'mes', mes: '2025-11' }, { tipo: 'anio', anio: 1 }, { tipo: 'rango', desde: '2025-11-05', hasta: '2025-11-20' }] as const) {
      const d = construirDatosTratado({ ...configTratadoPorDefecto(), periodo }, datos(), '2025-12-01', emitido);
      expect(htmlInformeTratado(d, { ...base, formato: 'carta' })).not.toMatch(MALO);
    }
  });
});
