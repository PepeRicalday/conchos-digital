import { useMemo } from 'react';
import { avanceCiclo, fmtAf } from '../../../utils/tratadoCiclo';
import type { useTratadoCiclo } from '../../../hooks/useTratadoCiclo';

const af0 = (v: number | null) => (v == null ? 'S/D' : fmtAf(v));

/** Resumen de una línea para el encabezado de la sección plegada. */
export default function ResumenTratado({ tratado, hoyISO }: { tratado: ReturnType<typeof useTratadoCiclo>; hoyISO: string }) {
  const a = useMemo(() => (tratado.datos ? avanceCiclo(tratado.datos.ciclo, tratado.datos.cortes) : null), [tratado.datos, hoyISO]);
  if (tratado.error) return <>No se pudo leer el avance del Tratado</>;
  if (!a) return <>Cargando avance del Tratado…</>;
  if (a.acumuladoAf == null || a.pctCompromiso == null) return <>Sin corte oficial del IBWC (S/D)</>;
  return <>{af0(a.acumuladoAf)} AF · {a.pctCompromiso.toFixed(1)} % del compromiso · {a.estado === 'adelante' ? 'por delante de la meta lineal' : a.estado === 'atrasado' ? 'por debajo de la meta lineal' : 'en la meta lineal'}</>;
}

