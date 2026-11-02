import { describe, it, expect } from 'vitest';
import { diasCiclo } from './dashboardKpisEjecutivos';

describe('diasCiclo', () => {
    it('sin fechas = null (S/D)', () => { expect(diasCiclo('2026-11-02', null, '2026-09-30')).toBeNull(); expect(diasCiclo('2026-11-02', '2025-10-01', undefined)).toBeNull(); });
    it('fechas invertidas = null', () => expect(diasCiclo('2026-01-01', '2026-02-01', '2026-01-01')).toBeNull());
    it('ciclo en curso cuenta ambos extremos', () => {
        const d = diasCiclo('2026-01-10', '2026-01-01', '2026-01-31')!;
        expect(d.total).toBe(31); expect(d.transcurridos).toBe(10); expect(d.restantes).toBe(21); expect(d.concluido).toBe(false);
    });
    it('ciclo concluido informa hace cuántos días', () => {
        const d = diasCiclo('2026-11-02', '2025-10-01', '2026-09-29')!;
        expect(d.concluido).toBe(true); expect(d.restantes).toBe(0); expect(d.haceDias).toBe(34);
    });
    it('aún no inicia: 0 transcurridos', () => expect(diasCiclo('2025-09-01', '2025-10-01', '2026-09-30')!.transcurridos).toBe(0));
});
