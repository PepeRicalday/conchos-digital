// ═══════════════════════════════════════════════════════════════════════════
// Informe de Pronóstico — modelo de datos (función PURA, sin red) — SICA-005
// ---------------------------------------------------------------------------
// Convierte lo que ya tiene la pantalla de Clima (estaciones con su serie de
// pronóstico horario, umbrales de BD, alertas, contexto operativo) en el modelo
// que dibuja el informe. No consulta nada: así se puede probar con casos reales.
//
// Reglas de veracidad (ver auditoría 2026-10-16):
//   · Todo valor lleva procedencia (observado / pronosticado) y edad; nada
//     pronosticado se rotula como observado ni al revés.
//   · Lecturas implausibles o de estaciones "sospechosas" (p. ej. 82 °C) pasan
//     a S/D (null) y se declaran en la sección de confiabilidad; nunca a 0.
//   · Los umbrales salen de `clima_umbrales` (fuente única), no de constantes.
//   · Hora local siempre America/Chihuahua.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura, PronosticoHora } from '../hooks/useClimaEstaciones';
import type { AlertaClima, UmbralClima } from '../hooks/useClimaOperativo';
import { MODULOS_SRL } from './geoDistrito';
import { MODULOS_SRL_IDS, numeroModuloDeId, superficieRiegoHa } from './modulosSRL';
import {
    EFICIENCIA_RODADO, LLUVIA_MIN_EFECTIVA_MM, laminaBruta, laminaNeta, lluviaEfectivaMm, m3PorHa,
} from './agronomia';
import { valorPlausible } from './plausibilidadClima';

export type NivelRiesgo = 'normal' | 'aviso' | 'critico';
const RANGO_NIVEL: Record<NivelRiesgo, number> = { normal: 0, aviso: 1, critico: 2 };
export const peorNivel = (a: NivelRiesgo, b: NivelRiesgo): NivelRiesgo => (RANGO_NIVEL[b] > RANGO_NIVEL[a] ? b : a);

export type ClaveRiesgo = 'viento' | 'lluvia' | 'helada' | 'calor' | 'eto';
const CLAVES: ClaveRiesgo[] = ['viento', 'lluvia', 'helada', 'calor', 'eto'];

/** Probabilidad máxima (24 h) a partir de la cual la lámina pronosticada cuenta como riesgo de lluvia intensa. */
export const PROB_LLUVIA_CONFIRMA_PCT = 60;

const TZ = 'America/Chihuahua';
const MS_H = 3_600_000;
/** Pronóstico con más de esto de antigüedad (corrida) se rotula "desactualizado". */
export const CORRIDA_VIEJA_MIN = 180;

// ── Tipos de salida ─────────────────────────────────────────────────────────
export interface PuntoPronostico {
    ts: number;
    tempC: number | null;
    precipMm: number | null;
    probPct: number | null;
    vientoMs: number | null;
    nubPct: number | null;
    etoMm: number | null;
}

export interface VentanaRiesgo { desdeMs: number; hastaMs: number; nivel: NivelRiesgo; estacion: string }

export interface Riesgo {
    clave: ClaveRiesgo;
    etiqueta: string;
    unidad: string;
    comparador: 'mayor' | 'menor';
    aviso: number;
    critico: number;
    accion: string | null;
    /** Valor extremo pronosticado en la ventana (null = sin pronóstico). */
    valor: number | null;
    nivel: NivelRiesgo;
    estacion: string | null;
    /** Instante del extremo. */
    cuandoMs: number | null;
    ventanas: VentanaRiesgo[];
    /** Qué mide exactamente el valor (para no mezclar ventanas). */
    definicion: string;
}

/** Alerta de red por cambio de temperatura en 24 h (BD: claves `descenso` / `ascenso`, umbral 8 °C aviso · 12 °C crítico). */
export interface CambioTemperatura {
    sentido: 'descenso' | 'ascenso';
    nivel: NivelRiesgo;
    /** Magnitud del cambio (°C, positiva): mediana entre las estaciones que coinciden. */
    gradosC: number | null;
    /** Parte observada y parte pronosticada del cambio (°C, null = S/D). */
    obsC: number | null;
    fcC: number | null;
    /** Cuántas estaciones coinciden, tal como lo dice la alerta ("Red de estaciones (N coinciden)"). */
    estaciones: number | null;
    detectadaEn: string;
}

/** Lee una alerta CLIMA-descenso / CLIMA-ascenso de registro_alertas; null si no hay ninguna abierta. */
export function cambioTempDeAlertas(alertas: AlertaClima[]): CambioTemperatura | null {
    const cand = alertas
        .filter(a => a.categoria === 'agroclimatica' && /^CLIMA-(descenso|ascenso)-/.test(a.origenId))
        .map((a): CambioTemperatura => {
            const sentido = a.origenId.startsWith('CLIMA-descenso') ? 'descenso' : 'ascenso';
            const grados = a.mensaje.match(/:\s*(-?\d+(?:\.\d+)?)\s*°C\s*\(umbral/);
            const proc = a.mensaje.match(/\[ahora:\s*([^·\]]+?)\s*·\s*pronóstico:\s*([^\]]+?)\s*°C\]/);
            const n = a.titulo.match(/\((\d+)\s+coinciden\)/);
            const aNumero = (s: string | undefined) => (s != null && s !== 'S/D' && Number.isFinite(Number(s)) ? Number(s) : null);
            return {
                sentido, nivel: a.tipoRiesgo === 'critical' ? 'critico' : 'aviso',
                gradosC: aNumero(grados?.[1]), obsC: aNumero(proc?.[1]), fcC: aNumero(proc?.[2]),
                estaciones: n ? Number(n[1]) : null, detectadaEn: a.detectadaEn,
            };
        });
    if (!cand.length) return null;
    return cand.sort((x, y) => RANGO_NIVEL[y.nivel] - RANGO_NIVEL[x.nivel] || (y.gradosC ?? 0) - (x.gradosC ?? 0))[0];
}

export interface DecisionModulo {
    nivel: NivelRiesgo;
    acciones: string[];
    /** Una línea para la tarjeta. */
    resumen: string;
}

/** Una hora del pronóstico de la estación que representa a un módulo. */
export interface HoraModulo { ts: number; probPct: number | null; precipMm: number | null; tempC: number | null; vientoMs: number | null }
export interface ProbDiaModulo { clave: string; etiqueta: string; probMaxPct: number | null; lluviaMm: number | null; parcial: boolean }

export interface ResumenModulo {
    numero: number;
    estacion: string;
    /** true = la estación está en el propio módulo; false = estimado con la más cercana. */
    propia: boolean;
    distanciaKm: number | null;
    tMinC: number | null;
    tMaxC: number | null;
    vientoMaxMs: number | null;
    lluviaTotalMm: number | null;
    lluviaMax24hMm: number | null;
    probMaxPct: number | null;
    picoLluvia: { mmh: number; ms: number } | null;
    riesgos: Record<ClaveRiesgo, { nivel: NivelRiesgo; valor: number | null }>;
    decision: DecisionModulo;
    superficieHa: number | null;
    /** Demanda bruta de las próximas 24 h sin lluvia y con la lluvia efectiva descontada (m³). */
    demandaM3: number | null;
    demandaConLluviaM3: number | null;
    ahorroLluviaM3: number | null;
    entregadoHoyM3: number | null;
    /** Las horas completas del horizonte (siempre las 24/48 h, aunque el último día llegue cortado). */
    horas: HoraModulo[];
    /** true si ninguna estación con pronóstico pudo representar al módulo (no hay dato, no es 'estimado'). */
    sinEstacion: boolean;
    /** Probabilidad y lámina por día local, para la lista por módulo del informe básico. */
    probPorDia: ProbDiaModulo[];
}

export interface EstacionConfiabilidad {
    id: string;
    nombre: string;
    rol: string;
    /** Edad de la última lectura observada (min). */
    edadLecturaMin: number | null;
    calidad: string;
    sospechosa: boolean;
    observado: { tempC: number | null; vientoMs: number | null; lluviaDiaMm: number | null };
    puntosPronostico: number;
    corridaEn: string | null;
    edadCorridaMin: number | null;
    corridaVieja: boolean;
}

export interface AlertaInforme {
    titulo: string;
    mensaje: string;
    detectadaEn: string;
    /** Aclaración de procedencia (observado vs pronosticado) cuando aplica. */
    aclaracion: string | null;
}

export interface ContextoOperativo {
    canal?: { k0M3s: number | null; k0Fresca: boolean; k104M3s: number | null; k104Fresca: boolean } | null;
    presa?: { nombre: string; porcentaje: number | null; almacenamientoMm3: number | null; extraccionM3s: number | null; fecha: string | null } | null;
    entregasPorModulo?: Map<number, number | null>;
}

// ── Verificación del modelo (fn_clima_skill_variables / fn_clima_skill_lluvia_dia) ──
export interface FilaSkillVariable {
    estacion_id: string; estacion_nombre: string; rango_horizonte: string;
    variable: 'temperatura' | 'viento' | string; n: number | string; mae: number | string | null; sesgo: number | string | null;
}
export interface FilaSkillLluvia {
    estacion_id: string; estacion_nombre: string; dia: string;
    mm_pronosticado: number | string | null; mm_observado: number | string | null; error: number | string | null;
}
export interface EntradaVerificacion {
    variables: FilaSkillVariable[];
    lluviaDias: FilaSkillLluvia[];
    /** Corridas de pronóstico conservadas (clima_pronostico_snapshot): habilitan 7-24 h y 25-48 h. */
    corridasConservadas: number;
}
export interface ResumenSkillVariable { variable: 'temperatura' | 'viento'; rango: string; n: number; mae: number; sesgo: number; unidad: string }
export interface ResumenVerificacion {
    variables: ResumenSkillVariable[];
    lluvia: {
        dias: number; totalPronosticadoMm: number; totalObservadoMm: number;
        diasConLluviaObservada: number; detectados: number;
        peor: { estacion: string; dia: string; pronosticadoMm: number; observadoMm: number } | null;
    } | null;
    corridasConservadas: number;
    estacionesExcluidas: string[];
}

/** Lectura observada (WeatherLink) de una estación; sirve para la parte "medida" de la franja de 72 h. */
export interface LecturaObs { estacionId: string; ts: string | number; tempC: number | null; vientoMs: number | null }

export interface EntradaPronostico {
    estaciones: EstacionConLectura[];
    umbrales: UmbralClima[];
    /** ids de estación marcadas "sospechosa" por fn_clima_salud_red. */
    sospechosaIds: Set<string>;
    alertas: AlertaClima[];
    ahora: Date;
    horizonteH: 24 | 48;
    modoTecnico: boolean;
    contexto?: ContextoOperativo;
    verificacion?: EntradaVerificacion | null;
    /** Lecturas de las últimas ~24 h de todas las estaciones (opcional: sin ellas la franja solo muestra pronóstico). */
    observado?: LecturaObs[];
}

export type Franja = 'madrugada' | 'mañana' | 'tarde' | 'noche';

/** Resumen de un día LOCAL (America/Chihuahua) del horizonte, para el informe en lenguaje llano. */
export interface ResumenDia {
    clave: string;                 // YYYY-MM-DD local
    etiqueta: 'Hoy' | 'Mañana' | 'Pasado mañana' | string;
    fechaTxt: string;              // "vie 16 oct"
    horas: number;                 // horas pronosticadas dentro del horizonte
    /** true si el día no está completo en el horizonte (resto de hoy, o corte de las 48 h). */
    parcial: boolean;
    hastaMs: number;
    tMinC: number | null;
    tMaxC: number | null;
    probMaxPct: number | null;
    /** Lámina promedio de la zona (media de lo que sumó cada estación) y la del punto más lluvioso. */
    lluviaPromMm: number | null;
    lluviaMaxMm: number | null;
    lugarMasLluvia: string | null;
    vientoMaxMs: number | null;
    vientoMaxHoraMs: number | null;
    nubMediaPct: number | null;
    /** Franjas del día en que se espera lluvia perceptible (≥ 0.3 mm/h en alguna estación). */
    franjasLluvia: Franja[];
    horaPicoLluviaMs: number | null;
    /** Primera y última hora con lluvia perceptible (≥ 0.3 mm/h en alguna estación); hasta = fin de esa hora. */
    lluviaDesdeMs: number | null;
    lluviaHastaMs: number | null;
}

export interface FilaLineaTiempo {
    clave: 'viento' | 'lluvia' | 'helada' | 'calor';
    etiqueta: string;
    /** Una celda por hora: nivel semáforo, o intensidad de lluvia 1-3, o null = sin pronóstico. */
    celdas: ({ nivel: NivelRiesgo } | { lluvia: 0 | 1 | 2 | 3 } | null)[];
}

export interface BandaHoraria { ts: number; min: number | null; media: number | null; max: number | null }

export interface DatosPronostico {
    generadoMs: number;
    horizonteH: number;
    modoTecnico: boolean;
    desdeMs: number;
    hastaMs: number;
    /** Instante "ahora" redondeado a la hora (inicio de la ventana). */
    ejeHoras: number[];
    titular: string;
    nivel: NivelRiesgo;
    puntosClave: string[];
    riesgos: Riesgo[];
    lineaTiempo: FilaLineaTiempo[];
    bandas: { temp: BandaHoraria[]; lluvia: BandaHoraria[]; viento: BandaHoraria[]; nubosidad: BandaHoraria[] };
    dias: ResumenDia[];
    /** Parte MEDIDA de la franja de 72 h: una banda por hora, de 24 h antes de la emisión hasta la hora actual (null = sin lectura). */
    observadas: { ejeHoras: number[]; temp: BandaHoraria[]; viento: BandaHoraria[] };
    /** Lluvia que YA registraron las estaciones hoy (acumulado del día local), sin estaciones sospechosas. */
    lluviaHoy: { promMm: number; maxMm: number; lugarMax: string } | null;
    modulos: ResumenModulo[];
    estaciones: EstacionConfiabilidad[];
    estacionesExcluidas: { nombre: string; motivo: string }[];
    alertas: AlertaInforme[];
    /** Cambio brusco de temperatura (24 h) vigente en la red: viene de la alerta de BD, misma fuente que el panel. */
    cambioTemp: CambioTemperatura | null;
    contexto: ContextoOperativo;
    modelo: { proveedor: string; modelo: string; corridaEn: string | null; edadCorridaMin: number | null; vieja: boolean };
    /** Aviso global de calidad (null = todo en orden). */
    avisosCalidad: string[];
    verificacion: ResumenVerificacion | null;
}

// ── Formato de hora local ───────────────────────────────────────────────────
const FMT_DIA_HORA = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FMT_HORA = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FMT_DIA = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });

export const fmtDiaHora = (ms: number) => FMT_DIA_HORA.format(new Date(ms)).replace(/\./g, '');
export const fmtHora = (ms: number) => FMT_HORA.format(new Date(ms));
export const fmtDia = (ms: number) => FMT_DIA.format(new Date(ms)).replace(/\./g, '');
/** "vie 16 oct 15:00–19:00" (o con dos días si cruza medianoche). */
export function fmtVentana(desdeMs: number, hastaMs: number): string {
    const mismoDia = fmtDia(desdeMs) === fmtDia(hastaMs);
    return mismoDia
        ? `${fmtDia(desdeMs)} ${fmtHora(desdeMs)}–${fmtHora(hastaMs + MS_H)}`
        : `${fmtDiaHora(desdeMs)} → ${fmtDiaHora(hastaMs + MS_H)}`;
}

const FMT_CLAVE_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const claveDia = (ms: number) => FMT_CLAVE_DIA.format(new Date(ms));
const horaDe = (ms: number) => Number(fmtHora(ms).slice(0, 2));
const franjaDe = (ms: number): Franja => { const h = horaDe(ms); return h < 6 ? 'madrugada' : h < 12 ? 'mañana' : h < 18 ? 'tarde' : 'noche'; };

// ── Utilidades ──────────────────────────────────────────────────────────────
const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function centroideModulo(n: number): { lat: number; lon: number } | null {
    const anillo = MODULOS_SRL[n];
    if (!anillo?.length) return null;
    const lon = anillo.reduce((s, p) => s + p[0], 0) / anillo.length;
    const lat = anillo.reduce((s, p) => s + p[1], 0) / anillo.length;
    return { lat, lon };
}

function nivelDe(valor: number | null, u: { comparador: 'mayor' | 'menor'; aviso: number; critico: number }): NivelRiesgo {
    if (valor == null) return 'normal';
    if (u.comparador === 'mayor') return valor >= u.critico ? 'critico' : valor >= u.aviso ? 'aviso' : 'normal';
    return valor <= u.critico ? 'critico' : valor <= u.aviso ? 'aviso' : 'normal';
}

const DEF_RIESGO: Record<ClaveRiesgo, { definicion: string; etiquetaPorDefecto: string; unidadPorDefecto: string }> = {
    viento: { definicion: 'Viento sostenido máximo pronosticado (no ráfaga) en la ventana.', etiquetaPorDefecto: 'Viento fuerte', unidadPorDefecto: 'm/s' },
    lluvia: { definicion: 'Mayor lámina acumulada en cualquier ventana móvil de 24 h dentro del horizonte (pronóstico). Solo se marca aviso o crítico si la probabilidad máxima de esa ventana es ≥ 60 %.', etiquetaPorDefecto: 'Lluvia intensa', unidadPorDefecto: 'mm' },
    helada: { definicion: 'Temperatura mínima pronosticada en la ventana.', etiquetaPorDefecto: 'Riesgo de helada', unidadPorDefecto: '°C' },
    calor: { definicion: 'Temperatura máxima pronosticada en la ventana.', etiquetaPorDefecto: 'Calor extremo', unidadPorDefecto: '°C' },
    eto: { definicion: 'ETₒ pronosticada para las próximas 24 h (suma horaria del modelo).', etiquetaPorDefecto: 'Demanda evaporativa alta', unidadPorDefecto: 'mm/día' },
};

/** Serie del modelo recortada a [desde, hasta] como puntos limpios. */
function seriePuntos(e: EstacionConLectura, desdeMs: number, hastaMs: number): PuntoPronostico[] {
    return e.pronosticoSerie
        .map((p: PronosticoHora): PuntoPronostico => ({
            ts: new Date(p.valido_en).getTime(),
            tempC: valorPlausible('tempC', num(p.temp_c)),
            precipMm: num(p.precip_mm),
            probPct: num(p.precip_prob_pct),
            vientoMs: valorPlausible('vientoMs', num(p.viento_ms)),
            nubPct: num(p.nubosidad_total_pct),
            etoMm: num(p.eto_fc_mm),
        }))
        .filter(p => p.ts >= desdeMs && p.ts <= hastaMs)
        .sort((a, b) => a.ts - b.ts);
}

interface EvalSerie {
    valor: number | null;
    cuandoMs: number | null;
    nivel: NivelRiesgo;
    ventanas: VentanaRiesgo[];
}

/** Evalúa los 5 riesgos de UNA serie contra los umbrales (misma lógica para la red y para cada módulo). */
function evaluaSerie(
    pts: PuntoPronostico[], nombre: string, umb: Map<ClaveRiesgo, UmbralClima>, umbViento?: UmbralClima,
): Record<ClaveRiesgo, EvalSerie> {
    const out = {} as Record<ClaveRiesgo, EvalSerie>;
    const vacio = (): EvalSerie => ({ valor: null, cuandoMs: null, nivel: 'normal', ventanas: [] });
    for (const c of CLAVES) out[c] = vacio();

    const ventanasDe = (cumple: (p: PuntoPronostico) => NivelRiesgo | null): VentanaRiesgo[] => {
        const vs: VentanaRiesgo[] = [];
        let act: VentanaRiesgo | null = null;
        for (const p of pts) {
            const n = cumple(p);
            if (n) {
                if (act && p.ts - act.hastaMs <= MS_H * 1.5) { act.hastaMs = p.ts; act.nivel = peorNivel(act.nivel, n); }
                else { if (act) vs.push(act); act = { desdeMs: p.ts, hastaMs: p.ts, nivel: n, estacion: nombre }; }
            } else if (act) { vs.push(act); act = null; }
        }
        if (act) vs.push(act);
        return vs;
    };

    const extremo = (campo: 'tempC' | 'vientoMs', modo: 'max' | 'min') => {
        let mejor: PuntoPronostico | null = null;
        for (const p of pts) {
            const v = p[campo];
            if (v == null) continue;
            if (!mejor || (modo === 'max' ? v > (mejor[campo] as number) : v < (mejor[campo] as number))) mejor = p;
        }
        return mejor;
    };

    const u = (c: ClaveRiesgo) => umb.get(c);
    const vp = extremo('vientoMs', 'max');
    if (vp && (umbViento ?? u('viento'))) {
        const uu = (umbViento ?? u('viento'))!;
        out.viento = { valor: vp.vientoMs, cuandoMs: vp.ts, nivel: nivelDe(vp.vientoMs, uu),
            ventanas: ventanasDe(p => { const n = nivelDe(p.vientoMs, uu); return n === 'normal' ? null : n; }) };
    }
    const cp = extremo('tempC', 'max');
    if (cp && u('calor')) {
        const uu = u('calor')!;
        out.calor = { valor: cp.tempC, cuandoMs: cp.ts, nivel: nivelDe(cp.tempC, uu),
            ventanas: ventanasDe(p => { const n = nivelDe(p.tempC, uu); return n === 'normal' ? null : n; }) };
    }
    const hp = extremo('tempC', 'min');
    if (hp && u('helada')) {
        const uu = u('helada')!;
        out.helada = { valor: hp.tempC, cuandoMs: hp.ts, nivel: nivelDe(hp.tempC, uu),
            ventanas: ventanasDe(p => { const n = nivelDe(p.tempC, uu); return n === 'normal' ? null : n; }) };
    }
    // Lluvia: mayor acumulado en cualquier ventana móvil de 24 h.
    const conLluvia = pts.filter(p => p.precipMm != null);
    if (conLluvia.length && u('lluvia')) {
        let mejor = 0, mejorTs = conLluvia[0].ts, j = 0, suma = 0;
        for (let i = 0; i < conLluvia.length; i++) {
            suma += conLluvia[i].precipMm ?? 0;
            while (conLluvia[i].ts - conLluvia[j].ts >= 24 * MS_H) { suma -= conLluvia[j].precipMm ?? 0; j++; }
            if (suma > mejor) { mejor = suma; mejorTs = conLluvia[i].ts; }
        }
        const uu = u('lluvia')!;
        // El modelo llegó a sobrestimar la lámina al doble (99 mm pronosticados vs 55 mm medidos): el nivel solo se activa
        // si la probabilidad máxima de la ventana de 24 h es ≥ 60 % (igual que la alerta de BD). El valor se muestra siempre.
        const probs = pts.filter(p => p.probPct != null && p.ts > mejorTs - 24 * MS_H && p.ts <= mejorTs).map(p => p.probPct as number);
        const confirmada = !probs.length || Math.max(...probs) >= PROB_LLUVIA_CONFIRMA_PCT;
        const nivelLluvia: NivelRiesgo = confirmada ? nivelDe(mejor, uu) : 'normal';
        out.lluvia = { valor: Math.round(mejor * 10) / 10, cuandoMs: mejorTs, nivel: nivelLluvia,
            // Ventanas: horas con lluvia perceptible (≥ 0.5 mm/h), para saber CUÁNDO llueve.
            ventanas: ventanasDe(p => ((p.precipMm ?? 0) >= 0.5 ? nivelLluvia : null)) };
    }
    // ETₒ próximas 24 h.
    const conEto = pts.filter(p => p.etoMm != null).slice(0, 24);
    if (conEto.length >= 12 && u('eto')) {
        const total = conEto.reduce((s, p) => s + (p.etoMm ?? 0), 0);
        out.eto = { valor: Math.round(total * 100) / 100, cuandoMs: null, nivel: nivelDe(total, u('eto')!), ventanas: [] };
    }
    return out;
}

const NIVEL_LLUVIA = (mmh: number): 0 | 1 | 2 | 3 => (mmh >= 7.6 ? 3 : mmh >= 2.5 ? 2 : mmh >= 0.2 ? 1 : 0);

function banda(ejeHoras: number[], series: PuntoPronostico[][], campo: keyof Omit<PuntoPronostico, 'ts'>): BandaHoraria[] {
    return ejeHoras.map(ts => {
        const vals = series
            .map(s => s.find(p => p.ts === ts)?.[campo])
            .filter((v): v is number => v != null);
        if (!vals.length) return { ts, min: null, media: null, max: null };
        return { ts, min: Math.min(...vals), media: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) };
    });
}

// ── Verificación: agrega por variable/horizonte, sin estaciones sospechosas ─
const aNum = (v: number | string | null | undefined): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const ORDEN_RANGO: Record<string, number> = { '0-6 h': 0, '7-24 h': 1, '25-48 h': 2 };

/** Mediana de una lista de números (lista no vacía). */
const mediana = (xs: number[]) => { const o = [...xs].sort((a, b) => a - b); const m = Math.floor(o.length / 2); return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };

/**
 * Estaciones cuyo error de temperatura a 0-6 h es anómalo frente al resto de la red (≥ 3 °C y más de 3 veces la
 * mediana): casi siempre es un sensor averiado que la BD aún no marca como sospechoso (Riego San Rafael, 6.4 °C
 * contra ~1.3 °C de las demás). Se excluyen de TODA la verificación para no contaminar las cifras.
 */
export function estacionesConErrorAnomalo(filas: FilaSkillVariable[]): Map<string, string> {
    const porEst = filas
        .filter(r => r.variable === 'temperatura' && r.rango_horizonte === '0-6 h' && aNum(r.mae) != null && (aNum(r.n) ?? 0) >= 30)
        .map(r => ({ id: r.estacion_id, nombre: r.estacion_nombre, mae: aNum(r.mae)! }));
    const out = new Map<string, string>();
    if (porEst.length < 3) return out;
    const med = mediana(porEst.map(x => x.mae));
    for (const x of porEst) if (x.mae >= 3 && x.mae > 3 * med) out.set(x.id, x.nombre);
    return out;
}

export function resumeVerificacion(v: EntradaVerificacion, sospechosaIds: Set<string>, nombresExcluidos: string[]): ResumenVerificacion {
    const anomalas = estacionesConErrorAnomalo(v.variables);
    const fuera = (id: string) => sospechosaIds.has(id) || anomalas.has(id);
    const buenas = v.variables.filter(r => !fuera(r.estacion_id));
    const grupos = new Map<string, FilaSkillVariable[]>();
    for (const r of buenas) {
        const k = `${r.variable}|${r.rango_horizonte}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k)!.push(r);
    }
    const variables: ResumenSkillVariable[] = [];
    for (const [k, filas] of grupos) {
        const [variable, rango] = k.split('|');
        if (variable !== 'temperatura' && variable !== 'viento') continue;
        let n = 0, sMae = 0, sSes = 0;
        for (const f of filas) {
            const nn = aNum(f.n) ?? 0, mae = aNum(f.mae), ses = aNum(f.sesgo);
            if (!nn || mae == null || ses == null) continue;
            n += nn; sMae += mae * nn; sSes += ses * nn;
        }
        if (n > 0) variables.push({ variable, rango, n, mae: sMae / n, sesgo: sSes / n, unidad: variable === 'temperatura' ? '°C' : 'm/s' });
    }
    variables.sort((a, b) => a.variable.localeCompare(b.variable) || (ORDEN_RANGO[a.rango] ?? 9) - (ORDEN_RANGO[b.rango] ?? 9));

    const filasLluvia = v.lluviaDias.filter(r => !fuera(r.estacion_id))
        .map(r => ({ e: r.estacion_nombre, dia: r.dia, p: aNum(r.mm_pronosticado), o: aNum(r.mm_observado) }))
        .filter((r): r is { e: string; dia: string; p: number; o: number } => r.p != null && r.o != null);
    let lluvia: ResumenVerificacion['lluvia'] = null;
    if (filasLluvia.length) {
        // Se cuentan DÍAS (no estación-día): un mismo temporal cae en varias estaciones y no son eventos independientes.
        const diasUnicos = new Set(filasLluvia.map(d => d.dia));
        const diasConLluvia = new Set(filasLluvia.filter(d => d.o >= 5).map(d => d.dia));
        const diasDetectados = new Set(filasLluvia.filter(d => d.o >= 5 && d.p >= 2.5).map(d => d.dia));
        const peor = filasLluvia.reduce((m, d) => (Math.abs(d.p - d.o) > Math.abs(m.p - m.o) ? d : m), filasLluvia[0]);
        lluvia = {
            dias: diasUnicos.size,
            totalPronosticadoMm: Math.round(filasLluvia.reduce((s, d) => s + d.p, 0) * 10) / 10,
            totalObservadoMm: Math.round(filasLluvia.reduce((s, d) => s + d.o, 0) * 10) / 10,
            diasConLluviaObservada: diasConLluvia.size,
            detectados: diasDetectados.size,
            peor: Math.abs(peor.p - peor.o) >= 2 ? { estacion: peor.e, dia: peor.dia, pronosticadoMm: peor.p, observadoMm: peor.o } : null,
        };
    }
    const excluidas = [...new Set([...nombresExcluidos, ...anomalas.values()])];
    return { variables, lluvia, corridasConservadas: v.corridasConservadas, estacionesExcluidas: excluidas };
}

// ── Construcción principal ──────────────────────────────────────────────────
export function construirDatosPronostico(e: EntradaPronostico): DatosPronostico {
    const ahoraMs = e.ahora.getTime();
    const desdeMs = Math.floor(ahoraMs / MS_H) * MS_H;
    const hastaMs = desdeMs + e.horizonteH * MS_H;
    const ejeHoras: number[] = [];
    for (let t = desdeMs; t <= hastaMs; t += MS_H) ejeHoras.push(t);

    const umb = new Map<ClaveRiesgo, UmbralClima>();
    for (const u of e.umbrales) if ((CLAVES as string[]).includes(u.clave)) umb.set(u.clave as ClaveRiesgo, u);

    // Estaciones con pronóstico utilizable.
    const conSerie = e.estaciones
        .map(est => ({ est, pts: seriePuntos(est, desdeMs, hastaMs) }))
        .filter(x => x.pts.length > 0);
    // Presas (zona abierta): su viento normal supera el umbral de riego por aspersión de los módulos; tienen umbral propio.
    const umbVientoPresa = e.umbrales.find(u => u.clave === 'viento_presa');
    const esPresa = (est: EstacionConLectura) => est.rol === 'presa' && !!umbVientoPresa;
    const evalPorEst = new Map(conSerie.map(x => [x.est.id, evaluaSerie(x.pts, x.est.nombre, umb, esPresa(x.est) ? umbVientoPresa : undefined)]));

    // ── Riesgos de la red: peor estación por variable ───────────────────────
    const riesgos: Riesgo[] = CLAVES.filter(c => umb.has(c)).map(c => {
        const u = umb.get(c)!;
        let mejor: { valor: number; nombre: string; cuando: number | null; ev: EvalSerie; u: UmbralClima } | null = null;
        for (const x of conSerie) {
            const ev = evalPorEst.get(x.est.id)![c];
            if (ev.valor == null) continue;
            const uEst = c === 'viento' && esPresa(x.est) ? umbVientoPresa! : u;
            // Gana el peor NIVEL (cada estación con su propio umbral) y, a igual nivel, el valor más extremo.
            const dn = mejor ? RANGO_NIVEL[ev.nivel] - RANGO_NIVEL[mejor.ev.nivel] : 1;
            const mejorQue = !mejor || dn > 0 || (dn === 0 && (u.comparador === 'mayor' ? ev.valor > mejor.valor : ev.valor < mejor.valor));
            if (mejorQue) mejor = { valor: ev.valor, nombre: x.est.nombre, cuando: ev.cuandoMs, ev, u: uEst };
        }
        const uM = mejor?.u ?? u;
        const ventanas = conSerie
            .flatMap(x => evalPorEst.get(x.est.id)![c].ventanas)
            .sort((a, b) => RANGO_NIVEL[b.nivel] - RANGO_NIVEL[a.nivel] || a.desdeMs - b.desdeMs)
            .slice(0, 6);
        return {
            clave: c,
            etiqueta: u.etiqueta || DEF_RIESGO[c].etiquetaPorDefecto,
            unidad: u.unidad || DEF_RIESGO[c].unidadPorDefecto,
            comparador: u.comparador, aviso: Number(uM.aviso), critico: Number(uM.critico),
            accion: u.accion,
            valor: mejor?.valor ?? null,
            nivel: mejor ? mejor.ev.nivel : 'normal',
            estacion: mejor?.nombre ?? null,
            cuandoMs: mejor?.cuando ?? null,
            ventanas,
            definicion: DEF_RIESGO[c].definicion,
        };
    });
    const riesgoDe = (c: ClaveRiesgo) => riesgos.find(r => r.clave === c);

    // ── Línea de tiempo (una celda por hora) ────────────────────────────────
    const porHora = (campo: 'vientoMs' | 'tempC' | 'precipMm') => ejeHoras.map(ts => {
        const vals = conSerie.map(x => x.pts.find(p => p.ts === ts)?.[campo]).filter((v): v is number => v != null);
        return vals.length ? vals : null;
    });
    const celdasNivel = (campo: 'vientoMs' | 'tempC', clave: ClaveRiesgo, modo: 'max' | 'min') =>
        porHora(campo).map(vals => {
            const u = umb.get(clave);
            if (!vals || !u) return null;
            const v = modo === 'max' ? Math.max(...vals) : Math.min(...vals);
            return { nivel: nivelDe(v, { comparador: u.comparador, aviso: Number(u.aviso), critico: Number(u.critico) }) };
        });
    // Viento: cada estación contra su propio umbral (presas aparte); la celda toma el peor nivel de la red.
    const celdasViento = ejeHoras.map(ts => {
        let nivelH: NivelRiesgo | null = null;
        for (const x of conSerie) {
            const v = x.pts.find(p => p.ts === ts)?.vientoMs;
            const uu = esPresa(x.est) ? umbVientoPresa : umb.get('viento');
            if (v == null || !uu) continue;
            nivelH = peorNivel(nivelH ?? 'normal', nivelDe(v, { comparador: uu.comparador, aviso: Number(uu.aviso), critico: Number(uu.critico) }));
        }
        return nivelH ? { nivel: nivelH } : null;
    });
    const lineaTiempo: FilaLineaTiempo[] = [
        { clave: 'viento', etiqueta: 'Viento', celdas: celdasViento },
        { clave: 'lluvia', etiqueta: 'Lluvia', celdas: porHora('precipMm').map(vals => (vals ? { lluvia: NIVEL_LLUVIA(Math.max(...vals)) } : null)) },
        { clave: 'helada', etiqueta: 'Frío / helada', celdas: celdasNivel('tempC', 'helada', 'min') },
        { clave: 'calor', etiqueta: 'Calor', celdas: celdasNivel('tempC', 'calor', 'max') },
    ];

    // ── Bandas de las gráficas ──────────────────────────────────────────────
    const series = conSerie.map(x => x.pts);
    const bandas = {
        temp: banda(ejeHoras, series, 'tempC'),
        lluvia: banda(ejeHoras, series, 'precipMm'),
        viento: banda(ejeHoras, series, 'vientoMs'),
        nubosidad: banda(ejeHoras, series, 'nubPct'),
    };

    // ── Resumen por día local (lenguaje llano) ──────────────────────────────
    const hoyClave = claveDia(ahoraMs);
    const porDia = new Map<string, number[]>();
    for (const ts of ejeHoras) {
        const k = claveDia(ts);
        if (!porDia.has(k)) porDia.set(k, []);
        porDia.get(k)!.push(ts);
    }
    const dias: ResumenDia[] = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([clave, horas], idx) => {
        const set = new Set(horas);
        const ptsDia = conSerie.map(x => ({ nombre: x.est.nombre, pts: x.pts.filter(p => set.has(p.ts)) }));
        const todos = ptsDia.flatMap(x => x.pts);
        const nums = (f: (p: PuntoPronostico) => number | null) => todos.map(f).filter((v): v is number => v != null);
        const temps = nums(p => p.tempC), vientos = nums(p => p.vientoMs), probs = nums(p => p.probPct), nubs = nums(p => p.nubPct);
        // Lámina: total por estación en el día; el promedio de la zona es la media de esos totales.
        const totales = ptsDia
            .filter(x => x.pts.some(p => p.precipMm != null))
            .map(x => ({ nombre: x.nombre, mm: x.pts.reduce((s, p) => s + (p.precipMm ?? 0), 0) }));
        const mejorLluvia = totales.length ? totales.reduce((m, t) => (t.mm > m.mm ? t : m)) : null;
        const vMax = todos.reduce<PuntoPronostico | null>((m, p) => ((p.vientoMs ?? -1) > (m?.vientoMs ?? -1) ? p : m), null);
        const franjas = new Set<Franja>();
        let picoMs: number | null = null, picoMm = 0.3, lluviaDesde: number | null = null, lluviaHasta: number | null = null;
        for (const ts of horas) {
            const mmHora = Math.max(0, ...conSerie.map(x => x.pts.find(p => p.ts === ts)?.precipMm ?? 0));
            if (mmHora >= 0.3) { franjas.add(franjaDe(ts)); if (lluviaDesde == null) lluviaDesde = ts; lluviaHasta = ts + MS_H; }
            if (mmHora >= picoMm) { picoMm = mmHora; picoMs = ts; }
        }
        const etiqueta = clave === hoyClave ? 'Hoy' : idx === 1 ? 'Mañana' : idx === 2 ? 'Pasado mañana' : fmtDia(horas[0]);
        return {
            clave, etiqueta, fechaTxt: fmtDia(horas[0]), horas: horas.length,
            parcial: horas.length < 20, hastaMs: horas[horas.length - 1],
            tMinC: temps.length ? Math.min(...temps) : null, tMaxC: temps.length ? Math.max(...temps) : null,
            probMaxPct: probs.length ? Math.max(...probs) : null,
            lluviaPromMm: totales.length ? Math.round((totales.reduce((s, t) => s + t.mm, 0) / totales.length) * 10) / 10 : null,
            lluviaMaxMm: mejorLluvia ? Math.round(mejorLluvia.mm * 10) / 10 : null,
            lugarMasLluvia: mejorLluvia && mejorLluvia.mm >= 0.3 ? mejorLluvia.nombre : null,
            vientoMaxMs: vientos.length ? Math.max(...vientos) : null,
            vientoMaxHoraMs: vMax?.vientoMs != null ? vMax.ts : null,
            nubMediaPct: nubs.length ? nubs.reduce((a, b) => a + b, 0) / nubs.length : null,
            franjasLluvia: (['madrugada', 'mañana', 'tarde', 'noche'] as Franja[]).filter(f => franjas.has(f)),
            horaPicoLluviaMs: picoMs,
            lluviaDesdeMs: lluviaDesde, lluviaHastaMs: lluviaHasta,
        };
    });

    // ── Parte medida de la franja de 72 h (últimas 24 h) ────────────────────
    const ejeObs: number[] = [];
    for (let t = desdeMs - 24 * MS_H; t <= desdeMs; t += MS_H) ejeObs.push(t);
    const lecturasBuenas = (e.observado ?? []).filter(o => !e.sospechosaIds.has(o.estacionId));
    const bandaObs = (campo: 'tempC' | 'vientoMs'): BandaHoraria[] => ejeObs.map(t => {
        const fin = t === desdeMs ? ahoraMs + 1 : t + MS_H;     // la hora en curso llega hasta "ahora"
        const vals = lecturasBuenas
            .filter(o => { const ts = new Date(o.ts).getTime(); return ts >= t && ts < fin; })
            .map(o => valorPlausible(campo === 'tempC' ? 'tempC' : 'vientoMs', num(o[campo])))
            .filter((v): v is number => v != null);
        return vals.length ? { ts: t, min: Math.min(...vals), media: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) } : { ts: t, min: null, media: null, max: null };
    });
    const observadas = { ejeHoras: ejeObs, temp: bandaObs('tempC'), viento: bandaObs('vientoMs') };

    // Lluvia ya registrada hoy: último acumulado del día local de cada estación que reportó HOY.
    const lluviasHoy = e.estaciones
        .filter(s => !e.sospechosaIds.has(s.id) && s.lectura?.lluvia_dia_mm != null && claveDia(new Date(s.lectura.ts).getTime()) === hoyClave)
        .map(s => ({ nombre: s.nombre, mm: Number(s.lectura!.lluvia_dia_mm) }));
    const lluviaHoy = lluviasHoy.length ? (() => {
        const mx = lluviasHoy.reduce((m, x) => (x.mm > m.mm ? x : m), lluviasHoy[0]);
        return { promMm: Math.round((lluviasHoy.reduce((a, x) => a + x.mm, 0) / lluviasHoy.length) * 10) / 10, maxMm: Math.round(mx.mm * 10) / 10, lugarMax: mx.nombre };
    })() : null;

    // ── Módulos ─────────────────────────────────────────────────────────────
    const estacionesGeo = conSerie.map(x => x.est);
    const modulos: ResumenModulo[] = MODULOS_SRL_IDS.map(n => {
        const propias = estacionesGeo.filter(s => numeroModuloDeId(s.modulo_id) === n && s.rol === 'modulo');
        const cen = centroideModulo(n);
        let est: EstacionConLectura | null = propias[0] ?? null;
        let dist: number | null = null;
        if (!est && cen) {
            let mejorD = Infinity;
            for (const s of estacionesGeo) {
                // Una presa queda fuera del distrito: su clima no representa a un módulo de riego.
                if (s.rol === 'presa') continue;
                const d = haversineKm(cen.lat, cen.lon, s.latitud, s.longitud);
                if (d < mejorD) { mejorD = d; est = s; }
            }
            dist = est ? mejorD : null;
        }
        const pts = est ? conSerie.find(x => x.est.id === est!.id)?.pts ?? [] : [];
        const ev = est ? evalPorEst.get(est.id) : undefined;
        const pico = pts.reduce<{ mmh: number; ms: number } | null>((m, p) => ((p.precipMm ?? 0) > (m?.mmh ?? 0) ? { mmh: p.precipMm!, ms: p.ts } : m), null);
        const temps = pts.map(p => p.tempC).filter((v): v is number => v != null);
        const vientos = pts.map(p => p.vientoMs).filter((v): v is number => v != null);
        const lluviaTotal = pts.some(p => p.precipMm != null) ? pts.reduce((s, p) => s + (p.precipMm ?? 0), 0) : null;
        const probs = pts.map(p => p.probPct).filter((v): v is number => v != null);

        const riesgosMod = {} as ResumenModulo['riesgos'];
        for (const c of CLAVES) riesgosMod[c] = { nivel: ev?.[c].nivel ?? 'normal', valor: ev?.[c].valor ?? null };

        // Decisión operativa: cada regla cita el umbral de clima_umbrales que la dispara.
        const acciones: string[] = [];
        let nivel: NivelRiesgo = 'normal';
        const agrega = (c: ClaveRiesgo, texto: string) => {
            const r = ev?.[c];
            if (!r || r.nivel === 'normal') return;
            nivel = peorNivel(nivel, r.nivel);
            const v = r.ventanas[0];
            acciones.push(`${texto}${v ? ` (${fmtVentana(v.desdeMs, v.hastaMs)})` : ''}`);
        };
        agrega('viento', 'Evitar riego por aspersión: viento fuerte');
        agrega('lluvia', 'Reducir entregas y revisar tomas y drenes: lluvia intensa');
        agrega('helada', 'Proteger cultivos sensibles y posponer riegos nocturnos: frío');
        agrega('calor', 'Programar riegos de madrugada: calor');
        agrega('eto', 'Subir la lámina de riego: alta demanda evaporativa');

        const ha = superficieRiegoHa(n);
        const lluvia24 = ev?.lluvia.valor ?? null;
        const eto24 = ev?.eto.valor ?? null;
        const bruta = laminaBruta(eto24);
        const demanda = bruta != null && ha != null ? (m3PorHa(bruta) ?? 0) * ha : null;
        const efect = lluviaEfectivaMm(lluvia24);
        let demandaConLluvia: number | null = null;
        if (eto24 != null && ha != null && efect != null) {
            const neta = laminaNeta(eto24) ?? 0;
            const brutaCon = Math.max(0, neta - efect) / EFICIENCIA_RODADO;
            demandaConLluvia = (m3PorHa(brutaCon) ?? 0) * ha;
        }
        const ahorro = demanda != null && demandaConLluvia != null ? Math.max(0, demanda - demandaConLluvia) : null;
        if (!acciones.length && lluvia24 != null && lluvia24 >= LLUVIA_MIN_EFECTIVA_MM && ahorro != null && ahorro > 0) {
            acciones.push(`Lluvia aprovechable (${lluvia24.toFixed(1)} mm en 24 h): se puede diferir riego, ahorro estimado ≈ ${Math.round(ahorro).toLocaleString('es-MX')} m³`);
        }
        const resumen = acciones[0] ?? 'Operación normal: sin umbrales de aviso en el horizonte.';
        return {
            numero: n,
            estacion: est?.nombre ?? 'S/D',
            propia: propias.length > 0, distanciaKm: dist != null ? Math.round(dist * 10) / 10 : null,
            tMinC: temps.length ? Math.min(...temps) : null,
            tMaxC: temps.length ? Math.max(...temps) : null,
            vientoMaxMs: vientos.length ? Math.max(...vientos) : null,
            lluviaTotalMm: lluviaTotal != null ? Math.round(lluviaTotal * 10) / 10 : null,
            lluviaMax24hMm: lluvia24,
            probMaxPct: probs.length ? Math.max(...probs) : null,
            picoLluvia: pico && pico.mmh >= 0.2 ? pico : null,
            riesgos: riesgosMod,
            decision: { nivel, acciones, resumen },
            superficieHa: ha,
            demandaM3: demanda, demandaConLluviaM3: demandaConLluvia, ahorroLluviaM3: ahorro,
            entregadoHoyM3: e.contexto?.entregasPorModulo?.get(n) ?? null,
            sinEstacion: est == null || pts.length === 0,
            horas: pts.map(p => ({ ts: p.ts, probPct: p.probPct, precipMm: p.precipMm, tempC: p.tempC, vientoMs: p.vientoMs })),
            probPorDia: dias.map(dia => {
                const delDia = pts.filter(p => claveDia(p.ts) === dia.clave);
                const probs = delDia.map(p => p.probPct).filter((v): v is number => v != null);
                const mm = delDia.filter(p => p.precipMm != null);
                return {
                    clave: dia.clave, etiqueta: dia.etiqueta, parcial: dia.parcial,
                    probMaxPct: probs.length ? Math.max(...probs) : null,
                    lluviaMm: mm.length ? Math.round(mm.reduce((a, p) => a + (p.precipMm ?? 0), 0) * 10) / 10 : null,
                };
            }),
        };
    });

    // ── Confiabilidad ───────────────────────────────────────────────────────
    const estacionesConf: EstacionConfiabilidad[] = e.estaciones.map(est => {
        const l = est.lectura;
        const sosp = e.sospechosaIds.has(est.id);
        const corrida = est.pronostico?.corrida_en ?? est.pronosticoSerie[0]?.corrida_en ?? null;
        const edadCorrida = corrida ? Math.max(0, Math.round((ahoraMs - new Date(corrida).getTime()) / 60_000)) : null;
        return {
            id: est.id, nombre: est.nombre, rol: est.rol,
            edadLecturaMin: est.calidad.edadMin,
            calidad: est.calidad.etiqueta,
            sospechosa: sosp,
            // Un valor observado de una estación sospechosa o fuera de rango es S/D.
            observado: {
                tempC: sosp ? null : valorPlausible('tempC', num(l?.temp_c)),
                vientoMs: sosp ? null : valorPlausible('vientoMs', num(l?.viento_ms)),
                lluviaDiaMm: sosp ? null : num(l?.lluvia_dia_mm),
            },
            puntosPronostico: conSerie.find(x => x.est.id === est.id)?.pts.length ?? 0,
            corridaEn: corrida, edadCorridaMin: edadCorrida,
            corridaVieja: edadCorrida != null && edadCorrida > CORRIDA_VIEJA_MIN,
        };
    });
    const estacionesExcluidas = estacionesConf
        .filter(c => c.sospechosa)
        .map(c => ({ nombre: c.nombre, motivo: 'Sensor con lecturas implausibles (fuera de −25…48 °C o muy lejos de la mediana de la red): sus valores observados se muestran S/D y no entran a ningún promedio. Su pronóstico es del modelo y no depende del sensor.' }));

    // ── Alertas vigentes con procedencia explícita ──────────────────────────
    const alertas: AlertaInforme[] = e.alertas.filter(a => a.categoria === 'agroclimatica').map(a => {
        let aclaracion: string | null = null;
        if (/viento/i.test(a.titulo)) {
            const est = e.estaciones.find(s => a.titulo.includes(s.nombre) || a.mensaje.includes(s.nombre));
            if (est) {
                const obs = e.sospechosaIds.has(est.id) ? null : valorPlausible('vientoMs', num(est.lectura?.viento_ms));
                const fc = evalPorEst.get(est.id)?.viento.valor ?? null;
                aclaracion = `Procedencia: la alerta toma el mayor entre la última lectura observada y el pronóstico de 48 h (no es un máximo observado de 48 h). `
                    + `Ahora en ${est.nombre}: observado ${obs != null ? `${obs.toFixed(1)} m/s` : 'S/D'} · pronóstico máx. ${fc != null ? `${fc.toFixed(1)} m/s` : 'S/D'} (sostenido).`;
            }
        }
        return { titulo: a.titulo, mensaje: a.mensaje, detectadaEn: a.detectadaEn, aclaracion };
    });

    // ── Modelo y avisos de calidad ──────────────────────────────────────────
    const corridas = estacionesConf.map(c => c.corridaEn).filter((c): c is string => !!c).sort();
    const corridaReciente = corridas.length ? corridas[corridas.length - 1] : null;
    const edadModelo = corridaReciente ? Math.max(0, Math.round((ahoraMs - new Date(corridaReciente).getTime()) / 60_000)) : null;
    const primerPron = e.estaciones.find(s => s.pronostico)?.pronostico ?? null;
    const avisosCalidad: string[] = [];
    if (!conSerie.length) avisosCalidad.push('No hay pronóstico disponible en la base de datos: el informe no puede emitir recomendaciones.');
    if (edadModelo != null && edadModelo > CORRIDA_VIEJA_MIN) avisosCalidad.push(`El pronóstico tiene ${Math.round(edadModelo / 60)} h de antigüedad: la sincronización horaria no se ha actualizado, interprete con cautela.`);
    if (estacionesExcluidas.length) avisosCalidad.push(`${estacionesExcluidas.map(x => x.nombre).join(', ')}: lecturas observadas excluidas por sensor sospechoso.`);
    const sinPron = e.estaciones.filter(s => !conSerie.some(x => x.est.id === s.id));
    if (sinPron.length) avisosCalidad.push(`Sin pronóstico para: ${sinPron.map(s => s.nombre).join(', ')}.`);

    // ── Titular y puntos clave ──────────────────────────────────────────────
    const cambioTemp = cambioTempDeAlertas(e.alertas);
    const nivelGlobal = riesgos.reduce<NivelRiesgo>((n, r) => peorNivel(n, r.nivel), cambioTemp?.nivel ?? 'normal');
    const activos = riesgos.filter(r => r.nivel !== 'normal').sort((a, b) => RANGO_NIVEL[b.nivel] - RANGO_NIVEL[a.nivel]);
    const textoCambio = cambioTemp
        ? `${cambioTemp.sentido === 'descenso' ? 'descenso' : 'ascenso'} brusco de temperatura (${cambioTemp.gradosC != null ? `${cambioTemp.gradosC.toFixed(1)} °C en 24 h` : 'en 24 h'}${cambioTemp.estaciones != null ? `, ${cambioTemp.estaciones} estaciones` : ''})`
        : null;
    const fmtV = (r: Riesgo) => `${r.valor!.toFixed(r.clave === 'eto' ? 1 : r.clave === 'lluvia' ? 1 : 1)} ${r.unidad}`;
    const NOMBRE_CORTO: Record<ClaveRiesgo, string> = { viento: 'Viento fuerte', lluvia: 'Lluvia intensa', helada: 'Riesgo de helada', calor: 'Calor extremo', eto: 'Alta demanda evaporativa' };
    const titular = !conSerie.length
        ? 'Sin pronóstico disponible'
        : activos.length || textoCambio
            ? `${nivelGlobal === 'critico' ? 'Atención' : 'Precaución'}: ${[
                ...(textoCambio ? [textoCambio] : []),
                ...activos.slice(0, 3).map(r => `${NOMBRE_CORTO[r.clave].toLowerCase()} (${fmtV(r)}${r.estacion ? `, ${r.estacion}` : ''})`),
            ].slice(0, 3).join(' · ')}`
            : `Sin riesgos agroclimáticos en las próximas ${e.horizonteH} h`;
    const puntosClave: string[] = [];
    if (cambioTemp && textoCambio) {
        const signo = (v: number) => (cambioTemp.sentido === 'descenso' ? -v : v);
        const fmtC = (v: number) => `${signo(v) > 0 ? '+' : signo(v) < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} °C`;
        const partes = [cambioTemp.obsC != null ? `cambio medido ${fmtC(cambioTemp.obsC)}` : null, cambioTemp.fcC != null ? `cambio pronosticado ${fmtC(cambioTemp.fcC)}` : null].filter(Boolean).join(' · ');
        puntosClave.push(`Cambio de temperatura: ${textoCambio}${partes ? ` — ${partes}` : ''}. Compara la misma hora con 24 h antes; no es el ciclo día-noche.`);
    }
    const rV = riesgoDe('viento'), rL = riesgoDe('lluvia'), rH = riesgoDe('helada'), rC = riesgoDe('calor');
    const todasT = conSerie.flatMap(x => x.pts.map(p => p.tempC)).filter((v): v is number => v != null);
    if (todasT.length) puntosClave.push(`Temperatura prevista de ${Math.min(...todasT).toFixed(1)} a ${Math.max(...todasT).toFixed(1)} °C en la red.`);
    if (rL?.valor != null) puntosClave.push(rL.valor >= 0.2
        ? `Lluvia: hasta ${rL.valor.toFixed(1)} mm en 24 h (${rL.estacion})${rL.cuandoMs ? `, con el máximo acumulado hacia ${fmtDiaHora(rL.cuandoMs)}` : ''}.`
        : 'Sin lluvia significativa prevista.');
    if (rV?.valor != null) puntosClave.push(`Viento sostenido máximo ${rV.valor.toFixed(1)} m/s en ${rV.estacion}${rV.cuandoMs ? ` (${fmtDiaHora(rV.cuandoMs)})` : ''}; umbral de aviso ${rV.aviso} m/s.`);
    if (rH?.valor != null && rH.nivel === 'normal') puntosClave.push(`Sin riesgo de helada: mínima prevista ${rH.valor.toFixed(1)} °C (aviso ≤ ${rH.aviso} °C).`);
    if (rC?.valor != null && rC.nivel === 'normal') puntosClave.push(`Sin calor extremo: máxima prevista ${rC.valor.toFixed(1)} °C (aviso ≥ ${rC.aviso} °C).`);

    return {
        generadoMs: ahoraMs, horizonteH: e.horizonteH, modoTecnico: e.modoTecnico,
        desdeMs, hastaMs, ejeHoras,
        titular, nivel: conSerie.length ? nivelGlobal : 'normal', puntosClave,
        riesgos, lineaTiempo, bandas, dias, observadas, lluviaHoy, modulos,
        estaciones: estacionesConf, estacionesExcluidas, alertas, cambioTemp,
        contexto: e.contexto ?? {},
        modelo: {
            proveedor: primerPron?.proveedor ?? 'open-meteo', modelo: primerPron?.modelo ?? 'best_match',
            corridaEn: corridaReciente, edadCorridaMin: edadModelo,
            vieja: edadModelo != null && edadModelo > CORRIDA_VIEJA_MIN,
        },
        avisosCalidad,
        verificacion: e.verificacion
            ? resumeVerificacion(e.verificacion, e.sospechosaIds, estacionesExcluidas.map(x => x.nombre)) : null,
    };
}
