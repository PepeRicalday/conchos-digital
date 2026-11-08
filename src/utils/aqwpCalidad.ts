/**
 * aqwpCalidad — calidad de las series del portal USIBWC/CONAGUA ANTES de cualquier estadística. Lógica PURA.
 *
 * Hallazgos reales que motivan esto (SELECT sobre aqwp_lecturas_diarias):
 *  · 2020-09-08: una fila mezclada entre presas (Madero 1385.5 Mm³ con NAMO 333; Boquilla 216.7 entre 899.8 y 888.5;
 *    Luis L. León 655.4 entre 100.5 y 101.0).
 *  · Picos de un solo día: Madero 2026-04-06 = 319.5 (229.3 antes y 228.8 después); Pico del Águila 2023-05-31 = 21.7
 *    (36.7 antes y 31.5 después).
 * Sin filtro contaminan máximos, mínimos y percentiles. La regla se probó en SQL y detecta EXACTAMENTE esos 5 casos
 * en todo el histórico, sin falsos positivos. La tabla aqwp_lecturas_excluidas guarda los mismos 5 para la vista SQL.
 */

export interface PuntoDia { fecha: string; valor: number | null }

export interface Descarte {
  fecha: string;
  valor: number;
  motivo: 'pico_aislado' | 'imposible_fisico';
  previo: number | null;
  siguiente: number | null;
}

export interface OpcionesAtipicos {
  /** Desviación mínima (relativa al promedio de los vecinos) para considerar un pico. */
  desviacionMin?: number;
  /** Los vecinos deben coincidir entre sí: |previo−siguiente| < este factor × la desviación. */
  coincidenciaVecinos?: number;
  /** Un valor por encima de este múltiplo del NAMO es imposible si no lo respalda ningún vecino. */
  factorNamo?: number;
}

/**
 * Descarta lecturas atípicas de una serie de ALMACENAMIENTO ordenable por fecha.
 *
 *  A) Pico aislado: el valor queda por ENCIMA de ambos vecinos o por DEBAJO de ambos, se aparta más de 25 % del
 *     promedio de los vecinos, y los vecinos coinciden entre sí. Un llenado o vaciado real es monótono (queda ENTRE
 *     sus vecinos) y nunca se descarta.
 *  B) Imposible físico: supera 1.5 × NAMO y ningún vecino está dentro de 25 % de su valor. Un vertedero legítimo
 *     (Luis L. León superó su NAMO en 2017 y 2022) tiene vecinos parecidos y se conserva.
 *
 * Los extremos de la serie (sin vecino) no se descartan. Los S/D (null) no cuentan como vecinos. Devuelve la serie
 * limpia (conserva los null) y la lista de descartes con su motivo, para rotularlos en informes.
 */
export function filtrarAtipicos(
  serie: PuntoDia[],
  namoMm3: number | null,
  opc: OpcionesAtipicos = {},
): { limpias: PuntoDia[]; descartadas: Descarte[] } {
  const { desviacionMin = 0.25, coincidenciaVecinos = 0.75, factorNamo = 1.5 } = opc;
  const ordenada = [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const idxValidos = ordenada.map((p, i) => (p.valor !== null ? i : -1)).filter((i) => i >= 0);
  const descartadas: Descarte[] = [];
  const quitar = new Set<number>();

  for (let k = 1; k < idxValidos.length - 1; k++) {
    const i = idxValidos[k];
    const v = ordenada[i].valor as number;
    const prev = ordenada[idxValidos[k - 1]].valor as number;
    const next = ordenada[idxValidos[k + 1]].valor as number;
    const prom = (prev + next) / 2;
    if (prom <= 0) continue;
    const devMin = Math.min(Math.abs(v - prev), Math.abs(v - next));
    const fueraDeAmbos = v > Math.max(prev, next) || v < Math.min(prev, next);

    if (fueraDeAmbos && devMin / prom > desviacionMin && Math.abs(prev - next) < coincidenciaVecinos * devMin) {
      quitar.add(i);
      descartadas.push({ fecha: ordenada[i].fecha, valor: v, motivo: 'pico_aislado', previo: prev, siguiente: next });
    } else if (namoMm3 != null && namoMm3 > 0 && v > factorNamo * namoMm3
      && Math.abs(v - prev) / v > desviacionMin && Math.abs(v - next) / v > desviacionMin) {
      quitar.add(i);
      descartadas.push({ fecha: ordenada[i].fecha, valor: v, motivo: 'imposible_fisico', previo: prev, siguiente: next });
    }
  }
  return { limpias: ordenada.filter((_, i) => !quitar.has(i)), descartadas };
}

// ── Frescura ──────────────────────────────────────────────────────────────────
const aUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * Días de atraso entre la última lectura y hoy. Con `soloDiasHabiles` (Boquilla y Madero reportan de lunes a viernes
 * desde abril de 2026) los sábados y domingos no cuentan: un viernes visto el domingo NO está atrasado.
 */
export function atrasoDias(ultimaISO: string | null, hoyISO: string, soloDiasHabiles = false): number | null {
  if (!ultimaISO) return null;
  const a = aUtc(ultimaISO), b = aUtc(hoyISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) return 0;
  let n = 0;
  for (let t = a + 86_400_000; t <= b; t += 86_400_000) {
    const dia = new Date(t).getUTCDay();
    if (!soloDiasHabiles || (dia !== 0 && dia !== 6)) n++;
  }
  return n;
}

/** Al día: hasta 2 días de atraso (CONAGUA publica ~09:30 del día siguiente). */
export function estadoFrescura(atraso: number | null): 'al_dia' | 'atrasada' | 'sd' {
  return atraso == null ? 'sd' : atraso <= 2 ? 'al_dia' : 'atrasada';
}

// ── Balance (SOLO diagnóstico de calidad) ─────────────────────────────────────
/**
 * Compara el cambio de almacenamiento con aportación − extracción (todo en Mm³/día).
 * La evaporación RESTA, así que el residuo (Δalmacenamiento − (aportación − extracción)) debería ser ≤ 0. En los
 * últimos 30 días fue SIEMPRE positivo (Boquilla +0.66, San Gabriel +0.35, Madero +0.13 Mm³/día): la aportación publicada
 * probablemente está subestimada o es un dato derivado. Por eso esto es una BANDERA DE CALIDAD y nunca se presenta
 * como "evaporación". Devuelve null si falta algún dato.
 */
export function balanceAlerta(
  pendienteMm3Dia: number | null, aportacionMm3Dia: number | null, extraccionMm3Dia: number | null,
  umbralMm3Dia = 0.1,
): { residuoMm3Dia: number; alerta: boolean } | null {
  if (pendienteMm3Dia == null || aportacionMm3Dia == null || extraccionMm3Dia == null) return null;
  const residuo = pendienteMm3Dia - (aportacionMm3Dia - extraccionMm3Dia);
  return { residuoMm3Dia: Math.round(residuo * 1000) / 1000, alerta: residuo > umbralMm3Dia };
}
