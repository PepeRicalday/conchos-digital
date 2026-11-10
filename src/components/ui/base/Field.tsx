import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';

/** Campo etiquetado: etiqueta visible, ayuda y error asociados al control por id (aria-describedby). */
export function Campo({ etiqueta, ayuda, error, children }: {
    etiqueta: string; ayuda?: string; error?: string;
    /** Recibe los atributos de accesibilidad que debe poner en el control. */
    children: (a: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
    const id = useId();
    const nota = error ?? ayuda;
    return (
        <div className="ui-field">
            <label className="ui-field__etq" htmlFor={id}>{etiqueta}</label>
            {children({ id, 'aria-describedby': nota ? `${id}-n` : undefined, 'aria-invalid': error ? true : undefined })}
            {nota && <small id={`${id}-n`} className={error ? 'ui-field__nota ui-field__nota--error' : 'ui-field__nota'} role={error ? 'alert' : undefined}>{nota}</small>}
        </div>
    );
}

/** Select con opciones de fondo opaco: el popup nativo no pinta opciones translúcidas ilegibles sobre blanco. */
export function Selector({ className, children, ...resto }: SelectHTMLAttributes<HTMLSelectElement>) {
    return <select className={['ui-select', className].filter(Boolean).join(' ')} {...resto}>{children}</select>;
}
