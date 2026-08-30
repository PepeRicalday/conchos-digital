// ═══════════════════════════════════════════════════════════════════════════
// ÍNDICES INSTITUCIONALES SRL — Fase 1 (ICV, IHR, IEHP)
// ---------------------------------------------------------------------------
// Tres indicadores 0-100 (más el IEHP, que no es 0-100 sino ha/hm³) derivados
// de ndvi_modulo_historico + entregas_modulo — mismo espíritu que
// src/utils/indicesAgro.ts (ICA/IDR/IRO/IHE): fórmula explícita, procedencia
// declarada, "S/D" cuando falta un insumo, nunca un 0 que se lea como
// "condición nula".
//
// Alcance deliberado de esta fase: ICV, IHR e IEHP se calculan solo con NDVI
// (Sentinel-2, ya operativo) y volumen entregado (entregas_modulo, ya
// operativo) — NO requieren ETa satelital real ni LST, que necesitarían una
// fuente de datos distinta (Landsat/MODIS) y un modelo de balance energético
// aparte. IEH (estrés hídrico) e ISH (satisfacción hídrica), que sí dependen
// de esos insumos, quedan para una fase posterior — ver conversación de
// diseño 2026-08-30.
// ═══════════════════════════════════════════════════════════════════════════

export interface IndiceSrl {
    clave: 'ICV' | 'IHR' | 'IEHP';
    nombre: string;
    descripcion: string;
    /** 0-100 para ICV/IHR; ha/hm³ para IEHP. null si falta un insumo. */
    valor: number | null;
    unidad: string;
    etiqueta: string;
    color: string;
    formula: string;
    procedencia: string;
    implicacion: string;
}

const C_BUENO = '#0ca30c', C_AVISO = '#d98704', C_SERIO = '#ec835a', C_CRITICO = '#d03b3b';
const clamp = (v: number) => Math.max(0, Math.min(100, v));

// Piso/techo agronómicos del escalado NDVI→ICV: 0.10 ≈ suelo desnudo/sin
// cultivo, 0.75 ≈ vigor pleno típico de los cultivos del DR-005. Referencia
// agronómica estándar, no un máximo histórico observado — mismo criterio de
// "constante declarada" que ETO_MAX_REF en indicesAgro.ts.
const NDVI_PISO = 0.10;
const NDVI_TECHO = 0.75;

// Umbral de NDVI para "cobertura vegetal activa" — debe coincidir con
// UMBRAL_COBERTURA_ACTIVA en supabase/functions/sentinel-ndvi-modulo-sync
// (0.30), que es lo que fraccion_cobertura_activa ya trae calculado.
const NDVI_UMBRAL_ACTIVO = 0.30;

export interface EntradaModuloSrl {
    numeroModulo: number;
    nombreModulo: string;
    /** NDVI medio del mes más reciente con dato. */
    ndviMedio: number | null;
    /** Desviación estándar del NDVI del mismo mes (dispersión espacial). */
    ndviDesv: number | null;
    /** Fracción (0-1) de píxeles con NDVI≥0.30 dentro del polígono. */
    fraccionCoberturaActiva: number | null;
    /** Superficie real del polígono (ha). */
    superficieHa: number | null;
    /** Volumen entregado acumulado del ciclo agrícola hasta este mes (hm³). */
    volumenAcumuladoHm3: number | null;
}

/**
 * ICV — Índice de Condición Vegetativa (0-100).
 * Escala lineal de NDVI a una nota institucional comparable entre módulos de
 * distinta superficie: 0 = sin cobertura vegetal (NDVI≤0.10), 100 = vigor
 * pleno (NDVI≥0.75). Fase 1 usa solo NDVI (sin EVI/SAVI, que requerirían
 * bandas adicionales del evalscript — fase futura).
 */
export function calcICV(e: EntradaModuloSrl): IndiceSrl {
    const base = {
        clave: 'ICV' as const, nombre: 'Índice de Condición Vegetativa',
        descripcion: 'Vigor vegetativo del módulo',
        unidad: '/100',
        formula: `ICV = 100 × clamp((NDVI − ${NDVI_PISO}) / (${NDVI_TECHO} − ${NDVI_PISO}), 0, 1)`,
        procedencia: 'NDVI medio mensual (Sentinel-2, polígono exacto del módulo) — ndvi_modulo_historico',
        implicacion: '',
    };
    if (e.ndviMedio == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8', implicacion: 'Sin NDVI del mes' };
    }
    const v = clamp(100 * (e.ndviMedio - NDVI_PISO) / (NDVI_TECHO - NDVI_PISO));
    const etiqueta = v < 25 ? 'Crítico' : v < 50 ? 'Regular' : v < 75 ? 'Bueno' : 'Óptimo';
    const color = v < 25 ? C_CRITICO : v < 50 ? C_SERIO : v < 75 ? C_AVISO : C_BUENO;
    const implicacion = v < 25 ? 'Cobertura vegetal muy escasa — revisar etapa de cultivo o incidencia'
        : v < 50 ? 'Desarrollo vegetativo por debajo de lo esperado'
        : v < 75 ? 'Condición vegetativa satisfactoria' : 'Vigor vegetativo máximo del ciclo';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/**
 * IHR — Índice de Homogeneidad de Riego (0-100).
 * Coeficiente de variación (desv/media) invertido: dispersión espacial baja
 * respecto al NDVI medio = alta homogeneidad. Comparable entre módulos con
 * distinto vigor, a diferencia de usar la desviación absoluta sola.
 */
export function calcIHR(e: EntradaModuloSrl): IndiceSrl {
    const base = {
        clave: 'IHR' as const, nombre: 'Índice de Homogeneidad de Riego',
        descripcion: 'Uniformidad espacial del vigor vegetativo',
        unidad: '/100',
        formula: 'IHR = 100 × clamp(1 − ndvi_desv / ndvi_medio, 0, 1)',
        procedencia: 'Desviación estándar y media del NDVI dentro del polígono del módulo — ndvi_modulo_historico',
        implicacion: '',
    };
    if (e.ndviMedio == null || e.ndviDesv == null || e.ndviMedio <= 0.05) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8',
            implicacion: e.ndviMedio != null && e.ndviMedio <= 0.05 ? 'NDVI medio insuficiente para evaluar dispersión relativa' : 'Sin NDVI del mes' };
    }
    const cv = e.ndviDesv / e.ndviMedio;
    const v = clamp(100 * (1 - cv));
    const etiqueta = v < 40 ? 'Muy irregular' : v < 60 ? 'Irregular' : v < 80 ? 'Aceptable' : 'Homogéneo';
    const color = v < 40 ? C_CRITICO : v < 60 ? C_SERIO : v < 80 ? C_AVISO : C_BUENO;
    const implicacion = v < 40 ? 'Variabilidad alta — posible inequidad cabecera/cola o riego localizado deficiente'
        : v < 60 ? 'Variabilidad relevante — revisar oportunidad y distribución del riego'
        : v < 80 ? 'Variabilidad dentro de rango operativo normal' : 'Distribución del riego uniforme en el módulo';
    return { ...base, valor: Math.round(v), etiqueta, color, implicacion };
}

/**
 * IEHP — Índice de Eficiencia Hídrica Productiva (ha/hm³, NO 0-100).
 * Hectáreas con cobertura vegetal activa (NDVI≥0.30) por cada hm³ entregado
 * en el ciclo agrícola (acumulado marzo→mes actual, no solo el mes en curso
 * — suaviza el desfase natural entre cuándo se riega y cuándo el cultivo
 * responde en NDVI). Un módulo con NDVI alto pero IEHP bajo está usando
 * mucho más volumen que otro para lograr el mismo vigor vegetativo.
 */
export function calcIEHP(e: EntradaModuloSrl): IndiceSrl {
    const base = {
        clave: 'IEHP' as const, nombre: 'Índice de Eficiencia Hídrica Productiva',
        descripcion: 'Hectáreas activas por volumen entregado',
        unidad: 'ha/hm³',
        formula: `ha_activas = superficie_ha × fracción(NDVI≥${NDVI_UMBRAL_ACTIVO}) · IEHP = ha_activas / hm³_entregados_acumulado_ciclo`,
        procedencia: 'superficie_ha y fraccion_cobertura_activa del mes más reciente (ndvi_modulo_historico) · volumen acumulado marzo→mes actual (entregas_modulo)',
        implicacion: '',
    };
    if (e.superficieHa == null || e.fraccionCoberturaActiva == null) {
        return { ...base, valor: null, etiqueta: 'Sin dato', color: '#94a3b8', implicacion: 'Sin superficie o cobertura activa del mes' };
    }
    if (e.volumenAcumuladoHm3 == null || e.volumenAcumuladoHm3 <= 0) {
        return { ...base, valor: null, etiqueta: 'Sin volumen', color: '#94a3b8',
            implicacion: 'Sin entregas registradas en el ciclo — indicador no evaluable' };
    }
    const haActivas = e.superficieHa * e.fraccionCoberturaActiva;
    const v = haActivas / e.volumenAcumuladoHm3;
    // Sin banda de referencia institucional publicada aún: se muestra el
    // valor crudo (ha/hm³) sin normalizar a 0-100 ni clasificar por color —
    // clasificar sin un rango validado con la SRL daría una falsa precisión.
    return {
        ...base, valor: Number(v.toFixed(1)), etiqueta: `${haActivas.toFixed(0)} ha activas`,
        color: '#38bdf8',
        implicacion: 'Comparar entre módulos: mayor ha/hm³ = más superficie productiva por volumen entregado',
    };
}

export function calculaIndicesSrl(e: EntradaModuloSrl): IndiceSrl[] {
    return [calcICV(e), calcIHR(e), calcIEHP(e)];
}

// ── Fuente de volumen para el IEHP ──────────────────────────────────────────
// volumen_modulo_mensual_provisional (carga institucional manual desde la
// hoja "ACUMULADO GENERAL" de la SRL, ago-2026) — separada de entregas_modulo
// (captura operativa diaria real) porque alimenta SOLO el IEHP del panel NDVI
// y del informe institucional, sin tocar ni conciliarse con el flujo
// operativo. Mientras no se defina el flujo definitivo de captura mensual,
// esta es la fuente que se consulta.
import { supabase } from '../lib/supabase';

/** Volumen acumulado (hm³) de cada módulo SRL desde marzo hasta el mes dado
 *  (inclusive), leído de volumen_modulo_mensual_provisional. Meses sin fila
 *  simplemente no suman — no hay relleno con 0 ni interpolación. Devuelve
 *  también si el ÚLTIMO mes incluido en la suma está marcado como parcial
 *  (ej. "hasta el día 15"), para que la UI pueda advertirlo — un acumulado
 *  que mezcla meses completos con uno truncado no es directamente comparable
 *  a otro que solo tiene meses completos. */
export async function volumenAcumuladoPorModuloHm3(
    hastaMesInclusive: string,
): Promise<{ porModulo: Map<number, number>; ultimoMesEsParcial: boolean }> {
    const porModulo = new Map<number, number>();
    const { data, error } = await supabase
        .from('volumen_modulo_mensual_provisional')
        .select('numero_modulo, mes, volumen_miles_m3, es_mes_parcial')
        .lte('mes', hastaMesInclusive);
    if (error || !data) return { porModulo, ultimoMesEsParcial: false };
    for (const fila of data) {
        const acumulado = (porModulo.get(fila.numero_modulo) ?? 0) + fila.volumen_miles_m3 / 1000;
        porModulo.set(fila.numero_modulo, acumulado);
    }
    const ultimoMesEsParcial = data.some(f => f.mes === hastaMesInclusive && f.es_mes_parcial);
    return { porModulo, ultimoMesEsParcial };
}
