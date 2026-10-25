import { describe, expect, it } from 'vitest';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import { configNTPorDefecto, etiquetaAnioPeriodo, mesesDelPeriodo, ultimosAnios, validarConfigNT } from './informeNivelTendenciaConfig';
import { prepararNivelTendencia, redactarLectura } from './informeNivelTendenciaDatos';
import { htmlNivelTendencia } from './informeNivelTendenciaHtml';
import { svgAreaMes, svgCalor, svgCierres, svgCurvasAnios, svgPosicionHistorica } from './informeNivelTendenciaSvg';

const fila = (presa: string, fecha: string, alm: number | null, esc: number | null = null, fuente: FilaSerie['fuente'] = 'HISTORICO'): FilaSerie => ({
    presa_id: presa, fecha, escala_msnm: esc, almacenamiento_mm3: alm, pct: alm == null ? null : alm / 10, fuente,
    calidad: alm == null && esc == null ? 'SIN_DATO' : 'OK', almacenamiento_reportado_mm3: alm, pct_reportado: alm == null ? null : alm / 10,
});

const filas: FilaSerie[] = [
    // Boquilla: 25-oct de 4 años + octubre 2026 con huecos.
    fila('PRE-001', '2022-10-25', 800, 1290), fila('PRE-001', '2023-10-25', 500, 1285), fila('PRE-001', '2024-10-25', 300, 1280), fila('PRE-001', '2025-10-25', 600, 1288),
    fila('PRE-001', '2026-09-30', 640, 1286.5, 'CILA'),
    fila('PRE-001', '2026-10-01', 650, 1287.0, 'CILA'), fila('PRE-001', '2026-10-02', 655, 1287.1, 'CILA'),
    fila('PRE-001', '2026-10-03', null, null, 'CILA'),
    fila('PRE-001', '2026-10-25', 700, 1288.0, 'CILA'),
    // Madero: solo 2026.
    fila('PRE-002', '2026-10-25', 169.35, 1233.48, 'CILA'),
];
const idx = indexarSerie(filas);
const hoy = new Date(2026, 9, 26, 10, 0);
const cfg = (over = {}) => ({ ...configNTPorDefecto([2022, 2023, 2024, 2025, 2026], hoy), ...over });

describe('config', () => {
    it('últimos años: anteriores al base, en orden ascendente', () => {
        expect(ultimosAnios([2026, 2025, 2024, 2023, 2022], 2026, 3)).toEqual([2023, 2024, 2025]);
    });
    it('por defecto: mes en curso, ambas presas, 3 años', () => {
        const c = configNTPorDefecto([2026, 2025, 2024, 2023, 2022], hoy);
        expect(c.mes).toBe(10);
        expect(c.presas).toHaveLength(2);
        expect(c.aniosComparacion).toEqual([2023, 2024, 2025]);
    });
    it('valida presa vacía y año sin histórico', () => {
        expect(validarConfigNT(cfg({ presas: [] }), [2026])).toContain('Elige al menos una presa.');
        expect(validarConfigNT(cfg({ anioBase: 2019 }), [2026]).join()).toContain('2019');
    });
});

describe('prepararNivelTendencia', () => {
    const d = prepararNivelTendencia(cfg({ aniosComparacion: [2022, 2023, 2024, 2025] }), idx, hoy);
    const b = d.presas.find(p => p.id === 'PRE-001')!;

    it('corte = último dato del mes, con frescura y marca de actual', () => {
        expect(b.corte?.fecha).toBe('2026-10-25');
        expect(b.corte?.volumen).toBe(700);
        expect(b.corte?.esActual).toBe(true);
        expect(b.corte?.diasDesdeCorte).toBe(1);
    });
    it('un día sin dato es null en la serie, nunca 0', () => {
        expect(b.tendencia.volumen[2]).toBeNull(); // 3-oct
        expect(b.tendencia.volumen[0]).toBe(650);
        expect(b.tendencia.volumen.includes(0)).toBe(false);
    });
    it('delta del mes contra el cierre del mes anterior y estado', () => {
        expect(b.tendencia.deltaVolumen?.delta).toBeCloseTo(60, 6); // 700 - 640
        expect(b.tendencia.deltaEscala?.delta).toBeCloseTo(1.5, 6);
        expect(b.tendencia.estado).toBe('sube');
        expect(b.tendencia.ritmoCmDia).toBeCloseTo((1.5 * 100) / 25, 6);
    });
    it('mismo día por año con delta de hoy menos ese año', () => {
        const f2024 = b.mismoDia.find(r => r.anio === 2024)!;
        expect(f2024.volumen).toBe(300);
        expect(f2024.deltaVolumen).toBe(400);
        expect(b.mismoDia[0].anio).toBe(2025); // más reciente primero
    });
    it('posición histórica y semáforo con 5 valores (hoy 700: tercer lugar de cinco)', () => {
        expect(b.posicion).toEqual({ posicion: 4, de: 5 }); // 300,500,600,700,800
        expect(b.semaforo).toBe('verde');
        expect(b.promedioMismoDia?.n).toBe(4);
    });
    it('presa sin histórico previo: mismoDia vacío y semáforo S/D, sin inventar', () => {
        const m = d.presas.find(p => p.id === 'PRE-002')!;
        expect(m.mismoDia).toEqual([]);
        expect(m.posicion).toBeNull();
        expect(m.semaforo).toBe('sd');
        expect(m.corte?.volumen).toBe(169.35);
    });
    it('mes sin datos: usa el último anterior y lo marca fuera del mes', () => {
        const x = prepararNivelTendencia(cfg({ mes: 8, presas: ['PRE-001'] }), idx, hoy).presas[0];
        expect(x.corte?.fueraDelMes).toBe(true);
        expect(x.tendencia.diasConDato).toBe(0);
        expect(x.tendencia.estado).toBe('sd');
    });
    it('sin ningún dato: corte null y lectura S/D', () => {
        const x = prepararNivelTendencia(cfg({ anioBase: 2010, presas: ['PRE-001'] }), idx, hoy).presas[0];
        expect(x.corte).toBeNull();
        expect(x.lectura[0]).toMatch(/S\/D/);
    });
    it('años de comparación inexistentes se omiten', () => {
        const x = prepararNivelTendencia(cfg({ aniosComparacion: [2010, 2024] }), idx, hoy);
        expect(x.aniosComparacion).toEqual([2024]);
    });
    it('lectura: solo hechos, omite frases sin dato', () => {
        const t = redactarLectura({ nombre: 'X', corte: null, tendencia: b.tendencia, an: null, posicion: null, nComp: 0, nombreMes: 'octubre', A: 2026 });
        expect(t).toHaveLength(1);
        expect(b.lectura.join(' ')).toContain('por encima del promedio');
    });
});

describe('HTML e SVG', () => {
    const d = prepararNivelTendencia(cfg({ aniosComparacion: [2022, 2023, 2024, 2025] }), idx, hoy);
    const logos = { srl: 'data:image/jpeg;base64,AAAA', sica: 'data:image/png;base64,BBBB' };

    it('una hoja por presa, sin NaN/undefined/null y con S/D donde falta el dato', () => {
        const h = htmlNivelTendencia(d, logos);
        expect(h.match(/class="hoja"/g)).toHaveLength(2);
        expect(h).not.toMatch(/NaN|undefined|>null<| null /);
        expect(h).toContain('S/D');
        expect(h).not.toContain('<button');
    });
    it('secciones desactivadas no se imprimen', () => {
        const h = htmlNivelTendencia(prepararNivelTendencia(cfg({ secciones: [], aniosComparacion: [2024] }), idx, hoy), logos);
        expect(h).not.toContain('Historial completo');
        expect(h).not.toContain('años anteriores');
    });
    it('sin datos: aviso en vez de cifras inventadas', () => {
        const h = htmlNivelTendencia(prepararNivelTendencia(cfg({ anioBase: 2010, presas: ['PRE-001'] }), idx, hoy), logos);
        expect(h).toContain('Sin datos');
        expect(h).not.toMatch(/NaN|undefined/);
    });
    it('escapa texto dinámico', () => {
        expect(svgAreaMes([null, null], { unidad: '<b>', decimales: 1, titulo: 'a"b' })).not.toContain('<b>');
    });
    it('gráficas vacías devuelven estado S/D, no un trazo en cero', () => {
        expect(svgAreaMes([null, null, null], { unidad: 'Mm³', decimales: 1, titulo: 't' })).toContain('S/D');
        expect(svgCurvasAnios([{ anio: 2026, esBase: true, volumen: [null], escala: [null] }], 'volumen', { unidad: 'u', decimales: 1, titulo: 't' })).toContain('S/D');
        expect(svgCierres([{ anio: 2025, valor: null, fecha: null, esBase: true }], { unidad: 'Mm³', titulo: 't' })).toContain('S/D');
        expect(svgCalor([], { titulo: 't', baseAnio: 2026, mesResaltado: 1 })).toContain('S/D');
        expect(svgPosicionHistorica([], { anio: 2026, volumen: 1 }, { titulo: 't' })).toContain('S/D');
    });
    it('área del mes sin NaN con un solo dato', () => {
        expect(svgAreaMes([null, 5, null], { unidad: 'Mm³', decimales: 1, titulo: 't' })).not.toContain('NaN');
    });
});

describe('pdfDePaginas', () => {
    it('estructura válida: cabecera, N páginas, xref y %%EOF', async () => {
        const { pdfDePaginas } = await import('./pdfDeImagenes');
        const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
        const blob = pdfDePaginas([{ bytes: jpg, ancho: 980, alto: 2126 }, { bytes: jpg, ancho: 980, alto: 2000 }]);
        const t = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
        expect(t.startsWith('%PDF-1.4')).toBe(true);
        expect(t).toContain('/Count 2');
        expect(t).toContain('/MediaBox [0 0 612 1327.67]');
        expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
        const sx = Number(/startxref\s+(\d+)/.exec(t)![1]);
        expect(t.slice(sx, sx + 4)).toBe('xref');
        expect(blob.type).toBe('application/pdf');
    });
    it('sin páginas lanza error', async () => {
        const { pdfDePaginas } = await import('./pdfDeImagenes');
        expect(() => pdfDePaginas([])).toThrow();
    });
});

describe('movimiento del periodo', () => {
    const mov = indexarSerie([
        fila('PRE-001', '2025-09-30', 100, 1270), fila('PRE-001', '2025-10-31', 110, 1271),
        fila('PRE-001', '2026-03-31', 300, 1280), fila('PRE-001', '2026-09-30', 250, 1277),
        fila('PRE-001', '2024-09-30', 50, 1260), fila('PRE-001', '2025-03-31', 80, 1262),
    ]);
    const prep = (over = {}) => prepararNivelTendencia(cfg({ presas: ['PRE-001'], aniosComparacion: [2025], ...over }), mov, hoy).presas[0].movimiento;

    it('meses del periodo: el ciclo cruza el año y el año etiqueta donde termina', () => {
        expect(mesesDelPeriodo({ mesIni: 10, mesFin: 9 }, 2026).map(m => `${m.anio}-${m.mes}`))
            .toEqual(['2025-10', '2025-11', '2025-12', '2026-1', '2026-2', '2026-3', '2026-4', '2026-5', '2026-6', '2026-7', '2026-8', '2026-9']);
        expect(mesesDelPeriodo({ mesIni: 5, mesFin: 5 }, 2026)).toEqual([{ anio: 2026, mes: 5 }]);
        expect(etiquetaAnioPeriodo({ mesIni: 10, mesFin: 9 }, 2026)).toBe('2025–2026');
    });
    it('ciclo completo: Δ = cierre final − cierre previo al periodo', () => {
        const base = prep().anios.find(a => a.esBase)!;
        expect(base.etiqueta).toBe('2025–2026');
        expect(base.deltaVolumen).toBeCloseTo(150, 6); // 250 − 100 (cierre de sep 2025)
        expect(base.deltaEscala).toBeCloseTo(7, 6);
        expect(base.parcial).toBe(false);
    });
    it('mes sin dato es null (S/D), nunca 0', () => {
        const base = prep().anios.find(a => a.esBase)!;
        expect(base.meses[0].deltaVolumen).toBeCloseTo(10, 6); // oct: 110 − 100
        expect(base.meses[1].deltaVolumen).toBeNull(); // nov sin dato
        expect(base.meses.some(m => m.deltaVolumen === 0)).toBe(false);
    });
    it('año de comparación sin dato suficiente: Δ null y no entra al promedio', () => {
        const m = prep({ aniosComparacion: [2024, 2025] });
        expect(m.anios.find(a => a.anio === 2024)!.deltaVolumen).toBeNull();
        expect(m.promedioComp?.n).toBe(1);
    });
    it('periodo en curso: llega al último dato y se marca parcial', () => {
        const m = prep({ periodo: { mesIni: 1, mesFin: 12 } });
        expect(m.anios.find(a => a.esBase)!.parcial).toBe(true);
    });
    it('la lectura nombra el cambio y se emite como S/D si no hay datos', () => {
        expect(prep().lectura.join(' ')).toMatch(/subió/);
        const vacio = prepararNivelTendenciaVacio();
        expect(vacio.join(' ')).toMatch(/S\/D/);
    });
    it('el HTML incluye la sección y nunca imprime NaN/undefined', () => {
        const h = htmlNivelTendencia(prepararNivelTendencia(cfg({ presas: ['PRE-001'], aniosComparacion: [2025] }), mov, hoy), { srl: '', sica: '' });
        expect(h).toContain('Movimiento del periodo');
        expect(h).not.toMatch(/NaN|undefined/);
        const sin = htmlNivelTendencia(prepararNivelTendencia(cfg({ presas: ['PRE-001'], aniosComparacion: [2025], secciones: [] }), mov, hoy), { srl: '', sica: '' });
        expect(sin).not.toContain('Movimiento del periodo');
    });
});

function prepararNivelTendenciaVacio(): string[] {
    return prepararNivelTendencia(cfg({ presas: ['PRE-001'], aniosComparacion: [] }), indexarSerie([]), hoy).presas[0].movimiento.lectura;
}
