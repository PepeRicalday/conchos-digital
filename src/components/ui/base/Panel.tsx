import type { ElementType, HTMLAttributes, ReactNode } from 'react';

/** Superficie base. `plano` = nivel 1 (tarjeta); `elevado` = nivel 2 (campo, panel dentro de panel). Sin vidrio ni resplandor. */
export function Panel({ nivel = 'plano', kicker, titulo, acciones, children, as, className, ...resto }: {
    nivel?: 'plano' | 'elevado';
    kicker?: string;
    titulo?: ReactNode;
    acciones?: ReactNode;
    children?: ReactNode;
    as?: ElementType;
    className?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
    const Tag = (as ?? 'section') as ElementType<HTMLAttributes<HTMLElement>>;
    const cab = kicker || titulo || acciones;
    return (
        <Tag className={['ui-panel', nivel === 'elevado' && 'ui-panel--elevado', className].filter(Boolean).join(' ')} {...resto}>
            {cab && (
                <header className="ui-panel__cab">
                    <div>
                        {kicker && <span className="ui-panel__kicker">{kicker}</span>}
                        {titulo && <h3 className="ui-panel__titulo">{titulo}</h3>}
                    </div>
                    {acciones && <div className="ui-panel__acc">{acciones}</div>}
                </header>
            )}
            {children}
        </Tag>
    );
}
