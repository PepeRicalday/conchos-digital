import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../../historico/useModalA11y';
import { useImprimirInforme } from '../../../hooks/useImprimirInforme';
import { cargarBaseHidro, cargarSeriesHidro, cargarSeriesMeteoHidro } from '../../../hooks/useHidroEstaciones';
import { colorEstacion, tieneMeteo, type EstacionHidro, type VentanaHidro } from '../../../utils/hidroEstaciones';
import {
    ORDEN_SECCIONES_GOES, VARIABLES_INFORME, MAX_DIAS_SERIES, atajoActivo, avisosConfigGoes, cambiarModalidadGoes, configGoesPorDefecto,
    contarHojasGoes, diaLocal, estacionesDeAtajo, etiquetaPeriodoGoes, rangoEfectivo, seccionesGoesDe, validarConfigGoes,
    type AtajoEstaciones, type ConfigInformeGoes, type ModalidadGoes, type SeccionGoes, type TipoPeriodoGoes, type VariableInforme,
} from '../../../utils/informeGoesConfig';
import { prepararInformeGoes, NOMBRE_CORTO, type InformeGoes } from '../../../utils/informeGoesDatos';
import { htmlInformeGoes, nombreArchivoGoes } from '../../../utils/informeGoesHtml';
import { cargarLogosInforme } from '../../../utils/logosInforme';
import { htmlPorHoja } from '../../../utils/imprimirInforme';
import { rasterizaHtml } from '../../../utils/rasterizaHtml';
import { guardaOComparte } from '../../../utils/descargaArchivo';
import '../../ndvi/informeNdviModal.css';
import './informeGoesModal.css';

export interface InformeGoesModalProps {
    estaciones: EstacionHidro[];
    ventanaInicial: VentanaHidro;
    onCerrar: () => void;
}

const HORA = 3600000;
const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const VERSION = typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : undefined;

const MODALIDADES: { id: ModalidadGoes; t: string; d: string }[] = [
    { id: 'basico', t: 'Básico', d: 'Lectura ejecutiva: estado, tendencia y gráficas, en 4 hojas' },
    { id: 'tecnico', t: 'Técnico', d: 'Además estadística, volumen, enlace, meteorología, calidad y metodología' },
];
const PERIODOS: { id: TipoPeriodoGoes; et: string }[] = [
    { id: '24h', et: 'Últimas 24 h' }, { id: '7d', et: 'Últimos 7 días' }, { id: '30d', et: 'Últimos 30 días' }, { id: 'rango', et: 'Rango de fechas' },
];
const ATAJOS: { id: AtajoEstaciones; et: string }[] = [
    { id: 'todas', et: 'Todas' }, { id: 'presas', et: 'Solo presas' }, { id: 'rio', et: 'Solo río' },
];

interface Resultado { html: string; informe: InformeGoes; emitido: Date }

/** Descarga las series que necesita el periodo (más 8 días previos para la variación a 7 d) y arma los datos del informe. */
async function generarDatos(c: ConfigInformeGoes, estaciones: EstacionHidro[]): Promise<Resultado> {
    const ahoraMs = Date.now();
    const r = rangoEfectivo(c.periodo, ahoraMs);
    if (!r) throw new Error('El rango de fechas no es válido.');
    const horasPeriodo = Math.ceil((ahoraMs - r.desdeMs) / HORA);
    const topeHoras = (MAX_DIAS_SERIES + 8) * 24;
    const [series, meteo, base, logos] = await Promise.all([
        cargarSeriesHidro(c.estaciones, Math.min(topeHoras, horasPeriodo + 8 * 24)),
        c.variables.includes('meteo') ? cargarSeriesMeteoHidro(c.estaciones.filter(tieneMeteo), Math.min(topeHoras, horasPeriodo + 1)) : Promise.resolve({}),
        cargarBaseHidro(),
        cargarLogosInforme(),
    ]);
    const informe = prepararInformeGoes({ config: c, estaciones, series, meteo, mensajes: base.mensajes, ahoraMs });
    const emitido = new Date(ahoraMs);
    return { html: htmlInformeGoes(informe, logos, { emitido, version: VERSION ? `SICA 005 v${VERSION}` : undefined }), informe, emitido };
}

/** Ventana "Informe de estaciones GOES": filtros multiopción → vista previa en iframe → PNG por hoja o PDF por impresión. */
export default function InformeGoesModal({ estaciones, ventanaInicial, onCerrar }: InformeGoesModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [c, setC] = useState<ConfigInformeGoes>(() => configGoesPorDefecto(ventanaInicial));
    const [res, setRes] = useState<Resultado | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    const [ahora] = useState(() => Date.now());

    const ids = useMemo(() => estaciones.map((e) => e.id), [estaciones]);
    const errores = useMemo(() => validarConfigGoes(c, Date.now(), ids), [c, ids]);
    const avisos = useMemo(() => avisosConfigGoes(c), [c]);
    const secciones = useMemo(() => seccionesGoesDe(c.modalidad), [c.modalidad]);
    const hojas = useMemo(() => contarHojasGoes(c), [c]);
    const atajo = atajoActivo(estaciones, c.estaciones);
    const enPrevia = res != null || generando || error != null;

    const nombrePdf = res ? nombreArchivoGoes(res.informe, res.emitido, 'pdf').replace(/\.pdf$/, '') : 'informe-goes';
    const { imprimir, generando: imprimiendo, errorPdf } = useImprimirInforme(res?.html ?? null, frameRef, nombrePdf);

    const volver = () => { setRes(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);

    useEffect(() => {
        if (!res) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([res.html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [res]);

    const set = (p: Partial<ConfigInformeGoes>) => setC((prev) => ({ ...prev, ...p }));
    const setPeriodo = (tipo: TipoPeriodoGoes) => setC((prev) => ({
        ...prev,
        periodo: tipo === 'rango'
            ? { tipo, desde: prev.periodo.desde || diaLocal(ahora - 6 * 24 * HORA), hasta: prev.periodo.hasta || diaLocal(ahora) }
            : { ...prev.periodo, tipo },
    }));
    const alternarEstacion = (id: string) => {
        const x = alternar(c.estaciones, id);
        if (x.length) set({ estaciones: ids.filter((k) => x.includes(k)) });
    };
    const alternarVariable = (v: VariableInforme) => {
        const x = alternar(c.variables, v);
        set({ variables: VARIABLES_INFORME.map((k) => k.id).filter((k) => x.includes(k)) });
    };
    const alternarSeccion = (s: SeccionGoes) => {
        const x = alternar(c.secciones, s);
        set({ secciones: ORDEN_SECCIONES_GOES.filter((k) => x.includes(k)) });
    };

    const generar = async () => {
        setGenerando(true); setError(null);
        try { setRes(await generarDatos(c, estaciones)); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setGenerando(false); }
    };

    /** Un PNG por hoja (una sola imagen con todas excedería el límite de lienzo de iOS). */
    const exportarPng = async () => {
        if (!res) return;
        setExportando(true); setError(null);
        try {
            const { htmls, ancho } = htmlPorHoja(res.html);
            const base = nombreArchivoGoes(res.informe, res.emitido, 'png');
            for (let i = 0; i < htmls.length; i++) {
                const png = await rasterizaHtml(htmls[i], { ancho, escala: 2 });
                await guardaOComparte(png, htmls.length > 1 ? base.replace(/\.png$/, `-hoja-${i + 1}-de-${htmls.length}.png`) : base, 'image/png');
            }
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
        finally { setExportando(false); }
    };

    const nSel = c.estaciones.length;

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ig-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="ig-prev-t">Vista previa del informe</h2>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={volver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                            <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarPng()} disabled={!res || exportando || imprimiendo}><ImageDown size={16} aria-hidden="true" /> {exportando ? 'Generando imagen…' : hojas > 1 ? 'Descargar PNG (1 por hoja)' : 'Descargar PNG'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={() => void imprimir()} disabled={!urlBlob || exportando || imprimiendo}><Printer size={16} aria-hidden="true" /> {imprimiendo ? 'Generando…' : 'Imprimir / PDF'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                        </div>
                    </div>
                    {errorPdf && !error && <div className="ig-alerta" role="alert">{errorPdf}</div>}
                    <div className="ndvi-cfg-marco">
                        {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo completar la acción</h3><p>{error}</p><button type="button" className="ndvi-cfg-btn" onClick={volver}>Volver a filtros</button></div>
                            : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Descargando telemetría y armando el informe…</p></div>
                                : <iframe ref={frameRef} title="Vista previa del informe de estaciones GOES" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ig-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico · Presas</span>
                            <h2 id="ig-cfg-t" className="ndvi-cfg-titulo">Informe de estaciones GOES</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Modalidad">
                                <span className="ndvi-cfg-etq">Modalidad</span>
                                <div className="ig-modalidades" role="radiogroup" aria-label="Modalidad del informe">
                                    {MODALIDADES.map((m) => (
                                        <button key={m.id} type="button" role="radio" aria-checked={c.modalidad === m.id} className="ig-modalidad" onClick={() => setC((p) => cambiarModalidadGoes(p, m.id))}>
                                            <strong>{m.t}</strong><span>{m.d}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Estaciones">
                                <span className="ndvi-cfg-etq">Estaciones <em>({nSel} de {ids.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Atajos de agrupación">
                                    {ATAJOS.map((a) => (
                                        <button key={a.id} type="button" className="ndvi-cfg-chip" aria-pressed={atajo === a.id} onClick={() => { const x = estacionesDeAtajo(estaciones, a.id); if (x.length) set({ estaciones: x }); }}>{a.et}</button>
                                    ))}
                                </div>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Estaciones a incluir">
                                    {estaciones.map((e) => (
                                        <button key={e.id} type="button" className="ndvi-cfg-chip" style={{ ['--c' as string]: colorEstacion(e.id) }} aria-pressed={c.estaciones.includes(e.id)} onClick={() => alternarEstacion(e.id)}>
                                            <i aria-hidden="true" />{NOMBRE_CORTO[e.id] ?? e.nombre}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Periodo del informe">
                                    {PERIODOS.map((p) => (
                                        <button key={p.id} type="button" role="radio" aria-checked={c.periodo.tipo === p.id} className="ndvi-cfg-chip" onClick={() => setPeriodo(p.id)}>{p.et}</button>
                                    ))}
                                </div>
                                {c.periodo.tipo === 'rango' && (
                                    <div className="ndvi-cfg-fila">
                                        <label className="ndvi-cfg-etq ig-campo">Desde
                                            <input type="date" className="ndvi-cfg-in ig-fecha" value={c.periodo.desde} min={diaLocal(ahora - MAX_DIAS_SERIES * 24 * HORA)} max={diaLocal(ahora)}
                                                onChange={(e) => set({ periodo: { ...c.periodo, desde: e.target.value } })} /></label>
                                        <label className="ndvi-cfg-etq ig-campo">Hasta
                                            <input type="date" className="ndvi-cfg-in ig-fecha" value={c.periodo.hasta} min={diaLocal(ahora - MAX_DIAS_SERIES * 24 * HORA)} max={diaLocal(ahora)}
                                                onChange={(e) => set({ periodo: { ...c.periodo, hasta: e.target.value } })} /></label>
                                    </div>
                                )}
                                <span className="ndvi-cfg-ayuda">Hora de Chihuahua. Las series de telemetría llegan hasta {MAX_DIAS_SERIES} días atrás.</span>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Variables">
                                <span className="ndvi-cfg-etq">Variables <em>({c.variables.length} de {VARIABLES_INFORME.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Variables a incluir">
                                    {VARIABLES_INFORME.map((v) => (
                                        <button key={v.id} type="button" className="ndvi-cfg-chip" aria-pressed={c.variables.includes(v.id)} onClick={() => alternarVariable(v.id)}>{v.etiqueta}</button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Secciones">
                                <span className="ndvi-cfg-etq">Secciones <em>({c.secciones.filter((s) => secciones.some((d) => d.id === s)).length} de {secciones.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {secciones.map((s) => (
                                        <label key={s.id} className="ndvi-cfg-check" title={s.ayuda}>
                                            <input type="checkbox" checked={c.secciones.includes(s.id)} onChange={() => alternarSeccion(s.id)} />
                                            <span>{s.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Hoja">
                                <span className="ndvi-cfg-etq">Tamaño de hoja</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Tamaño de hoja">
                                    {([['letter', 'Carta'], ['a4', 'A4']] as const).map(([v, et]) => (
                                        <button key={v} type="button" role="radio" aria-checked={c.formato === v} className="ndvi-cfg-chip" onClick={() => set({ formato: v })}>{et}</button>
                                    ))}
                                </div>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{hojas} {hojas === 1 ? 'hoja' : 'hojas'}<small>{c.modalidad === 'basico' ? 'Básico' : 'Técnico'} · {c.formato === 'a4' ? 'A4' : 'Carta'}</small></div>
                            <p className="ndvi-cfg-resumen">{nSel} {nSel === 1 ? 'estación' : 'estaciones'} · {errores.length ? 'periodo por corregir' : etiquetaPeriodoGoes(c.periodo)}</p>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">Una hoja por bloque, con formato institucional SRL. Lo que no se midió sale como S/D, nunca como cero.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{hojas === 0 ? 'Elige al menos una sección' : `${hojas} ${hojas === 1 ? 'hoja' : 'hojas'} · la telemetría se descarga al generar`}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0} onClick={() => void generar()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
