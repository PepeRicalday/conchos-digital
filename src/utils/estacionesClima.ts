// ═══════════════════════════════════════════════════════════════════════════
// Estaciones de clima de la cuenca y su región, en UN solo modelo: propias (WeatherLink), JCAS/UACJ y Unifrut.
// Lo usan la tabla de «Red de estaciones», su mapa y el mapa interactivo de pantalla completa: una sola definición de valor por
// (variable, ventana) para que nunca digan cosas distintas.
//
// REGLAS: S/D = null, nunca 0 · Unifrut NUNCA entra al promedio de la cuenca (está fuera del contorno) · lluvia de un pluviómetro excluido o sin
// pluviómetro = S/D · Unifrut no da lectura parcial de «hoy», ni humedad confiable, ni horas frío.
// ═══════════════════════════════════════════════════════════════════════════
import { mmPropio, valorObs, type ModeloRedJcas, type PuntoPropio, type PuntoRedJcas, type VariableObs, type VentanaObs } from './jcasModelo';
import { valorUnifrut, ubicacionUnifrut, type ModeloUnifrut, type PuntoUnifrut, type VariableUnifrut } from './unifrutModelo';

export type FuenteEstacion = 'propia' | 'jcas' | 'unifrut';
export const FUENTES: { id: FuenteEstacion; etiqueta: string; ayuda: string }[] = [
    { id: 'propia', etiqueta: 'Propias', ayuda: 'Estaciones WeatherLink del distrito (SRL Conchos)' },
    { id: 'jcas', etiqueta: 'JCAS', ayuda: 'Red JCAS/UACJ dentro de la cuenca del Conchos' },
    { id: 'unifrut', etiqueta: 'Unifrut', ayuda: 'Red regional de Unifrut A.C. (Cuauhtémoc, Namiquipa, Guerrero): contexto, fuera de la cuenca' },
];
export const FUENTES_TODAS: FuenteEstacion[] = FUENTES.map((f) => f.id);

/** Variables que se pueden ver por estación (las mismas que los planos). */
export type VariableEstacion = VariableObs;
export const VARIABLES_ESTACION: { id: VariableEstacion; etiqueta: string; unidad: string; decimales: number }[] = [
    { id: 'lluvia', etiqueta: 'Lluvia', unidad: 'mm', decimales: 1 },
    { id: 'temperatura', etiqueta: 'Temperatura', unidad: '°C', decimales: 1 },
    { id: 'tmin', etiqueta: 'T mínima', unidad: '°C', decimales: 1 },
    { id: 'viento', etiqueta: 'Viento', unidad: 'km/h', decimales: 1 },
    { id: 'humedad', etiqueta: 'Humedad', unidad: '%', decimales: 0 },
    { id: 'horasFrio', etiqueta: 'Horas frío', unidad: 'h', decimales: 0 },
];
export const infoVariable = (v: VariableEstacion) => VARIABLES_ESTACION.find((x) => x.id === v)!;
export const fmtValorEstacion = (v: VariableEstacion, x: number | null): string => (x == null ? 'S/D' : `${x.toFixed(infoVariable(v).decimales)} ${infoVariable(v).unidad}`);

export type EstadoEstacion = 'vigente' | 'atrasada' | 'fuera-servicio' | 'sin-datos';

interface Base { clave: string; nombre: string; lat: number; lon: number; altitudM: number | null; estado: EstadoEstacion; ultFecha: string | null; atrasoDias: number | null; nota: string | null }
export type EstacionClima =
    | (Base & { fuente: 'jcas'; origen: PuntoRedJcas; excluidaLluvia: boolean; sinPluviometro: boolean; motivo: string | null })
    | (Base & { fuente: 'propia'; origen: PuntoPropio; excluidaLluvia: false; sinPluviometro: false; motivo: null })
    | (Base & { fuente: 'unifrut'; origen: PuntoUnifrut; excluidaLluvia: false; sinPluviometro: false; motivo: null });

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface ModeloEstaciones {
    estaciones: EstacionClima[];
    /** Último día completo (ayer) de la red JCAS/propias y de Unifrut. */
    finJcas: string | null; finUnifrut: string | null;
}

export function construirEstacionesClima(red: ModeloRedJcas | null | undefined, unifrut: ModeloUnifrut | null | undefined): ModeloEstaciones {
    const out: EstacionClima[] = [];
    for (const p of red?.puntos ?? []) {
        out.push({
            clave: `jcas:${p.id}`, fuente: 'jcas', nombre: p.nombre, lat: p.lat, lon: p.lon, altitudM: p.altitudM, origen: p,
            estado: p.estado === 'vigente' ? 'vigente' : p.estado === 'atrasada' ? 'atrasada' : 'sin-datos', ultFecha: p.ultFecha, atrasoDias: p.atrasoDias,
            nota: p.zona === 'salida' ? 'Salida de la cuenca' : p.grupo ? 'Misma ciudad que otras estaciones: pesa una vez en el promedio' : null,
            excluidaLluvia: p.sospechosa, sinPluviometro: p.sinPluviometro, motivo: p.motivo,
        });
    }
    for (const p of red?.propias ?? []) {
        const dias = red && p.ultFecha ? diasEntre(p.ultFecha.slice(0, 10), red.fin) : null;
        out.push({
            clave: `propia:${p.id}`, fuente: 'propia', nombre: p.nombre, lat: p.lat, lon: p.lon, altitudM: null, origen: p,
            estado: !p.ultFecha ? 'sin-datos' : dias != null && dias > 1 ? 'atrasada' : 'vigente', ultFecha: p.ultFecha, atrasoDias: dias != null && dias > 1 ? dias : null,
            nota: p.tempUltima == null && p.medias.temp30 == null ? 'Estación WeatherLink del distrito: solo lluvia (sin sensor de temperatura confiable)' : 'Estación WeatherLink del distrito',
            excluidaLluvia: false, sinPluviometro: false, motivo: null,
        });
    }
    for (const p of unifrut?.puntos ?? []) {
        out.push({
            clave: `unifrut:${p.id}`, fuente: 'unifrut', nombre: p.nombre, lat: p.lat, lon: p.lon, altitudM: p.altitudM, origen: p,
            estado: p.estado, ultFecha: p.ultFecha, atrasoDias: p.atrasoDias,
            nota: `${p.municipio.charAt(0) + p.municipio.slice(1).toLowerCase()} · ${ubicacionUnifrut(p)}`,
            excluidaLluvia: false, sinPluviometro: false, motivo: null,
        });
    }
    return { estaciones: out, finJcas: red?.fin ?? null, finUnifrut: unifrut?.fin ?? null };
}

const VAR_UNIFRUT: Partial<Record<VariableEstacion, VariableUnifrut>> = { lluvia: 'lluvia', temperatura: 'tmed', tmin: 'tmin', viento: 'viento' };

/**
 * Valor de una estación en (variable, ventana). null = S/D. Una sola definición para tabla, mapas y panel de detalle.
 * Unifrut: sin lectura parcial de «hoy», sin humedad ni horas frío (S/D).
 */
export function valorEstacion(e: EstacionClima, variable: VariableEstacion, ventana: VentanaObs, finUnifrut: string | null): number | null {
    if (e.fuente === 'unifrut') {
        const v = VAR_UNIFRUT[variable];
        return v && finUnifrut ? valorUnifrut(e.origen, v, ventana, finUnifrut) : null;
    }
    if (e.fuente === 'propia') return variable === 'lluvia' ? mmPropio(e.origen, ventana) : valorObs(e.origen, variable, ventana);
    if (variable === 'lluvia' && (e.excluidaLluvia || e.sinPluviometro)) return null;
    return valorObs(e.origen, variable, ventana);
}

/** Valor de un punto Unifrut en una variable de estación (S/D en humedad y horas frío, y en «hoy»). Para el mapa, que trabaja con el punto y no con la estación. */
export function valorUnifrutVariable(p: PuntoUnifrut, variable: VariableEstacion, ventana: VentanaObs, finUnifrut: string | null): number | null {
    const v = VAR_UNIFRUT[variable];
    return v && finUnifrut ? valorUnifrut(p, v, ventana, finUnifrut) : null;
}

/** ¿La estación aporta esa variable en alguna ventana? (Unifrut no tiene humedad ni horas frío.) */
export const ofreceVariable = (e: EstacionClima, v: VariableEstacion): boolean => e.fuente !== 'unifrut' || v in VAR_UNIFRUT;

export const ROTULO_FUENTE: Record<FuenteEstacion, string> = { propia: 'Propia', jcas: 'JCAS', unifrut: 'Unifrut' };

/** Orden de estado para la tabla: las que reportan primero. */
export const ORDEN_ESTADO: Record<EstadoEstacion, number> = { vigente: 0, atrasada: 1, 'fuera-servicio': 2, 'sin-datos': 3 };

export interface ResumenVisible { n: number; conDato: number; media: number | null; min: number | null; max: number | null }

/** Resumen SIMPLE de las estaciones visibles con dato (no es un valor areal): con menos de 2 con dato no hay media. */
export function resumenVisible(es: EstacionClima[], variable: VariableEstacion, ventana: VentanaObs, finUnifrut: string | null): ResumenVisible {
    const vs = es.map((e) => valorEstacion(e, variable, ventana, finUnifrut)).filter((x): x is number => x != null);
    if (vs.length < 2) return { n: es.length, conDato: vs.length, media: null, min: vs[0] ?? null, max: vs[0] ?? null };
    return { n: es.length, conDato: vs.length, media: Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10, min: Math.min(...vs), max: Math.max(...vs) };
}

/** ¿La estación se muestra por defecto? Las fuera de servicio / sin datos solo si se pide. */
export const reporta = (e: EstacionClima): boolean => e.estado === 'vigente' || e.estado === 'atrasada';

export const ROTULO_RED: Record<FuenteEstacion, string> = { propia: 'Distrito', jcas: 'JCAS', unifrut: 'Unifrut' };
export interface ResumenRed extends ResumenVisible { alDia: number }

/**
 * Valor de una variable por RED (Distrito = propias WeatherLink, JCAS, Unifrut) para una ventana: media simple de las estaciones que reportan y tienen dato.
 * Con menos de 2 con dato la media es null (S/D, nunca 0). NO es un valor areal: es para identificar y comparar las redes de un vistazo (Dashboard).
 */
export function resumenPorRed(m: ModeloEstaciones, variable: VariableEstacion, ventana: VentanaObs): Record<FuenteEstacion, ResumenRed> {
    const por = (f: FuenteEstacion): ResumenRed => {
        const es = m.estaciones.filter((e) => e.fuente === f && reporta(e) && ofreceVariable(e, variable));
        return { ...resumenVisible(es, variable, ventana, m.finUnifrut), alDia: m.estaciones.filter((e) => e.fuente === f && reporta(e)).length };
    };
    return { propia: por('propia'), jcas: por('jcas'), unifrut: por('unifrut') };
}
