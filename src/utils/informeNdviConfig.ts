/**
 * informeNdviConfig — configuración PURA (sin React) del informe institucional de NDVI: periodo, módulos, indicadores,
 * base del promedio, secciones y hoja; presets de periodo, validación, avisos, estimación de páginas y filtrado de filas.
 * Mismo patrón que informeHistoricoConfig.ts. La ventana "Configurar informe" solo edita este objeto.
 */
import { MODULOS_SRL_IDS } from './modulosSRL';
import { mesLegible } from './informeBase';
import type { FilaNdviV2 } from './ndviInteranual';
import { validarInteranual, type ConfigInteranual } from './informeNdviInteranual';

export type SeccionNdvi = 'portada' | 'resumen' | 'plano' | 'fichas' | 'analisis' | 'serie' | 'anexo' | 'metodologia';
export type IndicadorNdvi = 'kc' | 'icv' | 'ihr' | 'iehp'; // el NDVI siempre se incluye
export type PresetPeriodo = 'mesRef' | 'ultimos3' | 'ciclo' | 'mitad1' | 'mitad2' | 'personalizado';
export type BasePromedio = 'simple' | 'ponderado';
export type Hoja = 'letter' | 'a4';
/** Resumen = informe de siempre; Tendencia = anomalía del periodo contra otros años + evolución año a año por módulo; Comparativo = A contra B;
 *  Interanual = un año contra los demás (serie v2 marzo–septiembre + superficie/volumen), informe aparte. */
export type ModoNdvi = 'resumen' | 'tendencia' | 'comparativo' | 'interanual';
/** Mes contra mes y periodo A contra B (pueden ser de años distintos) · módulo contra módulo · módulo contra el promedio de los demás. */
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
    /** Solo modo interanual: años a comparar (el último es el año de interés). */
    interanual?: ConfigInteranual;
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
    if (preset === 'ciclo') {
        // Un ciclo agrícola corre de marzo a septiembre: con varios años en la serie, "ciclo" es solo el del último mes
        // (nunca arrastra octubre–febrero ni ciclos anteriores).
        const ini = inicioCiclo(ult);
        const delCiclo = meses.filter((m) => m >= ini);
        return { desde: delCiclo[0] ?? meses[0], hasta: ult };
    }
    // Las mitades son del ciclo del último mes (con varios años, "primera mitad de toda la serie" no tendría sentido).
    const ciclo = meses.filter((m) => m >= inicioCiclo(ult));
    const base = ciclo.length ? ciclo : meses;
    const mitad = Math.ceil(base.length / 2);
    if (preset === 'mitad1') return { desde: base[0], hasta: base[mitad - 1] };
    return { desde: base[Math.min(mitad, base.length - 1)], hasta: ult }; // mitad2
}

/** Mismo rango de meses, `n` años después (negativo = antes): '2026-03'..'2026-09' con -1 → '2025-03'..'2025-09'. */
export function desplazaAnios(r: RangoMes, n: number): RangoMes {
    const mueve = (m: string) => (/^\d{4}-\d{2}/.test(m) ? `${Number(m.slice(0, 4)) + n}${m.slice(4, 7)}` : m);
    return { desde: mueve(r.desde), hasta: mueve(r.hasta) };
}

/**
 * Comparación por defecto: el ciclo actual contra el MISMO periodo del año anterior (misma estación, así la diferencia no
 * es fenología). Sin ese año en la serie, cae a primera contra segunda mitad del ciclo (dentro de un solo año).
 * A = referencia (anterior), B = el periodo más reciente; la diferencia se lee B − A.
 */
export function comparacionPorDefecto(meses: string[]): ConfigComparacion {
    const b = rangoDePreset('ciclo', meses) ?? { desde: '', hasta: '' };
    const a = b.desde ? desplazaAnios(b, -1) : { desde: '', hasta: '' };
    const hayAnterior = !!a.desde && meses.some((m) => m >= a.desde && m <= a.hasta);
    const mod = { moduloA: MODULOS_SRL_IDS[0], moduloB: MODULOS_SRL_IDS[1] };
    if (hayAnterior) return { tipo: 'periodos', a, b, ...mod };
    return { tipo: 'periodos', a: rangoDePreset('mitad1', meses) ?? { desde: '', hasta: '' }, b: rangoDePreset('mitad2', meses) ?? { desde: '', hasta: '' }, ...mod };
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

/** ¿Los rangos A y B cubren los mismos meses del año (aunque sean de años distintos)? */
export function mismoCalendario(a: RangoMes, b: RangoMes): boolean {
    const cal = (r: RangoMes) => {
        const out = new Set<string>();
        if (!/^\d{4}-\d{2}/.test(r.desde) || !/^\d{4}-\d{2}/.test(r.hasta)) return '';
        let y = Number(r.desde.slice(0, 4)), m = Number(r.desde.slice(5, 7));
        const fin = Number(r.hasta.slice(0, 4)) * 12 + Number(r.hasta.slice(5, 7));
        while (y * 12 + m <= fin && out.size < 12) { out.add(String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } }
        return [...out].sort().join();
    };
    return cal(a) === cal(b);
}

/** Errores que bloquean "Generar". */
export function validarConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[], serieV2: FilaNdviV2[] = []): string[] {
    if (c.modo === 'interanual') return validarInteranual(c.interanual?.anios ?? [], c.modulos, serieV2);
    const e: string[] = [];
    if (!c.modulos.length) e.push('Elige al menos un módulo.');
    if (!c.secciones.length) e.push('Elige al menos una sección.');
    if (!c.desde || !c.hasta) e.push('Elige el periodo.');
    else if (c.desde > c.hasta) e.push('El mes inicial no puede ser posterior al final.');
    else if (c.modulos.length && !filtrarFilas(filas, c).length) e.push(`No hay lecturas de NDVI entre ${c.desde} y ${c.hasta} para los módulos elegidos.`);
    if (c.modo === 'comparativo') e.push(...validarComparacion(c, filas));
    return e;
}

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
        for (const m of [k.moduloA, k.moduloB]) {
            if (!c.modulos.includes(m)) e.push(`El Módulo ${m} no está entre los módulos elegidos del informe.`);
            else if (!filas.some((f) => f.numero_modulo === m)) e.push(`El Módulo ${m} no tiene lecturas.`);
        }
    } else if (!c.modulos.includes(k.moduloA)) e.push(`El Módulo ${k.moduloA} no está entre los módulos elegidos del informe.`);
    else if (!filas.some((f) => f.numero_modulo === k.moduloA)) e.push(`El Módulo ${k.moduloA} no tiene lecturas.`);
    return e;
}

/** Avisos que NO bloquean (se muestran en la ventana). */
export function avisosConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const a: string[] = [];
    // El modo interanual no usa la serie de 2026 ni el IEHP: sus avisos propios van en el informe.
    if (c.modo === 'interanual') return a;
    const ref = mesReferenciaDe(filas, c);
    if (ref) {
        const sin = c.modulos.filter((m) => !filas.some((f) => f.numero_modulo === m && mesDe(f.mes) === ref));
        if (sin.length) a.push(`Sin dato en ${ref}: ${sin.map((m) => `Módulo ${m}`).join(', ')} (aparecerán como S/D).`);
    }
    if (c.modulos.length === 1) a.push('Con un solo módulo el promedio SRL equivale a ese módulo.');
    if (c.indicadores.includes('iehp') && ref) a.push('El IEHP usa el volumen acumulado del ciclo hasta el mes de referencia.');
    const meses = mesesDisponibles(filtrarFilas(filas, c));
    if (meses.length === 1 && c.modo === 'resumen') a.push('Un solo mes: no habrá serie histórica con tendencia (solo el valor y el cambio contra el mes anterior).');
    // La serie v2 abarca varios años; solo se advierte si la serie cargada realmente tiene pocos.
    const nAnios = new Set(filas.map((f) => mesDe(f.mes).slice(0, 4))).size;
    if (c.modo === 'tendencia' && nAnios < 4) a.push(`La serie cargada tiene ${nAnios} ${nAnios === 1 ? 'año' : 'años'}: la comparación con años anteriores y la evolución año a año serán de baja confianza o quedarán S/D.`);
    if (c.modo !== 'resumen' && nAnios === 1) a.push('La serie cargada abarca un solo año: no hay años anteriores contra los cuales comparar.');
    if (c.modo === 'comparativo' && c.comparacion.tipo === 'periodos' && !(c.comparacion.a.hasta < c.comparacion.b.desde || c.comparacion.b.hasta < c.comparacion.a.desde)) {
        a.push('Los periodos A y B se traslapan: la diferencia entre ellos subestima el cambio.');
    }
    if (c.modo === 'comparativo' && (c.comparacion.tipo === 'periodos' || c.comparacion.tipo === 'mesVsMes') && !mismoCalendario(c.comparacion.a, c.comparacion.b)) {
        a.push('A y B cubren meses del año distintos: parte de la diferencia es estacional (el NDVI sube de marzo a julio sin que cambie nada). Para aislarla compara el mismo periodo de otro año.');
    }
    return a;
}

/** Cuántas hojas saldrán (portada+resumen, plano+fichas, serie+anexo y metodología comparten hoja). */
export function paginasEstimadas(c: ConfigInformeNdvi): number {
    if (c.modo === 'interanual') return 4;
    // La hoja de análisis (E) solo existe si el modo no es "resumen".
    const incluidas = SECCIONES_NDVI.filter((s) => c.secciones.includes(s.id) && (s.pagina !== 'E' || c.modo !== 'resumen'));
    // El análisis de tendencia ocupa dos hojas (ver informeNdviHtml).
    return new Set(incluidas.map((s) => s.pagina)).size + (c.modo === 'tendencia' && incluidas.some((s) => s.pagina === 'E') ? 1 : 0);
}

/** Primer mes (AAAA-03) del ciclo agrícola al que pertenece un mes: el ciclo corre de marzo a septiembre. */
export function inicioCiclo(mes: string): string {
    const m = /^(\d{4})-(\d{2})/.exec(mes);
    if (!m) return mes;
    const anio = Number(m[1]);
    return `${Number(m[2]) >= 3 ? anio : anio - 1}-03`;
}

export function etiquetaPeriodo(c: Pick<ConfigInformeNdvi, 'desde' | 'hasta'>): string {
    return c.desde === c.hasta ? mesLegible(c.desde) : `${mesLegible(c.desde)} a ${mesLegible(c.hasta)}`;
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
