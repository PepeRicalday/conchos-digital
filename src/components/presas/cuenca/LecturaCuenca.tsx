import type { Lectura, TonoLectura } from '../../../utils/cuencaAnalisis';

const GLIFO: Record<TonoLectura, string> = { ok: '●', warn: '▲', crit: '■', info: '◆' };
const NOMBRE: Record<TonoLectura, string> = { ok: 'Normal', warn: 'Atención', crit: 'Crítico', info: 'Dato' };

/**
 * «Qué mirar aquí»: los hallazgos de la pestaña en una frase cada uno, antes de las gráficas y tablas. El tono lleva glifo y
 * nombre (el color nunca va solo). `onIr` convierte cada hallazgo en un acceso a su pestaña (se usa en el Resumen).
 */
export default function LecturaCuenca({ titulo = 'Qué mirar aquí', lecturas, onIr }: { titulo?: string; lecturas: (Lectura & { ir?: string; irTxt?: string })[]; onIr?: (pestana: string) => void }) {
  if (!lecturas.length) return null;
  return (
    <section className="cu-lec" aria-label={titulo}>
      <h4 className="cu-lec-t">{titulo}</h4>
      <ul className="cu-lec-lista">
        {lecturas.map((l, i) => (
          <li key={i} className={`cu-lec-item cu-lec-item--${l.tono}`}>
            <span className="cu-lec-glifo" aria-hidden="true">{GLIFO[l.tono]}</span>
            <div className="cu-lec-cuerpo">
              <span className="cu-lec-tit"><span className="cu-sr">{NOMBRE[l.tono]}: </span>{l.titulo}</span>
              <span className="cu-lec-txt">{l.texto}</span>
              {l.ir && onIr && <button type="button" className="cu-lec-ir" onClick={() => onIr(l.ir as string)}>{l.irTxt ?? 'Ver detalle'} →</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
