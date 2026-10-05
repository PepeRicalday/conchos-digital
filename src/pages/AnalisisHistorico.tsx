import { useCallback, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { usePresasHistorico } from '../hooks/usePresasHistorico';
import PanelPresaHistorico from '../components/historico/PanelPresaHistorico';
import {
    diasDelMes, etiquetaMetrica, formatearNumero, MESES_LARGO, NOMBRE_PRESA, serieMes,
    type Metrica, type TipoSerie,
} from '../utils/historicoPresas';
import './AnalisisHistorico.css';

const PRESAS = ['PRE-001', 'PRE-002'] as const;
const MAX_ANIOS = 3;
const ESTILOS_CHIP = ['#3987e5', '#d95926', '#199e70'];

const METRICAS: { v: Metrica; l: string }[] = [
    { v: 'volumen', l: 'Volumen' },
    { v: 'elevacion', l: 'Elevación' },
    { v: 'llenado', l: 'Llenado %' },
];

function Segmentado<T extends string>({ valor, opciones, onCambio, etiqueta }: { valor: T; opciones: { v: T; l: string }[]; onCambio: (v: T) => void; etiqueta: string }) {
    return (
        <div className="ah-grupo">
            <span className="ah-etq">{etiqueta}</span>
            <div className="ah-seg" role="radiogroup" aria-label={etiqueta}>
                {opciones.map(o => (
                    <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} className={valor === o.v ? 'is-on' : ''} onClick={() => onCambio(o.v)}>{o.l}</button>
                ))}
            </div>
        </div>
    );
}

const AnalisisHistorico = () => {
    const { indice, anios, totalDias, loading, error, recargar } = usePresasHistorico();
    const [mes, setMes] = useState(() => new Date().getMonth() + 1);
    const [aniosSel, setAniosSel] = useState<number[] | null>(null);
    const [vista, setVista] = useState<'mes' | 'anio'>('mes');
    const [metrica, setMetrica] = useState<Metrica>('volumen');
    const [serie, setSerie] = useState<TipoSerie>('normalizada');

    // Años elegidos: del más reciente (base) al más antiguo. Por defecto, los tres más recientes con registro.
    const seleccion = useMemo(
        () => (aniosSel ?? anios.slice(0, MAX_ANIOS)).filter(a => anios.includes(a)).sort((a, b) => b - a).slice(0, MAX_ANIOS),
        [aniosSel, anios],
    );

    const agregarAnio = useCallback((a: number) => {
        const s = new Set(seleccion);
        if (!s.has(a) && s.size >= MAX_ANIOS) s.delete([...s].sort((x, y) => y - x).at(-1)!); // sale el más antiguo
        s.add(a);
        setAniosSel([...s].sort((x, y) => y - x));
    }, [seleccion]);

    const alternarAnio = (a: number) => {
        if (seleccion.includes(a)) {
            if (seleccion.length > 1) setAniosSel(seleccion.filter(x => x !== a));
        } else agregarAnio(a);
    };

    const desdeMatriz = (a: number, m: number) => { setMes(m); if (!seleccion.includes(a)) agregarAnio(a); };

    const { unidad, decimales, nombre: nombreMetrica } = etiquetaMetrica(metrica);
    const mesNombre = MESES_LARGO[mes - 1];
    const base = seleccion[0];

    const descargarCsv = () => {
        const n = diasDelMes(base ?? 2000, mes);
        const cab = ['Día', ...PRESAS.flatMap(p => seleccion.map(a => `${NOMBRE_PRESA[p]} ${a} (${unidad})`))];
        const cols = PRESAS.flatMap(p => seleccion.map(a => serieMes(indice[p], a, mes, metrica, serie)));
        const filas = Array.from({ length: n }, (_, i) => [String(i + 1), ...cols.map(c => (c[i] == null ? '' : String(c[i])))]);
        const csv = '﻿' + [cab, ...filas].map(r => r.map(x => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `historico_presas_${mesNombre.toLowerCase()}_${metrica}_${serie}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const rango = anios.length ? `${anios[anios.length - 1]} – ${anios[0]}` : '';

    return (
        <div className="ah-root">
            <header className="ah-hero">
                <div>
                    <span className="ah-kicker">Archivo hidrológico{rango && ` · ${rango}`}</span>
                    <h1 className="ah-title">Análisis histórico</h1>
                    <p className="ah-lede">
                        {loading ? 'Cargando el archivo de lecturas…'
                            : anios.length ? <>La Boquilla y Fco. I. Madero a lo largo de {anios.length} años: <b>{totalDias.toLocaleString('es-MX')}</b> días con registro, del reporte mensual de la SRL a la ingesta diaria de CILA.</>
                            : 'Aún no hay lecturas en el archivo.'}
                    </p>
                </div>
                <img className="ah-logo" src="/logos/SICA005.png" alt="SICA 005" />
            </header>

            <section className="ah-controles" aria-label="Controles de comparación">
                <div className="ah-grupo">
                    <span className="ah-etq">Mes alineado</span>
                    <select className="ah-select" value={mes} onChange={e => setMes(Number(e.target.value))} aria-label="Mes alineado">
                        {MESES_LARGO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                </div>

                <div className="ah-grupo ah-grupo--anios">
                    <span className="ah-etq">Años a comparar <em>(hasta {MAX_ANIOS}; el más reciente es la base)</em></span>
                    <div className="ah-anios" role="group" aria-label="Años a comparar">
                        {anios.map(a => {
                            const i = seleccion.indexOf(a);
                            const on = i >= 0;
                            return (
                                <button key={a} type="button" aria-pressed={on} className={`ah-anio${on ? ' is-on' : ''}`} onClick={() => alternarAnio(a)}
                                    style={on ? { ['--c' as string]: ESTILOS_CHIP[i] } : undefined}>
                                    {on && <i aria-hidden="true" />}{a}{on && i === 0 && <small>base</small>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <Segmentado etiqueta="Métrica" valor={metrica} opciones={METRICAS} onCambio={setMetrica} />
                <Segmentado etiqueta="Vista" valor={vista} opciones={[{ v: 'mes', l: 'Mes alineado' }, { v: 'anio', l: 'Año completo' }]} onCambio={setVista} />
                <Segmentado etiqueta="Serie" valor={serie} opciones={[{ v: 'normalizada', l: 'Normalizada' }, { v: 'reportada', l: 'Como se reportó' }]} onCambio={setSerie} />
            </section>

            <p className="ah-nota">
                {serie === 'normalizada'
                    ? 'Serie normalizada: volumen y % se recalculan desde la escala medida con la tabla vigente de cada presa (Boquilla: levantamiento 2020 · Madero: tabla oficial SRL), para que los años sean comparables aunque la curva haya cambiado.'
                    : 'Valores tal como salieron en cada reporte, con la tabla de su época. El cambio de tabla en 2021 introduce saltos de hasta ~17 Mm³ en Boquilla (ene–ago) y ~5 Mm³ en Madero (ene–jul).'}
            </p>

            {error ? (
                <div className="ah-estado" role="alert">
                    <h3>No se pudo cargar el archivo histórico</h3>
                    <p>{error}</p>
                    <button type="button" className="ah-btn" onClick={recargar}><RefreshCw size={14} /> Reintentar</button>
                </div>
            ) : loading ? (
                <div className="ah-estado" aria-busy="true"><div className="ah-pulso" /><p>Sincronizando lecturas…</p></div>
            ) : anios.length === 0 ? (
                <div className="ah-estado"><h3>Sin registros</h3><p>Aún no hay lecturas de presas en el archivo.</p></div>
            ) : (
                <>
                    <div className="ah-paneles">
                        {PRESAS.map(p => (
                            <PanelPresaHistorico
                                key={p} presaId={p} mapa={indice[p]} todosLosAnios={anios} aniosSel={seleccion}
                                mes={mes} vista={vista} metrica={metrica} serie={serie} onSeleccionar={desdeMatriz}
                            />
                        ))}
                    </div>

                    <details className="ah-datos">
                        <summary>Ver los datos de {mesNombre.toLowerCase()} ({nombreMetrica.toLowerCase()}, {unidad})</summary>
                        <div className="ah-datos-barra">
                            <span>Una fila por día; S/D = sin lectura ese día.</span>
                            <button type="button" className="ah-btn" onClick={descargarCsv}><Download size={14} /> Descargar CSV</button>
                        </div>
                        <div className="ah-tablas">
                            {PRESAS.map(p => (
                                <div key={p} className="ah-tabla-wrap">
                                    <table className="ah-tabla">
                                        <caption>{NOMBRE_PRESA[p]}</caption>
                                        <thead><tr><th scope="col">Día</th>{seleccion.map(a => <th key={a} scope="col">{a}</th>)}</tr></thead>
                                        <tbody>
                                            {Array.from({ length: 31 }, (_, i) => {
                                                const cols = seleccion.map(a => serieMes(indice[p], a, mes, metrica, serie)[i]);
                                                if (i + 1 > Math.max(...seleccion.map(a => diasDelMes(a, mes)))) return null;
                                                return (
                                                    <tr key={i}>
                                                        <th scope="row">{i + 1}</th>
                                                        {cols.map((v, j) => <td key={j} className={v == null ? 'is-sd' : ''}>{formatearNumero(v, decimales)}</td>)}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    </details>
                </>
            )}
        </div>
    );
};

export default AnalisisHistorico;
