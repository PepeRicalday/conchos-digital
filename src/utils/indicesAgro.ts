// ═══════════════════════════════════════════════════════════════════════════
// Índices agroclimáticos del distrito — SICA-005
// ---------------------------------------------------------------------------
// Cuatro indicadores 0-100 que resumen el estado operativo para la gerencia.
// Cada uno se deriva de datos MEDIDOS o PRONOSTICADOS, con fórmula explícita y
// procedencia declarada: un índice sin fórmula visible no es auditable y no
// debería sustentar decisiones de entrega de agua.
//
// Regla transversal del módulo: cuando falta la entrada de un índice, el índice
// vale null y se muestra "S/D" — nunca un 0 que se leería como "riesgo nulo".
// ═══════════════════════════════════════════════════════════════════════════

import type { EstacionConLectura } from '../hooks/useClimaEstaciones';

export interface Indice {
    clave: 'ICA' | 'IDR' | 'IRO' | 'IHE';
    nombre: string;
    descripcion: string;
    /** 0-100, o null si no hay datos suficientes. */
    valor: number | null;
    /** Clasificación cualitativa para la etiqueta bajo el medidor. */
    etiqueta: string;
    /** Color del arco (semántico, acompañado siempre de la etiqueta de texto). */
    color: string;
    /** Fórmula legible, se imprime en la metodología del informe. */
    formula: string;
    /** De dónde salen las entradas. */
    procedencia: string;
    /**
     * Qué implica el valor para la operación. Un número sin consecuencia obliga
     * al lector a conocer la escala; esto la traduce ("vigilar", "sin ajuste").
     */
    implicacion: string;
}

// Colores de estado (paleta validada; siempre acompañados de etiqueta textual)
const C_BUENO = '#0ca30c', C_AVISO = '#d98704', C_SERIO = '#ec835a', C_CRITICO = '#d03b3b';

/** ETₒ de referencia máxima del ciclo en el DR-005 (verano, demanda pico). */
const ETO_MAX_REF = 9.0;

export interface EntradasIndices {
    /** ETₒ TOTAL del día (mm), del modelo. No el acumulado parcial. */
    etoDiario: number | null;
    /** Cobertura nubosa media del distrito (0-100), o null sin fuente. */
    nubosidadPct: number | null;
    /** Probabilidad máxima de lluvia en 24 h (0-100). */
    probLluviaPct: number | null;
    /** Lámina prevista en 24 h (mm). */
    lluviaPrevMm: number | null;
    /** Lluvia observada acumulada del día (mm). */
    lluviaObsMm: number;
    /** HR media observada (%). */
    hrPct: number | null;
    /** Viento máximo observado (m/s). */
    vientoMaxMs: number | null;
    /** Estaciones con lectura utilizable / total. */
    estacionesOk: number;
    estacionesTotal: number;
}

/** Extrae las entradas de los índices desde el estado de las estaciones. */
export function entradasDesdeEstaciones(
    ests: EstacionConLectura[], etoDiario: number | null,
): EntradasIndices {
    const conLectura = ests.filter(e => e.lectura);
    const hrs = conLectura.map(e => e.lectura!.hum_rel_pct).filter((v): v is number => v != null);
    const vientos = conLectura.map(e => e.lectura!.viento_ms).filter((v): v is number => v != null);
    const cobs = ests.map(e => e.cielo.coberturaPct).filter((v): v is number => v != null);
    const probs = ests.flatMap(e => e.pronosticoSerie
        .filter(p => (p.horizonte_h ?? 99) <= 24)
        .map(p => p.precip_prob_pct)).filter((v): v is number => v != null);
    const mms = ests.map(e => e.pronosticoSerie
        .filter(p => (p.horizonte_h ?? 99) <= 24)
        .reduce((a, p) => a + (p.precip_mm ?? 0), 0)).filter(v => v > 0);

    return {
        etoDiario,
        nubosidadPct: cobs.length ? cobs.reduce((a, b) => a + b, 0) / cobs.length : null,
        probLluviaPct: probs.length ? Math.max(...probs) : null,
        lluviaPrevMm: mms.length ? mms.reduce((a, b) => a + b, 0) / mms.length : null,
        lluviaObsMm: ests.reduce((a, e) => a + (e.lectura?.lluvia_dia_mm ?? 0), 0),
        hrPct: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
        vientoMaxMs: vientos.length ? Math.max(...vientos) : null,
        estacionesOk: ests.filter(e => e.calidad.usableComoActual).length,
        estacionesTotal: ests.length,
    };
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/**
 * IDR — Índice de Demanda de Riego (0-100).
 * Qué fracción de la demanda atmosférica máxima del ciclo se está registrando.
 * Más alto = más agua necesita el cultivo. Se calcula sobre la ETₒ del DÍA
 * COMPLETO; usar el acumulado parcial lo subestimaría según la hora del corte.
 */
function calcIDR(e: EntradasIndices): Indice {
    const base: Omit<Indice, 'valor' | 'etiqueta' | 'color'> = {
        clave: 'IDR', nombre: 'Índice de Demanda de Riego',
        // Descripción breve: se dibuja bajo el medidor, con ancho acotado.
        descripcion: 'Demanda de riego',
        formula: `IDR = 100 × ETₒ_día / ${ETO_MAX_REF} mm (ETₒ máx. de referencia del DR-005)`,
        procedencia: 'ETₒ del día: modelo horario · máximo: serie histórica del distrito',
        implicacion: '',
    };
    if (e.etoDiario == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8',
            implicacion: 'Dimensionar con ETₒ observada' };
    }
    const v = clamp((e.etoDiario / ETO_MAX_REF) * 100);
    // Demanda ALTA no es "malo": es una condición operativa que exige más agua.
    const etiqueta = v < 25 ? 'Muy baja' : v < 45 ? 'Baja' : v < 65 ? 'Moderada' : v < 85 ? 'Alta' : 'Muy alta';
    const color = v < 45 ? C_BUENO : v < 65 ? C_AVISO : v < 85 ? C_SERIO : C_CRITICO;
    const implicacion = v < 45 ? 'Intervalos ampliables'
        : v < 65 ? 'Riego según programa'
        : v < 85 ? 'Reforzar láminas' : 'Priorizar turnos nocturnos';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/**
 * IHE — Índice de Humedad Efectiva (0-100).
 * Humedad disponible en el ambiente: HR observada más el aporte de la lluvia
 * (observada y prevista). Alto = menor déficit a reponer por riego.
 */
function calcIHE(e: EntradasIndices): Indice {
    const base: Omit<Indice, 'valor' | 'etiqueta' | 'color'> = {
        clave: 'IHE', nombre: 'Índice de Humedad Efectiva',
        descripcion: 'Humedad efectiva',
        formula: 'IHE = 0.70 × HR + 30 × min(1, (lluvia_obs + lluvia_prev) / 10 mm)',
        procedencia: 'HR y lluvia observadas: estaciones · lluvia prevista: modelo 24 h',
        implicacion: '',
    };
    if (e.hrPct == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8',
            implicacion: 'Sin HR disponible' };
    }
    const aporte = Math.min(1, (e.lluviaObsMm + (e.lluviaPrevMm ?? 0)) / 10);
    const v = clamp(0.70 * e.hrPct + 30 * aporte);
    const etiqueta = v < 30 ? 'Deficiente' : v < 50 ? 'Baja' : v < 75 ? 'Adecuada' : 'Elevada';
    const color = v < 30 ? C_CRITICO : v < 50 ? C_AVISO : C_BUENO;
    const implicacion = v < 30 ? 'Reponer por riego'
        : v < 50 ? 'Aporte ambiental escaso'
        : v < 75 ? 'Sin ajuste por humedad' : 'Descontar del balance';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/**
 * IRO — Índice de Riesgo Operativo (0-100). Más alto = MÁS riesgo.
 * Suma penalizaciones por lluvia probable (suspensión de turnos), viento
 * (deriva en aspersión) e integridad del dato (decidir a ciegas es un riesgo
 * operativo real, no una nota al pie).
 */
function calcIRO(e: EntradasIndices): Indice {
    const base: Omit<Indice, 'valor' | 'etiqueta' | 'color'> = {
        clave: 'IRO', nombre: 'Índice de Riesgo Operativo',
        descripcion: 'Riesgo operativo',
        formula: 'IRO = 0.50 × prob_lluvia + 25 × min(1, lluvia_prev/15 mm) '
            + '+ 15 × min(1, máx(0, viento−5)/5) + 20 × (1 − estaciones_válidas/total). '
            + 'Piso: si viento > 5 m/s, IRO ≥ 20 (nunca "Bajo")',
        procedencia: 'Lluvia y viento: modelo + estaciones · integridad: motor QA/QC',
        implicacion: '',
    };
    // Sin pronóstico ni viento no hay base para afirmar "riesgo bajo".
    if (e.probLluviaPct == null && e.vientoMaxMs == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8',
            implicacion: 'No evaluable' };
    }
    const rLluvia = 0.50 * (e.probLluviaPct ?? 0);
    const rLamina = 25 * Math.min(1, (e.lluviaPrevMm ?? 0) / 15);
    const rViento = 15 * Math.min(1, Math.max(0, (e.vientoMaxMs ?? 0) - 5) / 5);
    const rDato = e.estacionesTotal > 0
        ? 20 * (1 - e.estacionesOk / e.estacionesTotal) : 20;

    // PISO POR VIENTO RESTRICTIVO. El término de viento aporta 15 pts como
    // máximo (satura a 10 m/s) frente a un umbral de 20 para salir de "Bajo":
    // por sí solo NUNCA podía sacar al índice de esa categoría. Resultado
    // observado el 2026-07-19: con 7.1 m/s en Las Vírgenes el IRO daba 18
    // ("Bajo · Ejecutar lo programado") mientras la alerta operativa pedía
    // suspender la aspersión — el tablero contradecía a la restricción real.
    // Se conservan fórmula y pesos; solo se impide esa contradicción.
    const vientoRestrictivo = (e.vientoMaxMs ?? 0) > 5;
    const v = clamp(Math.max(
        rLluvia + rLamina + rViento + rDato,
        vientoRestrictivo ? 20 : 0,
    ));
    const etiqueta = v < 20 ? 'Bajo' : v < 40 ? 'Moderado' : v < 65 ? 'Alto' : 'Crítico';
    const color = v < 20 ? C_BUENO : v < 40 ? C_AVISO : v < 65 ? C_SERIO : C_CRITICO;
    // Con viento restrictivo se nombra la causa: "vigilar" a secas no le dice al
    // jefe de zona QUÉ vigilar, y aquí la restricción concreta es la aspersión.
    const implicacion = vientoRestrictivo && v < 40
        ? 'Viento: suspender aspersión'
        : v < 20 ? 'Ejecutar lo programado'
        : v < 40 ? 'Vigilar antes del turno'
        : v < 65 ? 'Evaluar diferimiento' : 'Suspender y reprogramar';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/**
 * ICA-005 — Índice Climático Agrohidrológico (0-100), compuesto.
 * Favorabilidad global de las condiciones para operar el distrito: penaliza el
 * riesgo operativo, la demanda extrema y la falta de humedad. Alto = condiciones
 * favorables y estables. NO se calcula si falta alguno de sus componentes:
 * un compuesto con huecos daría una falsa sensación de completitud.
 */
function calcICA(idr: Indice, iro: Indice, ihe: Indice): Indice {
    const base: Omit<Indice, 'valor' | 'etiqueta' | 'color'> = {
        clave: 'ICA', nombre: 'Índice Climático Agrohidrológico',
        descripcion: 'Favorabilidad global',
        formula: 'ICA = 100 − (0.45 × IRO + 0.35 × |IDR − 50| × 1.4 + 0.20 × máx(0, 60 − IHE))',
        procedencia: 'Compuesto de IDR, IRO e IHE; requiere los tres disponibles',
        implicacion: '',
    };
    if (idr.valor == null || iro.valor == null || ihe.valor == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8',
            implicacion: 'Faltan componentes' };
    }
    // La demanda ideal es intermedia: muy baja implica cultivo parado o frío;
    // muy alta, estrés. Se penaliza la desviación respecto de 50.
    const penDemanda = Math.min(50, Math.abs(idr.valor - 50) * 1.4);
    const penHumedad = Math.max(0, 60 - ihe.valor);
    const v = clamp(100 - (0.45 * iro.valor + 0.35 * penDemanda + 0.20 * penHumedad));
    const etiqueta = v < 40 ? 'Desfavorable' : v < 60 ? 'Regular' : v < 80 ? 'Favorable' : 'Excelente';
    const color = v < 40 ? C_CRITICO : v < 60 ? C_AVISO : C_BUENO;
    const implicacion = v < 40 ? 'Revisar programación'
        : v < 60 ? 'Operar con vigilancia'
        : v < 80 ? 'Operación sin ajuste' : 'Condiciones óptimas';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/** Calcula los cuatro índices del distrito, en orden de presentación. */
export function calculaIndices(e: EntradasIndices): Indice[] {
    const idr = calcIDR(e);
    const iro = calcIRO(e);
    const ihe = calcIHE(e);
    const ica = calcICA(idr, iro, ihe);
    return [ica, idr, iro, ihe];
}
