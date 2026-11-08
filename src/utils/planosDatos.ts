// ═══════════════════════════════════════════════════════════════════════════
// Puntos de entrada de los planos de la cuenca — puro
// ---------------------------------------------------------------------------
// Observado: la red JCAS (ModeloRedJcas), con sus pluviómetros sospechosos ya marcados. Pronóstico: los puntos de cuenca_puntos (JCAS + propias)
// con el consenso de los modelos. S/D = null en ambos casos: nunca se rellena con 0.
// ═══════════════════════════════════════════════════════════════════════════
import type { PuntoCampo } from './camposCuenca';
import { consensoPorPunto, valorPronosticoPeriodo, type FilaPronostico } from './cuencaPronostico';
import type { ModeloRedJcas } from './jcasModelo';
import type { VariablePlano } from './paletasClima';

export interface PuntoCuenca { id: string; nombre: string; lat: number; lon: number; elevM: number | null; grupo: string | null; fuente: 'jcas' | 'weatherlink' }

export function puntosObservados(red: ModeloRedJcas, variable: VariablePlano, dias: 7 | 30): PuntoCampo[] {
    return red.puntos.map((p) => {
        const m = p.medias;
        const valor = variable === 'lluvia' ? (dias === 7 ? p.mm7 : p.mm30)
            : variable === 'temperatura' ? (dias === 7 ? m.temp7 : m.temp30)
            : variable === 'viento' ? (dias === 7 ? m.viento7 : m.viento30)
            : (dias === 7 ? m.hum7 : m.hum30);
        return {
            id: `jcas:${p.id}`, nombre: p.nombre, lat: p.lat, lon: p.lon, valor, elevM: p.elevM, grupo: p.grupo,
            // solo la lluvia excluye al pluviómetro sospechoso: su temperatura, humedad y viento siguen siendo válidos
            sospechosa: variable === 'lluvia' ? p.sospechosa : false,
        };
    });
}

export function puntosPronostico(puntos: PuntoCuenca[], filas: FilaPronostico[], variable: VariablePlano, dias: 3 | 7, hoy: string): PuntoCampo[] {
    return puntos.map((p) => {
        const d = consensoPorPunto(filas, p.id, hoy);
        const { valor } = valorPronosticoPeriodo(d, variable, hoy, dias);
        return { id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, valor, elevM: p.elevM, grupo: p.grupo };
    });
}
