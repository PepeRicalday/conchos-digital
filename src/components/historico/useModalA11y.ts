import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accesibilidad de modal: foco inicial dentro, Tab atrapado, Escape llama a `onEscape`,
 * bloqueo del scroll del fondo y restauración del foco al cerrar. `activo=false` suspende todo.
 */
export function useModalA11y(ref: RefObject<HTMLElement | null>, activo: boolean, onEscape: () => void) {
    const escRef = useRef(onEscape);
    useEffect(() => { escRef.current = onEscape; });

    useEffect(() => {
        if (!activo) return;
        const previo = document.activeElement as HTMLElement | null;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const nodos = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(n => n.offsetParent !== null || n === document.activeElement);
        const t = window.setTimeout(() => { if (!ref.current?.contains(document.activeElement)) (nodos()[0] ?? ref.current)?.focus(); }, 0);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); escRef.current(); return; }
            if (e.key !== 'Tab') return;
            const n = nodos();
            if (!n.length) { e.preventDefault(); return; }
            const primero = n[0], ultimo = n[n.length - 1];
            const dentro = ref.current?.contains(document.activeElement);
            if (e.shiftKey && (document.activeElement === primero || !dentro)) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && (document.activeElement === ultimo || !dentro)) { e.preventDefault(); primero.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            window.clearTimeout(t);
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = overflow;
            previo?.focus?.();
        };
    }, [activo, ref]);
}
