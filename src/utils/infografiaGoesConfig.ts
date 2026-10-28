/**
 * infografiaGoesConfig — filtros de la infografía de estaciones GOES (puro, sin React ni red).
 * Dos formatos: «resumen» (encabezado + tarjetas, lo que se manda por mensaje) y «técnico» (además, una ficha independiente por
 * estación con estadística, gráfica y enlace). Cada bloque se puede incluir o quitar: plano (mapa), vasos de presa, lectura en
 * palabras, minigráficas, estadística y enlace. Estaciones y periodo se eligen igual que en el Informe (misma validación).
 */
import { ORDEN_ESTACIONES, type VentanaHidro } from './hidroEstaciones';
import {
    avisosConfigGoes, configGoesPorDefecto, validarConfigGoes,
    type ConfigInformeGoes, type PeriodoGoes,
} from './informeGoesConfig';

export type FormatoInfografiaGoes = 'resumen' | 'tecnico';

/** Tamaño de hoja de la ficha técnica. `pantalla` es la tira de 1080 px para el celular; el resto son hojas de papel. */
export type HojaInfografiaGoes = 'pantalla' | 'carta-v' | 'carta-h' | 'media-v' | 'media-h' | 'mitad-2';

export interface DimensionHoja {
    id: HojaInfografiaGoes; etiqueta: string; detalle: string;
    /** Píxeles CSS a 96 dpi (el PDF de escritorio usa @page con estas medidas). `alto` null = libre (tira larga). */
    ancho: number; alto: number | null;
    orientacion: 'vertical' | 'horizontal' | 'libre';
    papel: boolean;
}

/** 1 in = 96 px: Carta 8.5×11 in = 816×1056; media Carta 5.5×8.5 in = 528×816. «Mitad de página» = media Carta horizontal (816×528). */
export const HOJAS_INFOGRAFIA: DimensionHoja[] = [
    { id: 'pantalla', etiqueta: 'Pantalla o mensaje', detalle: 'Tira larga de 1080 px para el celular (WhatsApp)', ancho: 1080, alto: null, orientacion: 'libre', papel: false },
    { id: 'carta-v', etiqueta: 'Carta vertical', detalle: 'Página completa 8.5×11 in, una ficha por hoja', ancho: 816, alto: 1056, orientacion: 'vertical', papel: true },
    { id: 'carta-h', etiqueta: 'Carta horizontal', detalle: 'Página completa 11×8.5 in, una ficha por hoja', ancho: 1056, alto: 816, orientacion: 'horizontal', papel: true },
    { id: 'media-v', etiqueta: 'Media carta vertical', detalle: '5.5×8.5 in, ficha compacta', ancho: 528, alto: 816, orientacion: 'vertical', papel: true },
    { id: 'media-h', etiqueta: 'Mitad de página', detalle: '8.5×5.5 in (media carta horizontal), ficha compacta', ancho: 816, alto: 528, orientacion: 'horizontal', papel: true },
    { id: 'mitad-2', etiqueta: 'Dos por hoja Carta', detalle: 'Dos fichas de mitad de página en una hoja Carta vertical', ancho: 816, alto: 1056, orientacion: 'vertical', papel: true },
];

export const dimensionHoja = (id: HojaInfografiaGoes): DimensionHoja => HOJAS_INFOGRAFIA.find((h) => h.id === id) ?? HOJAS_INFOGRAFIA[0];

export interface ConfigInfografiaGoes {
    formato: FormatoInfografiaGoes;
    /** Hoja de la ficha técnica; el resumen siempre es «pantalla». */
    hoja: HojaInfografiaGoes;
    /** Ids de estación a incluir (al menos una). */
    estaciones: string[];
    periodo: PeriodoGoes;
    /** Plano: mapa con las ubicaciones registradas. */
    mapa: boolean;
    /** Contorno ampliado del espejo de agua de las presas (necesita el plano). */
    vasos: boolean;
    lectura: boolean;
    minigraficas: boolean;
    /** Técnico: tabla estadística y volumen por estación. */
    estadistica: boolean;
    /** Técnico: tira de enlace de 24 h, señal y % de mensajes buenos. */
    enlace: boolean;
}

export interface BloqueInfografia { id: 'mapa' | 'vasos' | 'lectura' | 'minigraficas' | 'estadistica' | 'enlace'; etiqueta: string; ayuda: string; soloTecnico?: boolean }

export const BLOQUES_INFOGRAFIA: BloqueInfografia[] = [
    { id: 'mapa', etiqueta: 'Plano con las ubicaciones', ayuda: 'Mapa real con las estaciones y las presas' },
    { id: 'vasos', etiqueta: 'Vasos de presa', ayuda: 'Contorno del espejo de agua de La Boquilla y Madero (requiere el plano)' },
    { id: 'lectura', etiqueta: 'Lectura en palabras', ayuda: 'Tres o cuatro frases derivadas de las cifras' },
    { id: 'minigraficas', etiqueta: 'Minigráfica por estación', ayuda: 'Forma de la serie en el periodo' },
    { id: 'estadistica', etiqueta: 'Estadística por estación', ayuda: 'Mínimo, máximo, media, percentiles, pendiente y volumen', soloTecnico: true },
    { id: 'enlace', etiqueta: 'Enlace satelital', ayuda: 'Tira de 24 h, señal y mensajes buenos', soloTecnico: true },
];

export const FORMATOS_INFOGRAFIA: { id: FormatoInfografiaGoes; t: string; d: string }[] = [
    { id: 'resumen', t: 'Resumen', d: 'Una imagen con las tarjetas de las estaciones. Para enviar por mensaje.' },
    { id: 'tecnico', t: 'Técnico', d: 'Además, una ficha independiente por estación con estadística, gráfica con ejes y enlace.' },
];

/** Contenido por defecto de cada formato: el resumen es ligero; el técnico agrega estadística y enlace. */
const CONTENIDO: Record<FormatoInfografiaGoes, Pick<ConfigInfografiaGoes, 'mapa' | 'vasos' | 'lectura' | 'minigraficas' | 'estadistica' | 'enlace'>> = {
    resumen: { mapa: true, vasos: true, lectura: true, minigraficas: true, estadistica: false, enlace: false },
    tecnico: { mapa: true, vasos: true, lectura: true, minigraficas: true, estadistica: true, enlace: true },
};

export function configInfografiaPorDefecto(ventana: VentanaHidro = '24h', ids: readonly string[] = ORDEN_ESTACIONES): ConfigInfografiaGoes {
    return { formato: 'resumen', hoja: 'pantalla', estaciones: [...ids], periodo: configGoesPorDefecto(ventana).periodo, ...CONTENIDO.resumen };
}

/** Cambiar de formato reinicia el contenido a lo propio de ese formato; estaciones y periodo se conservan. */
export function cambiarFormatoInfografia(c: ConfigInfografiaGoes, f: FormatoInfografiaGoes): ConfigInfografiaGoes {
    // El resumen es una imagen de pantalla: al volver a él la hoja regresa a «pantalla».
    return f === c.formato ? c : { ...c, formato: f, hoja: f === 'resumen' ? 'pantalla' : c.hoja, ...CONTENIDO[f] };
}

/** El contenido que sí aplica al formato: en «resumen» no hay estadística ni enlace por estación. */
export function contenidoEfectivo(c: ConfigInfografiaGoes): ConfigInfografiaGoes {
    const tec = c.formato === 'tecnico';
    return { ...c, hoja: tec ? c.hoja : 'pantalla', vasos: c.mapa && c.vasos, estadistica: tec && c.estadistica, enlace: tec && c.enlace };
}

/** Adaptador: el periodo y las estaciones se validan con las mismas reglas que el Informe GOES. */
const comoInforme = (c: ConfigInfografiaGoes): ConfigInformeGoes => ({ ...configGoesPorDefecto(), estaciones: c.estaciones, periodo: c.periodo });

export function validarConfigInfografia(c: ConfigInfografiaGoes, ahoraMs: number = Date.now(), idsValidos: string[] = [...ORDEN_ESTACIONES]): string[] {
    return validarConfigGoes(comoInforme(c), ahoraMs, idsValidos).filter((m) => !/secci[oó]n/i.test(m) && !/variable/i.test(m));
}

/** Avisos (no bloquean): combinaciones que dejan la imagen con menos de lo esperado. */
export function avisosConfigInfografia(c: ConfigInfografiaGoes, ahoraMs: number = Date.now()): string[] {
    const a: string[] = [];
    if (c.vasos && !c.mapa) a.push('Los vasos de presa se dibujan sobre el plano: activa el plano o quita los vasos.');
    if (c.periodo.tipo === 'rango' || c.periodo.tipo === '30d') a.push('El cambio a 24 h y a 7 d solo se calcula con esos periodos; con este periodo la imagen no lo muestra.');
    if (c.estaciones.includes('C6301416')) a.push('Babisas: su gasto 0.00 es «< 15 m³/s» (bajo el umbral del sensor, causa sin confirmar); su media y volumen salen como rango.');
    if (c.formato === 'tecnico' && dimensionHoja(c.hoja).papel && c.hoja !== 'carta-v' && c.hoja !== 'carta-h') a.push('La ficha de media hoja es compacta: muestra lo esencial (lectura actual, una gráfica, estadística resumida y cobertura). La ficha completa es la de tamaño Carta.');
    if (c.formato === 'tecnico' && !c.estadistica && !c.enlace && !c.minigraficas) a.push('Sin estadística, enlace ni minigráfica, cada ficha técnica queda solo con la lectura actual.');
    // Las advertencias propias del Informe que sí aplican (periodo largo, recorte a 30 días).
    for (const m of avisosConfigGoes(comoInforme(c), ahoraMs)) if (/solo llegan|30 d[ií]as/i.test(m)) a.push(m);
    return a;
}

/** Cuántas imágenes/páginas produce: el resumen es una; el técnico, una de panorama (si hay plano o lectura) más una por estación. */
export function contarPaginasInfografia(c: ConfigInfografiaGoes): number {
    if (c.formato === 'resumen') return 1;
    // «Dos por hoja» pone dos fichas en cada hoja Carta; en las demás hojas, una ficha por página.
    const fichas = c.hoja === 'mitad-2' ? Math.ceil(c.estaciones.length / 2) : c.estaciones.length;
    // Las hojas de papel llevan solo fichas (sin la página de panorama con plano y lectura, que es de pantalla).
    return (dimensionHoja(c.hoja).papel ? 0 : c.mapa || c.lectura ? 1 : 0) + fichas;
}
