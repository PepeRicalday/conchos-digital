import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { anchoTanque } from '../../../utils/cuencaViz';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import TanquePresa from './TanquePresa';
import TarjetaPresaMovil from './TarjetaPresaMovil';

interface Props {
    modelos: PresaCuencaModelo[];
    seleccionada: number | null;
    onSelect: (ubicacionId: number) => void;
}

/** Un tanque con su texto necesita al menos MIN_BOTON px; hasta MAX_MIN_BOTON si hay holgura. Si no caben todos en una fila: lista. */
const MIN_BOTON = 84;
const MAX_MIN_BOTON = 104;
const SEPARACION = 12;

/**
 * Los tanques de las presas, lado a lado: el ancho de cada uno es su capacidad (∝ √NAMO). Se escala para que quepan en el
 * contenedor (medido con ResizeObserver). Flechas izquierda/derecha mueven el foco; Enter/Espacio seleccionan.
 */
export default function FilaTanques({ modelos, seleccionada, onSelect }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(1000);

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const maxNamo = useMemo(() => Math.max(0, ...modelos.map((m) => m.fila.namoMm3 ?? 0)), [modelos]);
    const n = modelos.length;
    const huecos = SEPARACION * Math.max(0, n - 1);
    const lista = n > 0 && ancho < n * MIN_BOTON + huecos;

    // Se busca el mayor factor de escala (0.3-1) con el que la fila entera cabe: cada botón mide max(ancho del tanque, minBoton).
    const { anchos, minBoton } = useMemo(() => {
        const minBoton = n > 0 ? Math.max(MIN_BOTON, Math.min(MAX_MIN_BOTON, Math.floor((ancho - huecos) / n))) : MAX_MIN_BOTON;
        const base = modelos.map((m) => anchoTanque(m.fila.namoMm3, maxNamo));
        const ancho_i = (factor: number) => base.map((w) => Math.max(44, Math.round(w * factor)));
        const total = (factor: number) => ancho_i(factor).reduce((a, w) => a + Math.max(w, minBoton), 0) + huecos;
        let lo = 0.3, hi = 1;
        if (total(1) <= ancho) lo = 1;
        else for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (total(mid) <= ancho) lo = mid; else hi = mid; }
        return { anchos: ancho_i(lo), minBoton };
    }, [modelos, maxNamo, ancho, n, huecos]);

    const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const botones = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button.cu-tanque') ?? [])];
        const i = botones.findIndex((b) => b === document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        botones[(i + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length]?.focus();
    };

    return (
        <div ref={ref} className="cu-tanques-wrap" onKeyDown={teclas}>
            {modelos.length === 0
                ? <p className="an-nota" role="status">Ninguna presa coincide con el filtro.</p>
                : lista
                    ? (
                        <ul className="cu-lista-movil" aria-label="Presas de la cuenca">
                            {modelos.map((m) => (
                                <TarjetaPresaMovil key={m.fila.ubicacionId} m={m} seleccionada={seleccionada === m.fila.ubicacionId} onSelect={onSelect}
                                    carril={maxNamo > 0 && m.fila.namoMm3 ? 0.4 + 0.6 * Math.sqrt(Math.min(1, m.fila.namoMm3 / maxNamo)) : 0.4} />
                            ))}
                        </ul>
                    )
                    : (
                        <div className="cu-tanques" role="group" aria-label="Presas de la cuenca: ancho proporcional a la raíz cuadrada de la capacidad">
                            {modelos.map((m, i) => (
                                <TanquePresa key={m.fila.ubicacionId} m={m} ancho={anchos[i]} anchoBoton={Math.max(anchos[i], minBoton)} seleccionada={seleccionada === m.fila.ubicacionId} onSelect={onSelect} />
                            ))}
                        </div>
                    )}
            {!lista && modelos.length > 0 && (
                <p className="cu-leyenda-viz">
                    Ancho ∝ √capacidad (NAMO CONAGUA) · relleno = % del NAMO · líneas discontinuas = 20 % y 40 % · línea punteada azul = volumen muerto · trama = lectura sin actualizar
                </p>
            )}
        </div>
    );
}
