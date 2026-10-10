import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, CircleDashed, ClipboardList, FolderSync, GitBranch, Layers, ListTree, Loader2, RefreshCw, ShieldCheck, Table2, UploadCloud, Waypoints } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PaginaHero } from '../../ui/PaginaHero';
import { leerArchivoDerivacion } from '../../../conservacion/derivacion/archivo';
import { estadoDelCiclo, type PacotRegistrado, type Registro } from '../../../conservacion/derivacion/registro';
import type { TipoRed } from '../../../conservacion/derivacion/tipos';
import type { ChipEstado } from '../../../utils/alertasVivas';
import { DerivacionConcentrado } from './DerivacionConcentrado';
import { DerivacionCadena } from './DerivacionCadena';
import { NOMBRE_SRL } from '../../../conservacion/vocabulario';
import { atipicosDelLibro, atipicosPorPieza, resolverReferencia, type AtipicoPieza, type AtipicoTramo, type DestinoPieza, type DestinoTramo } from '../../../conservacion/verificacion/revision';
import { etiquetaAmbito } from './fmt';
import { DerivacionTramos } from './DerivacionTramos';
import { DerivacionPrograma } from './DerivacionPrograma';
import { DerivacionComprobacion } from './DerivacionComprobacion';
import { DerivacionVerificacion, type FiltroVerif } from './DerivacionVerificacion';
import { CentroRevision } from './CentroRevision';
import { EstadoVacio } from './EstadoVacio';
import { ContextoNavegacion, type DestinoPestana } from './navegacion';

const CLAVE = 'sica-conservacion-derivacion-v1';
const MAX_BYTES = 60 * 1024 * 1024;
const RUTA_CARPETA = '/__conservacion/derivacion';

type Sub = 'ciclo' | 'revision' | 'concentrado' | 'cadena' | 'tramos' | 'comprobacion' | 'verificacion' | 'programa';
const SUBS: ReadonlyArray<{ id: Sub; etiqueta: string; icono: typeof Layers }> = [
    { id: 'ciclo', etiqueta: 'PacOT del ciclo', icono: Layers },
    { id: 'revision', etiqueta: 'Revisión', icono: ClipboardList },
    { id: 'concentrado', etiqueta: 'Concentrado', icono: Table2 },
    { id: 'cadena', etiqueta: 'Cadena de cálculo', icono: GitBranch },
    { id: 'tramos', etiqueta: 'Tramos', icono: Waypoints },
    { id: 'comprobacion', etiqueta: 'Comprobación por tramo', icono: Calculator },
    { id: 'verificacion', etiqueta: 'Verificación', icono: ShieldCheck },
    { id: 'programa', etiqueta: 'Programa', icono: ListTree },
];

interface Datos { registro: Registro; avisos: ReadonlyMap<string, readonly string[]>; ciclo: string; esperados: readonly number[] }

/** Lo que dice el servidor local de cada libro de la carpeta (admitido, sin cambios, rechazado…). */
interface ArchivoCarpeta {
    archivo: string; ruta: string; ambito: string | null; ciclo: string | null;
    estado: 'registrado' | 'sin_cambios' | 'nueva_version' | 'rechazado' | 'error';
    mensajes: string[]; avisos: string[];
}
interface Carpeta { ruta: string | null; generadoEn: string; archivos: ArchivoCarpeta[] }

type Carga = 'cargando' | 'listo' | 'no_disponible' | 'error';

type ResultadoCarpeta =
    | { tipo: 'no_disponible' }
    | { tipo: 'abortado' }
    | { tipo: 'error'; mensaje: string }
    | { tipo: 'listo'; carpeta: Carpeta; ciclos: Datos[] };

/** Pide al servidor de desarrollo local que lea la carpeta de PacOT. En el build publicado ese servicio no existe. */
async function leerCarpeta(señal?: AbortSignal): Promise<ResultadoCarpeta> {
    try {
        const r = await fetch(RUTA_CARPETA, { cache: 'no-store', ...(señal ? { signal: señal } : {}) });
        if (!(r.headers.get('content-type') ?? '').includes('application/json')) return { tipo: 'no_disponible' };
        const j = await r.json() as { error?: string; carpeta?: string | null; generadoEn?: string; resultados?: ArchivoCarpeta[]; ciclos?: unknown[] };
        if (!r.ok || j.error) return { tipo: 'error', mensaje: j.error ?? `El servidor respondió ${r.status}.` };
        const ciclos: Datos[] = (j.ciclos ?? []).map((c) => {
            const l = leerArchivoDerivacion(c);
            return { registro: l.registro, avisos: l.avisos, ciclo: l.ciclo, esperados: l.modulosEsperados };
        });
        return { tipo: 'listo', carpeta: { ruta: j.carpeta ?? null, generadoEn: j.generadoEn ?? '', archivos: j.resultados ?? [] }, ciclos };
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return { tipo: 'abortado' };
        return { tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo leer la carpeta de PacOT.' };
    }
}

function interpretar(texto: string): { ok: true; datos: Datos } | { ok: false; error: string } {
    try {
        const l = leerArchivoDerivacion(JSON.parse(texto));
        return { ok: true, datos: { registro: l.registro, avisos: l.avisos, ciclo: l.ciclo, esperados: l.modulosEsperados } };
    } catch (e) {
        return { ok: false, error: e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : 'No es un archivo de derivación de SICA Conservación (derivacion-….json) o su formato no coincide.' };
    }
}
function restaurar(): Datos | null {
    try { const t = sessionStorage.getItem(CLAVE); if (!t) return null; const r = interpretar(t); return r.ok ? r.datos : null; } catch { return null; }
}

const TEXTO_ESTADO: Record<ArchivoCarpeta['estado'], string> = {
    registrado: 'Registrado ahora', sin_cambios: 'Registrado', nueva_version: 'Nueva versión', rechazado: 'Rechazado', error: 'Error al leer',
};

/**
 * Puerta de entrada de los PacOT de la SRL Unidad Conchos. Solo los PacOT admitidos y registrados son parte de la
 * plataforma. En local, el servidor de desarrollo lee la carpeta de PacOT sola; fuera de ahí se abre el archivo
 * de derivación generado con `npm run conservacion:derivar`.
 */
export function Derivacion() {
    const [lista, setLista] = useState<Datos[]>(() => { const r = restaurar(); return r ? [r] : []; });
    const [cicloSel, setCicloSel] = useState(0);
    const [carpeta, setCarpeta] = useState<Carpeta | null>(null);
    const [carga, setCarga] = useState<Carga>('cargando');
    const [errorCarpeta, setErrorCarpeta] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sobre, setSobre] = useState(false);
    const [sub, setSub] = useState<Sub>('ciclo');
    const [ambito, setAmbito] = useState('SRL');
    const [concepto, setConcepto] = useState<{ bloque: string; concepto: string }>({ bloque: '', concepto: '' });
    const [filtroVerif, setFiltroVerif] = useState<FiltroVerif>({ red: '', concepto: '' });
    const entrada = useRef<HTMLInputElement>(null);
    // «Abrir tramo»: PacOT + red + concepto + tramo, compartido por el Centro de revisión y los enlaces de las demás pestañas.
    const [destino, setDestino] = useState<{ d: DestinoTramo; n: number } | null>(null);
    const [destinoPieza, setDestinoPieza] = useState<{ d: DestinoPieza; n: number } | null>(null);
    const [avisoDestino, setAvisoDestino] = useState<string | null>(null);
    const contador = useRef(0);
    const [params, setParams] = useSearchParams();
    const [calculados, setCalculados] = useState<{ para: readonly PacotRegistrado[]; lista: readonly AtipicoTramo[]; piezas: readonly AtipicoPieza[] } | null>(null);

    const aplicar = useCallback((r: ResultadoCarpeta) => {
        if (r.tipo === 'abortado') return;
        if (r.tipo === 'no_disponible') { setCarga('no_disponible'); return; }
        if (r.tipo === 'error') { setErrorCarpeta(r.mensaje); setCarga('error'); return; }
        setCarpeta(r.carpeta);
        setErrorCarpeta(null);
        if (r.ciclos.length > 0) { setLista(r.ciclos); setCicloSel(r.ciclos.length - 1); }
        setCarga('listo');
    }, []);

    useEffect(() => {
        const c = new AbortController();
        void leerCarpeta(c.signal).then(aplicar);
        return () => c.abort();
    }, [aplicar]);

    const actualizar = () => { setCarga('cargando'); void leerCarpeta().then(aplicar); };

    const leer = async (f: File | undefined) => {
        if (!f) return;
        setError(null);
        if (f.size > MAX_BYTES) { setError('El archivo es demasiado grande para ser una derivación de SICA Conservación.'); return; }
        const texto = await f.text();
        const r = interpretar(texto);
        if (!r.ok) { setError(r.error); return; }
        setLista([r.datos]); setCicloSel(0);
        try { sessionStorage.setItem(CLAVE, texto); } catch { /* sin almacenamiento: queda en memoria */ }
    };
    const soltar = (e: DragEvent) => { e.preventDefault(); setSobre(false); void leer(e.dataTransfer.files[0]); };
    const cambiar = () => { setLista([]); try { sessionStorage.removeItem(CLAVE); } catch { /* nada */ } };

    const datos = lista[Math.min(cicloSel, Math.max(lista.length - 1, 0))] ?? null;
    const estado = useMemo(() => (datos ? estadoDelCiclo(datos.registro, datos.ciclo, datos.esperados) : null), [datos]);
    const pacots: PacotRegistrado[] = useMemo(() => (estado ? [...(estado.srl ? [estado.srl] : []), ...estado.modulos] : []), [estado]);
    const verVerificacion = useCallback((red: TipoRed | '', concepto: string) => { setFiltroVerif({ red, concepto }); setSub('verificacion'); }, []);
    const verCadena = useCallback((a: string, bloque: string, c: string) => { setAmbito(a); setConcepto({ bloque, concepto: c }); setSub('cadena'); }, []);
    const abrirTramo = useCallback((d: DestinoTramo) => {
        contador.current += 1;
        setAvisoDestino(null); setAmbito(d.ambito); setDestinoPieza(null); setDestino({ d, n: contador.current }); setSub('comprobacion');
    }, []);
    const abrirPieza = useCallback((d: DestinoPieza) => {
        contador.current += 1;
        setAvisoDestino(null); setAmbito(d.ambito); setDestino(null); setDestinoPieza({ d, n: contador.current }); setSub('comprobacion');
    }, []);
    const hayServidor = carga !== 'no_disponible';

    // Los atípicos de todos los PacOT se calculan fuera del primer pintado: la primera verificación de un libro grande tarda unos instantes.
    useEffect(() => {
        if (pacots.length === 0) return;
        const id = window.setTimeout(() => {
            setCalculados({ para: pacots, lista: pacots.flatMap((p) => atipicosDelLibro(p.libro, etiquetaAmbito(p))), piezas: pacots.flatMap((p) => atipicosPorPieza(p.libro, etiquetaAmbito(p))) });
        }, 0);
        return () => window.clearTimeout(id);
    }, [pacots]);
    const atipicos = calculados !== null && calculados.para === pacots ? calculados.lista : null;
    const atipicosPieza = calculados !== null && calculados.para === pacots ? calculados.piezas : null;

    // Enlace desde otra sección (Comprobación de reglas): ?tramo=<fila>&archivo=<nombre>&sha=<hash> abre la comprobación de ese tramo.
    const filaParam = params.get('fila'), hojaParam = params.get('hoja');
    useEffect(() => {
        if (filaParam === null || hojaParam === null || pacots.length === 0) return;
        const id = window.setTimeout(() => {
            const archivo = params.get('archivo'), sha = params.get('sha');
            const p = pacots.find((x) => (sha !== null && x.libro.sha256 === sha) || (archivo !== null && x.archivoNombre === archivo));
            const limpio = new URLSearchParams(params); limpio.delete('hoja'); limpio.delete('fila'); limpio.delete('archivo'); limpio.delete('sha');
            setParams(limpio, { replace: true });
            if (!p) { setAvisoDestino(`El PacOT de ese informe${archivo ? ` («${archivo}»)` : ''} no está cargado en la derivación; cárguelo para abrir su tramo.`); return; }
            const e = resolverReferencia(p.libro, etiquetaAmbito(p), hojaParam, Number(filaParam));
            if (!e) { setAvisoDestino(`La celda ${hojaParam}, fila ${filaParam} no corresponde a un tramo ni a un concepto con cálculo en ${etiquetaAmbito(p)}.`); setAmbito(etiquetaAmbito(p)); return; }
            if (e.tipo === 'tramo') abrirTramo(e.destino);
            else { setAvisoDestino(null); setAmbito(etiquetaAmbito(p)); setConcepto({ bloque: e.bloque, concepto: e.concepto }); setSub('cadena'); }
        }, 0);
        return () => window.clearTimeout(id);
    }, [filaParam, hojaParam, pacots, params, setParams, abrirTramo]);

    const irA = useCallback((d: DestinoPestana) => { setDestino(null); setDestinoPieza(null); setSub(d); }, []);
    const navegacion = useMemo(() => ({ irA, actualizar: hayServidor ? actualizar : null }), [irA, hayServidor]); // eslint-disable-line react-hooks/exhaustive-deps -- `actualizar` solo lee estado por setters

    const BotonActualizar = hayServidor ? (
        <button type="button" className="sc-btn sc-btn-primario" onClick={actualizar} disabled={carga === 'cargando'}>
            {carga === 'cargando' ? <Loader2 size={16} className="cons-der-gira" aria-hidden="true" /> : <FolderSync size={16} aria-hidden="true" />} Actualizar desde la carpeta
        </button>
    ) : null;

    if (!datos || !estado) {
        return (
            <>
                <PaginaHero kicker="SICA Conservación · SRL Unidad Conchos" titulo="PacOT de la SRL: derivación de cálculos"
                    subtitulo="Los PacOT de la SRL Conchos y de sus módulos. Solo los PacOT cargados en este apartado son parte de la plataforma."
                    acciones={BotonActualizar} />
                {carga === 'cargando' && (
                    <p className="sc-aviso" role="status"><Loader2 size={16} className="cons-der-gira" aria-hidden="true" /><span><b>Leyendo los PacOT de la carpeta…</b> La primera lectura puede tardar unos 30 segundos; después solo se leen los libros nuevos o modificados.</span></p>
                )}
                {carga === 'error' && (
                    <EstadoVacio tipo="error" titulo="No se pudo leer la carpeta de PacOT" accion={{ texto: 'Volver a leer la carpeta', onClick: actualizar }}>
                        {errorCarpeta} Compruebe que el servidor local siga abierto; si no hay servidor, abra el archivo de derivación abajo.
                    </EstadoVacio>
                )}
                {carga === 'listo' && (
                    <EstadoVacio titulo="La carpeta no tiene PacOT admitidos" accion={{ texto: 'Actualizar desde la carpeta', onClick: actualizar }}>
                        Deje los libros .xls o .xlsx de la SRL y de sus módulos en Conservacion\SRL CONCHOS y actualice; abajo se explica por qué se rechazó cada archivo.
                    </EstadoVacio>
                )}
                {carpeta && <ListaArchivos carpeta={carpeta} />}
                <div className="cons-vacio">
                    <div className={`cons-zona ${sobre ? 'cons-zona-sobre' : ''}`} role="button" tabIndex={0} aria-label="Abrir archivo de derivación (.json)"
                        onClick={() => entrada.current?.click()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.current?.click(); } }}
                        onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)} onDrop={soltar}>
                        <UploadCloud size={40} aria-hidden="true" />
                        <h2>Abrir derivación</h2>
                        <p>{hayServidor ? 'Alternativa:' : ''} arrastre aquí el archivo <b>derivacion-….json</b> del ciclo o toque para elegirlo. Se lee en este navegador; no se sube a ningún servidor.</p>
                        <input ref={entrada} type="file" accept=".json,application/json" tabIndex={-1} onChange={(e) => { void leer(e.target.files?.[0]); e.target.value = ''; }} />
                        {error && <p className="cons-error" role="alert">{error}</p>}
                    </div>
                    <section className="sc-card" aria-labelledby="cons-der-como">
                        <span className="sc-kicker">Cómo se cargan los PacOT</span>
                        <h3 id="cons-der-como">Admisión</h3>
                        <ol className="cons-pasos">
                            <li>Deje cada PacOT (<b>.xls</b> o <b>.xlsx</b>, el de la SRL y el de cada módulo) en la carpeta <b>Conservacion\SRL CONCHOS\</b>. Los originales nunca se modifican.</li>
                            <li>En la plataforma local, este apartado <b>lee la carpeta solo</b>; con «Actualizar desde la carpeta» recoge los libros nuevos.</li>
                            <li>Solo se admiten libros de la <b>SRL Unidad Conchos</b>: cualquier otro se rechaza con el motivo. El mismo libro no se duplica y uno modificado crea una versión nueva.</li>
                            <li>Sin servidor local: <code>npm run conservacion:derivar</code> genera <b>derivacion-conservacion/derivacion-AAAA-AAAA.json</b> y se abre aquí.</li>
                        </ol>
                    </section>
                </div>
            </>
        );
    }

    const chips: ChipEstado[] = [
        { key: 'srl', sev: estado.srl ? 'ok' : 'info', texto: estado.srl ? 'PacOT de la SRL cargado' : 'PacOT de la SRL pendiente de cargar' },
        { key: 'mod', sev: estado.modulosFaltantes.length === 0 ? 'ok' : 'info', texto: `${estado.modulos.length} de ${datos.esperados.length} módulos con PacOT (${estado.modulos.length + (estado.srl ? 1 : 0)} libros con la SRL)` },
        { key: 'base', sev: 'info', texto: 'Valores guardados en el archivo (caché)' },
    ];
    const hayAviso = [...datos.avisos.values()].some((a) => a.length > 0);

    return (
        <ContextoNavegacion.Provider value={navegacion}>
            <div className={sub === 'ciclo' ? undefined : 'cc-hero-compacto'}>
                <PaginaHero id="cons-der-titulo" kicker="SICA Conservación · SRL Unidad Conchos" titulo="Derivación de cálculos del PacOT"
                subtitulo={<>Ciclo {datos.ciclo} · de dónde sale cada cifra, por módulo y acumulada en la SRL</>} chips={chips}
                acciones={<>
                    {BotonActualizar}
                    <button type="button" className="sc-btn" onClick={cambiar}><RefreshCw size={16} aria-hidden="true" /> Abrir otro archivo</button>
                </>} />
            </div>

            {lista.length > 1 && (
                <div className="cons-filtros">
                    <div className="sc-campo">
                        <label htmlFor="cons-der-ciclo">Ciclo</label>
                        <select id="cons-der-ciclo" value={cicloSel} onChange={(e) => setCicloSel(Number(e.target.value))}>
                            {lista.map((d, i) => <option key={d.ciclo} value={i}>{d.ciclo}</option>)}
                        </select>
                    </div>
                </div>
            )}

            <div className="cons-tabs" role="tablist" aria-label="Secciones de la derivación">
                {SUBS.map((s) => {
                    const Ico = s.icono;
                    return (
                        <button key={s.id} type="button" role="tab" className="cons-tab" aria-selected={sub === s.id} tabIndex={sub === s.id ? 0 : -1} onClick={(e) => { setSub(s.id); setDestino(null); setDestinoPieza(null); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest' }); }}>
                            <Ico size={16} aria-hidden="true" /> {s.etiqueta}{s.id === 'revision' && atipicos !== null && <small>{atipicos.length + (atipicosPieza?.length ?? 0)}</small>}
                        </button>
                    );
                })}
            </div>

            {avisoDestino && <p className="sc-aviso" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>{avisoDestino}</span></p>}
            <div role="tabpanel">
                {sub === 'ciclo' && (
                    <>
                        <section className="sc-card" aria-labelledby="cons-ciclo-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div><span className="sc-kicker">Registro del ciclo {datos.ciclo}</span><h3 id="cons-ciclo-t" style={{ marginBottom: 0 }}>PacOT admitidos en la plataforma</h3></div>
                            {estado.modulosFaltantes.length > 0 && (
                                <p className="sc-aviso" role="note"><span>Faltan por cargar los módulos <b>{estado.modulosFaltantes.map((n) => `M${n}`).join(', ')}</b>. Es parte del avance normal del ciclo; el acumulado se completa a medida que lleguen.</span></p>
                            )}
                            {hayAviso && (
                                <p className="sc-aviso" role="note"><span><b>Avisos de admisión.</b> Se admitieron libros con datos pendientes de comprobar; el detalle está en cada PacOT, abajo.</span></p>
                            )}
                            <ul className="cons-der-slots">
                                {[{ id: 'SRL', n: null as number | null }, ...datos.esperados.map((n) => ({ id: `M${n}`, n }))].map((s) => {
                                    const p = pacots.find((x) => etiquetaAmbito(x) === s.id);
                                    return (
                                        <li key={s.id} className={`cons-der-slot ${p ? '' : 'cons-der-slot-pend'}`}>
                                            {p ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleDashed size={18} aria-hidden="true" />}
                                            <div>
                                                <b>{s.n === null ? NOMBRE_SRL : `Módulo ${s.n}`}</b>
                                                {p ? <small>{p.ficha.moduloTexto} · {p.archivoNombre} · versión {p.version} · SHA-256 {p.libro.sha256.slice(0, 10)}…</small> : <small>Pendiente de cargar</small>}
                                                {p && <small>{p.libro.tramos.length} tramos · {p.libro.necesidades.length} conceptos · {p.libro.programa.length} renglones de programa</small>}
                                                {p && (datos.avisos.get(p.clave) ?? []).map((a) => <small key={a} className="cons-der-aviso">{a}</small>)}
                                                {p && p.libro.avisos.map((a) => <small key={a} className="cons-der-aviso">{a}</small>)}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                        {carpeta && <ListaArchivos carpeta={carpeta} />}
                    </>
                )}
                {sub === 'revision' && <CentroRevision pacots={pacots} atipicos={atipicos} atipicosPieza={atipicosPieza} abrirTramo={abrirTramo} abrirPieza={abrirPieza} verVerificacion={verVerificacion} />}
                {sub === 'concentrado' && <DerivacionConcentrado estado={estado} esperados={datos.esperados} verCadena={verCadena} />}
                {sub === 'cadena' && <DerivacionCadena pacots={pacots} ambito={ambito} setAmbito={setAmbito} bloque={concepto.bloque} concepto={concepto.concepto} setConcepto={(b, c) => setConcepto({ bloque: b, concepto: c })} verVerificacion={verVerificacion} abrirTramo={abrirTramo} />}
                {sub === 'tramos' && <DerivacionTramos pacots={pacots} ambito={ambito} setAmbito={setAmbito} abrirTramo={abrirTramo} />}
                {sub === 'comprobacion' && <DerivacionComprobacion key={`${destino?.n ?? 0}-${destinoPieza?.n ?? 0}`} pacots={pacots} ambito={ambito} setAmbito={setAmbito} destino={destino?.d ?? null} destinoPieza={destinoPieza?.d ?? null} />}
                {sub === 'verificacion' && <DerivacionVerificacion key={`${ambito}|${filtroVerif.red}|${filtroVerif.concepto}`} pacots={pacots} ambito={ambito} setAmbito={setAmbito} filtroInicial={filtroVerif} abrirTramo={abrirTramo} />}
                {sub === 'programa' && <DerivacionPrograma pacots={pacots} ambito={ambito} setAmbito={setAmbito} abrirTramo={abrirTramo} verCadena={verCadena} />}
            </div>
        </ContextoNavegacion.Provider>
    );
}

/** Los archivos que el servidor local encontró en la carpeta de PacOT y qué hizo con cada uno. */
function ListaArchivos({ carpeta }: { carpeta: Carpeta }) {
    const rechazados = carpeta.archivos.filter((a) => a.estado === 'rechazado' || a.estado === 'error').length;
    return (
        <section className="sc-card" aria-labelledby="cons-arch-t" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
                <span className="sc-kicker">Carpeta de PacOT{carpeta.generadoEn ? ` · leída ${new Date(carpeta.generadoEn).toLocaleTimeString('es-MX')}` : ''}</span>
                <h3 id="cons-arch-t" style={{ marginBottom: 0 }}>Archivos encontrados ({carpeta.archivos.length}){rechazados > 0 ? ` · ${rechazados} rechazados` : ''}</h3>
                {carpeta.ruta && <small className="cons-cuenta" style={{ overflowWrap: 'anywhere' }}>{carpeta.ruta}</small>}
            </div>
            <ul className="cons-der-archivos">
                {carpeta.archivos.map((a) => {
                    const mal = a.estado === 'rechazado' || a.estado === 'error';
                    return (
                        <li key={a.ruta} className={mal ? 'cons-der-archivo-mal' : ''}>
                            <span className={`cons-ins ${mal ? 'cons-ins-alta' : 'cons-ins-ok'}`}>{mal ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />} {TEXTO_ESTADO[a.estado]}</span>
                            <div>
                                <b>{a.ruta}</b>
                                {a.ambito && <small>{a.ambito === 'SRL' ? NOMBRE_SRL : `Módulo ${a.ambito.slice(1)}`} · ciclo {a.ciclo}</small>}
                                {a.mensajes.map((m) => <small key={m} className="cons-der-aviso">{m}</small>)}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
