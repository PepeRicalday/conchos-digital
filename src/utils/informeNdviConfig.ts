/**
 * informeNdviConfig — configuración PURA (sin React) del informe institucional de NDVI: periodo, módulos, indicadores,
 * base del promedio, secciones y hoja; presets de periodo, validación, avisos, estimación de páginas y filtrado de filas.
 * Mismo patrón que informeHistoricoConfig.ts. La ventana "Configurar informe" solo edita este objeto.
 */
import { MODULOS_SRL_IDS } from './modulosSRL';

export type SeccionNdvi = 'portada' | 'resumen' | 'plano' | 'fichas' | 'analisis' | 'serie' | 'anexo' | 'metodologia';
export type IndicadorNdvi = 'kc' | 'icv' | 'ihr' | 'iehp'; // el NDVI siempre se incluye
export type PresetPeriodo = 'mesRef' | 'ultimos3' | 'ciclo' | 'mitad1' | 'mitad2' | 'personalizado';
export type BasePromedio = 'simple' | 'ponderado';
export type Hoja = 'letter' | 'a4';
/** Resumen = informe de siempre; Tendencia = pendiente/pico/estabilidad por módulo; Comparativo = A contra B. */
export type ModoNdvi = 'resumen' | 'tendencia' | 'comparativo';
/** Mes contra mes y periodo A contra B (dentro del ciclo) · módulo contra módulo · módulo contra el promedio SRL. */
export type TipoComparacion = 'mesVsMes' | 'periodos' | 'modulos' | 'vsSRL';
export interface RangoMes { desde: string; hasta: string }
export interface ConfigComparacion {
    tipo: TipoComparacion;
    /** mesVsMes / periodos: lados A y B (en mesVsMes, desde = hasta). */
    a: RangoMes;
    b: RangoMes;
    /** modulos: A y B; vsSRL: solo moduloA. */
    moduloA: number;
    moduloB: number;
}

export interface ConfigInformeNdvi {
    v: 1;
    preset: PresetPeriodo;
    /** 'AAAA-MM' inclusivo. */
    desde: string;
    hasta: string;
    modulos: number[];
    indicadores: IndicadorNdvi[];
    basePromedio: BasePromedio;
    secciones: SeccionNdvi[];
    hoja: Hoja;
    modo: ModoNdvi;
    comparacion: ConfigComparacion;
}

export const SECCIONES_NDVI: { id: SeccionNdvi; etiqueta: string; pagina: 'A' | 'B' | 'C' | 'D' | 'E' }[] = [
    { id: 'portada', etiqueta: 'Portada', pagina: 'A' },
    { id: 'resumen', etiqueta: 'Resumen ejecutivo', pagina: 'A' },
    { id: 'plano', etiqueta: 'Plano general', pagina: 'B' },
    { id: 'fichas', etiqueta: 'Fichas por módulo', pagina: 'B' },
    { id: 'analisis', etiqueta: 'Análisis (tendencia / comparativo)', pagina: 'E' },
    { id: 'serie', etiqueta: 'Serie histórica', pagina: 'C' },
    { id: 'anexo', etiqueta: 'Anexo de datos', pagina: 'C' },
    { id: 'metodologia', etiqueta: 'Metodología y glosario', pagina: 'D' },
];
export const ORDEN_SECCIONES: SeccionNdvi[] = SECCIONES_NDVI.map((s) => s.id);

export const INDICADORES_NDVI: { id: IndicadorNdvi; etiqueta: string; ayuda: string }[] = [
    { id: 'kc', etiqueta: 'Kc', ayuda: 'Coeficiente de cultivo estimado (derivado lineal del NDVI)' },
    { id: 'icv', etiqueta: 'ICV', ayuda: 'Índice de Condición Vegetativa (0–100)' },
    { id: 'ihr', etiqueta: 'IHR', ayuda: 'Índice de Homogeneidad de Riego (0–100)' },
    { id: 'iehp', etiqueta: 'IEHP', ayuda: 'Hectáreas activas por hm³ entregado del ciclo' },
];

export const PRESETS_PERIODO: { id: Exclude<PresetPeriodo, 'personalizado'>; etiqueta: string; descripcion: string }[] = [
    { id: 'mesRef', etiqueta: 'Mes de referencia', descripcion: 'Solo el último mes con dato' },
    { id: 'ultimos3', etiqueta: 'Últimos 3 meses', descripcion: 'Tendencia reciente' },
    { id: 'ciclo', etiqueta: 'Ciclo completo', descripcion: 'Todos los meses disponibles' },
    { id: 'mitad1', etiqueta: 'Primera mitad', descripcion: 'Primera mitad del ciclo' },
    { id: 'mitad2', etiqueta: 'Segunda mitad', descripcion: 'Segunda mitad del ciclo' },
];

const mesDe = (m: string) => (m ?? '').slice(0, 7);

/** Meses distintos (AAAA-MM) presentes en las filas, ascendentes. */
export function mesesDisponibles(filas: { mes: string }[]): string[] {
    return Array.from(new Set(filas.map((f) => mesDe(f.mes)))).sort();
}

/** Resuelve un preset a un rango [desde, hasta] sobre los meses disponibles; sin meses → null. */
export function rangoDePreset(preset: Exclude<PresetPeriodo, 'personalizado'>, meses: string[]): { desde: string; hasta: string } | null {
    const n = meses.length;
    if (!n) return null;
    const ult = meses[n - 1];
    if (preset === 'mesRef') return { desde: ult, hasta: ult };
    if (preset === 'ultimos3') return { desde: meses[Math.max(0, n - 3)], hasta: ult };
    if (preset === 'ciclo') return { desde: meses[0], hasta: ult };
    const mitad = Math.ceil(n / 2);
    if (preset === 'mitad1') return { desde: meses[0], hasta: meses[mitad - 1] };
    return { desde: meses[Math.min(mitad, n - 1)], hasta: ult }; // mitad2
}

/** Comparación por defecto: primera mitad contra segunda mitad del ciclo (lo más útil con un solo ciclo). */
export function comparacionPorDefecto(meses: string[]): ConfigComparacion {
    const a = rangoDePreset('mitad1', meses) ?? { desde: '', hasta: '' };
    const b = rangoDePreset('mitad2', meses) ?? { desde: '', hasta: '' };
    return { tipo: 'periodos', a, b, moduloA: MODULOS_SRL_IDS[0], moduloB: MODULOS_SRL_IDS[1] };
}

/** Configuración por defecto = el informe de siempre (ciclo completo, 6 módulos, todo, modo resumen). */
export function configPorDefecto(meses: string[]): ConfigInformeNdvi {
    const r = rangoDePreset('ciclo', meses) ?? { desde: '', hasta: '' };
    return {
        v: 1, preset: 'ciclo', desde: r.desde, hasta: r.hasta,
        modulos: [...MODULOS_SRL_IDS], indicadores: ['kc', 'icv', 'ihr', 'iehp'], basePromedio: 'simple',
        secciones: [...ORDEN_SECCIONES], hoja: 'letter', modo: 'resumen', comparacion: comparacionPorDefecto(meses),
    };
}

/** Cambia el periodo por preset (o lo deja libre si es 'personalizado'). */
export function conPreset(c: ConfigInformeNdvi, preset: PresetPeriodo, meses: string[]): ConfigInformeNdvi {
    if (preset === 'personalizado') return { ...c, preset };
    const r = rangoDePreset(preset, meses);
    return r ? { ...c, preset, ...r } : { ...c, preset };
}

/** Reaplica el preset de periodo sobre los meses actuales (un preset guardado "ciclo" crece cuando llegan meses nuevos). */
export function normalizaConfig(c: ConfigInformeNdvi, meses: string[]): ConfigInformeNdvi {
    // Un preset guardado antes de existir modo/comparación se completa con los valores por defecto.
    const completa: ConfigInformeNdvi = { ...configPorDefecto(meses), ...c, comparacion: { ...comparacionPorDefecto(meses), ...(c.comparacion ?? {}) } };
    const base = completa.preset === 'personalizado' ? completa : conPreset(completa, completa.preset, meses);
    return {
        ...base,
        modulos: MODULOS_SRL_IDS.filter((m) => base.modulos.includes(m)),
        indicadores: INDICADORES_NDVI.map((i) => i.id).filter((i) => base.indicadores.includes(i)),
        secciones: ORDEN_SECCIONES.filter((s) => base.secciones.includes(s)),
    };
}

/** Filas dentro del periodo y de los módulos elegidos. */
export function filtrarFilas<T extends { mes: string; numero_modulo: number }>(filas: T[], c: ConfigInformeNdvi): T[] {
    return filas.filter((f) => {
        const m = mesDe(f.mes);
        return m >= c.desde && m <= c.hasta && c.modulos.includes(f.numero_modulo);
    });
}

/** Último mes con dato dentro del periodo (el "mes de referencia" del informe filtrado); null si no hay. */
export function mesReferenciaDe(filas: { mes: string; numero_modulo: number }[], c: ConfigInformeNdvi): string | null {
    const m = mesesDisponibles(filtrarFilas(filas, c));
    return m[m.length - 1] ?? null;
}

/** Errores que bloquean "Generar". */
export function validarConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const e: string[] = [];
    if (!c.modulos.length) e.push('Elige al menos un módulo.');
    if (!c.secciones.length) e.push('Elige al menos una sección.');
    if (!c.desde || !c.hasta) e.push('Elige el periodo.');
    else if (c.desde > c.hasta) e.push('El mes inicial no puede ser posterior al final.');
    else if (c.modulos.length && !filtrarFilas(filas, c).length) e.push(`No hay lecturas de NDVI entre ${c.desde} y ${c.hasta} para los módulos elegidos.`);
    if (c.modo === 'tendencia' && c.desde && c.hasta && c.desde <= c.hasta) {
        const n = mesesDisponibles(filtrarFilas(filas, c)).length;
        if (n > 0 && n < MIN_MESES_TENDENCIA) e.push(`La tendencia necesita al menos ${MIN_MESES_TENDENCIA} meses con dato; el periodo tiene ${n}. Amplíalo.`);
    }
    if (c.modo === 'comparativo') e.push(...validarComparacion(c, filas));
    return e;
}

export const MIN_MESES_TENDENCIA = 3;

const hayDatos = (filas: { mes: string; numero_modulo: number }[], r: RangoMes, modulos: number[]) =>
    filas.some((f) => mesDe(f.mes) >= r.desde && mesDe(f.mes) <= r.hasta && modulos.includes(f.numero_modulo));

function validarComparacion(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const e: string[] = [];
    const k = c.comparacion;
    if (k.tipo === 'periodos' || k.tipo === 'mesVsMes') {
        const lado = (r: RangoMes, n: string) => {
            if (!r.desde || !r.hasta) { e.push(`Elige el ${n}.`); return; }
            if (r.desde > r.hasta) e.push(`El ${n}: el mes inicial no puede ser posterior al final.`);
            else if (c.modulos.length && !hayDatos(filas, r, c.modulos)) e.push(`Sin lecturas de NDVI en el ${n} (${etiquetaPeriodo(r)}).`);
        };
        const nom = k.tipo === 'mesVsMes' ? ['mes A', 'mes B'] : ['periodo A', 'periodo B'];
        lado(k.a, nom[0]); lado(k.b, nom[1]);
        if (k.a.desde === k.b.desde && k.a.hasta === k.b.hasta) e.push('A y B son iguales: elige dos periodos distintos.');
    } else if (k.tipo === 'modulos') {
        if (k.moduloA === k.moduloB) e.push('Elige dos módulos distintos.');
        for (const m of [k.moduloA, k.moduloB]) if (!filas.some((f) => f.numero_modulo === m)) e.push(`El Módulo ${m} no tiene lecturas.`);
    } else if (!filas.some((f) => f.numero_modulo === k.moduloA)) e.push(`El Módulo ${k.moduloA} no tiene lecturas.`);
    return e;
}

/** Avisos que NO bloquean (se muestran en la ventana). */
export function avisosConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const a: string[] = [];
    const ref = mesReferenciaDe(filas, c);
    if (ref) {
        const sin = c.modulos.filter((m) => !filas.some((f) => f.numero_modulo === m && mesDe(f.mes) === ref));
        if (sin.length) a.push(`Sin dato en ${ref}: ${sin.map((m) => `Módulo ${m}`).join(', ')} (aparecerán como S/D).`);
    }
    if (c.modulos.length === 1) a.push('Con un solo módulo el promedio SRL equivale a ese módulo.');
    if (c.indicadores.includes('iehp') && ref) a.push('El IEHP usa el volumen acumulado del ciclo hasta el mes de referencia.');
    const meses = mesesDisponibles(filtrarFilas(filas, c));
    if (meses.length === 1 && c.modo === 'resumen') a.push('Un solo mes: no habrá serie histórica con tendencia (solo el valor y el cambio contra el mes anterior).');
    if (c.modo === 'tendencia' && meses.length === MIN_MESES_TENDENCIA) a.push('Con solo 3 meses la pendiente es descriptiva: no se declarará una tendencia.');
    if (c.modo !== 'resumen') a.push('Comparaciones y tendencias son dentro de un solo ciclo (2026): no hay datos de años anteriores.');
    if (c.modo === 'comparativo' && c.comparacion.tipo === 'periodos' && !(c.comparacion.a.hasta < c.comparacion.b.desde || c.comparacion.b.hasta < c.comparacion.a.desde)) {
        a.push('Los periodos A y B se traslapan: la diferencia entre ellos subestima el cambio.');
    }
    return a;
}

/** Cuántas hojas saldrán (portada+resumen, plano+fichas, serie+anexo y metodología comparten hoja). */
export function paginasEstimadas(c: ConfigInformeNdvi): number {
    // La hoja de análisis (E) solo existe si el modo no es "resumen".
    return new Set(SECCIONES_NDVI.filter((s) => c.secciones.includes(s.id) && (s.pagina !== 'E' || c.modo !== 'resumen')).map((s) => s.pagina)).size;
}

/** Primer mes (AAAA-03) del ciclo agrícola al que pertenece un mes: el ciclo corre de marzo a septiembre. */
export function inicioCiclo(mes: string): string {
    const m = /^(\d{4})-(\d{2})/.exec(mes);
    if (!m) return mes;
    const anio = Number(m[1]);
    return `${Number(m[2]) >= 3 ? anio : anio - 1}-03`;
}

export function etiquetaPeriodo(c: Pick<ConfigInformeNdvi, 'desde' | 'hasta'>): string {
    return c.desde === c.hasta ? c.desde : `${c.desde} a ${c.hasta}`;
}

// ── Presets guardados (por dispositivo). Todo en try/catch: sin localStorage la ventana sigue funcionando. ──
export interface PresetGuardado { id: string; nombre: string; config: ConfigInformeNdvi }
export const CLAVE_PRESETS = 'sica.ndvi.informe.presets.v1';
export const MAX_PRESETS = 8;

export function leerPresets(): PresetGuardado[] {
    try {
        const raw = localStorage.getItem(CLAVE_PRESETS);
        if (!raw) return [];
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return [];
        return arr.filter((p): p is PresetGuardado => !!p && typeof p.id === 'string' && typeof p.nombre === 'string' && p.config?.v === 1).slice(0, MAX_PRESETS);
    } catch { return []; }
}

/** Devuelve true si se pudo guardar. */
export function guardarPresets(lista: PresetGuardado[]): boolean {
    try { localStorage.setItem(CLAVE_PRESETS, JSON.stringify(lista.slice(0, MAX_PRESETS))); return true; } catch { return false; }
}
