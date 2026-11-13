/** Control segmentado con etiqueta (vista, orden, alcance…) de la Cuenca. */
export default function Segmentado<T extends string | number>({ etiqueta, valor, opciones, onChange }: {
    etiqueta: string; valor: T; opciones: { v: T; t: string }[]; onChange: (v: T) => void;
}) {
    return (
        <div className="cu-ctl">
            <span className="cu-ctl-etq" id={`cu-ctl-${etiqueta}`}>{etiqueta}</span>
            <div className="an-seg" role="group" aria-labelledby={`cu-ctl-${etiqueta}`}>
                {opciones.map((o) => (
                    <button key={String(o.v)} type="button" className="an-seg-btn" aria-pressed={valor === o.v} onClick={() => onChange(o.v)}>{o.t}</button>
                ))}
            </div>
        </div>
    );
}
