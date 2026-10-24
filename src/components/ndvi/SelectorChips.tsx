import { useId, useRef, type KeyboardEvent } from 'react';

/** Selector por chips (radiogroup): reemplaza al <select> nativo, cuyo desplegable se dibuja encima del contenido y lo tapa.
 *  Teclado de radiogroup: una sola parada de Tab (el elegido) y flechas / Inicio / Fin para moverse y elegir. */
interface Opcion<T extends string> { valor: T; texto: string; title?: string; /** Nombre accesible si el texto visible es corto ("Mar" → "marzo 2026"). */ aria?: string }

interface Props<T extends string> {
    etiqueta: string;
    valor: T;
    opciones: Opcion<T>[];
    onChange: (v: T) => void;
}

export function SelectorChips<T extends string>({ etiqueta, valor, opciones, onChange }: Props<T>) {
    const id = useId();
    const grupo = useRef<HTMLDivElement>(null);
    const hayElegido = opciones.some((o) => o.valor === valor);

    const mover = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
        const n = opciones.length;
        let j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j < 0) return;
        e.preventDefault();
        onChange(opciones[j].valor);
        window.requestAnimationFrame(() => grupo.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[j]?.focus());
    };

    return (
        <div className="ndvi-selector">
            <span className="ndvi-selector-et" id={`sel-${id}`}>{etiqueta}</span>
            <div className="ndvi-chips" role="radiogroup" aria-labelledby={`sel-${id}`} ref={grupo}>
                {opciones.map((o, i) => {
                    const on = valor === o.valor;
                    return (
                        <button key={o.valor} type="button" role="radio" aria-checked={on} title={o.title} aria-label={o.aria}
                            tabIndex={on || (!hayElegido && i === 0) ? 0 : -1} onKeyDown={(e) => mover(e, i)}
                            className={`ndvi-chip ${on ? 'ndvi-chip-on' : ''}`} onClick={() => onChange(o.valor)}>
                            {o.texto}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
