/**
 * informeHistoricoConfig — configuración del Informe Histórico de presas (tipos, presets, validación).
 * Sin React. El modal de filtros produce un `ConfigInforme`; `prepararInforme` lo consume.
 */
import { MESES_LARGO, type Metrica, type PresaId, type TipoSerie } from './historicoPresas';

export type Modalidad = 'basico' | 'tecnico';
export type PeriodoTipo = 'mes' | 'rangoMeses' | 'anio' | 'cicloAgricola';
/** deltaAparente = Δ de almacenamiento entre cierres (NO es extracción ni aportación). */
export type MetricaInf = Metrica | 'deltaAparente';
export type SeccionId =
    | 'resumen' | 'semaforo' | 'kpis' | 'serie' | 'cierres' | 'mapaCalor' | 'comparativo'
    | 'metodologia' | 'estadistica' | 'ranking' | 'extremos' | 'estacionalidad' | 'tendencia'
    | 'deltas' | 'calidad' | 'limitaciones' | 'tabla';

export const MAX_ANIOS_COMPARAR = 3;
/** Año nominal del cambio de curva de Boquilla (LEV-2020 rige desde el 1-sep-2021). */
export const ANIO_CAMBIO_CURVA = 2021;

export interface PeriodoInf {
    tipo: PeriodoTipo;
    /** Para tipo 'mes'. */
    mes: number;
    /** Para tipo 'rangoMeses' (mesIni <= mesFin). */
    mesIni: number;
    mesFin: number;
}

export interface ConfigInforme {
    modalidad: Modalidad;
    presas: PresaId[];
    periodo: PeriodoInf;
    /** Año base: en 'cicloAgricola' es el año en que inicia el ciclo (octubre). */
    anioBase: number;
    /** Años contra los que se compara (sin incluir la base), máximo 3. */
    aniosComparar: number[];
    metricas: MetricaInf[];
    serie: TipoSerie;
    secciones: SeccionId[];
    /** Si es false (por defecto), los años con cobertura < 50 % no entran a promedios, percentiles ni tendencia. */
    incluirParciales: boolean;
}

export interface MesPeriodo { mes: number; /** 0 = año base, 1 = año siguiente (ciclo agrícola) */ desfase: 0 | 1 }

/** Meses del periodo en orden cronológico. El ciclo agrícola va de octubre del año base a septiembre del siguiente. */
export function mesesDelPeriodo(p: PeriodoInf): MesPeriodo[] {
    switch (p.tipo) {
        case 'mes': return [{ mes: p.mes, desfase: 0 }];
        case 'rangoMeses': return Array.from({ length: Math.max(0, p.mesFin - p.mesIni + 1) }, (_, i) => ({ mes: p.mesIni + i, desfase: 0 as const }));
        case 'anio': return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, desfase: 0 as const }));
        case 'cicloAgricola': return [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(mes => ({ mes, desfase: (mes >= 10 ? 0 : 1) as 0 | 1 }));
    }
}

export function etiquetaPeriodo(p: PeriodoInf, anioBase: number): string {
    switch (p.tipo) {
        case 'mes': return `${MESES_LARGO[p.mes - 1]}`;
        case 'rangoMeses': return `${MESES_LARGO[p.mesIni - 1]} – ${MESES_LARGO[p.mesFin - 1]}`;
        case 'anio': return 'Año completo (enero – diciembre)';
        case 'cicloAgricola': return `Ciclo agrícola ${anioBase}-${anioBase + 1} (1 oct – 30 sep)`;
    }
}

/** Etiqueta de un año en el periodo: el ciclo se rotula "2025-2026". */
export const etiquetaAnio = (p: PeriodoInf, anio: number): string => (p.tipo === 'cicloAgricola' ? `${anio}-${anio + 1}` : String(anio));

export const SECCIONES: Record<SeccionId, { etiqueta: string; modalidades: Modalidad[] }> = {
    resumen: { etiqueta: 'Resumen ejecutivo', modalidades: ['basico', 'tecnico'] },
    semaforo: { etiqueta: 'Semáforo de estado', modalidades: ['basico', 'tecnico'] },
    kpis: { etiqueta: 'Indicadores clave', modalidades: ['basico', 'tecnico'] },
    serie: { etiqueta: 'Serie comparada', modalidades: ['basico', 'tecnico'] },
    cierres: { etiqueta: 'Cierre por año', modalidades: ['basico', 'tecnico'] },
    mapaCalor: { etiqueta: 'Mapa de calor año × mes', modalidades: ['basico', 'tecnico'] },
    comparativo: { etiqueta: 'Comparativo contra año previo', modalidades: ['basico'] },
    metodologia: { etiqueta: 'Metodología y fuentes', modalidades: ['tecnico'] },
    estadistica: { etiqueta: 'Estadística descriptiva y anomalía', modalidades: ['tecnico'] },
    ranking: { etiqueta: 'Posición histórica y percentiles', modalidades: ['tecnico'] },
    extremos: { etiqueta: 'Extremos con fecha', modalidades: ['tecnico'] },
    estacionalidad: { etiqueta: 'Estacionalidad', modalidades: ['tecnico'] },
    tendencia: { etiqueta: 'Tendencia lineal', modalidades: ['tecnico'] },
    deltas: { etiqueta: 'Δ mensual aparente', modalidades: ['tecnico'] },
    calidad: { etiqueta: 'Calidad de datos y huecos', modalidades: ['basico', 'tecnico'] },
    limitaciones: { etiqueta: 'Limitaciones', modalidades: ['tecnico'] },
    tabla: { etiqueta: 'Anexo: tabla de datos', modalidades: ['tecnico'] },
};

/** Orden fijo de render de las secciones (el modal solo activa/desactiva). */
export const ORDEN_SECCIONES: SeccionId[] = [
    'resumen', 'semaforo', 'kpis', 'serie', 'cierres', 'mapaCalor', 'comparativo',
    'metodologia', 'estadistica', 'ranking', 'extremos', 'estacionalidad', 'tendencia', 'deltas', 'calidad', 'limitaciones', 'tabla',
];

export const SECCIONES_POR_DEFECTO: Record<Modalidad, SeccionId[]> = {
    basico: ['resumen', 'semaforo', 'kpis', 'serie', 'cierres', 'comparativo', 'calidad'],
    tecnico: ['resumen', 'metodologia', 'kpis', 'estadistica', 'serie', 'mapaCalor', 'ranking', 'estacionalidad', 'tendencia', 'deltas', 'extremos', 'calidad', 'limitaciones', 'tabla'],
};

export const seccionesDe = (m: Modalidad): SeccionId[] => ORDEN_SECCIONES.filter(s => SECCIONES[s].modalidades.includes(m));

export const METRICAS_INF: { v: MetricaInf; l: string }[] = [
    { v: 'volumen', l: 'Volumen' },
    { v: 'elevacion', l: 'Elevación' },
    { v: 'llenado', l: 'Llenado %' },
    { v: 'deltaAparente', l: 'Δ aparente' },
];

export interface PresetInforme { id: string; etiqueta: string; descripcion: string; aplicar: (c: ConfigInforme, anios: number[], hoy: Date) => ConfigInforme }

const recientes = (anios: number[], base: number, n = 2) => anios.filter(a => a < base).slice(0, n);

export const PRESETS: PresetInforme[] = [
    {
        id: 'mes-rapido', etiqueta: 'Resumen mensual rápido', descripcion: 'Básico · mes actual contra 2 años previos',
        aplicar: (c, anios, hoy) => ({
            ...c, modalidad: 'basico', presas: ['PRE-001', 'PRE-002'], periodo: { ...c.periodo, tipo: 'mes', mes: hoy.getMonth() + 1 },
            anioBase: anios[0] ?? hoy.getFullYear(), aniosComparar: recientes(anios, anios[0] ?? 0), metricas: ['volumen', 'llenado'], secciones: SECCIONES_POR_DEFECTO.basico,
        }),
    },
    {
        id: 'cierre-ciclo', etiqueta: 'Cierre de ciclo', descripcion: 'Técnico · ciclo agrícola 1 oct – 30 sep',
        aplicar: (c, anios, hoy) => {
            // Ciclo más reciente que ya inició: si estamos antes de octubre, el ciclo en curso empezó el año anterior.
            const inicio = hoy.getMonth() + 1 >= 10 ? hoy.getFullYear() : hoy.getFullYear() - 1;
            return {
                ...c, modalidad: 'tecnico', periodo: { ...c.periodo, tipo: 'cicloAgricola' }, anioBase: inicio,
                aniosComparar: recientes(anios, inicio), metricas: ['volumen', 'llenado', 'deltaAparente'], secciones: SECCIONES_POR_DEFECTO.tecnico,
            };
        },
    },
    {
        id: 'anio-comparado', etiqueta: 'Año completo comparado', descripcion: 'Técnico · enero–diciembre, todas las secciones',
        aplicar: (c, anios) => ({
            ...c, modalidad: 'tecnico', periodo: { ...c.periodo, tipo: 'anio' }, anioBase: anios[0] ?? c.anioBase,
            aniosComparar: recientes(anios, anios[0] ?? 0), metricas: ['volumen', 'llenado'], secciones: seccionesDe('tecnico'),
        }),
    },
    {
        id: 'ambas-hoy', etiqueta: 'Ambas presas hoy', descripcion: 'Básico · mes actual, las dos presas',
        aplicar: (c, anios, hoy) => ({
            ...c, modalidad: 'basico', presas: ['PRE-001', 'PRE-002'], periodo: { ...c.periodo, tipo: 'mes', mes: hoy.getMonth() + 1 },
            anioBase: anios[0] ?? hoy.getFullYear(), aniosComparar: recientes(anios, anios[0] ?? 0, 1), metricas: ['llenado'], secciones: ['resumen', 'semaforo', 'kpis', 'serie', 'calidad'],
        }),
    },
];

export function configPorDefecto(anios: number[], hoy: Date = new Date()): ConfigInforme {
    const base = anios[0] ?? hoy.getFullYear();
    return {
        modalidad: 'basico',
        presas: ['PRE-001', 'PRE-002'],
        periodo: { tipo: 'mes', mes: hoy.getMonth() + 1, mesIni: 1, mesFin: 12 },
        anioBase: base,
        aniosComparar: anios.filter(a => a < base).slice(0, 2),
        metricas: ['volumen', 'llenado'],
        serie: 'normalizada',
        secciones: SECCIONES_POR_DEFECTO.basico,
        incluirParciales: false,
    };
}

/** Errores (en español) que impiden generar el informe; vacío = válido. */
export function validarConfig(c: ConfigInforme, anios: number[]): string[] {
    const e: string[] = [];
    if (!c.presas.length) e.push('Elige al menos una presa.');
    if (!c.metricas.length) e.push('Elige al menos una métrica.');
    if (!c.secciones.length) e.push('Elige al menos una sección.');
    if (c.aniosComparar.length > MAX_ANIOS_COMPARAR) e.push(`Máximo ${MAX_ANIOS_COMPARAR} años de comparación.`);
    if (c.aniosComparar.includes(c.anioBase)) e.push('El año base no puede repetirse entre los años a comparar.');
    for (const a of [c.anioBase, ...c.aniosComparar]) if (!anios.includes(a)) e.push(`No hay registros del año ${a}.`);
    if (c.periodo.tipo === 'rangoMeses' && c.periodo.mesIni > c.periodo.mesFin) e.push('El mes inicial debe ser anterior o igual al mes final.');
    return e;
}

/** Avisos no bloqueantes (el informe se genera, pero se muestran en el modal y dentro del documento). */
export function avisosConfig(c: ConfigInforme): string[] {
    const a: string[] = [];
    const anios = [c.anioBase, ...c.aniosComparar];
    if (c.serie === 'reportada' && anios.some(x => x <= ANIO_CAMBIO_CURVA)) {
        a.push('La serie "como se reportó" mezcla tablas de capacidad distintas en 2021 (saltos de hasta ~17 Mm³ en Boquilla): no es comparable con otros años.');
    }
    if (c.metricas.includes('deltaAparente')) a.push('Δ aparente = cambio del almacenamiento entre cierres; no es extracción ni aportación.');
    return a;
}
