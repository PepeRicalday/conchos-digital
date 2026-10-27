import { describe, expect, it } from 'vitest';
import {
    atajoActivo, avisosConfigGoes, cambiarModalidadGoes, codigoPeriodoGoes, configGoesPorDefecto, diaLocal, estacionesDeAtajo, etiquetaPeriodoGoes,
    contarHojasGoes, inicioDiaMs, rangoEfectivo, seccionesGoesDe, validarConfigGoes, type ConfigInformeGoes,
} from './informeGoesConfig';
import {
    agregarBanda, estadisticaRango, pasoParaSpan, prepararInformeGoes, redactarLecturaGoes, semaforoCobertura, type EntradaInformeGoes,
} from './informeGoesDatos';
import { folioGoes, htmlInformeGoes, nombreArchivoGoes } from './informeGoesHtml';
import { svgBarras, svgCajas, svgLineas, svgSemaforoCobertura, svgSpark, svgTiraEnlace, ticksTiempo } from './informeGoesSvg';
import { estadisticaEstacion } from './hidroEstadistica';
import type { EstacionHidro, MensajeHidro, PuntoHidro } from './hidroEstaciones';
import type { SeriesPorEstacion } from '../hooks/useHidroEstaciones';

const MIN = 60000;
const HORA = 60 * MIN;
const AHORA = Date.UTC(2026, 9, 26, 18, 0); // 26-oct-2026 12:00 hora de Chihuahua
const EST: EstacionHidro[] = [
    { id: 'C6300760', nombre: 'Ojinaga', presa_id: null, rol: 'rio', latitud: null, longitud: null, intervalo_min: 15, activa: true, ult_sync_en: null, ult_dato_en: null },
    { id: 'C63009B2', nombre: 'Boca del Río', presa_id: 'PRE-001', rol: 'presa', latitud: null, longitud: null, intervalo_min: 20, activa: true, ult_sync_en: null, ult_dato_en: null },
    { id: 'C6301416', nombre: 'Babisas', presa_id: 'PRE-001', rol: 'presa', latitud: null, longitud: null, intervalo_min: 20, activa: true, ult_sync_en: null, ult_dato_en: null },
    { id: 'C6301AC4', nombre: 'Francisco y Madero - Vírgenes', presa_id: 'PRE-002', rol: 'presa', latitud: null, longitud: null, intervalo_min: 20, activa: true, ult_sync_en: null, ult_dato_en: null },
];

function serie(paso: number, dias: number, f: (i: number, t: number) => number | null): PuntoHidro[] {
    const out: PuntoHidro[] = [];
    const n = Math.floor((dias * 24 * 60) / paso);
    for (let i = 0; i <= n; i++) {
        const t = AHORA - (n - i) * paso * MIN;
        const v = f(i, t);
        if (v != null) out.push({ t, v });
    }
    return out;
}

function datos(): { series: SeriesPorEstacion; meteo: SeriesPorEstacion; mensajes: MensajeHidro[] } {
    const series: SeriesPorEstacion = {
        C6300760: { nivel_m: serie(15, 10, (i) => 1.8 + (i % 96) * 0.001), gasto_m3s: serie(15, 10, (i) => 60 + (i % 96) * 0.1), velocidad_ms: serie(15, 10, () => 4.5) },
        C63009B2: { nivel_m: serie(20, 10, () => 4.8), gasto_m3s: serie(20, 10, (i) => 100 + (i % 72) * 0.2) },
        // Babisas: 2 lecturas de 12 m³/s y 4 de gasto 0 con nivel alto (cero sospechoso), repetido: 67 % excluido.
        C6301416: { nivel_m: serie(20, 10, () => 6.2), gasto_m3s: serie(20, 10, (i) => (i % 6 < 2 ? 12 : 0)) },
        // Madero sin ninguna lectura.
        C6301AC4: { nivel_m: [], gasto_m3s: [] },
    };
    const meteo: SeriesPorEstacion = {
        C63009B2: { temp_c: serie(20, 10, (i) => 15 + (i % 30) * 0.3), viento_ms: serie(20, 10, () => 2), hr_pct: serie(60, 10, () => 55), presion_hpa: serie(60, 10, () => 861), rad_wm2: serie(60, 10, (i) => (i % 24) * 30) },
        C6301416: { temp_c: serie(20, 10, () => 18), viento_ms: serie(20, 10, () => 3), hr_pct: serie(60, 10, () => 60), presion_hpa: serie(60, 10, () => 895), rad_wm2: serie(60, 10, () => 100) },
    };
    const mensajes: MensajeHidro[] = [];
    for (const id of ['C6300760', 'C63009B2', 'C6301416']) {
        for (let h = 0; h < 48; h++) mensajes.push({ estacion_id: id, ts_msg: new Date(AHORA - h * HORA - 5 * MIN).toISOString(), codigo_falla: id === 'C6301416' && h % 6 === 0 ? 'X' : 'G', senal_dbm: -80 });
    }
    return { series, meteo, mensajes };
}

const entrada = (cfg: Partial<ConfigInformeGoes> = {}): EntradaInformeGoes => {
    const d = datos();
    return { config: { ...configGoesPorDefecto('7d'), ...cfg }, estaciones: EST, ...d, ahoraMs: AHORA };
};
const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: 'data:image/png;base64,BBBB' };
const textoVisible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, (m) => m.replace(/<(?!text|title)[^>]*>/g, ' ')).replace(/<[^>]+>/g, ' ');

describe('config', () => {
    it('por defecto: Básico, 4 estaciones, ventana inicial, todas las variables y secciones básicas', () => {
        const c = configGoesPorDefecto('7d');
        expect(c.modalidad).toBe('basico');
        expect(c.estaciones).toHaveLength(4);
        expect(c.periodo.tipo).toBe('7d');
        expect(c.variables).toEqual(['nivel', 'gasto', 'velocidad', 'meteo']);
        expect(c.secciones).toEqual(['resumen', 'estado', 'tendencia', 'grafica']);
        expect(configGoesPorDefecto().periodo.tipo).toBe('24h');
    });
    it('secciones por modalidad: Técnico agrega, Básico no contiene las técnicas', () => {
        const b = seccionesGoesDe('basico').map((s) => s.id);
        const t = seccionesGoesDe('tecnico').map((s) => s.id);
        expect(b).not.toContain('estadistica');
        expect(t).toEqual(expect.arrayContaining([...b, 'estadistica', 'volumen', 'comparacion', 'enlace', 'meteo', 'calidad', 'trazabilidad']));
    });
    it('cambiar de modalidad reinicia las secciones; la misma modalidad no toca nada', () => {
        const c = { ...configGoesPorDefecto(), secciones: ['resumen' as const] };
        expect(cambiarModalidadGoes(c, 'basico')).toBe(c);
        expect(cambiarModalidadGoes(c, 'tecnico').secciones).toContain('metodologia');
        expect(cambiarModalidadGoes(cambiarModalidadGoes(c, 'tecnico'), 'basico').secciones).toEqual(['resumen', 'estado', 'tendencia', 'grafica']);
    });
    it('atajos de agrupación presa / río / todas', () => {
        expect(estacionesDeAtajo(EST, 'presas')).toEqual(['C63009B2', 'C6301416', 'C6301AC4']);
        expect(estacionesDeAtajo(EST, 'rio')).toEqual(['C6300760']);
        expect(estacionesDeAtajo(EST, 'todas')).toHaveLength(4);
        expect(atajoActivo(EST, ['C6300760'])).toBe('rio');
        expect(atajoActivo(EST, ['C6300760', 'C6301416'])).toBeNull();
    });
    it('valida: sin estaciones, variables o secciones; rango incompleto, invertido o fuera de 30 días', () => {
        const base = configGoesPorDefecto();
        expect(validarConfigGoes(base, AHORA)).toEqual([]);
        expect(validarConfigGoes({ ...base, estaciones: [] }, AHORA)).toContain('Elige al menos una estación.');
        expect(validarConfigGoes({ ...base, estaciones: ['XXXX'] }, AHORA).join()).toMatch(/no existe/);
        expect(validarConfigGoes({ ...base, variables: [] }, AHORA)).toContain('Elige al menos una variable.');
        expect(validarConfigGoes({ ...base, secciones: [] }, AHORA)).toContain('Elige al menos una sección.');
        const r = (desde: string, hasta: string) => validarConfigGoes({ ...base, periodo: { tipo: 'rango', desde, hasta } }, AHORA);
        expect(r('', '')[0]).toMatch(/día inicial y el final/);
        expect(r('2026-10-20', '2026-10-10')[0]).toMatch(/posterior/);
        expect(r('2026-02-30', '2026-03-01')[0]).toMatch(/día inicial y el final/);
        expect(r('2026-08-01', '2026-08-10')[0]).toMatch(/fuera de los últimos 30 días/);
        expect(r('2026-11-05', '2026-11-06')[0]).toMatch(/futuro/);
        expect(r('2026-10-10', '2026-10-20')).toEqual([]);
    });
    it('rango efectivo: días en hora de Chihuahua, recorte a 30 d y tope en el momento actual', () => {
        expect(diaLocal(inicioDiaMs('2026-10-12'))).toBe('2026-10-12');
        expect(inicioDiaMs('2026-10-12')).toBe(Date.UTC(2026, 9, 12, 6));
        const r = rangoEfectivo({ tipo: 'rango', desde: '2026-10-12', hasta: '2026-10-14' }, AHORA)!;
        expect(r.hastaMs - r.desdeMs).toBe(3 * 24 * HORA);
        expect(r.recortado).toBe(false);
        const hoy = rangoEfectivo({ tipo: 'rango', desde: '2026-10-25', hasta: '2026-10-26' }, AHORA)!;
        expect(hoy.hastaMs).toBe(AHORA);
        const largo = rangoEfectivo({ tipo: 'rango', desde: '2026-09-01', hasta: '2026-10-20' }, AHORA)!;
        expect(largo.recortado).toBe(true);
        expect(largo.desdeMs).toBe(AHORA - 30 * 24 * HORA);
        expect(rangoEfectivo({ tipo: '7d', desde: '', hasta: '' }, AHORA)!.horas).toBe(168);
    });
    it('avisos: recorte, comparación con 24 h, Ojinaga sin meteo, velocidad sin Ojinaga y Babisas', () => {
        const base = configGoesPorDefecto();
        const a = avisosConfigGoes({ ...base, periodo: { tipo: 'rango', desde: '2026-09-01', hasta: '2026-10-20' } }, AHORA);
        expect(a.join('\n')).toMatch(/solo llegan a 30 días/);
        const t = { ...cambiarModalidadGoes(base, 'tecnico') };
        expect(avisosConfigGoes(t, AHORA).join('\n')).toMatch(/Comparación presa ↔ río: con 24 h/);
        expect(avisosConfigGoes({ ...t, periodo: { tipo: '7d', desde: '', hasta: '' }, estaciones: ['C6301416'] }, AHORA).join('\n')).toMatch(/requiere Ojinaga/);
        expect(avisosConfigGoes({ ...t, estaciones: ['C6300760'] }, AHORA).join('\n')).toMatch(/no mide meteorología/);
        expect(avisosConfigGoes({ ...t, estaciones: ['C6301416'] }, AHORA).join('\n')).toMatch(/Solo Ojinaga mide velocidad/);
        expect(avisosConfigGoes(t, AHORA).join('\n')).toMatch(/Babisas/);
        expect(avisosConfigGoes({ ...t, variables: ['nivel'] }, AHORA).join('\n')).toMatch(/Volumen estimado» necesita/);
    });
    it('etiquetas y códigos de periodo', () => {
        expect(etiquetaPeriodoGoes({ tipo: '24h', desde: '', hasta: '' })).toBe('Últimas 24 horas');
        expect(etiquetaPeriodoGoes({ tipo: 'rango', desde: '2026-10-12', hasta: '2026-10-14' }, AHORA)).toBe('12 oct 2026 – 14 oct 2026');
        expect(codigoPeriodoGoes({ tipo: '30d', desde: '', hasta: '' })).toBe('30D');
        expect(codigoPeriodoGoes({ tipo: 'rango', desde: '2026-10-12', hasta: '2026-10-14' }, AHORA)).toBe('R20261012-20261014');
    });
});

describe('datos', () => {
    it('el adaptador por rango coincide con estadisticaEstacion en una ventana preajustada', () => {
        const { series } = datos();
        const a = estadisticaEstacion('C6301416', 20, series.C6301416, '7d', AHORA);
        const b = estadisticaRango('C6301416', 20, series.C6301416, AHORA - 168 * HORA, AHORA);
        expect(b.gasto).toEqual(a.gasto);
        expect(b.nivel).toEqual(a.nivel);
        expect(b.volumen).toEqual(a.volumen);
        expect(b.excluidas).toBe(a.excluidas);
        expect(b.cobertura).toEqual(a.cobertura);
        expect(b.pendienteGastoDia).toBe(a.pendienteGastoDia);
        expect(b.gastoRepresentativo).toBe(a.gastoRepresentativo);
        expect(b.pctExcluidas).toBe(a.pctExcluidas);
        expect(b.variacionGasto).toEqual(a.variacionGasto);
        expect(b.variacionNivel).toEqual(a.variacionNivel);
    });
    it('excluye los ceros sospechosos de Babisas de media y volumen, y lo declara', () => {
        const d = prepararInformeGoes(entrada());
        const b = d.estaciones.find((e) => e.id === 'C6301416')!;
        expect(b.est.excluidas).toBeGreaterThan(100);
        expect(b.est.gasto!.min).toBe(12);
        expect(b.est.gasto!.media).toBe(12);
        // Los ceros son gasto censurado: media y volumen como rango (inferior < superior), no la media de los positivos
        expect(b.est.censurado).not.toBeNull();
        expect(b.est.censurado!.mediaInf).toBeLessThan(b.est.censurado!.mediaSup);
        expect(b.est.censurado!.mediaInf).toBeLessThan(12);
        expect(d.lectura.join(' ')).toMatch(/Babisas \(\d+ lecturas, \d+ % de las recibidas\)/);
        expect(d.lectura.join(' ')).toMatch(/fue más de la mitad/);
        expect(b.est.gastoRepresentativo).toBe(false);
        expect(d.notasCalidad.join(' ')).toMatch(/más de la mitad/);
        expect(d.notasCalidad.join(' ')).toMatch(/Babisas: \d+ lecturas de gasto 0\.00/);
        // Los tramos con un extremo excluido no se puentean: solo se integra el 1 de cada 6 (pares de lecturas válidas contiguas)
        expect(b.est.volumen!.pctIntegrado).toBeGreaterThan(0);
        expect(b.est.volumen!.pctIntegrado).toBeLessThan(25);
        // El gasto medio de Babisas (no representativo) no compite por "mayor gasto medio"
        expect(d.lectura.join(' ')).toMatch(/mayor gasto medio del periodo fue el de Boca del Río/);
    });
    it('estación sin lecturas: S/D en todo, nunca 0, y se declara en la lectura', () => {
        const d = prepararInformeGoes(entrada());
        const m = d.estaciones.find((e) => e.id === 'C6301AC4')!;
        expect(m.sinDatos).toBe(true);
        expect(m.est.gasto).toBeNull();
        expect(m.est.volumen).toBeNull();
        expect(m.est.cobertura).toBeNull();
        expect(m.ultimoGasto).toBeNull();
        expect(d.lectura[0]).toMatch(/3 de 4 estaciones con lecturas; sin datos \(S\/D\): Madero–Vírgenes/);
    });
    it('rango personalizado: usa solo lecturas dentro del rango', () => {
        const e = entrada({ periodo: { tipo: 'rango', desde: '2026-10-20', hasta: '2026-10-21' } });
        const d = prepararInformeGoes(e);
        const o = d.estaciones.find((x) => x.id === 'C6300760')!;
        expect(d.horas).toBe(48);
        expect(o.est.gasto!.n).toBeGreaterThanOrEqual(191);
        expect(o.est.gasto!.n).toBeLessThanOrEqual(193);
        expect(o.serieGasto[0].t).toBeGreaterThanOrEqual(d.desdeMs - 3 * HORA);
        expect(d.etiquetaPeriodo).toBe('20 oct 2026 – 21 oct 2026');
    });
    it('comparación presa↔río: no sustentable con 24 h o sin Ojinaga; sustentable con 7 d y cobertura', () => {
        expect(prepararInformeGoes(entrada({ periodo: { tipo: '24h', desde: '', hasta: '' } })).comparacion.sustentable).toBe(false);
        expect(prepararInformeGoes(entrada({ estaciones: ['C6301416', 'C63009B2'] })).comparacion.motivo).toMatch(/Ojinaga/);
        const c = prepararInformeGoes(entrada()).comparacion;
        expect(c.sustentable).toBe(true);
        // Babisas (67 % excluido) no representa el periodo y Madero no tiene lecturas: solo Boca del Río compara.
        expect(c.filas.map((f) => f.estacionId)).toEqual(['C63009B2']);
        expect(c.filas[0].c.gastoRio).toBeGreaterThan(0);
    });
    it('meteorología: Ojinaga sin sensores, radiación de Madero nunca publicada, valores físicos', () => {
        const d = prepararInformeGoes(entrada());
        expect(d.estaciones.find((e) => e.id === 'C6300760')!.meteo).toBeNull();
        const b = d.estaciones.find((e) => e.id === 'C63009B2')!.meteo!;
        expect(b.temp!.n).toBeGreaterThan(100);
        expect(b.rad).not.toBeNull();
        const sin = prepararInformeGoes(entrada({ variables: ['nivel', 'gasto'] }));
        expect(sin.estaciones.every((e) => e.meteo === null)).toBe(true);
    });
    it('lectura: clasifica sube/baja/estable con S/D explícito y cifras derivadas', () => {
        const base = prepararInformeGoes(entrada());
        const txt = redactarLecturaGoes(base).join(' ');
        expect(txt).toMatch(/mayor gasto medio del periodo fue el de Boca del Río/);
        expect(txt).toMatch(/Enlace satelital/);
        // Madero sin datos no entra a ninguna dirección
        expect(txt).not.toMatch(/Madero–Vírgenes \(/);
    });
    it('agregarBanda conserva mín y máx; pasoParaSpan escoge pasos limpios', () => {
        const b = agregarBanda([{ t: 0, v: 1 }, { t: 60000, v: 5 }, { t: 3600000, v: 2 }], 60);
        expect(b).toHaveLength(2);
        expect(b[0]).toMatchObject({ v: 3, min: 1, max: 5 });
        expect(pasoParaSpan(24 * HORA)).toBe(10);
        expect(pasoParaSpan(30 * 24 * HORA)).toBe(180);
        expect(semaforoCobertura(null)).toBe('sd');
        expect(semaforoCobertura(90)).toBe('ok');
        expect(semaforoCobertura(60)).toBe('parcial');
        expect(semaforoCobertura(10)).toBe('bajo');
    });
});

describe('html', () => {
    const tecnico = (extra: Partial<ConfigInformeGoes> = {}) => {
        const c = cambiarModalidadGoes(configGoesPorDefecto('7d'), 'tecnico');
        return htmlInformeGoes(prepararInformeGoes(entrada({ ...c, ...extra })), LOGOS, { emitido: new Date(2026, 9, 26, 12, 5), version: '2.50.0' });
    };
    const basico = (extra: Partial<ConfigInformeGoes> = {}) => htmlInformeGoes(prepararInformeGoes(entrada(extra)), LOGOS, { emitido: new Date(2026, 9, 26, 12, 5) });
    const hojas = (h: string) => (h.match(/<section class="pagina"/g) || []).length;

    it('Básico: 4 hojas; Técnico: 10 hojas (una por bloque lógico)', () => {
        expect(hojas(basico())).toBe(4);
        expect(hojas(tecnico())).toBe(10);
        expect(tecnico()).toMatch(/Pág\. 10 de 10/);
    });
    it('sin NaN, undefined ni null en el texto, con datos, con estación sin datos y con todo vacío', () => {
        for (const h of [basico(), tecnico(), tecnico({ estaciones: ['C6301AC4'] }), basico({ estaciones: ['C6301AC4'], variables: ['nivel'] }), tecnico({ periodo: { tipo: 'rango', desde: '2026-10-20', hasta: '2026-10-21' } })]) {
            expect(h).not.toMatch(/NaN|undefined|\bnull\b|\[object/);
        }
    });
    it('S/D explícito donde no hay dato, y ningún "0.00" inventado para Madero', () => {
        const h = tecnico({ estaciones: ['C6301AC4'] });
        expect(textoVisible(h)).toMatch(/S\/D/);
        const fila = h.slice(h.indexOf('Tabla estadística'), h.indexOf('Volumen estimado'));
        expect(fila).toMatch(/S\/D — sin lecturas en el periodo/);
        expect(h).toMatch(/no se publica/);
    });
    it('portada: logos, folio, periodo y lectura en palabras', () => {
        const h = basico();
        expect(h).toContain(LOGOS.srl);
        expect(h).toContain('S R L&nbsp;&nbsp;Unidad Conchos');
        expect(h).toMatch(/GOES-BAS-7D-20261026-1205/);
        expect(h).toMatch(/Lectura del periodo/);
        expect(h).toMatch(/Últimos 7 días/);
        expect(h).toContain('--inst:#6B2D2D');
    });
    it('folio y nombres de archivo', () => {
        const d = prepararInformeGoes(entrada());
        const f = new Date(2026, 9, 26, 12, 5);
        expect(folioGoes(d, f)).toBe('GOES-BAS-7D-20261026-1205');
        expect(nombreArchivoGoes(d, f)).toBe('informe-goes-basico-7d-2026-10-26.html');
        expect(nombreArchivoGoes(d, f, 'pdf')).toBe('informe-goes-basico-7d-2026-10-26.pdf');
        const r = prepararInformeGoes(entrada({ modalidad: 'tecnico', periodo: { tipo: 'rango', desde: '2026-10-12', hasta: '2026-10-14' } }));
        expect(folioGoes(r, f)).toBe('GOES-TEC-R20261012-20261014-20261026-1205');
        expect(nombreArchivoGoes(r, f, 'png')).toBe('informe-goes-tecnico-r20261012-20261014-2026-10-26.png');
    });
    it('contarHojasGoes coincide con las hojas del documento', () => {
        const casos: Partial<ConfigInformeGoes>[] = [{}, { secciones: ['resumen'] }, { modalidad: 'tecnico', secciones: ['volumen', 'comparacion', 'calidad'] }, { modalidad: 'tecnico', secciones: ['metodologia', 'meteo'] }, { secciones: [] }];
        for (const x of casos) {
            const e = entrada(x.modalidad === 'tecnico' ? { ...cambiarModalidadGoes(configGoesPorDefecto('7d'), 'tecnico'), ...x } : x);
            expect(hojas(htmlInformeGoes(prepararInformeGoes(e), LOGOS))).toBe(Math.max(1, contarHojasGoes(e.config)));
        }
    });
    it('numeración de secciones consecutiva y sin marcas sin resolver', () => {
        const h = tecnico();
        expect(h).not.toContain('{{N}}');
        const nums = [...h.matchAll(/<h2[^>]*><span class="n">(\d+)<\/span>/g)].map((m) => +m[1]);
        expect(nums).toEqual(nums.map((_, i) => i + 1));
        expect(nums.length).toBeGreaterThanOrEqual(10);
    });
    it('hoja A4, y solo las secciones pedidas y permitidas por la modalidad', () => {
        expect(basico({ formato: 'a4' })).toMatch(/size:A4/i);
        const solo = basico({ secciones: ['resumen', 'estadistica'] });
        expect(hojas(solo)).toBe(1); // 'estadistica' no es de Básico
        expect(hojas(basico({ secciones: [] }))).toBe(1); // hoja de aviso
    });
    it('comparación no sustentable se declara; sustentable lleva la advertencia de que no es balance', () => {
        expect(tecnico({ periodo: { tipo: '24h', desde: '', hasta: '' } })).toMatch(/No se publica la comparación/);
        expect(tecnico()).toMatch(/Orientativa, no es un balance/);
    });
    it('trazabilidad y firmas en el Técnico', () => {
        const h = tecnico();
        expect(h).toMatch(/Fecha y hora de generación/);
        expect(h).toMatch(/Telemetría GOES \/ DCP vía monitor Sutron/);
        expect(h).toMatch(/class="firmas"/);
        expect(h).toMatch(/2\.50\.0/);
        expect(basico()).not.toMatch(/class="firmas"/);
    });
    it('no se publica pa_sin_confirmar ni la radiación de Madero', () => {
        const h = tecnico();
        expect(h).not.toMatch(/pa_sin_confirmar/);
        expect(h).toMatch(/No confiable \(no se publica\)/);
    });
    it('escapa texto dinámico', () => {
        const e = entrada({ modalidad: 'tecnico', secciones: ['trazabilidad'] });
        e.estaciones = e.estaciones.map((x) => (x.id === 'C6301416' ? { ...x, nombre: 'Babisas <b>&' } : x));
        const h = htmlInformeGoes(prepararInformeGoes(e), LOGOS);
        expect(h).not.toContain('Babisas <b>');
        expect(h).toContain('Babisas &lt;b&gt;&amp;');
    });
});

describe('svg', () => {
    const pts = (t0: number, vs: (number | null)[]) => vs.flatMap((v, i) => (v == null ? [] : [{ t: t0 + i * 10 * MIN, v, min: v - 1, max: v + 1 }]));
    const T0 = AHORA - 6 * HORA;
    const base = { desde: T0, hasta: AHORA, unidad: 'm³/s', decimales: 1, titulo: 'Prueba', pasoMin: 10 };
    it('un hueco largo corta la línea en dos trazos (S/D no se une ni se dibuja como 0)', () => {
        const s = { id: 'a', etiqueta: 'A', color: '#3987e5', dash: '', pts: [...pts(T0, [10, 11, 12]), ...pts(T0 + 3 * HORA, [14, 15, 16])] };
        const svg = svgLineas([s], base);
        expect((svg.match(/<polyline/g) || []).length).toBe(2);
        expect(svg).not.toMatch(/NaN|undefined/);
        expect(svg).toContain('m³/s');
    });
    it('sin datos: recuadro S/D; con ≥ 2 series hay leyenda y etiquetas directas', () => {
        expect(svgLineas([{ id: 'a', etiqueta: 'A', color: '#000', dash: '', pts: [] }], base)).toMatch(/S\/D — sin lecturas/);
        const dos = svgLineas([
            { id: 'a', etiqueta: 'Alfa', color: '#3987e5', dash: '', pts: pts(T0, [10, 11, 12]) },
            { id: 'b', etiqueta: 'Beta', color: '#d95926', dash: '7 3', pts: pts(T0, [10.2, 11, 12.1]) },
            { id: 'c', etiqueta: 'Gamma', color: '#199e70', dash: '', pts: [] },
        ], base);
        expect(dos).toMatch(/Alfa/);
        expect(dos).toMatch(/Gamma \(S\/D\)/);
        expect(dos).toMatch(/stroke-dasharray="7 3"/);
    });
    it('eje de tiempo en hora de Chihuahua con marcas regulares', () => {
        const t = ticksTiempo(AHORA - 24 * HORA, AHORA);
        expect(t.length).toBeGreaterThanOrEqual(5);
        expect(t.every((k) => /^\d{2}:\d{2}$/.test(k.hora))).toBe(true);
        expect(t[1].t - t[0].t).toBe(4 * HORA);
        const largo = ticksTiempo(AHORA - 30 * 24 * HORA, AHORA);
        expect(largo[0].hora).toMatch(/\d{2}[- ][a-z]{3}/);
    });
    it('spark: con menos de 2 puntos rotula S/D', () => {
        expect(svgSpark([], '#000', 't')).toMatch(/S\/D/);
        expect(svgSpark(pts(T0, [1, 2, 3, 2]), '#000', 't')).toMatch(/<polyline/);
    });
    it('cajas y barras: S/D sin geometría de dato; sin NaN', () => {
        const c = svgCajas([
            { etiqueta: 'A', color: '#000', min: 1, p10: 2, mediana: 4, media: 4.5, p90: 7, max: 9 },
            { etiqueta: 'B', color: '#111', min: null, p10: null, mediana: null, media: null, p90: null, max: null },
        ], { unidad: 'm³/s', decimales: 1, titulo: 't' });
        expect(c).toMatch(/S\/D/);
        expect(c).not.toMatch(/NaN|undefined/);
        const b = svgBarras([{ etiqueta: 'A', color: '#000', valor: 2.5, nota: 'x' }, { etiqueta: 'B', color: '#111', valor: null, nota: 'y' }], { unidad: 'Mm³', decimales: 2, titulo: 't' });
        expect(b).toMatch(/2\.50 Mm³/);
        expect((b.match(/<path d="M/g) || []).length).toBe(1);
        expect(svgBarras([{ etiqueta: 'B', color: '#111', valor: null, nota: '' }], { unidad: 'Mm³', decimales: 2, titulo: 't' })).toMatch(/S\/D/);
    });
    it('tira de enlace: 24 celdas y semáforo con umbral', () => {
        const celdas = Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 'bueno' : i % 3 === 1 ? 'falla' : 'sin')) as ('bueno' | 'falla' | 'sin')[];
        expect((svgTiraEnlace(celdas, 't').match(/<rect/g) || []).length).toBe(24);
        expect(svgSemaforoCobertura(95, 80, 't')).toMatch(/Confiable/);
        expect(svgSemaforoCobertura(60, 80, 't')).toMatch(/Parcial/);
        expect(svgSemaforoCobertura(20, 80, 't')).toMatch(/Insuficiente/);
        expect(svgSemaforoCobertura(null, 80, 't')).toMatch(/S\/D/);
    });
});
