/**
 * informeNdviConfig — configuración PURA (sin React) del informe técnico integrado de NDVI. Un solo documento con ALCANCE
 * configurable (antes eran cuatro "modos"): periodo, años a comparar, módulos, secciones/anexos, indicadores opcionales,
 * imagen satelital sí/no y base del promedio. Hay UN solo concepto de periodo: el periodo (desde–hasta) es lo que se
 * informa; el "contraste" lo compara contra el MISMO periodo de otro año (mismos meses, así la diferencia no es estacional).
 * Mismo patrón que informeHistoricoConfig.ts. La ventana "Configurar informe" solo edita este objeto.
 */
import { MODULOS_SRL_IDS } from './modulosSRL';
import { mesLegible } from './informeBase';
import type { BasePromedio } from './ndviPromedio';

export type { BasePromedio } from './ndviPromedio';

/** Secciones del documento. El resumen ejecutivo (hoja 1) siempre va; el resto es el alcance. */
export type SeccionNdvi = 'resumen' | 'situacion' | 'tendencia' | 'interanual' | 'modulos' | 'anexoSerie' | 'anexoSupVol' | 'metodologia';
export type IndicadorNdvi = 'kc' | 'icv' | 'ihr' | 'iehp'; // el NDVI siempre se incluye
export type PresetPeriodo = 'mesRef' | 'ultimos3' | 'ciclo' | 'mitad1' | 'mitad2' | 'personalizado';
export type Hoja = 'letter' | 'a4';
/** Módulo contra módulo · módulo contra el promedio de los demás (sección opcional). */
export type TipoCompModulos = 'modulos' | 'vsSRL';
/** 'auto' = mismo periodo del año anterior si hay datos; 'ninguno' = sin contraste; número = ese año. */
export type Contraste = 'auto' | 'ninguno' | number;
export interface RangoMes { desde: string; hasta: string }
export interface ConfigCompModulos { tipo: TipoCompModulos; moduloA: number; moduloB: number }

export interface ConfigInformeNdvi {
    v: 2;
    preset: PresetPeriodo;
    /** 'AAAA-MM' inclusivo. */
    desde: string;
    hasta: string;
    modulos: number[];
    /** Opcionales fuera del resumen: Kc e ICV son transformaciones lineales del NDVI (dicen lo mismo con otra escala). */
    indicadores: IndicadorNdvi[];
    basePromedio: BasePromedio;
    secciones: SeccionNdvi[];
    hoja: Hoja;
    /** Años de la comparación (interanual y "habitual"); el año de interés es el del último mes del periodo. Vacío = todos con NDVI. */
    anios: number[];
    contraste: Contraste;
    /** Sección opcional de módulo contra módulo / contra el promedio de los demás; null = no se incluye. */
    compModulos: ConfigCompModulos | null;
    /** Incluir imagen satelital NDVI por módulo (la imagen la genera otro módulo; aquí solo el interruptor). */
    imagenSatelital: boolean;
    /** Plano con relieve sombreado y contexto (canal Conchos, otros módulos del DR-005): suma ≈ 19 KiB al documento. Sin él, el plano va sobre fondo liso. */
    mapaRelieve: boolean;
    /** Bloque de firmas (Elaboró / Revisó / Autorizó) en el anexo de trazabilidad. */
    firmas: boolean;
}

/** Descripción de cada sección para el modal y para la estimación de hojas. */
export const SECCIONES_NDVI: { id: SeccionNdvi; etiqueta: string; ayuda: string; fija?: boolean }[] = [
    { id: 'resumen', etiqueta: 'Resumen ejecutivo', ayuda: 'Hoja 1: titular del periodo, hallazgos y qué revisar (siempre se incluye)', fija: true },
    { id: 'situacion', etiqueta: 'Situación del periodo', ayuda: 'Plano por clase de vigor y ranking de módulos' },
    { id: 'tendencia', etiqueta: 'Tendencia y contraste', ayuda: 'Frente a lo habitual, año tras año y contra el mismo periodo de otro año' },
    { id: 'interanual', etiqueta: 'Comparación entre años', ayuda: 'Temporada marzo–septiembre año contra año, con pico por módulo' },
    { id: 'modulos', etiqueta: 'Módulo por módulo', ayuda: 'Una ficha por módulo con sus cifras y su lectura' },
    { id: 'anexoSerie', etiqueta: 'Anexo: serie histórica', ayuda: 'Serie mensual del periodo y tablas completas' },
    { id: 'anexoSupVol', etiqueta: 'Anexo: superficie y volumen', ayuda: 'Superficie regada y volumen por año (requiere más de un año)' },
    { id: 'metodologia', etiqueta: 'Anexos: metodología, glosario, límites y trazabilidad', ayuda: 'Método, límites, definiciones, fuentes y firmas' },
];
export const ORDEN_SECCIONES: SeccionNdvi[] = SECCIONES_NDVI.map((s) => s.id);

export const INDICADORES_NDVI: { id: IndicadorNdvi; etiqueta: string; ayuda: string }[] = [
    { id: 'kc', etiqueta: 'Kc', ayuda: 'Coeficiente de cultivo estimado de la frontera del módulo (derivado lineal del NDVI; no sirve para programar riego)' },
    { id: 'icv', etiqueta: 'ICV', ayuda: 'Índice de Condición Vegetativa 0–100 (derivado lineal del NDVI)' },
    { id: 'ihr', etiqueta: 'IHR', ayuda: 'Índice de Homogeneidad de Riego 0–100 (dispersión del NDVI dentro del módulo)' },
    { id: 'iehp', etiqueta: 'IEHP', ayuda: 'Hectáreas con cobertura activa por hm³ entregado del ciclo (requiere consultar el volumen)' },
];

export const PRESETS_PERIODO: { id: Exclude<PresetPeriodo, 'personalizado'>; etiqueta: string; descripcion: string }[] = [
    { id: 'mesRef', etiqueta: 'Mes de referencia', descripcion: 'Solo el último mes con dato' },
    { id: 'ultimos3', etiqueta: 'Últimos 3 meses', descripcion: 'Tendencia reciente' },
    { id: 'ciclo', etiqueta: 'Ciclo completo', descripcion: 'Del inicio del ciclo (marzo) al último mes' },
    { id: 'mitad1', etiqueta: 'Primera mitad', descripcion: 'Primera mitad del ciclo' },
    { id: 'mitad2', etiqueta: 'Segunda mitad', descripcion: 'Segunda mitad del ciclo' },
];

const mesDe = (m: string) => (m ?? '').slice(0, 7);

/** Meses distintos (AAAA-MM) presentes en las filas, ascendentes. */
export function mesesDisponibles(filas: { mes: string }[]): string[] {
    return Array.from(new Set(filas.map((f) => mesDe(f.mes)))).sort();
}

/** Años (con al menos un mes) presentes en las filas, ascendentes. */
export function aniosDeFilas(filas: { mes: string }[]): number[] {
    return [...new Set(filas.map((f) => Number(mesDe(f.mes).slice(0, 4))))].filter(Number.isFinite).sort((a, b) => a - b);
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

/** Configuración por defecto: ciclo completo, 6 módulos, todo el alcance, IHR como único indicador opcional. */
export function configPorDefecto(meses: string[]): ConfigInformeNdvi {
    const r = rangoDePreset('ciclo', meses) ?? { desde: '', hasta: '' };
    return {
        v: 2, preset: 'ciclo', desde: r.desde, hasta: r.hasta,
        modulos: [...MODULOS_SRL_IDS], indicadores: ['ihr'], basePromedio: 'simple',
        secciones: [...ORDEN_SECCIONES], hoja: 'letter',
        anios: [], contraste: 'auto', compModulos: null, imagenSatelital: false, mapaRelieve: true, firmas: true,
    };
}

/** Cambia el periodo por preset (o lo deja libre si es 'personalizado'). */
export function conPreset(c: ConfigInformeNdvi, preset: PresetPeriodo, meses: string[]): ConfigInformeNdvi {
    if (preset === 'personalizado') return { ...c, preset };
    const r = rangoDePreset(preset, meses);
    return r ? { ...c, preset, ...r } : { ...c, preset };
}

// ── Compatibilidad con configuraciones guardadas (v1: "modo" + comparación A/B) ─────────────────────────────────────────
interface ConfigV1 {
    v: 1;
    preset?: PresetPeriodo; desde?: string; hasta?: string; modulos?: number[]; indicadores?: IndicadorNdvi[]; basePromedio?: BasePromedio;
    secciones?: string[]; hoja?: Hoja; modo?: 'resumen' | 'tendencia' | 'comparativo' | 'interanual';
    comparacion?: { tipo?: 'mesVsMes' | 'periodos' | 'modulos' | 'vsSRL'; a?: RangoMes; b?: RangoMes; moduloA?: number; moduloB?: number };
    interanual?: { anios?: number[] };
}

/** Traduce una configuración v1 al alcance v2: el modo decide qué secciones se activan; A/B pasa a periodo + contraste. */
export function migrarConfigV1(c: ConfigV1, meses: string[]): ConfigInformeNdvi {
    const base = configPorDefecto(meses);
    const modo = c.modo ?? 'resumen';
    const v1 = new Set(c.secciones ?? []);
    const sec = new Set<SeccionNdvi>(['resumen']);
    if (v1.has('plano')) sec.add('situacion');
    if (v1.has('fichas')) sec.add('modulos');
    if (v1.has('serie') || v1.has('anexo')) sec.add('anexoSerie');
    if (v1.has('metodologia')) sec.add('metodologia');
    if (!c.secciones) ORDEN_SECCIONES.forEach((s) => sec.add(s));
    if (modo === 'tendencia') sec.add('tendencia');
    if (modo === 'interanual') { sec.add('interanual'); sec.add('anexoSupVol'); }
    const k = c.comparacion;
    const out: ConfigInformeNdvi = {
        ...base,
        preset: c.preset ?? base.preset, desde: c.desde ?? base.desde, hasta: c.hasta ?? base.hasta,
        modulos: c.modulos ?? base.modulos, indicadores: c.indicadores ?? base.indicadores, basePromedio: c.basePromedio ?? base.basePromedio,
        hoja: c.hoja ?? base.hoja, anios: modo === 'interanual' ? (c.interanual?.anios ?? []) : [],
    };
    if (modo === 'comparativo' && k) {
        sec.add('tendencia');
        if ((k.tipo === 'periodos' || k.tipo === 'mesVsMes') && k.a?.desde && k.b?.desde) {
            // El lado B pasa a ser el periodo del informe y el año del lado A, el contraste.
            out.preset = 'personalizado'; out.desde = k.b.desde; out.hasta = k.b.hasta;
            out.contraste = Number(k.a.desde.slice(0, 4)) !== Number(k.b.desde.slice(0, 4)) ? Number(k.a.desde.slice(0, 4)) : 'auto';
        } else if ((k.tipo === 'modulos' || k.tipo === 'vsSRL') && k.moduloA != null) {
            out.compModulos = { tipo: k.tipo, moduloA: k.moduloA, moduloB: k.moduloB ?? k.moduloA };
        }
    }
    out.secciones = ORDEN_SECCIONES.filter((s) => sec.has(s));
    return out;
}

/** Reaplica el preset de periodo sobre los meses actuales (un preset guardado "ciclo" crece cuando llegan meses nuevos). */
export function normalizaConfig(c: ConfigInformeNdvi | ConfigV1, meses: string[]): ConfigInformeNdvi {
    const v2: ConfigInformeNdvi = (c as { v?: number }).v === 1 ? migrarConfigV1(c as ConfigV1, meses) : (c as ConfigInformeNdvi);
    const completa: ConfigInformeNdvi = { ...configPorDefecto(meses), ...v2 };
    const base = completa.preset === 'personalizado' ? completa : conPreset(completa, completa.preset, meses);
    const secs = ORDEN_SECCIONES.filter((s) => s === 'resumen' || base.secciones.includes(s));
    return {
        ...base,
        modulos: MODULOS_SRL_IDS.filter((m) => base.modulos.includes(m)),
        indicadores: INDICADORES_NDVI.map((i) => i.id).filter((i) => base.indicadores.includes(i)),
        secciones: secs,
        anios: [...new Set(base.anios)].sort((a, b) => a - b),
        compModulos: base.compModulos && MODULOS_SRL_IDS.includes(base.compModulos.moduloA) ? base.compModulos : null,
    };
}

/** Filas dentro del periodo y de los módulos elegidos. */
export function filtrarFilas<T extends { mes: string; numero_modulo: number }>(filas: T[], c: Pick<ConfigInformeNdvi, 'desde' | 'hasta' | 'modulos'>): T[] {
    return filas.filter((f) => {
        const m = mesDe(f.mes);
        return m >= c.desde && m <= c.hasta && c.modulos.includes(f.numero_modulo);
    });
}

/** Último mes con dato dentro del periodo (el "mes de referencia" del informe filtrado); null si no hay. */
export function mesReferenciaDe(filas: { mes: string; numero_modulo: number }[], c: Pick<ConfigInformeNdvi, 'desde' | 'hasta' | 'modulos'>): string | null {
    const m = mesesDisponibles(filtrarFilas(filas, c));
    return m[m.length - 1] ?? null;
}

/** Año de interés = año del último mes del periodo. */
export const anioDeInteres = (c: Pick<ConfigInformeNdvi, 'hasta'>): number => Number((c.hasta ?? '').slice(0, 4));

/**
 * Años de la comparación: los elegidos (o todos los de la serie si no se eligió ninguno) más siempre el año de interés;
 * nunca años posteriores a él. Es la única lista de años del informe: la referencia de "lo habitual", el año tras año y el interanual.
 */
export function aniosDeReferencia(c: Pick<ConfigInformeNdvi, 'anios' | 'hasta'>, aniosSerie: number[]): number[] {
    const foco = anioDeInteres(c);
    const elegidos = c.anios.length ? c.anios : aniosSerie;
    return [...new Set([...elegidos, ...(Number.isFinite(foco) ? [foco] : [])])].filter((a) => !Number.isFinite(foco) || a <= foco).sort((a, b) => a - b);
}

export interface ContrasteResuelto { anioA: number; a: RangoMes; b: RangoMes }

/** Periodo A del contraste = el periodo del informe llevado al año elegido; null si no hay contraste aplicable. */
export function resolverContraste(c: Pick<ConfigInformeNdvi, 'desde' | 'hasta' | 'contraste'>, filas: { mes: string }[]): ContrasteResuelto | null {
    const anioB = Number(c.hasta.slice(0, 4));
    if (!c.desde || !c.hasta || !Number.isFinite(anioB) || c.contraste === 'ninguno') return null;
    const b: RangoMes = { desde: c.desde, hasta: c.hasta };
    const anioA = c.contraste === 'auto' ? anioB - 1 : c.contraste;
    if (anioA === anioB) return null;
    const a = desplazaAnios(b, anioA - anioB);
    if (c.contraste === 'auto' && !filas.some((f) => mesDe(f.mes) >= a.desde && mesDe(f.mes) <= a.hasta)) return null;
    return { anioA, a, b };
}

const hayDatos = (filas: { mes: string; numero_modulo: number }[], r: RangoMes, modulos: number[]) =>
    filas.some((f) => mesDe(f.mes) >= r.desde && mesDe(f.mes) <= r.hasta && modulos.includes(f.numero_modulo));

/** Errores que bloquean "Generar". */
export function validarConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const e: string[] = [];
    if (!c.modulos.length) e.push('Elige al menos un módulo.');
    if (!c.secciones.length) e.push('Elige al menos una sección.');
    if (!c.desde || !c.hasta) e.push('Elige el periodo.');
    else if (c.desde > c.hasta) e.push('El mes inicial no puede ser posterior al final.');
    else if (c.modulos.length && !filtrarFilas(filas, c).length) e.push(`No hay lecturas de NDVI entre ${c.desde} y ${c.hasta} para los módulos elegidos.`);
    const serie = aniosDeFilas(filas);
    if (c.secciones.includes('interanual') && aniosDeReferencia(c, serie).length < 2) e.push('La comparación entre años necesita al menos dos años: elige más años o desmarca esa sección.');
    const k = c.compModulos;
    if (k) {
        if (k.tipo === 'modulos' && k.moduloA === k.moduloB) e.push('Elige dos módulos distintos para compararlos.');
        for (const m of k.tipo === 'modulos' ? [k.moduloA, k.moduloB] : [k.moduloA]) {
            if (!c.modulos.includes(m)) e.push(`El Módulo ${m} de la comparación no está entre los módulos elegidos del informe.`);
            else if (!filas.some((f) => f.numero_modulo === m)) e.push(`El Módulo ${m} no tiene lecturas.`);
        }
    }
    return e;
}

/** Avisos que NO bloquean (se muestran en la ventana). */
export function avisosConfig(c: ConfigInformeNdvi, filas: { mes: string; numero_modulo: number }[]): string[] {
    const a: string[] = [];
    const ref = mesReferenciaDe(filas, c);
    if (ref) {
        const sin = c.modulos.filter((m) => !filas.some((f) => f.numero_modulo === m && mesDe(f.mes) === ref));
        if (sin.length) a.push(`Sin dato en ${mesLegible(ref)}: ${sin.map((m) => `Módulo ${m}`).join(', ')} (aparecerán como S/D).`);
    }
    if (c.modulos.length === 1) a.push('Con un solo módulo el promedio SRL equivale a ese módulo.');
    const meses = mesesDisponibles(filtrarFilas(filas, c));
    if (meses.length === 1) a.push('Un solo mes: no habrá serie del periodo con tendencia (solo el valor y el cambio contra el mes anterior).');
    const nAnios = aniosDeFilas(filas).length;
    if (nAnios < 2) a.push('La serie cargada abarca un solo año: no hay años anteriores contra los cuales comparar.');
    else if (aniosDeReferencia(c, aniosDeFilas(filas)).length < 4) a.push('Con menos de cuatro años de referencia, lo "habitual" tiene baja confianza y se marca así.');
    const k = resolverContraste(c, filas);
    if (c.contraste !== 'ninguno' && c.desde && !k && c.contraste !== 'auto') a.push('El contraste elegido no es aplicable: el año coincide con el del periodo.');
    if (k && !hayDatos(filas, k.a, c.modulos)) a.push(`Sin lecturas en el periodo de contraste (${etiquetaPeriodo(k.a)}): la comparación quedará S/D.`);
    if (c.secciones.includes('anexoSupVol') && aniosDeReferencia(c, aniosDeFilas(filas)).length < 2) a.push('El anexo de superficie y volumen necesita al menos dos años de referencia: se omitirá.');
    if (c.indicadores.includes('iehp')) a.push('El IEHP exige consultar el volumen entregado del ciclo; si la consulta falla, el informe lo declara y deja S/D.');
    const sinTemporada = meses.some((m) => !['03', '04', '05', '06', '07', '08', '09'].includes(m.slice(5, 7)));
    if (sinTemporada) a.push('Los meses fuera de marzo–septiembre se muestran pero no se comparan contra lo habitual (la climatología cubre solo la temporada).');
    if (c.imagenSatelital) a.push('La imagen satelital se solicita al servicio de Sentinel al generar; si no responde, el informe sale con un aviso en su lugar.');
    return a;
}

export interface HojaPlan { id: SeccionNdvi | 'compModulos'; titulo: string }

/**
 * Plan de hojas del documento, en el orden en que se imprimen. Lo usan el modal (estimación) y la plantilla (que cuenta las
 * hojas realmente armadas para "Pág. n de N"): una sola regla de qué hojas existen.
 */
export function planHojas(c: ConfigInformeNdvi): HojaPlan[] {
    const sec = new Set(c.secciones);
    const out: HojaPlan[] = [{ id: 'resumen', titulo: 'Portada y resumen ejecutivo' }];
    if (sec.has('situacion')) out.push({ id: 'situacion', titulo: 'Situación del periodo' });
    if (sec.has('tendencia')) out.push({ id: 'tendencia', titulo: 'Tendencia: frente a lo habitual' }, { id: 'tendencia', titulo: 'Año tras año y contraste' });
    if (sec.has('interanual')) out.push({ id: 'interanual', titulo: 'Comparación entre años' });
    if (c.compModulos) out.push({ id: 'compModulos', titulo: 'Comparación entre módulos' });
    if (sec.has('modulos')) out.push({ id: 'modulos', titulo: 'Módulo por módulo' });
    if (sec.has('anexoSerie')) out.push({ id: 'anexoSerie', titulo: 'Anexo: serie histórica' });
    if (sec.has('anexoSupVol')) out.push({ id: 'anexoSupVol', titulo: 'Anexo: superficie y volumen' });
    if (sec.has('metodologia')) out.push({ id: 'metodologia', titulo: 'Anexo: metodología, glosario y límites' }, { id: 'metodologia', titulo: 'Anexo: trazabilidad, calidad del dato y firmas' });
    return out;
}

/** Cuántas hojas saldrán (estimación; la plantilla puede omitir una hoja si no hay datos que mostrar). */
export const paginasEstimadas = (c: ConfigInformeNdvi): number => planHojas(c).length;

/** Primer mes (AAAA-03) del ciclo agrícola al que pertenece un mes: el ciclo corre de marzo a septiembre. */
export function inicioCiclo(mes: string): string {
    const m = /^(\d{4})-(\d{2})/.exec(mes);
    if (!m) return mes;
    const anio = Number(m[1]);
    return `${Number(m[2]) >= 3 ? anio : anio - 1}-03`;
}

export function etiquetaPeriodo(c: Pick<ConfigInformeNdvi, 'desde' | 'hasta'> | RangoMes): string {
    return c.desde === c.hasta ? mesLegible(c.desde) : `${mesLegible(c.desde)} a ${mesLegible(c.hasta)}`;
}

/** Código corto del periodo para folio y nombre de archivo: '2026-09' o '2026-03a09' (o '2025-11a2026-02' si cruza de año). */
export function codigoPeriodo(c: Pick<ConfigInformeNdvi, 'desde' | 'hasta'>): string {
    if (!c.desde || !c.hasta) return 'SD';
    if (c.desde === c.hasta) return c.desde;
    return c.desde.slice(0, 4) === c.hasta.slice(0, 4) ? `${c.desde}a${c.hasta.slice(5, 7)}` : `${c.desde}a${c.hasta}`;
}

/** Alcance legible y corto: RESUMEN (solo hoja 1), COMPLETO (todas las secciones) o PARCIAL. */
export function codigoAlcance(c: Pick<ConfigInformeNdvi, 'secciones' | 'compModulos'>): 'RESUMEN' | 'COMPLETO' | 'PARCIAL' {
    const resto = c.secciones.filter((s) => s !== 'resumen');
    if (!resto.length && !c.compModulos) return 'RESUMEN';
    return ORDEN_SECCIONES.every((s) => c.secciones.includes(s)) ? 'COMPLETO' : 'PARCIAL';
}

/** Representación estable de lo que define el contenido (para el hash de configuración y la clave de caché). */
export function huellaConfig(c: ConfigInformeNdvi): string {
    return JSON.stringify([
        c.desde, c.hasta, c.modulos, c.indicadores, c.basePromedio, c.secciones, c.hoja, c.anios, c.contraste, c.compModulos, c.imagenSatelital, c.mapaRelieve, c.firmas,
    ]);
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
        // Se aceptan las configuraciones v1 (con "modo") y v2: normalizaConfig las traduce al abrirlas.
        return arr.filter((p): p is PresetGuardado => !!p && typeof p.id === 'string' && typeof p.nombre === 'string' && (p.config?.v === 1 || p.config?.v === 2)).slice(0, MAX_PRESETS);
    } catch { return []; }
}

/** Devuelve true si se pudo guardar. */
export function guardarPresets(lista: PresetGuardado[]): boolean {
    try { localStorage.setItem(CLAVE_PRESETS, JSON.stringify(lista.slice(0, MAX_PRESETS))); return true; } catch { return false; }
}
