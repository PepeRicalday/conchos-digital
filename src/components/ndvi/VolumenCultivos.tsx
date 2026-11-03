import React, { useMemo, useState } from 'react';
import { CircleCheck, Info, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { fmt, fmtMiles } from '../../utils/formato';
import type { FilaSupVol } from '../../utils/ndviInteranual';
import type { VolumenActual } from '../../utils/ndviVolumen';
import { ANIOS_SIN_CICLO, RANGO_INFORME, TEXTO_SIN_CICLO, esAnioSinCiclo, rotuloAnio } from '../../utils/estadoAnio';
import {
    UMBRAL_HA_MUESTRA, aniosConInforme, barrasSuperficieAnual, barrasVolumenAnual, cifraContraste, contrasteRegimenes, fraseContrasteSuperficie, kpiCiclo, kpiLamina, kpiMezcla,
    laminaPorCultivo, lecturaVsTipico, mezclaCultivos, referenciaCicloActual, topConOtros,
    type BarraAnio, type CeldaCultivo, type ParteTop, type PosicionCiclo, type ReferenciaModulo, type SerieCultivo,
} from '../../utils/volumenCultivo';
import './VolumenCultivos.css';

export type VistaCultivo = 'lamina' | 'mezcla' | 'ciclo';
const MODULOS = [1, 2, 3, 4, 5, 12];
const SD = <span className="ndvi-ia-sd">S/D</span>;
const sg = (v: number, d = 0) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
const ambito = (m: number | null) => (m == null ? 'todo el distrito' : `Módulo ${m}`);

// ───────────────────────── Piezas compartidas ─────────────────────────

type TipoEstado = 'ok' | 'warn' | 'info';
const IconoEstado: React.FC<{ tipo: TipoEstado }> = ({ tipo }) => (tipo === 'ok' ? <CircleCheck size={14} aria-hidden="true" /> : tipo === 'warn' ? <TriangleAlert size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />);

/** Tarjeta KPI: una idea, la cifra grande, una frase de lectura y un estado con ícono y texto (el color no va solo). S/D si no hay dato, nunca 0. */
const Kpi: React.FC<{
    etiqueta: string; valor: string | null; unidad?: string; texto?: boolean; lectura: React.ReactNode; estado?: { tipo: TipoEstado; texto: string };
}> = ({ etiqueta, valor, unidad, texto, lectura, estado }) => (
    <li className="vc-kpi">
        <span className="vc-kpi-et">{etiqueta}</span>
        <span className={`vc-kpi-cifra${valor == null ? ' sd' : ''}${texto && valor != null ? ' txt' : ''}`}>{valor ?? 'S/D'}{valor != null && unidad && <small>{unidad}</small>}</span>
        <span className="vc-kpi-ctx">{lectura}</span>
        {estado && <span className={`vc-estado ${estado.tipo}`}><IconoEstado tipo={estado.tipo} />{estado.texto}</span>}
    </li>
);
const FilaKpi: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => <ul className="vc-kpis" aria-label={etiqueta}>{children}</ul>;

/** Botones segmentados (en lugar de un <select> nativo): táctiles, todos visibles, el elegido con aria-pressed. */
function Segmentos<T extends string | number | null>({ etiqueta, valor, opciones, onChange }: {
    etiqueta: string; valor: T; opciones: { valor: T; texto: string; nombre?: string }[]; onChange: (v: T) => void;
}) {
    return (
        <div className="vc-seg" role="group" aria-label={etiqueta}>
            <span className="vc-seg-et" aria-hidden="true">{etiqueta}</span>
            <div className="vc-seg-btns">
                {opciones.map(o => (
                    <button key={String(o.valor)} type="button" className="vc-seg-btn" aria-pressed={valor === o.valor} aria-label={o.nombre} onClick={() => onChange(o.valor)}>{o.texto}</button>
                ))}
            </div>
        </div>
    );
}
const OPC_AMBITO: { valor: number | null; texto: string; nombre: string }[] = [
    { valor: null, texto: 'Todo el distrito', nombre: 'Todo el distrito' },
    ...MODULOS.map(m => ({ valor: m as number | null, texto: `M${m}`, nombre: `Módulo ${m}` })),
];
const Ambito: React.FC<{ modulo: number | null; onChange: (m: number | null) => void }> = ({ modulo, onChange }) => <Segmentos etiqueta="Ver" valor={modulo} opciones={OPC_AMBITO} onChange={onChange} />;

/** Tabla completa plegada: la gráfica es la lectura; el detalle queda a un toque. */
const Detalle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <details className="vc-detalle"><summary>Ver detalle</summary>{children}</details>
);

/** Tarjeta que explica por qué un año no tiene cifras (2025: presas cerradas). Nunca S/D, nunca 0. */
const TarjetaSinCiclo: React.FC<{ anio: number }> = ({ anio }) => (
    <div className="vc-sinciclo" role="note">
        <Info size={18} aria-hidden="true" />
        <div>
            <b>{anio}: sin ciclo de riego</b>
            <p>{TEXTO_SIN_CICLO}</p>
            <ul>
                <li>No tiene volumen ni superficie en el informe ACUM_INF. No se muestra ninguna cifra: ni vacía ni en cero.</li>
                <li>Queda fuera de los promedios, del año típico, de los rangos y del ajuste entre agua y vegetación.</li>
                <li>Su NDVI de satélite sí existe, pero es de toda la frontera del módulo y no mide riego de presa: no se lee como año bueno ni seco.</li>
            </ul>
        </div>
    </div>
);

// ───────────────────────── Barras por año (distrito) ─────────────────────────

/** Barras por año con 2025 como hueco rotulado y 2026 con trama (provisional). Escala desde cero. */
const BarrasAnio: React.FC<{ barras: BarraAnio[]; unidad: string; decimales: number; titulo: string; leyendaProvisional?: string }> = ({ barras, unidad, decimales, titulo, leyendaProvisional }) => {
    const max = Math.max(1, ...barras.map(b => b.valor ?? 0));
    const resumen = barras.map(b => `${b.anio}: ${b.estado === 'sin-ciclo' ? 'sin ciclo, presas cerradas' : b.valor != null ? `${fmt(b.valor, decimales)} ${unidad}${b.estado === 'provisional' ? ' (provisional)' : ''}` : 'sin dato (S/D)'}`).join('; ');
    return (
        <figure className="vc-fig">
            <figcaption>{titulo}</figcaption>
            <div className="vc-barras" role="img" aria-label={`${titulo}. ${resumen}`} style={{ gridTemplateColumns: barras.map(b => (b.estado === 'provisional' ? 'minmax(62px, 1.5fr)' : 'minmax(0, 1fr)')).join(' ') }}>
                {barras.map(b => (
                    <div key={b.anio} className={`vc-col ${b.estado}`}>
                        <span className="vc-col-val">{b.estado === 'sin-ciclo' ? '' : b.valor != null ? (unidad === 'ha' ? fmtMiles(b.valor, 0) : fmt(b.valor, decimales)) : 'S/D'}</span>
                        <div className="vc-col-zona">
                            {b.estado === 'sin-ciclo'
                                ? <div className="vc-hueco"><span>Sin ciclo</span><span className="vc-hueco-2">presas cerradas</span></div>
                                : b.valor != null ? <div className="vc-col-barra" style={{ height: `${Math.max(2, (b.valor / max) * 100)}%` }} /> : null}
                        </div>
                        <span className="vc-col-anio">{b.anio}</span>
                        <span className="vc-col-sub">{b.estado === 'provisional' ? (b.incompleto ? 'provisional, incompleto' : 'provisional') : b.estado === 'sin-ciclo' ? 'sin ciclo' : ''}</span>
                    </div>
                ))}
            </div>
            <p className="vc-leyenda">
                <span><i className="vc-sw sol" aria-hidden="true" />Año con informe ACUM_INF ({unidad})</span>
                {barras.some(b => b.estado === 'provisional') && <span><i className="vc-sw tra" aria-hidden="true" />{leyendaProvisional ?? 'Provisional'}</span>}
                <span><i className="vc-sw hue" aria-hidden="true" />Sin ciclo: presas cerradas</span>
            </p>
        </figure>
    );
};

// ───────────────────────── Agua por hectárea ─────────────────────────

const topLamina = 6;
const techoCm = (v: number) => { const paso = v > 250 ? 100 : 50; return Math.max(paso, Math.ceil(v / paso) * paso); };
const textoCelda = (c: CeldaCultivo) => `${c.anio}: ${c.capturaCero ? 'volumen 0 en la fuente, por revisar' : `${fmt(c.laminaCm, 0)} cm`}${c.muestraChica ? ' (superficie chica)' : ''}`;

const FilaLamina: React.FC<{ s: SerieCultivo; techo: number; anioUlt: number | null }> = ({ s, techo, anioUlt }) => {
    const con = s.celdas.filter(c => c.laminaCm != null);
    const firmes = con.filter(c => !c.muestraChica);
    const mn = firmes.length ? Math.min(...firmes.map(c => c.laminaCm as number)) : null, mx = firmes.length ? Math.max(...firmes.map(c => c.laminaCm as number)) : null;
    const ult = [...con].reverse().find(c => !c.muestraChica) ?? con[con.length - 1] ?? null;
    const pos = (v: number) => `${Math.min(100, Math.max(0, (v / techo) * 100))}%`;
    const revisar = s.celdas.filter(c => c.capturaCero).length;
    const aria = `${s.cultivo}. ${s.celdas.map(textoCelda).join('; ')}.${mn != null && mx != null ? ` La banda va de ${fmt(mn, 0)} a ${fmt(mx, 0)} cm.` : ''}`;
    return (
        <li className="vc-fila-lam">
            <span className="vc-fila-nom">{s.cultivo}</span>
            <div className="vc-track" role="img" aria-label={aria}>
                <div className="vc-track-eje" />
                {mn != null && mx != null && <div className="vc-track-banda" style={{ left: pos(mn), width: `max(6px, calc(${pos(mx)} - ${pos(mn)}))` }} />}
                {con.map(c => (
                    <span key={c.anio} title={textoCelda(c)}
                        className={`vc-pto${c.muestraChica ? ' chica' : ''}${c.laminaAtipica || c.atipicoFuente ? ' revisar' : ''}${ult && c.anio === ult.anio ? ' ult' : ''}`} style={{ left: pos(c.laminaCm as number) }} />
                ))}
            </div>
            <span className="vc-fila-val">
                {ult ? <><b>{fmt(ult.laminaCm, 0)}</b> cm<small>{ult.anio === anioUlt ? `en ${ult.anio}` : `en ${ult.anio}`}{ult.muestraChica ? ', superficie chica' : ''}</small></> : SD}
                {revisar > 0 && <small className="vc-rev"><TriangleAlert size={12} aria-hidden="true" /> {revisar} {revisar === 1 ? 'cifra' : 'cifras'} por revisar</small>}
            </span>
        </li>
    );
};

const Lamina: React.FC<{ supVol: FilaSupVol[] }> = ({ supVol }) => {
    const [modulo, setModulo] = useState<number | null>(null);
    const series = useMemo(() => laminaPorCultivo(supVol, modulo), [supVol, modulo]);
    const anios = useMemo(() => [...new Set(series.flatMap(s => s.celdas.map(c => c.anio)))].sort((a, b) => a - b), [series]);
    const kpi = useMemo(() => kpiLamina(supVol, modulo), [supVol, modulo]);
    const top = series.filter(s => s.celdas.some(c => c.laminaCm != null)).slice(0, topLamina);
    const techo = useMemo(() => techoCm(Math.max(1, ...top.flatMap(s => s.celdas.map(c => c.laminaCm ?? 0)))), [top]);
    // Columnas de la tabla de detalle: los años con informe y, al final, 2025 como «Sin ciclo».
    const colsTabla = useMemo(() => [...new Set([...anios, ...ANIOS_SIN_CICLO])].sort((a, b) => a - b), [anios]);
    return (
        <div>
            <Ambito modulo={modulo} onChange={setModulo} />
            <FilaKpi etiqueta="Resumen del agua por hectárea">
                <Kpi etiqueta={`Agua por hectárea en ${kpi.anio ?? 'el último año'}`} valor={kpi.laminaMediaCm != null ? fmt(kpi.laminaMediaCm, 0) : null} unidad="cm"
                    lectura={`Es lo que se entregó por hectárea (${ambito(modulo)}), no lo que gastó la planta.`} estado={{ tipo: 'info', texto: 'Dato del informe ACUM_INF' }} />
                <Kpi etiqueta="Cultivo que más agua recibe por hectárea" texto valor={kpi.cultivoMayor?.cultivo ?? null}
                    lectura={kpi.cultivoMayor ? <><b>{fmt(kpi.cultivoMayor.laminaCm, 0)} cm</b> por hectárea en {kpi.anio}, entre cultivos de {UMBRAL_HA_MUESTRA} ha o más.</> : 'Ningún cultivo tiene superficie suficiente para compararse.'}
                    estado={kpi.cultivoMayor ? { tipo: 'info', texto: 'Solo cultivos con muestra firme' } : undefined} />
                <Kpi etiqueta="Cifras por revisar" valor={kpi.celdas ? String(kpi.alertas) : null} unidad={kpi.celdas ? `de ${kpi.celdas}` : undefined}
                    lectura="Cifras raras o con poca superficie. Se muestran marcadas, no se corrigen."
                    estado={kpi.celdas ? (kpi.alertas > 0 ? { tipo: 'warn', texto: 'Leer con cuidado' } : { tipo: 'ok', texto: 'Sin cifras raras' }) : undefined} />
            </FilaKpi>
            <section className="vc-tarjeta" aria-labelledby="vc-t-lam">
                <h5 id="vc-t-lam">Agua entregada por hectárea, cada cultivo y año</h5>
                <p className="vc-sub">Cada punto es un año. La banda gris va del año con menos agua al año con más. Más a la derecha = más agua por hectárea.</p>
                <div className="vc-eje-x" aria-hidden="true"><span>0</span><span>{techo / 2} cm</span><span>{techo} cm</span></div>
                <ol className="vc-lista-lam">{top.map(s => <FilaLamina key={s.cultivo} s={s} techo={techo} anioUlt={kpi.anio} />)}</ol>
                <p className="vc-leyenda">
                    <span><i className="vc-pt sol" aria-hidden="true" />Año con informe</span>
                    <span><i className="vc-pt ult" aria-hidden="true" />Último año</span>
                    <span><i className="vc-pt chica" aria-hidden="true" />Poca superficie (menos de {UMBRAL_HA_MUESTRA} ha)</span>
                    <span><i className="vc-pt revisar" aria-hidden="true" />Cifra por revisar</span>
                </p>
            </section>
            <Detalle>
                <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Agua por hectárea, todos los cultivos y años">
                    <table className="ndvi-ia-tabla vc-tabla">
                        <caption>Agua entregada por hectárea (cm) = volumen ÷ superficie, {ambito(modulo)}</caption>
                        <thead><tr><th scope="col">Cultivo</th>{colsTabla.map(a => <th key={a} scope="col">{a}</th>)}<th scope="col">Promedio</th></tr></thead>
                        <tbody>
                            {series.map(s => (
                                <tr key={s.cultivo}>
                                    <th scope="row">{s.cultivo}</th>
                                    {colsTabla.map(a => {
                                        if (esAnioSinCiclo(a)) return <td key={a} className="vc-sc">Sin ciclo</td>;
                                        const c = s.celdas.find(x => x.anio === a);
                                        if (!c) return <td key={a}>{SD}</td>;
                                        if (c.capturaCero) return <td key={a} className="vc-num vc-alerta"><span aria-label="volumen 0 en la fuente, por revisar">Revisar ⚠</span><small>{fmtMiles(c.superficieHa, 0)} ha</small></td>;
                                        if (c.laminaCm == null) return <td key={a}>{SD}</td>;
                                        const marcas = [c.laminaAtipica && 'cifra lejos de los demás años', c.muestraChica && `superficie menor a ${UMBRAL_HA_MUESTRA} ha`, c.atipicoFuente && 'captura atípica en el informe fuente'].filter(Boolean).join('; ');
                                        return (
                                            <td key={a} className={`vc-num${c.laminaAtipica || c.atipicoFuente ? ' vc-alerta' : ''}${c.muestraChica ? ' vc-chica' : ''}`} title={marcas || undefined}>
                                                {fmt(c.laminaCm, 0)}{marcas && <span aria-label={marcas}> ⚠</span>}
                                                <small>{fmtMiles(c.superficieHa, 0)} ha</small>
                                            </td>
                                        );
                                    })}
                                    <td className="vc-num">{s.mediaLaminaCm != null ? fmt(s.mediaLaminaCm, 0) : SD}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="ndvi-nota">⚠ = cifra por revisar: se aleja de los demás años del mismo cultivo, tiene menos de {UMBRAL_HA_MUESTRA} ha (poca superficie) o es una captura atípica del informe. El promedio solo usa años con superficie suficiente y sin captura atípica. 2025 no tiene cifras: {TEXTO_SIN_CICLO.toLowerCase()}</p>
            </Detalle>
            <p className="ndvi-nota">Describe, no explica: una cifra más alta o más baja no dice por qué. Es agua entregada, no consumo de la planta.</p>
        </div>
    );
};

// ───────────────────────── Mezcla de cultivos ─────────────────────────

const BarrasPart: React.FC<{ partes: ParteTop[]; titulo: string; tipo: 'agua' | 'sup'; unidad: string; dec: number }> = ({ partes, titulo, tipo, unidad, dec }) => {
    const max = Math.max(1, ...partes.map(p => p.pct));
    const aria = `${titulo}: ${partes.map(p => `${p.nombre} ${fmt(p.pct, 0)} %`).join('; ')}`;
    return (
        <section className="vc-tarjeta" aria-label={titulo}>
            <h5>{titulo}</h5>
            {partes.length === 0 ? <p className="vc-sub">{SD} sin cifras para este año.</p> : (
                <ol className="vc-part" aria-label={aria}>
                    {partes.map(p => (
                        <li key={p.nombre} title={p.esOtros ? p.cultivos.join(', ') : undefined}>
                            <span className="vc-part-nom">{p.nombre}</span>
                            <span className="vc-part-pista" aria-hidden="true"><i className={`${tipo}${p.esOtros ? ' otros' : ''}`} style={{ width: `${Math.max(1.5, (p.pct / max) * 100)}%` }} /></span>
                            <span className="vc-part-val"><b>{fmt(p.pct, 0)} %</b>{p.valor != null && <small>{unidad === 'ha' ? fmtMiles(p.valor, 0) : fmt(p.valor, dec)} {unidad}</small>}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
};

const Mezcla: React.FC<{ supVol: FilaSupVol[] }> = ({ supVol }) => {
    const [modulo, setModulo] = useState<number | null>(null);
    const anios = useMemo(() => aniosConInforme(supVol), [supVol]);
    const [anio, setAnio] = useState<number | null>(null);
    const anioSel = anio ?? anios[anios.length - 1] ?? null;
    const sinCiclo = anioSel != null && esAnioSinCiclo(anioSel);
    const mezcla = useMemo(() => (anioSel == null || sinCiclo ? [] : mezclaCultivos(supVol, modulo, anioSel)), [supVol, modulo, anioSel, sinCiclo]);
    const contraste = useMemo(() => contrasteRegimenes(supVol, modulo), [supVol, modulo]);
    const kpi = useMemo(() => kpiMezcla(supVol, modulo, sinCiclo ? null : anioSel), [supVol, modulo, anioSel, sinCiclo]);
    const kpiRef = useMemo(() => kpiMezcla(supVol, modulo, anios[anios.length - 1] ?? null), [supVol, modulo, anios]);
    const topAgua = useMemo(() => topConOtros(mezcla, 'volumen'), [mezcla]);
    const topSup = useMemo(() => topConOtros(mezcla, 'superficie'), [mezcla]);
    const barrasSup = useMemo(() => barrasSuperficieAnual(supVol, modulo), [supVol, modulo]);
    const fraseContr = fraseContrasteSuperficie(kpiRef.altosVsBajos);
    const opcionesAnio = [...anios, ...ANIOS_SIN_CICLO].map(a => ({ valor: a, texto: rotuloAnio(a), nombre: esAnioSinCiclo(a) ? `${a}, sin ciclo de riego` : String(a) }));
    return (
        <div>
            <Ambito modulo={modulo} onChange={setModulo} />
            <Segmentos etiqueta="Año" valor={anioSel} opciones={opcionesAnio} onChange={setAnio} />
            {sinCiclo && anioSel != null ? <TarjetaSinCiclo anio={anioSel} /> : (
                <>
                    <FilaKpi etiqueta="Resumen de la mezcla">
                        <Kpi etiqueta="Alfalfa y nogal" valor={kpi.pctVolumenAlfalfaNogal != null ? `${fmt(kpi.pctVolumenAlfalfaNogal, 0)} %` : null}
                            lectura={`del agua entregada en ${anioSel ?? 'el último año'} (${ambito(modulo)}).`}
                            estado={kpi.pctVolumenAlfalfaNogal != null ? { tipo: 'info', texto: kpi.pctVolumenAlfalfaNogal >= 50 ? 'Más de la mitad del agua' : 'Menos de la mitad del agua' } : undefined} />
                        <Kpi etiqueta={`Superficie regada en ${anioSel ?? 'el último año'}`} valor={kpi.superficieTotalHa != null ? fmtMiles(kpi.superficieTotalHa, 0) : null} unidad="ha"
                            lectura="Suma de todos los cultivos del informe ACUM_INF." estado={{ tipo: 'info', texto: 'Dato del informe' }} />
                        <Kpi etiqueta="Cambio de superficie entre años" texto valor={cifraContraste(kpiRef.altosVsBajos)}
                            lectura={fraseContr ?? 'En este ámbito no hay un contraste claro entre años.'}
                            estado={fraseContr ? { tipo: 'info', texto: 'Describe, no explica' } : undefined} />
                    </FilaKpi>
                    <div className="vc-dos">
                        <BarrasPart partes={topAgua} titulo={`¿Qué cultivos reciben el agua? (${anioSel})`} tipo="agua" unidad="hm³" dec={1} />
                        <BarrasPart partes={topSup} titulo={`¿Cuánta superficie ocupa cada cultivo? (${anioSel})`} tipo="sup" unidad="ha" dec={0} />
                    </div>
                </>
            )}
            <section className="vc-tarjeta" aria-label="Superficie regada por año">
                <BarrasAnio barras={barrasSup} unidad="ha" decimales={0} titulo={`Superficie regada por año, ${ambito(modulo)}`} />
            </section>
            {!sinCiclo && (
                <Detalle>
                    <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Peso de cada cultivo">
                        <table className="ndvi-ia-tabla vc-tabla">
                            <caption>Todos los cultivos, {anioSel}, {ambito(modulo)}</caption>
                            <thead><tr><th scope="col">Cultivo</th><th scope="col">Superficie (ha)</th><th scope="col">% de la superficie</th><th scope="col">Agua (hm³)</th><th scope="col">% del agua</th></tr></thead>
                            <tbody>
                                {mezcla.length === 0 && <tr><td colSpan={5}>{SD} sin renglones para este año.</td></tr>}
                                {mezcla.map(p => (
                                    <tr key={p.cultivo}>
                                        <th scope="row">{p.cultivo}</th>
                                        <td className="vc-num">{p.superficieHa != null ? fmtMiles(p.superficieHa, 0) : SD}</td>
                                        <td className="vc-num">{p.pctSuperficie != null ? `${fmt(p.pctSuperficie, 1)} %` : SD}</td>
                                        <td className="vc-num">{p.volumenHm3 != null ? fmt(p.volumenHm3, 1) : SD}</td>
                                        <td className="vc-num">{p.pctVolumen != null ? `${fmt(p.pctVolumen, 1)} %` : SD}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {contraste && (
                        <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Años de más superficie contra años de menos superficie">
                            <table className="ndvi-ia-tabla vc-tabla">
                                <caption>Años de más superficie ({contraste.altos.join(', ')}) y de menos superficie ({contraste.bajos.join(', ')}): qué parte del agua recibió cada cultivo</caption>
                                <thead><tr><th scope="col">Cultivo</th><th scope="col">% del agua, años de más superficie</th><th scope="col">% del agua, años de menos superficie</th><th scope="col">Diferencia (puntos de %)</th></tr></thead>
                                <tbody>
                                    {contraste.cultivos.slice(0, 8).map(c => (
                                        <tr key={c.cultivo}>
                                            <th scope="row">{c.cultivo}</th>
                                            <td className="vc-num">{c.pctVolAltos != null ? fmt(c.pctVolAltos, 1) : SD}</td>
                                            <td className="vc-num">{c.pctVolBajos != null ? fmt(c.pctVolBajos, 1) : SD}</td>
                                            <td className="vc-num">{c.deltaPp != null ? sg(c.deltaPp, 1) : SD}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="ndvi-nota">Los años de «más superficie» y de «menos superficie» se separan por la superficie total regada (punto medio entre el año con menos y el año con más).{contraste ? '' : ' En este ámbito no hay un contraste claro (se piden al menos 4 años y que el mayor tenga 1.5 veces la superficie del menor).'}</p>
                </Detalle>
            )}
            <p className="ndvi-nota">Describe, no explica: no dice por qué cambió la superficie ni la mezcla. El año 2026 no aparece aquí porque la hoja SRL no desglosa por cultivo.</p>
        </div>
    );
};

// ───────────────────────── Ciclo actual ─────────────────────────

const POS: Record<PosicionCiclo, { texto: string; Icono: typeof CircleCheck }> = {
    'bajo-rango': { texto: 'Debajo del rango', Icono: TrendingDown },
    dentro: { texto: 'Dentro del rango', Icono: CircleCheck },
    'sobre-rango': { texto: 'Arriba del rango', Icono: TrendingUp },
    'sin-dato': { texto: 'Sin dato (S/D)', Icono: Minus },
};

/** Banda = del año con menos agua al año con más (años con informe); raya = año típico; rombo = ciclo actual. Escala propia de cada módulo, desde cero. */
const Rango: React.FC<{ r: ReferenciaModulo }> = ({ r }) => {
    if (r.minHm3 == null || r.maxHm3 == null) return <div className="vc-track vc-rango vacio">{SD}</div>;
    const tope = Math.max(r.maxHm3, r.actualHm3 ?? 0) * 1.05;
    const pos = (v: number) => `${(v / tope) * 100}%`;
    const desc = `Rango ${RANGO_INFORME} de ${fmt(r.minHm3, 1)} a ${fmt(r.maxHm3, 1)} hm³${r.medianaHm3 != null ? `, año típico ${fmt(r.medianaHm3, 1)}` : ''}; ${r.actualHm3 != null ? `ciclo actual ${fmt(r.actualHm3, 1)}, ${POS[r.posicion].texto.toLowerCase()}` : 'ciclo actual sin dato (S/D)'}`;
    return (
        <div className="vc-track vc-rango" role="img" aria-label={desc}>
            <div className="vc-track-eje" />
            <div className="vc-track-banda" style={{ left: pos(r.minHm3), width: `max(6px, calc(${pos(r.maxHm3)} - ${pos(r.minHm3)}))` }} />
            {r.medianaHm3 != null && <span className="vc-raya" style={{ left: pos(r.medianaHm3) }} />}
            {r.actualHm3 != null && <span className={`vc-rombo ${r.posicion}`} style={{ left: pos(r.actualHm3) }} />}
        </div>
    );
};

const Ciclo: React.FC<{ supVol: FilaSupVol[]; volumenActual: VolumenActual | null }> = ({ supVol, volumenActual }) => {
    const refs = useMemo(() => referenciaCicloActual(supVol, volumenActual, MODULOS), [supVol, volumenActual]);
    const kpi = useMemo(() => kpiCiclo(refs), [refs]);
    const barras = useMemo(() => barrasVolumenAnual(supVol, volumenActual, null, MODULOS), [supVol, volumenActual]);
    const lect = lecturaVsTipico(kpi.pctVsMediana);
    const ultAnio = barras.length ? barras[barras.length - 1].anio : 2026;
    return (
        <div>
            {volumenActual == null && <p className="ndvi-nota" role="status">Cargando el volumen provisional del ciclo actual…</p>}
            {volumenActual?.error && <p className="vv-error" role="alert">No se pudo leer el volumen de la hoja SRL ({volumenActual.error}). El ciclo actual queda sin dato (S/D), no en cero.</p>}
            <FilaKpi etiqueta="Resumen del ciclo actual">
                <Kpi etiqueta={`Agua entregada de marzo a septiembre ${ultAnio}`} valor={kpi.actualHm3 != null ? fmt(kpi.actualHm3, 1) : null} unidad="hm³ (provisional)"
                    lectura={kpi.modulosConDato < kpi.modulosTotal && kpi.modulosConDato > 0 ? `Suma de ${kpi.modulosConDato} de ${kpi.modulosTotal} módulos con dato. Hoja SRL, sin conciliar con ACUM_INF.` : 'Hoja SRL, todavía sin conciliar con el informe ACUM_INF.'}
                    estado={kpi.incompletos > 0 ? { tipo: 'warn', texto: `${kpi.incompletos} ${kpi.incompletos === 1 ? 'módulo' : 'módulos'} con meses incompletos` } : { tipo: 'info', texto: 'Provisional' }} />
                <Kpi etiqueta={`Frente a un año típico ${RANGO_INFORME}`} texto valor={lect?.cifra ?? null}
                    lectura={lect ? lect.frase : 'Sin base de comparación.'}
                    estado={lect ? { tipo: 'info', texto: kpi.medianaHm3 != null ? `Año típico: ${fmt(kpi.medianaHm3, 1)} hm³` : 'Año típico' } : undefined} />
                <Kpi etiqueta="Módulos dentro del rango" texto={false} valor={kpi.modulosConDato ? `${kpi.dentro} de ${kpi.modulosTotal}` : null}
                    lectura={<>El rango va del año con menos agua al año con más en {RANGO_INFORME}.{kpi.modulosConDato ? <> {kpi.sobre} arriba, {kpi.bajo} debajo{kpi.sinDato ? `, ${kpi.sinDato} sin dato` : ''}.</> : null}</>}
                    estado={kpi.modulosConDato ? (kpi.dentro === kpi.modulosConDato ? { tipo: 'ok', texto: 'Todos dentro' } : { tipo: 'info', texto: 'Algunos fuera del rango' }) : undefined} />
            </FilaKpi>
            <section className="vc-tarjeta" aria-label="Agua entregada por año">
                <BarrasAnio barras={barras} unidad="hm³" decimales={0} titulo="Agua entregada de marzo a septiembre, todo el distrito" leyendaProvisional="2026: hoja SRL, provisional" />
            </section>
            <section className="vc-tarjeta" aria-labelledby="vc-t-mod">
                <h5 id="vc-t-mod">Cada módulo frente a {RANGO_INFORME}</h5>
                <p className="vc-sub">La banda gris es el rango: del año con menos agua al año con más. La raya es el año típico y el rombo, el ciclo actual. Cada módulo usa su propia escala desde cero.</p>
                <ul className="vc-lista-mod">
                    {refs.map(r => {
                        const P = POS[r.posicion];
                        return (
                            <li key={r.modulo} className={`vc-mod ${r.posicion}`}>
                                <div className="vc-mod-cab">
                                    <b>Módulo {r.modulo}</b>
                                    <span className={`vc-chip ${r.posicion}`}><P.Icono size={14} aria-hidden="true" />{P.texto}{r.actualIncompleto && ' · meses incompletos'}</span>
                                </div>
                                <Rango r={r} />
                                <p className="vc-mod-txt">
                                    {r.actualHm3 != null
                                        ? <><b>{fmt(r.actualHm3, 1)} hm³</b> este ciclo{r.pctVsMediana != null && <> ({sg(r.pctVsMediana, 0)} % frente a un año típico)</>}. </>
                                        : <>Este ciclo: {SD}. </>}
                                    {r.minHm3 != null && r.maxHm3 != null ? <>Rango {RANGO_INFORME}: {fmt(r.minHm3, 1)} a {fmt(r.maxHm3, 1)} hm³.</> : null}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            </section>
            <Detalle>
                <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label={`Ciclo actual contra el rango ${RANGO_INFORME}`}>
                    <table className="ndvi-ia-tabla vc-tabla">
                        <caption>Agua entregada de marzo a septiembre (hm³): ciclo actual (provisional) contra {RANGO_INFORME}</caption>
                        <thead><tr><th scope="col">Módulo</th><th scope="col">Mínimo</th><th scope="col">Año típico</th><th scope="col">Máximo</th><th scope="col">Ciclo actual</th><th scope="col">Frente al año típico</th><th scope="col">Lectura</th></tr></thead>
                        <tbody>
                            {refs.map(r => (
                                <tr key={r.modulo}>
                                    <th scope="row">{r.modulo}</th>
                                    <td className="vc-num">{r.minHm3 != null ? fmt(r.minHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.medianaHm3 != null ? fmt(r.medianaHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.maxHm3 != null ? fmt(r.maxHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.actualHm3 != null ? <>{fmt(r.actualHm3, 1)}<span className="vv-prov"> provisional</span></> : SD}</td>
                                    <td className="vc-num">{r.pctVsMediana != null ? `${sg(r.pctVsMediana, 0)} %` : SD}</td>
                                    <td className="vv-lect">{POS[r.posicion].texto}{r.actualIncompleto && <span className="vv-warn"> ⚠ meses incompletos</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Detalle>
            <p className="ndvi-nota">La hoja SRL no desglosa por cultivo: aquí la comparación es solo por módulo. {RANGO_INFORME} sale del informe ACUM_INF (corte de septiembre) y el ciclo actual de la hoja SRL, provisional; las dos fuentes no están conciliadas. Un año típico es el año del medio de {RANGO_INFORME}; 2025 no cuenta porque las presas estuvieron cerradas. Con 5 años el rango es una referencia, no una prueba. Menos o más agua que un año típico no dice si hubo ahorro, sequía ni otra causa.</p>
        </div>
    );
};

export const VolumenCultivos: React.FC<{ vista: VistaCultivo; supVol: FilaSupVol[]; volumenActual: VolumenActual | null }> = ({ vista, supVol, volumenActual }) => {
    if (!supVol.length) return <p className="vv-vacio">S/D: no se pudo cargar el informe ACUM_INF (sin renglones). Esto es un dato que falta cargar, no un año sin riego.</p>;
    return vista === 'lamina' ? <Lamina supVol={supVol} /> : vista === 'mezcla' ? <Mezcla supVol={supVol} /> : <Ciclo supVol={supVol} volumenActual={volumenActual} />;
};

export default VolumenCultivos;
