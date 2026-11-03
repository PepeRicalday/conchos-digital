/**
 * estadoAnio — catálogo ÚNICO de lo que significa cada año en el panel «Consumo por cultivo» y en los informes NDVI.
 *
 *  - con-informe: 2020-2024. Tienen renglones del informe ACUM_INF. Entran a la mediana, al rango, al ajuste y al contraste.
 *  - sin-ciclo:   2025. Las presas no se abrieron: no hubo ciclo de riego. No es un dato faltante (nunca «S/D», nunca 0).
 *                 Queda fuera de promedios, medianas, rangos, contraste y ajuste volumen–NDVI. Su NDVI de satélite sí se
 *                 muestra, rotulado «sin riego de presa».
 *  - provisional: 2026. Volumen de la hoja SRL (mar–sep): se muestra y se compara, pero no entra a la mediana ni al ajuste.
 *  - sd:          solo faltantes reales (p. ej. el NDVI de 2020, anterior a la serie de satélite).
 */
export type EstadoAnioId = 'con-informe' | 'sin-ciclo' | 'provisional' | 'sd';

export const ANIO_INFORME_INI = 2020;
export const ANIO_INFORME_FIN = 2024;
export const ANIOS_SIN_CICLO: readonly number[] = [2025];
export const ANIO_PROVISIONAL = 2026;
/** «2020-2024», derivado del catálogo (no se escribe a mano en los textos). */
export const RANGO_INFORME = `${ANIO_INFORME_INI}-${ANIO_INFORME_FIN}`;
/** Años con informe, ascendentes. */
export const ANIOS_CON_INFORME: readonly number[] = Array.from({ length: ANIO_INFORME_FIN - ANIO_INFORME_INI + 1 }, (_, i) => ANIO_INFORME_INI + i);

export interface EstadoAnio {
    id: EstadoAnioId;
    /** Rótulo corto del año en botones y encabezados. */
    etiqueta: string;
    /** Entra a la mediana, al rango y al contraste. */
    entraAMediana: boolean;
    /** Entra al ajuste volumen–NDVI. */
    entraAAjuste: boolean;
    /** Tiene volumen y superficie propios que mostrar. */
    tieneVolumen: boolean;
}

const CATALOGO: Record<EstadoAnioId, EstadoAnio> = {
    'con-informe': { id: 'con-informe', etiqueta: 'Con informe', entraAMediana: true, entraAAjuste: true, tieneVolumen: true },
    'sin-ciclo': { id: 'sin-ciclo', etiqueta: 'Sin ciclo: presas cerradas', entraAMediana: false, entraAAjuste: false, tieneVolumen: false },
    provisional: { id: 'provisional', etiqueta: 'Provisional (hoja SRL)', entraAMediana: false, entraAAjuste: false, tieneVolumen: true },
    sd: { id: 'sd', etiqueta: 'S/D', entraAMediana: false, entraAAjuste: false, tieneVolumen: false },
};

/**
 * Estado de un año. `faltante` = true marca un faltante real (p. ej. NDVI de 2020): da 'sd'. Un año sin ciclo nunca es 'sd'.
 * Los años anteriores a 2020 que lleguen en los datos se tratan como con informe (la fuente manda); los posteriores a 2026, como provisionales.
 */
export function estadoAnio(anio: number, faltante = false): EstadoAnio {
    if (ANIOS_SIN_CICLO.includes(anio)) return CATALOGO['sin-ciclo'];
    if (faltante) return CATALOGO.sd;
    if (anio >= ANIO_PROVISIONAL) return CATALOGO.provisional;
    return CATALOGO['con-informe'];
}

export const esAnioSinCiclo = (anio: number): boolean => estadoAnio(anio).id === 'sin-ciclo';

/** Rótulo de un año para botones: «2025 · Sin ciclo», «2026 · Provisional», «2024». */
export function rotuloAnio(anio: number): string {
    const e = estadoAnio(anio);
    return e.id === 'sin-ciclo' ? `${anio} · Sin ciclo` : e.id === 'provisional' ? `${anio} · Provisional` : String(anio);
}

/** Texto único que explica por qué un año sin ciclo no tiene volumen ni superficie. */
export const TEXTO_SIN_CICLO = 'Sin ciclo: las presas no se abrieron, no hubo riego de presa. No es un dato faltante.';

/** «2020, 2021 y 2023», «2020». */
export function listaAnios(anios: number[]): string {
    if (anios.length <= 1) return anios.join('');
    return `${anios.slice(0, -1).join(', ')} y ${anios[anios.length - 1]}`;
}
