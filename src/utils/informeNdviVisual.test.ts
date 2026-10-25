// Sistema visual del informe NDVI: color solo para el vigor, módulos por forma, texto ≥ 7.5 pt, plano con relieve y distinción en grises.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme, type InformeNdvi } from './informeNdviDatos';
import { configPorDefecto, mesesDisponibles } from './informeNdviConfig';
import { construirHtmlNdvi } from './informeNdviHtml';
import { contornosAAnillos, miniPlanoModuloSvg, planoSvg, separarRotulos, svgSerieModulos, svgSparkline, TRAMA_VECINOS, type ContextoPlano } from './informeNdviSvg';
import { svgBarrasDelta, svgBarrasPareadas, svgLineasSimples, svgPendienteSlope } from './informeNdviSvgComparativo';
import { colorPrevioImpreso, svgPulso } from './informeNdviInteranualHtml';
import { FS_MIN, NOMBRE_FORMA, PASOS_TINTA, TRAZO_MODULO, leyendaSistemaVisual, colorPasoTinta, formaDeModulo, formaSvg, marcadorModuloSvg, rotuloModuloSvg } from './informeNdviMarcas';
import { CLASES_NDVI, SD_TRAZO, SUELO_CONTORNO, contraste, grisPercibido, luminosidadL } from './ndviRampa';
import { COLOR_MODULO_SRL, MODULOS_SRL_IDS } from './modulosSRL';
import { armarContextoPlano } from './contextoPlanoNdvi';

const GEO = JSON.parse(fs.readFileSync(new URL('../../public/geo/modulos.geojson', import.meta.url), 'utf-8')) as GeoJSON.FeatureCollection;
const CTX_JSON = JSON.parse(fs.readFileSync(new URL('../../public/geo/plano_ndvi_contexto.json', import.meta.url), 'utf-8'));
const RELIEVE = fs.readFileSync(new URL('../../public/dem-distrito-hillshade/hillshade_srl_plano.jpg', import.meta.url));

const SEP = [0.202, 0.4257, 0.5189, 0.3292, 0.343, 0.503];
function filas(): FilaNdviInforme[] {
    const out: FilaNdviInforme[] = [];
    MODULOS_SRL_IDS.forEach((m, i) => {
        for (const a of [2024, 2025, 2026]) for (const mm of ['03', '04', '05', '06', '07', '08', '09']) {
            if (m === 12 && a === 2026 && mm === '09') continue; // un S/D en el mes de referencia
            out.push({ numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes: `${a}-${mm}`, ndvi_medio: Math.min(0.75, SEP[i] * (0.6 + Number(mm) / 20)), ndvi_desv: 0.08, kc_estimado: 0.3, delta_ndvi: null,
                superficie_ha: 5000 + 700 * i, fraccion_cobertura_activa: 0.5, ventana_desde: `${a}-${mm}-01`, ventana_hasta: `${a}-${mm}-28`, nubosidad_max_pct: 40, n_escenas: 5, pct_pixeles_validos: 0.9 });
        }
    });
    return out;
}
const ctx = (): ContextoInforme => ({ volumenPorModulo: new Map(), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 7, 14, 5), emisor: 'Prueba', version: '2.23.0' });
const datos = (): InformeNdvi => construirDatosNdvi(filas(), ctx(), { ...configPorDefecto(mesesDisponibles(filas())), indicadores: ['icv', 'ihr'] });
const contexto = (): ContextoPlano => armarContextoPlano(CTX_JSON, `data:image/jpeg;base64,${RELIEVE.toString('base64')}`) as ContextoPlano;

const tamanos = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));

describe('texto SVG ≥ 7.5 pt efectivos', () => {
    const d = datos();
    const c = contornosAAnillos(GEO);
    const vals = [0.2, 0.3, null, 0.4, 0.5, 0.45, 0.42];
    const pulso = { anios: [2024, 2025, 2026], anioFoco: 2026, series: [{ anio: 2024, vals }, { anio: 2025, vals }, { anio: 2026, vals }], clim: vals.map(() => ({ media: 0.3, p10: 0.2, p90: 0.4 })), titulo: 't' };
    const figuras: Record<string, string> = {
        plano: planoSvg(d.modulos, c, undefined, undefined, contexto()),
        planoSinContexto: planoSvg(d.modulos, c),
        serie: svgSerieModulos(d.meses, d.modulos, d.promedioPorMes),
        lineas: svgLineasSimples(d.meses, [{ etiqueta: 'M1', color: '#000', vals: d.modulos[0].serieNdvi, modulo: 1 }, { etiqueta: 'Otros', color: '#000', vals: d.modulos[1].serieNdvi }]),
        deltas: svgBarrasDelta([{ etiqueta: 'M1', valor: 0.05 }, { etiqueta: 'M2', valor: null }]),
        pareadas: svgBarrasPareadas([{ etiqueta: 'NDVI', a: 0.3, b: 0.4, max: 0.8, decimales: 2 }], 'M1', 'M2', '#333', '#aaa'),
        pendiente: svgPendienteSlope([{ etiqueta: 'M1', a: 0.2, b: 0.3 }], 'A', 'B'),
        pulso: svgPulso(pulso, { w: 700, h: 250 }),
        pulsoMini: svgPulso(pulso, { w: 320, h: 86, mini: true }),
        sparkline: svgSparkline([0.1, 0.2, 0.15, 0.3], 320, 70, ['2026-03', '2026-04', '2026-05', '2026-06']),
        rotulo: `<svg>${rotuloModuloSvg(12, 0, 0).svg}</svg>`,
    };
    for (const [nombre, svg] of Object.entries(figuras)) {
        it(`${nombre}: ningún texto por debajo de ${FS_MIN} unidades y dibujada a su ancho nominal (escala ≤ 1)`, () => {
            expect(svg.length).toBeGreaterThan(50);
            for (const s of tamanos(svg)) expect(s, nombre).toBeGreaterThanOrEqual(FS_MIN);
            const vb = /viewBox="0 0 ([\d.]+) [\d.]+"/.exec(svg);
            const mx = /max-width:([\d.]+)px/.exec(svg);
            if (vb && mx) expect(Number(mx[1])).toBe(Number(vb[1]));
        });
    }
    it('1 unidad = 1 px = 0.75 pt: el mínimo en unidades equivale a ≥ 7.5 pt', () => {
        expect(FS_MIN * 0.75).toBeGreaterThanOrEqual(7.5);
    });
    it('el HTML completo no declara ningún font-size de SVG menor al mínimo', () => {
        const html = construirHtmlNdvi(d, { srl: '', sica: '' }, figuras.plano, { contornos: c, conContexto: true });
        const svgs = [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((x) => x[0]);
        expect(svgs.length).toBeGreaterThan(20);
        for (const s of svgs) for (const t of tamanos(s)) expect(t).toBeGreaterThanOrEqual(FS_MIN);
    });
});

describe('color solo para el vigor; módulos por forma', () => {
    const d = datos();
    const c = contornosAAnillos(GEO);
    const html = construirHtmlNdvi(d, { srl: '', sica: '' }, planoSvg(d.modulos, c, undefined, undefined, contexto()), { contornos: c, conContexto: true });
    it('ningún color de identidad de módulo aparece en el documento', () => {
        for (const col of Object.values(COLOR_MODULO_SRL)) expect(html.toLowerCase(), col).not.toContain(col.toLowerCase());
    });
    it('el plano rellena cada módulo con el color DISCRETO de su clase (nunca interpolado) y S/D con el hachurado', () => {
        const plano = planoSvg(d.modulos, c);
        const rellenos = [...plano.matchAll(/ fill="([^"]+)" fill-opacity="\.86"/g)].map((x) => x[1]);
        expect(rellenos).toHaveLength(6);
        const permitidos = new Set([...CLASES_NDVI.map((x) => x.color), 'url(#plano-hach)']);
        for (const r of rellenos) expect(permitidos.has(r), r).toBe(true);
        expect(rellenos).toContain('url(#plano-hach)'); // M12 sin dato en septiembre
        expect(plano).not.toMatch(/rgb\(/);
    });
    it('seis módulos, seis formas distintas y seis trazos distintos', () => {
        const formas = MODULOS_SRL_IDS.map((n) => formaDeModulo(n));
        expect(new Set(formas).size).toBe(6);
        for (const f of formas) expect(NOMBRE_FORMA[f]).toBeTruthy();
        const dibujos = MODULOS_SRL_IDS.map((n) => marcadorModuloSvg(n, 10, 10, 5));
        expect(new Set(dibujos).size).toBe(6);
        expect(new Set(MODULOS_SRL_IDS.map((n) => TRAZO_MODULO[n])).size).toBe(6);
        for (const f of formas) expect(formaSvg(f, 0, 0, 5, '').length).toBeGreaterThan(20);
    });
    it('hay una sola leyenda de colores y formas, con la tinta marrón explicada y el año de interés en negro', () => {
        expect(html.match(/Cómo leer los colores y las formas/g) ?? []).toHaveLength(1);
        expect(html).toContain('Tinta marrón = valor del índice');
        expect(html).toContain('año de interés, negro grueso');
    });
    it('años previos: un solo matiz azul en pasos de luminosidad decreciente; el de interés es negro', () => {
        const l = [0, 1, 2, 3, 4].map((i) => grisPercibido(colorPrevioImpreso(i, 5)));
        for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
        const pulso = svgPulso({ anios: [2025, 2026], anioFoco: 2026, series: [{ anio: 2025, vals: [0.2, 0.3, 0.4, 0.4, 0.4, 0.3, 0.3] }, { anio: 2026, vals: [0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3] }], clim: [], titulo: 't' }, { w: 700, h: 250 });
        expect(pulso).toContain('stroke="#000000"');
        expect(pulso).not.toContain('#6B2D2D');
    });
    it('el delta usa flecha y texto, no color', () => {
        expect(html).toMatch(/[▲▼■] [+−]?\d/);
    });
    it('cifras alineadas (lining-nums) en todo el documento y celdas numéricas sin salto de línea', () => {
        expect(html).toContain('lining-nums');
        expect(html).toContain('td.n,th.n{white-space:nowrap}');
    });
});

describe('plano cartográfico', () => {
    const d = datos();
    const c = contornosAAnillos(GEO);
    it('con contexto lleva el relieve (<image> JPEG incrustado), el canal, el recorte y la escala de 4 segmentos; sin él, fondo liso', () => {
        const con = planoSvg(d.modulos, c, undefined, undefined, contexto());
        expect(con).toContain('<image href="data:image/jpeg;base64,');
        expect(con).toContain('stroke-dasharray="7 2.5"'); // canal Conchos
        expect(con).toContain('clip-path="url(#plano-clip)"');
        expect(con).not.toContain('mix-blend-mode');
        const seg = con.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="5" fill="(#fff|#1f2328)"/g) ?? [];
        expect(seg).toHaveLength(4);
        expect(con).toContain('aria-label="Norte"');
        expect(con).toMatch(/\d\.\d° O/);
        expect(con).toMatch(/\d\.\d° N/);
        const sin = planoSvg(d.modulos, c);
        expect(sin).not.toContain('<image');
        expect(sin).toContain('<rect x=');
    });
    it('el lienzo se ajusta a la forma de la SRL (alto proporcional al ancho, no un cuadro fijo) y el módulo sin dato queda hachurado', () => {
        const p = planoSvg(d.modulos, c, 470, 700, contexto());
        const [w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(p)!.slice(1).map(Number);
        expect(w).toBe(470);
        expect(h).toBeGreaterThan(520);
        expect(h).toBeLessThanOrEqual(700);
        expect(p).toContain('id="plano-hach"');
    });
    it('rótulos sin solape: seis píldoras con M# y NDVI y línea guía cuando se mueven', () => {
        const p = planoSvg(d.modulos, c, undefined, undefined, contexto());
        for (const n of MODULOS_SRL_IDS) expect(p).toContain(`>M${n}</text>`);
        expect(p).toContain('>S/D</text>');
        const cajas = [...p.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="20" rx="3"/g)].map((x) => ({ x: +x[1], y: +x[2], w: +x[3], h: 20 }));
        expect(cajas).toHaveLength(6);
        for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) {
            const sx = Math.min(cajas[i].x + cajas[i].w, cajas[j].x + cajas[j].w) - Math.max(cajas[i].x, cajas[j].x);
            const sy = Math.min(cajas[i].y + cajas[i].h, cajas[j].y + cajas[j].h) - Math.max(cajas[i].y, cajas[j].y);
            expect(sx > 0 && sy > 0, `rótulos ${i} y ${j} se pisan`).toBe(false);
        }
        expect(separarRotulos([{ x: 10, y: 10, w: 50, h: 20 }, { x: 12, y: 12, w: 50, h: 20 }], 200, 200)[0]).not.toEqual({ x: 10, y: 10 });
    });
    it('mini-plano de ficha: solo el módulo propio lleva el color de su clase; sin texto', () => {
        const mp = miniPlanoModuloSvg(3, d.modulos, c);
        expect(mp).toContain(CLASES_NDVI[3].color); // M3 = 0.52 → vigor alto
        expect(mp).not.toContain('<text');
        expect(miniPlanoModuloSvg(99, d.modulos, c)).toBe('');
    });
    it('peso del plano con relieve y contexto', () => {
        const p = planoSvg(d.modulos, c, undefined, undefined, contexto());
        expect(p.length).toBeLessThan(36 * 1024);
        expect(RELIEVE.length).toBeLessThan(40 * 1024);
    });
});

describe('vecinos del DR-005: trama propia, sin relleno de color ni gris plano', () => {
    const d = datos();
    const c = contornosAAnillos(GEO);
    it('el plano los dibuja con trama punteada + contorno discontinuo (no con un gris plano), distinta del hachurado S/D', () => {
        const p = planoSvg(d.modulos, c, undefined, undefined, contexto());
        expect(p).toContain('<pattern id="plano-vec"');
        expect(p).toContain('fill="url(#plano-vec)"');
        expect(p).toContain('stroke-dasharray="3 2.5"'); // contorno discontinuo claro
        expect(p).not.toContain('#8b9097'); // el gris plano anterior ya no existe
        const vec = (p.match(/<path d="[^"]*" fill="url\(#plano-vec\)"/g) ?? []).length;
        expect(vec).toBe(contexto().vecinos.length);
        // la trama de vecinos es de PUNTOS (circle) y la de S/D de franjas diagonales (line, rotate 45): no se parecen.
        const trama = /<pattern id="plano-vec"[^>]*>(.*?)<\/pattern>/.exec(p)?.[1] ?? '';
        expect(trama).toContain('<circle');
        expect(trama).not.toContain('<line');
        expect(trama).not.toContain('<rect'); // sin fondo de color: se ve el relieve
        expect(/<pattern id="plano-hach"[^>]*rotate\(45\)/.test(p)).toBe(true);
    });
    it('en escala de grises no se confunden: cobertura de tinta baja (relleno liso de cada clase = 100 %) y leyenda propia', () => {
        const { paso, punto } = TRAMA_VECINOS;
        const areaPunto = Math.PI * 1.25 ** 2; // halo (el punto oscuro mide 0.6 de radio)
        expect(areaPunto / (paso * paso)).toBeLessThan(0.35); // ≥ 65 % del vecino es el relieve visible, no un tono uniforme
        expect(punto).not.toBe(SD_TRAZO);
        const ley = leyendaSistemaVisual([{ numero: 1, nombre: 'M1' }], { indices: false, plano: { canal: true, vecinos: true, relieve: true } });
        expect(ley).toContain('otros módulos del DR-005 (trama punteada, sin dato)');
        expect(ley).toContain('class="vec"');
        expect(ley).not.toContain('class="gris"');
    });
    it('el mini-plano de la ficha también usa la trama (no un gris plano) para el resto de la SRL', () => {
        const mp = miniPlanoModuloSvg(1, d.modulos, c);
        expect(mp).toContain('fill="url(#mp-vec)"');
        expect(mp).not.toContain('#d7d6d1');
    });
});

describe('contraste y escala de grises', () => {
    it('Suelo desnudo vs Vigor bajo ya no se confunden en grises (ΔL* ≥ 12, razón ≥ 1.25) y su muestra lleva contorno propio', () => {
        expect(luminosidadL(CLASES_NDVI[0].color) - luminosidadL(CLASES_NDVI[1].color)).toBeGreaterThanOrEqual(12);
        expect(contraste(CLASES_NDVI[0].color, CLASES_NDVI[1].color)).toBeGreaterThanOrEqual(1.25);
        const ley = leyendaSistemaVisual([{ numero: 1, nombre: 'M1' }], { indices: false });
        expect(ley).toContain(`background:${CLASES_NDVI[0].color};border-color:${SUELO_CONTORNO}`);
    });
    it('la tinta marrón de ICV/IHR: texto ≥ 4.5:1 y pasos que se separan en grises', () => {
        const pasos = Array.from({ length: PASOS_TINTA }, (_, i) => colorPasoTinta(i));
        for (const p of pasos) expect(contraste(p.fondo, p.texto)).toBeGreaterThanOrEqual(4.5);
        for (let i = 1; i < pasos.length; i++) expect(grisPercibido(pasos[i - 1].fondo) - grisPercibido(pasos[i].fondo)).toBeGreaterThanOrEqual(15);
    });
    it('las clases de vigor se separan de su vecina al menos 18 niveles de gris', () => {
        const g = CLASES_NDVI.map((x) => grisPercibido(x.color));
        for (let i = 1; i < g.length; i++) expect(g[i - 1] - g[i]).toBeGreaterThanOrEqual(18);
    });
    it('las dos tintas de las líneas de módulo y el negro del promedio se distinguen entre sí', () => {
        expect(contraste('#1f2328', '#59616b')).toBeGreaterThan(2);
        expect(contraste('#000000', '#59616b')).toBeGreaterThan(3);
    });
});
