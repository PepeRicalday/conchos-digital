import { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useModalA11y } from '../../../hooks/useModalA11y';
import { ROTULO_RED } from '../../../conservacion/derivacion/vistas';
import {
    TEXTO_UBICACION_DECLARADA, TEXTO_POSICION_ESTIMADA, TEXTO_ESTADO_CONCEPTO, avisosContornoTramo, conTrazo, conteoTramo, contornoDeTramo, cuerdaDeTramo, ejeGeoDeVista, etiquetaPk, etiquetaTramo,
    extremosTramo, insigniaContorno, obrasEnTramo, pkDeMetros, polilineaEje, rotuloFamilia,
    type ClaveFamilia, type ConteoTramo, type ContornoTramo, type EjeVista, type ExtremoTramo, type ModeloCanal, type ObraVista, type TramoVista,
} from './ubicacionModelo';
import { useTrazo } from './TrazoContext';
import './ubicacion-trazo.css';
import { InventarioTramo, MarcaUbicacion } from './InventarioTramo';
import { Simbolo } from './Simbolo';

const MapaTramo = lazy(() => import('./MapaTramo'));

interface Props {
    modelo: ModeloCanal;
    fila: number;
    obraId?: string | null;
    ocultas: ReadonlySet<ClaveFamilia>;
    onAlternar: (c: ClaveFamilia) => void;
    onCerrar: () => void;
}

const coord = (v: number | null): string => (v === null ? 'S/D' : v.toFixed(6));

/** Ventana de ubicación de un tramo: mapa con el tramo resaltado y sus obras, y el panel de datos del inventario. */
export function UbicacionTramoModal({ modelo: modeloBase, fila, obraId = null, ocultas, onAlternar, onCerrar }: Props) {
    const ref = useModalA11y<HTMLDivElement>(true, onCerrar);
    const tz = useTrazo();
    // El contorno real y la posición de las estructuras estimadas se calculan con el trazo en cuanto llega; mientras tanto, la cuerda.
    const modelo = useMemo(() => conTrazo(modeloBase, tz.trazo), [modeloBase, tz.trazo]);
    const [obraSel, setObraSel] = useState<string | null>(obraId);
    const [sinTeselas, setSinTeselas] = useState(false);
    // Los avisos de cadenamiento van plegados en pantallas chicas: apilados le quitaban altura al mapa.
    const [avisosAbiertos, setAvisosAbiertos] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches);

    const eje = modelo.ejes.find((e) => e.tramos.some((t) => t.fila === fila));
    const tramo = eje?.tramos.find((t) => t.fila === fila);
    const datos = useMemo(() => {
        if (!eje || !tramo) return null;
        const geo = ejeGeoDeVista(modelo, eje);
        const enTramo = obrasEnTramo(eje, tramo);
        const extremos = extremosTramo(tramo);
        const contorno = contornoDeTramo(geo, tramo.mIni, tramo.mFin);
        // Sin contorno real se dibuja la cuerda; si ni ella existe, no hay línea.
        const linea = contorno.linea.length > 1 ? contorno.linea : cuerdaDeTramo(geo, tramo.mIni, tramo.mFin);
        const punto = (r: 'Inicio' | 'Fin') => {
            const e = extremos.find((x) => x.rotulo === r);
            return e && e.lat !== null && e.lon !== null ? { punto: [e.lat, e.lon] as [number, number], rotulo: `${r} · ${etiquetaPk(e.pk)}` } : null;
        };
        return { enTramo, extremos, linea, contorno, insignia: insigniaContorno(contorno, eje.ramal), avisosPK: avisosContornoTramo(contorno, tramo, eje, modelo), eje: polilineaEje(geo), conteo: conteoTramo(tramo, enTramo), inicio: punto('Inicio'), fin: punto('Fin') };
    }, [modelo, eje, tramo]);
    const comp = modelo.origen.filas.find((c) => c.fila === fila);
    const libro = modelo.origen.libro;
    const pacot = libro.moduloNombre ?? 'PacOT';
    const red = comp ? ROTULO_RED[comp.red] : null;

    const fondo = (
        <div className="cons-ubic-fondo sc-root">
            <div className="cons-ubic" ref={ref} role="dialog" aria-modal="true" aria-labelledby="cons-ubic-t" tabIndex={-1}>
                <header className="cons-ubic-barra">
                    <button type="button" className="sc-btn cons-ubic-x" onClick={onCerrar} aria-label="Cerrar la ventana de ubicación"><X size={20} aria-hidden="true" /></button>
                    <div className="cons-ubic-tit">
                        <h2 id="cons-ubic-t">Ubicación del tramo{comp ? ` · ${comp.concepto}` : ''}</h2>
                        <p>{tramo && eje
                            ? <>{pacot}{libro.ciclo ? ` ${libro.ciclo}` : ''} · {red ? `${red} · ` : ''}{eje.titulo}{eje.inventario ? ` (inventario ${eje.inventario})` : ''} · <b>{etiquetaTramo(tramo)}</b></>
                            : 'Tramo no disponible'}</p>
                    </div>
                </header>
                {!eje || !tramo || !datos ? <p className="sc-vacio" role="alert">No se encontró el tramo en el perfil.</p> : (
                    <div className="cons-ubic-cuerpo">
                        <div className="cons-ubic-mapawrap">
                            <div className="cons-ubic-calidad" role="group" aria-label="Calidad del dibujo del tramo">
                                <span className={`cons-ubic-insignia cons-ubic-insignia-${datos.insignia.tipo}`} title={datos.insignia.detalle}>{datos.insignia.texto}</span>
                                {tz.estado === 'cargando' && <span className="cons-ubic-nota-corta" role="status">Cargando el contorno real del canal…</span>}
                                {tz.estado === 'error' && <span className="cons-ubic-nota-corta" role="status">No se pudo cargar el trazo del canal ({tz.motivo ?? 'sin conexión'}): se muestra la cuerda entre vértices del inventario.</span>}
                                {datos.avisosPK.length > 0 && (
                                    <details className="cons-ubic-avisos-det" open={avisosAbiertos} onToggle={(e) => setAvisosAbiertos(e.currentTarget.open)}>
                                        <summary><AlertTriangle size={16} aria-hidden="true" /> {datos.avisosPK.length === 1 ? '1 aviso del cadenamiento' : `${datos.avisosPK.length} avisos del cadenamiento`}</summary>
                                        {datos.avisosPK.map((a) => <span key={a} className="cons-ubic-alerta" role="note">{a}</span>)}
                                    </details>
                                )}
                            </div>
                            {datos.linea.length < 2 && datos.enTramo.every((o) => o.lat === null) && (
                                <p className="cons-ubic-sin" role="status"><AlertTriangle size={16} aria-hidden="true" /> Este tramo no tiene coordenadas utilizables en el inventario: no se puede dibujar. Los datos del cadenamiento están en el panel.</p>
                            )}
                            <Suspense fallback={<div className="cons-ubic-mapa cons-ubic-carga" role="status">Cargando el mapa…</div>}>
                                <MapaTramo tramo={datos.linea} calidad={datos.contorno.calidad} rotuloCuerda={datos.insignia.tipo === 'cuerda' ? datos.insignia.texto : null} eje={datos.eje} fondo={tz.dp10} inicio={datos.inicio} fin={datos.fin} obras={datos.enTramo} obraSel={obraSel} ocultas={ocultas}
                                    onSeleccionar={setObraSel} onFallanTeselas={() => setSinTeselas(true)} />
                            </Suspense>
                            {sinTeselas && <p className="cons-ubic-aviso" role="status">No se pudo cargar la imagen satelital: se muestran el trazo y las estructuras sobre fondo oscuro.</p>}
                            <p className="cons-ubic-pie">{TEXTO_UBICACION_DECLARADA}{datos.enTramo.some((o) => o.estado === 'estimada') ? ` Marcador hueco = ${TEXTO_POSICION_ESTIMADA}.` : ''}</p>
                        </div>
                        <aside className="cons-ubic-panel" aria-label="Datos del tramo">
                            <PanelTramo modelo={modelo} datos={datos} tramo={tramo} obraSel={obraSel} setObraSel={setObraSel} ocultas={ocultas} onAlternar={onAlternar} eje={eje} />
                        </aside>
                    </div>
                )}
            </div>
        </div>
    );
    return createPortal(fondo, document.body);
}

interface Datos {
    enTramo: ObraVista[]; extremos: readonly ExtremoTramo[]; linea: Array<[number, number]>; contorno: ContornoTramo; insignia: ReturnType<typeof insigniaContorno>; avisosPK: string[]; eje: Array<[number, number]>; conteo: ConteoTramo;
    inicio: { punto: [number, number]; rotulo: string } | null; fin: { punto: [number, number]; rotulo: string } | null;
}

interface PanelProps {
    modelo: ModeloCanal; datos: Datos; tramo: TramoVista; eje: EjeVista;
    obraSel: string | null; setObraSel: (id: string | null) => void; ocultas: ReadonlySet<ClaveFamilia>; onAlternar: (c: ClaveFamilia) => void;
}

function PanelTramo({ modelo, datos, tramo, eje, obraSel, setObraSel, ocultas, onAlternar }: PanelProps) {
    const estimadas = datos.enTramo.filter((o) => o.estado === 'estimada');
    const sinUbicar = datos.enTramo.filter((o) => o.estado === 'sin_ubicar');
    const sel = datos.enTramo.find((o) => o.id === obraSel) ?? null;
    const c = datos.conteo;
    return (
        <>
            <section className="cons-ubic-sec" aria-label="Cadenamiento y longitud">
                <dl className="cons-ubic-datos">
                    <div><dt>PK inicial</dt><dd>{etiquetaPk(tramo.pkInicial)}</dd></div>
                    <div><dt>PK final</dt><dd>{etiquetaPk(tramo.pkFinal)}</dd></div>
                    <div><dt>Longitud</dt><dd>{tramo.longitudKm.toFixed(3)} <small>km</small></dd></div>
                    <div><dt>Comprobación del concepto</dt><dd className="cons-ubic-txt">{TEXTO_ESTADO_CONCEPTO[tramo.estado]}</dd></div>
                </dl>
            </section>

            <section className="cons-ubic-sec" aria-label="Coordenadas del inventario">
                <h3>Coordenadas en IO1</h3>
                {datos.extremos.length === 0 ? <p className="sc-vacio">La ficha de este tramo no trae coordenadas (S/D).</p> : (
                    <ul className="cons-ubic-coords">
                        {datos.extremos.map((e) => (
                            <li key={e.rotulo}>
                                <b>{e.rotulo} · {etiquetaPk(e.pk)}</b>
                                <span>Decimal: <code>{coord(e.lat)}, {coord(e.lon)}</code></span>
                                <span>Original: <code>{e.latTexto ?? 'S/D'}</code> · <code>{e.lonTexto ?? 'S/D'}</code></span>
                                {e.defecto && <span className="cons-ubic-defecto">Sin usar: {e.defecto}. No se rellena.</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="cons-ubic-sec" aria-label="Estructuras declaradas e inventariadas">
                <h3>Conteo de estructuras IO1 vs IO4</h3>
                {!modelo.cifrasConfiables
                    ? <p className="cons-ubic-nota" role="note">Cifra no verificada (S/D){modelo.motivoCifras ? `: ${modelo.motivoCifras}` : ''}</p>
                    : c.totalDeclarado === null
                        ? <p className="cons-ubic-nota">IO1 no declara conteos para este tramo (S/D); IO4 lista {c.totalInventariado}.</p>
                        : <p className={`cons-ubic-nota ${c.coherente ? '' : 'cons-ubic-nota-atip'}`}>
                            {c.coherente ? `Conteo: IO1 declara ${c.totalDeclarado} e IO4 lista ${c.totalInventariado}: coherente.` : <><span className="cons-ubic-glifo" aria-hidden="true">!</span> Conteo: IO1 declara {c.totalDeclarado} e IO4 lista {c.totalInventariado}: difiere (puede ser un error de captura en cualquiera de los dos).</>}
                        </p>}
                {modelo.cifrasConfiables && <div className="sc-tabla-wrap table-scroll">
                    <table className="sc-tabla cons-tabla cons-ubic-tabla">
                        <caption className="cons-solo-lector">Estructuras declaradas en IO1 e inventariadas en IO4 en el tramo</caption>
                        <thead><tr><th scope="col">Tipo</th><th scope="col" className="cons-n">IO1</th><th scope="col" className="cons-n">IO4</th></tr></thead>
                        <tbody>
                            {c.filas.filter((f) => f.inventariado > 0 || (f.declarado ?? 0) > 0).map((f) => (
                                <tr key={f.id} className={f.diferencia !== null && f.diferencia !== 0 ? 'cons-ubic-dif' : undefined}>
                                    <td>{f.rotulo}</td><td className="cons-n">{f.declarado === null ? 'S/D' : f.declarado}</td><td className="cons-n">{f.inventariado}</td>
                                </tr>
                            ))}
                            {c.sinClasificar > 0 && <tr><td>{rotuloFamilia('ninguna')}</td><td className="cons-n">S/D</td><td className="cons-n">{c.sinClasificar}</td></tr>}
                        </tbody>
                        <tfoot><tr><th scope="row">Total</th><td className="cons-n">{c.totalDeclarado === null ? 'S/D' : c.totalDeclarado}</td><td className="cons-n">{c.totalInventariado}</td></tr></tfoot>
                    </table>
                </div>}
            </section>

            {(estimadas.length > 0 || sinUbicar.length > 0) && (
                <section className="cons-ubic-sec" aria-label="Obras sin ubicación declarada">
                    <h3>Ubicación que conviene revisar</h3>
                    <ul className="cons-ubic-avisos">
                        {[...estimadas, ...sinUbicar].map((o) => (
                            <li key={o.id}>
                                <Simbolo clave={o.clave} tamano={20} punteado={o.estado === 'estimada'} />
                                <span><b>{o.tipoNombre} · {etiquetaPk(o.pk)}</b> <MarcaUbicacion o={o} />
                                    <small>{o.motivo ?? 'sin motivo registrado'}</small></span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {sel && (
                <section className="cons-ubic-sec cons-ubic-ficha" aria-label={`Ficha de ${sel.tipoNombre}`}>
                    <h3>Ficha de la obra</h3>
                    <div className="cons-ubic-ficha-cab"><Simbolo clave={sel.clave} tamano={26} punteado={sel.estado === 'estimada'} /><div><b>{sel.tipoNombre}</b><small>{rotuloFamilia(sel.clave)}</small></div></div>
                    <dl className="cons-ubic-datos cons-ubic-datos-v">
                        <div><dt>Nombre en {sel.fuente}</dt><dd className="cons-ubic-txt">{sel.nombre}</dd></div>
                        <div><dt>Cadenamiento</dt><dd>{etiquetaPk(sel.pk)}{sel.margen ? <small> · margen {sel.margen === 'I' ? 'izquierdo' : 'derecho'}</small> : null}</dd></div>
                        <div><dt>Ubicación</dt><dd className="cons-ubic-txt">{sel.estado === 'valida' ? 'declarada en el inventario' : sel.estado === 'estimada' ? 'estimada con su cadenamiento' : 'sin ubicar'}</dd></div>
                        <div><dt>Posición usada</dt><dd>{coord(sel.lat)}, {coord(sel.lon)}</dd></div>
                        <div><dt>Coordenadas originales</dt><dd className="cons-ubic-txt">{sel.latTexto ?? 'S/D'} · {sel.lonTexto ?? 'S/D'}</dd></div>
                        {sel.ambiguo && <div><dt>Tipo</dt><dd className="cons-ubic-txt">ambiguo: se conserva «{sel.subtipo ?? sel.nombre}» sin reclasificar</dd></div>}
                        {sel.material && <div><dt>Material</dt><dd className="cons-ubic-txt">{sel.material}</dd></div>}
                        <div><dt>Celda de origen</dt><dd><code>{sel.ref}</code></dd></div>
                    </dl>
                    {sel.motivo && <p className="cons-ubic-nota">{sel.motivo}</p>}
                </section>
            )}

            <section className="cons-ubic-sec" aria-label="Inventario del tramo">
                <InventarioTramo modelo={modelo} eje={eje} tramo={tramo} ocultas={ocultas} onAlternar={onAlternar} onVer={setObraSel} obraSel={obraSel} abierto titulo="Obras del tramo" />
            </section>

            {(eje.fueraDeTramos.length > 0 || eje.sinPK.length > 0) && (
                <details className="cons-ubic-sec cons-ubic-fuera">
                    <summary>Obras del canal que no caen en ningún tramo <small>{eje.fueraDeTramos.length + eje.sinPK.length}</small></summary>
                    {eje.fueraDeTramos.length > 0 && (
                        <>
                            <h4>Fuera de tramos</h4>
                            <p className="cons-ubic-nota">Su cadenamiento pasa del final declarado en IO1 ({etiquetaPk(pkDeMetros(Math.round(eje.totalKm * 1000)))}).</p>
                            <ul className="cons-ubic-avisos">{eje.fueraDeTramos.map((o) => <li key={o.id}><Simbolo clave={o.clave} tamano={20} /><span><b>{o.tipoNombre} · {etiquetaPk(o.pk)}</b><small>{o.nombre}</small></span></li>)}</ul>
                        </>
                    )}
                    {eje.sinPK.length > 0 && (
                        <>
                            <h4>Sin cadenamiento utilizable</h4>
                            <ul className="cons-ubic-avisos">{eje.sinPK.map((o) => <li key={o.id}><Simbolo clave={o.clave} tamano={20} /><span><b>{o.tipoNombre} · fila {o.fila}</b><small>{o.pkTexto ? `Escrito: «${o.pkTexto}». ` : ''}{o.motivoPK ?? 'sin cadenamiento'}</small></span></li>)}</ul>
                        </>
                    )}
                </details>
            )}
        </>
    );
}
