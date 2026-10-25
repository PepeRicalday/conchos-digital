import { beforeEach, describe, expect, it, vi } from 'vitest';

const asset = vi.hoisted(() => ({ cargar: vi.fn(async (ruta: string) => `data:x;base64,${ruta.length}`) }));
vi.mock('./assetToDataURI', () => ({ assetToDataURI: asset.cargar }));

import { RUTA_LOGO_SICA_INFORME, RUTA_LOGO_SRL_INFORME, cargarLogosInforme, reiniciarCacheLogos } from './logosInforme';
import { reiniciarCacheSupVol, cargarSupVolAnual } from './supVolAnual';

beforeEach(() => { reiniciarCacheLogos(); reiniciarCacheSupVol(); asset.cargar.mockClear(); });

describe('logos de informe: optimizados y con caché', () => {
    it('usa las versiones "-informe" (regeneradas al doble del tamaño efectivo) y las comparte entre generaciones', async () => {
        const a = await cargarLogosInforme();
        const b = await cargarLogosInforme();
        expect(b).toBe(a);
        expect(asset.cargar).toHaveBeenCalledTimes(2); // uno por logo, una sola vez
        expect(asset.cargar).toHaveBeenCalledWith(RUTA_LOGO_SRL_INFORME);
        expect(asset.cargar).toHaveBeenCalledWith(RUTA_LOGO_SICA_INFORME);
        expect(RUTA_LOGO_SRL_INFORME).toMatch(/-informe\.jpg$/); // el logo SRL es JPEG: la extensión ya no miente
    });
    it('un fallo de carga no se guarda: la siguiente generación vuelve a intentar', async () => {
        asset.cargar.mockResolvedValueOnce('').mockResolvedValueOnce('data:x;base64,ok');
        const a = await cargarLogosInforme();
        expect(a.srl).toBe('');
        const b = await cargarLogosInforme();
        expect(b.srl).not.toBe('');
        expect(asset.cargar.mock.calls.length).toBeGreaterThan(2);
    });
});

describe('superficie y volumen anual: consulta compartida', () => {
    const cliente = (resp: { data: unknown; error: { message: string } | null }) => {
        const limit = vi.fn(async () => resp);
        return { from: vi.fn(() => ({ select: vi.fn(() => ({ limit })) })), limit };
    };
    it('se consulta una sola vez y el resultado se comparte', async () => {
        const c = cliente({ data: [{ anio: 2024, numero_modulo: 1 }], error: null });
        const [a, b] = await Promise.all([cargarSupVolAnual(c as never), cargarSupVolAnual(c as never)]);
        expect(a).toBe(b);
        expect(c.from).toHaveBeenCalledTimes(1);
        expect(a.filas).toHaveLength(1);
    });
    it('un error se devuelve aparte (no es "sin datos") y no se cachea', async () => {
        const mal = cliente({ data: null, error: { message: 'RLS' } });
        const r = await cargarSupVolAnual(mal as never);
        expect(r).toEqual({ filas: [], error: 'RLS' });
        const bien = cliente({ data: [], error: null });
        expect((await cargarSupVolAnual(bien as never)).error).toBeNull();
    });
});
