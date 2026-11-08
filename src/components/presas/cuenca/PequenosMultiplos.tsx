import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import MiniSerieLlenado from './MiniSerieLlenado';

interface Props {
    modelos: PresaCuencaModelo[];
    meses: 3 | 12;
    seleccionada: number | null;
    onSelect: (ubicacionId: number) => void;
}

/** Siete mini-series con la MISMA escala 0-100 % del NAMO: comparables de un vistazo (reemplazan las 14 líneas superpuestas). */
export default function PequenosMultiplos({ modelos, meses, seleccionada, onSelect }: Props) {
    const hayBanda = modelos.some((m) => m.banda != null);
    const nAnios = Math.max(0, ...modelos.map((m) => m.posicion?.nAnios ?? 0));
    return (
        <section className="an-card" aria-label={`Llenado de las presas, últimos ${meses} meses`}>
            <h4 className="an-h">Llenado de cada presa · últimos {meses} meses</h4>
            <p className="an-nota">
                Misma escala (0-100 % del NAMO) en todas. {hayBanda
                    ? <>La banda sombreada es el rango p10–p90 del <b>mismo día del año</b> en {2017}–{new Date().getFullYear() - 1} (n = {nAnios} años) y la línea punteada, su mediana.</>
                    : <>Sin climatología disponible: la banda sombreada es el <b>rango de los últimos 12 meses</b> de la propia presa, no un histórico.</>}
                {' '}Las líneas guía son 20 % y 40 %; el trazo punteado violeta marca tramos sin actualizar; un hueco es S/D.
            </p>
            <div className="cu-multiplos">
                {modelos.map((m) => (
                    <MiniSerieLlenado key={m.fila.ubicacionId} m={m} meses={meses} seleccionada={seleccionada === m.fila.ubicacionId} onSelect={onSelect} />
                ))}
            </div>
            {modelos.length === 0 && <p className="an-nota" role="status">Ninguna presa coincide con el filtro.</p>}
        </section>
    );
}
