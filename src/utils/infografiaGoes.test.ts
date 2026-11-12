import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { htmlInfografiaGoes, nombreArchivoInfografiaGoes, nombreBaseInfografiaGoes, vistaVaso } from './infografiaGoesHtml';
import { cambiarFormatoInfografia, configInfografiaPorDefecto } from './infografiaGoesConfig';
import { construirDatosInfografiaGoes, redactarLecturaInfografiaGoes, rolTexto } from './infografiaGoes';
import type { EstacionHidro, MensajeHidro, PuntoHidro } from './hidroEstaciones';
import type { SeriesPorEstacion } from '../hooks/useHidroEstaciones';

const MIN = 60000;
const AHORA = Date.UTC(2026, 9, 28, 0, 0); // 27-oct-2026 18:00 hora de Chihuahua
const est = (id: string, nombre: string, presa_id: string | null, rol: string, lat: number, lon: number): EstacionHidro => ({
    id, nombre, presa_id, rol, latitud: lat, longitud: lon, intervalo_min: 20, activa: true, ult_sync_en: null, ult_dato_en: null,
});
const EST: EstacionHidro[] = [
    est('C6300760', 'Ojinaga', null, 'rio', 29.5701, -104.4032),
    est('C63009B2', 'Boca del Río', 'PRE-001', 'entrada', 27.4468, -106.2195),
    est('C6301416', 'Babisas', null, 'rio_san_pedro', 28.5589, -105.4227),
    est('C6301AC4', 'Francisco y Madero - Vírgenes', 'PRE-002', 'entrada', 27.9128, -105.9679),
];
const serie = (dias: number, f: (i: number) => number | null, fin = AHORA, paso = 20): PuntoHidro[] => {
    const n = Math.floor((dias * 24 * 60) / paso);
    const o: PuntoHidro[] = [];
    for (let i = 0; i <= n; i++) { const v = f(i); if (v != null) o.push({ t: fin - (n - i) * paso * MIN, v }); }
    return o;
};
const msgs = (ids: string[], ultimoMs: number): MensajeHidro[] => ids.map((id) => ({ estacion_id: id, ts_msg: new Date(ultimoMs).toISOString(), codigo_falla: 'G', senal_dbm: 38 }));

function entrada(over: { ultimoMs?: number; ultimoMsBoca?: number } = {}) {
    // La serie de una estación sin transmisión termina en su último mensaje.
    const finBoca = over.ultimoMsBoca ?? AHORA;
    const series: SeriesPorEstacion = {
        C6300760: { nivel_m: serie(9, () => 2.1), gasto_m3s: serie(9, (i) => 100 - (i % 400) * 0.1) },
        C63009B2: { nivel_m: serie(9, () => 4.9, finBoca), gasto_m3s: serie(9, (i) => 110 + (i % 50), finBoca) },
        // Babisas: casi todo 0.00 con nivel alto (censurado); el último valor crudo también es 0.
        C6301416: { nivel_m: serie(9, () => 6.3), gasto_m3s: serie(9, (i) => (i % 8 === 3 ? 30 : 0)) },
        C6301AC4: { nivel_m: serie(9, () => 0.8), gasto_m3s: serie(9, () => 8) },
    };
    const m = [
        ...msgs(['C6300760', 'C6301416', 'C6301AC4'], over.ultimoMs ?? AHORA - 14 * MIN),
        ...msgs(['C63009B2'], over.ultimoMsBoca ?? over.ultimoMs ?? AHORA - 14 * MIN),
    ];
    return { ventana: '24h' as const, estaciones: EST, series, mensajes: m, ahoraMs: AHORA };
}

describe('construirDatosInfografiaGoes', () => {
    it('agrupa y rotula: entradas a presa, Babisas en el Conchos a la salida del distrito, Ojinaga río', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const g = (id: string) => d.estaciones.find((e) => e.id === id)!;
        expect(g('C63009B2').rolTexto).toMatch(/Entrada a la presa La Boquilla/);
        expect(g('C6301AC4').rolTexto).toMatch(/Entrada a la presa Fco\. I\. Madero \(Las Vírgenes\)/);
        expect(g('C6301416').grupoTitulo).toBe('Río Conchos · salida del distrito');
        expect(g('C6301416').rolTexto).toMatch(/Estación de río/);
        expect(g('C6300760').entrada).toBe(false);
        expect(d.estaciones.map((e) => e.id)).toEqual(['C63009B2', 'C6301AC4', 'C6301416', 'C6300760']); // Boca del Río, Madero–Vírgenes, Babisas, Ojinaga
        expect(rolTexto(EST[2])).toMatch(/Río Conchos, salida del distrito/);
    });
    it('Babisas: último gasto censurado («< 15»), media como rango, spark de nivel y variación de gasto S/D', () => {
        const b = construirDatosInfografiaGoes(entrada()).estaciones.find((e) => e.id === 'C6301416')!;
        expect(b.ultimoGasto).toMatchObject({ tipo: 'censurado', texto: '< 15' });
        expect(b.gastoRango).not.toBeNull();
        expect(b.gastoRango!.inf).toBeLessThan(b.gastoRango!.sup);
        expect(b.gastoRango!.representativo).toBe(false);
        expect(b.variableSpark).toBe('nivel');
        expect(b.var24.gasto).toEqual({ dir: 'sd', delta: null });
        expect(b.spark.length).toBeGreaterThan(5);
    });
    it('resumen de enlace y estación sin transmisión con último registro (variación S/D, nunca 0)', () => {
        const en = construirDatosInfografiaGoes(entrada()).resumen;
        expect(en).toMatchObject({ enLinea: 4, total: 4, texto: '4 de 4 en línea' });
        const tarde = construirDatosInfografiaGoes(entrada({ ultimoMsBoca: AHORA - 5 * 60 * MIN }));
        const boca = tarde.estaciones.find((e) => e.id === 'C63009B2')!;
        expect(boca.enlace.clave).toBe('sin_transmision');
        expect(boca.obsoleto).toBe(true);
        expect(tarde.resumen.texto).toBe('3 de 4 en línea, 1 sin transmisión');
        expect(boca.var24.gasto.dir).toBe('sd');
        expect(tarde.lectura.join(' ')).toMatch(/Boca del Río: se muestra su último registro conocido/);
    });
    it('sin comparación presa↔río y declara que las entradas no son extracción', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const t = d.lectura.join(' ');
        expect(t).not.toMatch(/presa y río|comparaci/i);
        expect(d.limitaciones.join(' ')).toMatch(/No se compara presa con río/);
    });
    it('nunca imprime NaN, undefined ni null', () => {
        const d = construirDatosInfografiaGoes(entrada());
        expect(JSON.stringify(d.lectura) + d.resumen.texto + d.corteTexto).not.toMatch(/NaN|undefined|null/);
    });
    it('todo S/D: una sola frase', () => {
        const d = construirDatosInfografiaGoes({ ventana: '24h', estaciones: EST, series: {}, mensajes: [], ahoraMs: AHORA });
        expect(d.estaciones.every((e) => e.sinDatos)).toBe(true);
        expect(redactarLecturaInfografiaGoes(d)).toEqual(['Sin lecturas en el periodo (S/D) en ninguna de las estaciones.']);
    });
    it('7 d y 30 d usan su ventana', () => {
        expect(construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' }).etiquetaVentana).toMatch(/7/);
        expect(construirDatosInfografiaGoes({ ...entrada(), ventana: '30d' }).ventana).toBe('30d');
    });
});

describe('htmlInfografiaGoes', () => {
    const html = (over: Parameters<typeof entrada>[0] = {}, v: '24h' | '7d' | '30d' = '24h') => htmlInfografiaGoes(construirDatosInfografiaGoes({ ...entrada(over), ventana: v }));
    it('nunca imprime NaN, undefined ni null y trae las 4 estaciones con su rótulo', () => {
        for (const v of ['24h', '7d', '30d'] as const) {
            const h = html({}, v);
            expect(h).not.toMatch(/NaN|undefined|>null</);
            for (const n of ['Ojinaga', 'Boca del Río', 'Babisas', 'Madero']) expect(h).toContain(n);
        }
        expect(html()).toMatch(/Entrada a la presa La Boquilla/);
        expect(html()).toMatch(/Estación de río · Río Conchos, salida del distrito/);
    });
    it('Babisas: «< 15» y rango, nunca 0.00 como caudal; lleva la nota de umbral', () => {
        const h = html();
        expect(h).toMatch(/&lt; 15/);
        expect(h).toMatch(/Bajo el umbral del sensor/);
        expect(h).toMatch(/de gasto medio/);
    });
    it('estación sin transmisión: tarjeta atenuada con último registro; 30 d sin fila de cambio', () => {
        const h = html({ ultimoMsBoca: AHORA - 5 * 60 * MIN });
        expect(h).toMatch(/card apag/);
        expect(h).toMatch(/Último registro/);
        expect(h).toMatch(/3 de 4 transmiten/);
        expect(html({}, '30d')).toMatch(/El cambio se calcula a 24 h y 7 d/);
    });
    it('nombre de archivo con ventana y fecha de Chihuahua', () => {
        expect(nombreArchivoInfografiaGoes({ ventana: '7d', corteMs: AHORA })).toBe('estaciones-goes-7d-2026-10-27-1800.png');
    });
    it('mapa real: sin trazos de río, con atribución, escala y norte; sin teselas declara «sin imagen base»', () => {
        const h = html();
        expect(h).not.toMatch(/stroke="#0B5FB0" stroke-width="9"|stroke-dasharray="10 8"/);
        expect(h).toMatch(/Sin imagen base: ubicaciones aproximadas, sin escala/);
        expect(h).toMatch(/no se dibuja el trazo de los ríos/);
        expect(h).toMatch(/P\. Fco\. I\. Madero/);
        const con = htmlInfografiaGoes(construirDatosInfografiaGoes(entrada()), { teselas: [{ z: 8, x: 53, y: 107, px: 0, py: 0, uri: 'data:image/png;base64,AAAA' }] });
        expect(con).toMatch(/Mapa base: Esri/);
        expect(con).toMatch(/<image href="data:image\/png;base64,AAAA"/);
        expect(con).toMatch(/ km<\/text>/);
    });
    it('logo oficial: con data URI lleva <img> 110×96; sin él, hueco vacío y nunca un logo dibujado', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const con = htmlInfografiaGoes(d, { logo: 'data:image/jpeg;base64,/9j/AAAA' });
        expect(con).toMatch(/<img class="logo-img" src="data:image\/jpeg;base64,\/9j\/AAAA"[^>]*width="110" height="96"/);
        const sin = htmlInfografiaGoes(d);
        expect(sin).not.toMatch(/<img/);
        expect(sin).not.toMatch(/textLength/);
        expect(sin).toMatch(/<div class="logo-img"><\/div>/);
    });
    it('segundo logo (SICA 005): con data URI lleva <img> 96×96 (sello cuadrado); sin él, hueco vacío', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const con = htmlInfografiaGoes(d, { logo: 'data:image/jpeg;base64,AAAA', logoSica: 'data:image/png;base64,BBBB' });
        expect(con).toMatch(/<img class="logo-sica" src="data:image\/png;base64,BBBB"[^>]*width="96" height="96"/);
        expect(con.indexOf('logo-img')).toBeLessThan(con.indexOf('logo-sica"'));
        expect(htmlInfografiaGoes(d)).toMatch(/<div class="logo-sica"><\/div>/);
    });
    it('contorno del vaso: se dibuja con su leyenda y superficie; sin contorno (o <4 puntos) no aparece nada', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const anillo: [number, number][] = [[-105.5, 27.5], [-105.4, 27.5], [-105.4, 27.6], [-105.5, 27.6], [-105.5, 27.5]];
        const con = htmlInfografiaGoes(d, { vasos: [{ id: 'PRE-001', areaKm2: 41.234, contorno: anillo }] });
        expect(con).toMatch(/fill-opacity=".35" stroke="#0B5FB0" stroke-width="3" stroke-dasharray="9 5"/);
        expect(con).toMatch(/Espejo de agua/);
        expect(con).toMatch(/La Boquilla 41\.2 km²/);
        expect(con).toMatch(/no una medición de campo/);
        for (const vasos of [[], [{ id: 'PRE-001', areaKm2: 1, contorno: anillo.slice(0, 3) }]]) {
            const sin = htmlInfografiaGoes(d, { vasos });
            expect(sin).not.toMatch(/stroke-dasharray="9 5"|Espejo de agua/);
        }
    });
    it('recuadro ampliado del vaso: teselas + contorno + escala; el vaso sin contorno se declara S/D', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const anillo: [number, number][] = [[-105.5, 27.5], [-105.4, 27.5], [-105.4, 27.6], [-105.5, 27.6], [-105.5, 27.5]];
        const vaso = { id: 'PRE-001', areaKm2: 47.5, contorno: anillo };
        const v = vistaVaso(vaso)!;
        expect(v.z).toBeGreaterThanOrEqual(9); // más cerca que el mapa regional (z8)
        const h = htmlInfografiaGoes(d, { vasos: [vaso], teselasVaso: { 'PRE-001': [{ z: v.z, x: 1, y: 1, px: 0, py: 0, uri: 'data:image/jpeg;base64,CCCC' }] } });
        expect(h).toMatch(/<figure class="inset">/);
        expect(h).toMatch(/data:image\/jpeg;base64,CCCC/);
        expect(h).toMatch(/Espejo de agua estimado: 47\.5 km²/);
        // La presa Madero no tuvo contorno: se declara S/D y no se reutiliza uno viejo.
        expect(h).toMatch(/inset-sd[\s\S]*Fco\. I\. Madero \(Las Vírgenes\)[\s\S]*S\/D[\s\S]*no se pudo estimar/);
        expect(vistaVaso({ id: 'PRE-001', areaKm2: 1, contorno: anillo.slice(0, 3) })).toBeNull();
        expect(htmlInfografiaGoes(d)).not.toMatch(/class="inset/);
    });
    it('estación sin transmisión: no repite la fila «En 24 h» con todo S/D', () => {
        const h = html({ ultimoMsBoca: AHORA - 5 * 60 * MIN });
        const tarjetaBoca = h.slice(h.indexOf('>Boca del Río<'), h.indexOf('>Madero–Vírgenes<', h.indexOf('>Boca del Río<')));
        expect(tarjetaBoca).not.toMatch(/class="camb"/);
    });
    it('sello con estación callada nombra a la peor, no «el mensaje más reciente»', () => {
        const h = html({ ultimoMsBoca: AHORA - 5 * 60 * MIN });
        expect(h).toMatch(/Boca del Río: último mensaje hace 5 h/);
        expect(h).not.toMatch(/último mensaje hace 14 min/);
    });
    it('«Último registro» usa la antigüedad del registro frente al corte, no la del mensaje', () => {
        const h = html({ ultimoMsBoca: AHORA - 5 * 60 * MIN });
        expect(h).toMatch(/Último registro [^<]*\(hace 5 h/);
    });
    it('«estable» no lleva unidad y el nivel de Babisas no se atribuye al gasto', () => {
        expect(html()).not.toMatch(/estable m<|estable m³\/s/);
        const t = construirDatosInfografiaGoes(entrada()).lectura.join(' ');
        expect(t).not.toMatch(/gasto[^.]*estable en [^.]*Babisas/);
        expect(t).toMatch(/Babisas \(río San Pedro\):.*bajo el umbral del sensor.*; su nivel se mantiene estable\. Causa sin confirmar/);
        expect(t.match(/Babisas/g)).toHaveLength(1); // una sola frase, no repetida
    });
    it('los cambios no se parten (nowrap), sin etiquetas en mayúsculas ni círculos numerados', () => {
        const h = html({ ultimoMsBoca: AHORA - 5 * 60 * MIN });
        expect(h).toMatch(/\.cv\{white-space:nowrap/);
        expect(h).not.toMatch(/span class="n"/);
        expect(h).not.toMatch(/text-transform:uppercase/);
    });
    it('sin coordenadas (<2 estaciones ubicadas): mapa S/D y leyenda coherente', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), estaciones: EST.map((e) => ({ ...e, latitud: null, longitud: null })) });
        const h = htmlInfografiaGoes(d);
        expect(h).toMatch(/class="mapa-sd"/);
        expect(h).toMatch(/Ubicaciones pendientes/);
        expect(h).not.toMatch(/Entrada a presa/);
    });
    it('filtros del resumen: sin plano no hay mapa ni vasos; sin lectura no hay bloque; sin minigráficas no hay curva', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const base = configInfografiaPorDefecto('24h');
        const anillo: [number, number][] = [[-105.5, 27.5], [-105.4, 27.5], [-105.4, 27.6], [-105.5, 27.6], [-105.5, 27.5]];
        const vasos = [{ id: 'PRE-001', areaKm2: 10, contorno: anillo }];
        const todo = htmlInfografiaGoes(d, { config: base, vasos });
        expect(todo).toMatch(/class="mapacol"/);
        expect(todo).toMatch(/class="lectura"/);
        expect(todo).toMatch(/class="spk"/);
        const sinPlano = htmlInfografiaGoes(d, { config: { ...base, mapa: false }, vasos });
        expect(sinPlano).not.toMatch(/class="mapacol"|class="leyenda"|class="inset|Espejo de agua/);
        expect(htmlInfografiaGoes(d, { config: { ...base, vasos: false }, vasos })).not.toMatch(/class="inset|stroke-dasharray="9 5"/);
        expect(htmlInfografiaGoes(d, { config: { ...base, lectura: false } })).not.toMatch(/class="lectura"/);
        expect(htmlInfografiaGoes(d, { config: { ...base, minigraficas: false } })).not.toMatch(/class="spk"/);
        expect((htmlInfografiaGoes(d, { config: base }).match(/class="pagina/g) ?? []).length).toBe(1);
    });
    it('filtro de estaciones: solo las incluidas aparecen y el resumen cuenta solo esas', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), incluir: ['C63009B2', 'C6300760'] });
        expect(d.estaciones.map((e) => e.id)).toEqual(['C63009B2', 'C6300760']);
        expect(d.resumen.total).toBe(2);
        expect(htmlInfografiaGoes(d)).not.toContain('Babisas');
    });
    it('periodo personalizado: la etiqueta es el rango, no hay cambio 24 h/7 d y el archivo lo rotula', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), periodo: { tipo: 'rango', desde: '2026-10-20', hasta: '2026-10-25' } });
        expect(d.ventana).toBe('rango');
        expect(d.etiquetaVentana).toMatch(/20 oct/);
        expect(htmlInfografiaGoes(d)).toMatch(/El cambio se calcula a 24 h y 7 d/);
        expect(nombreBaseInfografiaGoes(d, 'tecnico')).toBe('estaciones-goes-tecnico-rango-2026-10-27-1800');
    });
    it('técnico: panorama más una ficha independiente por estación, con tabla, indicadores y enlace', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' });
        const cfg = cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico');
        const h = htmlInfografiaGoes(d, { config: cfg });
        expect((h.match(/class="pagina/g) ?? []).length).toBe(5);
        expect((h.match(/class="pagina tec"/g) ?? []).length).toBe(4);
        expect(h).toMatch(/Ficha 1 de 4/);
        expect(h).toMatch(/Ficha 4 de 4/);
        expect((h.match(/<table class="stat">/g) ?? []).length).toBe(4);
        for (const t of ['Mediana', 'Percentil 10', 'Percentil 90', 'Desviación', 'Pendiente del gasto', 'Volumen integrado', 'Enlace satelital, últimas 24 h', 'Señal']) expect(h).toContain(t);
        expect(h).toMatch(/Mide la ENTRADA a la presa/);
        // El orden de las fichas es el de la infografía: Boca del Río primero, Ojinaga al final.
        expect(h.indexOf('Ficha 1 de 4')).toBeLessThan(h.indexOf('Ficha 4 de 4'));
        expect(h).not.toMatch(/NaN|undefined|>null</);
    });
    it('técnico sin estadística ni enlace no trae tabla ni indicadores; sin plano ni lectura no hay panorama', () => {
        const d = construirDatosInfografiaGoes(entrada());
        const cfg = { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico'), estadistica: false, enlace: false, mapa: false, lectura: false };
        const h = htmlInfografiaGoes(d, { config: cfg });
        expect((h.match(/class="pagina/g) ?? []).length).toBe(4);
        expect(h).not.toMatch(/<table class="stat">|class="ind"|class="tira"/);
    });
    it('técnico Babisas: media y volumen como rango, la gráfica de gasto se omite (poco representativo) y se avisa', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), incluir: ['C6301416'] });
        const h = htmlInfografiaGoes(d, { config: { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico'), estaciones: ['C6301416'] } });
        expect(h).toMatch(/rango por lecturas bajo el umbral/);
        expect(h).toMatch(/\d+(\.\d+)? a \d+(\.\d+)? Mm³/);
        expect(h).not.toContain('<h3>Gasto, m³/s</h3>');
        expect(h).toContain('<h3>Nivel, m</h3>');
        expect(h).toMatch(/el 0\.00 que reporta no es caudal nulo/);
    });
    it('técnico: texto mínimo de 24 px en gráficas y sin etiquetas en mayúsculas', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' });
        const h = htmlInfografiaGoes(d, { config: cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico') });
        const tam = [...h.matchAll(/<text[^>]*font-size="(\d+)"/g)].map((m) => Number(m[1]));
        expect(tam.length).toBeGreaterThan(20);
        expect(Math.min(...tam)).toBeGreaterThanOrEqual(24);
        expect(h).not.toMatch(/text-transform:uppercase/);
    });
    it('impresión: cada página es una hoja (break-after) y hay reglas de @media print', () => {
        const h = htmlInfografiaGoes(construirDatosInfografiaGoes(entrada()), { config: cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico') });
        expect(h).toMatch(/@media print\{[^}]*\}\.pagina\{margin:0!important;break-after:page/);
    });
    it('hojas de papel: una hoja por ficha (carta/media) y dos fichas por hoja en «dos por hoja»', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' });
        const cfg = (hoja: 'carta-v' | 'carta-h' | 'media-v' | 'media-h' | 'mitad-2') => ({ ...cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico'), hoja });
        for (const hoja of ['carta-v', 'carta-h', 'media-v', 'media-h'] as const) {
            const h = htmlInfografiaGoes(d, { config: cfg(hoja) });
            expect((h.match(/<div class="pagina">/g) ?? []).length).toBe(4);
            expect((h.match(/<article class="ficha /g) ?? []).length).toBe(4);
            expect(h).not.toMatch(/NaN|undefined|>null</);
        }
        const dos = htmlInfografiaGoes(d, { config: cfg('mitad-2') });
        expect((dos.match(/class="pagina dos"/g) ?? []).length).toBe(2);
        expect((dos.match(/<article class="ficha h/g) ?? []).length).toBe(4);
        // Medidas de hoja a 96 dpi y @page de cada tamaño.
        expect(htmlInfografiaGoes(d, { config: cfg('carta-v') })).toMatch(/\.ficha\.v\{width:816px;height:1056px\}[\s\S]*@page\{size:8\.5in 11in;margin:0\}/);
        expect(htmlInfografiaGoes(d, { config: cfg('carta-h') })).toMatch(/\.ficha\.h\{width:1056px;height:816px\}[\s\S]*@page\{size:11in 8\.5in;margin:0\}/);
        expect(htmlInfografiaGoes(d, { config: cfg('media-v') })).toMatch(/\.ficha\.v\{width:528px;height:816px\}[\s\S]*@page\{size:5\.5in 8\.5in;margin:0\}/);
        expect(htmlInfografiaGoes(d, { config: cfg('media-h') })).toMatch(/\.ficha\.h\{width:816px;height:528px\}[\s\S]*@page\{size:8\.5in 5\.5in;margin:0\}/);
        expect(dos).toMatch(/@page\{size:8\.5in 11in;margin:0\}/);
        // La plantilla de pantalla (1080) no se mezcla con la de papel.
        expect(htmlInfografiaGoes(d, { config: cfg('carta-v') })).not.toMatch(/width:1080px/);
    });
    it('ficha Carta: contenido completo y veracidad (Babisas «< 15», rangos, sin gráfica de gasto, entradas rotuladas)', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' });
        const h = htmlInfografiaGoes(d, { config: { ...cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico'), hoja: 'carta-v' } });
        for (const t of ['Mediana', 'Percentil 10', 'Percentil 90', 'Desviación', 'Pendiente del gasto', 'Volumen integrado', 'Enlace satelital, últimas 24 h', 'Cobertura', 'ficha 1 de 4', 'ficha 4 de 4', 'Folio GOES-']) expect(h).toContain(t);
        expect(h).toMatch(/Entrada a la presa La Boquilla/);
        expect(h).toMatch(/&lt; 15/);
        expect(h).toMatch(/El gasto no se grafica/);
        expect(h).toMatch(/el 0\.00 que reporta no es caudal nulo/);
        expect(h).toMatch(/Mide la ENTRADA a la presa/);
        // Babisas (gasto no representativo): la pendiente del gasto no se publica.
        expect(h).toMatch(/Pendiente del gasto<\/dt><dd><span class="sd">S\/D<\/span><\/dd><dd class="n">gasto no representativo/);
    });
    it('ficha de media hoja: lo esencial, con las omisiones declaradas y Babisas con pendiente S/D', () => {
        const d = construirDatosInfografiaGoes({ ...entrada(), incluir: ['C6301416', 'C63009B2'] });
        const h = htmlInfografiaGoes(d, { config: { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico'), hoja: 'media-h', estaciones: ['C6301416', 'C63009B2'] } });
        expect(h).toMatch(/Versión resumida; la ficha completa está en tamaño Carta/);
        expect(h).toMatch(/gasto no representativo/);
        expect(h).toMatch(/Media entre/);
        expect(h).not.toMatch(/Mediana|Desviación|Percentil 90/);
        expect((h.match(/class="graf"/g) ?? []).length).toBe(2);
    });
    it('volcado opcional de cada hoja de papel (para medir desbordes con un navegador)', () => {
        const dir = process.env.GOES_PAPEL_DIR;
        if (dir) {
            for (const [nombre, entradaX] of [['en_linea', entrada()], ['sin_tx', entrada({ ultimoMsBoca: AHORA - 5 * 60 * MIN })]] as const) {
                const d = construirDatosInfografiaGoes({ ...entradaX, ventana: '7d' });
                for (const hoja of ['carta-v', 'carta-h', 'media-v', 'media-h', 'mitad-2'] as const) {
                    writeFileSync(`${dir}/papel_${hoja}_${nombre}.html`, htmlInfografiaGoes(d, { config: { ...cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico'), hoja } }));
                }
            }
        }
        expect(true).toBe(true);
    });
    it('volcado JSON opcional de los datos (para prototipos de diseño)', () => {
        const ruta = process.env.GOES_JSON;
        if (ruta) writeFileSync(ruta, JSON.stringify({ en_linea: construirDatosInfografiaGoes({ ...entrada(), ventana: '7d' }), sin_transmision: construirDatosInfografiaGoes({ ...entrada({ ultimoMsBoca: AHORA - 5 * 60 * MIN }), ventana: '7d' }) }, null, 1));
        expect(true).toBe(true);
    });
    it('volcado opcional para revisión visual (con logo y teselas reales si hay red)', async () => {
        const ruta = process.env.GOES_DUMP;
        if (ruta) {
            const { readFileSync } = await import('node:fs');
            const { descargarTeselas } = await import('./mapaTeselas');
            const { vistaInfografiaGoes } = await import('./infografiaGoesHtml');
            const d = construirDatosInfografiaGoes(entrada());
            const logo = `data:image/jpeg;base64,${readFileSync('public/logos/logo-srl.png').toString('base64')}`;
            const vista = vistaInfografiaGoes(d.estaciones);
            const teselas = vista ? await descargarTeselas(vista) : [];
            writeFileSync(ruta, htmlInfografiaGoes(d, { logo, teselas }));
        }
        expect(true).toBe(true);
    }, 30000);
});
