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
export const isToday = (date: Date | string): boolean => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return toDateString(d) === getTodayString();
};

/**
 * Returns the UTC ISO timestamp corresponding to midnight of ANY given date
 * (YYYY-MM-DD) in the America/Chihuahua timezone.
 *
 * Strategy: sample the Chihuahua clock at noon UTC of that day (noon avoids
 * DST-boundary ambiguity), then subtract the elapsed Chihuahua hours to
 * arrive at midnight Chihuahua in UTC.
 *
 * Use this to build timestamptz range filters in Supabase that are safe
 * across DST transitions (CDT UTC-6 ↔ CST UTC-7).
 */
export const getStartOfDateISO = (dateStr: string): string => {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const noonUTC = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: SICA_TIMEZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(noonUTC);
    const h = parseInt(parts.find(p => p.type === 'hour')!.value);
    const m = parseInt(parts.find(p => p.type === 'minute')!.value);
    const s = parseInt(parts.find(p => p.type === 'second')!.value);
    const elapsedMs = (h * 3600 + m * 60 + s) * 1000;
    return new Date(noonUTC.getTime() - elapsedMs).toISOString();
};

/**
 * Returns the UTC ISO timestamp corresponding to midnight of today
 * in the America/Chihuahua timezone.
 * Use this to query Supabase timestamptz columns filtered to "today only"
 * without drifting when the browser is in a different timezone.
 */
export const getStartOfTodayISO = (): string => {
    const timeParts = new Intl.DateTimeFormat('en-US', {
        timeZone: SICA_TIMEZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(new Date());

    const h = parseInt(timeParts.find(p => p.type === 'hour')!.value);
    const m = parseInt(timeParts.find(p => p.type === 'minute')!.value);
    const s = parseInt(timeParts.find(p => p.type === 'second')!.value);

    // Subtract elapsed seconds since midnight in Chihuahua from current UTC
    const elapsedMs = (h * 3600 + m * 60 + s) * 1000;
    return new Date(Date.now() - elapsedMs).toISOString();
};

/**
 * Checks if two dates (string or Date) are the same day in Chihuahua.
 */
export const isSameDay = (d1: Date | string, d2: Date | string): boolean => {
    const a = typeof d1 === 'string' ? new Date(d1) : d1;
    const b = typeof d2 === 'string' ? new Date(d2) : d2;
    return toDateString(a) === toDateString(b);
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

/**
 * Add N calendar days to a YYYY-MM-DD string, returning YYYY-MM-DD in Chihuahua TZ.
 * Uses noon-UTC anchoring so DST transitions do not shift the result by ±1 day.
 *
 * Replaces patterns like:
 *   date.setDate(date.getDate() + n)          ← browser-local, DST-unsafe
 *   new Date(Date.now() + n * 86400000)        ← UTC ms, skips/repeats DST hour
 */
export const addDays = (dateStr: string, n: number): string => {
    const [y, mo, d] = dateStr.split('-').map(Number);
    // Anchor at noon UTC to avoid crossing midnight during DST transitions
    const noon = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    noon.setUTCDate(noon.getUTCDate() + n);
    return toDateString(noon);
};

/**
 * Returns the current date-time as a YYYY-MM-DDTHH:MM string in the
 * America/Chihuahua timezone. Use this to populate <input type="datetime-local">
 * fields so they default to Chihuahua time regardless of the browser's locale.
 *
 * Replaces the dangerous pattern:
 *   const offset = now.getTimezoneOffset() * 60000;
 *   const local  = new Date(now - offset).toISOString().slice(0, 16);
 * which assumes the browser timezone equals Chihuahua and is undefined during DST.
 */
export const getLocalDatetimeInput = (date: Date = new Date()): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: SICA_TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)!.value;
    // hour12:false can return '24' for midnight — normalize to '00'
    const hh = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hh}:${get('minute')}`;
};

/**
 * Format a timestamp as HH:MM in the America/Chihuahua timezone.
 * Replaces toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) calls
 * that use the browser's local timezone instead of Chihuahua.
 */
export const formatTime = (date: Date | string, locale = 'es-MX'): string => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString(locale, {
        hour: '2-digit', minute: '2-digit',
        timeZone: SICA_TIMEZONE,
    });
};

/**
 * Format a timestamp as a localized date string in the America/Chihuahua timezone.
 * Accepts an optional Intl.DateTimeFormatOptions object to customize the format.
 * Defaults to short date: día mes año.
 *
 * Replaces toLocaleDateString('es-MX', { ... }) calls that omit timeZone.
 */
export const formatDate = (
    date: Date | string,
    options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
    locale = 'es-MX',
): string => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString(locale, { timeZone: SICA_TIMEZONE, ...options });
};
