/** Selector por chips (radiogroup): reemplaza al <select> nativo, cuyo desplegable se dibuja encima del contenido y lo tapa. */
interface Opcion<T extends string> { valor: T; texto: string; title?: string }

interface Props<T extends string> {
    etiqueta: string;
    valor: T;
    opciones: Opcion<T>[];
    onChange: (v: T) => void;
}

export function SelectorChips<T extends string>({ etiqueta, valor, opciones, onChange }: Props<T>) {
    return (
        <div className="ndvi-selector">
            <span className="ndvi-selector-et" id={`sel-${etiqueta}`}>{etiqueta}</span>
            <div className="ndvi-chips" role="radiogroup" aria-labelledby={`sel-${etiqueta}`}>
                {opciones.map((o) => (
                    <button key={o.valor} type="button" role="radio" aria-checked={valor === o.valor} title={o.title}
                        className={`ndvi-chip ${valor === o.valor ? 'ndvi-chip-on' : ''}`} onClick={() => onChange(o.valor)}>
                        {o.texto}
                    </button>
                ))}
            </div>
        </div>
    );
}
