import { describe, it, expect } from 'vitest';
import { aplicaEvento, ErrorStream, estadoInicial, MAX_PENSANDO, separaEventos } from './sseChat';

const sse = (...objs: unknown[]) => objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('');

describe('separaEventos', () => {
    it('devuelve los eventos completos y conserva la línea parcial para el siguiente bloque', () => {
        const a = sse({ delta: 'Hola ' }) + 'data: {"delta":"mun';
        const r1 = separaEventos(a);
        expect(r1.eventos).toEqual([{ delta: 'Hola ' }]);
        const r2 = separaEventos(r1.resto + 'do"}\n\n');
        expect(r2.eventos).toEqual([{ delta: 'mundo' }]);
    });
    it('descarta fotogramas ilegibles y líneas que no son data:', () => {
        const r = separaEventos('event: x\n: comentario\ndata: no-json\ndata: \ndata: {"delta":"ok"}\n\n');
        expect(r.eventos).toEqual([{ delta: 'ok' }]);
    });
});

describe('aplicaEvento', () => {
    it('acumula el texto y sigue la conversación', () => {
        let s = estadoInicial(null);
        s = aplicaEvento(s, { type: 'inicio', conversation_id: 'c1', proveedor: 'claude' });
        s = aplicaEvento(s, { delta: 'Boquilla ', conversation_id: 'c1' });
        s = aplicaEvento(s, { delta: 'al 25 %.', conversation_id: 'c1' });
        expect(s).toMatchObject({ texto: 'Boquilla al 25 %.', convId: 'c1', motor: { proveedor: 'claude', modelo: null } });
    });
    it('estado, razonamiento (acotado) y tarjetas', () => {
        let s = estadoInicial('c0');
        s = aplicaEvento(s, { type: 'estado', texto: 'Leyendo presas…' });
        s = aplicaEvento(s, { type: 'pensando', texto: 'x'.repeat(500) });
        const t = { kind: 'presas', titulo: 'Presas', columnas: ['Presa'], filas: [['Boquilla']] };
        s = aplicaEvento(s, { type: 'tarjetas', tarjetas: [t] });
        s = aplicaEvento(s, { type: 'tarjetas', tarjetas: [t] });
        expect(s.estado).toBe('Leyendo presas…');
        expect(s.pensando).toHaveLength(MAX_PENSANDO);
        expect(s.meta.tarjetas).toHaveLength(2);
    });
    it('done fija proveedor, modelo, fuentes y persistencia fallida', () => {
        const s = aplicaEvento(estadoInicial('c1'), { type: 'done', done: true, proveedor: 'groq', modelo: 'llama', truncada: true, fuentes: [{ documento: 'Manual', similitud: 0.8 }], persistido: false });
        expect(s.hecho).toBe(true);
        expect(s.meta).toMatchObject({ proveedor: 'groq', modelo: 'llama', truncada: true, persistido: false, fuentes: [{ documento: 'Manual', similitud: 0.8 }] });
        expect(s.motor).toEqual({ proveedor: 'groq', modelo: 'llama' });
    });
    it('done conserva datos_incompletos y rechazada para avisarlos en la interfaz', () => {
        const s = aplicaEvento(estadoInicial('c1'), { type: 'done', done: true, proveedor: 'claude', modelo: 'm', truncada: false, rechazada: true, datos_incompletos: ['presas', 'escalas'] });
        expect(s.meta).toMatchObject({ rechazada: true, datos_incompletos: ['presas', 'escalas'] });
    });
    it('un evento de error lanza ErrorStream con su código (no se confunde con texto)', () => {
        expect(() => aplicaEvento(estadoInicial(null), { error: true, code: 'cuota', message: 'Límite alcanzado' })).toThrow(ErrorStream);
        try { aplicaEvento(estadoInicial(null), { error: true, code: 'sin_respuesta', message: 'Reformula' }); } catch (e) {
            expect((e as ErrorStream).code).toBe('sin_respuesta');
            expect((e as ErrorStream).message).toBe('Reformula');
        }
    });
    it('eventos desconocidos o mal formados no rompen ni alteran el estado', () => {
        const s0 = estadoInicial('c1');
        expect(aplicaEvento(s0, { type: 'nuevo-evento-futuro', x: 1 })).toEqual(s0);
        expect(aplicaEvento(s0, { type: 'tarjetas', tarjetas: 'no-arreglo' })).toEqual(s0);
        expect(aplicaEvento(s0, { delta: 42 })).toEqual(s0);
    });
});
