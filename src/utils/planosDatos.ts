// ═══════════════════════════════════════════════════════════════════════════
// Puntos de entrada de los planos de la cuenca — puro
// ---------------------------------------------------------------------------
// Observado: la red JCAS (ModeloRedJcas), con sus pluviómetros sospechosos ya marcados. Pronóstico: los puntos de cuenca_puntos (JCAS + propias)
// con el consenso de los modelos. S/D = null en ambos casos: nunca se rellena con 0.
// ═══════════════════════════════════════════════════════════════════════════
import type { PuntoCampo } from './camposCuenca';
import { consensoPorPunto, direccionPronosticoPeriodo, valorPronosticoPeriodo, type FilaPronostico } from './cuencaPronostico';
import { valorObs, type ModeloRedJcas, type VentanaObs } from './jcasModelo';
import type { VariablePlano } from './paletasClima';

export interface PuntoCuenca { id: string; nombre: string; lat: number; lon: number; elevM: number | null; grupo: string | null; fuente: 'jcas' | 'weatherlink' }

export function puntosObservados(red: ModeloRedJcas, variable: VariablePlano, dias: VentanaObs): PuntoCampo[] {
    const jcas = red.puntos.map((p) => ({
        id: `jcas:${p.id}`, nombre: p.nombre, lat: p.lat, lon: p.lon, valor: valorObs(p, variable, dias), elevM: p.elevM, grupo: p.grupo,
        // solo la lluvia excluye al pluviómetro sospechoso: su temperatura, humedad y viento siguen siendo válidos
        sospechosa: variable === 'lluvia' ? p.sospechosa : false,
    }));
    // Las estaciones propias (WeatherLink) aportan lluvia, temperatura, humedad y viento con la MISMA definición de valor que JCAS (valorObs).
    // Un sensor no confiable (p. ej. Riego San Rafael) llega como null = S/D y no entra al plano. Sin elevación del DEM, no entran al ajuste por altitud.
    const propias = (red.propias ?? []).map((p) => ({ id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, valor: valorObs(p, variable, dias), elevM: null, grupo: null, propia: true }));
    return [...jcas, ...propias];
}

export function puntosPronostico(puntos: PuntoCuenca[], filas: FilaPronostico[], variable: VariablePlano, dias: 3 | 7, hoy: string): PuntoCampo[] {
    return puntos.map((p) => {
        const d = consensoPorPunto(filas, p.id, hoy);
        const { valor } = valorPronosticoPeriodo(d, variable, hoy, dias);
        return { id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, valor, elevM: p.elevM, grupo: p.grupo, dirDeg: variable === 'viento' ? direccionPronosticoPeriodo(d, hoy, dias) : null };
    });
}
