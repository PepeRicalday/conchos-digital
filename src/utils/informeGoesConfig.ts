/**
 * informeGoesConfig — configuración (filtros) del Informe de estaciones hidrométricas GOES. Puro: sin React ni red.
 * Básico = lectura ejecutiva para directivos; Técnico = además estadística, volumen, enlace, meteorología, calidad y metodología.
 * Las series de telemetría solo llegan a 30 días: un rango más antiguo se recorta y se avisa (nunca se inventa lo que falta).
 */
import { ORDEN_ESTACIONES, VENTANAS, type EstacionHidro, type VentanaHidro } from './hidroEstaciones';

export type ModalidadGoes = 'basico' | 'tecnico';
export type VariableInforme = 'nivel' | 'gasto' | 'velocidad' | 'meteo';
export type TipoPeriodoGoes = VentanaHidro | 'rango';
export type FormatoHoja = 'letter' | 'a4';
export type AtajoEstaciones = 'todas' | 'presas' | 'rio';

export type SeccionGoes =
    | 'resumen' | 'estado' | 'tendencia' | 'grafica'
    | 'estadistica' | 'volumen' | 'comparacion' | 'enlace' | 'meteo' | 'calidad' | 'metodologia' | 'trazabilidad';

export interface PeriodoGoes {
    tipo: TipoPeriodoGoes;
    /** Solo con tipo 'rango': días AAAA-MM-DD en hora de Chihuahua (ambos incluidos). */
    desde: string;
    hasta: string;
}

export interface ConfigInformeGoes {
    modalidad: ModalidadGoes;
    estaciones: string[];
    periodo: PeriodoGoes;
    variables: VariableInforme[];
    secciones: SeccionGoes[];
    formato: FormatoHoja;
}

export interface SeccionDef { id: SeccionGoes; etiqueta: string; ayuda: string; modalidades: ModalidadGoes[]; requiere?: VariableInforme[] }

const AMBAS: ModalidadGoes[] = ['basico', 'tecnico'];
const TEC: ModalidadGoes[] = ['tecnico'];

export const SECCIONES_GOES: SeccionDef[] = [
    { id: 'resumen', etiqueta: 'Portada y resumen ejecutivo', ayuda: 'Qué pasó en el periodo, en palabras', modalidades: AMBAS },
    { id: 'estado', etiqueta: 'Estado actual por estación', ayuda: 'Última lectura, enlace y variación de cada estación', modalidades: AMBAS },
    { id: 'tendencia', etiqueta: 'Tendencia 24 h y 7 d', ayuda: 'Qué sube, qué baja y qué está estable', modalidades: AMBAS },
    { id: 'grafica', etiqueta: 'Gráficas de gasto y nivel', ayuda: 'Series del periodo con banda mínimo–máximo', modalidades: AMBAS, requiere: ['nivel', 'gasto'] },
    { id: 'estadistica', etiqueta: 'Tabla estadística', ayuda: 'Media, mediana, mín/máx con hora, p10/p90, desviación y n', modalidades: TEC },
    { id: 'volumen', etiqueta: 'Volumen estimado', ayuda: 'Mm³ por integración del gasto y % de tiempo integrado', modalidades: TEC, requiere: ['gasto'] },
    { id: 'comparacion', etiqueta: 'Comparación presa ↔ río', ayuda: 'Orientativa; solo si hay base para sustentarla', modalidades: TEC, requiere: ['gasto'] },
    { id: 'enlace', etiqueta: 'Cobertura y salud del enlace', ayuda: 'Lecturas recibidas, tira de 24 h, señal y mensajes', modalidades: TEC },
    { id: 'meteo', etiqueta: 'Meteorología', ayuda: 'Temperatura, viento, humedad, presión y radiación', modalidades: TEC, requiere: ['meteo'] },
    { id: 'calidad', etiqueta: 'Notas de calidad de los datos', ayuda: 'Lecturas excluidas y canales no confiables', modalidades: TEC },
    { id: 'metodologia', etiqueta: 'Metodología', ayuda: 'Fuente, estadística, tendencia y límites', modalidades: TEC },
    { id: 'trazabilidad', etiqueta: 'Trazabilidad y firmas', ayuda: 'Folio, rango, fuente y bloque de firmas', modalidades: TEC },
];
export const ORDEN_SECCIONES_GOES: SeccionGoes[] = SECCIONES_GOES.map((s) => s.id);

/** Secciones disponibles según la modalidad. */
export function seccionesGoesDe(m: ModalidadGoes): SeccionDef[] {
    return SECCIONES_GOES.filter((s) => s.modalidades.includes(m));
}

export const SECCIONES_POR_DEFECTO_GOES: Record<ModalidadGoes, SeccionGoes[]> = {
    basico: seccionesGoesDe('basico').map((s) => s.id),
    tecnico: seccionesGoesDe('tecnico').map((s) => s.id),
};

export const VARIABLES_INFORME: { id: VariableInforme; etiqueta: string }[] = [
    { id: 'nivel', etiqueta: 'Nivel (m)' },
    { id: 'gasto', etiqueta: 'Gasto (m³/s)' },
    { id: 'velocidad', etiqueta: 'Velocidad (m/s)' },
    { id: 'meteo', etiqueta: 'Meteorología' },
];
export const ORDEN_VARIABLES: VariableInforme[] = VARIABLES_INFORME.map((v) => v.id);

/** Máximo de historia disponible en las series (días). */
export const MAX_DIAS_SERIES = 30;
const HORA = 3600000;
const DIA = 24 * HORA;
/** Chihuahua conserva UTC−6 todo el año (sin horario de verano desde 2022): los días del rango se acotan con ese desfase. */
export const OFFSET_CHIHUAHUA_MS = -6 * HORA;

export function configGoesPorDefecto(ventanaInicial: VentanaHidro = '24h'): ConfigInformeGoes {
    return {
        modalidad: 'basico',
        estaciones: [...ORDEN_ESTACIONES],
        periodo: { tipo: ventanaInicial in VENTANAS ? ventanaInicial : '24h', desde: '', hasta: '' },
        variables: [...ORDEN_VARIABLES],
        secciones: [...SECCIONES_POR_DEFECTO_GOES.basico],
        formato: 'letter',
    };
}

/** Cambiar de modalidad reinicia las secciones a las de esa modalidad. */
export function cambiarModalidadGoes(c: ConfigInformeGoes, m: ModalidadGoes): ConfigInformeGoes {
    return m === c.modalidad ? c : { ...c, modalidad: m, secciones: [...SECCIONES_POR_DEFECTO_GOES[m]] };
}

/** Atajo de agrupación → ids de estación (en el orden fijo). 'presas' = las de presa; 'rio' = las de río. */
export function estacionesDeAtajo(estaciones: EstacionHidro[], atajo: AtajoEstaciones): string[] {
    const sel = estaciones.filter((e) => atajo === 'todas' || (atajo === 'presas' ? e.presa_id != null : e.presa_id == null));
    return ORDEN_ESTACIONES.filter((id) => sel.some((e) => e.id === id));
}

/** Atajo que coincide exactamente con la selección actual (para resaltar el chip), o null. */
export function atajoActivo(estaciones: EstacionHidro[], seleccion: string[]): AtajoEstaciones | null {
    for (const a of ['todas', 'presas', 'rio'] as AtajoEstaciones[]) {
        const ids = estacionesDeAtajo(estaciones, a);
        if (ids.length > 0 && ids.length === seleccion.length && ids.every((i) => seleccion.includes(i))) return a;
    }
    return null;
}

/** AAAA-MM-DD válido (calendario real). */
export function esDiaValido(s: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Inicio (00:00 hora de Chihuahua) del día AAAA-MM-DD, en ms UTC. */
export function inicioDiaMs(dia: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)!;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) - OFFSET_CHIHUAHUA_MS;
}

/** AAAA-MM-DD (hora de Chihuahua) de un instante. */
export function diaLocal(ms: number): string {
    const d = new Date(ms + OFFSET_CHIHUAHUA_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface RangoEfectivo { desdeMs: number; hastaMs: number; recortado: boolean; horas: number }

/**
 * Intervalo real del informe. Preajustes: las últimas 24 h / 7 d / 30 d hasta `ahoraMs`. Rango: del inicio del día "desde" al
 * final del día "hasta" (o `ahoraMs` si es hoy), recortado a los últimos 30 días. null si el rango es inválido o vacío.
 */
export function rangoEfectivo(p: PeriodoGoes, ahoraMs: number): RangoEfectivo | null {
    if (p.tipo !== 'rango') {
        const horas = VENTANAS[p.tipo]?.horas;
        return horas ? { desdeMs: ahoraMs - horas * HORA, hastaMs: ahoraMs, recortado: false, horas } : null;
    }
    if (!esDiaValido(p.desde) || !esDiaValido(p.hasta)) return null;
    const limite = ahoraMs - MAX_DIAS_SERIES * DIA;
    const ini = inicioDiaMs(p.desde);
    const fin = Math.min(ahoraMs, inicioDiaMs(p.hasta) + DIA);
    const desdeMs = Math.max(ini, limite);
    if (!(fin > desdeMs)) return null;
    return { desdeMs, hastaMs: fin, recortado: ini < limite, horas: (fin - desdeMs) / HORA };
}

const fechaCorta = (dia: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
    if (!m) return 'S/D';
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${+m[3]} ${meses[+m[2] - 1]} ${m[1]}`;
};

/** Etiqueta legible del periodo: "Últimas 24 horas", "Últimos 7 días", "12 oct 2026 – 19 oct 2026". */
export function etiquetaPeriodoGoes(p: PeriodoGoes, ahoraMs: number = Date.now()): string {
    if (p.tipo === '24h') return 'Últimas 24 horas';
    if (p.tipo === '7d') return 'Últimos 7 días';
    if (p.tipo === '30d') return 'Últimos 30 días';
    const r = rangoEfectivo(p, ahoraMs);
    if (!r) return 'Rango inválido';
    const a = diaLocal(r.desdeMs), b = diaLocal(r.hastaMs - 1);
    return a === b ? fechaCorta(a) : `${fechaCorta(a)} – ${fechaCorta(b)}`;
}

/** Código corto del periodo para folio y nombre de archivo ('24H', '7D', '30D', 'R20261012-20261019'). */
export function codigoPeriodoGoes(p: PeriodoGoes, ahoraMs: number = Date.now()): string {
    if (p.tipo !== 'rango') return p.tipo.toUpperCase();
    const r = rangoEfectivo(p, ahoraMs);
    return r ? `R${diaLocal(r.desdeMs).replace(/-/g, '')}-${diaLocal(r.hastaMs - 1).replace(/-/g, '')}` : 'RANGO';
}

/** Errores que impiden generar. `idsValidos`: estaciones que existen; por omisión las cuatro conocidas. */
export function validarConfigGoes(c: ConfigInformeGoes, ahoraMs: number = Date.now(), idsValidos: string[] = [...ORDEN_ESTACIONES]): string[] {
    const e: string[] = [];
    if (c.estaciones.length === 0) e.push('Elige al menos una estación.');
    else if (c.estaciones.some((id) => !idsValidos.includes(id))) e.push('Hay una estación que no existe en el catálogo.');
    if (c.variables.length === 0) e.push('Elige al menos una variable.');
    if (c.secciones.length === 0) e.push('Elige al menos una sección.');
    if (c.periodo.tipo === 'rango') {
        if (!esDiaValido(c.periodo.desde) || !esDiaValido(c.periodo.hasta)) e.push('Indica el día inicial y el final del rango.');
        else if (c.periodo.desde > c.periodo.hasta) e.push('El día inicial es posterior al final.');
        else if (inicioDiaMs(c.periodo.desde) > ahoraMs) e.push('El rango empieza en el futuro.');
        else if (!rangoEfectivo(c.periodo, ahoraMs)) e.push(`Ese rango queda fuera de los últimos ${MAX_DIAS_SERIES} días con telemetría.`);
    }
    return e;
}

/** Avisos que no impiden generar pero cambian lo que el lector verá. */
export function avisosConfigGoes(c: ConfigInformeGoes, ahoraMs: number = Date.now()): string[] {
    const a: string[] = [];
    if (c.periodo.tipo === 'rango') {
        const r = rangoEfectivo(c.periodo, ahoraMs);
        if (r?.recortado) a.push(`Las series de telemetría solo llegan a ${MAX_DIAS_SERIES} días: el informe empezará el ${fechaCorta(diaLocal(r.desdeMs))}, no en el día pedido.`);
        if (r && r.horas < 6) a.push('Periodo menor a 6 horas: la estadística, el volumen y las tendencias tendrán pocos datos.');
        if (c.periodo.hasta && esDiaValido(c.periodo.hasta) && inicioDiaMs(c.periodo.hasta) + DIA > ahoraMs) a.push('El rango incluye el día de hoy: termina en el último dato disponible.');
    } else if (c.periodo.tipo === '24h' && c.secciones.includes('tendencia')) {
        a.push('Con 24 h la variación de 7 días se calcula con el histórico previo al periodo, si existe.');
    }
    const sinVar = (v: VariableInforme) => !c.variables.includes(v);
    for (const s of seccionesGoesDe(c.modalidad)) {
        if (!c.secciones.includes(s.id) || !s.requiere) continue;
        if (s.requiere.every(sinVar)) a.push(`«${s.etiqueta}» necesita ${s.requiere.map((v) => VARIABLES_INFORME.find((x) => x.id === v)?.etiqueta ?? v).join(' o ')}: saldrá como S/D.`);
    }
    if (c.variables.includes('meteo') && c.estaciones.length > 0 && c.estaciones.every((id) => id === 'C6300760')) a.push('Ojinaga es estación de río y no mide meteorología: esa sección saldrá como S/D.');
    if (c.variables.includes('velocidad') && !c.estaciones.includes('C6300760')) a.push('Solo Ojinaga mide velocidad del agua: sin esa estación la velocidad saldrá como S/D.');
    if (c.secciones.includes('comparacion')) {
        if (c.periodo.tipo === '24h') a.push('Comparación presa ↔ río: con 24 h el tránsito del agua distorsiona la diferencia; se publica solo con 7 días o más.');
        else if (!(c.estaciones.includes('C6300760') && c.estaciones.some((id) => id !== 'C6300760'))) a.push('Comparación presa ↔ río: requiere Ojinaga y al menos una estación de presa.');
    }
    if (c.estaciones.includes('C6301416') && c.variables.includes('gasto')) a.push('Babisas: las lecturas de gasto 0.00 con nivel alto se excluyen de promedios y volumen (probable corte de la curva de gasto, sin confirmar).');
    return a;
}

/** Estaciones del catálogo que no son de presa (río). */
export const esEstacionDeRio = (e: Pick<EstacionHidro, 'presa_id'>): boolean => e.presa_id == null;

/** Secciones que realmente entran al informe: las elegidas que la modalidad permite, en el orden fijo del documento. */
export function seccionesEfectivasGoes(c: ConfigInformeGoes): SeccionGoes[] {
    const permitidas = new Set(seccionesGoesDe(c.modalidad).map((s) => s.id));
    return ORDEN_SECCIONES_GOES.filter((s) => c.secciones.includes(s) && permitidas.has(s));
}

/** Número de hojas que tendrá el documento: volumen y comparación comparten hoja, y calidad y metodología también. */
export function contarHojasGoes(c: ConfigInformeGoes): number {
    const s = new Set(seccionesEfectivasGoes(c));
    const sueltas: SeccionGoes[] = ['resumen', 'estado', 'tendencia', 'grafica', 'estadistica', 'enlace', 'meteo', 'trazabilidad'];
    return sueltas.filter((x) => s.has(x)).length + (s.has('volumen') || s.has('comparacion') ? 1 : 0) + (s.has('calidad') || s.has('metodologia') ? 1 : 0);
}
