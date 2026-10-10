import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { ComprobacionPieza, CuentaPieza, GrupoSel, PiezaListada } from '../../../conservacion/verificacion/porPieza';
import { opcionesDeGrupo, vistaDeGrupo } from '../../../conservacion/verificacion/porPieza';
import type { TokenEc } from '../../../conservacion/verificacion/comprobacion';
import { desdeComp, formatoPK } from '../../../conservacion/vocabulario';
import { fmt } from './fmt';
import { ChipBase, InsigniaEstado } from './formato';
import { Leyenda } from './Leyenda';
import { Simbolo } from './Simbolo';
import { MarcaUbicacion } from './InventarioTramo';
import { BotonInfografiaPieza } from './BotonInfografiaPieza';
import { UbicacionTramoModal } from './UbicacionTramoModal';
import { CLAVES_FAMILIA, tramoDeObra, type ClaveFamilia, type ModeloCanal } from './ubicacionModelo';
import './obras-puntuales.css';

const cifra = (v: string | null): string => (v === null ? 'S/D' : fmt(v, 4));
const PAGINA = 25;

/** La cuenta con cada dato en el color de su origen (inventario azul, 3DN blanco, PacOT violeta, conversión gris). */
function Cuenta({ cu, unidadRes }: { cu: CuentaPieza; unidadRes: string }) {
    const token = (t: TokenEc, i: number) => t.origen === 'operador'
        ? <span key={i} className="cons-ec-op" aria-hidden="true">{t.simbolo}</span>
        : (
            <span key={i} className="cons-ec-dato" data-origen={t.origen}>
                <b>{cifra(t.valor ?? null)}{t.unidad ? <small> {t.unidad}</small> : null}</b>
                <small>{t.etiqueta}</small>
            </span>
        );
    const texto = `${cu.titulo}: ${cu.tokens.map((t) => (t.origen === 'operador' ? t.simbolo : `${cifra(t.valor ?? null)} (${t.etiqueta})`)).join(' ')} = ${cifra(cu.resultado)} ${unidadRes}`;
    const estado = cu.estado === 'cuadra' ? 'coherente' : cu.estado === 'atipico' ? 'atipico' : cu.estado === 'informativo' ? 'informativo' : 'no_evaluable';
    return (
        <div className="cons-ec op-cuenta" role="group" aria-label={cu.titulo} data-estado={cu.estado}>
            <p className="op-cuenta-t">{cu.titulo}</p>
            <div className="cons-ec-cuenta" role="img" aria-label={texto}>
                {cu.tokens.map(token)}
                <span className="cons-ec-op" aria-hidden="true">=</span>
                <span className="cons-ec-res"><b>{cifra(cu.resultado)}</b><small>{unidadRes} {cu.id === 'cantidad' ? 'según el inventario' : 'recalculado'}</small></span>
            </div>
            <p className="op-cuenta-libro">
                <InsigniaEstado e={estado === 'no_evaluable' ? { estado: 'no_evaluable', motivo: 'Sin cifra en el libro' } : { estado }} />
                <span>El libro trae <b>{cifra(cu.enLibro)}</b> {unidadRes}{cu.refLibro ? <> <code>{cu.refLibro}</code></> : null}</span>
            </p>
        </div>
    );
}

const GRUPOS_DATOS: ReadonlyArray<{ origen: 'inventario' | 'diagnostico' | 'parametro_libre'; titulo: string }> = [
    { origen: 'inventario', titulo: 'Dato del inventario' },
    { origen: 'diagnostico', titulo: 'Dato de 3DN' },
    { origen: 'parametro_libre', titulo: 'Lo que fija el PacOT' },
];

interface Props {
    c: ComprobacionPieza;
    ambito: string;
    red: string;
    grupoSel: GrupoSel;
    setGrupoSel: (g: GrupoSel) => void;
    modeloUbic: ModeloCanal | null;
}

/**
 * Ficha de un concepto de obras puntuales (modelo por-pieza). La unidad de análisis no es un tramo sino el concepto completo o un grupo
 * (familia o tipo del catálogo). Nunca dice «correcto»: la cantidad del libro es coherente con el inventario o candidata a revisión.
 */
export function ObrasPuntuales({ c, ambito, red, grupoSel, setGrupoSel, modeloUbic }: Props) {
    const opciones = useMemo(() => opcionesDeGrupo(c), [c]);
    const sel: GrupoSel = opciones.some((o) => o.id === grupoSel) ? grupoSel : 'todo';
    const vista = useMemo(() => vistaDeGrupo(c, sel), [c, sel]);
    const [limite, setLimite] = useState(PAGINA);
    const [ubic, setUbic] = useState<{ fila: number; obraId: string } | null>(null);
    const [ocultas, setOcultas] = useState<ReadonlySet<ClaveFamilia>>(() => new Set());
    const [sinVer, setSinVer] = useState<string | null>(null);

    const esEdificios = c.kind === 'edificios';
    const conteo = useMemo(() => {
        const o = Object.fromEntries(CLAVES_FAMILIA.map((k) => [k, 0])) as Record<ClaveFamilia, number>;
        for (const g of c.grupos) o[g.clave] += g.n;
        return o;
    }, [c]);
    const famSel = sel.startsWith('fam:') ? sel.slice(4) : sel.startsWith('tipo:') ? (c.grupos.find((g) => g.porTipo.some((t) => `tipo:${t.clave}` === sel))?.id ?? null) : null;
    // La leyenda es además el selector de la unidad de análisis: las familias no elegidas aparecen atenuadas.
    const ocultasLey = useMemo(() => (famSel === null ? new Set<ClaveFamilia>() : new Set(CLAVES_FAMILIA.filter((k) => k !== famSel))), [famSel]);
    const alternarFamilia = (k: ClaveFamilia) => { setLimite(PAGINA); setGrupoSel(famSel === k ? 'todo' : (`fam:${k}` as GrupoSel)); };

    const grupoDe = (id: string) => c.grupos.find((g) => g.id === id) ?? null;
    const grupoActual = famSel === null ? null : grupoDe(famSel);
    const tipos = (grupoActual ? [grupoActual] : c.grupos).flatMap((g) => g.porTipo.map((t) => ({ ...t, familia: g.rotulo })));

    const verUbicacion = (p: PiezaListada) => {
        setSinVer(null);
        if (modeloUbic === null) { setSinVer('No hay un perfil del canal para situar esta obra.'); return; }
        for (const eje of modeloUbic.ejes) {
            const obra = eje.obras.find((o) => o.id === p.id);
            const tramo = obra ? tramoDeObra(eje, obra) : null;
            if (obra && tramo) { setUbic({ fila: tramo.fila, obraId: obra.id }); return; }
        }
        setSinVer(`${p.tipo}${p.pk ? ` en ${formatoPK(p.pk)}` : ''}: no cae en ningún tramo del perfil (sin cadenamiento utilizable o fuera del recorrido). Sus coordenadas, si el inventario las trae, están en la lista.`);
    };

    const hayDif = c.diferencia !== null && Number(c.diferencia) !== 0;
    const estadoCant = c.estadoCantidad === 'no_evaluable' ? desdeComp('no_evaluable', c.motivo ?? 'Sin inventario de respaldo') : desdeComp(c.estadoCantidad);
    const aritmetica = c.controles.filter((k) => k.base === 'integridad' && (k.id === 'pieza-necesidad-anual' || k.id === 'pieza-importe' || k.id === 'pieza-proporcion'));
    const estadoAr = aritmetica.length === 0 ? null : aritmetica.some((k) => k.estado === 'atipico') ? 'atipico' : aritmetica.every((k) => k.estado === 'informativo') ? 'informativo' : 'coherente';
    const lista = vista.piezas.slice(0, limite);
    const nombre = c.nombre;

    return (
        <article className="cons-comp-ficha cf op-ficha" aria-label={`Comprobación de ${nombre}, fila ${c.fila} de 3DN`}>
            <section className="cf-sec cf-que" aria-labelledby="cf-que-op">
                <header className="cf-sec-cab">
                    <h5 id="cf-que-op">Qué se revisa</h5>
                    <div className="cc-acciones">
                        <BotonInfografiaPieza tipo="concepto" c={c} ambito={ambito} red={red} />
                        {c.grupos.length > 0 && <BotonInfografiaPieza tipo="grupo" c={c} sel={sel} ambito={ambito} red={red} />}
                    </div>
                </header>
                <div className="cf-que-grid">
                    <div className="cf-id">
                        <h4 className="cf-concepto">{nombre}</h4>
                        <p className="cf-obra"><span title={`Rótulo en el libro: ${c.concepto}`}>{vista.rotulo}</span></p>
                        <p className="cf-fila">fila {c.fila} de 3DN · bloque {c.bloque.toLowerCase()}</p>
                    </div>
                    <div className="cc-estados">
                        <div className="cc-estado">
                            <span className="cc-estado-et">Cantidad contra el inventario</span>
                            <span className="cc-estado-fila"><InsigniaEstado e={estadoCant} conMotivo={c.estadoCantidad === 'no_evaluable'} /></span>
                        </div>
                        <div className="cc-estado">
                            <span className="cc-estado-et">Aritmética del libro</span>
                            {estadoAr === null
                                ? <span className="cc-sin-controles">Faltan celdas de 3DN para comprobarla (S/D)</span>
                                : <span className="cc-estado-fila"><InsigniaEstado e={{ estado: estadoAr }} /></span>}
                        </div>
                    </div>
                    <dl className="cons-comp-resultado cf-cifras">
                        <div><dt>Cifra en 3DN</dt><dd>{cifra(c.trabajo)} <small>{c.unidad}</small></dd></div>
                        <div><dt>{c.reconstruida === null ? 'Reconstruida desde el inventario' : `Reconstruida desde ${esEdificios ? 'IO7' : 'IO4'}`}</dt><dd>{cifra(c.reconstruida)} <small>{c.unidad}</small></dd></div>
                        <div className={`cf-dif${hayDif ? ' cons-comp-dif' : ''}`}><dt>Diferencia</dt><dd>{cifra(c.diferencia)} <small>{c.unidad}</small></dd></div>
                    </dl>
                </div>
                {c.motivo && c.estadoCantidad === 'no_evaluable' && <p className="sc-aviso op-motivo" role="note"><span>{c.motivo}</span></p>}
            </section>

            {/* 2 · DÓNDE */}
            {(c.grupos.length > 0 || (c.gruposSeleccionables && vista.piezas.length > 0)) && (
                <section className="cf-sec cf-donde" aria-labelledby="cf-donde-op">
                    <header className="cf-sec-cab"><h5 id="cf-donde-op">Dónde están</h5></header>
            {c.grupos.length > 0 && (
                <section className="op-grupos" aria-label="Unidad de análisis: familias del catálogo">
                    <div className="op-grupos-cab">
                        <h5>{c.gruposSeleccionables ? 'Unidad de análisis' : 'Base de la proporción: estructuras del inventario'}</h5>
                        {c.gruposSeleccionables && (
                            <div className="sc-campo op-selector">
                                <label htmlFor="op-grupo">Grupo</label>
                                <select id="op-grupo" value={sel} onChange={(e) => { setLimite(PAGINA); setGrupoSel(e.target.value as GrupoSel); }}>
                                    {opciones.map((o) => <option key={o.id} value={o.id}>{o.nivel === 2 ? '    ' : ''}{o.etiqueta}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                    {!esEdificios && (
                        <Leyenda conteoCanal={conteo} ocultas={c.gruposSeleccionables ? ocultasLey : undefined} onAlternar={c.gruposSeleccionables ? alternarFamilia : undefined} etiqueta="Familias de estructuras: elegir una como unidad de análisis" />
                    )}
                    {c.gruposSeleccionables && vista.id !== 'todo' && (
                        <p className="op-parte" role="status">
                            <b>{vista.rotulo}</b>: {vista.n} de {c.totalPiezas ?? 'S/D'} {c.unidad}{vista.fraccion !== null ? ` (${(vista.fraccion * 100).toLocaleString('es-MX', { maximumFractionDigits: 1 })} %)` : ''}.
                            {vista.necesidadProporcional !== null && vista.importeProporcional !== null && <> Parte proporcional de la necesidad anual: {fmt(vista.necesidadProporcional, 3)} {c.unidad}; del importe: $ {fmt(vista.importeProporcional, 2)}. <em>Es un reparto proporcional, no una cifra del libro.</em></>}
                        </p>
                    )}
                    <div className="sc-tabla-wrap table-scroll">
                        <table className="sc-tabla cons-tabla op-tabla">
                            <caption className="cons-solo-lector">Desagregación por tipo del catálogo</caption>
                            <thead><tr><th scope="col">Tipo de obra</th><th scope="col" className="cons-n">Piezas</th><th scope="col" className="cons-n">Ambiguas</th></tr></thead>
                            <tbody>
                                {tipos.map((t, i) => (
                                    <tr key={`${t.clave}-${i}`}>
                                        <td>{t.nombre}{!grupoActual && c.grupos.length > 1 ? <small className="op-fam"> · {t.familia}</small> : null}</td>
                                        <td className="cons-n">{t.n}</td>
                                        <td className="cons-n">{t.ambiguas > 0 ? t.ambiguas : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot><tr><th scope="row">{grupoActual ? grupoActual.rotulo : 'Total'}</th><td className="cons-n">{grupoActual ? grupoActual.n : (c.totalPiezas ?? 'S/D')}</td><td className="cons-n">{(grupoActual ? [grupoActual] : c.grupos).reduce((s, g) => s + g.ambiguas, 0)}</td></tr></tfoot>
                        </table>
                    </div>
                    {(grupoActual ?? null) === null && c.grupos.some((g) => g.clave === 'ninguna') && (
                        <p className="cons-dg-nota">«Sin clasificar» cuenta en el total pero ninguna regla del catálogo reconoce su nombre; no se reparte entre las familias. «Ambiguas» conservan el subtipo crudo.</p>
                    )}
                </section>
            )}
            {c.gruposSeleccionables && vista.piezas.length > 0 && (
                <section className="op-lista" aria-label={esEdificios ? 'Edificios del inventario' : 'Estructuras del grupo'}>
                    <h5>{esEdificios ? 'Edificios de IO7' : `Estructuras de IO4 · ${vista.rotulo}`} <small>{vista.piezas.length}</small></h5>
                    {sinVer && <p className="sc-aviso" role="status"><span>{sinVer}</span></p>}
                    <ul className="cons-inv-lista" aria-label="Obras del grupo">
                        {lista.map((p) => (
                            <li key={p.id}>
                                <Simbolo clave={p.clave} tamano={22} punteado={p.ubicacion === 'estimada'} />
                                <span className="cons-inv-txt">
                                    <b>{esEdificios ? p.nombre : p.tipo}{p.ambiguo ? <em> · tipo ambiguo</em> : null}</b>
                                    <small>
                                        {esEdificios
                                            ? `${p.inventario ?? 'S/D'} · ${p.uso ?? p.caracteristicas ?? 'S/D'} · predio ${p.areaPredioM2 === null ? 'S/D' : `${fmt(String(p.areaPredioM2), 0)} m²`}`
                                            : `${p.nombre}${p.ambiguo && p.subtipo ? ` («${p.subtipo}» sin reclasificar)` : ''} · ${p.material ?? 'material S/D'}`}
                                    </small>
                                    {esEdificios && <small>Coordenadas: {p.latTexto ?? 'S/D'} · {p.lonTexto ?? 'S/D'}</small>}
                                </span>
                                <span className="cons-inv-pk"><code>{formatoPK(p.pk)}</code></span>
                                <MarcaUbicacion o={{ estado: p.ubicacion }} />
                                {p.ubicacion !== 'sin_ubicar' && p.lat !== null && p.lon !== null
                                    ? <button type="button" className="sc-btn cons-inv-ver" onClick={() => verUbicacion(p)} aria-label={`Ver la ubicación de ${esEdificios ? p.nombre : p.tipo}${p.pk ? ` en ${formatoPK(p.pk)}` : ''}`}><MapPin size={16} aria-hidden="true" /> <span>Ver</span></button>
                                    : <span className="op-sin-ubic" title={p.motivoUbicacion ?? undefined}>sin ubicación</span>}
                            </li>
                        ))}
                    </ul>
                    {vista.piezas.length > limite && <button type="button" className="sc-btn cons-mas" onClick={() => setLimite(limite + PAGINA)}>Mostrar {Math.min(PAGINA, vista.piezas.length - limite)} más</button>}
                </section>
            )}
                </section>
            )}

            {/* 3 · CÓMO */}
            <section className="cf-sec cf-como" aria-labelledby="cf-como-op">
                <header className="cf-sec-cab">
                    <h5 id="cf-como-op">Cómo se calcula</h5>
                    <ul className="cons-ec-clave" aria-label="Origen de los datos de las cuentas">
                        <li data-origen="inventario"><i aria-hidden="true" />Inventario ({esEdificios ? 'IO7' : 'IO4'})</li>
                        <li data-origen="diagnostico"><i aria-hidden="true" />Dato de 3DN</li>
                        <li data-origen="parametro_libre"><i aria-hidden="true" />Lo que fija el PacOT</li>
                    </ul>
                </header>
                <div className="op-cuentas">
                    {c.cuentas.map((cu) => <Cuenta key={cu.id} cu={cu} unidadRes={cu.id === 'importe' ? '$' : c.unidad} />)}
                </div>
            {c.proporcion !== null && (
                <p className="cons-comp-nota op-nota-comp" role="note">
                    <b>Proporción declarada, no reconstruible por estructura.</b> El libro asigna {c.proporcion.porcentaje} % de las {c.proporcion.base} obras civiles ({c.proporcion.enLibro} {c.unidad}). IO4 no dice cuáles estructuras tienen compuerta, por eso las compuertas no se reparten entre las estructuras ni entre las familias de abajo.
                </p>
            )}
            <div className="cons-comp-datos op-datos">
                {GRUPOS_DATOS.map((g) => {
                    const items = c.entradas.filter((e) => e.origen === g.origen);
                    if (items.length === 0) return null;
                    return (
                        <section key={g.origen} className="cons-dg" data-origen={g.origen} aria-label={g.titulo}>
                            <h5>{g.titulo}</h5>
                            <ul>{items.map((e) => <li key={e.etiqueta}><span>{e.etiqueta}{e.ref !== null && <code>{e.ref}</code>}</span><b>{cifra(e.valor)} <small>{e.unidad}</small></b></li>)}</ul>
                        </section>
                    );
                })}
            </div>
            </section>

            {/* 4 · POR QUÉ */}
            <section className="cf-sec cf-porque" aria-labelledby="cf-porque-op">
                <header className="cf-sec-cab"><h5 id="cf-porque-op">Por qué se marca así</h5></header>
            {c.controles.length > 0 && (
                <ul className="cons-lista" aria-label="Controles de la comprobación">
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
            <ul className="op-notas" aria-label="Notas de honestidad">
                {c.notas.map((n) => <li key={n}>{n}</li>)}
                <li>La ubicación es la declarada por el PacOT; no acredita la posición física. Esto no es una verificación normativa: «coherente» solo dice que la cantidad del libro coincide con el inventario del propio PacOT.</li>
            </ul>
            </section>
            {ubic && modeloUbic && <UbicacionTramoModal modelo={modeloUbic} fila={ubic.fila} obraId={ubic.obraId} ocultas={ocultas} onAlternar={(k) => setOcultas((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} onCerrar={() => setUbic(null)} />}
        </article>
    );
}

