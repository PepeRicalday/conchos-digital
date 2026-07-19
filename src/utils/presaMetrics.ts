/**
 * presaMetrics — Fuente única de verdad para métricas agregadas de presas.
 *
 * Motivo: Dashboard y Monitor Público calculaban almacenamiento y % de llenado
 * con reglas distintas (uno recalcula desde capacidad de catálogo, el otro lee
 * el porcentaje grabado), y ambos colapsaban "sin dato" a 0 con `|| 0`.
 * Eso producía el "0.0% con 28 m³/s de extracción" del Centro de Control.
 *
 * Regla rectora — "S/D nunca cero": un dato ausente y una medición de cero son
 * estados distintos y deben poder distinguirse en toda la cadena. Por eso las
 * funciones aquí devuelven `null` (no 0) cuando no hay lectura válida.
 */

/** Milisegundos por hora — para cálculo de antigüedad. */
const MS_HORA = 3_600_000;

export interface PresaLike {
    capacidad_max_mm3: number;
    lectura: {
        fecha?: string;
        almacenamiento_mm3?: number | null;
        porcentaje_llenado?: number | null;
        extraccion_total_m3s?: number | null;
    } | null;
}

export interface AlmacenamientoAgregado {
    /** Suma de almacenamiento de las presas CON lectura válida. `null` si ninguna la tiene. */
    totalMm3: number | null;
    /** Capacidad de las presas contabilizadas (no del catálogo completo). */
    capacidadContabilizadaMm3: number;
    /** Capacidad de todo el catálogo — referencia informativa. */
    capacidadCatalogoMm3: number;
    /** % de llenado sobre capacidad contabilizada. `null` si no hay dato. */
    porcentaje: number | null;
    /** Cuántas presas aportaron almacenamiento. */
    presasConDato: number;
    /** Total de presas en catálogo. */
    presasTotal: number;
    /** true si alguna presa del catálogo quedó fuera del cálculo. */
    parcial: boolean;
}

/**
 * Agrega almacenamiento excluyendo presas sin lectura.
 *
 * Excluir es deliberado: incluirlas con 0 mete su capacidad en el denominador
 * y hunde el porcentaje — el defecto exacto que mostraba 0.0% con 3180 Mm³ de
 * capacidad cuando ninguna presa tenía nivel capturado.
 */
export function agregarAlmacenamiento(presas: PresaLike[]): AlmacenamientoAgregado {
    const capacidadCatalogoMm3 = presas.reduce((acc, p) => acc + (p.capacidad_max_mm3 || 0), 0);

    const conDato = presas.filter(
        p => p.lectura != null &&
            p.lectura.almacenamiento_mm3 != null &&
            Number.isFinite(Number(p.lectura.almacenamiento_mm3))
    );

    if (conDato.length === 0) {
        return {
            totalMm3: null,
            capacidadContabilizadaMm3: 0,
            capacidadCatalogoMm3,
            porcentaje: null,
            presasConDato: 0,
            presasTotal: presas.length,
            parcial: presas.length > 0,
        };
    }

    const totalMm3 = conDato.reduce((acc, p) => acc + Number(p.lectura!.almacenamiento_mm3), 0);
    const capacidadContabilizadaMm3 = conDato.reduce((acc, p) => acc + (p.capacidad_max_mm3 || 0), 0);

    return {
        totalMm3,
        capacidadContabilizadaMm3,
        capacidadCatalogoMm3,
        porcentaje: capacidadContabilizadaMm3 > 0
            ? (totalMm3 / capacidadContabilizadaMm3) * 100
            : null,
        presasConDato: conDato.length,
        presasTotal: presas.length,
        parcial: conDato.length < presas.length,
    };
}

/**
 * % de llenado de UNA presa. Prioriza el cálculo derivado sobre el valor grabado,
 * porque la capacidad de catálogo es auditable y el porcentaje capturado depende
 * de qué curva EAC usó quien lo registró.
 */
export function porcentajeLlenadoPresa(presa: PresaLike): number | null {
    const alm = presa.lectura?.almacenamiento_mm3;
    if (alm != null && Number.isFinite(Number(alm)) && presa.capacidad_max_mm3 > 0) {
        return (Number(alm) / presa.capacidad_max_mm3) * 100;
    }
    const grabado = presa.lectura?.porcentaje_llenado;
    if (grabado != null && Number.isFinite(Number(grabado))) return Number(grabado);
    return null;
}

export interface Frescura {
    /** Texto listo para UI, ej. "Lectura del 18 Jul · hace 1 día". */
    texto: string;
    /** true si supera el umbral de antigüedad. */
    stale: boolean;
    horas: number | null;
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * Sello de vigencia de una lectura. Sin esto, una captura de hace cinco días
 * se presenta idéntica a una de hace cinco minutos.
 *
 * @param umbralHoras Horas a partir de las cuales el dato se marca como viejo.
 */
export function calcularFrescura(
    fechaISO: string | null | undefined,
    umbralHoras = 24
): Frescura | null {
    if (!fechaISO) return null;

    // Acepta "YYYY-MM-DD" y timestamps completos.
    const ts = fechaISO.includes('T')
        ? new Date(fechaISO).getTime()
        : new Date(`${fechaISO}T12:00:00`).getTime();

    if (!Number.isFinite(ts)) return null;

    const horas = (Date.now() - ts) / MS_HORA;
    const partes = fechaISO.slice(0, 10).split('-');
    const etiquetaFecha = partes.length === 3
        ? `${parseInt(partes[2], 10)} ${MESES[parseInt(partes[1], 10) - 1] ?? ''}`
        : fechaISO.slice(0, 10);

    let relativo: string;
    if (horas < 1) relativo = 'hace minutos';
    else if (horas < 24) relativo = `hace ${Math.floor(horas)} h`;
    else {
        const dias = Math.floor(horas / 24);
        relativo = `hace ${dias} día${dias === 1 ? '' : 's'}`;
    }

    return {
        texto: `Lectura del ${etiquetaFecha} · ${relativo}`,
        stale: horas > umbralHoras,
        horas,
    };
}

/** Fecha de la lectura más reciente entre varias presas. */
export function lecturaMasReciente(presas: PresaLike[]): string | null {
    const fechas = presas
        .map(p => p.lectura?.fecha)
        .filter((f): f is string => !!f)
        .sort();
    return fechas.length > 0 ? fechas[fechas.length - 1] : null;
}
