import { describe, expect, it } from 'vitest';
import { construirDatosNdvi, promedioPonderado, promedioSimple, type ContextoInforme, type FilaNdviInforme } from './informeNdviDatos';
import { construirHtmlNdvi } from './informeNdviHtml';
import { contornosAAnillos, planoSvg, svgSerieModulos, svgSparkline } from './informeNdviSvg';
import { folioInforme, mesLegible, nombreArchivo } from './informeBase';
import { CLASES_NDVI } from './ndviRampa';
import { KC_MAX, KC_MIN, ndviAKc } from './kcConstantes';

const MODULOS = [1, 2, 3, 4, 5, 12];
const SEP = [0.202, 0.4257, 0.5189, 0.3292, 0.343, 0.503];
const AGO = [0.3378, 0.3717, 0.4669, 0.2942, 0.325, 0.467];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];

function filas(opciones: { sinModuloEnSep?: number; nombre?: string } = {}): FilaNdviInforme[] {
    const out: FilaNdviInforme[] = [];
    MODULOS.forEach((m, i) => {
        for (const [mes, vals] of [['2026-08', AGO], ['2026-09', SEP]] as const) {
            if (mes === '2026-09' && opciones.sinModuloEnSep === m) continue;
            out.push({
                numero_modulo: m, nombre_modulo: opciones.nombre && m === 1 ? opciones.nombre : `Módulo ${m}`, mes, ndvi_medio: vals[i],
                ndvi_desv: 0.08, kc_estimado: 0.15 + 1.1 * vals[i], delta_ndvi: mes === '2026-09' ? vals[i] - AGO[i] : null,
                superficie_ha: SUP[i], fraccion_cobertura_activa: 0.6, ventana_desde: `${mes}-01`, ventana_hasta: '2026-10-01', nubosidad_max_pct: 40,
            });
        }
    });
    return out;
}

const ctx = (o: Partial<ContextoInforme> = {}): ContextoInforme => ({
    volumenPorModulo: new Map(MODULOS.map((m) => [m, 10 + m])), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true,
    ahora: new Date(2026, 9, 7, 14, 5), emisor: 'Ing. Prueba', version: '2.23.0', ...o,
});

describe('modelo de datos del informe NDVI', () => {
    it('mes de referencia, promedio simple (0.387) y tendencia contra el mes anterior', () => {
        const d = construirDatosNdvi(filas(), ctx());
        expect(d.mesReferencia).toBe('2026-09');
        expect(d.mesAnterior).toBe('2026-08');
        expect(d.promedioSimple).toBeCloseTo(0.387, 3);
        expect(d.tendencia).toBeCloseTo(promedioSimple(SEP)! - promedioSimple(AGO)!, 6);
        expect(d.folio).toBe('NDVI-20261007-1405');
    });
    it('promedio ponderado por superficie distinto del simple', () => {
        const d = construirDatosNdvi(filas(), ctx());
        const esperado = SEP.reduce((s, v, i) => s + v * SUP[i], 0) / SUP.reduce((a, b) => a + b, 0);
        expect(d.promedioPonderado).toBeCloseTo(esperado, 6);
        expect(d.promedioPonderado).not.toBeCloseTo(d.promedioSimple!, 3);
        expect(promedioPonderado([{ valor: null, peso: 5 }, { valor: 1, peso: null }])).toBeNull();
    });
    it('módulo sin fila del mes de referencia → S/D con aviso, NUNCA el dato de un mes anterior', () => {
        const d = construirDatosNdvi(filas({ sinModuloEnSep: 12 }), ctx());
        const m12 = d.modulos.find((m) => m.numero === 12)!;
        expect(m12.tieneDatoDelMes).toBe(false);
        expect(m12.ndvi).toBeNull();
        expect(m12.clase).toBeNull();
        expect(d.avisos.some((a) => a.nivel === 'warn' && /Módulo 12/.test(a.texto))).toBe(true);
        expect(d.promedioSimple).toBeCloseTo(promedioSimple(SEP.slice(0, 5))!, 6);
        // la serie histórica sí conserva su agosto
        expect(m12.serieNdvi).toEqual([0.467, null]);
    });
    it('mejor y peor módulo; distribución por clase', () => {
        const d = construirDatosNdvi(filas(), ctx());
        expect(d.mejor?.numero).toBe(3);
        expect(d.peor?.numero).toBe(1);
        const total = d.distribucion.reduce((s, x) => s + x.modulos.length, 0);
        expect(total).toBe(6);
        expect(d.distribucion.find((x) => x.clase.clave === 'bajo')?.modulos).toEqual([1]);
    });
    it('avisos de calidad: logo, contornos, volumen y mes parcial', () => {
        const d = construirDatosNdvi(filas(), ctx({ logoSrlOk: false, contornosDisponibles: false, volumenPorModulo: new Map(), volumenConError: true, volumenMesParcial: true }));
        const t = d.avisos.map((a) => a.texto).join(' | ');
        expect(t).toMatch(/logotipo/); expect(t).toMatch(/contornos/); expect(t).toMatch(/volumen entregado/); expect(t).toMatch(/parcial/);
        expect(d.modulos.every((m) => m.iehp == null)).toBe(true);
    });
    it('sin filas: no inventa cifras', () => {
        const d = construirDatosNdvi([], ctx());
        expect(d.mesReferencia).toBeNull();
        expect(d.promedioSimple).toBeNull();
        expect(d.modulos.every((m) => m.ndvi == null && !m.tieneDatoDelMes)).toBe(true);
    });
});

const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: 'data:image/png;base64,BBBB' };
const CONTORNO: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [1, 4, 2, 6, 5, 9].map((n, i) => ({
        type: 'Feature', properties: { numero_modulo: n },
        geometry: { type: 'Polygon', coordinates: [[[-105.5 + i * 0.05, 28], [-105.46 + i * 0.05, 28], [-105.46 + i * 0.05, 28.04], [-105.5 + i * 0.05, 28.04], [-105.5 + i * 0.05, 28]]] },
    })),
};

describe('HTML del informe NDVI', () => {
    const armar = (f = filas(), c = ctx(), logos = LOGOS, conPlano = true) => {
        const d = construirDatosNdvi(f, c);
        const plano = conPlano ? planoSvg(d.modulos, contornosAAnillos(CONTORNO)) : '';
        return construirHtmlNdvi(d, logos, plano);
    };
    it('documento completo de 7 páginas con folio y numeración', () => {
        const h = armar();
        expect((h.match(/class="pagina/g) ?? []).length).toBe(7);
        expect(h).toContain('NDVI-20261007-1405');
        expect(h).toContain('Pág. 7 de 7');
        expect(h).toContain('@page{size:letter');
        expect(h).toContain('print-color-adjust');
        expect(h).toContain('S R L');
        expect(h).toContain('#6B2D2D');
    });
    it('sin NaN / undefined / null en el texto', () => {
        for (const h of [armar(), armar(filas({ sinModuloEnSep: 12 })), armar([], ctx())]) {
            expect(h).not.toMatch(/NaN|undefined|\bnull\b/);
        }
    });
    it('S/D visible cuando falta el dato; nunca 0.00 por omisión', () => {
        const h = armar(filas({ sinModuloEnSep: 12 }));
        expect(h).toContain('S/D');
        expect(h).toContain('Sin dato en septiembre 2026');
    });
    it('usa la rampa agronómica de la UI y no el semáforo antiguo ni rojo/verde en el delta', () => {
        const h = armar();
        for (const c of CLASES_NDVI.filter((x) => ['bajo', 'medio', 'alto'].includes(x.clave))) expect(h).toContain(c.color);
        expect(h).not.toMatch(/#d03b3b|#16a34a|#dc2626/i);
        expect(h).toMatch(/▲|▼/);
    });
    it('escapa los nombres de módulo (sin inyección de HTML)', () => {
        const h = armar(filas({ nombre: '<script>alert(1)</script>' }));
        expect(h).not.toContain('<script>alert(1)</script>');
        expect(h).toContain('&lt;script&gt;');
    });
    it('sin logo conserva la marca en texto; sin plano muestra un aviso visible', () => {
        const h = armar(filas(), ctx({ logoSrlOk: false }), { srl: '', sica: '' }, false);
        expect(h).not.toContain('<img');
        expect(h).toContain('S R L');
        expect(h).toContain('Plano no disponible');
    });
    it('rotula el promedio como simple y muestra el ponderado aparte', () => {
        const h = armar();
        expect(h).toContain('Promedio SRL (simple)');
        expect(h).toContain('Ponderado por superficie');
    });
    it('los parámetros de la metodología salen de las constantes reales', () => {
        const h = armar();
        expect(h).toMatch(/piso 0\.10/); expect(h).toMatch(/techo 0\.75/); expect(h).toMatch(/NDVI ≥ 0\.30/);
    });
});

describe('SVG del informe', () => {
    it('plano: un polígono por módulo con contorno, norte y escala; vacío sin contornos', () => {
        const d = construirDatosNdvi(filas(), ctx());
        const svg = planoSvg(d.modulos, contornosAAnillos(CONTORNO));
        expect((svg.match(/<path d="M/g) ?? []).length).toBeGreaterThanOrEqual(6);
        expect(svg).toContain('aria-label="Norte"');
        expect(svg).toMatch(/\d+ km/);
        expect(planoSvg(d.modulos, {})).toBe('');
    });
    it('sparkline y serie: sin serie devuelve texto, con serie devuelve SVG', () => {
        expect(svgSparkline([null, null])).toContain('sin serie');
        expect(svgSparkline([0.2, 0.3, null, 0.4])).toContain('<svg');
        const d = construirDatosNdvi(filas(), ctx());
        expect(svgSerieModulos(d.meses, d.modulos, d.promedioPorMes)).toContain('<svg');
        expect(svgSerieModulos([], d.modulos, [])).toBe('');
    });
});

describe('kcConstantes (misma fórmula que la edge function sentinel-ndvi-modulo-sync)', () => {
    it('valores de referencia y acotado', () => {
        expect(ndviAKc(0.202)).toBe(0.37);   // M1 sep-2026, el Kc que muestra la tarjeta
        expect(ndviAKc(0)).toBe(KC_MIN);
        expect(ndviAKc(2)).toBe(KC_MAX);
        expect(ndviAKc(0.6)).toBe(0.81);
    });
    it('la metodología del informe imprime la fórmula desde las constantes', () => {
        const d = construirDatosNdvi(filas(), ctx());
        expect(construirHtmlNdvi(d, LOGOS, '')).toMatch(/0\.15 \+ 1\.10·NDVI, acotado a 0\.15–1\.05/);
    });
});

describe('informeBase', () => {
    it('folio, nombre de archivo y mes legible', () => {
        const f = new Date(2026, 0, 5, 9, 7);
        expect(folioInforme('NDVI', f)).toBe('NDVI-20260105-0907');
        expect(nombreArchivo('informe-x', f)).toBe('informe-x-2026-01-05.html');
        expect(mesLegible('2026-09')).toBe('septiembre 2026');
        expect(mesLegible('2026-09-01', true)).toBe('sep 2026');
        expect(mesLegible(null)).toBe('S/D');
    });
});
