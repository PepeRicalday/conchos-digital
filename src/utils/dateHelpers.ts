/**
 * Centralized Date Helpers — SICA 005
 * Uses 'America/Chihuahua' timezone consistently across the platform.
 * Delicias, Chihuahua observes Tiempo del Centro (UTC-6 DST / UTC-7 Std).
 */

const SICA_TIMEZONE = 'America/Chihuahua';

/**
 * Returns today's date as YYYY-MM-DD in the local Chihuahua timezone.
 * Replaces inconsistent usages of toISOString().split('T')[0] (UTC)
 * and toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' }).
 */
export const getTodayString = (): string => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SICA_TIMEZONE
    }).format(new Date());
};

/**
 * Converts any Date object to a YYYY-MM-DD string in Chihuahua timezone.
 */
export const toDateString = (date: Date): string => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SICA_TIMEZONE
    }).format(date);
};

/**
 * Checks if a given Date is "today" in the Chihuahua timezone.
 */
export const isToday = (date: Date): boolean => {
    return toDateString(date) === getTodayString();
};
