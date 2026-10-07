import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { MESES_LARGO, NOMBRE_PRESA, type PresaId, type TipoSerie, type Indice } from '../../utils/historicoPresas';
import {
    avisosConfig, etiquetaPeriodo, MAX_ANIOS_COMPARAR, METRICAS_INF, ORDEN_SECCIONES, PRESETS, SECCIONES, SECCIONES_POR_DEFECTO,
    seccionesDe, validarConfig, type ConfigInforme, type MetricaInf, type Modalidad, type PeriodoTipo, type SeccionId,
} from '../../utils/informeHistoricoConfig';
import { useModalA11y } from './useModalA11y';
import VistaPreviaInforme from './VistaPreviaInforme';

interface Props { abierto: boolean; onCerrar: () => void; anios: number[]; indice: Indice; inicial: ConfigInforme }

const PRESAS: PresaId[] = ['PRE-001', 'PRE-002'];
const PERIODOS: { v: PeriodoTipo; l: string }[] = [
    { v: 'mes', l: 'Un mes' }, { v: 'rangoMeses', l: 'Rango de meses' }, { v: 'anio', l: 'Año completo' }, { v: 'cicloAgricola', l: 'Ciclo agrícola' },
];
const MODALIDADES: { v: Modalidad; t: string; d: string }[] = [
    { v: 'basico', t: 'Básico', d: 'Visual y práctico, una página por presa' },
    { v: 'tecnico', t: 'Técnico', d: 'Metodología, estadística y anexo' },
];
const COLORES = ['#3987e5', '#d95926', '#199e70'];

const alternar = <T,>(lista: T[], x: T) => (lista.includes(x) ? lista.filter(y => y !== x) : [...lista, x]);

function Segmentado<T extends string>({ valor, opciones, onCambio, etiqueta }: { valor: T; opciones: { v: T; l: string }[]; onCambio: (v: T) => void; etiqueta: string }) {
    return (
        <div className="ah-seg" role="radiogroup" aria-label={etiqueta}>
            {opciones.map(o => (
                <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} className={valor === o.v ? 'is-on' : ''} onClick={() => onCambio(o.v)}>{o.l}</button>
            ))}
        </div>
    );
}

function SelMes({ valor, onCambio, etiqueta }: { valor: number; onCambio: (m: number) => void; etiqueta: string }) {
    return (
        <select className="ah-select ah-inf-sel" value={valor} onChange={e => onCambio(Number(e.target.value))} aria-label={etiqueta}>
            {MESES_LARGO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
    );
}

export default function FiltroInformeHistorico(props: Props) {
    // Se monta solo mientras está abierto: el estado local parte de `inicial` en cada apertura.
    return props.abierto ? <Contenido {...props} /> : null;
}

function Contenido({ onCerrar, anios, indice, inicial }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const [c, setC] = useState<ConfigInforme>(inicial);
    const [previa, setPrevia] = useState<ConfigInforme | null>(null);
    const [excedido, setExcedido] = useState(false);

    useModalA11y(dialogRef, previa == null, onCerrar);

    const set = (p: Partial<ConfigInforme>) => setC(prev => ({ ...prev, ...p }));
    const setPeriodo = (p: Partial<ConfigInforme['periodo']>) => setC(prev => ({ ...prev, periodo: { ...prev.periodo, ...p } }));

    const errores = useMemo(() => validarConfig(c, anios), [c, anios]);
    const avisos = useMemo(() => avisosConfig(c), [c]);
    const secDisponibles = useMemo(() => seccionesDe(c.modalidad), [c.modalidad]);

    const cambiarBase = (a: number) => { setExcedido(false); set({ anioBase: a, aniosComparar: c.aniosComparar.filter(x => x !== a) }); };
    const alternarComparar = (a: number) => {
        if (c.aniosComparar.includes(a)) { setExcedido(false); set({ aniosComparar: c.aniosComparar.filter(x => x !== a) }); return; }
        if (c.aniosComparar.length >= MAX_ANIOS_COMPARAR) { setExcedido(true); return; }
        setExcedido(false);
        set({ aniosComparar: [...c.aniosComparar, a].sort((x, y) => y - x) });
    };
    const alternarSeccion = (s: SeccionId) => {
        const n = alternar(c.secciones, s);
        set({ secciones: ORDEN_SECCIONES.filter(x => n.includes(x)) });
    };

    const resumen = useMemo(() => {
        const pr = c.presas.map(p => NOMBRE_PRESA[p]).join(' y ') || 'sin presas';
        const an = [c.anioBase, ...c.aniosComparar].map(a => (c.periodo.tipo === 'cicloAgricola' ? `${a}-${a + 1}` : a)).join(', ');
        const mt = METRICAS_INF.filter(m => c.metricas.includes(m.v)).map(m => m.l).join(', ') || 'sin métricas';
        return `Informe ${c.modalidad === 'basico' ? 'básico' : 'técnico'} de ${pr} · ${etiquetaPeriodo(c.periodo, c.anioBase)} · ${an} · ${mt} · ${c.secciones.length} ${c.secciones.length === 1 ? 'sección' : 'secciones'}`;
    }, [c]);

    const mesesOpc = c.periodo.tipo;

    return createPortal(
        <>
            <div className="ah-inf-overlay" hidden={previa != null} onMouseDown={e => { if (e.target === e.currentTarget) onCerrar(); }}>
                <div className="ah-inf-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ah-inf-t" tabIndex={-1}>
                    <header className="ah-inf-head">
                        <div>
                            <span className="ah-inf-kicker">Archivo hidrológico</span>
                            <h2 id="ah-inf-t" className="ah-inf-titulo">Informe histórico de presas</h2>
                        </div>
                        <button type="button" className="ah-btn ah-inf-btn ah-inf-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} /></button>
                    </header>

                    <div className="ah-inf-cuerpo">
                        <section className="ah-inf-bloque" aria-label="Preajustes">
                            <span className="ah-etq">Preajustes</span>
                            <div className="ah-inf-presets">
                                {PRESETS.map(p => (
                                    <button key={p.id} type="button" className="ah-inf-preset" onClick={() => { setExcedido(false); setC(prev => p.aplicar(prev, anios, new Date())); }}>
                                        <strong>{p.etiqueta}</strong><small>{p.descripcion}</small>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <section className="ah-inf-bloque" aria-label="Modalidad">
                            <span className="ah-etq">Modalidad</span>
                            <div className="ah-inf-modalidades" role="radiogroup" aria-label="Modalidad">
                                {MODALIDADES.map(m => (
                                    <button key={m.v} type="button" role="radio" aria-checked={c.modalidad === m.v} className={`ah-inf-modal${c.modalidad === m.v ? ' is-on' : ''}`}
                                        onClick={() => { if (c.modalidad !== m.v) set({ modalidad: m.v, secciones: SECCIONES_POR_DEFECTO[m.v] }); }}>
                                        <strong>{m.t}</strong><span>{m.d}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        <div className="ah-inf-cols">
                            <section className="ah-inf-bloque" aria-label="Presas">
                                <span className="ah-etq">Presas</span>
                                <div className="ah-anios" role="group" aria-label="Presas">
                                    {PRESAS.map(p => {
                                        const on = c.presas.includes(p);
                                        return <button key={p} type="button" aria-pressed={on} className={`ah-anio ah-inf-chip${on ? ' is-on' : ''}`} style={on ? { ['--c' as string]: '#38bdf8' } : undefined} onClick={() => set({ presas: alternar(c.presas, p) })}>{on && <i aria-hidden="true" />}{NOMBRE_PRESA[p]}</button>;
                                    })}
                                </div>
                            </section>

                            <section className="ah-inf-bloque" aria-label="Serie">
                                <span className="ah-etq">Serie</span>
                                <Segmentado etiqueta="Serie" valor={c.serie} onCambio={(v: TipoSerie) => set({ serie: v })} opciones={[{ v: 'normalizada', l: 'Normalizada' }, { v: 'reportada', l: 'Como se reportó' }]} />
                            </section>
                        </div>

                        <section className="ah-inf-bloque" aria-label="Periodo">
                            <span className="ah-etq">Periodo</span>
                            <Segmentado etiqueta="Tipo de periodo" valor={c.periodo.tipo} onCambio={v => setPeriodo({ tipo: v })} opciones={PERIODOS} />
                            <div className="ah-inf-fila">
                                {mesesOpc === 'mes' && <SelMes valor={c.periodo.mes} onCambio={m => setPeriodo({ mes: m })} etiqueta="Mes" />}
                                {mesesOpc === 'rangoMeses' && (
                                    <>
                                        <SelMes valor={c.periodo.mesIni} onCambio={m => setPeriodo({ mesIni: m })} etiqueta="Mes inicial" />
                                        <span className="ah-inf-a" aria-hidden="true">a</span>
                                        <SelMes valor={c.periodo.mesFin} onCambio={m => setPeriodo({ mesFin: m })} etiqueta="Mes final" />
                                    </>
                                )}
                                {mesesOpc === 'anio' && <span className="ah-inf-nota">Enero a diciembre de cada año.</span>}
                                {mesesOpc === 'cicloAgricola' && <span className="ah-inf-nota">1 de octubre a 30 de septiembre; el año base es el de inicio del ciclo.</span>}
                            </div>
                        </section>

                        <section className="ah-inf-bloque" aria-label="Años">
                            <div className="ah-inf-fila ah-inf-fila--top">
                                <div className="ah-grupo">
                                    <label className="ah-etq" htmlFor="ah-inf-base">{c.periodo.tipo === 'cicloAgricola' ? 'Año de inicio del ciclo (base)' : 'Año base'}</label>
                                    <select id="ah-inf-base" className="ah-select ah-inf-sel" value={c.anioBase} onChange={e => cambiarBase(Number(e.target.value))}>
                                        {anios.map(a => <option key={a} value={a}>{c.periodo.tipo === 'cicloAgricola' ? `${a}-${a + 1}` : a}</option>)}
                                    </select>
                                </div>
                                <div className="ah-grupo ah-grupo--anios">
                                    <span className="ah-etq">Años a comparar <em>(máx. {MAX_ANIOS_COMPARAR})</em></span>
                                    <div className="ah-anios" role="group" aria-label="Años a comparar">
                                        {anios.filter(a => a !== c.anioBase).map(a => {
                                            const i = c.aniosComparar.indexOf(a);
                                            const on = i >= 0;
                                            return <button key={a} type="button" aria-pressed={on} className={`ah-anio ah-inf-chip${on ? ' is-on' : ''}`} style={on ? { ['--c' as string]: COLORES[i % 3] } : undefined} onClick={() => alternarComparar(a)}>{on && <i aria-hidden="true" />}{c.periodo.tipo === 'cicloAgricola' ? `${a}-${a + 1}` : a}</button>;
                                        })}
                                    </div>
                                    {excedido && <p className="ah-inf-aviso-linea" role="status">Ya elegiste {MAX_ANIOS_COMPARAR} años; quita uno para agregar otro.</p>}
                                </div>
                            </div>
                        </section>

                        <section className="ah-inf-bloque" aria-label="Métricas">
                            <span className="ah-etq">Métricas</span>
                            <div className="ah-anios" role="group" aria-label="Métricas">
                                {METRICAS_INF.map(m => {
                                    const on = c.metricas.includes(m.v);
                                    return <button key={m.v} type="button" aria-pressed={on} className={`ah-anio ah-inf-chip${on ? ' is-on' : ''}`} style={on ? { ['--c' as string]: '#38bdf8' } : undefined} onClick={() => set({ metricas: alternar<MetricaInf>(c.metricas, m.v) })}>{on && <i aria-hidden="true" />}{m.l}</button>;
                                })}
                            </div>
                            <p className="ah-inf-nota">Δ aparente = cambio del almacenamiento; no es extracción ni aportación.</p>
                            <label className="ah-inf-check">
                                <input type="checkbox" checked={c.incluirParciales} onChange={e => set({ incluirParciales: e.target.checked })} />
                                <span>Incluir años parciales en promedios</span>
                            </label>
                        </section>

                        <section className="ah-inf-bloque" aria-label="Secciones">
                            <span className="ah-etq">Secciones <em>({c.secciones.length} de {secDisponibles.length})</em></span>
                            <div className="ah-inf-secciones">
                                {secDisponibles.map(s => (
                                    <label key={s} className="ah-inf-check ah-inf-check--caja">
                                        <input type="checkbox" checked={c.secciones.includes(s)} onChange={() => alternarSeccion(s)} />
                                        <span>{SECCIONES[s].etiqueta}</span>
                                    </label>
                                ))}
                            </div>
                        </section>

                        {(errores.length > 0 || avisos.length > 0) && (
                            <div className="ah-inf-mensajes">
                                {errores.length > 0 && <ul className="ah-inf-errores" role="alert">{errores.map(e => <li key={e}>{e}</li>)}</ul>}
                                {avisos.length > 0 && <ul className="ah-inf-avisos">{avisos.map(a => <li key={a}>{a}</li>)}</ul>}
                            </div>
                        )}
                    </div>

                    <footer className="ah-inf-pie">
                        <p className="ah-inf-resumen" aria-live="polite">{resumen}</p>
                        <div className="ah-inf-pie-acc">
                            <button type="button" className="ah-btn ah-inf-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ah-btn ah-inf-btn ah-inf-btn--pri" disabled={errores.length > 0} onClick={() => setPrevia(c)}><FileText size={16} /> Generar vista previa</button>
                        </div>
                    </footer>
                </div>
            </div>
            {previa && <VistaPreviaInforme config={previa} indice={indice} onVolver={() => setPrevia(null)} onCerrar={onCerrar} />}
        </>,
        document.body,
    );
}
