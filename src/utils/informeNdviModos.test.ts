import { describe, expect, it } from 'vitest';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme } from './informeNdviDatos';
import { construirHtmlNdvi } from './informeNdviHtml';
import { configPorDefecto, type ConfigInformeNdvi } from './informeNdviConfig';
import { CAUTELA_TITULAR } from './ndviGrafica';
import { esc } from './informeBase';
import { UMBRAL_SIN_CAMBIO } from './ndviInteranual';
import { svgBarrasDelta, svgBarrasPareadas, svgLineasSimples, svgPendienteSlope, signoDelta } from './informeNdviSvgComparativo';

const MESES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const MODS = [1, 2, 3, 4, 5, 12];
const SUP = [5000, 6000, 6500, 9000, 11000, 2500];
const ANIOS = [2021, 2022, 2023, 2024, 2025, 2026];
// Efecto del año: M2 sube 0.03 por año; M1 y M4 caen 0.06 en 2026; el resto sin efecto.
const efecto = (m: number, a: number) => (m === 2 ? 0.03 * (a - 2021) : (m === 1 || m === 4) && a === 2026 ? -0.06 : 0);
const MULTI: FilaNdviInforme[] = MODS.flatMap((m, i) => ANIOS.flatMap((a) => MESES.map((mes, k) => ({
    numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes: `${a}${mes.slice(4)}`, ndvi_medio: 0.2 + 0.05 * k + efecto(m, a) - (m === 4 || m === 1 ? 0.1 : 0), ndvi_desv: 0.08, kc_estimado: 0.3 + 0.05 * k,
    delta_ndvi: null, superficie_ha: SUP[i], fraccion_cobertura_activa: 0.6, n_escenas: 4, pct_pixeles_validos: 0.9,
    ventana_desde: `${a}${mes.slice(4)}-01`, ventana_hasta: k === 6 ? `${a}-10-01` : `${a}${mes.slice(4)}-28`, nubosidad_max_pct: 40,
}))));
const MESES_MULTI = [...new Set(MULTI.map((f) => f.mes))].sort();
const UN_ANIO = MULTI.filter((f) => f.mes.startsWith('2026'));
const ctx = (o: Partial<ContextoInforme> = {}): ContextoInforme => ({
    volumenPorModulo: new Map(MODS.map((m) => [m, 10])), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true,
    ahora: new Date(2026, 9, 7, 14, 5), emisor: 'Ing. Prueba', version: '2.23.0', ...o,
});
const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: '' };
const cfg = (meses = MESES_MULTI, o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(meses), ...o });
const html = (f: FilaNdviInforme[], c: ConfigInformeNdvi, x: Partial<ContextoInforme> = {}, plano = '<svg></svg>', extras = {}) => construirHtmlNdvi(construirDatosNdvi(f, ctx(x), c), LOGOS, plano, extras);
const limpio = (h: string) => expect(h).not.toMatch(/NaN|undefined|\bnull\b|\$\{/); // "${" = plantilla sin interpolar
const paginas = (h: string) => h.split('<section class="pagina">').slice(1);
const cuerpo = (h: string) => h.split('<body>')[1];

describe('estructura del documento integrado', () => {
    it('hoja 1 = resumen ejecutivo; luego situación, tendencia, comparación entre años, módulos y anexos en ese orden', () => {
        const h = html(MULTI, cfg());
        const orden = ['Resumen ejecutivo', 'Situación del periodo', 'Tendencia — marzo 2026 a septiembre 2026 frente a lo habitual', 'Tendencia — año tras año y contraste', 'Comparación entre años', 'Módulo por módulo —', 'Anexo A — Serie histórica', 'Anexo B — Superficie regada y volumen entregado por año', 'Anexo C — Metodología', 'Anexo D — Trazabilidad']
            .map((t) => h.indexOf(t));
        // sin superficie y volumen cargados el anexo B existe pero sale S/D: el orden es creciente
        orden.forEach((i, k) => expect(i, `bloque ${k}`).toBeGreaterThan(k === 0 ? -1 : orden[k - 1]));
        expect(paginas(h)[0]).toContain('Resumen ejecutivo');
        limpio(h);
    });
    it('numeración de secciones consecutiva y anexos con letras', () => {
        const h = html(MULTI, cfg());
        const nums = [...h.matchAll(/<h2[^>]*><span class="n">(\d+)<\/span>/g)].map((m) => Number(m[1]));
        expect(nums).toEqual(nums.map((_, i) => i + 1));
        expect(h).toContain('Anexo A —');
    });
    it('el alcance quita secciones: solo resumen = una hoja; sin tendencia no hay tablas de tendencia', () => {
        const solo = html(MULTI, cfg(MESES_MULTI, { secciones: ['resumen'] }));
        expect(paginas(solo)).toHaveLength(1);
        expect(solo).toContain('Pág. 1 de 1');
        expect(solo).not.toContain('Frente a lo habitual (mismos meses');
        expect(solo).toContain('Hallazgos');
    });
    it('un solo año de serie: la comparación entre años lo dice y la tendencia queda insuficiente, sin inventar', () => {
        const h = html(UN_ANIO, cfg(MESES, { desde: '2026-03', hasta: '2026-09' }));
        expect(h).toContain('hacen falta al menos dos años');
        expect(h).toContain('Insuficiente');
        expect(h).not.toContain('Sube año tras año');
        limpio(h);
    });
});

describe('resumen ejecutivo (hoja 1)', () => {
    const h1 = (f = MULTI, c = cfg()) => paginas(html(f, c))[0];
    it('titular real del periodo con su cautela pegada, no el mensaje de septiembre', () => {
        const p = h1();
        expect(p).toMatch(/Periodo marzo 2026 a septiembre 2026 frente a lo habitual: 2 por debajo, 1 por encima y 3 en línea \(de 6 módulos\)/);
        const i = p.indexOf('frente a lo habitual'), j = p.indexOf(esc(CAUTELA_TITULAR));
        expect(i).toBeGreaterThan(-1);
        expect(j).toBeGreaterThan(i);
        expect(j - i).toBeLessThan(300); // pegada a la afirmación
        expect(p).toContain('class="aviso cautela"');
    });
    it('la cautela acompaña al titular también cuando solo se pide el resumen', () => {
        expect(html(MULTI, cfg(MESES_MULTI, { secciones: ['resumen'] }))).toContain(esc(CAUTELA_TITULAR));
    });
    it('3 a 5 hallazgos con cifra, estado por clase de vigor y qué revisar con criterio explícito y sin causas', () => {
        const p = h1();
        const lis = (p.match(/<ol class="hallazgos">([\s\S]*?)<\/ol>/) ?? [])[1].match(/<li>/g) ?? [];
        expect(lis.length).toBeGreaterThanOrEqual(3);
        expect(lis.length).toBeLessThanOrEqual(5);
        expect(p).toMatch(/Estado del distrito por clase de vigor/);
        expect(p).toMatch(/M1 y M4:<\/b> por debajo de lo habitual/);
        expect(p).toContain(`bajo 0.30`);
        expect(p).toContain(`${UMBRAL_SIN_CAMBIO.toFixed(2)} o más por debajo de lo habitual`);
        expect(p).not.toMatch(/porque|debido a|a causa de|se debe/i);
    });
    it('"qué revisar": vigor bajo y por debajo de lo habitual se agrupa y se prioriza; sin dato también se marca', () => {
        const bajo = MULTI.map((f) => (f.mes === '2026-09' && (f.numero_modulo === 4 || f.numero_modulo === 5) ? { ...f, ndvi_medio: 0.24 } : f))
            .filter((f) => !(f.numero_modulo === 12 && f.mes === '2026-09'));
        const p = h1(bajo);
        expect(p).toMatch(/M4 y M5:<\/b> vigor bajo y por debajo de lo habitual/);
        expect(p).toMatch(/M12:<\/b> Sin dato en septiembre 2026/);
        expect(p.indexOf('M4 y M5')).toBeLessThan(p.indexOf('M12:'));
        expect(p).not.toMatch(/porque|debido a|a causa de|se debe/i);
    });
    it('rotula la definición única de "NDVI de la SRL" y respeta la base elegida en el titular', () => {
        expect(h1()).toContain('NDVI de la SRL = promedio simple de 6 módulos');
        const pond = h1(MULTI, cfg(MESES_MULTI, { basePromedio: 'ponderado' }));
        expect(pond).toContain('ponderado por la superficie de su polígono');
        expect(pond).toContain('promedio SRL ponderado por superficie');
    });
    it('terminología: "Módulos con dato" (n de 6) y "cobertura" solo para cobertura activa', () => {
        const p = h1();
        expect(p).toContain('Módulos con dato');
        expect(p).not.toMatch(/Cobertura<\/b>/);
    });
    it('lining-nums en TODO el documento (el atajo font: reinicia la propiedad, por eso la regla es universal)', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain('*{font-variant-numeric:lining-nums!important}');
        // las reglas con font: de frases, KPI y títulos existen: sin !important perderían los numerales de línea
        expect(h).toMatch(/\.frase\{font:/);
        expect(h).toMatch(/\.kpi \.v\{font:/);
    });
});

describe('tendencia y contraste', () => {
    it('anomalía contra lo habitual + año tras año + conciliación de cifras de la SRL, sin pendiente intra-ciclo', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain('Frente a lo habitual (mismos meses');
        expect(h).toContain('Año tras año');
        expect(h).toContain('Conciliación de cifras del NDVI de la SRL');
        expect(h).toContain('Mes de referencia (septiembre 2026)');
        expect(h).toContain('Habitual (mismos meses, otros años)');
        expect(h).toContain('Pico medio 2026');
        expect(h).toContain('Por debajo de lo habitual'); // M1 y M4
        expect(h).toContain('Sube año tras año'); // M2
        expect(h).not.toContain('Pendiente (NDVI/mes)');
        expect(h).toContain('referencia de 5 años');
        limpio(h);
    });
    it('contraste: B − A contra el mismo periodo del año anterior, con vs habitual y sin "mejora"', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain('Contraste contra el mismo periodo de 2025');
        expect(h).toContain('diferencia B − A');
        expect(h).toContain('A vs habitual');
        expect(h).toContain('no es estacional');
        expect(h).not.toContain('Mayor mejora');
        expect(h).not.toContain('estacional (el NDVI sube');
    });
    it('sin contraste pedido o sin datos del año de contraste se dice, sin hueco', () => {
        expect(html(MULTI, cfg(MESES_MULTI, { contraste: 'ninguno' }))).toContain('No se pidió contraste contra otro año');
        const sin = MULTI.filter((f) => !f.mes.startsWith('2025'));
        expect(html(sin, cfg(MESES_MULTI.filter((m) => !m.startsWith('2025')))).includes('Contraste contra el mismo periodo de 2025')).toBe(false);
    });
    it('un mes con pocas escenas limpias se marca de baja confianza y en el resumen', () => {
        const poco = MULTI.map((f) => (f.numero_modulo === 1 && f.mes === '2026-06' ? { ...f, n_escenas: 1 } : f));
        const h = html(poco, cfg());
        expect(h).toContain('Baja ⚠');
        expect(h).toContain('pocas observaciones');
    });
    it('aviso de estacionalidad solo cuando aplica: el contraste por defecto nunca lo emite', () => {
        const h = html(MULTI, cfg());
        expect(h).not.toMatch(/parte de la diferencia es estacional/);
    });
});

describe('comparación entre módulos (opcional)', () => {
    it('módulo contra módulo y módulo contra el promedio de los demás, con lectura contra lo habitual', () => {
        const hm = html(MULTI, cfg(MESES_MULTI, { compModulos: { tipo: 'modulos', moduloA: 1, moduloB: 2 } }));
        expect(hm).toContain('Comparación — Módulo 1 contra Módulo 2');
        expect(hm).toContain('Contra lo habitual de sus mismos meses');
        limpio(hm);
        const hs = html(MULTI, cfg(MESES_MULTI, { compModulos: { tipo: 'vsSRL', moduloA: 3, moduloB: 2 } }));
        expect(hs).toContain('contra el promedio de los demás');
        expect(hs).toContain('5 de 5');
        limpio(hs);
    });
    it('sin comparación configurada no existe la hoja', () => {
        expect(html(MULTI, cfg())).not.toContain('Comparación — Módulo');
    });
});

describe('módulo por módulo, IHR en piso y notas de indicadores', () => {
    it('IHR = 0 se explica como piso del índice, se marca y no entra al promedio', () => {
        const piso = MULTI.map((f) => (f.numero_modulo === 4 && f.mes === '2026-09' ? { ...f, ndvi_medio: 0.2, ndvi_desv: 0.3 } : f));
        const d = construirDatosNdvi(piso, ctx(), cfg(MESES_MULTI, { indicadores: ['ihr'] }));
        expect(d.modulos.find((m) => m.numero === 4)?.ihrEnPiso).toBe(true);
        expect(d.nIhrEnPiso).toBe(1);
        const h = construirHtmlNdvi(d, LOGOS, '');
        expect(h).toContain('0 (piso)');
        expect(h).toContain('no indica riego heterogéneo');
        expect(h).toContain('100×(1 − desviación/mediana)');
        expect(h).not.toContain('desviación/media)');
    });
    it('Kc: aviso de frontera, y Kc/ICV declarados como transformaciones lineales; IEH/ISH ya no aparecen', () => {
        const h = html(MULTI, cfg(MESES_MULTI, { indicadores: ['kc', 'icv', 'ihr', 'iehp'] }));
        expect(h).toContain('Kc de la frontera del módulo: no usar para programar riego');
        expect(h).toContain('transformaciones lineales del NDVI');
        expect(h).not.toMatch(/IEH e ISH/);
    });
    it('superficie del polígono y superficie regada (ACUM_INF) rotuladas por separado', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain('Superficie del módulo (polígono)');
        expect(h).toContain('Superficie regada (informe ACUM_INF)');
    });
});

describe('folio y nombre de archivo distinguen configuraciones', () => {
    it('misma configuración en el mismo minuto: mismo folio y mismo nombre; con y sin imagen / relieve: distintos', () => {
        const a = construirDatosNdvi(MULTI, ctx(), cfg()), b = construirDatosNdvi(MULTI, ctx(), cfg());
        expect(b.folio).toBe(a.folio);
        expect(b.traza.nombreArchivo).toBe(a.traza.nombreArchivo);
        const conImagen = construirDatosNdvi(MULTI, ctx(), cfg(MESES_MULTI, { imagenSatelital: true }));
        const sinRelieve = construirDatosNdvi(MULTI, ctx(), cfg(MESES_MULTI, { mapaRelieve: false }));
        for (const otro of [conImagen, sinRelieve]) {
            expect(otro.folio).not.toBe(a.folio);
            expect(otro.traza.nombreArchivo).not.toBe(a.traza.nombreArchivo);
            expect(otro.folio).toMatch(/^NDVI-2026-03A09-COMPLETO-[0-9A-F]{6}-20261007-1405$/); // sigue siendo un folio con partes
        }
        expect(conImagen.folio).not.toBe(sinRelieve.folio);
    });
});

describe('anexos, trazabilidad y errores visibles', () => {
    it('trazabilidad: folio con periodo y alcance, datos al, método, plantilla, hash y firmas', () => {
        const h = html(MULTI, cfg());
        const d = construirDatosNdvi(MULTI, ctx(), cfg());
        const v = d.traza.hashConfig.slice(0, 6);
        expect(d.folio).toBe(`NDVI-2026-03A09-COMPLETO-${v.toUpperCase()}-20261007-1405`);
        expect(d.traza.nombreArchivo).toBe(`informe-ndvi-conchos-2026-03a09-completo-${v}-2026-10-07.html`);
        expect(d.traza.corteDatos).toBe('2026-09-30');
        expect(h).toContain('30 de septiembre de 2026');
        expect(h).toContain('scl-mediana-v1');
        expect(h).toContain('ndvi-integrado-1');
        expect(h).toContain(d.traza.hashConfig);
        for (const r of ['Elaboró', 'Revisó', 'Autorizó']) expect(h).toContain(r);
        expect(html(MULTI, cfg(MESES_MULTI, { firmas: false }))).not.toContain('Autorizó');
    });
    it('el hash cambia con la configuración y no con el emisor', () => {
        const a = construirDatosNdvi(MULTI, ctx(), cfg()).traza.hashConfig;
        expect(construirDatosNdvi(MULTI, ctx({ emisor: 'Otra persona' }), cfg()).traza.hashConfig).toBe(a);
        expect(construirDatosNdvi(MULTI, ctx(), cfg(MESES_MULTI, { basePromedio: 'ponderado' })).traza.hashConfig).not.toBe(a);
    });
    it('fechas legibles: ni ISO crudo en el cuerpo y la ventana termina el último día del mes', () => {
        const h = html(MULTI, cfg());
        expect(cuerpo(h)).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
        expect(h).toMatch(/del 1 de septiembre de 2026 al 30 de septiembre de 2026/);
    });
    it('"mes en curso" solo cuando aplica', () => {
        expect(html(MULTI, cfg())).not.toContain('es el mes en curso');
        const h = html(MULTI, cfg(), { ahora: new Date(2026, 8, 20, 10, 0) });
        expect(h).toContain('septiembre 2026 es el mes en curso');
        expect(h).toContain('El mes de referencia es el mes en curso');
    });
    it('umbrales y R² salen de constantes, no escritos a mano', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain(`menor a ${UMBRAL_SIN_CAMBIO.toFixed(2)}`);
        expect(h).toContain('límites 0.15 / 0.30 / 0.50 / 0.70');
        expect(h).toMatch(/R² crítico al 5 % \(≈ 0\.\d\d con 6 años\)/);
    });
    it('errores de consulta visibles en la calidad del dato y en la trazabilidad', () => {
        const h = html(MULTI, cfg(MESES_MULTI, { indicadores: ['iehp'] }), {
            volumenPorModulo: new Map(), volumenConError: true,
            erroresConsulta: [{ fuente: 'el volumen entregado', mensaje: 'permiso denegado', consecuencia: 'el IEHP aparece como S/D.' }],
        });
        expect(h).toContain('No se pudo consultar el volumen entregado (permiso denegado)');
        expect(h).toMatch(/Consultas fallidas<\/th><td>el volumen entregado \(permiso denegado\)/);
    });
    it('anexo de superficie y volumen: solo con más de un año; sin informe cargado, S/D con aviso', () => {
        const con = html(MULTI, cfg());
        expect(con).toContain('Superficie regada (informe ACUM_INF, ha)');
        expect(con).toContain('Sin informe de superficie y volumen');
        const uno = html(UN_ANIO, cfg(MESES, { secciones: ['resumen', 'anexoSupVol', 'metodologia'] }));
        expect(uno).not.toContain('Superficie regada (informe ACUM_INF, ha)');
        expect(uno).toContain('El anexo de superficie y volumen se omitió');
    });
    it('imagen satelital: se ubica donde corresponde; pedida y no disponible deja un aviso visible, nunca un hueco', () => {
        const c = cfg(MESES_MULTI, { imagenSatelital: true });
        expect(html(MULTI, c, {}, '<svg></svg>', { imagenes: '<div id="imgs">IMAGENES</div>' })).toContain('<div id="imgs">IMAGENES</div>');
        expect(html(MULTI, c)).toContain('Imagen satelital no disponible');
        expect(html(MULTI, cfg())).not.toContain('Imagen satelital no disponible');
    });
});

describe('peso del documento', () => {
    it('sin imagen satelital ni plano y con logos optimizados queda por debajo de 108 KB (100 KB + la leyenda única de colores y formas, las marcas de módulo y su CSS)', () => {
        const logoSrl = `data:image/jpeg;base64,${'A'.repeat(7700)}`, logoSica = `data:image/png;base64,${'B'.repeat(4800)}`;
        const h = construirHtmlNdvi(construirDatosNdvi(MULTI, ctx(), cfg()), { srl: logoSrl, sica: logoSica }, '');
        expect(h.length).toBeLessThan(108 * 1024);
    });
});

describe('gráficos comparativos', () => {
    it('slope chart, barras de diferencia, líneas y barras pareadas devuelven SVG; sin datos, vacío', () => {
        expect(svgPendienteSlope([{ etiqueta: 'M1', a: 0.2, b: 0.4 }, { etiqueta: 'M2', a: 0.3, b: 0.2 }], 'A', 'B')).toContain('<svg');
        expect(svgPendienteSlope([{ etiqueta: 'M1', a: null, b: null }], 'A', 'B')).toBe('');
        expect(svgBarrasDelta([{ etiqueta: 'a', valor: 0.1 }, { etiqueta: 'b', valor: -0.05 }, { etiqueta: 'c', valor: null }])).toContain('S/D');
        expect(svgBarrasDelta([{ etiqueta: 'a', valor: null }])).toBe('');
        expect(svgLineasSimples(MESES, [{ etiqueta: 'x', color: '#000', vals: [0.1, null, 0.3, 0.4, 0.5, 0.6, 0.7] }])).toContain('<svg');
        expect(svgLineasSimples([], [])).toBe('');
        expect(svgBarrasPareadas([{ etiqueta: 'NDVI', a: 0.3, b: null, max: 0.8, decimales: 2 }], 'M1', 'M2', '#00f', '#0f0')).toContain('S/D');
    });
    it('S/D es hueco: la línea se corta (dos trazos), nunca baja a 0; un eje largo se rotula espaciado', () => {
        const svg = svgLineasSimples(MESES, [{ etiqueta: 'x', color: '#000', vals: [0.2, 0.3, null, 0.5, 0.6, 0.7, 0.8] }]);
        expect((svg.match(/<path /g) ?? []).length).toBe(1);
        expect((svg.match(/ M/g) ?? []).length).toBe(1); // segundo tramo empieza con otro "M": no hay línea que cruce el hueco
        const largo = Array.from({ length: 36 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
        const sv = svgLineasSimples(largo, [{ etiqueta: 'x', color: '#000', vals: largo.map(() => 0.4) }]);
        expect((sv.match(/text-anchor="middle"/g) ?? []).length).toBeLessThan(largo.length / 2);
        expect(svgLineasSimples(['2021', '2022'], [{ etiqueta: 'x', color: '#000', vals: [0.2, 0.3] }], 620, 190, ['A', 'B'])).toContain('>B<');
    });
    it('signoDelta usa flechas y trata 0 como ■', () => {
        expect(signoDelta(0.054, 3)).toBe('▲ +0.054');
        expect(signoDelta(-0.136, 3)).toBe('▼ −0.136');
        expect(signoDelta(0.0001, 3)).toBe('■ 0.000');
    });
});

describe('maquetación para impresión (auditoría Playwright del informe integrado)', () => {
    it('encabezados de las tablas compactas: mes sin año si el periodo es de un solo año, con año si cruza de año', () => {
        const mismo = html(MULTI, cfg(MESES_MULTI, { indicadores: ['icv', 'ihr'] }));
        expect(mismo).toMatch(/ICV mensual[\s\S]*?<th class="n">mar<\/th>/);
        expect(mismo).not.toMatch(/ICV mensual[\s\S]{0,300}?<th class="n">mar 2026<\/th>/);
        const cruza = html(MULTI, cfg(MESES_MULTI, { indicadores: ['icv'], preset: 'personalizado', desde: '2025-09', hasta: '2026-03' }));
        expect(cruza).toMatch(/ICV mensual[\s\S]*?<th class="n">sep 2025<\/th>/);
        // La tabla de NDVI (no compacta) conserva el año siempre.
        expect(mismo).toMatch(/NDVI mensual por módulo[\s\S]*?<th class="n">mar 2026<\/th>/);
    });
    it('ICV e IHR van de a dos solo si caben (hasta 7 meses); con un periodo largo se apilan', () => {
        expect(html(MULTI, cfg(MESES_MULTI, { indicadores: ['icv', 'ihr'] }))).toContain('<div class="pares">');
        const largo = html(MULTI, cfg(MESES_MULTI, { indicadores: ['icv', 'ihr'], preset: 'personalizado', desde: '2025-03', hasta: '2026-09' }));
        expect(largo).toContain('<div class="pares una">');
    });
    it('la metodología fluye en columnas continuas (Definiciones no deja las otras dos columnas vacías)', () => {
        expect(html(MULTI, cfg(MESES_MULTI, { indicadores: ['kc', 'icv', 'ihr', 'iehp'] }))).toContain('<div class="cols3 met">');
    });
    it('texto mínimo del documento: los encabezados de tablas compactas no bajan de 7.5 pt', () => {
        const h = html(MULTI, cfg());
        expect(h).toContain('table.compacta th{padding:3px 5px;font-size:7.5pt}');
        expect(h).not.toMatch(/font-size:7pt/);
    });
});
