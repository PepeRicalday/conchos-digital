import { useEffect, useMemo, useState } from 'react';
import { DataTable, type Columna } from '../../ui/base';
import { useSaludFuentes } from '../../../hooks/useSaludFuentes';
import {
  cadenciaTexto, ETIQUETA_ESTADO, evaluarFuentes, GLIFO_ESTADO_FUENTE, haceTexto, lecturasSalud, resumenSalud, type FuenteEvaluada,
} from '../../../utils/saludFuentes';
import LecturaCuenca from './LecturaCuenca';

const CLASE_CHIP = { ok: 'ok', warn: 'warn', crit: 'crit', sd: 'sd' } as const;

const COLUMNAS: Columna<FuenteEvaluada>[] = [
  { id: 'f', titulo: 'Fuente', encabezadoFila: true, render: (f) => <><span className="cu-nombre">{f.nombre}</span><span className="cu-nota-fila">{f.grupo}</span></> },
  { id: 'u', titulo: 'Último dato', render: (f) => haceTexto(f.edadMin) },
  { id: 'e', titulo: 'Se espera', render: (f) => cadenciaTexto(f.esperadoMin) },
  { id: 's', titulo: 'Estado', render: (f) => <span className={`cu-estado cu-estado--${f.estado === 'al_dia' ? 'ok' : f.estado === 'retraso' ? 'warn' : f.estado === 'sin_actualizar' ? 'crit' : 'sd'}`}><span aria-hidden="true">{GLIFO_ESTADO_FUENTE[f.estado]}</span> {ETIQUETA_ESTADO[f.estado]}</span> },
];

/**
 * Salud de las fuentes de datos de la cuenca: una línea en el encabezado («Fuentes: 12 de 13 al día») que se abre en la lista
 * de cada fuente con su último dato y cada cuánto se espera uno. Responde a «¿puedo fiarme de lo que veo?» antes de leer las cifras.
 * Si no se puede leer el estado, lo dice (S/D): nunca asume que todo está bien.
 */
export default function SaludFuentesCuenca() {
  const { filas, error, cargando } = useSaludFuentes();
  // El reloj avanza cada minuto para que «hace 5 min» no se quede congelado entre consultas.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setAhora(Date.now()), 60000); return () => window.clearInterval(t); }, []);
  const ev = useMemo(() => (filas ? evaluarFuentes(filas, ahora) : []), [filas, ahora]);
  const res = useMemo(() => resumenSalud(ev), [ev]);

  if (cargando) return null;
  const sinInfo = filas == null;
  const tono = sinInfo ? 'sd' : res.tono;
  const peor = ev[0] && ev[0].estado !== 'al_dia' ? ev[0] : null;
  const texto = sinInfo
    ? 'Fuentes de datos: sin información (S/D)'
    : `Fuentes de datos: ${res.alDia} de ${res.total} al día${peor ? ` · ${peor.nombre}: ${ETIQUETA_ESTADO[peor.estado].toLowerCase()}` : ''}`;
  const glifo = tono === 'ok' ? '●' : tono === 'warn' ? '▲' : tono === 'crit' ? '■' : '◇';

  return (
    <details className="cu-salud cu-notas" aria-label="Salud de las fuentes de datos">
      <summary className="cu-notas-sum">
        <span className={`an-chip an-chip--${CLASE_CHIP[tono]}`}><span aria-hidden="true">{glifo}</span> {texto}</span>
      </summary>
      {sinInfo ? (
        <p className="an-aviso" role="status">No se pudo leer el estado de las fuentes{error ? `: ${error}` : ''}. No se debe suponer que están al día.</p>
      ) : (
        <>
          <LecturaCuenca titulo="Qué mirar en las fuentes" lecturas={lecturasSalud(ev)} />
          <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Estado de las fuentes de datos (desplazable)" captionOculto caption="Salud de las fuentes de datos de la cuenca" clave={(f) => f.clave} filas={ev} columnas={COLUMNAS} />
          <p className="an-nota cu-bal-pie">Al día = último dato dentro de 1.5 veces lo esperado; con retraso = hasta 3 veces; sin actualizar = más. En satélite y WeatherLink se muestra la fuente más atrasada para que no se esconda detrás de las demás.</p>
        </>
      )}
    </details>
  );
}
