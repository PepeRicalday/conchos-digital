import { describe, expect, it } from 'vitest';
import { htmlInformeCuenca } from './informeCuencaHtml';
import { construirDatosCuenca } from './informeCuencaDatos';
import { configCuencaPorDefecto } from './informeCuencaConfig';
import { hojaCuerposAgua, hojasCuerposAgua, notasCuerposAgua, planoVasoSvg, tablaCuerposAgua, type DatosCuerposInforme } from './informeCuerposAgua';
import { normalizarCierre, normalizarCuerpo, type Par } from './cuerposAgua';
import { ORDEN_PRESAS_CUENCA, type EstadoUbicacion } from './aqwpCuenca';

const cuadro = (lon: number, lat: number, l = 0.02): Par[] => [[lon, lat], [lon + l, lat], [lon + l, lat + l], [lon, lat + l], [lon, lat]];
const cuerpo = (id: string, etiqueta: string, extra: Record<string, unknown> = {}) =>
  normalizarCuerpo({ id, nombre: etiqueta, etiqueta, cuenca_id: 'RH24-CONCHOS', orden_red: 10, ...extra });
const cierre = (cuerpoId: string, mes: string, extra: Record<string, unknown> = {}) =>
  normalizarCierre({ cuerpo_id: cuerpoId, mes, fecha_cierre: mes, calidad: 'OK', almacenamiento_mm3: 25.4, pct_namo: 52.6, fuente_alm: 'SINA', detalle: {}, ...extra });

const DATOS: DatosCuerposInforme = {
  cuerpos: [
    cuerpo('CA-PAGCH', 'Pico del Águila', { aqwp_ubicacion_id: 540, orden_red: 20 }),
    cuerpo('CA-PAZCH', 'Piedras Azules', { orden_red: 30 }),
    cuerpo('CA-COLINA', 'La Colina', { rol: 'reguladora', orden_red: 50 }),
  ],
  cierres: [
    cierre('CA-PAGCH', '2026-09-01', { almacenamiento_mm3: 24.1, pct_namo: 49.9, fuente_alm: 'AQWP' }),
    cierre('CA-PAGCH', '2026-10-01', { almacenamiento_mm3: 25.2, pct_namo: 52.2, fuente_alm: 'AQWP', calidad: 'REPETIDO' }),
    cierre('CA-PAZCH', '2025-03-01', { almacenamiento_mm3: 6.25, pct_namo: 71.7 }),
    cierre('CA-PAZCH', '2025-04-01', { almacenamiento_mm3: null, pct_namo: null, fuente_alm: null, calidad: 'SD' }),
    cierre('CA-COLINA', '2026-10-01', { almacenamiento_mm3: null, pct_namo: null, fuente_alm: null, calidad: 'SD' }),
  ],
  huellas: new Map([
    ['CA-PAGCH', { anillos: [cuadro(-105.26, 26.52)], areaKm2: 4.96, numIslas: 0 }],
    ['CA-PAZCH', { anillos: [cuadro(-105.22, 27.24, 0.01)], areaKm2: 2.05, numIslas: 0 }],
    ['CA-COLINA', { anillos: [cuadro(-105.4, 27.57, 0.03)], areaKm2: 4.26, numIslas: 0 }],
  ]),
  escenas: new Map([['CA-PAGCH', { fecha: '2026-10-31T17:56:12Z', areaKm2: 2.8, incertidumbreKm2: 0.21, contorno: [cuadro(-105.255, 26.525, 0.012)] }]]),
};

const est = (id: number): EstadoUbicacion => ({
  ubicacionId: id, codigo: 'X', nombre: 'Presa ' + id, tipo: 'presa', presaId: null, fecha: '2026-11-06', almacenamientoMm3: 50, estancado: false, diasIgual: null,
  igualDesde: null, namoMm3: 100, muertoMm3: 5, pctNamo: null, aportacionM3s: 1, extraccionTotalM3s: 1, vertidoM3s: 0, gastoM3s: null,
});
const informe = () => construirDatosCuenca({
  estados: ORDEN_PRESAS_CUENCA.map(est), serie: [], descartes: {}, climatologia: null,
  lluvia: { fechas: [], hasta: '2026-11-07', filas: [], serie30: [] }, lluviaSerie: [], ultSyncEn: null,
}, configCuencaPorDefecto(), '2026-11-07');
const PROHIBIDOS = [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /\[object/];
const sinTexto = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');

describe('informeCuerposAgua', () => {
  it('la tabla dice S/D (nunca 0) donde no hay cierre, marca el último dato y la medición satelital pendiente', () => {
    const h = tablaCuerposAgua(DATOS);
    expect(h).toMatch(/Piedras Azules[\s\S]*mar 25 <small>\(último dato\)<\/small>/);
    expect(h).toMatch(/La Colina <small>reguladora<\/small>/);
    const colina = h.split('<tr>').find((f) => f.includes('La Colina'))!;
    expect(colina).toMatch(/<span class="sd">S\/D<\/span>/);
    expect(colina).toMatch(/sin medir/);
    expect(h).toMatch(/2.8 ± 0.21/);
    for (const p of PROHIBIDOS) expect(sinTexto(h)).not.toMatch(p);
  });

  it('un cuerpo con dato al día no lleva «último dato» y cuenta los meses repetidos', () => {
    const pag = tablaCuerposAgua(DATOS).split('<tr>').find((f) => f.includes('Pico del Águila'))!;
    expect(pag).not.toMatch(/último dato/);
    expect(pag).toMatch(/oct 26/);
    expect(pag).toMatch(/0 \/ 1/);
  });

  it('el plano dibuja huella punteada y espejo, con escala; sin polígono dice S/D', () => {
    const svg = planoVasoSvg(DATOS.huellas.get('CA-PAGCH')!.anillos, DATOS.escenas.get('CA-PAGCH')!.contorno);
    expect(svg).toMatch(/stroke-dasharray/);
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    expect(svg).toMatch(/km|\d+ m</);
    expect(planoVasoSvg(undefined, undefined)).toMatch(/Sin polígono \(S\/D\)/);
  });

  it('las notas declaran el corte de SINA, la huella como nivel de diseño y los cuerpos sin telemetría', () => {
    const t = notasCuerposAgua(DATOS).join(' ');
    expect(t).toMatch(/23-abr-2025/);
    expect(t).toMatch(/nivel de diseño/);
    expect(t).toMatch(/Piedras Azules, La Colina/);
    expect(t).toMatch(/1 de 3 vasos/);
  });

  it('la carta suma DOS hojas con los cuerpos de agua (cierres y vasos) y renumera las páginas; sin ellos queda como antes', () => {
    const d = informe();
    const base = { formato: 'carta' as const, logoSrl: '', logoSica: '', emitido: new Date(2026, 10, 8, 9, 30) };
    const sin = htmlInformeCuenca(d, base);
    const con = htmlInformeCuenca(d, { ...base, cuerpos: DATOS });
    const n = (h: string) => (h.match(/class="pagina"/g) ?? []).length;
    expect(n(con)).toBe(n(sin) + 2);
    expect(con).toMatch(new RegExp(`Pág\\. ${n(con)} de ${n(con)}`));
    expect(con).toMatch(/Cuerpos de agua de la cuenca/);
    expect(sin).not.toMatch(/Cuerpos de agua de la cuenca/);
    for (const p of PROHIBIDOS) expect(sinTexto(con)).not.toMatch(p);
  });

  it('el HTML escapa el nombre del cuerpo de agua', () => {
    const malo: DatosCuerposInforme = { ...DATOS, cuerpos: [cuerpo('CA-X', '<img src=x onerror=alert(1)>', { orden_red: 1 })], cierres: [], huellas: new Map(), escenas: new Map() };
    const h = hojaCuerposAgua(malo);
    expect(h).not.toMatch(/<img src=x/);
    expect(h).toMatch(/&lt;img/);
  });
});

describe('hojasCuerposAgua', () => {
  it('separa en dos hojas: cierres con notas, y planos de los vasos (juntas no caben en una Carta)', () => {
    const [a, b] = hojasCuerposAgua(DATOS);
    expect(a).toContain('Cuerpos de agua de la cuenca');
    expect(a).toContain('Cómo se lee');
    expect(a).not.toContain('class="vasos"');
    expect(b).toContain('Vasos por satélite');
    expect(b).toContain('class="vasos"');
    expect(b).not.toContain('Cómo se lee');
  });
});
