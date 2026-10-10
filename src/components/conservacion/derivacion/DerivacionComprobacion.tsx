import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Info, MapPin } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import { ROTULO_RED } from '../../../conservacion/derivacion/vistas';
import type { TipoRed } from '../../../conservacion/derivacion/tipos';
import { comprobarTramo, type Comprobacion, type EntradaComp, type OrigenEntrada, type TokenEc } from '../../../conservacion/verificacion/comprobacion';
import { bloquesNoAplica, comprobarObrasPuntuales, textoEstadoPieza, vistaDeGrupo, type GrupoSel } from '../../../conservacion/verificacion/porPieza';
import { verificarLibroCacheado } from '../../../conservacion/verificacion/verificar';
import { atipicosDelLibro, estadoConRazon, type DestinoPieza, type DestinoTramo, type EstadoConRazon, type RazonTramo } from '../../../conservacion/verificacion/revision';
import { desdeComp, formatoPK, nombreConcepto, nombreRed, TEXTO_RAZON_ATIPICO } from '../../../conservacion/vocabulario';
import { etiquetaAmbito, fmt, nombrePacot } from './fmt';
import { SinPacot } from './EstadoVacio';
import { ChipBase, ChipRazon, InsigniaEstado } from './formato';
import { BotonInfografiaComprobacion } from './BotonInfografiaComprobacion';
import { SeccionCanal } from './SeccionCanal';
import { PerfilCanal } from './PerfilCanal';
import { InventarioTramo } from './InventarioTramo';
import { UbicacionTramoModal } from './UbicacionTramoModal';
import { Leyenda } from './Leyenda';
import { ObrasPuntuales } from './ObrasPuntuales';
import { conTrazo, construirModeloCanal, type ClaveFamilia, type ModeloCanal } from './ubicacionModelo';
import { ContornoRecorrido } from './ContornoRecorrido';
import { useTrazo } from './TrazoContext';
import { EstadoVacio } from './EstadoVacio';
import { useNavegacion } from './navegacion';
import { EXAGERACION_VERTICAL, NOTA_CAMINO_ILUSTRATIVO, leyendaSeccion } from './seccionLeyenda';
import './centro-revision.css';
import './ficha.css';

interface Props {
    pacots: readonly PacotRegistrado[]; ambito: string; setAmbito: (a: string) => void;
    /** Abre la comprobación ya posicionada en este PacOT, red, concepto y tramo (desde el Centro de revisión y los enlaces «Abrir tramo»). */
    destino?: DestinoTramo | null;
    /** Abre la comprobación de obras puntuales ya posicionada en un concepto (desde el Centro de revisión). */
    destinoPieza?: DestinoPieza | null;
}

const TITULO_RECORRIDO: Readonly<Record<TipoRed, string>> = {
    distribucion: 'Recorrido del canal', tuberia: 'Recorrido de la tubería', drenaje: 'Recorrido del dren', caminos: 'Recorrido del camino', otro: 'Recorrido de la obra',
};
const esRedDeCanales = (r: TipoRed | ''): boolean => r === 'distribucion' || r === 'tuberia';
const TEXTO_ESTADO_OPCION: Readonly<Record<'cuadra' | 'atipico' | 'no_evaluable', string>> = { cuadra: 'coherente', atipico: 'atípico', no_evaluable: 'no evaluable' };

/** Sin canal no hay estructuras, ramal auxiliar ni leyenda de estructuras: el perfil de un dren o un camino es solo el recorrido de sus tramos. */
function modeloParaPerfil(m: ModeloCanal | null, red: TipoRed | ''): ModeloCanal | null {
    if (m === null || esRedDeCanales(red)) return m;
    return { ...m, v4: false, anclaPk: null, nEstructuras: 0, nEdificios: 0, nEstimadas: 0, nSinUbicar: 0, edificiosAparte: [], avisos: [] };
}

const cifra = (v: string | null): string => (v === null ? 'S/D' : fmt(v, 4));

/** Orden y nombre de los grupos de datos: primero lo que fija el PacOT (lo que se puede discutir), luego lo que viene del canal. */
const GRUPOS: ReadonlyArray<{ origen: OrigenEntrada; titulo: (hoja: string | null, camino?: boolean) => string }> = [
    { origen: 'parametro_libre', titulo: () => 'Lo que fija el PacOT' },
    { origen: 'inventario', titulo: (h, camino) => `Dimensiones del ${camino ? 'camino' : 'canal'}${h ? ` (${h})` : ''}` },
    { origen: 'diagnostico', titulo: () => 'Dato de DIAG-01' },
    { origen: 'constante', titulo: () => 'Conversiones' },
];

const hojaDe = (ref: string | null): string | null => (ref === null ? null : (ref.split('!')[0] ?? null));

/**
 * Comprobación tramo por tramo de DIAG-01. Se elige un concepto y un tramo en el recorrido del canal y se ve la cuenta con cada
 * dato coloreado según su origen: dimensión del canal, dato del diagnóstico o parámetro que fija el PacOT.
 */
export function DerivacionComprobacion({ pacots, ambito, setAmbito, destino = null, destinoPieza = null }: Props) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const v = useMemo(() => (pacot ? verificarLibroCacheado(pacot.libro) : null), [pacot]);
    const [redSel, setRedSel] = useState<TipoRed | 'obras' | ''>(destinoPieza ? 'obras' : (destino?.red ?? ''));
    const [piezaSel, setPiezaSel] = useState<string | null>(destinoPieza?.conceptoId ?? null);
    const [grupoSel, setGrupoSel] = useState<GrupoSel>('todo');
    const [conceptoSel, setConceptoSel] = useState<number | null>(destino?.indiceConcepto ?? null);
    const [filaSel, setFilaSel] = useState<number | null>(destino?.fila ?? null);
    const [soloAtipicos, setSoloAtipicos] = useState(false);
    const [perfilAbierto, setPerfilAbierto] = useState(false);
    const [ocultas, setOcultas] = useState<ReadonlySet<ClaveFamilia>>(() => new Set());
    const [ubic, setUbic] = useState<{ fila: number; obraId: string | null } | null>(null);
    const alternaFamilia = (c: ClaveFamilia) => setOcultas((prev) => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; });
    const raiz = useRef<HTMLDivElement>(null);
    // La cabecera de la página ocupa casi un pantallazo: al abrir la pestaña se lleva la comprobación a la parte alta.
    // Al abrir un tramo desde el Centro de revisión o un enlace «Abrir tramo» se lleva la ficha (Qué, Dónde, Cómo) a la parte alta, bajo la barra de contexto.
    useEffect(() => {
        const ficha = destino !== null ? raiz.current?.querySelector('.cons-comp-ficha') : null;
        (ficha ?? raiz.current)?.scrollIntoView({ block: 'start', behavior: 'auto' });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar: el componente se remonta con cada «Abrir tramo»
    }, []);

    const redes = useMemo(() => (v ? [...new Set(v.criterios.map((c) => c.red))] : []), [v]);
    // Obras puntuales (estructuras y edificios) es una red más del selector, con sus propios conceptos (modelo por-pieza) y grupos en lugar de tramos.
    const piezas = useMemo(() => (pacot ? comprobarObrasPuntuales(pacot.libro) : []), [pacot]);
    const noAplicaObras = useMemo(() => (pacot ? bloquesNoAplica(pacot.libro) : []), [pacot]);
    const enObras = redSel === 'obras' && piezas.length > 0;
    const red: TipoRed | '' = redSel !== '' && redSel !== 'obras' && redes.includes(redSel) ? redSel : (redes.includes('distribucion') ? 'distribucion' : (redes[0] ?? ''));
    const conceptos = useMemo(() => (v && !enObras ? v.criterios.filter((c) => c.red === red) : []), [v, red, enObras]);
    const crit = conceptos.find((c) => c.indiceConcepto === conceptoSel) ?? conceptos[0];
    const piezaActual = enObras ? (piezas.find((p) => p.id === piezaSel) ?? piezas[0] ?? null) : null;
    const gruposPieza = piezaActual?.gruposSeleccionables ? grupoSel : 'todo';
    const vistaPieza = useMemo(() => (piezaActual ? vistaDeGrupo(piezaActual, gruposPieza) : null), [piezaActual, gruposPieza]);
    // La ventana de ubicación de una obra puntual se apoya en el perfil de la red de distribución (las estructuras cuelgan de sus tramos).
    const modeloUbic = useMemo(() => {
        if (!enObras || !v || !pacot) return null;
        const critCanal = v.criterios.find((c) => c.red === 'distribucion');
        if (!critCanal) return null;
        const fs = Object.keys(critCanal.porTramo).map(Number).sort((a, b) => a - b)
            .map((fila) => comprobarTramo(pacot.libro, v.criterios, v.uniones, fila, critCanal.indiceConcepto))
            .filter((c): c is Comprobacion => c !== null);
        return fs.length > 0 ? construirModeloCanal(fs, pacot.libro) : null;
    }, [enObras, v, pacot]);

    const filas = useMemo(() => {
        if (!v || !pacot || !crit) return [] as Comprobacion[];
        return Object.keys(crit.porTramo).map(Number).sort((a, b) => a - b)
            .map((fila) => comprobarTramo(pacot.libro, v.criterios, v.uniones, fila, crit.indiceConcepto))
            .filter((c): c is Comprobacion => c !== null);
    }, [v, pacot, crit]);

    // Perfil, ventana de ubicación e infografía se alimentan del mismo modelo: cuentan los mismos tramos y las mismas obras.
    const modelo = useMemo(() => (pacot && filas.length > 0 ? construirModeloCanal(filas, pacot.libro) : null), [pacot, filas]);

    const atipDelPacot = useMemo(() => (pacot ? atipicosDelLibro(pacot.libro, etiquetaAmbito(pacot)) : []), [pacot]);
    const modeloPerfil = useMemo(() => modeloParaPerfil(modelo, red), [modelo, red]);
    // Contorno real para el dibujo «Dónde está»: el modelo se reconstruye una vez cuando llega el trazo (sin trazo queda la cuerda, rotulada).
    const { trazo } = useTrazo();
    const modeloContorno = useMemo(() => (modeloPerfil !== null && trazo !== null ? conTrazo(modeloPerfil, trazo) : modeloPerfil), [modeloPerfil, trazo]);
    const { irA } = useNavegacion();

    if (!pacot || !v) return <SinPacot />;

    const visibles = soloAtipicos ? filas.filter((c) => c.estado === 'atipico') : filas;
    const actual = visibles.find((c) => c.fila === filaSel) ?? visibles[0] ?? filas[0] ?? null;
    const pos = actual ? visibles.findIndex((c) => c.fila === actual.fila) : -1;
    const nAtip = filas.filter((c) => c.estado === 'atipico').length;
    const ir = (d: number) => { const n = visibles[pos + d]; if (n) setFilaSel(n.fila); };
    const reinicia = () => { setFilaSel(null); };
    const conceptoCanon = (rotulo: string) => nombreConcepto(rotulo, { red });
    const razon = actual ? estadoConRazon(actual) : null;
    // Otras razones por las que ESTE tramo es atípico en otro concepto (p. ej. desazolve por criterio y descopete por control).
    const otras: RazonTramo[] = actual ? (atipDelPacot.find((t) => t.red === actual.red && t.fila === actual.fila)?.razones.filter((r) => r.indiceConcepto !== crit?.indiceConcepto) ?? []) : [];

    // Selector de tramo agrupado por eje con nombre: nunca mezcla el canal principal con un auxiliar sin decirlo.
    const porFila = new Map(visibles.map((c) => [c.fila, c]));
    const opcion = (c: Comprobacion) => <option key={c.fila} value={c.fila}>{formatoPK(c.pkInicial)} → {formatoPK(c.pkFinal)} · {TEXTO_ESTADO_OPCION[c.estado]}</option>;
    const grupos = (modelo?.ejes ?? [])
        .map((e) => ({ titulo: e.inventario && !e.titulo.includes(e.inventario) ? `${e.titulo} · ${e.inventario}` : e.titulo, cs: e.tramos.map((t) => porFila.get(t.fila)).filter((c): c is Comprobacion => c !== undefined) }))
        .filter((g) => g.cs.length > 0);
    const agrupadas = new Set(grupos.flatMap((g) => g.cs.map((c) => c.fila)));
    const sueltas = visibles.filter((c) => !agrupadas.has(c.fila));
    const partesEstado = razon === null ? null : (razon.texto.startsWith('no evaluable') ? { corto: 'No evaluable', resto: '' } : { corto: razon.texto.split(' ')[0]!.replace(/^./, (x) => x.toUpperCase()), resto: razon.texto.split(' ').slice(1).join(' ') });

    // Nodo «Dónde está»: la tira del tramo en el recorrido o, desplegado, el perfil completo; con su clave y filtros.
    const nodoDonde: ReactNode = actual && modeloPerfil ? (
        perfilAbierto ? (
            <div id="cc-perfil" className="cons-comp-recorrido">
                <div className="cons-comp-recorrido-cab">
                    <span className="cons-comp-clave"><i className="cons-clave-cuadra" aria-hidden="true" /> coherente <i className="cons-clave-atip" aria-hidden="true">!</i> atípico <i className="cons-clave-ne" aria-hidden="true" /> no evaluable</span>
                    <small>El ancho de cada tramo es proporcional a su longitud.{crit && crit.sinDatos > 0 ? ` ${crit.sinDatos} tramos sin ficha de inventario o sin cifra no se pueden comprobar y no aparecen.` : ''}</small>
                </div>
                {esRedDeCanales(actual.red) && modelo && modelo.v4 && (modelo.nEstructuras + modelo.nEdificios) > 0 && (
                    <Leyenda conteoCanal={modelo.conteoCanal} ocultas={ocultas} onAlternar={alternaFamilia} etiqueta="Filtrar el perfil por familia de estructuras" />
                )}
                <PerfilCanal modelo={modeloPerfil} filaSel={actual.fila} soloAtipicos={soloAtipicos} ocultas={ocultas}
                    onSeleccionar={(fila) => { if (soloAtipicos && !visibles.some((c) => c.fila === fila)) setSoloAtipicos(false); setFilaSel(fila); }}
                    onAbrirUbicacion={(fila, obraId) => setUbic({ fila, obraId: obraId ?? null })} />
            </div>
        ) : (
            <TiraTramo modelo={modeloPerfil} fila={actual.fila} posicion={pos + 1} total={visibles.length} titulo={TITULO_RECORRIDO[actual.red]} />
        )
    ) : null;
    const botonPerfil: ReactNode = modeloPerfil ? (
        <button type="button" className="sc-btn" aria-expanded={perfilAbierto} aria-controls="cc-perfil" onClick={() => setPerfilAbierto(!perfilAbierto)}>
            {perfilAbierto ? <ChevronsDownUp size={16} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />} {perfilAbierto ? 'Ocultar el perfil' : 'Ver perfil completo'}
        </button>
    ) : null;

    return (
        <div ref={raiz} className="cc-raiz" {...(destino !== null && !enObras ? { 'data-abre': '' } : {})}>
            {piezaActual && vistaPieza && (
                <nav className="cc-barra" aria-label="Dónde está: PacOT, red, concepto y grupo">
                    <ol className="cc-ruta">
                        <li className="cc-opc" title={`Rótulo en el libro: ${pacot.ficha.moduloTexto}`}>{nombrePacot(pacot)}</li>
                        <li className="cc-opc">Obras puntuales</li>
                        <li className="cc-con" title={`Rótulo en el libro: ${piezaActual.concepto}`}>{piezaActual.nombre}</li>
                        <li className="op-grupo">{vistaPieza.rotulo}</li>
                    </ol>
                    <span className="cc-est" data-estado={piezaActual.estado} title={textoEstadoPieza(piezaActual)}>
                        <i aria-hidden="true" />
                        <span><b>{textoEstadoPieza(piezaActual).split(' ')[0]!.replace(/^./, (x) => x.toUpperCase())}</b><span className="cc-est-razon"> {textoEstadoPieza(piezaActual).split(' ').slice(1).join(' ')}</span></span>
                    </span>
                </nav>
            )}
            {!enObras && actual && razon && partesEstado && (
                <nav className="cc-barra" aria-label="Dónde está: PacOT, red, concepto y tramo">
                    <ol className="cc-ruta">
                        <li className="cc-opc" title={`Rótulo en el libro: ${pacot.ficha.moduloTexto}`}>{nombrePacot(pacot)}</li>
                        <li className="cc-opc">{nombreRed(actual.red)}</li>
                        <li className="cc-con" title={`Rótulo en el libro: ${actual.concepto}`}>{conceptoCanon(actual.concepto).canonico}</li>
                        <li className="cc-pk">{formatoPK(actual.pkInicial)} → {formatoPK(actual.pkFinal)}</li>
                    </ol>
                    <span className="cc-est" data-estado={actual.estado} title={razon.texto}>
                        <i aria-hidden="true" />
                        <span><b>{partesEstado.corto}</b><span className="cc-est-razon"> {partesEstado.resto}</span></span>
                    </span>
                </nav>
            )}

            <section className="sc-card cons-comp" aria-labelledby="cons-comp-t">
                <h3 id="cons-comp-t" className="sc-sr">{enObras ? 'Comprobación de obras puntuales' : 'Comprobación de cálculos por tramo'}</h3>

                <div className="cons-filtros cc-filtros">
                    <div className="sc-campo">
                        <label htmlFor="cons-comp-amb">PacOT</label>
                        <select id="cons-comp-amb" value={etiquetaAmbito(pacot)} onChange={(e) => { setAmbito(e.target.value); setConceptoSel(null); reinicia(); }}>
                            {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-comp-red">Red</label>
                        <select id="cons-comp-red" value={enObras ? 'obras' : red} onChange={(e) => { setRedSel(e.target.value as TipoRed | 'obras'); setConceptoSel(null); setPiezaSel(null); setGrupoSel('todo'); reinicia(); }}>
                            {redes.map((r) => <option key={r} value={r}>{ROTULO_RED[r]}</option>)}
                            {piezas.length > 0 && <option value="obras">Obras puntuales (estructuras y edificios)</option>}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-comp-con">Concepto</label>
                        <select id="cons-comp-con" value={enObras ? (piezaActual?.id ?? '') : (crit?.indiceConcepto ?? '')} onChange={(e) => { if (enObras) { setPiezaSel(e.target.value); setGrupoSel('todo'); } else { setConceptoSel(Number(e.target.value)); reinicia(); } }}>
                            {enObras
                                ? piezas.map((p) => <option key={p.id} value={p.id} title={`Rótulo en el libro: ${p.concepto}`}>{p.nombre}</option>)
                                : conceptos.map((c) => <option key={c.indiceConcepto} value={c.indiceConcepto} title={`Rótulo en el libro: ${c.concepto}`}>{conceptoCanon(c.concepto).canonico}</option>)}
                        </select>
                    </div>
                    <details className="cons-comp-ayuda">
                        <summary><Info size={16} aria-hidden="true" /> Cómo leer esta comprobación</summary>
                        <p>Cada tramo se cuenta en cuatro pasos: <b>qué</b> se revisa, <b>dónde</b> está, <b>cómo</b> se llega a la cifra de DIAG-01 y <b>por qué</b> se marca como se marca. Unos datos son <b>dimensiones del canal</b> (vienen del inventario) y otros son el <b>parámetro que fija el PacOT</b>, por ejemplo cuántos metros por margen se limpian.</p>
                        <p>El Manual (§5.8, pp. 63-64) no prescribe una fórmula por tramo: la cantidad se cuantifica a partir del inventario y los levantamientos. «Coherente» solo significa que el tramo es coherente con el criterio que el libro aplica en el resto de sus tramos; «atípico» es un candidato a revisión, no un error confirmado. Un tramo puede ser atípico por <b>criterio</b> (se aparta de lo que el libro hace en los demás) o por un <b>control adicional</b> (una comparación del comprobador, ajena al criterio).</p>
                        {!redes.includes('drenaje') && pacot.libro.fichas.drenes.length === 0 && (
                            <p className="op-aviso-noaplica" role="note"><b>Red de drenaje: no aplica a este PacOT.</b> No trae inventario de drenes ni importe en 3DN{pacot.libro.sumasBloque.some((b) => /DRENAJE/i.test(b.bloque) && Number(b.importe.valor) === 0) ? ' (la suma del bloque es 0)' : ''}.</p>
                        )}
                    </details>
                </div>

                {enObras && noAplicaObras.length > 0 && (
                    <p className="op-aviso-noaplica" role="note"><b>No aplican a este PacOT</b> (sin cantidad en 3DN, suma 0): {noAplicaObras.join(', ').toLowerCase()}.</p>
                )}
                {enObras ? (
                    piezaActual
                        ? <ObrasPuntuales key={piezaActual.id} c={piezaActual} ambito={etiquetaAmbito(pacot)} red="Obras puntuales (estructuras y edificios)" grupoSel={gruposPieza} setGrupoSel={setGrupoSel} modeloUbic={modeloUbic} />
                        : <EstadoVacio titulo="Este PacOT no trae obras puntuales con cantidad en 3DN" accion={{ texto: 'Ver la red de distribución', onClick: () => { setRedSel(''); setPiezaSel(null); reinicia(); } }}>Las obras puntuales (estructuras y edificios) salen de la hoja 3DN; sin cantidad no hay nada que comprobar.</EstadoVacio>
                ) : !actual ? (
                    <EstadoVacio titulo="No hay tramos con datos para comprobar este concepto"
                        accion={conceptos.length > 1 ? { texto: 'Elegir otro concepto', onClick: () => document.getElementById('cons-comp-con')?.focus() } : { texto: 'Ver la revisión del ciclo', onClick: () => irA('revision') }}>
                        Faltan fichas de inventario o cifras en DIAG-01 para este concepto; la pestaña Verificación explica qué falta en cada tramo.
                    </EstadoVacio>
                ) : (
                    <>
                        <div className="cons-comp-nav cons-filtros">
                            <button type="button" className="sc-btn" onClick={() => ir(-1)} disabled={pos <= 0}><ChevronLeft size={16} aria-hidden="true" /> Anterior</button>
                            <div className="sc-campo cons-comp-selector">
                                <label htmlFor="cons-comp-tramo">Tramo</label>
                                <select id="cons-comp-tramo" value={actual.fila} onChange={(e) => setFilaSel(Number(e.target.value))}>
                                    {grupos.map((g) => <optgroup key={g.titulo} label={g.titulo}>{g.cs.map(opcion)}</optgroup>)}
                                    {sueltas.length > 0 && <optgroup label="Sin cadenamiento legible">{sueltas.map(opcion)}</optgroup>}
                                </select>
                            </div>
                            <button type="button" className="sc-btn" onClick={() => ir(1)} disabled={pos < 0 || pos >= visibles.length - 1}>Siguiente <ChevronRight size={16} aria-hidden="true" /></button>
                            <button type="button" className="cons-sev-btn" aria-pressed={soloAtipicos} onClick={() => { setSoloAtipicos(!soloAtipicos); }}>Solo atípicos <small>{nAtip}</small></button>
                            {crit && <BotonInfografiaComprobacion tipo="concepto" filas={filas} crit={crit} ambito={etiquetaAmbito(pacot)} red={ROTULO_RED[red]} modelo={modelo} />}
                        </div>

                        <Ficha c={actual} razon={razon!} otras={otras} irConcepto={(i) => setConceptoSel(i)}
                            ambito={etiquetaAmbito(pacot)} red={ROTULO_RED[red]} modelo={modelo} modeloContorno={modeloContorno} ocultas={ocultas} onAlternar={alternaFamilia} onVer={(fila, obraId) => setUbic({ fila, obraId: obraId ?? null })}
                            donde={nodoDonde} botonPerfil={botonPerfil} />

                        <details className="cons-comp-todos">
                            <summary>Todos los tramos de este concepto ({visibles.length})</summary>
                            <div className="sc-tabla-wrap table-scroll">
                                <table className="sc-tabla cons-tabla">
                                    <caption style={{ position: 'absolute', left: -9999 }}>Comprobación de cada tramo</caption>
                                    <thead><tr><th scope="col">Fila</th><th scope="col">Obra y tramo</th><th scope="col" className="cons-n">En el libro</th><th scope="col" className="cons-n">Según el criterio</th><th scope="col">Estado</th></tr></thead>
                                    <tbody>
                                        {visibles.map((c) => {
                                            const r = estadoConRazon(c);
                                            return (
                                                <tr key={c.fila} className={c.fila === actual.fila ? 'cons-comp-fila-sel' : ''}>
                                                    <td><button type="button" className="cons-comp-enlace" onClick={() => setFilaSel(c.fila)} aria-label={`Ver la comprobación de la fila ${c.fila}`}>{c.fila}</button></td>
                                                    <td><small>{c.obra}</small>{formatoPK(c.pkInicial)} → {formatoPK(c.pkFinal)}</td>
                                                    <td className="cons-n">{cifra(c.enLibro)}</td>
                                                    <td className="cons-n">{cifra(c.recalculado)}</td>
                                                    <td><InsigniaEstado e={desdeComp(c.estado, c.motivo)} {...(c.estado === 'atipico' ? { motivoCorto: r.texto.replace(/^atípico /, '') } : {})} /></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    </>
                )}
                {ubic && modelo && <UbicacionTramoModal modelo={modelo} fila={ubic.fila} obraId={ubic.obraId} ocultas={ocultas} onAlternar={alternaFamilia} onCerrar={() => setUbic(null)} />}
            </section>
        </div>
    );
}

/** Perfil plegado: una tira con todo el recorrido y el tramo elegido marcado (el botón para desplegar el perfil vive en la cabecera de «Dónde está»). */
function TiraTramo({ modelo, fila, posicion, total, titulo }: { modelo: ModeloCanal; fila: number; posicion: number; total: number; titulo: string }) {
    const eje = modelo.ejes.find((e) => e.tramos.some((t) => t.fila === fila)) ?? modelo.ejes[0];
    if (!eje) return null;
    const km = Math.max(eje.totalKm, 0.001);
    const sel = eje.tramos.find((t) => t.fila === fila) ?? null;
    return (
        <div className="cc-tira">
            <div className="cc-tira-cab">
                <p><b>{titulo}</b> · tramo {posicion} de {total}{eje.titulo ? ` · ${eje.titulo}` : ''}</p>
                <span className="cc-tira-clave" aria-label="Clave de la tira"><span><i className="k-ok" aria-hidden="true" />coherente</span><span><i className="k-at" aria-hidden="true" />atípico</span><span><i className="k-ne" aria-hidden="true" />no evaluable</span><span><i className="k-sel" aria-hidden="true" />tramo elegido</span></span>
            </div>
            <div className="cc-tira-pie">
                <span>K-0+000</span>
                <div className="cc-tira-barra" role="img" aria-label={`Posición del tramo elegido en el recorrido: ${sel ? `${formatoPK(sel.pkInicial)} a ${formatoPK(sel.pkFinal)}` : 'sin cadenamiento legible'}`}>
                    {eje.tramos.map((t) => (
                        <span key={t.fila} className="cc-seg" data-estado={t.estado} {...(t.fila === fila ? { 'data-sel': '' } : {})}
                            style={{ left: `${(t.kmIni / km) * 100}%`, width: `${Math.max(((t.kmFin - t.kmIni) / km) * 100, 0.15)}%` }} />
                    ))}
                    {sel && <span className="cc-marca" style={{ left: `${(((sel.kmIni + sel.kmFin) / 2) / km) * 100}%` }} />}
                </div>
                <span>{formatoPK(Math.round(eje.totalKm * 1000))}</span>
            </div>
        </div>
    );
}

/** Qué origen tiene cada color de la cuenta (solo los que aparecen en ella). */
function ClaveOrigen({ c }: { c: Comprobacion }) {
    const presentes = GRUPOS.filter((g) => c.ecuacion.some((t) => t.origen === g.origen));
    return (
        <ul className="cons-ec-clave" aria-label="Origen de los datos de la cuenta">
            {presentes.map((g) => <li key={g.origen} data-origen={g.origen}><i aria-hidden="true" />{g.titulo(null, c.red === 'caminos').replace(/\s*\(.*$/, '')}</li>)}
        </ul>
    );
}

/**
 * La cuenta del tramo con cada dato en el color de su origen; el color nunca va solo (el parámetro del PacOT lleva además caja punteada).
 * Cada término lleva su posición (--i): al abrir un tramo la cuenta se enciende de izquierda a derecha, cada término en su color de origen.
 */
function Ecuacion({ c }: { c: Comprobacion }) {
    const textoCuenta = `${c.ecuacion.map((t) => (t.origen === 'operador' ? t.simbolo : `${cifra(t.valor ?? null)}${t.unidad ? ` ${t.unidad}` : ''} (${t.etiqueta})`)).join(' ')} = ${cifra(c.recalculado)} ${c.unidad}`;
    const token = (t: TokenEc, i: number) => t.origen === 'operador'
        ? <span key={i} className="cons-ec-op" style={{ '--i': i } as CSSProperties} aria-hidden="true">{t.simbolo}</span>
        : (
            <span key={i} className="cons-ec-dato" data-origen={t.origen} style={{ '--i': i } as CSSProperties}>
                <b>{cifra(t.valor ?? null)}{t.unidad ? <small> {t.unidad}</small> : null}</b>
                <small>{t.etiqueta}</small>
            </span>
        );
    return (
        <div className="cons-ec" role="group" aria-label={`Cuenta de ${c.concepto}`}>
            <div className="cons-ec-cuenta" role="img" aria-label={textoCuenta}>
                {c.ecuacion.map(token)}
                <span className="cons-ec-op" style={{ '--i': c.ecuacion.length } as CSSProperties} aria-hidden="true">=</span>
                <span className="cons-ec-res" style={{ '--i': c.ecuacion.length + 1 } as CSSProperties}><b>{cifra(c.recalculado)}</b><small>{c.unidad} según el criterio</small></span>
            </div>
        </div>
    );
}

interface PropsFicha {
    c: Comprobacion; razon: EstadoConRazon; otras: readonly RazonTramo[]; irConcepto: (indiceConcepto: number) => void;
    ambito: string; red: string; modelo: ModeloCanal | null; modeloContorno: ModeloCanal | null; ocultas: ReadonlySet<ClaveFamilia>; onAlternar: (c: ClaveFamilia) => void; onVer: (fila: number, obraId?: string) => void;
    /** «Dónde está»: la tira del tramo o el perfil desplegado, y el botón que alterna entre los dos. */
    donde: ReactNode; botonPerfil: ReactNode;
}

const ESTADO_CONTROLES = {
    atipico: { estado: 'atipico' }, coherente: { estado: 'coherente' }, informativo: { estado: 'informativo' },
} as const;

/**
 * La ficha cuenta el tramo en cuatro pasos, siempre en el mismo orden: Qué se revisa (concepto, estado con su razón, cifras), Dónde está
 * (contorno, recorrido e inventario), Cómo se calcula (la cuenta por origen, el dibujo y los datos) y Por qué se marca (criterio, controles y fuente).
 */
function Ficha({ c, razon, otras, irConcepto, ambito, red, modelo, modeloContorno, ocultas, onAlternar, onVer, donde, botonPerfil }: PropsFicha) {
    const eje = modelo?.ejes.find((e) => e.tramos.some((t) => t.fila === c.fila)) ?? null;
    const tramo = eje?.tramos.find((t) => t.fila === c.fila) ?? null;
    const ejeC = modeloContorno?.ejes.find((e) => e.tramos.some((t) => t.fila === c.fila)) ?? null;
    const tramoC = ejeC?.tramos.find((t) => t.fila === c.fila) ?? null;
    const esCamino = c.red === 'caminos';
    // Los caminos no tienen perfil de estructuras ni ubicación en el libro: no se inventan.
    const puedeUbicar = !esCamino && modelo !== null && modelo.v4 && eje !== null && eje.ramal !== null && tramo !== null;
    const leyenda = c.diagrama ? leyendaSeccion(c.diagrama) : [];
    const porOrigen = (o: OrigenEntrada): EntradaComp[] => c.entradas.filter((e) => e.origen === o);
    const implicito = c.parametroLibre?.implicito ?? null;
    const difiere = c.estadoCriterio === 'atipico' && c.parametroLibre !== null && implicito !== null && implicito !== c.parametroLibre.valor;
    const nombre = nombreConcepto(c.concepto, { red: c.red });
    // Mismas cifras que el resto de la pantalla (separador de miles), no el texto crudo del núcleo.
    const kc = razon.controlesAtipicos[0];
    const lineaControl = kc === undefined ? null : kc.cifras ? `${kc.titulo}: ${fmt(kc.cifras.observado, 2)} ${kc.cifras.unidad} contra ${fmt(kc.cifras.referencia, 2)} ${kc.cifras.unidad}.` : `${kc.titulo}.`;
    const conCuenta = c.recalculado !== null;
    const hayDonde = donde !== null && donde !== undefined;
    const contorno = !esCamino && modeloContorno !== null && ejeC !== null && tramoC !== null ? <ContornoRecorrido modelo={modeloContorno} eje={ejeC} tramo={tramoC} /> : null;
    const dif = c.diferencia !== null && Number(c.diferencia) !== 0;

    return (
        <article className="cons-comp-ficha cf" aria-label={`Comprobación de ${nombre.canonico}, fila ${c.fila}`}>
            {/* 1 · QUÉ */}
            <section className="cf-sec cf-que" aria-labelledby={`cf-que-${c.fila}`}>
                <header className="cf-sec-cab">
                    <h5 id={`cf-que-${c.fila}`}>Qué se revisa</h5>
                    <div className="cc-acciones"><BotonInfografiaComprobacion tipo="tramo" comprobacion={c} ambito={ambito} red={red} modelo={modelo} /></div>
                </header>
                <div className="cf-que-grid">
                    <div className="cf-id">
                        <h4 className="cf-concepto" title={`Rótulo en el libro: ${c.concepto}`}>{nombre.canonico}</h4>
                        <p className="cf-obra">{c.obra}: <span className="cf-pk">{formatoPK(c.pkInicial)} → {formatoPK(c.pkFinal)}</span></p>
                        <p className="cf-fila">fila {c.fila} de DIAG-01 · inventario {c.inventario}</p>
                    </div>
                    <div className="cc-estados">
                        <div className="cc-estado">
                            <span className="cc-estado-et">Criterio del libro</span>
                            <span className="cc-estado-fila">
                                <InsigniaEstado e={desdeComp(c.estadoCriterio, c.motivo)} />
                                {c.estadoCriterio === 'atipico' && <ChipRazon razon="criterio" />}
                            </span>
                        </div>
                        <div className="cc-estado">
                            <span className="cc-estado-et">Controles adicionales</span>
                            {razon.controles === 'ninguno'
                                ? <span className="cc-sin-controles">Este concepto no tiene controles adicionales</span>
                                : <span className="cc-estado-fila"><InsigniaEstado e={ESTADO_CONTROLES[razon.controles]} />{razon.controles === 'atipico' && <ChipRazon razon="control_adicional" />}</span>}
                        </div>
                    </div>
                    {conCuenta && (
                        <dl className="cons-comp-resultado cf-cifras">
                            <div><dt>Cifra en DIAG-01</dt><dd>{cifra(c.enLibro)} <small>{c.unidad}</small></dd></div>
                            <div><dt>Según el criterio del libro</dt><dd>{cifra(c.recalculado)} <small>{c.unidad}</small></dd></div>
                            <div className={`cf-dif${dif ? ' cons-comp-dif' : ''}`}><dt>Diferencia</dt><dd>{cifra(c.diferencia)} <small>{c.unidad}</small></dd></div>
                        </dl>
                    )}
                </div>
                {lineaControl !== null && (
                    <p className="cc-razon" role="note"><b>{c.estadoCriterio === 'cuadra' ? 'Sigue el criterio del libro, pero un control adicional lo marca.' : 'Además, un control adicional lo marca.'}</b> {lineaControl}</p>
                )}
                {otras.length > 0 && (
                    <p className="cc-otras">
                        <span>Este tramo también es atípico en:</span>
                        {otras.map((r) => r.indiceConcepto === null
                            ? <span key={r.id}>{r.titulo} ({TEXTO_RAZON_ATIPICO[r.razon].corta.toLowerCase()})</span>
                            : <button key={r.id} type="button" className="sc-btn cc-otra" title={TEXTO_RAZON_ATIPICO[r.razon].larga} onClick={() => irConcepto(r.indiceConcepto!)}>{r.concepto}{r.razon === 'criterio' ? '' : ` · ${TEXTO_RAZON_ATIPICO[r.razon].corta.toLowerCase()}`}</button>)}
                    </p>
                )}
            </section>

            {/* 2 · DÓNDE */}
            {(hayDonde || contorno !== null) && (
                <section className="cf-sec cf-donde" aria-labelledby={`cf-donde-${c.fila}`}>
                    <header className="cf-sec-cab">
                        <h5 id={`cf-donde-${c.fila}`}>Dónde está</h5>
                        <div className="cc-acciones">
                            {botonPerfil}
                            {puedeUbicar && <button type="button" className="sc-btn cons-comp-ubicar" onClick={() => onVer(c.fila)}><MapPin size={16} aria-hidden="true" /> Ver ubicación</button>}
                        </div>
                    </header>
                    <div className="cf-donde-cuerpo">
                        {contorno}
                        <div className="cf-donde-datos">
                            {donde}
                            {!esCamino && modelo && eje && tramo && modelo.v4 && eje.conEstructuras && (
                                <InventarioTramo modelo={modelo} eje={eje} tramo={tramo} ocultas={ocultas} onAlternar={onAlternar} onVer={(id) => onVer(c.fila, id)} />
                            )}
                        </div>
                    </div>
                </section>
            )}

            {/* 3 · CÓMO */}
            {conCuenta && (
                <section className="cf-sec cf-como" aria-labelledby={`cf-como-${c.fila}`}>
                    <header className="cf-sec-cab">
                        <h5 id={`cf-como-${c.fila}`}>Cómo se calcula</h5>
                        <ClaveOrigen c={c} />
                    </header>
                    <Ecuacion c={c} />
                    <div className="cons-comp-grid">
                        <div className="cons-comp-dibujo">
                            {c.diagrama ? <SeccionCanal d={c.diagrama} /> : <p className="cf-sin-dibujo">Para este concepto no hay dibujo de sección: la cantidad depende solo de la longitud o del ancho de la obra.</p>}
                            {leyenda.length > 0 && (
                                <ul className="cons-leyenda" aria-label="Qué se ve en el dibujo">
                                    {leyenda.map((i) => <li key={i.texto}><i className={`cons-ley-${i.muestra}`} aria-hidden="true" />{i.texto}</li>)}
                                    <li className="cons-ley-nota">{esCamino ? NOTA_CAMINO_ILUSTRATIVO : `Escala vertical exagerada ×${EXAGERACION_VERTICAL}; el terreno fuera del hombro es ilustrativo.`}</li>
                                </ul>
                            )}
                        </div>
                        <div className="cons-comp-datos">
                            {GRUPOS.map((g) => {
                                const items = porOrigen(g.origen);
                                if (items.length === 0) return null;
                                return (
                                    <section key={g.origen} className="cons-dg" data-origen={g.origen} aria-label={g.titulo(hojaDe(items[0]?.ref ?? null), esCamino)}>
                                        <h5>{g.titulo(hojaDe(items[0]?.ref ?? null), esCamino)}</h5>
                                        <ul>
                                            {items.map((e) => (
                                                <li key={e.etiqueta}>
                                                    <span>{e.etiqueta}{e.ref !== null && <code>{e.ref}</code>}</span>
                                                    <b>{cifra(e.valor)} <small>{e.unidad}</small></b>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                </section>
            )}

            {/* 4 · POR QUÉ */}
            <section className="cf-sec cf-porque" aria-labelledby={`cf-porque-${c.fila}`}>
                <header className="cf-sec-cab"><h5 id={`cf-porque-${c.fila}`}>{conCuenta ? 'Por qué se marca así' : 'Por qué no se calcula'}</h5></header>
                {c.modelo === null && <p className="sc-aviso cons-motivo" role="note"><span>{c.motivo ?? `Ningún criterio explica a la mayoría de los tramos de este grupo (${c.grupo}); no se comprueba el tramo ni se marcan atípicos.`}</span></p>}
                {c.modelo !== null && c.recalculado === null && <p className="sc-aviso" role="note"><span>Faltan datos en el inventario o en DIAG-01 para recalcular este tramo.</span></p>}
                {conCuenta && (
                    <p className="cf-criterio">El libro calcula este concepto en {c.grupo === 'todos' ? 'todos los tramos' : c.grupo} con <code>{c.criterio}</code>{c.declarado ? ' (modelo declarado por el comprobador)' : ''}{c.inferencia ? ' (constante inferida)' : ''}.</p>
                )}
                {difiere && c.parametroLibre && (
                    <p className="cons-comp-nota" role="note">
                        <b>Este tramo no sigue el criterio.</b> El libro implica {c.parametroLibre.nombre.toLowerCase()} de <b>{cifra(implicito)} {c.parametroLibre.unidad}</b> donde el resto de los tramos usa <b>{cifra(c.parametroLibre.valor)} {c.parametroLibre.unidad}</b>.
                        Puede ser un caso particular o una captura distinta: conviene confirmarlo con quien armó el PacOT.
                    </p>
                )}
                {c.controles.length > 0 && (
                    <ul className="cons-lista" aria-label="Controles adicionales">
                        {c.controles.map((k) => (
                            <li key={k.id} className={`cons-h cons-h-${k.estado === 'atipico' ? 'media' : 'informativa'}`}>
                                <div className="cons-h-cuerpo">
                                    <span className="cons-h-fila"><InsigniaEstado e={{ estado: k.estado === 'atipico' ? 'atipico' : k.estado === 'cuadra' ? 'coherente' : 'informativo' }} /><ChipBase base={k.base} /></span>
                                    <p className="cons-h-tit">{k.titulo}</p>
                                    <p style={{ margin: 0 }}>{k.detalle}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {c.refs.length > 0 && <p className="cf-fuente">Fuente: celdas {c.refs.join(' · ')}</p>}
                {c.pasos.length > 0 && (
                    <details className="cons-comp-pasos">
                        <summary>Recálculo paso a paso ({c.pasos.length})</summary>
                        <ol>
                            {c.pasos.map((p) => <li key={p.etiqueta}><span>{p.etiqueta}</span><code>{p.expresion}</code><b>{cifra(p.valor)}</b></li>)}
                        </ol>
                    </details>
                )}
            </section>
        </article>
    );
}
