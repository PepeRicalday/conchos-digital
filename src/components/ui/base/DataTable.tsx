import type { ComponentPropsWithRef, ReactNode } from 'react';

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
}

export type PropsFila = ComponentPropsWithRef<'tr'>;

/**
 * Tabla de datos base: <table> semántica (caption, th scope), cifras tabulares a la derecha, S/D explícito y contenedor
 * con desplazamiento horizontal propio. Las columnas se describen una vez; no hay HTML repetido por celda.
 */
export function DataTable<T>({ columnas, filas, clave, caption, vacio, filaProps, className, regionAria }: {
    columnas: Columna<T>[];
    filas: T[];
    clave: (fila: T) => string;
    caption?: string;
    /** Texto cuando no hay filas (la tabla no se dibuja). */
    vacio?: string;
    filaProps?: (fila: T) => PropsFila | undefined;
    className?: string;
    /** Hace el contenedor una región enfocable con ese nombre (tablas anchas que se desplazan con teclado). */
    regionAria?: string;
}) {
    if (filas.length === 0 && vacio) return <p className="ui-tabla__vacio">{vacio}</p>;
    return (
        <div className="ui-tabla-wrap" {...(regionAria ? { tabIndex: 0, role: 'region', 'aria-label': regionAria } : {})}>
            <table className={['ui-tabla', className].filter(Boolean).join(' ')}>
                {caption && <caption>{caption}</caption>}
                <thead>
                    <tr>{columnas.map((c) => <th key={c.id} scope="col" className={c.numerica ? 'ui-tabla__num' : undefined}>{c.titulo}</th>)}</tr>
                </thead>
                <tbody>
                    {filas.map((f) => (
                        <tr key={clave(f)} {...filaProps?.(f)}>
                            {columnas.map((c) => {
                                const v = c.render(f);
                                const sd = c.numerica && (v === null || v === undefined || v === '');
                                const contenido = sd ? <span className="ui-tabla__sd">S/D</span> : v;
                                const cls = [c.numerica && 'ui-tabla__num', c.className].filter(Boolean).join(' ') || undefined;
                                return c.encabezadoFila
                                    ? <th key={c.id} scope="row" className={cls} title={c.ayuda?.(f)}>{contenido}</th>
                                    : <td key={c.id} className={cls} title={c.ayuda?.(f)}>{contenido}</td>;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
