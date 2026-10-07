import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, Save, Trash2, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import { COLOR_MODULO_SRL, MODULOS_SRL_IDS } from '../../utils/modulosSRL';
import {
    INDICADORES_NDVI, MAX_PRESETS, ORDEN_SECCIONES, PRESETS_PERIODO, SECCIONES_NDVI, avisosConfig, configPorDefecto, conPreset, etiquetaPeriodo,
    comparacionPorDefecto, filtrarFilas, guardarPresets, leerPresets, mesesDisponibles, normalizaConfig, paginasEstimadas, validarConfig,
    type ConfigComparacion, type ConfigInformeNdvi, type IndicadorNdvi, type ModoNdvi, type PresetGuardado, type SeccionNdvi, type TipoComparacion,
} from '../../utils/informeNdviConfig';
import type { FilaNdviInforme } from '../../utils/informeNdviDatos';
import { generarInformeInstitucional } from '../../utils/informeNdviInstitucional';
import { SelectorChips } from './SelectorChips';
import VistaPreviaNdvi from './VistaPreviaNdvi';
import './informeNdviModal.css';

interface Props { abierto: boolean; onCerrar: () => void; filas: FilaNdviInforme[]; emisor: string | null }

const alternar = <T,>(lista: T[], x: T) => (lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x]);

export default function ConfigInformeNdviModal(props: Props) {
    // Se monta solo mientras está abierta: el estado parte limpio en cada apertura.
    return props.abierto ? <Contenido {...props} /> : null;
}

function Contenido({ onCerrar, filas, emisor }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const meses = useMemo(() => mesesDisponibles(filas), [filas]);
    const [c, setC] = useState<ConfigInformeNdvi>(() => configPorDefecto(meses));
    const [previa, setPrevia] = useState<ConfigInformeNdvi | null>(null);
    const [presets, setPresets] = useState<PresetGuardado[]>(() => leerPresets());
    const [nombre, setNombre] = useState('');
    const [avisoPresets, setAvisoPresets] = useState<string | null>(null);
    const [descargando, setDescargando] = useState(false);
    const [errDescarga, setErrDescarga] = useState<string | null>(null);

    useModalA11y(dialogRef, previa == null, onCerrar);

    const set = (p: Partial<ConfigInformeNdvi>) => setC((prev) => ({ ...prev, ...p }));
    const setCmp = (p: Partial<ConfigComparacion>) => setC((prev) => ({ ...prev, comparacion: { ...prev.comparacion, ...p } }));
    // Elegir un modo de análisis activa la sección "Análisis" (si no, el informe no lo mostraría).
    const cambiarModo = (m: ModoNdvi) => setC((prev) => ({
        ...prev, modo: m,
        secciones: m !== 'resumen' && !prev.secciones.includes('analisis') ? ORDEN_SECCIONES.filter((x) => x === 'analisis' || prev.secciones.includes(x)) : prev.secciones,
    }));
    // Mes contra mes parte de los dos últimos meses; los demás tipos conservan lo elegido.
    const cambiarTipo = (t: TipoComparacion) => setC((prev) => {
        if (t !== 'mesVsMes' || meses.length < 2) return { ...prev, comparacion: { ...prev.comparacion, tipo: t } };
        const b = meses[meses.length - 1], a = meses[meses.length - 2];
        return { ...prev, comparacion: { ...prev.comparacion, tipo: t, a: { desde: a, hasta: a }, b: { desde: b, hasta: b } } };
    });
    const errores = useMemo(() => validarConfig(c, filas), [c, filas]);
    const avisos = useMemo(() => avisosConfig(c, filas), [c, filas]);
    const hojas = paginasEstimadas(c);
    // Módulos con alguna lectura dentro del periodo (los demás salen atenuados: aparecerían como S/D).
    const conDato = useMemo(() => new Set(filtrarFilas(filas, { ...c, modulos: [...MODULOS_SRL_IDS] }).map((f) => f.numero_modulo)), [filas, c]);

    const guardar = () => {
        const n = nombre.trim();
        if (!n) return;
        const nuevo: PresetGuardado = { id: `p${Date.now()}`, nombre: n.slice(0, 40), config: c };
        const lista = [nuevo, ...presets].slice(0, MAX_PRESETS);
        setPresets(lista);
        setNombre('');
        setAvisoPresets(guardarPresets(lista) ? null : 'No se pudo guardar en este dispositivo (el navegador bloquea el almacenamiento).');
    };
    const borrar = (id: string) => {
        const lista = presets.filter((p) => p.id !== id);
        setPresets(lista);
        setAvisoPresets(guardarPresets(lista) ? null : 'No se pudo actualizar la lista guardada.');
    };

    const descargar = async () => {
        setDescargando(true); setErrDescarga(null);
        try { await generarInformeInstitucional(filas, { emisor, config: c }); }
        catch (e) { setErrDescarga(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setDescargando(false); }
    };

    const resumen = `Informe ${etiquetaPeriodo(c)} · ${c.modulos.length} ${c.modulos.length === 1 ? 'módulo' : 'módulos'} · ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'} · ${c.hoja === 'letter' ? 'Carta' : 'A4'}`;
    const opcionesMes = meses.map((m) => ({ valor: m, texto: m }));
    const opcionesModulo = MODULOS_SRL_IDS.map((m) => ({ valor: String(m), texto: `M${m}` }));
    // Mismo orden y regla que el informe: la hoja de análisis (E) va tras plano+fichas y solo existe si el modo no es "resumen".
    const grupos = (['A', 'B', 'E', 'C', 'D'] as const)
        .map((g) => SECCIONES_NDVI.filter((s) => s.pagina === g && c.secciones.includes(s.id) && (g !== 'E' || c.modo !== 'resumen')))
        .filter((x) => x.length);

    return createPortal(
        <>
            <div className="ndvi-cfg-overlay" hidden={previa != null} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ndvi-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Geo-Monitor · Teledetección</span>
                            <h2 id="ndvi-cfg-t" className="ndvi-cfg-titulo">Configurar informe institucional NDVI</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>

                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Modo del informe">
                                <span className="ndvi-cfg-etq">Modo</span>
                                <SelectorChips etiqueta="Qué mostrar" valor={c.modo} onChange={cambiarModo}
                                    opciones={[{ valor: 'resumen', texto: 'Resumen', title: 'El informe de siempre' }, { valor: 'tendencia', texto: 'Tendencia', title: 'Pendiente, pico y estabilidad por módulo' }, { valor: 'comparativo', texto: 'Comparativo', title: 'Dos periodos, dos módulos o un módulo contra el promedio SRL' }]} />
                                {c.modo === 'comparativo' && (
                                    <div className="ndvi-cfg-bloque" style={{ gap: 10 }}>
                                        <SelectorChips etiqueta="Comparar" valor={c.comparacion.tipo} onChange={cambiarTipo}
                                            opciones={[{ valor: 'periodos', texto: 'Periodo A vs B' }, { valor: 'mesVsMes', texto: 'Mes vs mes' }, { valor: 'modulos', texto: 'Módulo vs módulo' }, { valor: 'vsSRL', texto: 'Módulo vs promedio SRL' }]} />
                                        {c.comparacion.tipo === 'periodos' && (<>
                                            <SelectorChips etiqueta="A desde" valor={c.comparacion.a.desde} opciones={opcionesMes} onChange={(v) => setCmp({ a: { ...c.comparacion.a, desde: v } })} />
                                            <SelectorChips etiqueta="A hasta" valor={c.comparacion.a.hasta} opciones={opcionesMes} onChange={(v) => setCmp({ a: { ...c.comparacion.a, hasta: v } })} />
                                            <SelectorChips etiqueta="B desde" valor={c.comparacion.b.desde} opciones={opcionesMes} onChange={(v) => setCmp({ b: { ...c.comparacion.b, desde: v } })} />
                                            <SelectorChips etiqueta="B hasta" valor={c.comparacion.b.hasta} opciones={opcionesMes} onChange={(v) => setCmp({ b: { ...c.comparacion.b, hasta: v } })} />
                                            <button type="button" className="ndvi-cfg-chip" onClick={() => setCmp(comparacionPorDefecto(meses))}>Primera mitad vs segunda mitad</button>
                                        </>)}
                                        {c.comparacion.tipo === 'mesVsMes' && (<>
                                            <SelectorChips etiqueta="Mes A" valor={c.comparacion.a.desde} opciones={opcionesMes} onChange={(v) => setCmp({ a: { desde: v, hasta: v } })} />
                                            <SelectorChips etiqueta="Mes B" valor={c.comparacion.b.desde} opciones={opcionesMes} onChange={(v) => setCmp({ b: { desde: v, hasta: v } })} />
                                        </>)}
                                        {(c.comparacion.tipo === 'modulos' || c.comparacion.tipo === 'vsSRL') && (<>
                                            <SelectorChips etiqueta={c.comparacion.tipo === 'modulos' ? 'Módulo A' : 'Módulo'} valor={String(c.comparacion.moduloA)} opciones={opcionesModulo} onChange={(v) => setCmp({ moduloA: Number(v) })} />
                                            {c.comparacion.tipo === 'modulos' && <SelectorChips etiqueta="Módulo B" valor={String(c.comparacion.moduloB)} opciones={opcionesModulo} onChange={(v) => setCmp({ moduloB: Number(v) })} />}
                                        </>)}
                                    </div>
                                )}
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Preajuste de periodo">
                                    {PRESETS_PERIODO.map((p) => (
                                        <button key={p.id} type="button" role="radio" aria-checked={c.preset === p.id} className="ndvi-cfg-preset" title={p.descripcion}
                                            onClick={() => setC((prev) => conPreset(prev, p.id, meses))}>{p.etiqueta}</button>
                                    ))}
                                    <button type="button" role="radio" aria-checked={c.preset === 'personalizado'} className="ndvi-cfg-preset" onClick={() => set({ preset: 'personalizado' })}>Personalizado</button>
                                </div>
                                <SelectorChips etiqueta="Desde" valor={c.desde} opciones={opcionesMes} onChange={(v) => set({ desde: v, preset: 'personalizado' })} />
                                <SelectorChips etiqueta="Hasta" valor={c.hasta} opciones={opcionesMes} onChange={(v) => set({ hasta: v, preset: 'personalizado' })} />
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Módulos">
                                <span className="ndvi-cfg-etq">Módulos <em>({c.modulos.length} de {MODULOS_SRL_IDS.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Módulos">
                                    {MODULOS_SRL_IDS.map((m) => {
                                        const on = c.modulos.includes(m);
                                        return (
                                            <button key={m} type="button" aria-pressed={on} className={`ndvi-cfg-chip${conDato.has(m) ? '' : ' sin-dato'}`} style={{ ['--c' as string]: COLOR_MODULO_SRL[m] }}
                                                title={conDato.has(m) ? undefined : 'Sin lecturas en el periodo: aparecerá como S/D'}
                                                onClick={() => set({ modulos: MODULOS_SRL_IDS.filter((x) => (x === m ? !on : c.modulos.includes(x))) })}>
                                                <i aria-hidden="true" />Módulo {m}{!conDato.has(m) && <span className="sr-only"> (sin lecturas en el periodo)</span>}
                                            </button>
                                        );
                                    })}
                                    <button type="button" className="ndvi-cfg-chip" onClick={() => set({ modulos: [...MODULOS_SRL_IDS] })}>Todos</button>
                                    <button type="button" className="ndvi-cfg-chip" onClick={() => set({ modulos: [] })}>Ninguno</button>
                                </div>
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Indicadores">
                                <span className="ndvi-cfg-etq">Indicadores</span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Indicadores">
                                    <button type="button" className="ndvi-cfg-chip" aria-pressed="true" disabled title="El NDVI siempre se incluye">NDVI</button>
                                    {INDICADORES_NDVI.map((i) => {
                                        const on = c.indicadores.includes(i.id);
                                        return <button key={i.id} type="button" aria-pressed={on} className="ndvi-cfg-chip" title={i.ayuda}
                                            onClick={() => set({ indicadores: INDICADORES_NDVI.map((x) => x.id).filter((x) => (x === i.id ? !on : c.indicadores.includes(x))) as IndicadorNdvi[] })}>{i.etiqueta}</button>;
                                    })}
                                </div>
                            </section>

                            <div className="ndvi-cfg-fila" style={{ alignItems: 'flex-start', gap: 24 }}>
                                <SelectorChips etiqueta="Promedio SRL" valor={c.basePromedio} onChange={(v) => set({ basePromedio: v })}
                                    opciones={[{ valor: 'simple', texto: 'Simple', title: 'Cada módulo pesa igual' }, { valor: 'ponderado', texto: 'Ponderado por superficie', title: 'Cada módulo pesa según sus hectáreas' }]} />
                                <SelectorChips etiqueta="Hoja" valor={c.hoja} onChange={(v) => set({ hoja: v })}
                                    opciones={[{ valor: 'letter', texto: 'Carta' }, { valor: 'a4', texto: 'A4' }]} />
                            </div>

                            <section className="ndvi-cfg-bloque" aria-label="Secciones">
                                <span className="ndvi-cfg-etq">Secciones <em>({c.secciones.length} de {SECCIONES_NDVI.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {SECCIONES_NDVI.map((s) => (
                                        <label key={s.id} className="ndvi-cfg-check">
                                            <input type="checkbox" checked={c.secciones.includes(s.id)}
                                                onChange={() => { const n = alternar<SeccionNdvi>(c.secciones, s.id); set({ secciones: ORDEN_SECCIONES.filter((x) => n.includes(x)) }); }} />
                                            <span>{s.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                        </div>

                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Vista general del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{hojas} {hojas === 1 ? 'hoja' : 'hojas'}<small>{c.modulos.length} módulos · {etiquetaPeriodo(c)}</small></div>
                            <div className="ndvi-cfg-hojas" aria-hidden="true">
                                {grupos.map((g, i) => <div key={i} className="ndvi-cfg-hoja"><b>Hoja {i + 1}</b>{g.map((s) => <span key={s.id}>{s.etiqueta}</span>)}</div>)}
                            </div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((e) => <li key={e}><span aria-hidden="true">⛔</span>{e}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}

                            <section className="ndvi-cfg-bloque" aria-label="Configuraciones guardadas">
                                <span className="ndvi-cfg-etq">Mis configuraciones <em>({presets.length}/{MAX_PRESETS})</em></span>
                                <div className="ndvi-cfg-fila">
                                    <input className="ndvi-cfg-in" value={nombre} maxLength={40} placeholder="Nombre (ej. Cierre de ciclo)" aria-label="Nombre de la configuración"
                                        onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }} />
                                    <button type="button" className="ndvi-cfg-btn" onClick={guardar} disabled={!nombre.trim()}><Save size={16} aria-hidden="true" /> Guardar</button>
                                </div>
                                {avisoPresets && <ul className="ndvi-cfg-msgs ndvi-cfg-avi" role="status"><li>{avisoPresets}</li></ul>}
                                {presets.length > 0 && (
                                    <ul className="ndvi-cfg-lista">
                                        {presets.map((p) => (
                                            <li key={p.id}>
                                                <button type="button" className="ndvi-cfg-btn" onClick={() => setC(normalizaConfig(p.config, meses))}>{p.nombre}</button>
                                                <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={() => borrar(p.id)} aria-label={`Borrar la configuración ${p.nombre}`}><Trash2 size={16} aria-hidden="true" /></button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </aside>
                    </div>

                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{resumen}{errDescarga ? ` · ${errDescarga}` : ''}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn" disabled={errores.length > 0 || descargando} onClick={() => void descargar()}><Download size={16} aria-hidden="true" /> {descargando ? 'Generando…' : 'Descargar HTML'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0} onClick={() => setPrevia(c)}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            </div>
            {previa && <VistaPreviaNdvi filas={filas} opciones={{ emisor, config: previa }} onVolver={() => setPrevia(null)} onCerrar={onCerrar} />}
        </>,
        document.body,
    );
}
