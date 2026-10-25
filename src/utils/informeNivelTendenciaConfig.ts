/**
 * informeNivelTendenciaConfig — configuración (filtros) del informe-infografía "Nivel y Tendencia de Presas".
 * Puro: sin React ni Supabase. Los años y presas se validan contra lo que realmente hay en el histórico.
 */
import { ID_BOQUILLA, ID_MADERO, type PresaId, type TipoSerie } from './historicoPresas';

export type SeccionNT = 'mismoDia' | 'curvas' | 'cierres' | 'calor';

export const SECCIONES_NT: { id: SeccionNT; etiqueta: string; ayuda: string }[] = [
    { id: 'mismoDia', etiqueta: 'Mismo día en años anteriores', ayuda: 'Valor de hoy frente a esa misma fecha en cada año' },
    { id: 'curvas', etiqueta: 'Curvas del mes por año', ayuda: 'El mes superpuesto año contra año' },
    { id: 'cierres', etiqueta: 'Cierre del mes por año', ayuda: 'Barras con el volumen al cierre de cada año' },
    { id: 'calor', etiqueta: 'Mapa de calor año × mes', ayuda: 'Todo el historial de un vistazo' },
];
export const ORDEN_SECCIONES_NT: SeccionNT[] = SECCIONES_NT.map(s => s.id);

export interface ConfigNivelTendencia {
    presas: PresaId[];
    anioBase: number;
    mes: number; // 1-12
    /** Años de comparación (sin incluir el año base). */
    aniosComparacion: number[];
    serie: TipoSerie;
    secciones: SeccionNT[];
}

export const TODAS_LAS_PRESAS: PresaId[] = [ID_BOQUILLA, ID_MADERO];

/** Por defecto: ambas presas, mes en curso, últimos 3 años de comparación y todas las secciones. */
export function configNTPorDefecto(anios: number[], hoy: Date = new Date()): ConfigNivelTendencia {
    const anioBase = hoy.getFullYear();
    return {
        presas: [...TODAS_LAS_PRESAS],
        anioBase,
        mes: hoy.getMonth() + 1,
        aniosComparacion: ultimosAnios(anios, anioBase, 3),
        serie: 'normalizada',
        secciones: [...ORDEN_SECCIONES_NT],
    };
}

/** Los `k` años más recientes anteriores al año base entre los disponibles (de más antiguo a más reciente). */
export function ultimosAnios(anios: number[], anioBase: number, k: number): number[] {
    return anios.filter(a => a < anioBase).sort((a, b) => b - a).slice(0, k).sort((a, b) => a - b);
}

/** Todos los años anteriores al base con histórico. */
export function todosLosAnios(anios: number[], anioBase: number): number[] {
    return ultimosAnios(anios, anioBase, anios.length);
}

export function validarConfigNT(c: ConfigNivelTendencia, anios: number[]): string[] {
    const e: string[] = [];
    if (c.presas.length === 0) e.push('Elige al menos una presa.');
    if (!anios.includes(c.anioBase)) e.push(`No hay histórico para ${c.anioBase}.`);
    if (!(c.mes >= 1 && c.mes <= 12)) e.push('Mes inválido.');
    return e;
}

export function avisosConfigNT(c: ConfigNivelTendencia, anios: number[]): string[] {
    const a: string[] = [];
    if (c.aniosComparacion.length === 0) a.push('Sin años de comparación: el informe mostrará solo el mes y el nivel actual.');
    if (c.aniosComparacion.some(y => !anios.includes(y))) a.push('Algún año elegido no tiene histórico y se omitirá.');
    if (c.serie === 'reportada') a.push('Serie "reportada": cifras tal como salieron en cada reporte, no comparables entre épocas de curva distintas.');
    return a;
}
