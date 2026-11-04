import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, CircleCheck, Info, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { fmt, fmtMiles } from '../../utils/formato';
import type { FilaSupVol } from '../../utils/ndviInteranual';
import type { VolumenActual } from '../../utils/ndviVolumen';
import { ANIOS_SIN_CICLO, RANGO_INFORME, TEXTO_SIN_CICLO, esAnioSinCiclo, rotuloAnio } from '../../utils/estadoAnio';
import {
    UMBRAL_HA_MUESTRA, aniosConInforme, barrasSuperficieAnual, barrasVolumenAnual, cifraContraste, contrasteRegimenes, fraseContrasteSuperficie, kpiCiclo, kpiLamina, kpiMezcla,
    laminaPorCultivo, lecturaVsTipico, mezclaCultivos, referenciaCicloActual, topConOtros, kpiTecnico, intensidadHidrica, lecturaIntensidad, reporteCiclo,
    type BarraAnio, type CeldaCultivo, type FilaReporteCiclo, type IntensidadCultivo, type ParteTop, type PosicionCiclo, type ReferenciaModulo, type SerieCultivo,
} from '../../utils/volumenCultivo';
import { composicionAnual, estadoCultivoEnAnio, fraseCambioMezcla, marcaAnioIncompleto, notaIncompleta, notaTodosIncompletos, textoSinCifra, type FilaComposicion } from '../../utils/volumenCultivo';
import { CULTIVO_OTROS, infoCultivo, fondoTramaCss } from '../../utils/cultivos';
import { IconoCultivo, NombreCultivo, estiloCultivo } from './IconoCultivo';
import { fetchVolumenCiclo } from '../../utils/volumenCiclo';
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
    /** Cultivos que menciona la tarjeta: sus íconos van junto a la etiqueta y el filete toma su color. */
    cultivos?: string[];
    /** Cultivo que ES el valor (la cifra grande): ícono delante del nombre. */
    cultivoValor?: string | null;
}> = ({ etiqueta, valor, unidad, texto, lectura, estado, cultivos, cultivoValor }) => {
    const ids = cultivos?.length ? cultivos : cultivoValor ? [cultivoValor] : [];
    // Filete de acento: el color del cultivo; con dos cultivos, un degradado de uno al otro.
    const estilo = ids.length ? { ...estiloCultivo(ids[0]), ...(ids[1] ? { '--cu2': infoCultivo(ids[1]).color, '--cu2-l': infoCultivo(ids[1]).colorClaro } : {}) } as React.CSSProperties : undefined;
    return (
    <li className={`vc-kpi${ids.length ? ' vc-cu' : ''}${ids.length > 1 ? ' dos' : ''}`} style={estilo}>
        <span className="vc-kpi-et"><span>{etiqueta}</span>{cultivos?.length ? <span className="vc-kpi-ico" aria-hidden="true">{cultivos.map(c => <span key={c} className="vc-cu" style={estiloCultivo(c)}><span className="vc-ncu-ico"><IconoCultivo nombre={c} size={18} /></span></span>)}</span> : null}</span>
        <span className={`vc-kpi-cifra${valor == null ? ' sd' : ''}${texto && valor != null ? ' txt' : ''}`}>{cultivoValor && valor != null && <span className="vc-cu vc-kpi-ico1" style={estiloCultivo(cultivoValor)}><span className="vc-ncu-ico"><IconoCultivo nombre={cultivoValor} size={22} /></span></span>}{valor ?? 'S/D'}{valor != null && unidad && <small>{unidad}</small>}</span>
        <span className="vc-kpi-ctx">{lectura}</span>
        {estado && <span className={`vc-estado ${estado.tipo}`}><IconoEstado tipo={estado.tipo} />{estado.texto}</span>}
    </li>
    );
};
const FilaKpi: React.FC<{ etiqueta: string; children: React.ReactNode; /** Cuatro tarjetas: 4 columnas, luego 2×2 y 1 columna (sin tarjeta huérfana). */ cuatro?: boolean }> = ({ etiqueta, children, cuatro }) => <ul className={`vc-kpis${cuatro ? ' cuatro' : ''}`} aria-label={etiqueta}>{children}</ul>;

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
                {barras.map((b, i) => (
                    <div key={b.anio} className={`vc-col ${b.estado}`} style={{ '--i': i } as React.CSSProperties}>
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
        <li className="vc-fila-lam vc-cu" style={estiloCultivo(s.cultivo)}>
            <span className="vc-fila-nom"><NombreCultivo nombre={s.cultivo} /></span>
            <div className="vc-track vc-track-cu" role="img" aria-label={aria}>
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
                <Kpi etiqueta="Cultivo que más agua recibe por hectárea" texto valor={kpi.cultivoMayor?.cultivo ?? null} cultivoValor={kpi.cultivoMayor?.cultivo ?? null}
                    lectura={kpi.cultivoMayor ? <><b>{fmt(kpi.cultivoMayor.laminaCm, 0)} cm</b> por hectárea en {kpi.anio}, entre cultivos de {UMBRAL_HA_MUESTRA} ha o más.</> : 'Ningún cultivo tiene superficie suficiente para compararse.'}
                    estado={kpi.cultivoMayor ? { tipo: 'info', texto: 'Solo cultivos con muestra firme' } : undefined} />
                <Kpi etiqueta="Cifras por revisar" valor={kpi.celdas ? String(kpi.alertas) : null} unidad={kpi.celdas ? `de ${kpi.celdas}` : undefined}
                    lectura="Cifras raras o con poca superficie. Se muestran marcadas, no se corrigen."
                    estado={kpi.celdas ? (kpi.alertas > 0 ? { tipo: 'warn', texto: 'Leer con cuidado' } : { tipo: 'ok', texto: 'Sin cifras raras' }) : undefined} />
            </FilaKpi>
            <section className="vc-tarjeta" aria-labelledby="vc-t-lam">
                <h5 id="vc-t-lam">Agua entregada por hectárea, cada cultivo y año</h5>
                <p className="vc-sub">Cada punto es un año. La banda va del año con menos agua al año con más. Más a la derecha = más agua por hectárea.</p>
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
                                    <th scope="row"><NombreCultivo nombre={s.cultivo} compacto /></th>
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

const BarrasPart: React.FC<{ partes: ParteTop[]; titulo: string; tipo: 'agua' | 'sup'; unidad: string; dec: number; /** Máximo común (en %) para que dos tarjetas se lean en la misma escala. */ escala?: number }> = ({ partes, titulo, tipo, unidad, dec, escala }) => {
    const max = Math.max(1, escala ?? 0, ...partes.map(p => p.pct));
    const aria = `${titulo}: ${partes.map(p => `${p.nombre} ${fmt(p.pct, 0)} %`).join('; ')}`;
    return (
        <section className="vc-tarjeta" aria-label={titulo}>
            <h5>{titulo}</h5>
            {partes.length === 0 ? <p className="vc-sub">{SD} sin cifras para este año.</p> : (
                <ol className="vc-part" aria-label={aria}>
                    {partes.map((p, k) => (
                        <li key={p.nombre} className="vc-cu" style={{ ...estiloCultivo(p.esOtros ? CULTIVO_OTROS.nombre : p.nombre), '--i': k } as React.CSSProperties} title={p.esOtros ? p.cultivos.join(', ') : undefined}>
                            <span className="vc-part-nom"><NombreCultivo nombre={p.esOtros ? CULTIVO_OTROS.nombre : p.nombre} texto={p.nombre} /></span>
                            <span className="vc-part-pista" aria-hidden="true"><i className={`${tipo}${p.esOtros ? ' otros' : ''}`} style={{ ...(p.esOtros ? { background: fondoTramaCss(CULTIVO_OTROS.trama, 'var(--c)') } : {}), width: `${Math.max(1.5, (p.pct / max) * 100)}%` }} /></span>
                            <span className="vc-part-val"><b>{fmt(p.pct, 0)} %</b>{p.valor != null && <small>{unidad === 'ha' ? fmtMiles(p.valor, 0) : fmt(p.valor, dec)} {unidad}</small>}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
};

/** «+12 % frente a 2024», «sin año anterior para comparar»: la variación frente al año anterior con informe, o S/D si falta alguno de los dos. */
const variacion = (pct: number | null, anterior: number | null, que: string): string =>
    anterior == null ? `Sin año anterior con informe para comparar ${que}.` : pct == null ? `Variación frente a ${anterior}: S/D.` : `${sg(pct, 0)} % frente a ${anterior}${anterior === 2024 ? ' (2025 sin ciclo)' : ''}.`;

/** Intensidad hídrica: % del agua ÷ % de la superficie de cada cultivo. 1× = recibe el agua que le toca por su superficie. Barra divergente desde 1×. */
const Intensidad: React.FC<{ filas: IntensidadCultivo[]; anio: number | null }> = ({ filas, anio }) => {
    const tope = Math.max(2, ...filas.map(f => f.indice)) * 1.05;
    const pos = (v: number) => `${(v / tope) * 100}%`;
    const aria = `Agua frente a superficie por cultivo en ${anio}: ${filas.map(f => `${f.cultivo} ${lecturaIntensidad(f.indice).cifra === 'Lo justo' ? 'recibe lo justo' : `recibe ${lecturaIntensidad(f.indice).cifra} de lo que le toca`}`).join('; ')}`;
    return (
        <section className="vc-tarjeta" aria-labelledby="vc-t-int">
            <h5 id="vc-t-int">¿Qué cultivos reciben más agua de la que les toca por su superficie? ({anio})</h5>
            <p className="vc-sub">Cada barra compara el % del agua con el % de la superficie del cultivo. La raya central es lo justo: recibe el agua que le toca por su superficie. A la derecha recibe más; a la izquierda, menos. Solo cultivos con {UMBRAL_HA_MUESTRA} ha o más.</p>
            {filas.length === 0 ? <p className="vc-sub">{SD} sin cultivos con cifras suficientes para este año.</p> : (
                <ol className="vc-int" aria-label={aria}>
                    {filas.map((f, k) => {
                        const izq = Math.min(1, f.indice), der = Math.max(1, f.indice);
                        return (
                            <li key={f.cultivo} className="vc-cu" style={{ ...estiloCultivo(f.cultivo), '--i': k } as React.CSSProperties}>
                                <span className="vc-part-nom"><NombreCultivo nombre={f.cultivo} /></span>
                                <span className="vc-int-pista" aria-hidden="true">
                                    <i className={f.indice >= 1 ? 'mas' : 'menos'} style={{ left: pos(izq), width: `max(4px, calc(${pos(der)} - ${pos(izq)}))` }} />
                                    <span className="vc-int-uno" style={{ left: pos(1) }} />
                                </span>
                                <span className="vc-part-val"><b>{lecturaIntensidad(f.indice).cifra}</b><small>{f.laminaCm != null ? `${fmt(f.laminaCm, 0)} cm` : 'S/D'} · {fmt(f.pctAgua, 0)} % agua / {fmt(f.pctSuperficie, 0)} % sup.</small></span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
};

// ───────────────────────── Composición por año: barras apiladas al 100 % ─────────────────────────

const OPC_CAMPO: { valor: 'volumen' | 'superficie'; texto: string; nombre: string }[] = [
    { valor: 'volumen', texto: 'Agua entregada', nombre: 'Medir por agua entregada' },
    { valor: 'superficie', texto: 'Superficie regada', nombre: 'Medir por superficie regada' },
];
const totalTxt = (f: FilaComposicion, unidad: string) => (f.total == null ? 'S/D' : unidad === 'ha' ? `${fmtMiles(f.total, 0)} ha` : `${fmt(f.total, 0)} hm³`);
const pctTxt = (p: number) => `${p < 1 ? '<1' : Math.round(p)} %`;

/** Cada barra es un año completo (100 %) dividido por cultivo, siempre en el mismo orden y con el mismo color. 2025 queda hueco «sin ciclo»; 2026 aparte, sin desglose. */
const ComposicionAnual: React.FC<{ supVol: FilaSupVol[]; modulo: number | null }> = ({ supVol, modulo }) => {
    const [campo, setCampo] = useState<'volumen' | 'superficie'>('volumen');
    const [foco, setFoco] = useState<string | null>(null);
    const [anioSel, setAnioSel] = useState<number | null>(null);
    const comp = useMemo(() => composicionAnual(supVol, modulo, campo), [supVol, modulo, campo]);
    const frase = fraseCambioMezcla(comp);
    const con = comp.filas.filter(f => f.estado === 'con-informe');
    const actual = con.find(f => f.anio === anioSel) ?? con[con.length - 1] ?? null;
    const focoInfo = comp.leyenda.find(l => l.clave === foco) ?? null;
    const queMide = campo === 'volumen' ? 'del agua entregada' : 'de la superficie regada';
    const hayDatos = con.length > 0;
    return (
        <section className="vc-tarjeta vc-comp" aria-labelledby="vc-t-comp">
            <h5 id="vc-t-comp">¿Cómo cambió la mezcla de cultivos?</h5>
            <p className="vc-sub">{hayDatos ? <>{frase} Cada barra es un año completo (100 %); toque una barra para ver sus cifras.</> : <>{SD} sin renglones del informe para este ámbito.</>}</p>
            <Segmentos etiqueta="Medir" valor={campo} opciones={OPC_CAMPO} onChange={v => { setCampo(v); setFoco(null); }} />
            {comp.todosIncompletos && <p className="vc-aviso-datos vc-aviso-global" role="note">⚠ {notaTodosIncompletos(campo)} Al enfocar una barra se ve el detalle de cada año.</p>}
            <ol className="vc-comp-filas" aria-label={`Parte ${queMide} que recibió cada cultivo, por año`}>
                {comp.filas.map((f, r) => {
                    if (f.estado === 'sin-ciclo') return <li key={f.anio} className="vc-comp-fila hueco"><span className="vc-comp-anio">{f.anio}</span><span className="vc-comp-cuerpo">Sin ciclo: presas cerradas</span><span className="vc-comp-total" /></li>;
                    if (f.estado === 'sin-desglose') return <li key={f.anio} className="vc-comp-fila hueco aparte"><span className="vc-comp-anio">{f.anio}</span><span className="vc-comp-cuerpo">Provisional: sin desglose por cultivo</span><span className="vc-comp-total" /></li>;
                    if (f.estado === 'sd') return <li key={f.anio} className="vc-comp-fila hueco"><span className="vc-comp-anio">{f.anio}</span><span className="vc-comp-cuerpo">{SD}</span><span className="vc-comp-total" /></li>;
                    return (
                        <li key={f.anio} className="vc-comp-fila">
                            <button type="button" className="vc-comp-btn" aria-pressed={actual?.anio === f.anio} onClick={() => setAnioSel(f.anio)} onFocus={() => setAnioSel(f.anio)} onMouseEnter={() => setAnioSel(f.anio)}
                                aria-label={`${f.anio}, ${totalTxt(f, comp.unidad)}: ${f.partes.map(p => `${p.nombre} ${pctTxt(p.pct)}`).join(', ')}${f.incompleta ? '. Datos incompletos en el informe' : ''}`}>
                                <span className="vc-comp-anio">{f.anio}{marcaAnioIncompleto(comp, f) && <span className="vc-comp-aviso" aria-hidden="true"> ⚠</span>}</span>
                                <span className="vc-comp-barra" aria-hidden="true">
                                    {f.partes.map((p, k) => (
                                        <span key={p.clave + k} className={`vc-segm vc-cu${p.esOtros ? ' otros' : ''}${foco && foco !== p.clave ? ' tenue' : ''}`}
                                            style={{ ...estiloCultivo(p.esOtros ? CULTIVO_OTROS.nombre : p.nombre), flexGrow: p.pct, '--i': r, ...(p.esOtros ? { background: fondoTramaCss(CULTIVO_OTROS.trama, 'var(--c)') } : {}) } as React.CSSProperties}>
                                            {p.pct >= 22 && !p.esOtros && <IconoCultivo nombre={p.nombre} size={16} />}
                                            {p.pct >= 7 && <span className={p.pct < 12 ? "chico" : undefined}>{Math.round(p.pct)} %</span>}
                                        </span>
                                    ))}
                                </span>
                                <span className="vc-comp-total">{totalTxt(f, comp.unidad)}</span>
                            </button>
                        </li>
                    );
                })}
            </ol>
            {hayDatos && (
                <div className="vc-chips-cu" role="group" aria-label="Resaltar un cultivo">
                    {comp.leyenda.map(l => (
                        <button key={l.clave + l.nombre} type="button" className={`vc-chip-cu vc-cu${l.esOtros ? ' otros' : ''}`} aria-pressed={foco === l.clave} title={l.esOtros ? l.cultivos.join(', ') : undefined}
                            style={estiloCultivo(l.esOtros ? CULTIVO_OTROS.nombre : l.nombre)} onClick={() => setFoco(foco === l.clave ? null : l.clave)}>
                            <span className="vc-ncu-ico"><IconoCultivo nombre={l.esOtros ? CULTIVO_OTROS.nombre : l.nombre} size={16} /></span>{l.nombre}
                        </button>
                    ))}
                </div>
            )}
            {hayDatos && (
                <div className="vc-lectura" aria-live="polite">
                    {focoInfo ? (
                        <>
                            <b>{focoInfo.nombre}: su parte {queMide}, año por año</b>
                            {focoInfo.esOtros && <p className="vc-otros-lista"><b>Agrupa {focoInfo.cultivos.length} cultivos:</b> {focoInfo.cultivos.join(', ')}.</p>}
                            <ul>{con.map(f => {
                                const e = estadoCultivoEnAnio(f, focoInfo);
                                return <li key={f.anio}>{f.anio}{marcaAnioIncompleto(comp, f) && <span aria-label="datos incompletos"> ⚠</span>} <b>{e.tipo === 'parte' ? pctTxt(e.pct) : e.tipo === 'sin-cifra' ? textoSinCifra(campo) : 'no aparece'}</b></li>;
                            })}</ul>
                        </>
                    ) : actual && (
                        <>
                            <b>{actual.anio}: {totalTxt(actual, comp.unidad)} {campo === 'volumen' ? 'de agua entregada' : 'regadas'}</b>
                            {notaIncompleta(actual, campo) && <p className="vc-aviso-datos" role="note">{notaIncompleta(actual, campo)}</p>}
                            <ul>{[...actual.partes].sort((a, b) => b.pct - a.pct).map(p => (
                                <li key={p.clave + p.nombre} className="vc-cu" style={estiloCultivo(p.esOtros ? CULTIVO_OTROS.nombre : p.nombre)}>
                                    <span className="vc-ncu-ico"><IconoCultivo nombre={p.esOtros ? CULTIVO_OTROS.nombre : p.nombre} size={16} /></span>{p.nombre} <b>{pctTxt(p.pct)}</b>
                                </li>))}</ul>
                        </>
                    )}
                </div>
            )}
            {hayDatos && <p className="ndvi-nota">Los porcentajes se redondean; pueden sumar 99 o 101 %. «Varios» = cultivos sin desglose en el informe.{con.some(f => marcaAnioIncompleto(comp, f)) ? ' ⚠ = el informe trae un renglón sin cifra o con captura atípica: el total y los porcentajes de ese año son sobre datos incompletos.' : ''}</p>}
        </section>
    );
};

const Mezcla: React.FC<{ supVol: FilaSupVol[]; moduloInicial?: number | null }> = ({ supVol, moduloInicial = null }) => {
    const [modulo, setModulo] = useState<number | null>(moduloInicial);
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
    const escalaComun = Math.max(1, ...topAgua.map(p => p.pct), ...topSup.map(p => p.pct));
    const tec = useMemo(() => kpiTecnico(supVol, modulo, sinCiclo ? null : anioSel), [supVol, modulo, anioSel, sinCiclo]);
    const intensidad = useMemo(() => intensidadHidrica(mezcla), [mezcla]);
    const barrasSup = useMemo(() => barrasSuperficieAnual(supVol, modulo), [supVol, modulo]);
    const fraseContr = fraseContrasteSuperficie(kpiRef.altosVsBajos);
    const opcionesAnio = [...anios, ...ANIOS_SIN_CICLO].map(a => ({ valor: a, texto: rotuloAnio(a), nombre: esAnioSinCiclo(a) ? `${a}, sin ciclo de riego` : String(a) }));
    return (
        <div className="vc-cq">
            <Ambito modulo={modulo} onChange={setModulo} />
            <Segmentos etiqueta="Año" valor={anioSel} opciones={opcionesAnio} onChange={setAnio} />
            {sinCiclo && anioSel != null ? <TarjetaSinCiclo anio={anioSel} /> : (
                <>
                    <FilaKpi etiqueta="Resumen técnico del año" cuatro>
                        <Kpi etiqueta={`Agua entregada en ${anioSel ?? 'el último año'}`} valor={tec.volumenHm3 != null ? fmt(tec.volumenHm3, 1) : null} unidad="hm³"
                            lectura={`${ambito(modulo)}. ${variacion(tec.volumenVsAnteriorPct, tec.anioAnterior, 'agua')}`}
                            estado={{ tipo: 'info', texto: 'Informe ACUM_INF' }} />
                        <Kpi etiqueta={`Superficie regada en ${anioSel ?? 'el último año'}`} valor={tec.superficieHa != null ? fmtMiles(tec.superficieHa, 0) : null} unidad="ha"
                            lectura={`Suma de todos los cultivos. ${variacion(tec.superficieVsAnteriorPct, tec.anioAnterior, 'superficie')}`} estado={{ tipo: 'info', texto: 'Dato del informe' }} />
                        <Kpi etiqueta="Lámina media" valor={tec.laminaMediaCm != null ? fmt(tec.laminaMediaCm, 0) : null} unidad="cm"
                            lectura="Agua entregada por hectárea: volumen ÷ superficie de todos los cultivos. No es consumo de la planta."
                            estado={{ tipo: 'info', texto: 'Calculado' }} />
                        <Kpi etiqueta="Alfalfa y nogal" cultivos={['Alfalfa', 'Nogal']} valor={kpi.pctVolumenAlfalfaNogal != null ? `${fmt(kpi.pctVolumenAlfalfaNogal, 0)} %` : null}
                            lectura={`del agua entregada en ${anioSel ?? 'el último año'} (${ambito(modulo)}).`}
                            estado={kpi.pctVolumenAlfalfaNogal != null ? { tipo: 'info', texto: kpi.pctVolumenAlfalfaNogal >= 50 ? 'Más de la mitad del agua' : 'Menos de la mitad del agua' } : undefined} />
                    </FilaKpi>
                    {fraseContr && <p className="vc-contraste"><Info size={14} aria-hidden="true" /><span><b>{cifraContraste(kpiRef.altosVsBajos)}:</b> {fraseContr} Describe, no explica.</span></p>}
                    <div className="vc-dos">
                        <BarrasPart partes={topAgua} titulo={`¿Qué cultivos reciben el agua? (${anioSel})`} tipo="agua" unidad="hm³" dec={1} escala={escalaComun} />
                        <BarrasPart partes={topSup} titulo={`¿Cuánta superficie ocupa cada cultivo? (${anioSel})`} tipo="sup" unidad="ha" dec={0} escala={escalaComun} />
                    </div>
                    <p className="vc-sub vc-escala">Las dos columnas de barras usan la misma escala (porcentaje del total del año), así que se comparan a simple vista.</p>
                    <Intensidad filas={intensidad} anio={anioSel} />
                </>
            )}
            <ComposicionAnual supVol={supVol} modulo={modulo} />
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
                                        <th scope="row"><NombreCultivo nombre={p.cultivo} compacto /></th>
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
                                            <th scope="row"><NombreCultivo nombre={c.cultivo} compacto /></th>
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

/** Reporte del ciclo por módulo: lo autorizado contra lo entregado (informe ACUM_INF), la superficie, el cultivo que más agua recibe y la posición frente al año típico. Cada fila enlaza al panel de cultivos. */
const TarjetaReporteCiclo: React.FC<{ filas: FilaReporteCiclo[]; anio: number; ciclo: string | null; cargando: boolean; sinAutorizado: boolean; onVerCultivos?: (modulo: number | null) => void }> = ({ filas, anio, ciclo, cargando, sinAutorizado, onVerCultivos }) => (
    <section className="vc-tarjeta vc-rep" aria-labelledby="vc-t-rep">
        <h5 id="vc-t-rep">Reporte del ciclo {anio} por módulo: autorizado contra entregado</h5>
        <p className="vc-sub">{ciclo ? `${ciclo}. ` : ''}«Plan» = volumen autorizado del ciclo; todavía no hay un plan de cultivos cargado. Entregado = informe ACUM_INF. {cargando ? 'Cargando el volumen autorizado…' : sinAutorizado ? 'No se pudo leer el volumen autorizado: queda S/D, no en cero.' : ''}</p>
        <ul className="vc-rep-lista">
            {[...filas.slice(-1), ...filas.slice(0, -1)].map(f => {
                const nombre = f.modulo == null ? 'Todo el distrito' : `Módulo ${f.modulo}`;
                const pct = f.pctAutorizado;
                const P = POS[f.posicion];
                return (
                    <li key={f.modulo ?? 'distrito'} className={`vc-rep-fila${f.modulo == null ? ' total' : ''}`}>
                        <div className="vc-rep-cab">
                            <b>{nombre}</b>
                            {f.modulo != null && f.posicion !== 'sin-dato' && <span className={`vc-chip ${f.posicion}`}><P.Icono size={14} aria-hidden="true" />{P.texto} {RANGO_INFORME}</span>}
                            {onVerCultivos && <button type="button" className="vc-rep-ver" onClick={() => onVerCultivos(f.modulo)} aria-label={`Ver los cultivos de ${f.modulo == null ? 'todo el distrito' : nombre} en ${anio}`}>Ver cultivos <ChevronRight size={14} aria-hidden="true" /></button>}
                        </div>
                        <div className="vc-rep-barra" role="img" aria-label={pct != null ? `${nombre}: ${fmt(pct, 0)} % de lo autorizado` : `${nombre}: sin dato de lo autorizado (S/D)`}>
                            <div className="vc-rep-pista"><i className={pct != null && pct > 100 ? 'sobre' : ''} style={{ width: `${pct != null ? Math.min(100, Math.max(1.5, pct)) : 0}%` }} /></div>
                            <span className="vc-rep-pct">{pct != null ? `${fmt(pct, 0)} %` : SD}</span>
                        </div>
                        <p className="vc-rep-txt">
                            {f.entregadoHm3 != null ? <b>{fmt(f.entregadoHm3, 1)}</b> : SD} de {f.autorizadoHm3 != null ? <><b>{fmt(f.autorizadoHm3, 1)}</b> hm³ autorizados</> : <>{SD} (autorizado)</>}
                            {f.saldoHm3 != null && <> · {f.saldoHm3 >= 0 ? `saldo ${fmt(f.saldoHm3, 1)} hm³` : `${fmt(-f.saldoHm3, 1)} hm³ por encima de lo autorizado`}</>}
                        </p>
                        <dl className="vc-rep-datos">
                            <div><dt>Superficie</dt><dd>{f.superficieHa != null ? `${fmtMiles(f.superficieHa, 0)} ha` : SD}</dd></div>
                            <div><dt>Lámina</dt><dd>{f.laminaCm != null ? `${fmt(f.laminaCm, 0)} cm` : SD}</dd></div>
                            <div><dt>Cultivo con más agua</dt><dd>{f.cultivoLider ? <><NombreCultivo nombre={f.cultivoLider.cultivo} compacto /> {fmt(f.cultivoLider.pctAgua, 0)} %</> : SD}</dd></div>
                            <div><dt>Frente a un año típico</dt><dd>{f.pctVsTipico != null ? `${sg(f.pctVsTipico, 0)} %` : SD}</dd></div>
                        </dl>
                    </li>
                );
            })}
        </ul>
    </section>
);

/** Diferencia hoja SRL − informe: «coincide» si es menor a 0.05 hm³ (evita «−0.0»); si no, con signo y unidad. */
const difSrl = (d: number): string => (Math.abs(d) < 0.05 ? 'coincide con el informe' : `${sg(d, 1)} hm³ frente al informe`);

const Ciclo: React.FC<{ supVol: FilaSupVol[]; volumenActual: VolumenActual | null; onVerCultivos?: (modulo: number | null) => void }> = ({ supVol, volumenActual, onVerCultivos }) => {
    const refs = useMemo(() => referenciaCicloActual(supVol, volumenActual, MODULOS), [supVol, volumenActual]);
    // Volumen autorizado del ciclo (vista única volumen_ciclo_modulo). null = cargando; mapa vacío = sin autorización leída (S/D, no 0).
    const [autor, setAutor] = useState<{ mapa: Map<number, number>; ciclo: string | null } | null>(null);
    useEffect(() => {
        let vivo = true;
        fetchVolumenCiclo().then(rows => {
            if (!vivo) return;
            const mapa = new Map<number, number>();
            for (const r of rows) if (r.numeroModulo != null && r.autorizadoMm3 > 0) mapa.set(r.numeroModulo, r.autorizadoMm3);
            setAutor({ mapa, ciclo: rows[0]?.cicloNombre ?? null });
        }).catch(() => { if (vivo) setAutor({ mapa: new Map(), ciclo: null }); });
        return () => { vivo = false; };
    }, []);
    const reporte = useMemo(() => reporteCiclo(supVol, refs, autor?.mapa ?? new Map()), [supVol, refs, autor]);
    const kpi = useMemo(() => kpiCiclo(refs), [refs]);
    const barras = useMemo(() => barrasVolumenAnual(supVol, volumenActual, null, MODULOS), [supVol, volumenActual]);
    const lect = lecturaVsTipico(kpi.pctVsMediana);
    const ultAnio = barras.length ? barras[barras.length - 1].anio : 2026;
    // Fuente del ciclo comparado: ACUM_INF (ciclo terminado) o, si falta, la hoja SRL provisional.
    const conInforme = refs.filter(r => r.fuenteActual === 'informe').length;
    const soloSrl = refs.filter(r => r.fuenteActual === 'srl').length;
    const ambas = refs.filter(r => r.informeHm3 != null && r.srlHm3 != null);
    const sumaInf = ambas.reduce((a, r) => a + (r.informeHm3 as number), 0), sumaSrl = ambas.reduce((a, r) => a + (r.srlHm3 as number), 0);
    const hayContraste = ambas.length > 0;
    return (
        <div className="vc-cq">
            {volumenActual == null && <p className="ndvi-nota" role="status">Cargando el volumen de la hoja SRL (contraste del ciclo)…</p>}
            {volumenActual?.error && <p className="vv-error" role="alert">No se pudo leer el volumen de la hoja SRL ({volumenActual.error}). Sin ese contraste, el ciclo se lee solo del informe ACUM_INF; un módulo sin dato queda S/D, no en cero.</p>}
            <FilaKpi etiqueta="Resumen del ciclo">
                <Kpi etiqueta={soloSrl > 0 && conInforme === 0 ? `Agua entregada de marzo a septiembre ${ultAnio}` : `Agua entregada en el ciclo ${ultAnio}`} valor={kpi.actualHm3 != null ? fmt(kpi.actualHm3, 1) : null} unidad={soloSrl > 0 && conInforme === 0 ? 'hm³ (provisional)' : 'hm³'}
                    lectura={conInforme > 0
                        ? <>Informe ACUM_INF, corte de septiembre{kpi.modulosConDato < kpi.modulosTotal ? `; suma de ${kpi.modulosConDato} de ${kpi.modulosTotal} módulos con dato` : ''}.{hayContraste ? <> La hoja SRL (mar–sep) da {fmt(sumaSrl, 1)} hm³ ({difSrl(sumaSrl - sumaInf)}): fuentes no conciliadas.</> : null}</>
                        : kpi.modulosConDato < kpi.modulosTotal && kpi.modulosConDato > 0 ? `Suma de ${kpi.modulosConDato} de ${kpi.modulosTotal} módulos con dato. Hoja SRL, sin conciliar con ACUM_INF.` : 'Hoja SRL, todavía sin conciliar con el informe ACUM_INF.'}
                    estado={kpi.incompletos > 0 ? { tipo: 'warn', texto: `${kpi.incompletos} ${kpi.incompletos === 1 ? 'módulo' : 'módulos'} con meses incompletos` } : conInforme > 0 && soloSrl === 0 ? { tipo: 'ok', texto: 'Ciclo terminado' } : { tipo: 'info', texto: 'Provisional' }} />
                <Kpi etiqueta={`Frente a un año típico ${RANGO_INFORME}`} texto valor={lect?.cifra ?? null}
                    lectura={lect ? lect.frase : 'Sin base de comparación.'}
                    estado={lect ? { tipo: 'info', texto: kpi.medianaHm3 != null ? `Año típico: ${fmt(kpi.medianaHm3, 1)} hm³` : 'Año típico' } : undefined} />
                <Kpi etiqueta="Módulos dentro del rango" texto={false} valor={kpi.modulosConDato ? `${kpi.dentro} de ${kpi.modulosTotal}` : null}
                    lectura={<>El rango va del año con menos agua al año con más en {RANGO_INFORME}.{kpi.modulosConDato ? <> {kpi.sobre} arriba, {kpi.bajo} debajo{kpi.sinDato ? `, ${kpi.sinDato} sin dato` : ''}.</> : null}</>}
                    estado={kpi.modulosConDato ? (kpi.dentro === kpi.modulosConDato ? { tipo: 'ok', texto: 'Todos dentro' } : { tipo: 'info', texto: 'Algunos fuera del rango' }) : undefined} />
            </FilaKpi>
            <section className="vc-tarjeta" aria-label="Agua entregada por año">
                <BarrasAnio barras={barras} unidad="hm³" decimales={0} titulo="Agua entregada por ciclo (informe ACUM_INF), todo el distrito" leyendaProvisional={`${ultAnio}: hoja SRL, provisional`} />
            </section>
            <TarjetaReporteCiclo filas={reporte} anio={ultAnio} ciclo={autor?.ciclo ?? null} cargando={autor == null} sinAutorizado={autor != null && autor.mapa.size === 0} onVerCultivos={onVerCultivos} />
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
                                        ? <><b>{fmt(r.actualHm3, 1)} hm³</b> en el ciclo {ultAnio}{r.pctVsMediana != null && <> ({sg(r.pctVsMediana, 0)} % frente a un año típico)</>}. {r.difSrlInformeHm3 != null && <>Hoja SRL: {fmt(r.srlHm3 as number, 1)} hm³ ({difSrl(r.difSrlInformeHm3)}). </>}</>
                                        : <>Ciclo {ultAnio}: {SD}. </>}
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
                        <caption>Agua entregada por ciclo (hm³): ciclo {ultAnio} contra {RANGO_INFORME}, con la hoja SRL como contraste</caption>
                        <thead><tr><th scope="col">Módulo</th><th scope="col">Mínimo</th><th scope="col">Año típico</th><th scope="col">Máximo</th><th scope="col">Ciclo {ultAnio}</th><th scope="col">Frente al año típico</th><th scope="col">Hoja SRL (mar–sep)</th><th scope="col">Lectura</th></tr></thead>
                        <tbody>
                            {refs.map(r => (
                                <tr key={r.modulo}>
                                    <th scope="row">{r.modulo}</th>
                                    <td className="vc-num">{r.minHm3 != null ? fmt(r.minHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.medianaHm3 != null ? fmt(r.medianaHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.maxHm3 != null ? fmt(r.maxHm3, 1) : SD}</td>
                                    <td className="vc-num">{r.actualHm3 != null ? <>{fmt(r.actualHm3, 1)}{r.fuenteActual === 'srl' && <span className="vv-prov"> provisional</span>}</> : SD}</td>
                                    <td className="vc-num">{r.pctVsMediana != null ? `${sg(r.pctVsMediana, 0)} %` : SD}</td>
                                    <td className="vc-num">{r.srlHm3 != null ? <>{fmt(r.srlHm3, 1)}{r.difSrlInformeHm3 != null && <span className="vv-prov"> ({difSrl(r.difSrlInformeHm3)})</span>}</> : SD}</td>
                                    <td className="vv-lect">{POS[r.posicion].texto}{r.actualIncompleto && <span className="vv-warn"> ⚠ meses incompletos</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Detalle>
            <p className="ndvi-nota">El ciclo {ultAnio} y {RANGO_INFORME} salen del mismo informe ACUM_INF (corte de septiembre), así que se comparan entre iguales; el desglose por cultivo está en «Mezcla de cultivos». La hoja SRL (mar–sep) se muestra aparte como contraste y no está conciliada con el informe: una diferencia entre ambas puede ser de método y no del agua entregada. Un año típico es el año del medio de {RANGO_INFORME}; 2025 no cuenta porque las presas estuvieron cerradas. Con 5 años el rango es una referencia, no una prueba. Menos o más agua que un año típico no dice si hubo ahorro, sequía ni otra causa.</p>
        </div>
    );
};

export const VolumenCultivos: React.FC<{
    vista: VistaCultivo; supVol: FilaSupVol[]; volumenActual: VolumenActual | null;
    /** Módulo con el que abre «Mezcla de cultivos» (null = todo el distrito) y cómo pedir ese cambio de vista desde «Ciclo actual». */
    moduloInicial?: number | null; onVerCultivos?: (modulo: number | null) => void;
}> = ({ vista, supVol, volumenActual, moduloInicial = null, onVerCultivos }) => {
    if (!supVol.length) return <p className="vv-vacio">S/D: no se pudo cargar el informe ACUM_INF (sin renglones). Esto es un dato que falta cargar, no un año sin riego.</p>;
    return vista === 'lamina' ? <Lamina supVol={supVol} /> : vista === 'mezcla' ? <Mezcla key={String(moduloInicial)} supVol={supVol} moduloInicial={moduloInicial} /> : <Ciclo supVol={supVol} volumenActual={volumenActual} onVerCultivos={onVerCultivos} />;
};

export default VolumenCultivos;
