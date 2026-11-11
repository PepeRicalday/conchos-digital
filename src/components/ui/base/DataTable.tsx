import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';

export interface Columna<T> {
    id: string;
    titulo: string;
    /** Contenido de la celda. En columnas numéricas, null/undefined/'' se muestra como «S/D» (nunca 0). */
    render: (fila: T) => ReactNode;
    /** Alineada a la derecha, cifras tabulares. */
    numerica?: boolean;
    /** La celda es el encabezado de la fila (th scope="row"); normalmente la primera columna. */
    encabezadoFila?: boolean;
    /** Texto de ayuda al pasar el cursor por la celda. */
    ayuda?: (fila: T) => string | undefined;
    className?: string;
    /** Clase de la cabecera de esta columna. */
    claseTh?: string;
    /** Clase o estilo que dependen de la fila (tono de una cifra, resaltado). */
    claseFila?: (fila: T) => string | undefined;
    estilo?: (fila: T) => CSSProperties | undefined;
}

export type PropsFila = ComponentPropsWithRef<'tr'>;

/**
 * Tabla de datos base: <table> semántica (caption, th scope), cifras tabulares a la derecha, S/D explícito y contenedor
 * con desplazamiento horizontal propio. Las columnas se describen una vez; no hay HTML repetido por celda.
 */
export function DataTable<T>({ columnas, filas, clave, caption, captionOculto, apilar, vacio, filaProps, className, regionAria, cabeceraFija }: {
    columnas: Columna<T>[];
    filas: readonly T[];
    clave: (fila: T) => string;
    caption?: string;
    /** El caption existe para lectores de pantalla pero no se ve (el título ya está en la tarjeta). */
    captionOculto?: boolean;
    /** En pantallas angostas cada fila se apila como tarjeta con la etiqueta de cada columna (data-label). */
    apilar?: boolean;
    /** Texto cuando no hay filas (la tabla no se dibuja). */
    vacio?: string;
    filaProps?: (fila: T) => PropsFila | undefined;
    className?: string;
    /** Hace el contenedor una región enfocable con ese nombre (tablas anchas que se desplazan con teclado). */
    regionAria?: string;
    /** La cabecera queda fija al desplazar el contenedor. */
    cabeceraFija?: boolean;
}) {
    if (filas.length === 0 && vacio) return <p className="ui-tabla__vacio">{vacio}</p>;
    return (
        <div className="ui-tabla-wrap" {...(regionAria ? { tabIndex: 0, role: 'region', 'aria-label': regionAria } : {})}>
            <table className={['ui-tabla', apilar && 'ui-tabla--apila', cabeceraFija && 'ui-tabla--fija', className].filter(Boolean).join(' ')}>
                {caption && <caption className={captionOculto ? 'ui-sr' : undefined}>{caption}</caption>}
                <thead>
                    <tr>{columnas.map((c) => <th key={c.id} scope="col" className={[c.numerica && 'ui-tabla__num', c.claseTh].filter(Boolean).join(' ') || undefined}>{c.titulo}</th>)}</tr>
                </thead>
                <tbody>
                    {filas.map((f) => (
                        <tr key={clave(f)} {...filaProps?.(f)}>
                            {columnas.map((c) => {
                                const v = c.render(f);
                                const sd = c.numerica && (v === null || v === undefined || v === '');
                                const contenido = sd ? <span className="ui-tabla__sd">S/D</span> : v;
                                const cls = [c.numerica && 'ui-tabla__num', c.className, c.claseFila?.(f)].filter(Boolean).join(' ') || undefined;
                                const est = c.estilo?.(f);
                                return c.encabezadoFila
                                    ? <th key={c.id} scope="row" className={cls} style={est} title={c.ayuda?.(f)} data-label={c.titulo}>{contenido}</th>
                                    : <td key={c.id} className={cls} style={est} title={c.ayuda?.(f)} data-label={c.titulo}>{contenido}</td>;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
