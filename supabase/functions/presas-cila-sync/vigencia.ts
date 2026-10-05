// Vigencia del reporte CILA/USIBWC. Módulo puro compartido por la Edge Function y la UI.
// El reporte del día se publica entre 9:00 y 11:00 (Chihuahua, UTC-6 sin horario de verano).

export type EstadoCila = "ACTUALIZADO" | "ESPERANDO" | "RETRASADO" | "SIN_ACTUALIZACION" | "SIN_DATO";

/** Minuto del día local (Chihuahua) a partir del cual un reporte aún con fecha de ayer se considera retrasado. */
export const LIMITE_PUBLICACION_MIN = 11 * 60 + 30;

export function fechaLocalChihuahua(d: Date = new Date()): { fecha: string; minutos: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chihuahua", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, minutos: Number(g("hour")) * 60 + Number(g("minute")) };
}

const dias = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

/**
 * ACTUALIZADO: el reporte trae la fecha de hoy.
 * ESPERANDO: trae la de ayer y aún no son las 11:30 (todavía puede salir).
 * RETRASADO: trae la de ayer y ya pasaron las 11:30.
 * SIN_ACTUALIZACION: dos días o más de atraso.
 */
export function estadoReporteCila(fechaReporte: string | null | undefined, ahora: Date = new Date()): { estado: EstadoCila; diasAtraso: number | null } {
  if (!fechaReporte) return { estado: "SIN_DATO", diasAtraso: null };
  const { fecha, minutos } = fechaLocalChihuahua(ahora);
  const atraso = dias(fecha) - dias(fechaReporte.slice(0, 10));
  if (atraso <= 0) return { estado: "ACTUALIZADO", diasAtraso: 0 };
  if (atraso === 1) return { estado: minutos < LIMITE_PUBLICACION_MIN ? "ESPERANDO" : "RETRASADO", diasAtraso: 1 };
  return { estado: "SIN_ACTUALIZACION", diasAtraso: atraso };
}
