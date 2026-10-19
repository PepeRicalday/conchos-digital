import { describe, it, expect } from 'vitest';
import { armaSnapshot, promptDinamico, type DatosCrudos, type EscalaCat, type LecturaEsc } from './contexto';
import { ejecutaHerramienta, HERRAMIENTAS } from './herramientas';

const AHORA = Date.UTC(2026, 9, 18, 20, 0, 0);   // 18-oct-2026 14:00 Chihuahua

const cat = (id: string, nombre: string, km: number): EscalaCat => ({ id, nombre, km, pzas_radiales: 0, ancho: 0, alto: 0, nivel_min_operativo: 2.8, nivel_max_operativo: 3.4 });
const medida = (id: string, nivel: number, gasto: number | null, hora = '13:00:00'): LecturaEsc => ({
    escala_id: id, fecha: '2026-10-18', hora_lectura: hora, nivel_m: nivel, confirmada: true, responsable: 'Aforador', gasto_calculado_m3s: gasto,
});
const datos = (extra: Partial<DatosCrudos> = {}): DatosCrudos => ({
    presas: [], escalasCat: [], lecturasEsc: [], modulos: [], volumenCiclo: [], ciclo: null, evento: null, canalStatus: null, perfil: [],
    tomas: [], entregas: [], zonas: [], interescalas: [], balanceModulos: [], conocimiento: [], fallos: [], ...extra,
});
const riego = { evento: { evento_tipo: 'ESTABILIZACIÓN' }, ciclo: { id: 'CIC-2', nombre: 'Ciclo 2026-2027', fecha_inicio: '2026-10-01', fecha_fin: '2027-09-30' } };
const dosEscalas = { escalasCat: [cat('E0', 'K-0+000', 0), cat('E1', 'K-23', 23)], lecturasEsc: [medida('E0', 3.1, 10), medida('E1', 3.0, 8)] };

type Tramos = { tramos: Array<{ estado: string; q_tomas: number | null }>; tomas_conocidas: boolean; tomas_activas_hoy: unknown; nota?: string; balance_aplica: boolean | null };

describe('consultar_balance_canal', () => {
    it('sin reportes de tomas: las tomas son S/D (no cero) y no se inventan pérdidas', () => {
        const s = armaSnapshot(datos({ ...riego, ...dosEscalas }), AHORA);
        const r = ejecutaHerramienta('consultar_balance_canal', s);
        const c = r.contenido as unknown as Tramos;
        expect(c.tomas_conocidas).toBe(false);
        expect(c.tomas_activas_hoy).toBeNull();
        expect(c.tramos[0]).toMatchObject({ estado: 'tomas_sd', q_tomas: null });
        expect(c.nota).toMatch(/Q_tomas es S\/D/);
        expect(r.tarjetas[0].filas[0][3]).toBeNull();                // la tarjeta muestra S/D en Tomas
        expect(r.tarjetas[0].filas[0][6]).toBe('Tomas S/D');
    });
    it('con reportes de tomas el balance se clasifica normalmente', () => {
        const s = armaSnapshot(datos({ ...riego, ...dosEscalas, tomas: [{ caudal_promedio: 1, puntos_entrega: { nombre: 'T1', km: 10 } }] }), AHORA);
        const c = ejecutaHerramienta('consultar_balance_canal', s).contenido as unknown as Tramos;
        expect(c.tomas_conocidas).toBe(true);
        expect(c.tramos[0]).toMatchObject({ estado: 'atencion', q_tomas: 1 });     // (8+1)/10 = 90 %
    });
    it('si la consulta de tomas FALLÓ, tampoco se asume cero tomas', () => {
        const s = armaSnapshot(datos({ ...riego, ...dosEscalas, fallos: ['tomas_activas'] }), AHORA);
        const r = ejecutaHerramienta('consultar_balance_canal', s);
        expect((r.contenido as unknown as Tramos).tomas_conocidas).toBe(false);
        expect(r.contenido.datos_incompletos).toEqual(['tomas_activas']);
        expect(r.tarjetas[0].nota).toMatch(/Datos incompletos: no se pudo leer tomas activas del día/);
    });
    it('en vaciado los tramos NO se marcan como fugas: estado no_aplica', () => {
        const s = armaSnapshot(datos({ ...dosEscalas, evento: { evento_tipo: 'VACIADO' }, ciclo: riego.ciclo, tomas: [{ caudal_promedio: 0.1, puntos_entrega: { nombre: 'T', km: 5 } }] }), AHORA);
        const c = ejecutaHerramienta('consultar_balance_canal', s).contenido as unknown as Tramos;
        expect(c.balance_aplica).toBe(false);
        expect(c.tramos.every((t) => t.estado === 'no_aplica')).toBe(true);
        expect(c.nota).toMatch(/NO aplica/);
    });
    it('si falla la consulta del evento oficial el modo es S/D: balance_aplica null y el prompt no afirma nada', () => {
        const s = armaSnapshot(datos({ ...dosEscalas, fallos: ['evento_oficial'] }), AHORA);
        expect(s.operacion).toMatchObject({ modo: 'SD', balance_aplica: null });
        expect((ejecutaHerramienta('consultar_balance_canal', s).contenido as unknown as Tramos).balance_aplica).toBeNull();
        const p = promptDinamico(s, 'general', '');
        expect(p).toMatch(/MODO OPERATIVO: S\/D/);
        expect(p).not.toMatch(/no hay evento oficial activo/);
        expect(p).toMatch(/DATOS INCOMPLETOS — no se pudo leer: evento oficial vigente/);
    });
    it('catálogo de escalas caído => nota con la causa real (no "ningún tramo tiene medición")', () => {
        const s = armaSnapshot(datos({ ...riego, fallos: ['catalogo_escalas'] }), AHORA);
        const c = ejecutaHerramienta('consultar_balance_canal', s).contenido as unknown as Tramos;
        expect(c.nota).toMatch(/faltan escalas por una consulta fallida/);
        expect(c.nota).not.toMatch(/Ningún tramo tiene medición/);
    });
});

describe('consultar_modulos', () => {
    const vol = (ciclo: string, cod: string, num: number, aut: number | null, ent: number | null) => ({
        ciclo_id: ciclo, codigo_corto: cod, modulo_nombre: `Módulo ${num}`, numero_modulo: num,
        vol_autorizado_miles_m3: aut, vol_entregado_miles_m3: ent, vol_saldo_miles_m3: aut != null && ent != null ? aut - ent : null, pct_entregado: aut && ent != null ? Number(((ent / aut) * 100).toFixed(2)) : null,
    });
    it('lee el volumen de la vista oficial (no de modulos.vol_acumulado, que quedó en 0) y suma solo con datos completos', () => {
        const s = armaSnapshot(datos({ ...riego, volumenCiclo: [vol('CIC-2', 'M2', 2, 44000, 30000), vol('CIC-2', 'M1', 1, 34000, 30150)] }), AHORA);
        const c = ejecutaHerramienta('consultar_modulos', s).contenido as unknown as { modulos: Array<{ modulo: string; pct_entregado: number }>; total: { entregado_miles_m3: number } | null };
        expect(c.modulos.map((m) => m.modulo)).toEqual(['M1', 'M2']);           // ordenados por número
        expect(c.modulos[0].pct_entregado).toBeGreaterThan(80);
        expect(c.total).toEqual({ autorizado_miles_m3: 78000, entregado_miles_m3: 60150 });
    });
    it('un módulo sin dato deja el total en S/D (no suma ceros)', () => {
        const s = armaSnapshot(datos({ ...riego, volumenCiclo: [vol('CIC-2', 'M1', 1, 34000, 30150), vol('CIC-2', 'M2', 2, 44000, null)] }), AHORA);
        const c = ejecutaHerramienta('consultar_modulos', s).contenido as unknown as { total: unknown };
        expect(c.total).toBeNull();
    });
    it('solo el ciclo vigente; la autorización de otro ciclo nunca se usa (caudal máx. S/D)', () => {
        const s = armaSnapshot(datos({
            ...riego,
            volumenCiclo: [vol('CIC-1', 'M1', 1, 1, 1), vol('CIC-2', 'M1', 1, 34000, 30000)],
            modulos: [{ codigo_corto: 'M1', autorizaciones_ciclo: [{ ciclo_id: 'CIC-1', caudal_max: 9.9 }] }],
        }), AHORA);
        const c = ejecutaHerramienta('consultar_modulos', s).contenido as unknown as { modulos: Array<{ autorizado_miles_m3: number; caudal_max_m3s: number | null }> };
        expect(c.modulos).toHaveLength(1);
        expect(c.modulos[0]).toMatchObject({ autorizado_miles_m3: 34000, caudal_max_m3s: null });
    });
    it('las entregas conservan la zona (un módulo multizona tiene una entrega por zona)', () => {
        const s = armaSnapshot(datos({ ...riego, entregas: [{ modulo_id: 'MOD-002', zona_id: 'Z2', tipo_entrega: 'base', gasto_m3s: 1.66, fecha: '2026-10-18' }, { modulo_id: 'MOD-002', zona_id: 'Z3', tipo_entrega: 'base', gasto_m3s: 0.5, fecha: '2026-10-18' }] }), AHORA);
        const c = ejecutaHerramienta('consultar_modulos', s).contenido as unknown as { entregas_recientes: Array<{ zona_id: string | null; es_de_hoy: boolean }> };
        expect(c.entregas_recientes.map((e) => e.zona_id)).toEqual(['Z2', 'Z3']);
        expect(c.entregas_recientes.every((e) => e.es_de_hoy)).toBe(true);
    });
    it('la nota advierte no sumar filas por zona', () => {
        const c = ejecutaHerramienta('consultar_modulos', armaSnapshot(datos(riego), AHORA)).contenido;
        expect(String(c.nota)).toMatch(/no sumar entre zonas/);
    });
});

describe('otras herramientas', () => {
    it('almacenamiento: los tramos que terminan en K-64 o K-94+200 se marcan como parciales', () => {
        const s = armaSnapshot(datos({ ...riego, interescalas: [{ km_up: 62, km_down: 64, vol_m3: 100 }, { km_up: 64, km_down: 68, vol_m3: 200 }, { km_up: 79, km_down: 87.5, vol_m3: 300 }] }), AHORA);
        const c = ejecutaHerramienta('consultar_almacenamiento_canal', s).contenido as unknown as { entre_represas: Array<{ toca_referencia: boolean }> };
        expect(c.entre_represas.map((x) => x.toca_referencia)).toEqual([true, true, false]);
    });
    it('un fallo de consulta se avisa en la herramienta afectada y no en las demás', () => {
        const s = armaSnapshot(datos({ ...riego, fallos: ['vol_zonas'] }), AHORA);
        expect(ejecutaHerramienta('consultar_almacenamiento_canal', s).contenido.datos_incompletos).toEqual(['vol_zonas']);
        expect(ejecutaHerramienta('consultar_presas', s).contenido.datos_incompletos).toBeUndefined();
    });
    it('lecturas truncadas por el tope se marcan en escalas', () => {
        const s = armaSnapshot(datos({ ...riego, ...dosEscalas, fallos: ['lecturas_escalas (truncada)'] }), AHORA);
        const r = ejecutaHerramienta('consultar_escalas', s);
        expect(r.contenido.datos_incompletos).toEqual(['lecturas_escalas (truncada)']);
        expect(r.tarjetas[0].nota).toMatch(/truncado/);
    });
    it('una escala sin medición vigente no muestra gasto aunque la fila lo traiga', () => {
        const vieja: LecturaEsc = { ...medida('E1', 3.0, 8), fecha: '2026-10-10' };
        const sinNivel: LecturaEsc = { escala_id: 'E0', fecha: '2026-10-18', hora_lectura: '13:00:00', nivel_m: null, confirmada: true, gasto_calculado_m3s: 7 };
        const s = armaSnapshot(datos({ ...riego, escalasCat: [cat('E0', 'K-0+000', 0), cat('E1', 'K-23', 23)], lecturasEsc: [sinNivel, vieja] }), AHORA);
        const e = (ejecutaHerramienta('consultar_escalas', s).contenido as unknown as { escalas: Array<{ nombre: string; gasto_m3s: number | null; estado: string }> }).escalas;
        expect(e.find((x) => x.nombre === 'K-0+000')?.gasto_m3s).toBeNull();
        expect(e.find((x) => x.nombre === 'K-23')?.estado).toBe('vencida');
    });
    it('herramienta desconocida: error marcado para devolver is_error al modelo', () => {
        const r = ejecutaHerramienta('hackear', armaSnapshot(datos(), AHORA));
        expect(r.error).toBe(true);
    });
    it('todas las herramientas anunciadas responden sin error con datos vacíos', () => {
        const s = armaSnapshot(datos(), AHORA);
        for (const h of HERRAMIENTAS) expect(ejecutaHerramienta(h.name, s).error, h.name).toBeUndefined();
    });
});
