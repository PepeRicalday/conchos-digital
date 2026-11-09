/**
 * Fecha «de hoy» del distrito (America/Chihuahua, sin horario de verano desde 2022 = UTC-6) en una sola definición.
 * Antes cada pantalla la calculaba por su cuenta y unas usaban UTC-6 y otras UTC-7, así que entre las 00:00 y las 01:00 locales
 * la cuenca y el pronóstico podían apuntar a días distintos.
 */
const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Hoy en hora local del distrito (UTC-6). Para pronósticos, presas y pantallas. */
export const hoyLocalISO = (ahora: number = Date.now()): string => ISO(ahora - 6 * 3_600_000);

/**
 * Hoy «conservador» para la red JCAS (UTC-7): el portal publica con rezago, así que el día en curso se da por cerrado una hora más tarde
 * y un día aún incompleto nunca se cuenta como completo.
 */
export const hoyJcasISO = (ahora: number = Date.now()): string => ISO(ahora - 7 * 3_600_000);
