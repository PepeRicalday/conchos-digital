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

/**
 * Returns the date of the Monday for the current (or given) week.
 * Follows the "Lunes a Domingo" directive.
 */
export const getStartOfWeek = (baseDate: Date = new Date()): string => {
    // We use a copy set to noon to avoid UTC day shifts
    const d = new Date(baseDate);
    d.setHours(12, 0, 0, 0); 
    
    const day = d.getDay(); // 0 (Sun), 1 (Mon) ... 6 (Sat)
    // Adjust to Monday: 
    // Sun(0) -> -6, Mon(1) -> 0, Tue(2) -> -1, etc.
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    
    return toDateString(d);
};

/**
 * Returns the date of the Sunday for the current (or given) week.
 * 7 days: Mon, Tue, Wed, Thu, Fri, Sat, Sun. (Start + 6 days)
 */
export const getEndOfWeek = (baseDate: Date = new Date()): string => {
    // Start from the Monday string, but parse it safely
    const startStr = getStartOfWeek(baseDate);
    const parts = startStr.split('-').map(Number);
    // Create date in local timezone to avoid UTC jump
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    d.setDate(d.getDate() + 6);
    
    return toDateString(d);
};
