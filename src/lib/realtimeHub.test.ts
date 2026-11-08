import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El hub crea un solo canal de Supabase con un handler por tabla/evento; aquí se captura para disparar eventos a mano.
const entregar: Record<string, (p: unknown) => void> = {};
vi.mock('./supabase', () => {
    const canal: { on: (t: string, c: { table: string; event: string }, cb: (p: unknown) => void) => typeof canal; subscribe: () => typeof canal } = {
        on: (_t, c, cb) => { entregar[`${c.table}:${c.event}`] = cb; return canal; },
        subscribe: () => canal,
    };
    return { supabase: { channel: () => canal, removeChannel: () => {} } };
});

import { onTable, onTableCoalesced, startHub } from './realtimeHub';

const evento = (tabla: string, tipo = 'INSERT') => entregar[`${tabla}:*`]({ eventType: tipo });

describe('realtimeHub — eventos agrupados', () => {
    beforeEach(() => { vi.useFakeTimers(); startHub(); });
    afterEach(() => { vi.useRealTimers(); });

    it('una ráfaga de 14 eventos (carga por lote de las escalas) dispara el handler UNA vez, al terminar', () => {
        const h = vi.fn();
        const baja = onTableCoalesced('lecturas_escalas', '*', h, 1500);
        for (let i = 0; i < 14; i++) { evento('lecturas_escalas'); vi.advanceTimersByTime(100); }
        expect(h).not.toHaveBeenCalled();           // sigue llegando la ráfaga
        vi.advanceTimersByTime(1500);
        expect(h).toHaveBeenCalledTimes(1);
        baja();
    });

    it('varios hooks sobre la misma tabla comparten el temporizador: cada uno corre una vez por ráfaga', () => {
        const canal = vi.fn(), volumen = vi.fn(), fugas = vi.fn();
        const bajas = [canal, volumen, fugas].map((h) => onTableCoalesced('lecturas_escalas', '*', h, 1500));
        for (let i = 0; i < 5; i++) evento('lecturas_escalas');
        vi.advanceTimersByTime(1500);
        expect([canal, volumen, fugas].map((h) => h.mock.calls.length)).toEqual([1, 1, 1]);
        bajas.forEach((b) => b());
    });

    it('dos ráfagas separadas disparan dos veces', () => {
        const h = vi.fn();
        const baja = onTableCoalesced('lecturas_presas', '*', h, 1000);
        evento('lecturas_presas'); vi.advanceTimersByTime(1000);
        evento('lecturas_presas'); vi.advanceTimersByTime(1000);
        expect(h).toHaveBeenCalledTimes(2);
        baja();
    });

    it('al desuscribirse no se ejecuta y se libera el temporizador; un handler que falla no impide a los demás', () => {
        const a = vi.fn(), roto = vi.fn(() => { throw new Error('boom'); }), c = vi.fn();
        const bajaA = onTableCoalesced('aforos', '*', a, 800);
        const bajaRoto = onTableCoalesced('aforos', '*', roto, 800);
        const bajaC = onTableCoalesced('aforos', '*', c, 800);
        bajaA();
        evento('aforos'); vi.advanceTimersByTime(800);
        expect(a).not.toHaveBeenCalled();
        expect(roto).toHaveBeenCalledTimes(1);
        expect(c).toHaveBeenCalledTimes(1);          // el que falló no detuvo al siguiente
        bajaRoto(); bajaC();
        evento('aforos'); vi.advanceTimersByTime(800);
        expect(c).toHaveBeenCalledTimes(1);          // ya sin handlers: nada corre
    });

    it('onTable sigue entregando cada evento sin agrupar (no cambia el comportamiento de los demás consumidores)', () => {
        const h = vi.fn();
        const baja = onTable('modulos', '*', h);
        evento('modulos'); evento('modulos'); evento('modulos');
        expect(h).toHaveBeenCalledTimes(3);
        baja();
    });
});
