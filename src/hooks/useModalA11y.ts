import { useEffect, useRef } from 'react';

const FOCUSABLES = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accesibilidad de un diálogo modal: foco inicial dentro, foco atrapado con Tab, cierre con Escape y
 * restauración del foco al elemento que lo abrió. Uso: `const ref = useModalA11y(abierto, cerrar)` y
 * `<div ref={ref} role="dialog" aria-modal="true" aria-labelledby="…">`.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(abierto: boolean, onCerrar: () => void) {
    const ref = useRef<T>(null);
    const previo = useRef<HTMLElement | null>(null);
    // Siempre la última versión de onCerrar sin reinstalar los listeners en cada render.
    const cerrarRef = useRef(onCerrar);
    useEffect(() => { cerrarRef.current = onCerrar; });

    useEffect(() => {
        if (!abierto) return;
        previo.current = document.activeElement as HTMLElement | null;
        const nodo = ref.current;
        const enfocables = () => (nodo ? Array.from(nodo.querySelectorAll<HTMLElement>(FOCUSABLES)).filter((e) => e.offsetParent !== null) : []);
        (enfocables()[0] ?? nodo)?.focus();

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); cerrarRef.current(); return; }
            if (e.key !== 'Tab') return;
            const lista = enfocables();
            if (lista.length === 0) { e.preventDefault(); return; }
            const primero = lista[0], ultimo = lista[lista.length - 1];
            if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            previo.current?.focus?.();
        };
    }, [abierto]);

    return ref;
}
