import { FAMILIAS, FAMILIA_POR_ID } from '../../../conservacion/estructuras/catalogo';
import { CLAVES_FAMILIA, ROTULO_NINGUNA, type ClaveFamilia } from './ubicacionModelo';
import { Simbolo } from './Simbolo';

interface Props {
    /** Obras de cada familia en todo el canal. */
    conteoCanal: Readonly<Record<ClaveFamilia, number>>;
    /** Obras de cada familia en el tramo (si se pasa, se muestra «en el tramo / en el canal»). */
    conteoTramo?: Readonly<Record<ClaveFamilia, number>>;
    ocultas?: ReadonlySet<ClaveFamilia>;
    /** Con esta función la leyenda es además un filtro por familia. */
    onAlternar?: (c: ClaveFamilia) => void;
    etiqueta?: string;
}

const nombre = (c: ClaveFamilia): string => (c === 'ninguna' ? ROTULO_NINGUNA : FAMILIA_POR_ID[c].nombre);
const descripcion = (c: ClaveFamilia): string => (c === 'ninguna' ? 'Nombres del inventario que ninguna regla del catálogo reconoce; no se reparten entre las familias.' : FAMILIAS.find((f) => f.id === c)?.descripcion ?? '');

/** Leyenda de familias con su forma y su conteo; cuando recibe `onAlternar` también filtra qué familias se ven. */
export function Leyenda({ conteoCanal, conteoTramo, ocultas, onAlternar, etiqueta = 'Familias de estructuras' }: Props) {
    const claves = CLAVES_FAMILIA.filter((c) => conteoCanal[c] > 0);
    if (claves.length === 0) return null;
    return (
        <ul className="cons-leyfam" aria-label={etiqueta}>
            {claves.map((c) => {
                const oculta = ocultas?.has(c) ?? false;
                const cuenta = conteoTramo ? <><b>{conteoTramo[c]}</b><span> de {conteoCanal[c]}</span></> : <b>{conteoCanal[c]}</b>;
                const cuerpo = (
                    <>
                        <Simbolo clave={c} tamano={20} />
                        <span className="cons-leyfam-n">{nombre(c)}</span>
                        <span className="cons-leyfam-c">{cuenta}</span>
                    </>
                );
                return (
                    <li key={c}>
                        {onAlternar
                            ? <button type="button" className="cons-leyfam-it" aria-pressed={!oculta} title={descripcion(c)} onClick={() => onAlternar(c)}>{cuerpo}</button>
                            : <span className="cons-leyfam-it" title={descripcion(c)}>{cuerpo}</span>}
                    </li>
                );
            })}
        </ul>
    );
}
