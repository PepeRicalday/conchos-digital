import { useState } from 'react';
import { guardaOComparte } from '../../../utils/descargaArchivo';

/** Botón «Descargar CSV» de las tablas de la Cuenca. Si el archivo no se puede generar lo dice junto al botón (no falla en silencio). */
export default function BotonCsv({ nombre, generar }: { nombre: string; generar: () => string }) {
  const [error, setError] = useState<string | null>(null);
  const descargar = async () => {
    try {
      setError(null);
      await guardaOComparte(new Blob([generar()], { type: 'text/csv;charset=utf-8' }), nombre, 'text/csv');
    } catch (e) { setError(`No se pudo generar el archivo: ${(e as Error).message}`); }
  };
  return (
    <span className="cu-csv">
      <button type="button" className="an-btn" onClick={descargar}>Descargar CSV</button>
      {error && <span className="an-aviso" role="alert">{error}</span>}
    </span>
  );
}
