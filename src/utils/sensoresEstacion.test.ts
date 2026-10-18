import { describe, expect, it } from 'vitest';
import { sensoresLegibles } from './sensoresEstacion';

describe('sensoresLegibles', () => {
    it('agrupa las columnas de Riego San Rafael en palabras', () => {
        const cols = ['temp_c', 'temp_max_c', 'temp_min_c', 'hum_rel_pct', 'punto_rocio_c', 'viento_ms', 'viento_dir_deg', 'viento_rafaga_ms', 'et_dia_mm', 'et_mes_mm', 'eto_mm', 'gdd'];
        expect(sensoresLegibles(cols)).toBe('temperatura, humedad, viento y ETₒ y grados-día');
    });
    it('un solo sensor no lleva conjunción', () => {
        expect(sensoresLegibles(['hum_rel_pct'])).toBe('humedad');
    });
    it('sin sensores malos devuelve vacío (null, undefined o lista vacía)', () => {
        expect(sensoresLegibles(null)).toBe('');
        expect(sensoresLegibles(undefined)).toBe('');
        expect(sensoresLegibles([])).toBe('');
    });
    it('ignora columnas desconocidas', () => {
        expect(sensoresLegibles(['presion_hpa', 'lluvia_dia_mm'])).toBe('');
    });
});
