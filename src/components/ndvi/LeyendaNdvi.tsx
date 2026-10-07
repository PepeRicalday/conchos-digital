import { CLASES_NDVI } from '../../utils/ndviRampa';

const rango = (d: number, h: number) => (d === -Infinity ? `< ${h.toFixed(2)}` : h === Infinity ? `≥ ${d.toFixed(2)}` : `${d.toFixed(2)}–${h.toFixed(2)}`);

/** Leyenda de la rampa agronómica: siempre texto + rango + muestra (el color nunca es el único canal). */
export function LeyendaNdvi({ nota }: { nota?: string }) {
    return (
        <div className="ndvi-ley" role="group" aria-label="Leyenda de vigor vegetativo (NDVI)">
            <ul className="ndvi-ley-lista">
                {CLASES_NDVI.map((c) => (
                    <li key={c.clave} title={c.significado}>
                        <i style={{ background: c.color }} aria-hidden="true" />
                        <b>{c.etiqueta}</b> <span>{rango(c.desde, c.hasta)}</span>
                    </li>
                ))}
            </ul>
            {nota && <p className="ndvi-ley-nota">{nota}</p>}
        </div>
    );
}
