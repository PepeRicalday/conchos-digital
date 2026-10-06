import { memo, type ReactNode } from 'react';
import type { EstadoVisual } from '../../utils/eficienciaCanal';

interface Props {
    etiqueta: string;
    icono?: ReactNode;
    /** Valor ya formateado; null = "S/D". */
    valor: string | null;
    unidad?: string;
    /** Líneas de contexto (fuente, cobertura, comparación). */
    lineas?: ReactNode[];
    /** Pie con procedencia/antigüedad del dato. */
    frescura?: string | null;
    frescuraVieja?: boolean;
    /** Color de acento superior (clase `sc-tile-*` o variable --acc). */
    acento?: string;
    /** Estado textual junto al valor (nunca solo color). */
    estado?: { texto: string; tipo: EstadoVisual } | null;
    aria?: string;
}

const ESTADO_CLASE: Record<EstadoVisual, string> = { ok: 'sc-estado-ok', warn: 'sc-estado-warn', crit: 'sc-estado-crit', sd: 'sc-estado-sd', info: 'sc-estado-info' };

/** Tarjeta de cifra grande con su procedencia y antigüedad. Estática (sin enlace); el Dashboard usa su propio Tile enlazado. */
export const TileCifra = memo(function TileCifra({ etiqueta, icono, valor, unidad, lineas, frescura, frescuraVieja, acento, estado, aria }: Props) {
    return (
        <article className="sc-tile sc-tile-estatico" style={acento ? ({ '--acc': acento } as React.CSSProperties) : undefined} aria-label={aria ?? etiqueta}>
            <div className="sc-tile-cab"><span className="sc-kicker">{etiqueta}</span>{icono}</div>
            {valor == null
                ? <div className="sc-num sc-num-sd" aria-label="Sin dato">S/D</div>
                : <div className="sc-num">{valor}{unidad && <small>{unidad}</small>}</div>}
            {estado && <span className={`sc-estado ${ESTADO_CLASE[estado.tipo]}`}>{estado.texto}</span>}
            {lineas && lineas.length > 0 && <ul className="sc-lineas">{lineas.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            {frescura && <span className={`sc-fresco ${frescuraVieja ? 'sc-viejo' : ''}`}>{frescura}</span>}
        </article>
    );
});
