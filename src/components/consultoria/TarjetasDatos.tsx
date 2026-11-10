import { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Tarjeta } from '../../hooks/useHydricChat';
import { celda, tablaATsv } from '../../utils/consultoria';
import { copiarTexto } from './copiar';
import { DataTable, type Columna } from '../ui/base';

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
                    <DataTable
                        regionAria={`Tabla: ${t.titulo}`}
                        clave={(f) => String(t.filas.indexOf(f))} filas={t.filas}
                        columnas={t.columnas.map((titulo, c): Columna<typeof t.filas[number]> => ({
                            id: String(c), titulo, encabezadoFila: c === 0, numerica: c > 0,
                            render: (fila) => {
                                const v = fila[c];
                                const texto = celda(v);
                                const sd = texto === 'S/D';
                                if (c === 0) return texto;
                                return (
                                    <span className={sd ? 'ci-sd' : undefined}>
                                        {texto}
                                        {!sd && /%/.test(titulo) && typeof v === 'number' && Number.isFinite(v) && (
                                            <span className="ci-barra" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></span>
                                        )}
                                    </span>
                                );
                            },
                        }))}
                    />
                    {t.nota && <p className="ci-tarjeta-nota">{t.nota}</p>}
                </section>
            ))}
        </div>
    );
});
