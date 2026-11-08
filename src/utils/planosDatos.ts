// ═══════════════════════════════════════════════════════════════════════════
// Puntos de entrada de los planos de la cuenca — puro
// ---------------------------------------------------------------------------
// Observado: la red JCAS (ModeloRedJcas), con sus pluviómetros sospechosos ya marcados. Pronóstico: los puntos de cuenca_puntos (JCAS + propias)
// con el consenso de los modelos. S/D = null en ambos casos: nunca se rellena con 0.
// ═══════════════════════════════════════════════════════════════════════════
import type { PuntoCampo } from './camposCuenca';
import { consensoPorPunto, valorPronosticoPeriodo, type FilaPronostico } from './cuencaPronostico';
import { valorObs, type ModeloRedJcas, type VentanaObs } from './jcasModelo';
import type { VariablePlano } from './paletasClima';

export interface PuntoCuenca { id: string; nombre: string; lat: number; lon: number; elevM: number | null; grupo: string | null; fuente: 'jcas' | 'weatherlink' }

export function puntosObservados(red: ModeloRedJcas, variable: VariablePlano, dias: VentanaObs): PuntoCampo[] {
    return red.puntos.map((p) => ({
        id: `jcas:${p.id}`, nombre: p.nombre, lat: p.lat, lon: p.lon, valor: valorObs(p, variable, dias), elevM: p.elevM, grupo: p.grupo,
        // solo la lluvia excluye al pluviómetro sospechoso: su temperatura, humedad y viento siguen siendo válidos
        sospechosa: variable === 'lluvia' ? p.sospechosa : false,
    }));
}

export function puntosPronostico(puntos: PuntoCuenca[], filas: FilaPronostico[], variable: VariablePlano, dias: 3 | 7, hoy: string): PuntoCampo[] {
    return puntos.map((p) => {
        const d = consensoPorPunto(filas, p.id, hoy);
        const { valor } = valorPronosticoPeriodo(d, variable, hoy, dias);
        return { id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, valor, elevM: p.elevM, grupo: p.grupo };
    });
}
