import { describe, expect, it } from 'vitest';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import { configNTPorDefecto, ultimosAnios, validarConfigNT } from './informeNivelTendenciaConfig';
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
        expect(h).toContain('Imprimir / Guardar PDF');
    });
    it('modo png: sin botón de imprimir', () => {
        expect(htmlNivelTendencia(d, logos, 'png')).not.toContain('btn-imprimir" type');
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
