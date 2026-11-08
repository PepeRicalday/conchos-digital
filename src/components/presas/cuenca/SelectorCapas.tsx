import { CAPAS_INFO, type CapaId } from '../../../utils/capasCuenca';
import { useDevice } from '../../../hooks/useDevice';

interface Props {
    ids: CapaId[];
    onAlternar: (id: CapaId) => void;
    onTodas: () => void;
    onNinguna: () => void;
    /** Id único del grupo (hay más de uno en la página). */
    nombre?: string;
}

/**
 * Filtro de capas de referencia (municipios, ríos, presas…): chips que se activan o no según la necesidad. aria-pressed (el estado no va solo en
 * color: el chip activo lleva ✓), objetivos táctiles ≥ 44 px en iPhone, y en iPhone queda plegado para no empujar el plano.
 */
export default function SelectorCapas({ ids, onAlternar, onTodas, onNinguna, nombre = 'capas' }: Props) {
    const dev = useDevice();
    const cuerpo = (
        <div className="cu-capas-chips" role="group" aria-label="Capas de referencia del mapa">
            {CAPAS_INFO.map((c) => {
                const on = ids.includes(c.id);
                return (
                    <button key={c.id} type="button" className="cu-capa-chip" aria-pressed={on} title={c.ayuda} onClick={() => onAlternar(c.id)}>
                        <span aria-hidden="true">{on ? '✓' : '+'}</span> {c.titulo}
                    </button>
                );
            })}
            <button type="button" className="cu-capa-chip cu-capa-chip--accion" onClick={onTodas}>Todas</button>
            <button type="button" className="cu-capa-chip cu-capa-chip--accion" onClick={onNinguna}>Ninguna</button>
        </div>
    );
    if (dev.esPhone) {
        return (
            <details className="cu-capas cu-capas--plegable" data-nombre={nombre}>
                <summary className="cu-capas-sum">Capas del mapa ({ids.length} activas)</summary>
                {cuerpo}
            </details>
        );
    }
    return (
        <div className="cu-capas" data-nombre={nombre}>
            <span className="cu-ctl-etq">Capas de referencia</span>
            {cuerpo}
        </div>
    );
}
