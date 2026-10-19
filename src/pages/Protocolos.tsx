import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Clock, Droplets, Loader2, Pencil, Shield, ShieldOff, Waves, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHydricEvents, type HydraulicEvent, type SICAEventLog } from '../hooks/useHydricEvents';
import { useModalA11y } from '../hooks/useModalA11y';
import { PaginaHero } from '../components/ui/PaginaHero';
import type { ChipEstado } from '../utils/alertasVivas';
import { getLocalDatetimeInput, formatDate } from '../utils/dateHelpers';
import LlenadoTracker from '../components/LlenadoTracker';
import EstabilizacionTracker from '../components/EstabilizacionTracker';
import ProtocolGuide from '../components/ProtocolGuide';
import '../styles/sala-control.css';
import './Protocolos.css';

/** Capacidad de diseño del canal principal (hydric_knowledge_base) = tope que también exige la base de datos. */
const Q_MAX_M3S = 60;

const PROTOCOLOS: Array<{ id: HydraulicEvent; icon: typeof Waves; label: string; color: string; desc: string }> = [
    { id: 'LLENADO', icon: Waves, label: 'Llenado', color: '#3b82f6', desc: 'Apertura de obra de toma. Seguimiento de la onda positiva.' },
    { id: 'ESTABILIZACION', icon: Droplets, label: 'Estabilización', color: '#10b981', desc: 'Flujo permanente. Distribución a tomas y laterales.' },
    { id: 'CONTINGENCIA_LLUVIA', icon: AlertTriangle, label: 'Contingencia por lluvia', color: '#f59e0b', desc: 'Maniobras de desfogue y control de excedentes.' },
    { id: 'VACIADO', icon: Shield, label: 'Vaciado', color: '#ef4444', desc: 'Cierre de ciclo. Control de subpresiones (máx. 30 cm/día).' },
    { id: 'ANOMALIA_BAJA', icon: AlertTriangle, label: 'Anomalía: baja súbita', color: '#a78bfa', desc: 'Caída de nivel no programada. Posible robo o falla estructural (CONAGUA).' },
];

// ─── Diálogo accesible (portal a <body>: el contenedor de página tiene animación y anclaría los `fixed`) ─────────────
function Dialogo({ titulo, onCerrar, children, ancho = 480 }: { titulo: string; onCerrar: () => void; children: React.ReactNode; ancho?: number }) {
    const ref = useModalA11y<HTMLDivElement>(true, onCerrar);
    const id = useId();
    return createPortal(
        <div className="sc-root pr-portal">
            <div className="pr-fondo" onClick={onCerrar}>
                <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="pr-dialogo" style={{ maxWidth: ancho }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="pr-cerrar" onClick={onCerrar} aria-label="Cerrar"><X size={20} aria-hidden="true" /></button>
                    <h2 id={id}>{titulo}</h2>
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** Solo la S.R.L. dicta protocolos oficiales: el guard va antes de montar los hooks (y la base de datos lo exige también). */
export default function Protocolos() {
    const { profile } = useAuth();
    if (profile?.rol !== 'SRL') {
        return (
            <div className="sc-root sc-pagina">
                <section className="sc-card" role="alert" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <ShieldOff size={36} aria-hidden="true" style={{ color: 'var(--sc-crit)' }} />
                    <h1 className="sc-titulo" style={{ marginTop: 8 }}>Acceso restringido</h1>
                    <p style={{ color: 'var(--sc-t2)', margin: '8px auto 0', maxWidth: '52ch' }}>Los protocolos hidráulicos oficiales solo pueden dictarse por Gerencia (S.R.L.).</p>
                </section>
            </div>
        );
    }
    return <ProtocolosInterno />;
}

function ProtocolosInterno() {
    const { activeEvent, isLoading, activateEvent, updateEvent, error: eventError, cargado } = useHydricEvents();

    // Activación
    const [pendiente, setPendiente] = useState<(typeof PROTOCOLOS)[number] | null>(null);
    const [formGasto, setFormGasto] = useState('');
    const [formApertura, setFormApertura] = useState('');
    const [formValvulas, setFormValvulas] = useState('V1, V2');
    const [formNotas, setFormNotas] = useState('');
    // Confirmación de apertura
    const [mostrarApertura, setMostrarApertura] = useState(false);
    const [fechaApertura, setFechaApertura] = useState('');
    // Edición del gasto solicitado
    const [editandoGasto, setEditandoGasto] = useState(false);
    const [valorGasto, setValorGasto] = useState('');
    const [errorLocal, setErrorLocal] = useState<string | null>(null);

    // La hora de apertura SIEMPRE sale de la BD (updateEvent vuelve a leer el evento): nunca se cronometra con un dato no guardado.
    const horaApertura = activeEvent?.hora_apertura_real ?? null;

    const gasto = parseFloat(formGasto), apertura = parseFloat(formApertura);
    // Sin valores por defecto escondidos: un campo vacío no crea un evento de 60 m³/s al 100 %.
    const llenadoValido = Number.isFinite(gasto) && gasto > 0 && gasto <= Q_MAX_M3S && Number.isFinite(apertura) && apertura > 0 && apertura <= 100;

    const abrirActivacion = (p: (typeof PROTOCOLOS)[number]) => {
        setPendiente(p); setFormNotas(''); setFormGasto(''); setFormApertura(''); setErrorLocal(null);
    };

    const confirmarActivacion = async () => {
        if (!pendiente) return;
        let guardado: boolean;
        if (pendiente.id === 'LLENADO') {
            guardado = await activateEvent('LLENADO', {
                gasto_solicitado_m3s: gasto, porcentaje_apertura_presa: apertura,
                valvulas_activas: formValvulas.split(',').map((s) => s.trim()).filter(Boolean), notas: formNotas,
                // hora_apertura_real se confirma DESPUÉS en el seguimiento: no cronometrar sin saber si la presa abrió.
            });
        } else {
            guardado = await activateEvent(pendiente.id, { notas: formNotas });
        }
        if (guardado) setPendiente(null);     // si falló, el diálogo sigue abierto con lo capturado y el error visible
    };

    const guardarGasto = async (nuevo?: number) => {
        if (!activeEvent) return;
        const v = nuevo ?? parseFloat(valorGasto);
        if (!Number.isFinite(v) || v <= 0 || v > Q_MAX_M3S) { setErrorLocal(`El gasto debe ser mayor que 0 y de hasta ${Q_MAX_M3S} m³/s.`); return; }
        setErrorLocal(null);
        if (await updateEvent(activeEvent.id, { gasto_solicitado_m3s: v })) setEditandoGasto(false);
    };

    const confirmarApertura = async () => {
        if (!fechaApertura || !activeEvent) return;
        const iso = new Date(fechaApertura).toISOString();
        if (await updateEvent(activeEvent.id, { hora_apertura_real: iso })) setMostrarApertura(false);
    };

    const ev: SICAEventLog | null = activeEvent;
    const def = PROTOCOLOS.find((p) => p.id === ev?.evento_tipo);
    const chips: ChipEstado[] = [
        ev ? { key: 'ev', sev: 'info', texto: `Vigente: ${def?.label ?? ev.evento_tipo}` }
            : !cargado ? { key: 'ev', sev: 'info', texto: 'Protocolo: sincronizando…' }
            : eventError ? { key: 'ev', sev: 'warn', texto: 'Protocolo: S/D' }
            : { key: 'ev', sev: 'warn', texto: 'Sin evento oficial registrado' },
        ...(ev ? [{ key: 'desde', sev: 'info' as const, texto: `Dictado el ${formatDate(ev.fecha_inicio)}` }] : []),
    ];

    return (
        <div className="sc-root sc-pagina">
            <PaginaHero
                kicker="Operación · solo S.R.L."
                titulo="Protocolos hidráulicos"
                subtitulo="El evento operativo oficial sincroniza al asistente de IA y las reglas de seguridad de toda la plataforma. Cada activación queda auditada bajo su firma."
                chips={chips}
            />

            {eventError && <p className="sc-aviso sc-aviso-crit" role="alert"><AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> {eventError}</p>}

            <section className="sc-card" aria-labelledby="pr-vigente">
                <span className="sc-kicker">Protocolo oficial vigente</span>
                {(!cargado || isLoading) && !ev ? (
                    <p role="status" className="pr-vacio"><Loader2 size={20} className="spin" aria-hidden="true" /> Sincronizando estado oficial…</p>
                ) : ev ? (
                    <>
                        <h2 id="pr-vigente" className="pr-vigente-titulo" style={{ color: def?.color }}>{def ? <def.icon size={28} aria-hidden="true" /> : null} {def?.label ?? ev.evento_tipo}</h2>
                        <p className="pr-meta">Dictado el {formatDate(ev.fecha_inicio)}</p>
                        {ev.notas && <p className="pr-notas">{ev.notas}</p>}
                        {ev.evento_tipo === 'LLENADO' && ev.gasto_solicitado_m3s != null && (
                            <dl className="pr-datos">
                                <div>
                                    <dt>Gasto solicitado</dt>
                                    <dd>
                                        {editandoGasto ? (
                                            <span className="pr-edit">
                                                <label className="sc-sr" htmlFor="pr-gasto-edit">Nuevo gasto solicitado en m³/s</label>
                                                <input id="pr-gasto-edit" type="number" inputMode="decimal" min={0} max={Q_MAX_M3S} step="0.1" value={valorGasto} autoFocus onChange={(e) => setValorGasto(e.target.value)} />
                                                <button type="button" className="sc-btn" onClick={() => void guardarGasto()} aria-label="Guardar gasto"><CheckCircle2 size={16} aria-hidden="true" /></button>
                                                <button type="button" className="sc-btn" onClick={() => { setEditandoGasto(false); setErrorLocal(null); }} aria-label="Cancelar edición"><X size={16} aria-hidden="true" /></button>
                                            </span>
                                        ) : (
                                            <>
                                                {ev.gasto_solicitado_m3s} m³/s
                                                {!ev.hora_apertura_real && (
                                                    <button type="button" className="sc-btn" onClick={() => { setValorGasto(String(ev.gasto_solicitado_m3s ?? '')); setEditandoGasto(true); }} aria-label="Editar gasto solicitado"><Pencil size={14} aria-hidden="true" /></button>
                                                )}
                                            </>
                                        )}
                                    </dd>
                                </div>
                                <div><dt>Apertura de presa</dt><dd>{ev.porcentaje_apertura_presa != null ? `${ev.porcentaje_apertura_presa} %` : 'S/D'}</dd></div>
                                <div><dt>Válvulas</dt><dd>{ev.valvulas_activas?.length ? ev.valvulas_activas.join(', ') : 'S/D'}</dd></div>
                            </dl>
                        )}
                        {errorLocal && <p className="sc-aviso sc-aviso-crit" role="alert">{errorLocal}</p>}
                    </>
                ) : eventError ? (
                    <>
                        <h2 id="pr-vigente" className="pr-vigente-titulo">Protocolo vigente: S/D</h2>
                        <p className="pr-meta">No se pudo consultar el estado oficial. No se afirma que no haya protocolo.</p>
                    </>
                ) : (
                    <>
                        <h2 id="pr-vigente" className="pr-vigente-titulo">Sin evento oficial registrado</h2>
                        <p className="pr-meta">No hay un protocolo vigente. Elige uno abajo para dictarlo.</p>
                    </>
                )}
            </section>

            {ev && <ProtocolGuide type={ev.evento_tipo} eventData={ev} />}
            {ev?.evento_tipo === 'LLENADO' && ev.gasto_solicitado_m3s == null && (
                <p className="sc-aviso sc-aviso-warn" role="status"><AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> El evento de llenado no trae gasto solicitado (S/D): el seguimiento del frente de onda necesita ese dato.</p>
            )}
            {ev?.evento_tipo === 'LLENADO' && ev.gasto_solicitado_m3s != null && (
                <LlenadoTracker
                    eventoId={ev.id} qSolicitado={ev.gasto_solicitado_m3s} horaApertura={horaApertura}
                    onConfirmarApertura={() => { setFechaApertura(getLocalDatetimeInput()); setMostrarApertura(true); }}
                    onUpdateGasto={(g) => { void guardarGasto(g); }}
                />
            )}
            {ev?.evento_tipo === 'ESTABILIZACION' && <EstabilizacionTracker />}

            <section aria-labelledby="pr-dictar">
                <h2 id="pr-dictar" className="sc-kicker" style={{ marginBottom: 10 }}>Dictar un protocolo</h2>
                <div className="pr-grid">
                    {PROTOCOLOS.map((p) => {
                        const activo = ev?.evento_tipo === p.id;
                        return (
                            <button key={p.id} type="button" className={`pr-protocolo ${activo ? 'pr-protocolo-activo' : ''}`} style={{ '--pr-color': p.color } as React.CSSProperties}
                                disabled={isLoading} aria-pressed={activo} onClick={() => abrirActivacion(p)}>
                                <span className="pr-icono" aria-hidden="true"><p.icon size={24} /></span>
                                <span className="pr-texto">
                                    <b>{p.label}</b>
                                    <span>{p.desc}</span>
                                    {activo && <span className="sc-estado sc-estado-info">Vigente</span>}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {pendiente && (
                <Dialogo titulo={`Activar: ${pendiente.label}`} onCerrar={() => setPendiente(null)}>
                    <p className="sc-aviso sc-aviso-warn"><Shield size={16} aria-hidden="true" style={{ flexShrink: 0 }} /> <span><b>Acción gerencial (S.R.L.).</b> Desactivará el protocolo actual y cambiará las reglas de toda la cuenca. Queda auditada bajo su firma digital.</span></p>
                    {pendiente.id === 'LLENADO' && (
                        <div className="pr-form">
                            <div className="sc-campo"><label htmlFor="pr-f-gasto">Gasto solicitado (m³/s)</label>
                                <input id="pr-f-gasto" type="number" inputMode="decimal" min={0} max={Q_MAX_M3S} step="0.1" value={formGasto} onChange={(e) => setFormGasto(e.target.value)} aria-invalid={formGasto !== '' && !(gasto > 0 && gasto <= Q_MAX_M3S)} />
                                <small>Mayor que 0 y hasta {Q_MAX_M3S} m³/s (capacidad de diseño del canal).</small></div>
                            <div className="sc-campo"><label htmlFor="pr-f-ap">Apertura de presa (%)</label>
                                <input id="pr-f-ap" type="number" inputMode="decimal" min={0} max={100} step="1" value={formApertura} onChange={(e) => setFormApertura(e.target.value)} aria-invalid={formApertura !== '' && !(apertura > 0 && apertura <= 100)} />
                                <small>Entre 1 y 100 %.</small></div>
                            <div className="sc-campo"><label htmlFor="pr-f-val">Válvulas activas</label>
                                <input id="pr-f-val" type="text" value={formValvulas} onChange={(e) => setFormValvulas(e.target.value)} /></div>
                        </div>
                    )}
                    <div className="sc-campo"><label htmlFor="pr-f-notas">Notas operativas</label>
                        <textarea id="pr-f-notas" rows={2} value={formNotas} onChange={(e) => setFormNotas(e.target.value)} placeholder="Notas adicionales…" /></div>
                    {eventError && <p className="sc-aviso sc-aviso-crit" role="alert">{eventError}</p>}
                    <div className="pr-acciones">
                        <button type="button" className="sc-btn" onClick={() => setPendiente(null)}>Cancelar</button>
                        <button type="button" className="sc-btn sc-btn-primario" disabled={isLoading || (pendiente.id === 'LLENADO' && !llenadoValido)} onClick={() => void confirmarActivacion()}>
                            {isLoading ? 'Procesando…' : 'Activar protocolo'}
                        </button>
                    </div>
                </Dialogo>
            )}

            {mostrarApertura && (
                <Dialogo titulo="Confirmar apertura" onCerrar={() => setMostrarApertura(false)} ancho={420}>
                    <p style={{ color: 'var(--sc-t2)', marginTop: 0 }}>Indica el <b>día y la hora</b> exactos en que se realizó la maniobra en la obra de toma.</p>
                    <div className="sc-campo"><label htmlFor="pr-f-fecha"><Clock size={12} aria-hidden="true" /> Fecha y hora de apertura</label>
                        <input id="pr-f-fecha" type="datetime-local" value={fechaApertura} onChange={(e) => setFechaApertura(e.target.value)} /></div>
                    <div className="pr-acciones">
                        <button type="button" className="sc-btn" onClick={() => setMostrarApertura(false)}>Cancelar</button>
                        <button type="button" className="sc-btn sc-btn-primario" disabled={!fechaApertura} onClick={() => void confirmarApertura()}>Confirmar</button>
                    </div>
                </Dialogo>
            )}
        </div>
    );
}
