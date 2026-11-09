import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { type DemGrid } from './camposCuenca';
import type { DatosCapas } from './capasCuenca';
import type { ModeloRedJcas, PuntoRedJcas } from './jcasModelo';
import type { PronosticoCuenca } from '../hooks/useCuencaPronostico';
import { avisosConfigClima, configClimaPorDefecto, cuentaPlanos, etiquetaAlcanceClima, validarConfigClima } from './informeClimaCuencaConfig';
import { construirDatosClima } from './informeClimaCuencaDatos';
import { ANCHO_PNG_CLIMA, MAX_PLANOS_LAMINA, MAX_PLANOS_PNG, folioClima, htmlInformeClimaCuenca, huellaClima, type FormatoInformeClima } from './informeClimaCuencaHtml';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const dem = JSON.parse(readFileSync('public/geo/cuenca_dem_grid.json', 'utf8')) as DemGrid;

const G = (f: string) => JSON.parse(readFileSync(`public/geo/${f}`, 'utf8'));
const CAPAS: DatosCapas = { municipios: G('ref_municipios.geojson'), poblaciones: G('ref_poblaciones.geojson'), rios: G('ref_rios.geojson'), rotulosRios: G('ref_rios_rotulos.json').rotulos, carreteras: G('ref_carreteras.geojson'), subcuencas: G('cuenca_conchos_subcuencas.geojson'), vasos: G('ref_presas_vasos.geojson') };
const RED: [string, number, number, number, number][] = [
  ['Chihuahua', 28.64, -106.08, 55, 1415], ['Aldama', 28.84, -105.91, 70, 1274], ['Satevó', 27.96, -106.11, 55, 1387], ['Camargo', 27.7, -105.17, 76, 1226],
  ['Valle de Zaragoza', 27.46, -105.81, 29, 1343], ['Jiménez', 27.12, -104.9, 89, 1380], ['Balleza', 26.95, -106.35, 63, 1570], ['Coronado', 26.74, -105.16, 118, 1522],
  ['San Fco. de Borja', 27.9, -106.68, 34, 1652], ['San Juanito', 27.97, -107.6, 3, 2402], ['Santa Isabel', 28.34, -106.4, 53, 1663], ['Ojinaga', 29.57, -104.4, 54, 801],
];
const punto = (i: number, [nombre, lat, lon, mm, elev]: (typeof RED)[number], o: Partial<PuntoRedJcas> = {}): PuntoRedJcas => ({
  id: i + 1, nombre, lat, lon, altitudM: elev, zona: nombre === 'Ojinaga' ? 'salida' : 'cuenca', grupo: null, sinPluviometro: false, mm7: Math.round(mm / 4), mm30: mm, diasConDato30: 30,
  ultFecha: '2026-11-07', atrasoDias: 0, estado: 'vigente', sospechosa: false, motivo: null, tempUltima: 15, elevM: elev, ayer: { mm: null, temp: null, hum: null, viento: null }, hoy: null, hoyEn: null, 
  medias: { temp7: 30 - 0.0065 * elev, temp30: 30 - 0.0065 * elev, hum7: 55 + (i % 5), hum30: 58, viento7: 5 + (i % 4), viento30: 6 }, ...o,
});
const red = (extra: Partial<PuntoRedJcas> = {}): ModeloRedJcas => {
  const puntos = RED.map((r, i) => punto(i, r, i === 3 ? extra : {}));
  return { puntos, fin: '2026-11-07', areal7: {} as never, areal30: {} as never, areal1: {} as never, arealHoy: {} as never, fechaHoy: null, hoyEn: null, propias: [], vigentes: puntos.length, total: puntos.length, conLluvia: puntos.length };
};
const pron = (): PronosticoCuenca => {
  const puntos = RED.map(([nombre, lat, lon, , elev], i) => ({ id: `jcas:${i + 1}`, nombre, lat, lon, elevM: elev, grupo: null, fuente: 'jcas' as const }));
  const filas = puntos.flatMap((p, k) => ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'].flatMap((modelo, m) =>
    Array.from({ length: 7 }, (_, d) => ({ punto_id: p.id, modelo, fecha: new Date(Date.parse('2026-11-08T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10),
      precip_mm: 2 + ((k + m + d) % 5), temp_media_c: 15 - ((k + d) % 3), hum_media_pct: 60 + m * 5, viento_medio_kmh: 6 + (m % 2) }))));
  return { puntos, filas, verificacion: [], corridaEn: '2026-11-08T18:00:00Z' };
};
const datos = (cfg = configClimaPorDefecto(), r: ModeloRedJcas | null = red(), p: PronosticoCuenca | null = pron()) =>
  construirDatosClima(cfg, { red: r, contorno: c, dem, pron: p, hoy: '2026-11-08', ultSyncJcas: '2026-11-08T17:15:00Z', capasDatos: CAPAS });
const OPC = (formato: FormatoInformeClima) => ({ formato, logoSrl: 'data:image/png;base64,AAAA', logoSica: 'data:image/png;base64,BBBB', emitido: new Date('2026-11-08T20:00:00Z') });

describe('configuración', () => {
  it('por defecto: 4 variables, observado 30 d y pronóstico 7 d, con tabla', () => {
    const c0 = configClimaPorDefecto();
    expect(c0.variables).toHaveLength(4);
    expect(cuentaPlanos(c0)).toBe(8);
    expect(etiquetaAlcanceClima(c0)).toBe('4 variables · obs 30 d + pron 7 d');
  });
  it('bloquea una configuración vacía', () => {
    expect(validarConfigClima({ ...configClimaPorDefecto(), variables: [] })).toHaveLength(1);
    expect(validarConfigClima({ ...configClimaPorDefecto(), observado: false, pronostico: false })).toHaveLength(1);
    expect(validarConfigClima(configClimaPorDefecto())).toEqual([]);
  });
  it('avisa sin pronóstico, sin estaciones o con confiabilidad en construcción', () => {
    const a = avisosConfigClima(configClimaPorDefecto(), { hayPronostico: false, hayObservado: false, confiabilidadEnConstruccion: true });
    expect(a.join(' ')).toMatch(/pronóstico de la cuenca cargado/);
    expect(a.join(' ')).toMatch(/estaciones JCAS/);
    expect(avisosConfigClima(configClimaPorDefecto(), { hayPronostico: true, hayObservado: true, confiabilidadEnConstruccion: true }).join(' ')).toMatch(/en construcción/);
  });
});

describe('datos del informe', () => {
  it('un plano observado y uno pronosticado por variable, mismo modelo que la pantalla', () => {
    const d = datos();
    expect(d.planos).toHaveLength(8);
    expect(d.planos.map((p) => `${p.variable}:${p.tipo}`).slice(0, 4)).toEqual(['lluvia:obs', 'lluvia:pron', 'temperatura:obs', 'temperatura:pron']);
    expect(d.lluviaObs?.media).not.toBeNull();
    expect(d.lluviaPron?.media).not.toBeNull();
    expect(d.estacionesObs).toHaveLength(12);
    expect(d.estacionesPron).toHaveLength(12);
  });
  it('sin pronóstico: los planos pronosticados son S/D con motivo, nunca ceros', () => {
    const d = datos(configClimaPorDefecto(), red(), null);
    const p = d.planos.find((x) => x.variable === 'lluvia' && x.tipo === 'pron')!;
    expect(p.modelo.motivoSD).toMatch(/solo 0/);
    expect(d.lluviaPron?.media).toBeNull();
    expect(d.corridaEn).toBeNull();
  });
  it('pluviómetro sospechoso: excluido y declarado', () => {
    const d = datos(configClimaPorDefecto(), red({ sospechosa: true, motivo: '0 mm en 30 días mientras 3 estaciones vecinas registran 63–118 mm' }));
    expect(d.excluidas).toEqual(['Camargo']);
  });
  it('la huella cambia con la configuración y el folio lleva el prefijo del informe', () => {
    const a = huellaClima(datos()), b = huellaClima(datos({ ...configClimaPorDefecto(), diasObs: 7 }));
    expect(a).not.toBe(b);
    expect(folioClima(datos(), new Date('2026-11-08T20:00:00Z'))).toMatch(/^CLIMA-CUENCA/);
  });
});

describe('HTML del informe', () => {
  for (const f of ['png', 'lamina', 'carta'] as const) {
    it(`${f}: documento autónomo, sin NaN/undefined/null/Aquarius y con las reglas institucionales`, () => {
      const h = htmlInformeClimaCuenca(datos(), OPC(f));
      expect(h.startsWith('<!DOCTYPE html>') || h.startsWith('<!doctype html>')).toBe(true);
      const visible = h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
      expect(visible).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
      expect(h).not.toMatch(/Aquarius/i);
      expect(h).toMatch(/provisional/i);
      expect(h).toMatch(/JCAS/);
      expect(h).toMatch(/n = \d+ estaciones/);
      expect(h).toMatch(/Folio/);
      expect(h).toContain('data:image/png;base64,AAAA');
      expect(h).not.toMatch(/<script/i);
    });
  }
  it('PNG: 1600 px de ancho y como máximo 6 planos, avisando que el PDF trae todos', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('png'));
    expect(h).toContain(`width:${ANCHO_PNG_CLIMA}px`);
    expect((h.match(/<figure class="plano"/g) ?? []).length).toBe(MAX_PLANOS_PNG);
    expect(h).toMatch(/muestra 6 de 8 planos; el PDF carta los incluye todos/);
  });
  it('lámina: 17×11 y solo 3 planos', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('lamina'));
    expect(h).toContain('@page{size:17in 11in;margin:0}');
    expect((h.match(/<figure class="plano"/g) ?? []).length).toBe(MAX_PLANOS_LAMINA);
    expect(h).toContain('muestra 3 de 8 planos (el PDF carta incluye todos)');
  });
  it('carta: todos los planos, dos por hoja, con tablas, trazabilidad y firmas', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('carta'));
    expect((h.match(/<figure class="plano"/g) ?? []).length).toBe(8);
    expect((h.match(/<section class="pagina"/g) ?? []).length).toBe(4 + 1 + 2 + 1); // 4 de planos, distrito, observado, pronóstico y anexo
    expect(h).toMatch(/Estaciones observadas/);
    expect(h).toMatch(/Pronóstico por estación/);
    expect(h).toMatch(/Trazabilidad/);
    expect(h).toMatch(/Firmas|Elaboró/);
  });
  describe('modo «Solo infografía»', () => {
    const cfg = { ...configClimaPorDefecto(), contenido: 'infografia' as const, estaciones: false };
    for (const f of ['png', 'lamina', 'carta'] as const) {
      it(`${f}: sin «Cómo se lee», trazabilidad, firmas ni tablas; con el mínimo institucional`, () => {
        const h = htmlInformeClimaCuenca(datos(cfg), OPC(f));
        const visible = h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
        expect(visible).not.toMatch(/Cómo se lee|Trazabilidad|Firmas|Elaboró|Huella de la configuración/);
        expect(h).not.toMatch(/class="firma|<table class="cifras"><thead><tr><th>Estación<\/th><th class="n">Lluvia 7 d/);
        expect(visible).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
        expect(h).toMatch(/provisional/i);
        expect(h).toMatch(/JCAS/);
        expect(h).toMatch(/Folio/);
        expect(h).toMatch(/n = \d+ estaciones/);
        expect(h).toMatch(/INEGI-CONAGUA/); // atribución del contorno (pasó de las notas al pie)
        expect(h).toMatch(/no sustituye a las estaciones propias ni a los aforos/);
        expect(h).toContain('data:image/png;base64,AAAA');
      });
    }
    it('carta: solo hojas de planos, distrito y barras por estación (sin hoja de anexo)', () => {
      const h = htmlInformeClimaCuenca(datos(cfg), OPC('carta'));
      expect((h.match(/<section class="pagina"/g) ?? []).length).toBe(1 + 4 + 1 + 1); // mapa protagonista, 7 planos de dos en dos, distrito y barras
      expect(h).toMatch(/data-protagonista="1"/);
      expect(h).toMatch(/class="rk"/);
    });
    it('mapa protagonista: PNG (2×2 casillas), lámina (columna izquierda) y carta (hoja 1); el modo completo no lo usa', () => {
      const png = htmlInformeClimaCuenca(datos(cfg), OPC('png'));
      expect(png).toMatch(/class="planos protag"/);
      expect((png.match(/data-protagonista="1"/g) ?? []).length).toBe(1);
      expect((png.match(/<figure class="plano"/g) ?? []).length).toBe(MAX_PLANOS_PNG);
      const lam = htmlInformeClimaCuenca(datos(cfg), OPC('lamina'));
      expect(lam).toMatch(/class="lam-hero"/);
      expect((lam.match(/<figure class="plano"/g) ?? []).length).toBe(MAX_PLANOS_LAMINA);
      expect(lam).toMatch(/class="rk"/); // las barras ocupan el hueco de la derecha
      expect(htmlInformeClimaCuenca(datos(), OPC('png'))).not.toMatch(/data-protagonista="1"|class="planos protag"/);
      expect(htmlInformeClimaCuenca(datos(), OPC('lamina'))).not.toMatch(/lam-hero"/);
    });
    it('las barras de lluvia no dibujan barra para S/D, sin pluviómetro ni excluidas', () => {
      const h = htmlInformeClimaCuenca(datos(cfg, red({ sospechosa: true, motivo: 'sospechosa' })), OPC('png'));
      expect(h).toMatch(/sin barra \(S\/D, sin pluviómetro o excluida\)/);
    });
    it('el modo completo no cambia y el alcance lo distingue', () => {
      expect(etiquetaAlcanceClima(cfg)).toMatch(/infografía$/);
      expect(huellaClima(datos(cfg))).not.toBe(huellaClima(datos()));
      expect(htmlInformeClimaCuenca(datos(), OPC('png'))).toMatch(/Cómo se lee/);
    });
  });
  it('la confiabilidad se declara en construcción y no se afirma acierto', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('carta'));
    expect(h).toMatch(/En construcción/);
    expect(h).not.toMatch(/acierta \d+ %/);
  });
  it('una variable y solo observado: un plano, sin tabla de pronóstico', () => {
    const h = htmlInformeClimaCuenca(datos({ ...configClimaPorDefecto(), variables: ['lluvia'], pronostico: false }), OPC('carta'));
    expect((h.match(/<figure class="plano"/g) ?? []).length).toBe(1);
    expect(h).not.toMatch(/Pronóstico por estación/);
  });
  it('con S/D total (sin red ni pronóstico) sigue generando un documento con S/D explícito', () => {
    const h = htmlInformeClimaCuenca(datos(configClimaPorDefecto(), null, null), OPC('png'));
    expect(h).toMatch(/S\/D/);
    expect(h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
  });
});

describe('capas y distrito', () => {
  it('por defecto: capas de informe (ríos, municipios, presas) y apartado del distrito activos', () => {
    const c0 = configClimaPorDefecto();
    expect(c0.capas).toEqual(['rios', 'municipios', 'presas']);
    expect(c0.distrito).toBe(true);
  });
  it('sin el apartado del distrito la carta vuelve a 7 hojas y no lo menciona', () => {
    const h = htmlInformeClimaCuenca(datos({ ...configClimaPorDefecto(), distrito: false }), OPC('carta'));
    expect((h.match(/<section class="pagina"/g) ?? []).length).toBe(7);
    expect(h).not.toMatch(/Distrito de Riego 005 · SRL Conchos/);
  });
  it('el apartado del distrito trae plano sobre los módulos, tabla de propias y S/D (nunca 0) sin estaciones propias', () => {
    const d = datos();
    expect(d.distrito).not.toBeNull();
    const h = htmlInformeClimaCuenca(d, OPC('carta'));
    expect(h).toMatch(/Distrito de Riego 005 · SRL Conchos/);
    expect(h).toMatch(/Estación propia/);
    expect(h).toMatch(/Esta tabla muestra la lluvia/); // la temperatura, humedad y viento de las propias entran a los planos y a la tabla de estaciones
    expect(h).not.toMatch(/no se mezclan con los de JCAS/);
  });
  it('distrito: columna «Mes actual» en lugar de 30 d; estaciones observadas con columna «Lluvia hoy»', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('carta'));
    expect(h).toMatch(/Mes actual \(1–\d+ [a-z]{3}, mm\)/);
    expect(h).not.toMatch(/<th class="n">30 d \(mm\)<\/th>/);
    expect(h).toMatch(/Lluvia hoy \(parcial, mm\)/);
    expect(h).toMatch(/«Último día» es la fecha de la última lectura/);
  });
  it('con T mínima y horas frío activadas: planos extra (horas frío solo observado), S/D explícito sin serie y sin basura', () => {
    const c = { ...configClimaPorDefecto(), variables: ['lluvia', 'temperatura', 'viento', 'humedad', 'tmin', 'horasFrio'] as ReturnType<typeof configClimaPorDefecto>['variables'] };
    const d = datos(c);
    expect(d.planos.filter((p) => p.variable === 'horasFrio').map((p) => p.tipo)).toEqual(['obs']);
    expect(d.planos.filter((p) => p.variable === 'tmin').map((p) => p.tipo)).toEqual(['obs', 'pron']);
    const h = htmlInformeClimaCuenca(d, OPC('carta'));
    expect(h).toMatch(/Horas frío acumuladas · temporada/);
    expect(h).toMatch(/Temperatura mínima observada/);
    expect(h).toMatch(/Temperatura mínima pronosticada/);
    expect(h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
  });
  it('temperatura: T máx / T mín y horas frío en estaciones observadas; T máx / T mín en el pronóstico; S/D sin serie horaria', () => {
    const h = htmlInformeClimaCuenca(datos(), OPC('carta'));
    expect(h).toMatch(/Horas ≤ 7\.2 °C<\/th>/);
    expect(h).toMatch(/T máx 7 d \(°C\)/);
    expect(h).toMatch(/T mín 7 d \(°C\)/);
    expect(h).toMatch(/≤ 7\.2 °C/);
    expect(h).toMatch(/<th class="n">T máx \(°C\)<\/th><th class="n">T mín \(°C\)<\/th>/);
    expect(h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
  });
  it('con capas el SVG de los planos lleva su leyenda; sin capas (config vacía) no', () => {
    expect(htmlInformeClimaCuenca(datos(), OPC('carta'))).toMatch(/límite municipal/);
    expect(htmlInformeClimaCuenca(datos({ ...configClimaPorDefecto(), capas: [] }), OPC('carta'))).not.toMatch(/límite municipal/);
  });
});
