import React, { useMemo, useState } from 'react';
import { CircleCheck, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { fmt, fmtMiles } from '../../utils/formato';
import type { FilaSupVol } from '../../utils/ndviInteranual';
import type { VolumenActual } from '../../utils/ndviVolumen';
import {
    UMBRAL_HA_MUESTRA, contrasteRegimenes, kpiCiclo, kpiLamina, kpiMezcla, laminaPorCultivo, mezclaCultivos, referenciaCicloActual,
    type PosicionCiclo, type ReferenciaModulo,
} from '../../utils/volumenCultivo';
import './VolumenCultivos.css';

export type VistaCultivo = 'lamina' | 'mezcla' | 'ciclo';
const MODULOS = [1, 2, 3, 4, 5, 12];
const SD = <span className="ndvi-ia-sd">S/D</span>;
const TXT_POS: Record<PosicionCiclo, string> = {
    'bajo-rango': 'Bajo el mínimo 2020-2024', dentro: 'Dentro del rango 2020-2024', 'sobre-rango': 'Sobre el máximo 2020-2024', 'sin-dato': 'Sin dato (S/D)',
};
const sg = (v: number, d = 0) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
const ambito = (m: number | null) => (m == null ? 'todo el distrito' : `Módulo ${m}`);

/** Tarjeta KPI: etiqueta, cifra grande (S/D si no hay dato, nunca 0), contexto y, opcional, un estado con ícono y texto (el color no va solo). */
const Kpi: React.FC<{
    etiqueta: string; valor: string | null; unidad?: string; texto?: boolean; contexto: React.ReactNode;
    estado?: { tipo: 'ok' | 'warn'; texto: string };
}> = ({ etiqueta, valor, unidad, texto, contexto, estado }) => (
    <li className="vc-kpi">
        <span className="vc-kpi-et">{etiqueta}</span>
        <span className={`vc-kpi-cifra${valor == null ? ' sd' : ''}${texto && valor != null ? ' txt' : ''}`}>{valor ?? 'S/D'}{valor != null && unidad && <small>{unidad}</small>}</span>
        <span className="vc-kpi-ctx">{contexto}</span>
        {estado && (
            <span className={`vc-estado ${estado.tipo}`}>
                {estado.tipo === 'ok' ? <CircleCheck size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}
                {estado.texto}
            </span>
        )}
    </li>
);
const FilaKpi: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => <ul className="vc-kpis" aria-label={etiqueta}>{children}</ul>;

const SelModulo: React.FC<{ modulo: number | null; onChange: (m: number | null) => void; etiqueta: string }> = ({ modulo, onChange, etiqueta }) => (
    <label className="vc-sel">{etiqueta}
        <select value={modulo ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Todo el distrito</option>
            {MODULOS.map(m => <option key={m} value={m}>Módulo {m}</option>)}
        </select>
    </label>
);

const Lamina: React.FC<{ supVol: FilaSupVol[] }> = ({ supVol }) => {
    const [modulo, setModulo] = useState<number | null>(null);
    const series = useMemo(() => laminaPorCultivo(supVol, modulo), [supVol, modulo]);
    const anios = useMemo(() => [...new Set(series.flatMap(s => s.celdas.map(c => c.anio)))].sort((a, b) => a - b), [series]);
    const kpi = useMemo(() => kpiLamina(supVol, modulo), [supVol, modulo]);
    // Escala común a todas las celdas (base en cero): una barra más larga siempre es una lámina mayor, en cualquier cultivo y año.
    const maxLamina = useMemo(() => Math.max(1, ...series.flatMap(s => s.celdas.map(c => c.laminaCm ?? 0))), [series]);
    return (
        <div>
            <SelModulo modulo={modulo} onChange={setModulo} etiqueta="Ámbito" />
            <FilaKpi etiqueta="Resumen de lámina">
                <Kpi etiqueta={`Lámina media ${kpi.anio ?? ''}`.trim()} valor={kpi.laminaMediaCm != null ? fmt(kpi.laminaMediaCm, 0) : null} unidad="cm" contexto={`Volumen ÷ superficie, ${ambito(modulo)}`} />
                <Kpi etiqueta="Cultivo de mayor lámina" texto valor={kpi.cultivoMayor?.cultivo ?? null}
                    contexto={kpi.cultivoMayor ? <><b>{fmt(kpi.cultivoMayor.laminaCm, 0)} cm</b> en {kpi.anio}, entre cultivos de {UMBRAL_HA_MUESTRA} ha o más</> : 'Sin cultivo con superficie suficiente'} />
                <Kpi etiqueta="Celdas con ⚠" valor={kpi.celdas ? String(kpi.alertas) : null} unidad={kpi.celdas ? `de ${kpi.celdas}` : undefined} contexto="Se muestran, no se corrigen"
                    estado={kpi.celdas ? (kpi.alertas > 0 ? { tipo: 'warn', texto: 'Leer con cuidado' } : { tipo: 'ok', texto: 'Sin alertas' }) : undefined} />
            </FilaKpi>
            <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Lámina bruta por cultivo y año">
                <table className="ndvi-ia-tabla vc-tabla">
                    <caption>Lámina bruta (cm) = volumen ÷ superficie, {ambito(modulo)}</caption>
                    <thead><tr><th scope="col">Cultivo</th>{anios.map(a => <th key={a} scope="col">{a}</th>)}<th scope="col">Media</th></tr></thead>
                    <tbody>
                        {series.map(s => (
                            <tr key={s.cultivo}>
                                <th scope="row">{s.cultivo}</th>
                                {anios.map(a => {
                                    const c = s.celdas.find(x => x.anio === a);
                                    if (!c || c.laminaCm == null) return <td key={a}>{SD}</td>;
                                    const marcas = [c.laminaAtipica && 'lámina lejos de los demás años', c.muestraChica && `superficie menor a ${UMBRAL_HA_MUESTRA} ha`, c.atipicoFuente && 'captura atípica en el informe fuente'].filter(Boolean).join('; ');
                                    return (
                                        <td key={a} className={`vc-num${c.laminaAtipica || c.atipicoFuente ? ' vc-alerta' : ''}${c.muestraChica ? ' vc-chica' : ''}`} title={marcas || undefined}>
                                            {fmt(c.laminaCm, 0)}{marcas && <span aria-label={marcas}> ⚠</span>}
                                            <span className={`vc-mini${c.muestraChica ? ' hueca' : ''}`} aria-hidden="true"><i style={{ width: `${Math.max(2, (c.laminaCm / maxLamina) * 100)}%` }} /></span>
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
            <p className="ndvi-nota">⚠ = lámina a más de 1.5 desviaciones de la de los demás años del mismo cultivo, superficie menor a {UMBRAL_HA_MUESTRA} ha (muestra pequeña; su barra va hueca) o captura atípica del informe fuente. Se muestran, no se corrigen. La media solo usa años con superficie suficiente. Es lámina bruta entregada, no consumo de la planta. Las barras de cada celda comparten una sola escala desde cero.</p>
        </div>
    );
};

const Mezcla: React.FC<{ supVol: FilaSupVol[] }> = ({ supVol }) => {
    const [modulo, setModulo] = useState<number | null>(null);
    const anios = useMemo(() => [...new Set(supVol.map(f => f.anio))].sort((a, b) => a - b), [supVol]);
    const [anio, setAnio] = useState<number | null>(null);
    const anioSel = anio ?? anios[anios.length - 1] ?? null;
    const mezcla = useMemo(() => (anioSel == null ? [] : mezclaCultivos(supVol, modulo, anioSel)), [supVol, modulo, anioSel]);
    const contraste = useMemo(() => contrasteRegimenes(supVol, modulo), [supVol, modulo]);
    const kpi = useMemo(() => kpiMezcla(supVol, modulo, anioSel), [supVol, modulo, anioSel]);
    return (
        <div>
            <div className="vc-filtros">
                <SelModulo modulo={modulo} onChange={setModulo} etiqueta="Ámbito" />
                <label className="vc-sel">Año
                    <select value={anioSel ?? ''} onChange={e => setAnio(Number(e.target.value))}>{anios.map(a => <option key={a} value={a}>{a}</option>)}</select>
                </label>
            </div>
            <FilaKpi etiqueta="Resumen de la mezcla">
                <Kpi etiqueta="Alfalfa + nogal" valor={kpi.pctVolumenAlfalfaNogal != null ? fmt(kpi.pctVolumenAlfalfaNogal, 0) : null} unidad="% del volumen" contexto={`${anioSel ?? ''}, ${ambito(modulo)}`} />
                <Kpi etiqueta={`Superficie total ${anioSel ?? ''}`.trim()} valor={kpi.superficieTotalHa != null ? fmtMiles(kpi.superficieTotalHa, 0) : null} unidad="ha" contexto="Suma de cultivos del informe ACUM_INF" />
                <Kpi etiqueta="Años altos contra bajos" valor={kpi.altosVsBajos ? `${fmt(kpi.altosVsBajos.veces, 1)}×` : null}
                    contexto={kpi.altosVsBajos
                        ? <>Superficie media <b>{fmtMiles(kpi.altosVsBajos.altosHa, 0)} ha</b> ({kpi.altosVsBajos.altos.join(', ')}) frente a <b>{fmtMiles(kpi.altosVsBajos.bajosHa, 0)} ha</b> ({kpi.altosVsBajos.bajos.join(', ')})</>
                        : 'Este ámbito no tiene un contraste claro'} />
            </FilaKpi>
            <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Peso de cada cultivo">
                <table className="ndvi-ia-tabla vc-tabla">
                    <caption>Peso por cultivo, {anioSel}, {ambito(modulo)}</caption>
                    <thead><tr><th scope="col">Cultivo</th><th scope="col">Superficie (ha)</th><th scope="col">% sup.</th><th scope="col">Volumen (hm³)</th><th scope="col">% vol.</th></tr></thead>
                    <tbody>
                        {mezcla.length === 0 && <tr><td colSpan={5}>{SD} sin renglones para este año.</td></tr>}
                        {mezcla.map(p => (
                            <tr key={p.cultivo}>
                                <th scope="row">{p.cultivo}</th>
                                <td className="vc-num">{p.superficieHa != null ? fmtMiles(p.superficieHa, 0) : SD}</td>
                                <td className="vc-num">{p.pctSuperficie != null ? <span className="vc-barra"><i style={{ width: `${Math.min(100, p.pctSuperficie)}%` }} aria-hidden="true" /><span>{fmt(p.pctSuperficie, 1)}</span></span> : SD}</td>
                                <td className="vc-num">{p.volumenHm3 != null ? fmt(p.volumenHm3, 1) : SD}</td>
                                <td className="vc-num">{p.pctVolumen != null ? <span className="vc-barra vol"><i style={{ width: `${Math.min(100, p.pctVolumen)}%` }} aria-hidden="true" /><span>{fmt(p.pctVolumen, 1)}</span></span> : SD}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {contraste ? (
                <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Años altos contra años bajos">
                    <table className="ndvi-ia-tabla vc-tabla">
                        <caption>Años altos ({contraste.altos.join(', ')}) contra años bajos ({contraste.bajos.join(', ')}): peso en el volumen</caption>
                        <thead><tr><th scope="col">Cultivo</th><th scope="col">% vol. altos</th><th scope="col">% vol. bajos</th><th scope="col">Diferencia (pp)</th></tr></thead>
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
            ) : <p className="ndvi-nota">Este ámbito no tiene un contraste claro entre años altos y bajos (se pide al menos 4 años y una superficie máxima 1.5 veces la mínima).</p>}
            <p className="ndvi-nota">Años «altos» y «bajos» se separan por la superficie total regada (punto medio entre el mínimo y el máximo). Es una descripción: no dice por qué cambió la superficie.</p>
        </div>
    );
};

/** Rango 2020-2024 (banda de mínimo a máximo), mediana (raya) y ciclo actual (rombo). Escala propia de cada módulo, desde cero: los números están en la tabla. */
const Rango: React.FC<{ r: ReferenciaModulo }> = ({ r }) => {
    const W = 150, H = 24, X0 = 4, X1 = W - 4;
    if (r.minHm3 == null || r.maxHm3 == null) return SD;
    const tope = Math.max(r.maxHm3, r.actualHm3 ?? 0) * 1.05;
    const x = (v: number) => X0 + (v / tope) * (X1 - X0);
    const desc = `Rango 2020-2024 de ${fmt(r.minHm3, 1)} a ${fmt(r.maxHm3, 1)} hm³${r.medianaHm3 != null ? `, mediana ${fmt(r.medianaHm3, 1)}` : ''}; ${r.actualHm3 != null ? `actual ${fmt(r.actualHm3, 1)}, ${TXT_POS[r.posicion].toLowerCase()}` : 'ciclo actual sin dato (S/D)'}`;
    return (
        <svg className="vc-rango" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
            <line x1={X0} x2={X1} y1={H / 2} y2={H / 2} className="vc-r-eje" />
            <rect x={x(r.minHm3)} y={H / 2 - 5} width={Math.max(2, x(r.maxHm3) - x(r.minHm3))} height="10" rx="2" className="vc-r-banda" />
            {r.medianaHm3 != null && <line x1={x(r.medianaHm3)} x2={x(r.medianaHm3)} y1={H / 2 - 7} y2={H / 2 + 7} className="vc-r-med" />}
            {r.actualHm3 != null && <path d={`M${x(r.actualHm3)} ${H / 2 - 8}l7 8l-7 8l-7 -8z`} className={`vc-r-act ${r.posicion}`} />}
        </svg>
    );
};

const Ciclo: React.FC<{ supVol: FilaSupVol[]; volumenActual: VolumenActual | null }> = ({ supVol, volumenActual }) => {
    const refs = useMemo(() => referenciaCicloActual(supVol, volumenActual, MODULOS), [supVol, volumenActual]);
    const kpi = useMemo(() => kpiCiclo(refs), [refs]);
    return (
        <div>
            {volumenActual == null && <p className="ndvi-nota" role="status">Cargando el volumen provisional del ciclo actual…</p>}
            {volumenActual?.error && <p className="vv-error" role="alert">No se pudo leer el volumen de la hoja SRL ({volumenActual.error}). El ciclo actual queda sin dato (S/D), no en cero.</p>}
            <FilaKpi etiqueta="Resumen del ciclo actual">
                <li className="vc-kpi">
                    <span className="vc-kpi-et">Módulos contra el rango 2020-2024</span>
                    <span className={`vc-kpi-cifra${kpi.modulosConDato ? ' txt' : ' sd'}`}>{kpi.modulosConDato ? `${kpi.dentro + kpi.sobre + kpi.bajo} de ${kpi.modulosTotal}` : 'S/D'}</span>
                    <span className="vc-posiciones">
                        <span className="vc-pos"><CircleCheck size={14} aria-hidden="true" /><b>{kpi.dentro}</b> dentro</span>
                        <span className="vc-pos"><TrendingUp size={14} aria-hidden="true" /><b>{kpi.sobre}</b> sobre</span>
                        <span className="vc-pos"><TrendingDown size={14} aria-hidden="true" /><b>{kpi.bajo}</b> bajo</span>
                        {kpi.sinDato > 0 && <span className="vc-pos"><b>{kpi.sinDato}</b> S/D</span>}
                    </span>
                </li>
                <Kpi etiqueta="Volumen actual (mar–sep)" valor={kpi.actualHm3 != null ? fmt(kpi.actualHm3, 1) : null} unidad="hm³ provisional"
                    contexto={kpi.modulosConDato < kpi.modulosTotal && kpi.modulosConDato > 0 ? `Suma de ${kpi.modulosConDato} de ${kpi.modulosTotal} módulos con dato` : 'Hoja SRL, sin conciliar con ACUM_INF'}
                    estado={kpi.incompletos > 0 ? { tipo: 'warn', texto: `${kpi.incompletos} ${kpi.incompletos === 1 ? 'módulo' : 'módulos'} con volumen incompleto` } : undefined} />
                <Kpi etiqueta="Contra la mediana" valor={kpi.pctVsMediana != null ? `${sg(kpi.pctVsMediana, 0)} %` : null}
                    contexto={kpi.medianaHm3 != null ? <>Mediana 2020-2024 de esos mismos módulos: <b>{fmt(kpi.medianaHm3, 1)} hm³</b></> : 'Sin base de comparación'} />
            </FilaKpi>
            <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label="Ciclo actual contra el rango 2020-2024">
                <table className="ndvi-ia-tabla vc-tabla">
                    <caption>Volumen entregado mar–sep: ciclo actual (provisional) contra 2020-2024 (hm³)</caption>
                    <thead><tr><th scope="col">Módulo</th><th scope="col">Mín.</th><th scope="col">Mediana</th><th scope="col">Máx.</th><th scope="col">Rango y actual</th><th scope="col">Actual</th><th scope="col">vs mediana</th><th scope="col">Lectura</th></tr></thead>
                    <tbody>
                        {refs.map(r => (
                            <tr key={r.modulo}>
                                <th scope="row">{r.modulo}</th>
                                <td className="vc-num">{r.minHm3 != null ? fmt(r.minHm3, 1) : SD}</td>
                                <td className="vc-num">{r.medianaHm3 != null ? fmt(r.medianaHm3, 1) : SD}</td>
                                <td className="vc-num">{r.maxHm3 != null ? fmt(r.maxHm3, 1) : SD}</td>
                                <td className="vc-rango-celda"><Rango r={r} /></td>
                                <td className="vc-num">{r.actualHm3 != null ? <>{fmt(r.actualHm3, 1)}<span className="vv-prov"> provisional</span></> : SD}</td>
                                <td className="vc-num">{r.pctVsMediana != null ? `${sg(r.pctVsMediana, 0)} %` : SD}</td>
                                <td className="vv-lect">{TXT_POS[r.posicion]}{r.actualIncompleto && <span className="vv-warn"> ⚠ volumen incompleto</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="ndvi-nota">La hoja SRL no desglosa por cultivo: la comparación es solo por módulo. 2020-2024 sale del informe ACUM_INF (corte de septiembre) y el ciclo actual de la hoja SRL, provisional; ambas fuentes no están conciliadas. Con 5 años el rango es una referencia, no un intervalo estadístico. En el gráfico, la banda es el rango 2020-2024, la raya la mediana y el rombo el ciclo actual; cada módulo usa su propia escala desde cero.</p>
        </div>
    );
};

export const VolumenCultivos: React.FC<{ vista: VistaCultivo; supVol: FilaSupVol[]; volumenActual: VolumenActual | null }> = ({ vista, supVol, volumenActual }) => {
    if (!supVol.length) return <p className="vv-vacio">S/D: no hay informe ACUM_INF cargado.</p>;
    return vista === 'lamina' ? <Lamina supVol={supVol} /> : vista === 'mezcla' ? <Mezcla supVol={supVol} /> : <Ciclo supVol={supVol} volumenActual={volumenActual} />;
};

export default VolumenCultivos;
