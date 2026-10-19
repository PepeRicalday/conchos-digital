import { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Tarjeta } from '../../hooks/useHydricChat';
import { celda, tablaATsv } from '../../utils/consultoria';
import { copiarTexto } from './copiar';

/** Tablas estructuradas calculadas por el servidor (presas, escalas, balance…). Dato ausente = "S/D", nunca 0 ni vacío. */
export const TarjetasDatos = memo(function TarjetasDatos({ tarjetas }: { tarjetas: Tarjeta[] }) {
    const [copiada, setCopiada] = useState<number | null>(null);
    if (tarjetas.length === 0) return null;

    const copiar = async (i: number, t: Tarjeta) => {
        if (await copiarTexto(tablaATsv(t))) { setCopiada(i); window.setTimeout(() => setCopiada((c) => (c === i ? null : c)), 1800); }
    };

    return (
        <div className="ci-tarjetas">
            {tarjetas.map((t, i) => (
                <section key={`${t.kind}-${i}`} className="ci-tarjeta" aria-label={t.titulo}>
                    <div className="ci-tarjeta-cab">
                        <h4>{t.titulo}</h4>
                        <button type="button" className="ci-accion" onClick={() => copiar(i, t)} aria-label={`Copiar la tabla ${t.titulo}`}>
                            {copiada === i ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                            {copiada === i ? 'Copiada' : 'Copiar tabla'}
                        </button>
                    </div>
                    <div className="sc-tabla-wrap" tabIndex={0} role="region" aria-label={`Tabla: ${t.titulo}`}>
                        <table className="sc-tabla">
                            <thead><tr>{t.columnas.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                            <tbody>
                                {t.filas.map((fila, r) => (
                                    <tr key={r}>
                                        {fila.map((v, c) => {
                                            const texto = celda(v);
                                            const sd = texto === 'S/D';
                                            return c === 0
                                                ? <th key={c} scope="row">{texto}</th>
                                                : <td key={c} className={sd ? 'ci-sd' : undefined}>
                                                    {texto}
                                                    {!sd && /%/.test(t.columnas[c] ?? '') && typeof v === 'number' && Number.isFinite(v) && (
                                                        <span className="ci-barra" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></span>
                                                    )}
                                                </td>;
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {t.nota && <p className="ci-tarjeta-nota">{t.nota}</p>}
                </section>
            ))}
        </div>
    );
});
