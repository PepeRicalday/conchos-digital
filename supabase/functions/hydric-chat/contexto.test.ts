import { describe, it, expect } from 'vitest';
import {
    armaSnapshot, clasificaOperacion, esEscalaReferencia, fmtFechaDia, instanteLectura, modoDeEvento,
    promptDinamico, PROMPT_ESTATICO, vistaEscalas, vistaPresas, type DatosCrudos, type EscalaCat, type LecturaEsc,
} from './contexto';
import { ejecutaHerramienta, transitoAcumulado, volcadoCompleto, HERRAMIENTAS } from './herramientas';

// 18-oct-2026 14:00 en Chihuahua (UTC−6) = 20:00 UTC
const AHORA = Date.UTC(2026, 9, 18, 20, 0, 0);

const cat = (id: string, nombre: string, km: number, extra: Partial<EscalaCat> = {}): EscalaCat => ({
    id, nombre, km, pzas_radiales: 0, ancho: 0, alto: 0, nivel_min_operativo: 2.8, nivel_max_operativo: 3.4, ...extra,
});
const arrastre = (id: string, nivel: number): LecturaEsc => ({
    escala_id: id, fecha: '2026-10-18', hora_lectura: '00:00:00', nivel_m: nivel, confirmada: false,
    responsable: 'SICA Chronos', notas: 'Autogenerado (Continuidad de Medianoche)', gasto_calculado_m3s: null,
});
const medida = (id: string, nivel: number, hora: string, gasto: number | null = 5, fecha = '2026-10-18'): LecturaEsc => ({
    escala_id: id, fecha, hora_lectura: hora, nivel_m: nivel, confirmada: true, responsable: 'Aforador', gasto_calculado_m3s: gasto, radiales_json: [{ index: 0, apertura_m: 0.5 }],
});

const base = (extra: Partial<DatosCrudos> = {}): DatosCrudos => ({
    presas: [], escalasCat: [], lecturasEsc: [], modulos: [], volumenCiclo: [], ciclo: null, evento: null, canalStatus: null, perfil: [],
    tomas: [], entregas: [], zonas: [], interescalas: [], balanceModulos: [], conocimiento: [], fallos: [], ...extra,
});

describe('fechas', () => {
    it('un DATE puro se muestra tal cual (antes se corría un día por zona horaria)', () => {
        expect(fmtFechaDia('2026-10-18')).toBe('18/10/2026');
        expect(fmtFechaDia(null)).toBe('S/D');
        expect(fmtFechaDia('basura')).toBe('S/D');
    });
    it('hora de campo se interpreta en Chihuahua (UTC−6), no en UTC', () => {
        expect(instanteLectura('2026-10-18', '09:00:00')).toBe(Date.UTC(2026, 9, 18, 15, 0, 0));
    });
});

describe('modo operativo', () => {
    it('reconoce VACIADO y ESTABILIZACIÓN con tilde', () => {
        expect(modoDeEvento('VACIADO')).toBe('VACIADO');
        expect(modoDeEvento('ESTABILIZACIÓN')).toBe('ESTABILIZACION');
        expect(modoDeEvento(null)).toBe('SIN_EVENTO');
    });
    it('ciclo con fecha fin pasada = vencido aunque siga marcado activo; en vaciado el balance no aplica', () => {
        const op = clasificaOperacion(base({
            evento: { evento_tipo: 'VACIADO', fecha_inicio: '2026-09-29T18:00:00Z', notas: 'Cierre de ciclo' },
            ciclo: { nombre: 'Ciclo 2025-2026', fecha_inicio: '2025-10-01', fecha_fin: '2026-09-30' },
        }), '2026-10-18');
        expect(op).toMatchObject({ modo: 'VACIADO', balance_aplica: false });
        expect(op.ciclo?.vencido).toBe(true);
    });
    it('con riego y ciclo vigente el balance aplica', () => {
        const op = clasificaOperacion(base({
            evento: { evento_tipo: 'ESTABILIZACIÓN' },
            ciclo: { nombre: 'C', fecha_inicio: '2026-10-01', fecha_fin: '2027-09-30' },
        }), '2026-10-18');
        expect(op.balance_aplica).toBe(true);
    });
});

describe('vistaEscalas', () => {
    it('solo arrastre => estado arrastre, sin nivel medido ni gasto (S/D, nunca 0)', () => {
        const [v] = vistaEscalas([cat('E1', 'K-23', 23)], [arrastre('E1', 0.15)], AHORA);
        expect(v).toMatchObject({ estado: 'arrastre', nivel_m: null, gasto_m3s: null, nivel_arrastrado_m: 0.15 });
    });
    it('medición reciente = vigente; vieja = vencida (con antigüedad)', () => {
        const [v1] = vistaEscalas([cat('E1', 'K-23', 23)], [medida('E1', 3.0, '12:00:00')], AHORA);   // 2 h antes
        expect(v1).toMatchObject({ estado: 'vigente', nivel_m: 3.0, edad_min: 120 });
        const [v2] = vistaEscalas([cat('E1', 'K-23', 23)], [medida('E1', 3.0, '08:00:00', 5, '2026-10-16')], AHORA);
        expect(v2.estado).toBe('vencida');
        expect(v2.edad_min).toBeGreaterThan(240);
    });
    it('una medición real prevalece sobre el arrastre más reciente', () => {
        const [v] = vistaEscalas([cat('E1', 'K-23', 23)], [arrastre('E1', 0.15), medida('E1', 2.9, '13:30:00')], AHORA);
        expect(v).toMatchObject({ estado: 'vigente', nivel_m: 2.9, nivel_arrastrado_m: null });
    });
    it('K-64 y K-94+200 son referencia y nunca tienen gasto', () => {
        const vs = vistaEscalas([cat('E7', 'K-64', 64), cat('E12', 'K-94+200', 94.2), cat('E13', 'K-104', 104)],
            [medida('E7', 2.8, '13:00:00', 53), medida('E12', 2.6, '13:00:00', 53), medida('E13', 0.8, '13:00:00', 0.4)], AHORA);
        expect(vs.map((e) => e.referencia)).toEqual([true, true, false]);
        expect(vs[0].gasto_m3s).toBeNull();
        expect(vs[1].gasto_m3s).toBeNull();
        expect(vs[2].gasto_m3s).toBe(0.4);
        expect(esEscalaReferencia('K-62', 62)).toBe(false);
    });
    it('sin radiales_json en una escala con compuertas => aperturas S/D (null), no cerradas', () => {
        const l: LecturaEsc = { escala_id: 'E1', fecha: '2026-10-18', hora_lectura: '13:00:00', nivel_m: 3, confirmada: true, radiales_json: [] };
        const [v] = vistaEscalas([cat('E1', 'K-0+000', 0, { pzas_radiales: 3 })], [l], AHORA);
        expect(v.aperturas_m).toEqual([null, null, null]);
    });
});

describe('vistaPresas', () => {
    it('lectura del día vigente; sin almacenamiento = sd; vieja = vencida', () => {
        const hoy = new Date(AHORA - 3 * 3600_000).toISOString();
        const vieja = new Date(AHORA - 60 * 3600_000).toISOString();
        const v = vistaPresas([
            { presa_id: 'P1', fecha: '2026-10-18', creado_en: hoy, almacenamiento_mm3: '730.357', porcentaje_llenado: '25.66', extraccion_total_m3s: null, presas: { nombre: 'Presa La "Boquilla"', nombre_corto: 'Boquilla' } },
            { presa_id: 'P2', fecha: '2026-10-15', creado_en: vieja, almacenamiento_mm3: 100, presas: { nombre: 'Otra' } },
            { presa_id: 'P3', fecha: '2026-10-18', creado_en: hoy, almacenamiento_mm3: null, presas: { nombre: 'Sin dato' } },
        ], AHORA);
        expect(v.map((p) => p.estado)).toEqual(['vigente', 'vencida', 'sd']);
        expect(v[0]).toMatchObject({ nombre: 'Presa La Boquilla', fecha: '18/10/2026', extraccion_m3s: null });
    });
});

describe('herramientas', () => {
    const escenarioVaciado = () => armaSnapshot(base({
        escalasCat: [cat('E0', 'K-0+000', 0), cat('E1', 'K-23', 23), cat('E7', 'K-64', 64), cat('E13', 'K-104', 104)],
        lecturasEsc: [arrastre('E0', 0.2), arrastre('E1', 0.15), arrastre('E7', 2.8), arrastre('E13', 0.8)],
        evento: { evento_tipo: 'VACIADO' },
        ciclo: { nombre: 'Ciclo 2025-2026', fecha_inicio: '2025-10-01', fecha_fin: '2026-09-30' },
    }), AHORA);

    it('balance: con solo arrastres no hay datos y en vaciado el balance NO aplica (no se clasifican fugas)', () => {
        const r = ejecutaHerramienta('consultar_balance_canal', escenarioVaciado());
        const c = r.contenido as { balance_aplica: boolean; tramos: Array<{ estado: string; q_perdidas: number | null }>; nota?: string };
        expect(c.balance_aplica).toBe(false);
        expect(c.tramos.length).toBe(2);                              // K-64 (referencia) no corta tramos
        expect(c.tramos.every((t) => t.estado === 'no_aplica' && t.q_perdidas === null)).toBe(true);
        expect(c.nota).toMatch(/VACIADO/);
        expect(r.tarjetas[0].filas.every((f) => f[6] === 'No aplica (vaciado)')).toBe(true);
    });
    it('balance: dos mediciones vigentes consecutivas y tomas reportadas sí producen un tramo clasificado', () => {
        const s = armaSnapshot(base({
            escalasCat: [cat('E0', 'K-0+000', 0), cat('E1', 'K-23', 23)],
            lecturasEsc: [medida('E0', 3.1, '13:00:00', 10), medida('E1', 3.0, '13:10:00', 9)],
            tomas: [{ caudal_promedio: 0.05, puntos_entrega: { nombre: 'T1', km: 5 } }],
            evento: { evento_tipo: 'ESTABILIZACIÓN' }, ciclo: { nombre: 'C', fecha_inicio: '2026-10-01', fecha_fin: '2027-09-30' },
        }), AHORA);
        const c = ejecutaHerramienta('consultar_balance_canal', s).contenido as { balance_aplica: boolean; tramos: Array<{ estado: string; eficiencia: number }> };
        expect(c.balance_aplica).toBe(true);
        expect(c.tramos[0].estado).toBe('atencion');                 // (9 + 0.05) / 10 = 90.5 %
    });
    it('tomas sin caudal o sin km no cuentan como tomas activas', () => {
        const s = armaSnapshot(base({
            escalasCat: [cat('E0', 'K-0+000', 0), cat('E1', 'K-23', 23)],
            lecturasEsc: [medida('E0', 3.1, '13:00:00', 10), medida('E1', 3.0, '13:10:00', 8)],
            tomas: [{ caudal_promedio: 1, puntos_entrega: { nombre: 'T-ok', km: 10 } }, { caudal_promedio: null, puntos_entrega: { nombre: 'T-nulo', km: 11 } }, { caudal_promedio: 2, puntos_entrega: { nombre: 'T-sin-km', km: null } }],
        }), AHORA);
        const c = ejecutaHerramienta('consultar_balance_canal', s).contenido as { tomas_activas_hoy: unknown[] };
        expect(c.tomas_activas_hoy).toHaveLength(1);
    });
    it('tránsito acumulado: un tramo sin velocidad corta el acumulado (S/D), no sigue sumando', () => {
        const t = transitoAcumulado([
            { km_inicio: 0, km_fin: 3.6, velocidad_diseno_ms: 1 },     // 3600 m / 1 m/s = 60 min
            { km_inicio: 3.6, km_fin: 7.2, velocidad_diseno_ms: null },
            { km_inicio: 7.2, km_fin: 10.8, velocidad_diseno_ms: 1 },
        ]);
        expect(t.map((x) => x.t_acum_min)).toEqual([60, null, null]);
    });
    it('toda herramienta anunciada tiene manejador', () => {
        const s = escenarioVaciado();
        for (const h of HERRAMIENTAS) {
            const r = ejecutaHerramienta(h.name, s);
            expect(r.contenido.error, h.name).toBeUndefined();
        }
    });
    it('respaldo sin tools: el volcado incluye todas las herramientas', () => {
        const v = volcadoCompleto(escenarioVaciado());
        for (const h of HERRAMIENTAS) expect(v).toContain(h.name);
    });
});

describe('prompt', () => {
    it('el estático fija las reglas que antes se violaban y no lleva fechas ni cifras volátiles', () => {
        expect(PROMPT_ESTATICO).toMatch(/S\/D/);
        expect(PROMPT_ESTATICO).toMatch(/240 min/);
        expect(PROMPT_ESTATICO).toMatch(/K-64 y K-94\+200/);
        expect(PROMPT_ESTATICO).toMatch(/VACIADO/);
        expect(PROMPT_ESTATICO).not.toMatch(/ESC-013|~K104\+057/);       // error anterior: K-104 no es ESC-013 ~K104+057
        expect(PROMPT_ESTATICO).not.toMatch(/\b20(25|26)\b/);            // nada que caduque con el ciclo
    });
    it('el dinámico declara vaciado, ciclo cerrado, conteos y datos incompletos', () => {
        const s = armaSnapshot(base({
            escalasCat: [cat('E1', 'K-23', 23)], lecturasEsc: [arrastre('E1', 0.15)],
            evento: { evento_tipo: 'VACIADO', fecha_inicio: '2026-09-29T18:00:00Z', notas: 'Cierre de ciclo' },
            ciclo: { nombre: 'Ciclo 2025-2026', fecha_inicio: '2025-10-01', fecha_fin: '2026-09-30' },
            fallos: ['balance_zonas'], conocimiento: [{ titulo: 'Capacidad', contenido: '60 m3/s' }],
        }), AHORA);
        const p = promptDinamico(s, 'general', '<documentos_no_confiables>x</documentos_no_confiables>');
        expect(p).toContain('MODO OPERATIVO: VACIADO');
        expect(p).toContain('FIN DE CICLO YA PASÓ');
        expect(p).toContain('NO APLICA');
        expect(p).toContain('1 solo con arrastre');
        expect(p).toContain('DATOS INCOMPLETOS');
        expect(p).toContain('Capacidad: 60 m3/s');
        expect(p).toContain('<documentos_no_confiables>');
        expect(p).toContain('18/10/2026');
    });
});
