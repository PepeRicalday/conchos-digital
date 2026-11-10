import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalA11y } from '../../../hooks/useModalA11y';

export type ModalTamano = 'sm' | 'md' | 'lg' | 'pantalla';

/**
 * Diálogo base: portal a <body>, foco atrapado, Escape, bloqueo del scroll y restauración del foco (useModalA11y),
 * cierre al pulsar el fondo y capa por token (--z-modal). Con `cubreSidebar=false` el fondo deja libre el menú lateral
 * (resuelve en un solo lugar el empalme de overlays con el sidebar en escritorio).
 */
export function Modal({ abierto, onCerrar, titulo, kicker, icono, tamano = 'md', pie, cubreSidebar = true, children }: {
    abierto: boolean; onCerrar: () => void; titulo: string; kicker?: string; /** Logo o icono a la izquierda del título. */ icono?: ReactNode; tamano?: ModalTamano;
    pie?: ReactNode; cubreSidebar?: boolean; children: ReactNode;
}) {
    const ref = useModalA11y<HTMLDivElement>(abierto, onCerrar);
    const idTitulo = useId();
    if (!abierto) return null;
    return createPortal(
        <div
            className={['ui-modal-fondo', !cubreSidebar && 'ui-modal-fondo--sin-menu'].filter(Boolean).join(' ')}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
        >
            <div ref={ref} className={`ui-modal ui-modal--${tamano}`} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
                <header className="ui-modal__cab">
                    <div className="ui-modal__ident">
                        {icono}
                        <div>
                            {kicker && <span className="ui-modal__kicker">{kicker}</span>}
                            <h2 id={idTitulo} className="ui-modal__titulo">{titulo}</h2>
                        </div>
                    </div>
                    <button type="button" className="ui-btn ui-btn--fantasma ui-btn--md ui-modal__x" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                </header>
                <div className="ui-modal__cuerpo">{children}</div>
                {pie && <footer className="ui-modal__pie">{pie}</footer>}
            </div>
        </div>,
        document.body,
    );
}
