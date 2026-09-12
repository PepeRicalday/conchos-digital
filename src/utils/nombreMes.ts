/** Nombre del mes en español (1-12) — sin dependencias, para que módulos que
 *  no deben arrastrar el cliente de Supabase (ej. exportClimaGeoInforme.ts,
 *  probado fuera de la UI) puedan usarlo sin romper esa independencia. */
export function nombreMes(mes: number): string {
    const NOMBRES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return NOMBRES[mes - 1] ?? String(mes);
}
