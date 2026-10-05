// Resolutor de nivel de presa: CILA alimenta lecturas_presas (única tabla operativa que leen
// todos los módulos) con la regla "la medición de campo prevalece sobre CILA".
// Módulo puro, sin dependencias de Deno.

export const MARCA_CILA = "Nivel: CILA-IBWC";

export interface PuntoCurva { elevacion_msnm: number; volumen_mm3: number }
export interface ExistenteLectura {
  almacenamiento_mm3: number | null;
  escala_msnm: number | null;
  porcentaje_llenado: number | null;
  notas: string | null;
}

/** Elevación (msnm) por interpolación lineal sobre la curva de capacidad; null fuera de rango. */
export function interpolarElevacion(curva: PuntoCurva[], almMm3: number): number | null {
  if (curva.length < 2 || !Number.isFinite(almMm3)) return null;
  const c = [...curva].sort((a, b) => a.volumen_mm3 - b.volumen_mm3);
  if (almMm3 < c[0].volumen_mm3 || almMm3 > c[c.length - 1].volumen_mm3) return null;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].volumen_mm3 <= almMm3) lo = mid; else hi = mid;
  }
  const dv = c[hi].volumen_mm3 - c[lo].volumen_mm3;
  const t = dv === 0 ? 0 : (almMm3 - c[lo].volumen_mm3) / dv;
  return +(c[lo].elevacion_msnm + t * (c[hi].elevacion_msnm - c[lo].elevacion_msnm)).toFixed(2);
}

/**
 * La curva solo es confiable si reproduce la elevación de conservación que el propio reporte
 * CILA publica para su capacidad de conservación (tolerancia en metros). Protege contra curvas
 * placeholder (p. ej. la de Madero) que darían elevaciones absurdas.
 */
export function curvaValida(curvaEnCapConservacion: PuntoCurva[], capConservacionMm3: number | null, elevConservacionMsnm: number | null, tolM = 1): boolean {
  if (capConservacionMm3 == null || elevConservacionMsnm == null) return false;
  const e = interpolarElevacion(curvaEnCapConservacion, capConservacionMm3);
  return e != null && Math.abs(e - elevConservacionMsnm) <= tolM;
}

export type AccionResolutor = "insertar" | "actualizar" | "campo_prevalece" | "sin_dato";

export interface ResultadoResolutor {
  accion: AccionResolutor;
  valores: { escala_msnm: number | null; almacenamiento_mm3: number; porcentaje_llenado: number } | null;
  notas: string | null;
}

/**
 * - sin almacenamiento CILA → sin_dato (nunca se escribe 0).
 * - existe lectura con almacenamiento que NO proviene de CILA → campo_prevalece (no se toca).
 * - existe lectura sin nivel (solo gasto) o ya proveniente de CILA → actualizar solo columnas de nivel.
 * - no existe → insertar.
 * El % se calcula sobre la capacidad (NAMO) de SICA, no sobre la de conservación de CILA.
 */
export function resolverNivel(
  existente: ExistenteLectura | null,
  almacenamientoCila: number | null,
  capacidadSicaMm3: number,
  curva: PuntoCurva[],
  almacenamientoCilaPrevio: number | null = null,
  incertidumbreElevM: number | null = null,
): ResultadoResolutor {
  if (almacenamientoCila == null || !(capacidadSicaMm3 > 0)) return { accion: "sin_dato", valores: null, notas: null };

  // Marca en notas Y mismo valor que CILA escribió antes: si un capturista corrigió el nivel,
  // el valor ya no coincide y la medición de campo prevalece aunque la nota sobreviva.
  const esDeCila = !!existente?.notas?.includes(MARCA_CILA)
    && (almacenamientoCilaPrevio == null || existente.almacenamiento_mm3 == null
      || Math.abs(existente.almacenamiento_mm3 - almacenamientoCilaPrevio) < 1e-6);
  if (existente && existente.almacenamiento_mm3 != null && !esDeCila) {
    return { accion: "campo_prevalece", valores: null, notas: null };
  }

  const elev = interpolarElevacion(curva, almacenamientoCila);
  const etiquetaElev = elev == null
    ? " (sin elevación: curva no disponible o no validada)"
    : incertidumbreElevM != null
      ? ` (elevación ESTIMADA ±${incertidumbreElevM} m: batimetría 2004 ajustada al volumen oficial)`
      : " (elevación calculada con curva de capacidad)";
  const nota = `${MARCA_CILA}${etiquetaElev}`;
  const previas = existente?.notas ? existente.notas.replace(/Nivel: CILA-IBWC[^|]*\|?\s*/, "").trim() : "";
  return {
    accion: existente ? "actualizar" : "insertar",
    valores: {
      escala_msnm: existente && !esDeCila && existente.escala_msnm != null ? existente.escala_msnm : elev,
      almacenamiento_mm3: almacenamientoCila,
      porcentaje_llenado: +((almacenamientoCila / capacidadSicaMm3) * 100).toFixed(2),
    },
    notas: previas ? `${nota} | ${previas}` : nota,
  };
}
