import { describe, it, expect } from 'vitest';
import { construirDatosCuenca, recortarPeriodo, type EntradaInformeCuenca } from './informeCuencaDatos';
import { htmlInformeCuenca, notasInforme, folioCuenca, type FormatoInformeCuenca } from './informeCuencaHtml';
import { configCuencaPorDefecto, type ConfigInformeCuenca } from './informeCuencaConfig';
import { tanqueSvg, miniSerieSvg, tiraLluviaSvg, colorLluvia } from './informeCuencaSvg';
import { ORDEN_PRESAS_CUENCA, type EstadoUbicacion, type FilaGrafica, type ResumenLluvia } from './aqwpCuenca';
import type { Climatologia } from '../hooks/useAqwpCuenca';

const HOY = '2026-11-07';
const EMITIDO = new Date(2026, 10, 8, 9, 30);

const est = (o: Partial<EstadoUbicacion> & { ubicacionId: number }): EstadoUbicacion => ({
  codigo: 'X', nombre: 'X', tipo: 'presa', presaId: null, fecha: '2026-11-06', almacenamientoMm3: null, estancado: false,
  diasIgual: null, igualDesde: null, namoMm3: null, muertoMm3: null, pctNamo: null, aportacionM3s: null,
  extraccionTotalM3s: null, vertidoM3s: null, gastoM3s: null, ...o,
});

const DATOS_PRESAS: Record<number, Partial<EstadoUbicacion>> = {
  536: { nombre: 'La Boquilla', almacenamientoMm3: 830, namoMm3: 2846.78, muertoMm3: 100, presaId: 'PRE-001', aportacionM3s: 3.2, extraccionTotalM3s: 25 },
  537: { nombre: 'Francisco I. Madero', almacenamientoMm3: 180, namoMm3: 333.318, muertoMm3: 15, presaId: 'PRE-002', aportacionM3s: 1.1, extraccionTotalM3s: 3 },
  541: { nombre: 'San Gabriel', almacenamientoMm3: 60, namoMm3: 245.431, muertoMm3: 9.44, aportacionM3s: 0.8, extraccionTotalM3s: 0.2 },
  540: { nombre: 'Pico del Águila', almacenamientoMm3: 20, namoMm3: 48.276, muertoMm3: 2, extraccionTotalM3s: 0.1 },
  526: { nombre: 'Luis L. León', almacenamientoMm3: 36.634, namoMm3: 284.382, muertoMm3: 23.634, extraccionTotalM3s: 0 },
  538: { nombre: 'Chihuahua', almacenamientoMm3: 8.924, namoMm3: 23.383, muertoMm3: 0.739, estancado: true, diasIgual: 47, igualDesde: '2026-09-22', aportacionM3s: 0.3, extraccionTotalM3s: 0.09 },
  539: { nombre: 'El Rejón', almacenamientoMm3: null, namoMm3: 6.528, muertoMm3: null, fecha: null }, // S/D: nunca trajo dato
};

const dia = (i: number) => new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
const serie = (): FilaGrafica[] => Array.from({ length: 310 }, (_, i) => {
  const fila: FilaGrafica = { fecha: dia(i) };
  for (const id of ORDEN_PRESAS_CUENCA) if (id !== 539) fila[String(id)] = 20 + (i % 40) * 0.5;
  return fila;
});

const lluvia = (): ResumenLluvia => {
  const fechas = Array.from({ length: 30 }, (_, i) => new Date(Date.parse('2026-10-09T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10));
  const filas = [551, 526].map((id) => ({
    ubicacionId: id, nombre: id === 551 ? 'Villalba' : 'Luis L. León', dias: fechas.slice(-7).map((_, i) => (i === 3 ? null : i)),
    total7: { mm: 15, conDato: 6, ventana: 7 }, total30: { mm: 40.5, conDato: 28, ventana: 30 },
  }));
  return { fechas: fechas.slice(-7), hasta: '2026-11-07', filas, serie30: fechas.map((fecha, i) => ({ fecha, '551': i % 5 === 0 ? 12 : null, '526': 0 } as FilaGrafica)) };
};

const clim = (): Climatologia => ({
  diaHoy: 311,
  banda: ORDEN_PRESAS_CUENCA.filter((id) => id !== 539).map((id) => ({
    ubicacionId: id, diaAnio: 311, nAnios: 9, minimo: 5, p10: 10, p25: null, mediana: 30, p75: null, p90: 60, maximo: 80,
  })),
  hoy: ORDEN_PRESAS_CUENCA.filter((id) => id !== 539).map((id) => ({ ubicacionId: id, diaAnio: 311, nAnios: 9, valores: [5, 10, 20, 30, 40, 50, 60, 70, 80] })),
});

const entrada = (over: Partial<EntradaInformeCuenca> = {}): EntradaInformeCuenca => ({
  estados: ORDEN_PRESAS_CUENCA.map((id) => est({ ubicacionId: id, ...DATOS_PRESAS[id] })),
  serie: serie(), descartes: { 537: [{ fecha: '2026-04-06', valor: 319.5, motivo: 'pico_aislado', previo: 190, siguiente: 191 }] },
  climatologia: clim(), lluvia: lluvia(),
  lluviaSerie: [
    { ubicacionId: 551, fecha: '2026-10-05', valor: 10 }, { ubicacionId: 551, fecha: '2025-10-05', valor: 20 },
  ],
  ultSyncEn: '2026-11-07T18:30:00Z', ...over,
});

const cfg = (over: Partial<ConfigInformeCuenca> = {}): ConfigInformeCuenca => ({ ...configCuencaPorDefecto(), ...over });
const datos = (c: ConfigInformeCuenca = cfg(), e = entrada()) => construirDatosCuenca(e, c, HOY);
const html = (d = datos(), formato: FormatoInformeCuenca = 'carta') =>
  htmlInformeCuenca(d, { formato, logoSrl: '', logoSica: '', emitido: EMITIDO });

const PROHIBIDOS = [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /aquarius/i, /\[object/];
const sinTexto = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');

describe('construirDatosCuenca', () => {
  it('7 presas: orden de la cuenca, agregado sobre las 6 con dato y S/D de El Rejón sin entrar como 0', () => {
    const d = datos();
    expect(d.presas.map((p) => p.fila.ubicacionId)).toEqual([...ORDEN_PRESAS_CUENCA]);
    expect(d.filtrado).toBe(false);
    expect(d.alcance).toBe('7 de 7 presas');
    expect(d.agregado.n).toBe(7);
    expect(d.agregado.conDato).toBe(6);
    expect(d.agregado.almacenadoMm3).toBeCloseTo(830 + 180 + 60 + 20 + 36.634 + 8.924, 1);
    // El NAMO del agregado excluye a El Rejón (sin dato): el porcentaje no se diluye con una presa sin lectura.
    expect(d.agregado.namoMm3).toBeCloseTo(2846.78 + 333.318 + 245.431 + 48.276 + 284.382 + 23.383, 1);
  });

  it('filtra por selección y tamaño y agrega SOLO lo seleccionado', () => {
    const d = datos(cfg({ presas: [536, 537, 538, 539], tamano: 'pequenas' }));
    expect(d.presas.map((p) => p.fila.ubicacionId)).toEqual([538, 539]);
    expect(d.filtrado).toBe(true);
    expect(d.alcance).toBe('2 de 7 presas · pequenas');
    expect(d.agregado.almacenadoMm3).toBeCloseTo(8.924, 1);
  });

  it('1 presa: el agregado es el de esa presa', () => {
    const d = datos(cfg({ presas: [526] }));
    expect(d.presas).toHaveLength(1);
    expect(d.agregado.pctUtil).toBeCloseTo(5, 0);
  });

  it('ordena por llenado: la menos llena primero y El Rejón (S/D) al final', () => {
    const d = datos(cfg({ orden: 'llenado' }));
    expect(d.presas[d.presas.length - 1].fila.ubicacionId).toBe(539);
    const pcts = d.presas.slice(0, -1).map((p) => p.fila.pct as number);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
  });

  it('3 meses recorta las series a ~91 días; 12 meses las deja completas', () => {
    const largo = datos(cfg({ meses: 12 })).presas[0].serie.length;
    const corto = datos(cfg({ meses: 3 })).presas[0].serie.length;
    expect(corto).toBeLessThan(largo);
    expect(corto).toBeGreaterThan(5);
    const s = [{ fecha: '2026-01-01' }, { fecha: '2026-10-20' }, { fecha: '2026-11-06' }];
    expect(recortarPeriodo(s, '2026-11-07', 3).map((x) => x.fecha)).toEqual(['2026-10-20', '2026-11-06']);
  });

  it('descartes: solo los de las presas incluidas, con su fecha', () => {
    expect(datos().descartes.map((x) => x.descarte.fecha)).toEqual(['2026-04-06']);
    expect(datos(cfg({ presas: [536] })).descartes).toEqual([]);
  });

  it('lluvia: solo si el bloque está incluido; compara con el ciclo anterior', () => {
    expect(datos(cfg({ datos: ['tabla'] })).lluvia).toBeNull();
    const l = datos().lluvia!;
    expect(l.filas.map((f) => f.ubicacionId)).toEqual([551, 526]);
    expect(l.filas[0].dias30).toHaveLength(30);
    expect(l.filas[1].dias30.every((v) => v === 0)).toBe(true);
  });
});

describe('htmlInformeCuenca — reglas institucionales', () => {
  const casos: { nombre: string; c: ConfigInformeCuenca }[] = [
    { nombre: '7 presas', c: cfg() },
    { nombre: '3 presas', c: cfg({ presas: [536, 541, 538] }) },
    { nombre: '1 presa', c: cfg({ presas: [539] }) },
    { nombre: 'solo tanques y tabla', c: cfg({ datos: ['tabla'] }) },
  ];
  for (const formato of ['png', 'lamina', 'carta'] as FormatoInformeCuenca[]) {
    for (const caso of casos) {
      it(`${formato} · ${caso.nombre}: sin NaN/undefined/null/Aquarius y con S/D, corte y fuente`, () => {
        const h = html(datos(caso.c), formato);
        const t = sinTexto(h);
        for (const re of PROHIBIDOS) expect(t, String(re)).not.toMatch(re);
        expect(t).toMatch(/dato provisional/i);
        expect(t).toMatch(/CONAGUA/);
        expect(t).toMatch(/USIBWC/);
        expect(t).toMatch(/Fecha de corte|Corte/);
      });
    }
  }

  it('también el atributo/alt y los SVG están limpios de NaN', () => {
    expect(html(datos(), 'png')).not.toMatch(/NaN/);
  });

  it('San Gabriel se rotula con su estado y nunca se pierde', () => {
    const t = sinTexto(html());
    expect(t).toMatch(/San Gabriel, Dgo\./);
  });

  it('Chihuahua: "sin actualizar desde" con la fecha, y su último dato visible (no S/D)', () => {
    const t = sinTexto(html(datos(cfg({ presas: [538] })), 'png'));
    expect(t).toMatch(/sin actualizar desde 22\/09\/26/);
    expect(t).toMatch(/8.9 Mm³/);
  });

  it('El Rejón (sin dato) sale S/D, jamás 0 %', () => {
    const t = sinTexto(html(datos(cfg({ presas: [539] })), 'png'));
    expect(t).toMatch(/S\/D/);
    expect(t).not.toMatch(/\b0,0 %/);
  });

  it('con filtro: "N de M presas" y totales rotulados "de las N presas seleccionadas"', () => {
    const d = datos(cfg({ presas: [536, 537, 541] }));
    const t = sinTexto(html(d, 'png'));
    expect(t).toMatch(/3 de 7 presas/);
    expect(t).toMatch(/de las 3 presas seleccionadas/);
    expect(t).toMatch(/no a toda la cuenca/);
    const completo = sinTexto(html(datos(), 'png'));
    expect(completo).not.toMatch(/no a toda la cuenca/);
    expect(completo).toMatch(/de la cuenca \(7 presas\)/);
  });

  it('toda cifra histórica lleva "n = N años" y se avisa el descarte atípico con su fecha', () => {
    const t = sinTexto(html());
    expect(t).toMatch(/n = 9 años/);
    expect(t).toMatch(/Madero 06\/04\/26|F\. I\. Madero 06\/04\/26/);
  });

  it('sin climatología: la posición histórica queda S/D y se dice', () => {
    const d = datos(cfg(), entrada({ climatologia: null }));
    const notas = notasInforme(d).join(' ');
    expect(notas).toMatch(/no hay climatología/);
    expect(sinTexto(html(d, 'png'))).not.toMatch(/n = 9 años/);
  });

  it('carta: una hoja por presa con ficha, anexo con trazabilidad, firmas y numeración "de N"', () => {
    const h = html(datos(), 'carta');
    expect((h.match(/class="pagina"/g) ?? []).length).toBe(1 + 1 + 7 + 1);
    expect(h).toMatch(/Pág\. 10 de 10/);
    expect(h).toMatch(/Trazabilidad/);
    expect(h).toMatch(/class="firmas"/);
    expect(h).toMatch(/Huella de la configuración/);
  });

  it('carta sin el bloque "ficha": solo resumen y anexo', () => {
    const h = html(datos(cfg({ datos: ['tabla', 'serie'] })), 'carta');
    expect((h.match(/class="pagina"/g) ?? []).length).toBe(3);
  });

  it('png y lámina no llevan el botón de imprimir; la lámina fija @page 17×11 in', () => {
    expect(html(datos(), 'png')).not.toMatch(/btn-imprimir"/);
    expect(html(datos(), 'lamina')).toMatch(/@page\{size:17in 11in/);
    expect(html(datos(), 'lamina')).toMatch(/1632px/);
    expect(html(datos(), 'png')).toMatch(/1600px/);
  });

  it('el escape evita inyección desde el nombre de la presa', () => {
    const e = entrada();
    e.estados[0] = { ...e.estados[0], nombre: '<img src=x onerror=alert(1)>' };
    // El nombre viene de la meta (etiqueta), pero un id desconocido usaría el del portal: se prueba con un id sin ficha.
    const e2 = entrada({ estados: [est({ ubicacionId: 536, ...DATOS_PRESAS[536], nombre: '<b>x</b>' })] });
    expect(html(datos(cfg({ presas: [536] }), e2), 'png')).not.toMatch(/<b>x<\/b>/);
  });

  it('folio con el alcance', () => {
    expect(folioCuenca(datos(cfg({ presas: [536, 537] })), EMITIDO)).toBe('CUENCA-2DE7-20261108-0930');
  });
});

describe('informeCuencaSvg', () => {
  it('tanque S/D: sin relleno de color (trama gris), nunca 0 %', () => {
    const s = tanqueSvg({ id: 539, namoMm3: 6.5, muertoMm3: null, pct: null, estado: 'sd', sinActualizar: false }, 100, 120);
    expect(s).toMatch(/url\(#tr-539s\)/);
    expect(s).not.toMatch(/NaN/);
  });
  it('tanque sin actualizar lleva la trama diagonal', () => {
    expect(tanqueSvg({ id: 538, namoMm3: 23, muertoMm3: 1, pct: 38, estado: 'warn', sinActualizar: true }, 100, 120)).toMatch(/fill="url\(#tr-538\)"/);
  });
  it('mini-serie con huecos corta la línea y con <2 puntos no revienta', () => {
    const s = [
      { fecha: '2026-01-01', pct: 10, dudoso: false }, { fecha: '2026-01-08', pct: 12, dudoso: false },
      { fecha: '2026-01-15', pct: null, dudoso: false },
      { fecha: '2026-01-22', pct: 14, dudoso: false }, { fecha: '2026-01-29', pct: 15, dudoso: true }, { fecha: '2026-02-05', pct: 15, dudoso: true },
    ];
    const svg = miniSerieSvg(s, null, 200, 60);
    expect((svg.match(/<polyline/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(svg).not.toMatch(/NaN/);
    expect(miniSerieSvg([], null, 200, 60)).toMatch(/<svg/);
  });
  it('lluvia: S/D tiene color y trazo propios distintos de un día seco', () => {
    expect(colorLluvia(null)).not.toBe(colorLluvia(0));
    expect(tiraLluviaSvg([null, 0, 12], 90, 20)).toMatch(/stroke-dasharray/);
  });
});
