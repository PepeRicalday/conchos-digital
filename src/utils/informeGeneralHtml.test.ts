import { describe, expect, it } from 'vitest';
import { construirHtmlInformeGeneral, HOJAS_INFORME_GENERAL, nombreArchivoInformeGeneral, type EntradaInformeGeneral } from './informeGeneralHtml';
import type { ModeloKpis } from '../components/dashboard/PanelKpis';
import type { EscalaCanalKpi } from './perfilCanal';

const LOGOS = { srl: 'data:image/png;base64,AAAA', sica: 'data:image/png;base64,BBBB' };
const sd = { tipo: 'sd' as const, texto: 'S/D' };

const escala = (i: number, p: Partial<EscalaCanalKpi> = {}): EscalaCanalKpi => ({
    id: `E${i}`, nombre: `K-${i * 8}`, km: i * 8, referencia: false, nivelM: null, nivelArrastreM: null, rangoMin: 1, rangoMax: 3, u: null,
    estado: 'sd', origen: 'sin_dato', medicionMs: null, edadMin: null, vigente: false, gastoM3s: null, ...p,
});

function modelo(conDatos: boolean): ModeloKpis {
    const escalas = [0, 1, 2, 3].map((i) => (conDatos && i < 2
        ? escala(i, { nivelM: 2.1, u: 0.55, estado: 'en_rango', origen: 'campo', medicionMs: 1, edadMin: 30, vigente: true, gastoM3s: 20 - i })
        : escala(i)));
    return {
        enVivoFuera: false,
        presas: { pct: conDatos ? 30.9 : null, estado: conDatos ? { tipo: 'warn', texto: 'Bajo' } : sd, almacenadoMm3: conDatos ? 981 : null, capacidadMm3: 3180, conDato: conDatos ? 2 : 0, total: 2,
            serie: conDatos ? [900, 920, 940, 950, 960, 970, 981] : [null, null, null, null, null, null, null],
            items: [{ nombre: 'Boquilla', pct: conDatos ? 28 : null, capacidadMm3: 2900, alerta: false }, { nombre: 'Madero', pct: conDatos ? 53 : null, capacidadMm3: 280, alerta: false }],
            tendencia: { dir: 'sd', texto: 'Sin tendencia' }, frescura: null, stale: false },
        suficiencia: {
            modo: 'preciclo', estado: conDatos ? { tipo: 'ok', texto: 'Suficiente' } : sd, utilTotalMm3: conDatos ? 849 : null, almacenadoTotalMm3: conDatos ? 981 : null, muertoTotalMm3: conDatos ? 132 : null,
            presas: [
                { id: 'PRE-001', nombre: 'Boquilla', almacenadoMm3: conDatos ? 708 : null, capacidadMm3: 2900, muertoMm3: conDatos ? 95.9 : null, muertoOficial: true, utilMm3: conDatos ? 612 : null },
                { id: 'PRE-002', nombre: 'Madero', almacenadoMm3: conDatos ? 141 : null, capacidadMm3: 280, muertoMm3: conDatos ? 36 : null, muertoOficial: false, utilMm3: conDatos ? 105 : null },
            ],
            demanda: { mm3: 506, provisional: true }, cobertura: conDatos ? 1.7 : null, diasAlcance: null, diasRestantes: null, banda: null, aviso: [], historicoCargado: true, historicoError: null,
        },
        ciclo: { entregadoPct: conDatos ? 78.7 : null, acumMm3: conDatos ? 222 : null, autMm3: conDatos ? 281 : null, avance: { pct: 100, concluido: true, etiqueta: '2025-2026' }, brecha: { brechaPP: null, estado: conDatos ? { tipo: 'info', texto: 'Ciclo concluido' } : sd } },
        canal: { cargado: true, modelo: { vaciado: true, escalas, conMedicion: conDatos ? 2 : 0, total: 4, ultimaMedicionMs: null, fueraDeRango: null,
            k0: { gasto: conDatos ? 20 : null, vigente: conDatos, medicionMs: null, ultimoAforoM3s: conDatos ? 20 : null, ultimoAforoMs: null },
            k104: { gasto: null, vigente: false, medicionMs: null, ultimoAforoM3s: null, ultimoAforoMs: null },
            conduccion: { completo: false, eficienciaPct: null, perdidaPct: null, perdidaM3s: null, incoherente: false } } },
        demanda: { d24: null, cargado: true, error: null, medido: { d: { netaMm: null, estado: sd }, etoMm: null, lluviaMm: null, tMax: null, ultimaObs: null } },
        modulos: [{ clave: 'MOD-001', nombre: 'M1', pct: conDatos ? 89 : null, letra: conDatos ? 'C' : '—', estado: conDatos ? { tipo: 'info', texto: 'Concluido' } : sd }],
        confianza: { pct: conDatos ? 60 : 0, vigentes: conDatos ? 3 : 0, total: 5, caidas: ['Escalas', 'GOES'], estado: { tipo: 'warn', texto: 'Parcial' }, fuentes: [{ clave: 'presas', nombre: 'Presas', ok: !!conDatos }, { clave: 'goes', nombre: 'GOES', ok: false }] },
        alertas: { resumen: { criticas: 0, avisos: conDatos ? 12 : 0, informativas: 0, accionables: conDatos ? 12 : 0, antiguas: 0 }, top: [], onAbrir: () => undefined },
        goes: { cargado: true, error: null, estaciones: [{ id: 'G1', nombre: 'Ojinaga - Rio', clave: 'sin_transmision', edadMin: 1500, serieGasto: [] }] },
        ndvi: { cargado: true, error: null, r: null },
    } as unknown as ModeloKpis;
}

const entrada = (conDatos: boolean, extra: Partial<EntradaInformeGeneral> = {}): EntradaInformeGeneral => ({
    m: modelo(conDatos), alertas: conDatos ? [{ id: 'a1', type: 'warning', title: 'Telemetría <GOES> sin transmisión', message: 'Sin señal 1 d', timestamp: '2026-10-30T12:00:00Z', categoria: 'goes' }] : [],
    veredicto: { tipo: 'warn', texto: 'Datos parciales' }, detalleVeredicto: 'Sin datos vigentes: Escalas', protocolo: { tipo: 'info', texto: 'Protocolo VACIADO · 32 d' },
    fechaCorteISO: '2026-10-31', fechaCorteTexto: '31 Oct 2026', clima: { tempMax: null, tempMin: null, vientoMax: null, estacionesValidas: 0, estacionesTotal: 6, excluidas: [] },
    extraccionM3s: null, erroresPagina: [], ahoraMs: Date.parse('2026-10-31T18:00:00Z'), emitido: new Date(2026, 9, 31, 12, 5), version: '2.57.0', ...extra,
});

describe('informe general del sistema', () => {
    it('arma 6 hojas con folio, pie y versión', () => {
        const h = construirHtmlInformeGeneral(entrada(true), LOGOS);
        expect((h.match(/<section class="pagina">/g) ?? []).length).toBe(HOJAS_INFORME_GENERAL);
        expect(h).toContain('IGS-20261031-1205');
        expect(h).toContain('Pág. 6 de 6');
        expect(h).toContain('SICA-005 v2.57.0');
        expect(h).toContain('size:letter portrait');
    });

    it('con datos muestra las cifras de la pantalla', () => {
        const h = construirHtmlInformeGeneral(entrada(true), LOGOS);
        expect(h).toContain('30.9');
        expect(h).toContain('849');
        expect(h).toContain('78.7');
        expect(h).toContain('2<small> de 4</small>');
        expect(h).toContain('(provisional)');
    });

    it('sin datos: S/D, nunca NaN, undefined ni 0 inventado', () => {
        const h = construirHtmlInformeGeneral(entrada(false), LOGOS);
        expect(h).not.toMatch(/NaN|undefined|Infinity|null/);
        expect(h).toContain('class="sd">S/D</span>');
        expect(h).not.toMatch(/<div class="v">0(,0+)?<small> %/);
    });

    it('el estado nunca va solo en color: símbolo + texto', () => {
        const h = construirHtmlInformeGeneral(entrada(true), LOGOS);
        expect(h).toMatch(/class="chip e-warn"><b aria-hidden="true">▲<\/b>Bajo/);
        expect(h).toMatch(/class="chip e-sd"><b aria-hidden="true">○<\/b>/);
    });

    it('escapa el texto dinámico (alertas, errores)', () => {
        const h = construirHtmlInformeGeneral(entrada(true, { erroresPagina: ['Presas: <b>x</b>'] }), LOGOS);
        expect(h).toContain('Telemetría &lt;GOES&gt; sin transmisión');
        expect(h).toContain('Presas: &lt;b&gt;x&lt;/b&gt;');
        expect(h).not.toContain('<b>x</b>');
    });

    it('un gasto no vigente se rotula como último aforo, no como medición', () => {
        const m = modelo(true);
        m.canal.modelo.k0 = { gasto: null, vigente: false, medicionMs: 1, ultimoAforoM3s: 14.2, ultimoAforoMs: 1 };
        const h = construirHtmlInformeGeneral(entrada(true, { m }), LOGOS);
        expect(h).toContain('último aforo 14.20 m³/s');
    });

    it('en vaciado avisa que el rango operativo no aplica', () => {
        expect(construirHtmlInformeGeneral(entrada(true), LOGOS)).toContain('Protocolo de vaciado activo');
    });

    it('nombre de archivo con fecha local', () => {
        expect(nombreArchivoInformeGeneral(new Date(2026, 9, 31))).toBe('informe-general-2026-10-31');
    });
});
