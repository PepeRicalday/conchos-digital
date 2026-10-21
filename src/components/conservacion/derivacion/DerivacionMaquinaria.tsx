import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList, Link2, Truck } from 'lucide-react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import type { BloqueMaquinaria, EstadoMecanico } from '../../../conservacion/derivacion/tipos';
import {
    EXTRACTOR_CON_MAQUINARIA, HORAS_DISPONIBLES, notaSinEquivalente, UMBRAL_ADQUISICION, vistaMaquinaria,
    type ConceptoMaq, type EstadoHallazgo, type FilaTipoMaq, type HallazgoMaq, type VistaMaquinaria,
} from '../../../conservacion/derivacion/maquinariaVista';
import { AVISO_HONESTIDAD_COHERENCIA } from '../../../conservacion/vocabulario';
import { etiquetaAmbito, fmt, nombrePacot, AYUDA_BASE, TEXTO_BASE } from './fmt';
import { InsigniaEstado } from './formato';
import { EstadoVacio, SinPacot } from './EstadoVacio';
import { useNavegacion } from './navegacion';
import './maquinaria.css';

interface Props {
    pacots: readonly PacotRegistrado[];
    ambito: string;
    setAmbito: (a: string) => void;
}

type Vista = 'balance' | 'diferencias' | 'conceptos' | 'inventario';
type FiltroEstado = '' | EstadoHallazgo;

const BLOQUE: Readonly<Record<BloqueMaquinaria, string>> = {
    bombeo: 'Plantas de bombeo', distribucion: 'Red de distribución', drenaje: 'Red de drenaje', caminos: 'Red de caminos', parcelario: 'Mejoramiento parcelario',
};
const ESTADO_MECANICO: Readonly<Record<EstadoMecanico, string>> = { bueno: 'Bueno', regular: 'Regular', malo: 'Malo', baja: 'Baja' };
const TEXTO_FILTRO: Readonly<Record<EstadoHallazgo, string>> = { discrepa: 'No cuadra', atipico: 'Atípico', informativo: 'Informativo' };
const TITULO_GRUPO: Readonly<Record<EstadoHallazgo, string>> = { discrepa: 'No cuadran con su propia cuenta', atipico: 'Para revisar', informativo: 'Avisos' };
const PESO_FILA: Readonly<Record<FilaTipoMaq['estado'], number>> = { discrepa: 0, atipico: 1, no_evaluable: 2, informativo: 3, coherente: 4 };
/** Tipos que conviene ver primero: una cuenta que no cuadra, un candidato a revisión o algo que no se pudo comparar (nunca se esconde como «coherente»). */
const porVer = (t: FilaTipoMaq): boolean => t.estado === 'discrepa' || t.estado === 'atipico' || t.estado === 'no_evaluable';
const estadoDe = (f: FilaTipoMaq): Parameters<typeof InsigniaEstado>[0]['e'] => (f.estado === 'no_evaluable' ? { estado: 'no_evaluable', motivo: f.motivoNoEvaluable ?? 'No se pudo comparar.' } : { estado: f.estado });

const num = (x: number | null, dec = 2): string => (x === null ? 'S/D' : fmt(String(x), dec));
/** Diferencia relativa en porcentaje; si redondea a 0 no se muestra (una diferencia que dice «0 %» se contradice sola). */
const porcentaje = (r: number | null): string | null => (r === null || r < 0.0005 ? null : `${(r * 100).toLocaleString('es-MX', { maximumFractionDigits: r < 0.1 ? 1 : 0 })} %`);

/** Una cifra del libro y, si la cuenta no cierra, la de referencia, con palabras: «En el balance 2 · En IM01 3 · difiere 50 %». */
function Cifras({ h }: { h: HallazgoMaq }) {
    if (h.enLibro === null && h.referencia === null) return null;
    const p = porcentaje(h.relativa);
    return (
        <span className="mq-cifras">
            <span>{h.etiquetas[0]} <b>{h.enLibro ?? 'S/D'}</b>{h.unidad ? ` ${h.unidad}` : ''}</span>
            <span>{h.etiquetas[1]} <b>{h.referencia ?? 'S/D'}</b>{h.unidad ? ` ${h.unidad}` : ''}</span>
            {p !== null && <span className="mq-dif">difiere {p}</span>}
        </span>
    );
}

function ListaHallazgos({ hallazgos, conTipo = false }: { hallazgos: readonly HallazgoMaq[]; conTipo?: boolean }) {
    return (
        <ul className="mq-hallazgos">
            {hallazgos.map((h) => (
                <li key={h.id} className="mq-hallazgo" data-estado={h.estado}>
                    <div className="mq-h-cab">
                        <InsigniaEstado e={{ estado: h.estado }} />
                        <b className="mq-h-tit">{h.titulo}</b>
                    </div>
                    <p className="mq-h-det">{h.detalle}</p>
                    <Cifras h={h} />
                    <p className="mq-h-pie">
                        <span className="cons-der-base" title={AYUDA_BASE[h.base]}>{TEXTO_BASE[h.base]}</span>
                        <span>{h.fuente}</span>
                        {conTipo && h.tipoMaquina !== null && <span className="mq-tipo-tag">{h.tipoMaquina}</span>}
                    </p>
                    {h.refs.length > 0 && (
                        <details className="mq-celdas"><summary>Ver celdas del libro</summary><span className="mq-refs">{h.refs.join(' · ')}</span></details>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** Unidades del inventario sobre la necesidad: una razón de unidades, no un juicio de suficiencia. La marca vertical es el 100 %. */
function Cobertura({ valor }: { valor: number | null }) {
    if (valor === null) return <span className="mq-sd">S/D</span>;
    const pct = Math.min(100, (Math.min(valor, 1.5) / 1.5) * 100);
    return (
        <span className="mq-cob" title={`Unidades del inventario ÷ máquinas necesarias = ${Math.round(valor * 100)} %. Es una razón de unidades: no acredita suficiencia de horas ni la condición del parque.`}>
            <span className="mq-barra" aria-hidden="true"><i style={{ width: `${pct}%` }} /><u /></span>
            <b>{Math.round(valor * 100)} %</b>
        </span>
    );
}

function Condicion({ f }: { f: FilaTipoMaq }) {
    const libro: ReadonlyArray<readonly [number | null, string]> = [[f.libroBuenoRegular, 'bueno o regular'], [f.libroMalo, 'malo'], [f.libroBaja, 'baja']];
    const chips = libro.filter(([n]) => n !== null && n > 0);
    const inv: ReadonlyArray<readonly [number | null, string]> = [[f.invBuenoRegular, 'bueno o regular'], [f.invMalo, 'malo'], [f.invBaja, 'baja']];
    const invChips = inv.filter(([n]) => n !== null && n > 0);
    const libroVacio = libro.every(([n]) => n === null);
    const igual = f.existentesInventario !== null && libro.every(([n], i) => (n ?? 0) === (inv[i]?.[0] ?? 0)) && !(libroVacio && f.existentesInventario > 0);
    return (
        <span className="mq-cond">
            <span className="mq-chips">
                {chips.length === 0 ? <span className="mq-sd">{libroVacio ? 'Sin anotar' : '—'}</span> : chips.map(([n, t]) => <span key={t} className="mq-chip">{n} {t}</span>)}
            </span>
            {f.existentesInventario === null ? null : igual
                ? <small className="mq-cond-inv">= inventario</small>
                : (
                    <span className="mq-chips mq-cond-dist">
                        <small className="mq-dist">Inventario:</small>
                        {invChips.length === 0 ? <span className="mq-sd">sin unidades</span> : invChips.map(([n, t]) => <span key={t} className="mq-chip" data-inv="">{n} {t}</span>)}
                        {f.invSinEstado > 0 && <small className="mq-dist">+{f.invSinEstado} sin estado</small>}
                    </span>
                )}
        </span>
    );
}

/** Veredicto único de faltante y sobrante del libro; si el redondeo del umbral dice otra cosa, se dice en palabras (el libro dice X; saldría Y). */
function FaltaSobra({ f }: { f: FilaTipoMaq }) {
    if (f.faltanteLibro === null && f.sobranteLibro === null && f.faltanteCalculado === null) return <span className="mq-sd">S/D</span>;
    const sinAnotar = f.faltanteLibro === null && f.sobranteLibro === null;
    const fl = f.faltanteLibro ?? 0, sl = f.sobranteLibro ?? 0;
    const palabras = (falta: number, sobra: number): string => (falta > 0 ? `falta ${falta}` : sobra > 0 ? `sobra ${sobra}` : 'no falta ni sobra');
    const dif = f.faltanteCalculado !== null && (fl !== f.faltanteCalculado || sl !== (f.sobranteCalculado ?? 0));
    return (
        <span className="mq-fs">
            <b>{sinAnotar ? 'Sin anotar' : fl > 0 ? `Falta ${fl}` : sl > 0 ? `Sobra ${sl}` : 'Sin falta ni sobra'}</b>
            {dif && f.faltanteCalculado !== null && (
                <small className="mq-dist"><AlertTriangle size={12} aria-hidden="true" /> El libro dice que {sinAnotar ? 'no anota nada' : palabras(fl, sl)}; con el redondeo del umbral de {UMBRAL_ADQUISICION} (referencia del comprobador) {palabras(f.faltanteCalculado, f.sobranteCalculado ?? 0)}.</small>
            )}
        </span>
    );
}

function TablaBalance({ v }: { v: VistaMaquinaria }) {
    const [abierto, setAbierto] = useState<ReadonlySet<string>>(new Set());
    const conDif = useMemo(() => v.tipos.filter(porVer).length, [v.tipos]);
    const [solo, setSolo] = useState(conDif > 0 && conDif < v.tipos.length);
    const filas = useMemo(
        () => v.tipos.map((t, i) => ({ t, i })).filter(({ t }) => !solo || porVer(t)).sort((a, b) => PESO_FILA[a.t.estado] - PESO_FILA[b.t.estado] || a.i - b.i).map(({ t }) => t),
        [v.tipos, solo],
    );
    const alternar = (t: string) => setAbierto((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
    return (
        <div className="mq-balance">
            <p className="mq-leyenda"><b>No cuadra</b> = la cuenta del propio libro no suma · <b>Atípico</b> = difiere del inventario, de 3DN o del umbral: candidato a revisión · <b>No evaluable</b> = no se pudo comparar · <b>Coherente</b> no acredita suficiencia de horas, condición física ni rendimiento.</p>
            {conDif > 0 && conDif < v.tipos.length && (
                <label className="mq-solo"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> Solo tipos con diferencias <small>({conDif} de {v.tipos.length})</small></label>
            )}
            <div className="sc-tabla-wrap table-scroll">
                <table className="sc-tabla cons-tabla cons-apila mq-tabla">
                    <caption className="cons-solo-lector">Balance de maquinaria por tipo de máquina</caption>
                    <thead>
                        <tr>
                            <th scope="col">Tipo de máquina</th>
                            <th scope="col" className="cons-n">Necesarias</th>
                            <th scope="col" className="cons-n">Existentes</th>
                            <th scope="col">Condición del parque</th>
                            <th scope="col">Falta o sobra</th>
                            <th scope="col" className="cons-n">Adquirir</th>
                            <th scope="col">Unidades ÷ necesidad</th>
                            <th scope="col">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((f) => {
                            const n = f.hallazgos.length;
                            const dist = f.necesariasLibro !== null && f.necesariasRenglones !== null && Math.abs(f.necesariasLibro - f.necesariasRenglones) > 0.005;
                            const abre = abierto.has(f.tipo);
                            return (
                                <Fragment key={f.tipo}>
                                    <tr className="mq-fila" data-estado={f.estado}>
                                        <td data-label="Tipo de máquina" className="mq-c-tipo">
                                            <b className="mq-nombre">{f.tipo}</b>
                                            <small>{f.renglones === 0 ? 'Sin renglones de necesidad' : `${f.renglones === 1 ? '1 renglón' : `${f.renglones} renglones`} · ${num(f.horasNecesarias, 0)} h`}</small>
                                        </td>
                                        <td className="cons-n mq-c-nec" data-label="Necesarias">{num(f.necesariasRenglones ?? f.necesariasLibro, 2)}{dist && <small className="mq-dist">el balance dice {num(f.necesariasLibro, 2)}</small>}</td>
                                        <td className="cons-n mq-c-exi" data-label="Existentes">{f.existentesLibro === null ? <span className="mq-sd" title="El balance del libro no trae existentes de este tipo">Sin dato</span> : num(f.existentesLibro, 0)}{f.existentesInventario !== null && <small className={f.existentesLibro !== null && f.existentesLibro !== f.existentesInventario ? 'mq-dist' : undefined}>Inventario: {f.existentesInventario}</small>}</td>
                                        <td data-label="Condición del parque" className="mq-c-con"><Condicion f={f} /></td>
                                        <td data-label="Falta o sobra" className="mq-c-fs"><FaltaSobra f={f} /></td>
                                        <td className="cons-n mq-c-adq" data-label="Adquirir">{num(f.adquirir, 0)}{((f.porFaltante ?? 0) > 0 || (f.porSustituir ?? 0) > 0) && <small>{(f.porFaltante ?? 0) > 0 ? `por faltante ${f.porFaltante}` : ''}{(f.porFaltante ?? 0) > 0 && (f.porSustituir ?? 0) > 0 ? ' · ' : ''}{(f.porSustituir ?? 0) > 0 ? `por sustituir ${f.porSustituir}` : ''}</small>}</td>
                                        <td data-label="Unidades ÷ necesidad" className="mq-c-cob"><Cobertura valor={f.cobertura} /></td>
                                        <td data-label="Estado" className="mq-estado mq-c-est">
                                            <InsigniaEstado e={estadoDe(f)} />
                                            {n > 0 && (
                                                <button type="button" className="mq-ver" aria-expanded={abre} onClick={() => alternar(f.tipo)} aria-label={`${abre ? 'Ocultar' : 'Ver'} las ${n} observaciones de ${f.tipo}`}>
                                                    {abre ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />} {n} {n === 1 ? 'observación' : 'observaciones'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {abre && n > 0 && <tr className="mq-detalle"><td colSpan={8}><ListaHallazgos hallazgos={f.hallazgos} /></td></tr>}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function VistaDiferencias({ v }: { v: VistaMaquinaria }) {
    const [estado, setEstado] = useState<FiltroEstado>('');
    const [tipo, setTipo] = useState('');
    const tipos = useMemo(() => [...new Set(v.hallazgos.map((h) => h.tipoMaquina).filter((t): t is string => t !== null))], [v.hallazgos]);
    const cuentas = useMemo(() => ({ discrepa: v.resumen.discrepancias, atipico: v.resumen.atipicos, informativo: v.resumen.informativos }), [v.resumen]);
    const tipoValido = tipos.includes(tipo) ? tipo : '';
    const lista = v.hallazgos.filter((h) => (estado === '' || h.estado === estado) && (tipoValido === '' || h.tipoMaquina === tipoValido));
    if (v.hallazgos.length === 0) {
        return v.inventarioLeido
            ? <EstadoVacio titulo="No se encontró ninguna diferencia">El balance, los renglones, el inventario y 3DN no se contradicen entre sí en lo que este comprobador revisa. No es una aprobación del PacOT.</EstadoVacio>
            : <EstadoVacio titulo="No se pudo comparar con el inventario">No se encontró ninguna otra diferencia, pero IM01 no se pudo leer: no hay con qué comparar las existentes ni la condición del parque.</EstadoVacio>;
    }
    const grupos = (['discrepa', 'atipico', 'informativo'] as const).map((e) => ({ e, items: lista.filter((h) => h.estado === e) })).filter((g) => g.items.length > 0);
    return (
        <div className="mq-dif-vista">
            <p className="mq-leyenda"><b>B Maq</b> = hoja de balance de maquinaria · <b>3DN</b> = diagnóstico de necesidades medias anuales de conservación normal (DNMACN) · <b>IM01</b> = inventario de maquinaria · «suma de renglones» = suma de las máquinas de cada tipo en la parte superior de B Maq.</p>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <span className="cons-etiqueta" id="mq-f-estado">Naturaleza</span>
                    <div className="cons-sev-grupo" role="group" aria-labelledby="mq-f-estado">
                        <button type="button" className="cons-sev-btn" aria-pressed={estado === ''} onClick={() => setEstado('')}>Todas <small>{v.hallazgos.length}</small></button>
                        {(['discrepa', 'atipico', 'informativo'] as const).map((e) => cuentas[e] > 0 && (
                            <button key={e} type="button" className="cons-sev-btn" aria-pressed={estado === e} onClick={() => setEstado(estado === e ? '' : e)}>{TEXTO_FILTRO[e]} <small>{cuentas[e]}</small></button>
                        ))}
                    </div>
                </div>
                {tipos.length > 0 && (
                    <div className="sc-campo">
                        <label htmlFor="mq-f-tipo">Tipo de máquina</label>
                        <select id="mq-f-tipo" value={tipoValido} onChange={(e) => setTipo(e.target.value)}>
                            <option value="">Todos</option>
                            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                )}
            </div>
            <p className="cons-cuenta" role="status" aria-live="polite">{lista.length} de {v.hallazgos.length} observaciones</p>
            {lista.length === 0 ? <EstadoVacio titulo="Ninguna observación coincide con estos filtros" accion={{ texto: 'Quitar filtros', onClick: () => { setEstado(''); setTipo(''); } }} /> : grupos.map((g) => (
                g.e === 'informativo' && estado === '' && g.items.length > 1
                    ? <details key={g.e} className="mq-grupo mq-grupo-info"><summary><h4><ChevronRight size={14} aria-hidden="true" /> {TITULO_GRUPO[g.e]} <small>{g.items.length} · toque para ver</small></h4></summary><ListaHallazgos hallazgos={g.items} conTipo /></details>
                    : <section key={g.e} className="mq-grupo" aria-label={TITULO_GRUPO[g.e]}><h4>{TITULO_GRUPO[g.e]} <small>{g.items.length}</small></h4><ListaHallazgos hallazgos={g.items} conTipo /></section>
            ))}
        </div>
    );
}

const MODO_TEXTO: Readonly<Record<ConceptoMaq['modo'], string>> = {
    reparto: 'Coincide con 3DN (la suma de los renglones de B Maq iguala la necesidad)',
    completa: 'Cada equipo trae la cantidad completa: confirmar que son procesos distintos',
    difiere: 'No coincide con 3DN',
    sin_equivalente: 'Sin equivalente en 3DN',
    sin_cifra: 'Falta una de las dos cifras para comparar',
};
const PESO_MODO: Readonly<Record<ConceptoMaq['modo'], number>> = { difiere: 0, completa: 1, sin_cifra: 2, reparto: 3, sin_equivalente: 4 };

function TablaConceptos({ v }: { v: VistaMaquinaria }) {
    const conceptos = useMemo(() => v.conceptos.map((c, i) => ({ c, i })).sort((a, b) => PESO_MODO[a.c.modo] - PESO_MODO[b.c.modo] || a.i - b.i).map(({ c }) => c), [v.conceptos]);
    return (
        <div className="sc-tabla-wrap table-scroll">
            <table className="sc-tabla cons-tabla cons-apila mq-tabla mq-tabla-conceptos">
                <caption className="cons-solo-lector">Cantidad anual de cada concepto en B Maq contra la necesidad de 3DN</caption>
                <thead>
                    <tr>
                        <th scope="col">Concepto</th><th scope="col">Equipos</th>
                        <th scope="col" className="cons-n">B Maq (anual)</th>
                        <th scope="col" className="cons-n">3DN (anual)</th>
                        <th scope="col" className="cons-n">B Maq ÷ 3DN</th><th scope="col">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    {conceptos.map((c) => {
                        const u = c.unidad?.trim().replace(/m3/i, 'm³').replace(/m2/i, 'm²').toLowerCase() ?? '';
                        const equipos = [...new Set(c.renglones.map((r) => r.tipoCanonico ?? (r.tipo === '' ? 'sin tipo' : r.tipo)))];
                        const sin = c.modo === 'sin_equivalente';
                        return (
                            <tr key={c.clave} className="mq-fila" data-estado={c.estado === 'no_evaluable' ? 'informativo' : c.estado}>
                                <td data-label="Concepto"><b className="mq-nombre">{c.concepto}</b><small>{c.bloque === null ? 'Bloque sin identificar' : BLOQUE[c.bloque]}{c.concepto3dn !== null ? ` · 3DN: ${c.concepto3dn}` : ''}</small></td>
                                <td data-label="Equipos" className="mq-c-equipos"><span className="mq-equipos">{equipos.join(', ')}</span><small>{c.renglones.length === 1 ? '1 renglón' : `${c.renglones.length} renglones`}</small></td>
                                <td className="cons-n" data-label="B Maq (anual)">{num(c.anualBMaq, 2)}{u && <small>{u}</small>}</td>
                                <td className="cons-n" data-label="3DN (anual)">{sin ? <span className="mq-sd">—</span> : num(c.anual3dn, 2)}</td>
                                <td className="cons-n" data-label="B Maq ÷ 3DN">{c.razon === null ? <span className="mq-sd">—</span> : `${c.razon.toLocaleString('es-MX', { maximumFractionDigits: 2 })}×`}</td>
                                <td data-label="Estado" className="mq-c-est2">
                                    {sin
                                        ? <><InsigniaEstado e={{ estado: 'no_evaluable', motivo: notaSinEquivalente(c.bloque) }} /><small>{notaSinEquivalente(c.bloque)}</small></>
                                        : <><InsigniaEstado e={c.estado === 'no_evaluable' ? { estado: 'no_evaluable', motivo: MODO_TEXTO[c.modo] } : { estado: c.estado }} /><small>{MODO_TEXTO[c.modo]}</small></>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function VistaInventario({ v }: { v: VistaMaquinaria }) {
    const [tipo, setTipo] = useState('');
    const tipos = useMemo(() => [...new Set(v.inventario.map((u) => u.tipoCanonico ?? u.tipo))], [v.inventario]);
    const tipoValido = tipos.includes(tipo) ? tipo : '';
    const lista = useMemo(() => v.inventario.filter((u) => tipoValido === '' || (u.tipoCanonico ?? u.tipo) === tipoValido), [v.inventario, tipoValido]);
    const hayObs = lista.some((u) => u.observaciones !== null);
    const porUnidad = useMemo(() => {
        const m = new Map<string, HallazgoMaq[]>();
        // El id de una observación de inventario termina en la fila de IM01 de la unidad.
        for (const h of v.hallazgos) if (h.codigo.startsWith('inv_')) { const fila = h.id.split(':')[1] ?? ''; m.set(fila, [...(m.get(fila) ?? []), h]); }
        return m;
    }, [v.hallazgos]);
    if (v.inventario.length === 0) return <EstadoVacio titulo={v.inventarioLeido ? 'Este PacOT no trae unidades en el inventario de maquinaria' : 'No se pudo leer el inventario de maquinaria'}>El inventario se lee de la hoja IM01 (formato CNA-DR-IM-01). {v.avisos.join(' ')}</EstadoVacio>;
    return (
        <div className="mq-dif-vista">
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="mq-i-tipo">Tipo de máquina</label>
                    <select id="mq-i-tipo" value={tipoValido} onChange={(e) => setTipo(e.target.value)}>
                        <option value="">Todos</option>
                        {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
            </div>
            <p className="cons-cuenta" role="status" aria-live="polite">{lista.length} de {v.inventario.length} unidades · {v.resumen.accesorios} implemento{v.resumen.accesorios === 1 ? '' : 's'} que no cuenta{v.resumen.accesorios === 1 ? '' : 'n'} como máquina</p>
            <div className="sc-tabla-wrap table-scroll">
                <table className="sc-tabla cons-tabla cons-apila mq-tabla">
                    <caption className="cons-solo-lector">Inventario de maquinaria (IM01)</caption>
                    <thead><tr><th scope="col">Tipo y número económico</th><th scope="col">Marca y modelo</th><th scope="col">Estado mecánico</th><th scope="col" className="cons-n">Horas trabajadas</th><th scope="col">Avisos{hayObs ? ' y observaciones' : ''}</th></tr></thead>
                    <tbody>
                        {lista.map((u) => {
                            const hs = (porUnidad.get(String(u.fila)) ?? []).filter((h) => h.codigo !== 'inv_accesorio' && h.codigo !== 'inv_tipo');
                            return (
                                <tr key={u.fila} className="mq-fila" data-estado={u.accesorio ? 'informativo' : undefined}>
                                    <td data-label="Tipo y número económico"><b className="mq-nombre">{u.tipo}</b><small className="mq-eco">{u.numeroEconomico ?? 'sin número económico'} · fila {u.fila}</small>{u.accesorio && <small className="mq-dist">implemento: no cuenta como máquina</small>}</td>
                                    <td data-label="Marca y modelo">{[u.marca, u.modelo].filter(Boolean).join(' ') || <span className="mq-sd">S/D</span>}</td>
                                    <td data-label="Estado mecánico">{u.estadoConflicto ? <span className="mq-dist">más de uno marcado</span> : u.estado === null ? <span className="mq-sd">sin marcar</span> : <span className="mq-estmec" data-e={u.estado}>{ESTADO_MECANICO[u.estado]}</span>}</td>
                                    <td className="cons-n" data-label="Horas trabajadas">
                                        {u.horas.valor !== null ? fmt(u.horas.valor, 0) : u.horas.texto !== undefined ? <span className="mq-dist">{u.horas.texto}</span> : <span className="mq-sd">S/D</span>}
                                        {u.unidadLectura !== null && u.unidadLectura !== 'horas' && <small className="mq-dist">no son horas</small>}
                                    </td>
                                    <td data-label="Avisos y observaciones">{u.observaciones ?? ''}{hs.length > 0 && <small>{hs.map((h) => h.titulo.split(': ').slice(1).join(': ') || h.titulo).join(' · ')}</small>}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * Balance de maquinaria (B Maq + IM01): por tipo de máquina, la necesidad que sale de los renglones, lo que el balance declara,
 * lo que inventaría IM01 y lo que dice 3DN; y dónde esas cuentas no coinciden. Solo informa: no corrige ni aprueba el libro.
 */
export function DerivacionMaquinaria({ pacots, ambito, setAmbito }: Props) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const v = useMemo(() => (pacot ? vistaMaquinaria(pacot.libro) : null), [pacot]);
    const { actualizar } = useNavegacion();
    const [vista, setVista] = useState<Vista>('balance');
    if (!pacot) return <SinPacot />;
    const amb = etiquetaAmbito(pacot);
    const r = v?.resumen;
    const lecturaAnterior = pacot.libro.extractorVersion < EXTRACTOR_CON_MAQUINARIA;

    return (
        <section className="sc-card cons-pg mq" aria-labelledby="mq-t">
            <div><h3 id="mq-t" style={{ marginBottom: 0 }}>Balance de maquinaria</h3><p className="cons-pg-sub">Máquinas que necesita el programa, las que hay en el inventario y en qué estado están, por tipo de máquina.</p></div>
            <p className="sc-aviso cons-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA}</span></p>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="mq-amb">PacOT</label>
                    <select id="mq-amb" value={amb} onChange={(e) => setAmbito(e.target.value)}>
                        {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
                    </select>
                </div>
            </div>

            {v === null || r === undefined ? (
                <EstadoVacio titulo={lecturaAnterior ? 'Este PacOT se leyó antes de que existiera el balance de maquinaria' : pacot.libro.avisos.some((a) => a.startsWith('Maquinaria: no se pudo leer')) ? 'No se pudo leer el balance de maquinaria de este PacOT' : 'Este PacOT no trae la hoja B Maq'}
                    accion={lecturaAnterior && actualizar ? { texto: 'Actualizar desde la carpeta', onClick: actualizar } : null}>
                    {lecturaAnterior
                        ? (actualizar ? 'Vuelva a leer la carpeta de PacOT para extraer B Maq e IM01; el libro original no se modifica.' : 'Este archivo de derivación es anterior al balance de maquinaria. Genere uno nuevo con «npm run conservacion:derivar» y ábralo de nuevo; el libro original no se modifica.')
                        : `El balance se lee de la hoja B Maq (formato 4 DNMACN) y el inventario de IM01. ${pacot.libro.avisos.filter((a) => a.startsWith('Maquinaria:')).join(' ')}`}
                </EstadoVacio>
            ) : !v.balanceLeido ? (
                <EstadoVacio titulo="No se pudo leer el balance de este PacOT" tipo="error">
                    No se encontraron los renglones ni la tabla de balance en la hoja B Maq, así que no hay nada que comparar (no es que no haya diferencias). {v.avisos.join(' ')}
                </EstadoVacio>
            ) : (
                <>
                    <dl className="mq-kpis">
                        <div className="mq-kpi"><dt>Máquinas necesarias</dt><dd>{num(r.necesariasRenglones ?? r.necesariasLibro)}</dd><small>{r.necesariasLibro !== null && r.necesariasRenglones !== null && Math.abs(r.necesariasLibro - r.necesariasRenglones) > 0.005 ? `el balance dice ${num(r.necesariasLibro)}` : `con las horas disponibles de cada renglón (referencia del Manual: ${fmt(String(HORAS_DISPONIBLES), 0)} h)`}</small></div>
                        <div className="mq-kpi"><dt>Existentes</dt><dd>{num(r.existentesLibro, 0)}</dd><small className={r.existentesInventario !== null && r.existentesLibro !== null && r.existentesLibro !== r.existentesInventario ? 'mq-dist' : undefined}>{r.existentesInventario === null ? 'inventario IM01 no leído' : `${r.existentesInventario} en el inventario IM01`}</small></div>
                        <div className="mq-kpi"><dt>Faltan · sobran</dt><dd>{num(r.faltanteLibro, 0)} · {num(r.sobranteLibro, 0)}</dd><small>según el balance del libro</small></div>
                        <div className="mq-kpi" data-alerta={r.discrepancias + r.atipicos > 0 ? '' : undefined}>
                            <dt>Por revisar</dt><dd>{r.discrepancias + r.atipicos}</dd>
                            <small>{r.discrepancias} no cuadra{r.discrepancias === 1 ? '' : 'n'} · {r.atipicos} atípico{r.atipicos === 1 ? '' : 's'} · {r.informativos} aviso{r.informativos === 1 ? '' : 's'}</small>
                        </div>
                    </dl>

                    <div className="cons-sev-grupo" role="group" aria-label="Vista del balance de maquinaria">
                        {([['balance', 'Balance por tipo', Truck], ['diferencias', `Diferencias ${r.hallazgos}`, AlertTriangle], ['conceptos', 'Concepto contra 3DN', Link2], ['inventario', `Inventario ${r.unidades}`, ClipboardList]] as const).map(([id, texto, Ico]) => (
                            <button key={id} type="button" className="cons-sev-btn" aria-pressed={vista === id} onClick={() => setVista(id)}><Ico size={16} aria-hidden="true" /> {texto}</button>
                        ))}
                    </div>

                    {v.avisos.length > 0 && <p className="sc-aviso" role="note"><span>{v.avisos.join(' ')}</span></p>}
                    {vista === 'balance' && <TablaBalance key={pacot.clave} v={v} />}
                    {vista === 'diferencias' && <VistaDiferencias key={pacot.clave} v={v} />}
                    {vista === 'conceptos' && <TablaConceptos key={pacot.clave} v={v} />}
                    {vista === 'inventario' && <VistaInventario key={pacot.clave} v={v} />}
                </>
            )}
        </section>
    );
}
