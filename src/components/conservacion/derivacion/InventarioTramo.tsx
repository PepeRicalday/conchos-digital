import { MapPin } from 'lucide-react';
import { FAMILIA_POR_ID } from '../../../conservacion/estructuras/catalogo';
import { ROTULO_NINGUNA, TEXTO_POSICION_ESTIMADA, conteoPorClave, etiquetaPk, obrasEnTramo, type ClaveFamilia, type EjeVista, type ModeloCanal, type ObraVista, type TramoVista } from './ubicacionModelo';
import { Leyenda } from './Leyenda';
import { Simbolo } from './Simbolo';

interface Props {
    modelo: ModeloCanal;
    eje: EjeVista;
    tramo: TramoVista;
    ocultas?: ReadonlySet<ClaveFamilia>;
    onAlternar?: (c: ClaveFamilia) => void;
    /** Si se da, cada fila lleva un botón «Ver ubicación» de esa obra. */
    onVer?: (obraId: string) => void;
    obraSel?: string | null;
    /** En la ficha va plegado; en la ventana de ubicación, abierto. */
    abierto?: boolean;
    titulo?: string;
}

const nombreFamilia = (c: ClaveFamilia): string => (c === 'ninguna' ? ROTULO_NINGUNA : FAMILIA_POR_ID[c].nombre);

/** Marca de la ubicación de una obra: lo declarado no lleva marca; lo estimado y lo no ubicado se dicen. */
export function MarcaUbicacion({ o }: { o: Pick<ObraVista, 'estado'> }) {
    if (o.estado === 'valida') return null;
    return <span className={`cons-ubic-marca cons-ubic-marca-${o.estado}`} title={o.estado === 'estimada' ? TEXTO_POSICION_ESTIMADA : undefined}>{o.estado === 'estimada' ? 'posición estimada' : 'sin ubicar'}</span>;
}

/** Inventario del tramo: las obras cuyo cadenamiento cae en él, con su símbolo, tipo, familia, PK y estado de ubicación. */
export function InventarioTramo({ modelo, eje, tramo, ocultas, onAlternar, onVer, obraSel, abierto = false, titulo = 'Inventario del tramo' }: Props) {
    const obras = obrasEnTramo(eje, tramo);
    const conteoTramo = conteoPorClave(obras);
    const lista = obras.filter((o) => !(ocultas?.has(o.clave) ?? false));
    return (
        <details className="cons-inv" open={abierto || undefined}>
            <summary>{titulo} <small>{obras.length === 0 ? 'sin obras en el cadenamiento de este tramo' : `${obras.length} ${obras.length === 1 ? 'obra' : 'obras'}`}</small></summary>
            {obras.length > 0 && (
                <>
                    <Leyenda conteoCanal={modelo.conteoCanal} conteoTramo={conteoTramo} ocultas={ocultas} onAlternar={onAlternar} etiqueta="Familias del tramo y del canal" />
                    {lista.length === 0 ? <p className="sc-vacio">Todas las familias de este tramo están ocultas por el filtro.</p> : (
                        <ul className="cons-inv-lista" aria-label="Obras del tramo en orden de cadenamiento">
                            {lista.map((o) => (
                                <li key={o.id} className={o.id === obraSel ? 'cons-inv-sel' : undefined}>
                                    <Simbolo clave={o.clave} tamano={22} punteado={o.estado === 'estimada'} />
                                    <span className="cons-inv-txt">
                                        <b>{o.tipoNombre}{o.ambiguo ? <em> · tipo ambiguo</em> : null}</b>
                                        <small>{nombreFamilia(o.clave)} · {o.nombre}</small>
                                    </span>
                                    <span className="cons-inv-pk"><code>{etiquetaPk(o.pk)}</code>{o.margen ? <small>margen {o.margen === 'I' ? 'izq.' : 'der.'}</small> : null}</span>
                                    <MarcaUbicacion o={o} />
                                    {onVer && (
                                        <button type="button" className="sc-btn cons-inv-ver" onClick={() => onVer(o.id)} aria-label={`Ver la ubicación de ${o.tipoNombre} en ${etiquetaPk(o.pk)}`}>
                                            <MapPin size={16} aria-hidden="true" /> <span>Ver</span>
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </details>
    );
}
