/**
 * confirmacionCila — contraste entre la captura manual («Seguimiento de presas», 07:00 h) y el reporte oficial CILA/IBWC
 * (que se publica por la mañana) para el MISMO día. La captura manda; CILA la confirma o la contradice.
 * Lógica pura. S/D nunca es cero: sin captura o sin CILA no hay diferencia que calcular.
 */
export type EstadoConfirmacion = 'confirmada' | 'difiere' | 'pendiente' | 'sin_captura';

export interface Confirmacion {
  estado: EstadoConfirmacion;
  /** Captura − CILA (Mm³). null si falta alguna. */
  difMm3: number | null;
  /** Diferencia en puntos porcentuales de la capacidad. null si falta la capacidad. */
  difPuntos: number | null;
  /** Frase corta para la pantalla y la infografía. */
  texto: string;
}

/** La captura se teclea con 2 decimales y CILA publica 3: hasta 0.05 Mm³ es redondeo, no diferencia. */
export const TOLERANCIA_CONFIRMACION_MM3 = 0.05;

const f = (v: number, d = 3) => v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const sg = (v: number, d = 3) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v), d)}`;

export function confirmarConCila(capturaMm3: number | null, cilaMm3: number | null, capacidadMm3: number | null): Confirmacion {
  if (capturaMm3 == null) return { estado: 'sin_captura', difMm3: null, difPuntos: null, texto: 'Sin captura del día: se publica el dato de CILA' };
  if (cilaMm3 == null) return { estado: 'pendiente', difMm3: null, difPuntos: null, texto: 'Pendiente de confirmar: CILA aún no publica el dato del día' };
  const dif = capturaMm3 - cilaMm3;
  const puntos = capacidadMm3 != null && capacidadMm3 > 0 ? (dif / capacidadMm3) * 100 : null;
  if (Math.abs(dif) <= TOLERANCIA_CONFIRMACION_MM3) {
    return { estado: 'confirmada', difMm3: dif, difPuntos: puntos, texto: `CILA confirma la captura (Δ ${sg(dif)} hm³)` };
  }
  return {
    estado: 'difiere', difMm3: dif, difPuntos: puntos,
    texto: `Difiere de CILA: ${sg(dif)} hm³${puntos != null ? ` (${sg(puntos, 2)} pp)` : ''}`,
  };
}

export const GLIFO_CONFIRMACION: Record<EstadoConfirmacion, string> = { confirmada: '✓', difiere: '▲', pendiente: '◇', sin_captura: '◇' };

/**
 * REGLA DE RESPALDO: la captura manual se publica solo si es del día más reciente (igual o posterior al último CILA).
 * Si no hay captura vigente (falta la de hoy, o lleva una semana sin capturarse) manda el dato CILA: jamás una captura vieja
 * se presenta como si fuera de hoy. Sin ningún CILA, cualquier captura es la única lectura y se usa.
 */
export function capturaEsVigente(fechaCaptura: string | null, fechaUltimaCila: string | null): boolean {
  if (fechaCaptura == null) return false;
  return fechaUltimaCila == null || fechaCaptura >= fechaUltimaCila;
}
