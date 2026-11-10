import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader } from 'lucide-react';

export type BotonVariante = 'primario' | 'secundario' | 'fantasma' | 'peligro';

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variante?: BotonVariante;
    /** md = objetivo táctil de 44 px (iPad/teléfono); sm = 32 px, solo para barras densas con puntero. */
    tamano?: 'sm' | 'md';
    icono?: ReactNode;
    /** Muestra un indicador y bloquea el clic; el botón conserva su ancho. */
    cargando?: boolean;
}

/** Botón base: una sola forma para acciones. El estado no depende solo del color (texto + icono opcional). */
export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
    { variante = 'secundario', tamano = 'md', icono, cargando = false, disabled, className, children, type = 'button', ...resto }, ref,
) {
    const cls = ['ui-btn', `ui-btn--${variante}`, `ui-btn--${tamano}`, className].filter(Boolean).join(' ');
    return (
        <button ref={ref} type={type} className={cls} disabled={disabled || cargando} aria-busy={cargando || undefined} {...resto}>
            {cargando ? <Loader size={16} className="animate-spin" aria-hidden="true" /> : icono}
            {children}
        </button>
    );
});
