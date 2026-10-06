/**
 * eficienciaCanal — clasificación ÚNICA de la eficiencia de conducción K-0→K-104 para todas las pantallas.
 *
 * El número sale de utils/conduccion.ts (Qs/Qe, S/D si falta un extremo vigente). Aquí solo se decide cómo se
 * rotula: los cortes 95/90/80 son los de getEfficiencyStatus (hydraulics.ts), de modo que Dashboard, Hidrometría,
 * Distribución y Balance nunca discrepen. Nunca produce "0 %" ni "538 %": o es un valor real, o S/D, o inconsistente.
 */
import { getEfficiencyStatus } from './hydraulics';
import type { ConduccionTramo } from './conduccion';

export type EstadoVisual = 'ok' | 'warn' | 'crit' | 'sd' | 'info';
export type NivelConduccion = 'optimo' | 'atencion' | 'alerta' | 'critico' | 'sd' | 'inconsistente';

export interface ClasificacionConduccion {
    nivel: NivelConduccion;
    /** Texto corto para chips/estado (siempre acompaña al color). */
    etiqueta: string;
    estado: EstadoVisual;
    /** Frase para lectores de pantalla y subtítulos. */
    descripcion: string;
    /** true solo si hay evidencia de pérdida real (tramo completo y eficiencia bajo el corte de alerta). */
    hayFuga: boolean;
}

export function clasificaConduccion(c: ConduccionTramo): ClasificacionConduccion {
    if (c.incoherente) {
        return { nivel: 'inconsistente', etiqueta: 'Dato inconsistente', estado: 'info', hayFuga: false,
            descripcion: 'La salida supera a la entrada: aforos desfasados o error de lectura. No es una eficiencia real.' };
    }
    if (!c.completo || c.eficienciaPct == null) {
        return { nivel: 'sd', etiqueta: 'S/D', estado: 'sd', hayFuga: false,
            descripcion: 'Balance no confiable: requiere K-0 y K-104 con lectura vigente (≤ 4 h) y gasto mayor que cero.' };
    }
    const s = getEfficiencyStatus(c.eficienciaPct);
    const estado: EstadoVisual = s.nivel === 'optimo' ? 'ok' : s.nivel === 'atencion' ? 'warn' : 'crit';
    return { nivel: s.nivel as NivelConduccion, etiqueta: s.label, estado, hayFuga: s.nivel === 'alerta' || s.nivel === 'critico',
        descripcion: `Eficiencia de conducción ${c.eficienciaPct.toFixed(1)} %: ${s.label}.` };
}

/**
 * Compara lo entregado a módulos contra lo que entra por K-0. Entrega mayor que entrada no es físicamente posible
 * como eficiencia: se informa como inconsistencia (otra fuente, otra ventana de tiempo o un error), no como un porcentaje.
 */
export function relacionEntregaEntrada(entregaM3s: number | null | undefined, entradaM3s: number | null | undefined):
    { estado: 'sd' | 'coherente' | 'inconsistente'; exceso: number | null } {
    if (entregaM3s == null || entradaM3s == null || !Number.isFinite(entregaM3s) || !Number.isFinite(entradaM3s) || entradaM3s <= 0) {
        return { estado: 'sd', exceso: null };
    }
    return entregaM3s > entradaM3s * 1.02
        ? { estado: 'inconsistente', exceso: entregaM3s - entradaM3s }
        : { estado: 'coherente', exceso: null };
}
