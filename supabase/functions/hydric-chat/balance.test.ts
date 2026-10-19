import { describe, it, expect } from 'vitest';
import { balanceTramos, clasificaEficiencia, resumenBalance, tomasEntre, type EscalaQ } from './balance';

const e = (nombre: string, km: number, gasto: number | null, referencia = false): EscalaQ => ({ nombre, km, gasto, referencia });

describe('clasificaEficiencia (mismas bandas que la app)', () => {
    it('95/90/80', () => {
        expect(clasificaEficiencia(100)).toBe('optimo');
        expect(clasificaEficiencia(95)).toBe('optimo');
        expect(clasificaEficiencia(94.9)).toBe('atencion');
        expect(clasificaEficiencia(90)).toBe('atencion');
        expect(clasificaEficiencia(89.9)).toBe('alerta');
        expect(clasificaEficiencia(80)).toBe('alerta');
        expect(clasificaEficiencia(79.9)).toBe('critico');
    });
});

describe('balanceTramos', () => {
    it('balance normal con tomas', () => {
        const [t] = balanceTramos([e('K-0', 0, 10), e('K-23', 23, 8)], [{ nombre: 'T1', km: 10, caudal: 1.5 }]);
        expect(t).toMatchObject({ q_entrada: 10, q_salida: 8, q_tomas: 1.5, q_perdidas: 0.5, eficiencia: 95, estado: 'optimo' });
    });
    it('S/D: un extremo sin gasto NO se toma como 0 ni fabrica una fuga', () => {
        const [t] = balanceTramos([e('K-0', 0, 10), e('K-23', 23, null)], []);
        expect(t).toMatchObject({ estado: 'sin_dato', q_perdidas: null, eficiencia: null, q_salida: null });
    });
    it('canal cerrado medido (Qe=0) ≠ sin dato', () => {
        const [t] = balanceTramos([e('K-0', 0, 0), e('K-23', 23, 0)], []);
        expect(t.estado).toBe('cerrado');
    });
    it('salidas > entradas = anómalo, sin pérdida inventada', () => {
        const [t] = balanceTramos([e('K-0', 0, 5), e('K-23', 23, 6)], []);
        expect(t).toMatchObject({ estado: 'anomalo', q_perdidas: null });
    });
    it('las escalas de referencia no cortan tramos', () => {
        const t = balanceTramos([e('K-62', 62, 10), e('K-64', 64, 53, true), e('K-68', 68, 9)], []);
        expect(t).toHaveLength(1);
        expect(t[0]).toMatchObject({ de: 'K-62', a: 'K-68', estado: 'atencion' });   // 9/10 = 90 %
    });
    it('la toma en el km final entra solo en el último tramo', () => {
        const tomas = [{ nombre: 'Fin', km: 104, caudal: 1 }];
        expect(tomasEntre(tomas, 94, 104, true)).toBe(1);
        expect(tomasEntre(tomas, 94, 104, false)).toBe(0);
        const t = balanceTramos([e('A', 0, 10), e('B', 50, 9), e('C', 104, 8)], tomas);
        expect(t[0].q_tomas).toBe(0);
        expect(t[1].q_tomas).toBe(1);
    });
    it('resumen cuenta cada estado', () => {
        const t = balanceTramos([e('A', 0, 10), e('B', 20, 5), e('C', 40, null), e('D', 60, 4)], []);
        expect(resumenBalance(t)).toMatchObject({ tramos: 3, sinDato: 2, fugas: 1 });
    });
    it('tomas DESCONOCIDAS (null): no se inventan fugas; solo se afirma la cota inferior de eficiencia', () => {
        const [t] = balanceTramos([e('K-0', 0, 10), e('K-23', 23, 8)], null);
        expect(t).toMatchObject({ estado: 'tomas_sd', q_tomas: null, q_perdidas: null, eficiencia: null, q_tomas_mas_perdidas: 2 });
        const [seguro] = balanceTramos([e('K-0', 0, 10), e('K-23', 23, 9.8)], null);
        expect(seguro).toMatchObject({ estado: 'optimo', eficiencia: 98, q_tomas: null });   // aun sin tomas, la eficiencia real es ≥ 98 %
        const [anomalo] = balanceTramos([e('K-0', 0, 5), e('K-23', 23, 6)], null);
        expect(anomalo.estado).toBe('anomalo');
    });
    it('tomas conocidas pero vacías ([]) sí significan "cero tomas" y clasifican la pérdida', () => {
        const [t] = balanceTramos([e('K-0', 0, 10), e('K-23', 23, 7)], []);
        expect(t).toMatchObject({ q_tomas: 0, q_perdidas: 3, eficiencia: 70, estado: 'critico' });
    });
    it('el resumen separa los tramos con tomas S/D', () => {
        const t = balanceTramos([e('A', 0, 10), e('B', 20, 8), e('C', 40, 7)], null);
        expect(resumenBalance(t)).toMatchObject({ tramos: 2, tomasSd: 2, fugas: 0 });
    });
    it('menos de dos escalas de control => sin tramos', () => {
        expect(balanceTramos([e('K-0', 0, 5)], [])).toEqual([]);
    });
});
