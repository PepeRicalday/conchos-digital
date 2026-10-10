import type { DiagramaComp } from '../../../conservacion/verificacion/comprobacion';
import { PALETA_APP, seccionCanalSvg } from './seccionCanalSvg';
import { seccionCaminoSvg } from './seccionCaminoSvg';

/**
 * Sección tipo de lo que el concepto toca. Despacha por familia: canal (sección trapecial) o camino (sección de calzada).
 * Solo las dimensiones del inventario salen del libro; el terreno, las bermas y las cunetas son ilustrativos. Colores por origen del dato.
 */
export function SeccionCanal({ d }: { d: DiagramaComp }) {
    const esCamino = d.familia === 'camino';
    const svg = esCamino ? seccionCaminoSvg(d, PALETA_APP) : seccionCanalSvg(d, PALETA_APP);
    if (svg === null) {
        return <p className="sc-vacio">{esCamino
            ? 'Falta el ancho de la carpeta en el inventario (IO3): S/D, no se puede dibujar.'
            : 'Faltan datos de la sección en el inventario (plantilla, talud, tirante o libre bordo): no se puede dibujar.'}</p>;
    }
    // El SVG se arma solo con números del inventario y rótulos escapados: no entra texto libre.
    return <figure className="cons-seccion" dangerouslySetInnerHTML={{ __html: svg }} />;
}
