import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import type { BaseJuicio, EstadoVerif } from '../../../conservacion/verificacion/tipos';
import { describirEstado, desdeVerif, nombreConcepto, nombreModulo, siglaAmbito, type ContextoConcepto } from '../../../conservacion/vocabulario';

/** Un dato ausente se muestra "S/D", nunca 0. */
export function fmt(valor: string | null | undefined, decimales = 2): string {
    if (valor === null || valor === undefined) return 'S/D';
    const n = Number(valor);
    if (!Number.isFinite(n)) return 'S/D';
    return n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: decimales });
}

/** Identificador corto del ámbito de un PacOT: "SRL" o "M5". */
export const etiquetaAmbito = (p: PacotRegistrado): string => siglaAmbito(p.ficha);

/** Etiqueta canónica del estado (vocabulario único): cuadra→Coherente, no_cuadra→No cuadra, etc. */
export const TEXTO_ESTADO_VERIF: Readonly<Record<EstadoVerif, string>> = {
    cuadra: describirEstado(desdeVerif('cuadra')).corta, atipico: describirEstado(desdeVerif('atipico')).corta,
    no_cuadra: describirEstado(desdeVerif('no_cuadra')).corta, no_evaluable: describirEstado(desdeVerif('no_evaluable')).corta,
    informativo: describirEstado(desdeVerif('informativo')).corta,
};

/** Nombre canónico del ámbito de un PacOT: «Módulo 5» o «SRL Unidad Conchos» (el texto del libro va en `title`). */
export const nombrePacot = (p: PacotRegistrado): string => nombreModulo(p.ficha);

/** Sustituye, dentro de un texto generado por el motor, los rótulos del libro por su nombre canónico (el texto original va en `title`). */
export function canonizarTexto(texto: string, rotulos: readonly string[], contexto: ContextoConcepto = {}): string {
    let t = texto;
    for (const r of [...new Set(rotulos)].filter((x) => x.length > 2).sort((a, b) => b.length - a.length)) {
        const c = nombreConcepto(r, contexto).canonico;
        if (c !== r && t.includes(r)) t = t.split(r).join(c);
    }
    return t;
}

export const TEXTO_BASE: Readonly<Record<BaseJuicio, string>> = {
    integridad: 'Integridad', criterio_libro: 'Criterio del libro', norma: 'Norma', referencia_tecnica: 'Referencia técnica',
};
export const AYUDA_BASE: Readonly<Record<BaseJuicio, string>> = {
    integridad: 'Aritmética y enlaces entre hojas del propio libro. No depende de ningún criterio.',
    criterio_libro: 'Lo que el libro hace en la mayoría de sus tramos. Es su criterio, no una exigencia de la norma.',
    norma: 'Umbral que fijan el Manual de Conservación 2026 o sus Anexos.',
    referencia_tecnica: 'Práctica general de ingeniería, fuera del corpus normativo. Informativa.',
};
