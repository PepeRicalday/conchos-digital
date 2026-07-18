// ═══════════════════════════════════════════════════════════════════════════
// Condición del cielo, calidad del dato y procedencia — SICA-005
// ---------------------------------------------------------------------------
// Regla central del módulo agroclimático: LA CONDICIÓN DEL CIELO Y LA
// PROBABILIDAD DE LLUVIA SON VARIABLES DISTINTAS. Una probabilidad de lluvia de
// 0 % no demuestra ausencia de nubosidad, y "sin precipitación prevista" puede
// coexistir con "cubierto".
//
// Antes de este módulo el informe declaraba "☀️ Estable / despejado" cuando la
// presión barométrica subía, sin ninguna medición de nubosidad. Aquí el estado
// del cielo solo se afirma cuando existe una fuente que lo sustente; si no la
// hay, el resultado es NO_DETERMINADO y no se emite icono solar.
// ═══════════════════════════════════════════════════════════════════════════

// ── Procedencia ────────────────────────────────────────────────────────────
export type Procedencia = 'observado' | 'estimado' | 'pronosticado' | 'satelite' | 'ninguna';

export const PROCEDENCIA_LABEL: Record<Procedencia, string> = {
    observado: 'OBSERVADO',
    estimado: 'ESTIMADO',
    pronosticado: 'PRONOSTICADO',
    satelite: 'SATÉLITE',
    ninguna: 'SIN FUENTE',
};

// ── Clasificación visual (§5.2 del documento técnico) ───────────────────────
export type EstadoCielo =
    | 'despejado' | 'mayormente_despejado' | 'parcialmente_nublado'
    | 'mayormente_nublado' | 'cubierto' | 'no_determinado';

interface ClaseCielo { estado: EstadoCielo; etiqueta: string; icono: string; color: string; }

const CLASES: ClaseCielo[] = [
    { estado: 'despejado', etiqueta: 'Despejado', icono: '☀️', color: '#eab308' },
    { estado: 'mayormente_despejado', etiqueta: 'Mayormente despejado', icono: '🌤️', color: '#facc15' },
    { estado: 'parcialmente_nublado', etiqueta: 'Parcialmente nublado', icono: '⛅', color: '#0ea5e9' },
    { estado: 'mayormente_nublado', etiqueta: 'Mayormente nublado', icono: '🌥️', color: '#64748b' },
    { estado: 'cubierto', etiqueta: 'Cubierto', icono: '☁️', color: '#475569' },
];

/** Estado sin icono solar: se usa siempre que falte una fuente de nubosidad. */
export const CIELO_NO_DETERMINADO: ClaseCielo = {
    estado: 'no_determinado',
    etiqueta: 'Estado no determinado',
    icono: '', // sin icono: no insinuar sol ni nubes sin evidencia
    color: '#94a3b8',
};

/**
 * Clasifica cobertura nubosa total (0-100 %) según la tabla §5.2.
 * `null`/indefinido devuelve NO DETERMINADO — nunca "despejado" por omisión.
 */
export function clasificaCielo(coberturaPct: number | null | undefined): ClaseCielo {
    if (coberturaPct == null || !Number.isFinite(coberturaPct)) return CIELO_NO_DETERMINADO;
    const c = Math.max(0, Math.min(100, coberturaPct));
    if (c <= 10) return CLASES[0];
    if (c <= 30) return CLASES[1];
    if (c <= 60) return CLASES[2];
    if (c <= 90) return CLASES[3];
    return CLASES[4];
}

// ── Estimación auxiliar por radiación (§5.1) ────────────────────────────────

/**
 * Elevación solar (grados) para una posición y momento dados.
 * Algoritmo NOAA simplificado; precisión ~0.1°, suficiente para decidir si hay
 * luz bastante como para que la radiación diga algo sobre la nubosidad.
 */
export function elevacionSolar(fecha: Date, latDeg: number, lonDeg: number): number {
    const rad = Math.PI / 180;
    // Día juliano fraccionario desde J2000.0
    const jd = fecha.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;
    const L = (280.46 + 0.9856474 * n) % 360;                       // longitud media
    const g = ((357.528 + 0.9856003 * n) % 360) * rad;              // anomalía media
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;  // eclíptica
    const eps = (23.439 - 0.0000004 * n) * rad;                     // oblicuidad
    const declinacion = Math.asin(Math.sin(eps) * Math.sin(lambda));
    // Ángulo horario desde el tiempo sidéreo aparente
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    const ascension = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const anguloHorario = (gmst * 15 * rad + lonDeg * rad) - ascension;
    const lat = latDeg * rad;
    const sinAlt = Math.sin(lat) * Math.sin(declinacion)
        + Math.cos(lat) * Math.cos(declinacion) * Math.cos(anguloHorario);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad;
}

/**
 * Radiación de cielo despejado (W/m²) para una elevación solar y altitud dadas.
 * Modelo de Haurwitz corregido por altitud — referencia para normalizar kt.
 */
export function radiacionCieloDespejado(elevSolarDeg: number, elevMsnm = 1200): number {
    if (elevSolarDeg <= 0) return 0;
    const z = (90 - elevSolarDeg) * (Math.PI / 180);   // ángulo cenital
    const cosZ = Math.cos(z);
    if (cosZ <= 0) return 0;
    const base = 1098 * cosZ * Math.exp(-0.057 / cosZ);
    // La atmósfera es más delgada en altura: ~+3 % por cada 1000 m.
    return base * (1 + 0.03 * (elevMsnm / 1000));
}

export interface EstimacionRadiacion {
    clearnessIndex: number | null;
    nubosidadEstPct: number | null;
    elevSolarDeg: number;
    skyStateLocal: EstadoCielo;
    /** Motivo por el que no se pudo estimar, si aplica. */
    motivo: string | null;
}

/**
 * Estima nubosidad desde la radiación solar medida (§5.1).
 *
 * Solo es válida de día y con elevación solar ≥ 10°: de noche la radiación es 0
 * y un `100 % de nubes` derivado de ahí sería falso. La estimación también
 * responde a polvo, humo, sombra o suciedad del sensor, así que se reporta
 * siempre como "estimada por radiación", nunca como medición directa.
 */
export function estimaNubosidadPorRadiacion(
    radWm2: number | null | undefined,
    fecha: Date,
    latDeg: number,
    lonDeg: number,
    elevMsnm = 1200,
): EstimacionRadiacion {
    const elev = elevacionSolar(fecha, latDeg, lonDeg);
    const noDeterminable = (motivo: string): EstimacionRadiacion => ({
        clearnessIndex: null, nubosidadEstPct: null, elevSolarDeg: +elev.toFixed(1),
        skyStateLocal: 'no_determinado', motivo,
    });

    if (elev < 10) return noDeterminable('Elevación solar < 10°: la radiación no informa sobre nubosidad.');
    if (radWm2 == null || !Number.isFinite(radWm2)) return noDeterminable('Sin radiación solar reportada por la estación.');

    const rCielo = radiacionCieloDespejado(elev, elevMsnm);
    if (rCielo <= 0) return noDeterminable('Radiación de cielo despejado no calculable.');

    const kt = Math.max(0, Math.min(1.2, radWm2 / rCielo));
    const nubosidad = Math.max(0, Math.min(100, 100 * (1 - kt)));
    return {
        clearnessIndex: +kt.toFixed(3),
        nubosidadEstPct: +nubosidad.toFixed(0),
        elevSolarDeg: +elev.toFixed(1),
        skyStateLocal: clasificaCielo(nubosidad).estado,
        motivo: null,
    };
}

// ── Motor de calidad (§4) ───────────────────────────────────────────────────
export type QaFlag = 'stale' | 'out_of_range' | 'sensor_stuck' | 'spike' | 'inconsistent' | 'missing';
export type QaStatus = 'valid' | 'stale' | 'expired' | 'suspect';

export interface QaResultado {
    status: QaStatus;
    flags: QaFlag[];
    edadMin: number | null;
    /** Frescura suficiente para presentar el dato como "actual". */
    usableComoActual: boolean;
    etiqueta: string;
    color: string;
}

/** Umbrales de frescura (§4): ≤20 min válido · 21-60 retrasado · >60 vencido. */
export const FRESCURA_VALIDA_MIN = 20;
export const FRESCURA_VENCIDA_MIN = 60;

interface LecturaQA {
    ts: string | null;
    temp_c?: number | null;
    hum_rel_pct?: number | null;
    lluvia_dia_mm?: number | null;
    rad_solar_wm2?: number | null;
    viento_ms?: number | null;
}

/**
 * Evalúa frescura, rango físico y coherencia de una lectura.
 * Un campo ausente se marca `missing` y NUNCA se sustituye por cero (§4).
 */
export function evaluaCalidad(l: LecturaQA | null, ahora = new Date()): QaResultado {
    if (!l || !l.ts) {
        return {
            status: 'expired', flags: ['missing'], edadMin: null, usableComoActual: false,
            etiqueta: 'Sin dato', color: '#94a3b8',
        };
    }

    const flags: QaFlag[] = [];
    const edadMin = (ahora.getTime() - new Date(l.ts).getTime()) / 60000;

    // Rango físico
    if (l.hum_rel_pct != null && (l.hum_rel_pct < 0 || l.hum_rel_pct > 100)) flags.push('out_of_range');
    if (l.lluvia_dia_mm != null && l.lluvia_dia_mm < 0) flags.push('out_of_range');
    if (l.rad_solar_wm2 != null && l.rad_solar_wm2 < 0) flags.push('out_of_range');
    if (l.temp_c != null && (l.temp_c < -40 || l.temp_c > 60)) flags.push('out_of_range');
    if (l.viento_ms != null && (l.viento_ms < 0 || l.viento_ms > 75)) flags.push('out_of_range');

    // Disponibilidad: campos clave no entregados
    if (l.temp_c == null || l.hum_rel_pct == null) flags.push('missing');

    // Frescura
    let status: QaStatus;
    if (edadMin > FRESCURA_VENCIDA_MIN) { status = 'expired'; flags.push('stale'); }
    else if (edadMin > FRESCURA_VALIDA_MIN) { status = 'stale'; flags.push('stale'); }
    else status = 'valid';

    // Un fuera-de-rango degrada el veredicto aunque el dato sea fresco.
    if (flags.includes('out_of_range') && status === 'valid') status = 'suspect';

    const etiquetas: Record<QaStatus, { etiqueta: string; color: string }> = {
        valid: { etiqueta: 'Válido', color: '#16a34a' },
        stale: { etiqueta: 'Retrasado', color: '#f59e0b' },
        expired: { etiqueta: 'Vencido', color: '#dc2626' },
        suspect: { etiqueta: 'Sospechoso', color: '#f59e0b' },
    };

    return {
        status, flags, edadMin: +edadMin.toFixed(0),
        usableComoActual: status === 'valid' || status === 'stale',
        ...etiquetas[status],
    };
}

/** Formatea la edad del dato para mostrarla junto a cada valor. */
export function formateaEdad(edadMin: number | null): string {
    if (edadMin == null) return 's/d';
    if (edadMin < 60) return `${Math.round(edadMin)} min`;
    if (edadMin < 48 * 60) return `${Math.round(edadMin / 60)} h`;
    return `${Math.round(edadMin / 1440)} d`;
}

// ── Diagnóstico fusionado del cielo (§6) ────────────────────────────────────
export interface DiagnosticoCielo {
    estado: EstadoCielo;
    etiqueta: string;
    icono: string;
    color: string;
    coberturaPct: number | null;
    procedencia: Procedencia;
    confianzaPct: number;
    confianzaEtiqueta: 'Alta' | 'Media' | 'Baja' | 'No concluyente';
    /** Fuentes que respaldan el diagnóstico. */
    evidencia: string[];
    /** Discrepancias materiales entre fuentes — se muestran, no se ocultan. */
    discrepancias: string[];
    nota: string;
}

export interface EntradasFusion {
    /** Cobertura pronosticada por el modelo (0-100). */
    nubosidadFcPct?: number | null;
    /** Cobertura estimada localmente por radiación (0-100). */
    nubosidadEstPct?: number | null;
    /** Cobertura clasificada por satélite (0-100). Reservado para la etapa 4. */
    nubosidadSatPct?: number | null;
    /** Edad de la observación local, en minutos. */
    edadObsMin?: number | null;
    /** Edad del pronóstico vigente, en minutos. */
    edadFcMin?: number | null;
}

function etiquetaConfianza(c: number): DiagnosticoCielo['confianzaEtiqueta'] {
    if (c >= 85) return 'Alta';
    if (c >= 65) return 'Media';
    if (c >= 40) return 'Baja';
    return 'No concluyente';
}

/**
 * Fusiona las fuentes de nubosidad respetando la jerarquía de evidencia (§5):
 *   satélite → modelo horario → estimación por radiación → no determinado.
 *
 * No promedia ciegamente porcentajes de fuentes con distinta resolución: elige
 * la de mayor jerarquía disponible y usa las demás para validar y, si difieren
 * de forma material, para BAJAR la confianza y declarar la discrepancia.
 */
export function fusionaCielo(e: EntradasFusion): DiagnosticoCielo {
    const { nubosidadFcPct, nubosidadEstPct, nubosidadSatPct, edadObsMin, edadFcMin } = e;
    const evidencia: string[] = [];
    const discrepancias: string[] = [];

    // Jerarquía: satélite > modelo > radiación local
    let cobertura: number | null = null;
    let procedencia: Procedencia = 'ninguna';
    if (nubosidadSatPct != null) { cobertura = nubosidadSatPct; procedencia = 'satelite'; evidencia.push('satélite'); }
    else if (nubosidadFcPct != null) { cobertura = nubosidadFcPct; procedencia = 'pronosticado'; evidencia.push('modelo'); }
    else if (nubosidadEstPct != null) { cobertura = nubosidadEstPct; procedencia = 'estimado'; evidencia.push('radiación local'); }

    if (cobertura == null) {
        return {
            ...CIELO_NO_DETERMINADO, coberturaPct: null, procedencia: 'ninguna',
            confianzaPct: 0, confianzaEtiqueta: 'No concluyente', evidencia: [], discrepancias: [],
            nota: 'No se dispone de cobertura nubosa, clasificación satelital ni radiación utilizable. '
                + 'El estado del cielo no puede determinarse con las fuentes disponibles; no se infiere de la lluvia observada.',
        };
    }

    // Fuentes secundarias: suman evidencia y detectan discrepancias
    if (procedencia !== 'pronosticado' && nubosidadFcPct != null) evidencia.push('modelo');
    if (procedencia !== 'estimado' && nubosidadEstPct != null) evidencia.push('radiación local');

    let confianza = 100;

    // Penalización por edad del dato
    if (edadObsMin != null && edadObsMin > FRESCURA_VENCIDA_MIN) confianza -= 20;
    else if (edadObsMin != null && edadObsMin > FRESCURA_VALIDA_MIN) confianza -= 8;
    if (edadFcMin != null && edadFcMin > 180) confianza -= 10;

    // Penalización por fuentes ausentes
    if (nubosidadSatPct == null) confianza -= 12;   // etapa 4 pendiente
    if (nubosidadFcPct == null) confianza -= 15;
    if (nubosidadEstPct == null) confianza -= 5;    // de noche es normal que falte

    // Discrepancia modelo ↔ radiación local: la señal más informativa que tenemos
    if (nubosidadFcPct != null && nubosidadEstPct != null) {
        const dif = Math.abs(nubosidadFcPct - nubosidadEstPct);
        if (dif > 40) {
            confianza -= 25;
            discrepancias.push(
                `El modelo prevé ${nubosidadFcPct.toFixed(0)} % de cobertura, pero la radiación local es compatible con `
                + `${nubosidadEstPct.toFixed(0)} % (diferencia de ${dif.toFixed(0)} puntos). `
                + 'La estimación radiométrica también responde a polvo y aerosoles; verificar con imagen satelital.',
            );
        } else if (dif > 20) {
            confianza -= 12;
            discrepancias.push(
                `Diferencia moderada entre modelo (${nubosidadFcPct.toFixed(0)} %) y radiación local `
                + `(${nubosidadEstPct.toFixed(0)} %): el diagnóstico se mantiene, con confianza reducida.`,
            );
        }
    }
    if (nubosidadSatPct != null && nubosidadFcPct != null && Math.abs(nubosidadSatPct - nubosidadFcPct) > 30) {
        confianza -= 20;
        discrepancias.push(
            `Satélite (${nubosidadSatPct.toFixed(0)} %) y modelo (${nubosidadFcPct.toFixed(0)} %) difieren de forma material; `
            + 'prevalece la observación satelital para el estado actual.',
        );
    }

    confianza = Math.max(0, Math.min(100, confianza));
    const clase = clasificaCielo(cobertura);

    // Con confianza no concluyente no se afirma un estado específico.
    if (confianza < 40) {
        return {
            ...CIELO_NO_DETERMINADO, coberturaPct: cobertura, procedencia,
            confianzaPct: confianza, confianzaEtiqueta: 'No concluyente', evidencia, discrepancias,
            nota: `La evidencia disponible (${evidencia.join(', ')}) sugiere ${cobertura.toFixed(0)} % de cobertura, `
                + 'pero la confianza es insuficiente para afirmar un estado del cielo.',
        };
    }

    const fuenteTxt = procedencia === 'satelite' ? 'clasificación satelital'
        : procedencia === 'pronosticado' ? 'modelo de pronóstico'
            : 'estimación por radiación local';

    return {
        estado: clase.estado, etiqueta: clase.etiqueta, icono: clase.icono, color: clase.color,
        coberturaPct: +cobertura.toFixed(0), procedencia, confianzaPct: confianza,
        confianzaEtiqueta: etiquetaConfianza(confianza), evidencia, discrepancias,
        nota: `Cobertura total ${cobertura.toFixed(0)} % según ${fuenteTxt}.`
            + (procedencia === 'estimado'
                ? ' Estimada por radiación, no medida directamente: responde también a polvo, humo y suciedad del sensor.'
                : ''),
    };
}

/**
 * Redacta la precipitación en escala INDEPENDIENTE del cielo (§6).
 * "Sin lluvia prevista" nunca implica "despejado".
 */
export function describePrecipitacion(probPct: number | null, mm: number | null): string {
    if (probPct == null && mm == null) return 'Sin dato de precipitación prevista.';
    const p = probPct ?? 0;
    const cantidad = mm != null && mm > 0 ? ` (${mm.toFixed(1)} mm previstos)` : '';
    if (p < 10) return `Sin precipitación prevista${cantidad}: probabilidad ${p.toFixed(0)} %.`;
    if (p < 30) return `Precipitación poco probable${cantidad}: ${p.toFixed(0)} %.`;
    if (p < 60) return `Precipitación posible${cantidad}: probabilidad ${p.toFixed(0)} %.`;
    return `Precipitación probable${cantidad}: ${p.toFixed(0)} %.`;
}
