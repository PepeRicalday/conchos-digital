import { describe, expect, it } from 'vitest';
import { cambioTempDeAlertas } from './informePronosticoDatos';
import type { AlertaClima } from '../hooks/useClimaOperativo';

// Formato real que arma fn_clima_alertas_agro: "<etiqueta>: <valor> °C (umbral …≥ N °C). [ahora: X · pronóstico: Y °C]. <acción>"
const alerta = (origen: string, tipo: string, valor: string, procedencia: string, titulo = 'Descenso brusco de temperatura · Red de estaciones (5 coinciden)'): AlertaClima => ({
    id: 'a', tipoRiesgo: tipo, categoria: 'agroclimatica', titulo, origenId: origen, detectadaEn: '2026-10-16T18:00:00Z',
    mensaje: `Descenso brusco de temperatura (cambio en 24 h, observado o pronóstico 48 h): ${valor} °C (umbral crítico ≥ 12 °C). ${procedencia}. Proteger cultivos.`,
});
const U = '00000000-0000-0000-0000-000000000000';

describe('cambioTempDeAlertas', () => {
    it('lee grados, procedencia y estaciones del mensaje real', () => {
        const c = cambioTempDeAlertas([alerta(`CLIMA-descenso-${U}`, 'critical', '13.1', '[ahora: 10.4 · pronóstico: 13.1 °C]')]);
        expect(c).toMatchObject({ sentido: 'descenso', nivel: 'critico', gradosC: 13.1, obsC: 10.4, fcC: 13.1, estaciones: 5 });
    });
    it('S/D queda null, nunca 0', () => {
        const c = cambioTempDeAlertas([alerta(`CLIMA-ascenso-${U}`, 'warning', '8.6', '[ahora: S/D · pronóstico: 8.6 °C]')]);
        expect(c).toMatchObject({ sentido: 'ascenso', nivel: 'aviso', obsC: null, fcC: 8.6 });
    });
    it('sin alerta de cambio devuelve null y no confunde otras claves', () => {
        expect(cambioTempDeAlertas([])).toBeNull();
        expect(cambioTempDeAlertas([alerta(`CLIMA-helada-${U}`, 'warning', '3', '[ahora: 3 · pronóstico: 2 °C]')])).toBeNull();
    });
    it('con descenso y ascenso conserva el más severo', () => {
        const c = cambioTempDeAlertas([
            alerta(`CLIMA-ascenso-${U}`, 'warning', '9.0', '[ahora: S/D · pronóstico: 9.0 °C]'),
            alerta(`CLIMA-descenso-${U}`, 'critical', '13.1', '[ahora: 10.4 · pronóstico: 13.1 °C]'),
        ]);
        expect(c?.sentido).toBe('descenso');
    });
});
