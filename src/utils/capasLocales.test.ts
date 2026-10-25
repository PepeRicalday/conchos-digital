import { describe, expect, it } from 'vitest';
import { capasLocalesAbiertas, cerrarCapaSuperior, registrarCapaLocal } from './capasLocales';

describe('capas locales (Escape: primero el tooltip, luego el modal)', () => {
    it('sin capas, Escape no se atiende y el modal debe cerrarse', () => {
        expect(capasLocalesAbiertas()).toBe(0);
        expect(cerrarCapaSuperior()).toBe(false);
    });

    it('con una capa abierta, la cierra y devuelve true; el segundo Escape ya llega al modal', () => {
        let abierto = true;
        const quitar = registrarCapaLocal(() => { abierto = false; quitar(); });
        expect(cerrarCapaSuperior()).toBe(true);
        expect(abierto).toBe(false);
        expect(cerrarCapaSuperior()).toBe(false);
    });

    it('atiende la capa más reciente primero (pila)', () => {
        const orden: string[] = [];
        const qa = registrarCapaLocal(() => { orden.push('a'); qa(); });
        const qb = registrarCapaLocal(() => { orden.push('b'); qb(); });
        expect(cerrarCapaSuperior()).toBe(true);
        expect(cerrarCapaSuperior()).toBe(true);
        expect(cerrarCapaSuperior()).toBe(false);
        expect(orden).toEqual(['b', 'a']);
    });

    it('retirar una capa dos veces es inocuo y no quita las demás', () => {
        const q1 = registrarCapaLocal(() => {});
        const q2 = registrarCapaLocal(() => {});
        q1(); q1();
        expect(capasLocalesAbiertas()).toBe(1);
        q2();
        expect(capasLocalesAbiertas()).toBe(0);
    });
});
