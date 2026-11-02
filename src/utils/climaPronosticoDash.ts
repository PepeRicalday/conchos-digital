/**
 * climaPronosticoDash — lógica pura de la tarjeta Clima del Dashboard (sin React ni Supabase).
 * Resume el pronóstico horario de 48 h en "Hoy / Mañana", clasifica la condición del cielo y arma la frase corta.
 * Regla de la casa: S/D (null) nunca se convierte en 0; sin nubosidad el cielo es "no determinado".
 */
import type { PuntoHora } from './dashboardExtra';

export const ZONA = 'America/Chihuahua';
/** Probabilidad desde la cual la lluvia "es probable" (misma que PROB_LLUVIA_CUENTA_PCT de dashboardExtra). */
export const PROB_LLUVIA_PROBABLE = 60;
export const PROB_LLUVIA_POSIBLE = 30;

export type CondicionDia = 'lluvia' | 'posible' | 'seco' | 'sd';

export interface ResumenDia {
    /** 'hoy' | 'manana' */
    clave: 'hoy' | 'manana';
    tMax: number | null;
    tMin: number | null;
    probMax: number | null;
    lluviaMm: number | null;
    horas: number;
    condicion: CondicionDia;
}

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Día calendario (YYYY-MM-DD) de un instante, en la zona del distrito. */
export const diaLocal = (t: number): string => fmtDia.format(new Date(t));

/** Condición del día por probabilidad y lámina previstas; S/D si no hay ninguna de las dos. */
export function condicionDe(probMax: number | null, lluviaMm: number | null): CondicionDia {
    if (!fin(probMax) && !fin(lluviaMm)) return 'sd';
    if ((fin(probMax) && probMax >= PROB_LLUVIA_PROBABLE) || (fin(lluviaMm) && lluviaMm >= 1)) return 'lluvia';
    if ((fin(probMax) && probMax >= PROB_LLUVIA_POSIBLE) || (fin(lluviaMm) && lluviaMm >= 0.2)) return 'posible';
    return 'seco';
}

/** Mínimo de horas con dato para afirmar un día (con menos se muestra S/D). */
const HORAS_MIN_DIA = 3;

/** Hoy (lo que resta del día) y Mañana a partir de la serie horaria de 48 h. */
export function resumenDias(horas: PuntoHora[], ahoraMs: number): ResumenDia[] {
    const hoy = diaLocal(ahoraMs), manana = diaLocal(ahoraMs + 24 * 3_600_000);
    return (['hoy', 'manana'] as const).map((clave) => {
        const objetivo = clave === 'hoy' ? hoy : manana;
        const hs = horas.filter((h) => diaLocal(h.t) === objetivo);
        const temps = hs.map((h) => h.tempC).filter(fin);
        const probs = hs.map((h) => h.probPct).filter(fin);
        const ll = hs.map((h) => h.lluviaMm).filter(fin);
        const sd = hs.length < HORAS_MIN_DIA;
        const tMax = !sd && temps.length ? Math.max(...temps) : null;
        const tMin = !sd && temps.length ? Math.min(...temps) : null;
        const probMax = !sd && probs.length ? Math.max(...probs) : null;
        const lluviaMm = !sd && ll.length ? ll.reduce((a, b) => a + b, 0) : null;
        return { clave, tMax, tMin, probMax, lluviaMm, horas: hs.length, condicion: sd ? 'sd' : condicionDe(probMax, lluviaMm) };
    });
}

export type TipoCielo = 'despejado' | 'parcial' | 'nublado' | 'noche' | 'noche-parcial' | 'sd';
export interface CieloAhora { tipo: TipoCielo; texto: string }

/** Cielo a partir de la nubosidad (%): sin dato = "no determinado" (nunca se inventa despejado). */
export function cieloAhora(nubPct: number | null | undefined, horaLocal: number): CieloAhora {
    if (!fin(nubPct)) return { tipo: 'sd', texto: 'Cielo no determinado' };
    const noche = horaLocal >= 20 || horaLocal < 6;
    if (nubPct <= 25) return noche ? { tipo: 'noche', texto: 'Despejado' } : { tipo: 'despejado', texto: 'Despejado' };
    if (nubPct <= 60) return noche ? { tipo: 'noche-parcial', texto: 'Parcialmente nublado' } : { tipo: 'parcial', texto: 'Parcialmente nublado' };
    return { tipo: 'nublado', texto: 'Nublado' };
}

export const horaLocal = (ms: number): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hour12: false }).format(new Date(ms))) % 24;

const txtT = (v: number | null) => (v == null ? 'S/D' : `${v.toFixed(0)}°`);

/** Frase corta y fácil de entender: "Hoy máx 29°, sin lluvia · Mañana máx 31°, lluvia probable (70 %)". */
export function fraseResumen(dias: ResumenDia[]): string {
    const parte = (d: ResumenDia, nombre: string) => {
        if (d.condicion === 'sd') return `${nombre}: sin pronóstico suficiente`;
        const lluvia = d.condicion === 'lluvia' ? `lluvia probable${fin(d.probMax) ? ` (${d.probMax.toFixed(0)} %)` : ''}`
            : d.condicion === 'posible' ? `lluvia posible${fin(d.probMax) ? ` (${d.probMax.toFixed(0)} %)` : ''}` : 'sin lluvia';
        return `${nombre} máx ${txtT(d.tMax)}, ${lluvia}`;
    };
    const [hoy, manana] = dias;
    return [hoy && parte(hoy, 'Hoy'), manana && parte(manana, 'Mañana')].filter(Boolean).join(' · ');
}

/** Frase de condición para el hero: combina cielo, lluvia observada/prevista y temperatura. */
export function fraseAhora(cielo: CieloAhora, tempC: number | null, lluviaHoyMm: number | null, helada: number, calor = 35): string {
    if (fin(lluviaHoyMm) && lluviaHoyMm >= 0.2) return 'Lluvia registrada hoy';
    if (fin(tempC) && tempC <= helada) return 'Riesgo de helada';
    if (fin(tempC) && tempC >= calor) return `${cielo.tipo === 'sd' ? 'Calor' : `${cielo.texto} y caluroso`}`;
    return cielo.texto;
}
