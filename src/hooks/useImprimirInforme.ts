import { useCallback, useState, type RefObject } from 'react';
import { imprimirOPdf } from '../utils/imprimirInforme';

/**
 * Acción "Imprimir / PDF" de las vistas previas en iframe: diálogo de impresión en escritorio y PDF por Compartir en
 * iOS/iPadOS (donde imprimir un iframe no funciona). `error` se muestra junto a la barra; `generando` bloquea el botón.
 */
export function useImprimirInforme(html: string | null, frame: RefObject<HTMLIFrameElement | null>, nombre: string) {
    const [generando, setGenerando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const imprimir = useCallback(async () => {
        setGenerando(true); setError(null);
        try { await imprimirOPdf({ html, frame: frame.current, nombre }); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el PDF.'); }
        finally { setGenerando(false); }
    }, [html, frame, nombre]);
    return { imprimir, generando, errorPdf: error };
}
