import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, Save, Trash2, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import { COLOR_MODULO_SRL, MODULOS_SRL_IDS } from '../../utils/modulosSRL';
import {
    INDICADORES_NDVI, MAX_PRESETS, ORDEN_SECCIONES, PRESETS_PERIODO, SECCIONES_NDVI, anioDeInteres, aniosDeFilas, aniosDeReferencia, avisosConfig, configPorDefecto,
    conPreset, etiquetaPeriodo, filtrarFilas, guardarPresets, leerPresets, mesesDisponibles, normalizaConfig, planHojas, validarConfig,
    type ConfigInformeNdvi, type Contraste, type IndicadorNdvi, type PresetGuardado, type SeccionNdvi, type TipoCompModulos,
} from '../../utils/informeNdviConfig';
import type { FilaNdviInforme } from '../../utils/informeNdviDatos';
import { generarInformeInstitucional } from '../../utils/informeNdviInstitucional';
import { SelectorChips } from './SelectorChips';
import { SelectorMes } from './SelectorMes';
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
    // Los años salen de la serie que el panel ya cargó: el modal no consulta nada.
    const aniosSerie = useMemo(() => aniosDeFilas(filas), [filas]);
    const [c, setC] = useState<ConfigInformeNdvi>(() => configPorDefecto(meses));
    const [previa, setPrevia] = useState<ConfigInformeNdvi | null>(null);
    const [presets, setPresets] = useState<PresetGuardado[]>(() => leerPresets());
    const [nombre, setNombre] = useState('');
    const [avisoPresets, setAvisoPresets] = useState<string | null>(null);
    const [descargando, setDescargando] = useState(false);
    const [avanceImg, setAvanceImg] = useState<{ hechos: number; total: number } | null>(null);
    const [errDescarga, setErrDescarga] = useState<string | null>(null);

    useModalA11y(dialogRef, previa == null, onCerrar);

    const set = (p: Partial<ConfigInformeNdvi>) => setC((prev) => ({ ...prev, ...p }));
    const errores = useMemo(() => validarConfig(c, filas), [c, filas]);
    const avisos = useMemo(() => avisosConfig(c, filas), [c, filas]);
    const plan = useMemo(() => planHojas(c), [c]);
    const hojas = plan.length;
    // Módulos con alguna lectura dentro del periodo (los demás salen atenuados: aparecerían como S/D).
    const conDato = useMemo(() => new Set(filtrarFilas(filas, { ...c, modulos: [...MODULOS_SRL_IDS] }).map((f) => f.numero_modulo)), [filas, c]);

    const foco = anioDeInteres(c);
    const efectivos = useMemo(() => aniosDeReferencia(c, aniosSerie), [c, aniosSerie]);
    const aniosContraste = aniosSerie.filter((a) => a < foco);

    // Objeto estable: si se creara en cada render, la vista previa regeneraría el informe con cada re-render del modal.
    const opcionesPrevia = useMemo(() => (previa ? { emisor, config: previa } : null), [previa, emisor]);

    const alternarAnio = (a: number) => {
        if (a === foco) return; // el año de interés siempre entra
        const base = c.anios.length ? c.anios : aniosSerie;
        const sig = alternar(base, a).sort((x, y) => x - y);
        set({ anios: sig.length === aniosSerie.length ? [] : sig });
    };
    const alternarIndicador = (id: IndicadorNdvi) => set({ indicadores: INDICADORES_NDVI.map((x) => x.id).filter((x) => (x === id ? !c.indicadores.includes(id) : c.indicadores.includes(x))) });
    const cambiarComp = (t: TipoCompModulos | 'ninguno') => setC((prev) => ({
        ...prev,
        compModulos: t === 'ninguno' ? null : { tipo: t, moduloA: prev.compModulos?.moduloA ?? prev.modulos[0] ?? MODULOS_SRL_IDS[0], moduloB: prev.compModulos?.moduloB ?? prev.modulos[1] ?? MODULOS_SRL_IDS[1] },
    }));

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

    // La descarga usa el mismo documento (y folio) que la vista previa: generarDocumentoNdvi comparte caché por contenido.
    const descargar = async () => {
        setDescargando(true); setErrDescarga(null);
        try { await generarInformeInstitucional(filas, { emisor, config: c, onProgresoImagenes: (hechos, total) => setAvanceImg({ hechos, total }) }); }
        catch (e) { setErrDescarga(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setDescargando(false); setAvanceImg(null); }
    };

    const resumen = `Informe ${etiquetaPeriodo(c)} · ${c.modulos.length} ${c.modulos.length === 1 ? 'módulo' : 'módulos'} · ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'} · ${c.hoja === 'letter' ? 'Carta' : 'A4'}`;
    const opcionesModulo = MODULOS_SRL_IDS.map((m) => ({ valor: String(m), texto: `M${m}` }));
    const contrasteValor = String(c.contraste);
    const opcionesContraste = [
        { valor: 'auto', texto: 'Año anterior', title: 'Mismo periodo del año anterior, si hay datos' },
        { valor: 'ninguno', texto: 'Sin contraste' },
        ...aniosContraste.map((a) => ({ valor: String(a), texto: String(a) })),
    ];

    return createPortal(
        <>
            <div className="ndvi-cfg-overlay" hidden={previa != null} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ndvi-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <h2 id="ndvi-cfg-t" className="ndvi-cfg-titulo">Configurar informe técnico NDVI</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>

                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo del informe</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Preajuste de periodo">
                                    {PRESETS_PERIODO.map((p) => (
                                        <button key={p.id} type="button" role="radio" aria-checked={c.preset === p.id} className="ndvi-cfg-preset" title={p.descripcion}
                                            onClick={() => setC((prev) => conPreset(prev, p.id, meses))}>{p.etiqueta}</button>
                                    ))}
                                    <button type="button" role="radio" aria-checked={c.preset === 'personalizado'} className="ndvi-cfg-preset" onClick={() => set({ preset: 'personalizado' })}>Personalizado</button>
                                </div>
                                <SelectorMes etiqueta="Desde" valor={c.desde} meses={meses} onChange={(v) => set({ desde: v, preset: 'personalizado' })} />
                                <SelectorMes etiqueta="Hasta" valor={c.hasta} meses={meses} onChange={(v) => set({ hasta: v, preset: 'personalizado' })} />
                                <p className="ndvi-cfg-ayuda">El año de interés es el del último mes del periodo ({Number.isFinite(foco) ? foco : 'S/D'}).</p>
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Comparación con otros años">
                                <span className="ndvi-cfg-etq">Comparar con otros años</span>
                                <SelectorChips etiqueta="Contrastar contra el mismo periodo de" valor={contrasteValor}
                                    onChange={(v) => set({ contraste: (v === 'auto' || v === 'ninguno' ? v : Number(v)) as Contraste })} opciones={opcionesContraste} />
                                <span className="ndvi-cfg-etq">Años de referencia <em>({efectivos.length} de {aniosSerie.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Años de referencia">
                                    {aniosSerie.map((a) => {
                                        const on = efectivos.includes(a);
                                        return (
                                            <button key={a} type="button" aria-pressed={on} className="ndvi-cfg-chip" disabled={a > foco}
                                                title={a === foco ? 'Año de interés: siempre se incluye' : a > foco ? 'Posterior al periodo' : undefined} onClick={() => alternarAnio(a)}>{a}</button>
                                        );
                                    })}
                                    <button type="button" className="ndvi-cfg-chip" onClick={() => set({ anios: [] })}>Todos</button>
                                </div>
                                <p className="ndvi-cfg-ayuda">Estos años forman «lo habitual», el año tras año y la comparación entre años; con pocos años las lecturas son descriptivas y se marcan así.</p>
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

                            <section className="ndvi-cfg-bloque" aria-label="Secciones y anexos">
                                <span className="ndvi-cfg-etq">Qué incluir <em>({c.secciones.length} de {SECCIONES_NDVI.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {SECCIONES_NDVI.map((s) => (
                                        <label key={s.id} className="ndvi-cfg-check" title={s.ayuda}>
                                            <input type="checkbox" checked={c.secciones.includes(s.id)} disabled={!!s.fija}
                                                onChange={() => { const n = alternar<SeccionNdvi>(c.secciones, s.id); set({ secciones: ORDEN_SECCIONES.filter((x) => x === 'resumen' || n.includes(x)) }); }} />
                                            <span>{s.etiqueta}</span>
                                        </label>
                                    ))}
                                    <label className="ndvi-cfg-check" title="Imagen NDVI de cada módulo desde Sentinel-2 (si no responde, el informe sale con un aviso)">
                                        <input type="checkbox" checked={c.imagenSatelital} onChange={() => set({ imagenSatelital: !c.imagenSatelital })} />
                                        <span>Incluir imagen satelital</span>
                                    </label>
                                    <label className="ndvi-cfg-check" title="Plano con relieve sombreado, canal Conchos y otros módulos del distrito de fondo (suma unos 19 KB al archivo)">
                                        <input type="checkbox" checked={c.mapaRelieve} onChange={() => set({ mapaRelieve: !c.mapaRelieve })} />
                                        <span>Plano con relieve</span>
                                    </label>
                                    <label className="ndvi-cfg-check" title="Elaboró / Revisó / Autorizó en el anexo de trazabilidad">
                                        <input type="checkbox" checked={c.firmas} onChange={() => set({ firmas: !c.firmas })} />
                                        <span>Bloque de firmas</span>
                                    </label>
                                </div>
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Comparar módulos">
                                <SelectorChips etiqueta="Comparar módulos (opcional)" valor={c.compModulos?.tipo ?? 'ninguno'} onChange={cambiarComp}
                                    opciones={[{ valor: 'ninguno', texto: 'No' }, { valor: 'modulos', texto: 'Módulo vs módulo' }, { valor: 'vsSRL', texto: 'Módulo vs promedio SRL' }]} />
                                {c.compModulos && (
                                    <div className="ndvi-cfg-bloque" style={{ gap: 10 }}>
                                        <SelectorChips etiqueta={c.compModulos.tipo === 'modulos' ? 'Módulo A' : 'Módulo'} valor={String(c.compModulos.moduloA)} opciones={opcionesModulo}
                                            onChange={(v) => set({ compModulos: { ...c.compModulos!, moduloA: Number(v) } })} />
                                        {c.compModulos.tipo === 'modulos' && <SelectorChips etiqueta="Módulo B" valor={String(c.compModulos.moduloB)} opciones={opcionesModulo}
                                            onChange={(v) => set({ compModulos: { ...c.compModulos!, moduloB: Number(v) } })} />}
                                    </div>
                                )}
                            </section>

                            <section className="ndvi-cfg-bloque" aria-label="Indicadores opcionales">
                                <span className="ndvi-cfg-etq">Indicadores opcionales</span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Indicadores opcionales">
                                    <button type="button" className="ndvi-cfg-chip" aria-pressed="true" disabled title="El NDVI siempre se incluye">NDVI</button>
                                    {INDICADORES_NDVI.map((i) => (
                                        <button key={i.id} type="button" aria-pressed={c.indicadores.includes(i.id)} className="ndvi-cfg-chip" title={i.ayuda} onClick={() => alternarIndicador(i.id)}>{i.etiqueta}</button>
                                    ))}
                                </div>
                                <p className="ndvi-cfg-ayuda">Kc e ICV son transformaciones lineales del NDVI: no agregan información nueva y no van en el resumen.</p>
                            </section>

                            <div className="ndvi-cfg-fila" style={{ alignItems: 'flex-start', gap: 24 }}>
                                <SelectorChips etiqueta="Promedio SRL" valor={c.basePromedio} onChange={(v) => set({ basePromedio: v })}
                                    opciones={[{ valor: 'simple', texto: 'Simple', title: 'Cada módulo pesa igual' }, { valor: 'ponderado', texto: 'Ponderado por superficie', title: 'Cada módulo pesa según las hectáreas de su polígono' }]} />
                                <SelectorChips etiqueta="Hoja" valor={c.hoja} onChange={(v) => set({ hoja: v })}
                                    opciones={[{ valor: 'letter', texto: 'Carta' }, { valor: 'a4', texto: 'A4' }]} />
                            </div>
                        </div>

                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Vista general del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{hojas} {hojas === 1 ? 'hoja' : 'hojas'}<small>{c.modulos.length} módulos · {etiquetaPeriodo(c)}</small></div>
                            <div className="ndvi-cfg-hojas" aria-hidden="true">
                                {plan.map((h, i) => <div key={`${h.id}-${i}`} className="ndvi-cfg-hoja"><b>Hoja {i + 1}</b><span>{h.titulo}</span></div>)}
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
                            <button type="button" className="ndvi-cfg-btn" disabled={errores.length > 0 || descargando} onClick={() => void descargar()}><Download size={16} aria-hidden="true" /> {descargando ? (avanceImg && avanceImg.total > 0 ? `Imágenes ${avanceImg.hechos}/${avanceImg.total}…` : 'Generando…') : 'Descargar HTML'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0} onClick={() => setPrevia(c)}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            </div>
            {previa && opcionesPrevia && <VistaPreviaNdvi filas={filas} opciones={opcionesPrevia} onVolver={() => setPrevia(null)} onCerrar={onCerrar} />}
        </>,
        document.body,
    );
}
