import { useState } from 'react';
import { Layers as LayersIcon, ChevronDown } from 'lucide-react';
import './GeoLeyenda.css';

export interface CapaLeyenda {
    key: string;
    etiqueta: string;
    /** Qué dibuja la capa en el mapa. */
    detalle: string;
    /** Forma + color del símbolo: la leyenda no depende solo del color (forma y texto la acompañan). */
    simbolo: 'linea' | 'punto' | 'poligono' | 'rombo';
    color: string;
    /** Elementos de la capa; null = no aplica / sin dato (se muestra "—", nunca 0). */
    conteo: number | null;
    nota?: string;
}

interface Props {
    capas: CapaLeyenda[];
    activas: Record<string, boolean>;
    onAlternar: (key: string) => void;
}

/** Panel de capas con leyenda y conteos: qué se ve en el mapa, cuántos elementos hay y cómo activarlo. */
export function GeoLeyenda({ capas, activas, onAlternar }: Props) {
    const [abierto, setAbierto] = useState(false);
    const activasN = capas.filter((c) => activas[c.key]).length;
    return (
        <div className="geo-ley" data-abierto={abierto}>
            <button type="button" className="geo-ley-cab" onClick={() => setAbierto((v) => !v)}
                aria-expanded={abierto} aria-controls="geo-ley-lista">
                <LayersIcon size={16} aria-hidden="true" />
                <span>Capas y leyenda</span>
                <b>{activasN}/{capas.length}</b>
                <ChevronDown size={16} aria-hidden="true" className="geo-ley-chev" />
            </button>
            {abierto && (
                <ul id="geo-ley-lista" className="geo-ley-lista">
                    {capas.map((c) => {
                        const on = !!activas[c.key];
                        return (
                            <li key={c.key}>
                                <button type="button" className={`geo-ley-fila ${on ? 'on' : ''}`} role="switch" aria-checked={on}
                                    onClick={() => onAlternar(c.key)}>
                                    <span className={`geo-ley-sim geo-ley-${c.simbolo}`} style={{ '--c': c.color } as React.CSSProperties} aria-hidden="true" />
                                    <span className="geo-ley-txt">
                                        <span className="geo-ley-nom">{c.etiqueta}</span>
                                        <span className="geo-ley-det">{c.nota ?? c.detalle}</span>
                                    </span>
                                    <span className="geo-ley-n">{c.conteo ?? '—'}</span>
                                    <span className="geo-ley-estado">{on ? 'Visible' : 'Oculta'}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
