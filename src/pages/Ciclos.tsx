import { useState } from 'react';
import { useCiclos, type CicloAgricola, type Modulo, type ModuloCiclo } from '../hooks/useCiclos';
import { Save, Edit2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '../utils/formato';
import { PaginaHero } from '../components/ui/PaginaHero';
import { TileCifra } from '../components/ui/TileCifra';
import type { ChipEstado } from '../utils/alertasVivas';
import '../styles/sala-control.css';
import './Ciclos.css';

export default function Ciclos() {
    const { ciclos, modulos, modulosCiclos, loading, saveCiclo, saveModuloCiclo } = useCiclos();
    const [selectedCicloId, setSelectedCicloId] = useState<string | null>(null);

    // Formulario de Ciclo
    const [formData, setFormData] = useState<Partial<CicloAgricola>>({});
    const [isEditing, setIsEditing] = useState(false);

    if (loading && ciclos.length === 0) {
        return <div className="sc-root sc-pagina ci-root"><div className="ci-vacio" role="status">Cargando ciclos…</div></div>;
    }

    // Ciclo seleccionado; por defecto el ACTIVO (no el más reciente por fecha de alta).
    const selectedCiclo = ciclos.find(c => c.id === selectedCicloId) || ciclos.find(c => c.activo) || ciclos[0];
    const hoy = new Date().toISOString().slice(0, 10);
    // Pasar la fecha de cierre con el ciclo activo es legítimo en un cierre anticipado (vaciado/remanente): informa, no alarma.
    const cicloVencido = !!selectedCiclo && selectedCiclo.activo && !!selectedCiclo.fecha_fin && selectedCiclo.fecha_fin < hoy;
    // Volumen 0 / vacío = "sin presupuesto cargado", no un presupuesto de cero.
    const volCiclo = selectedCiclo && Number(selectedCiclo.volumen_autorizado_mm3) > 0 ? Number(selectedCiclo.volumen_autorizado_mm3) : null;

    // Cálculos de Volumen. Sin ninguna asignación capturada el total es S/D (no "0 asignado").
    const asignaciones = modulosCiclos.filter(mc => mc.ciclo_id === selectedCiclo?.id && mc.volumen_autorizado_mm3 != null);
    const totalAutorizadoModulos = asignaciones.length
        ? asignaciones.reduce((sum, mc) => sum + Number(mc.volumen_autorizado_mm3 || 0), 0)
        : null;
    const restante = volCiclo != null ? volCiclo - (totalAutorizadoModulos ?? 0) : null;
    const pctAsignado = volCiclo != null && totalAutorizadoModulos != null ? (totalAutorizadoModulos / volCiclo) * 100 : null;
    const sobregiro = restante != null && restante < 0;

    // Módulos en orden numérico (M1, M2 … M12), no alfabético (M1, M12, M2).
    const numMod = (m: Modulo) => Number((m.codigo_corto || m.nombre).match(/\d+/)?.[0] ?? Infinity);
    const modulosOrden = [...modulos].sort((a, b) => numMod(a) - numMod(b));

    // Calendario del ciclo: avance por fechas (no por volumen).
    const DIA = 86_400_000;
    const tIni = selectedCiclo?.fecha_inicio ? Date.parse(`${selectedCiclo.fecha_inicio}T00:00:00`) : NaN;
    const tFin = selectedCiclo?.fecha_fin ? Date.parse(`${selectedCiclo.fecha_fin}T00:00:00`) : NaN;
    const tHoy = Date.parse(`${hoy}T00:00:00`);
    const calendario = Number.isFinite(tIni) && Number.isFinite(tFin) && tFin > tIni
        ? {
            total: Math.round((tFin - tIni) / DIA),
            transcurridos: Math.max(0, Math.min(Math.round((tFin - tIni) / DIA), Math.round((tHoy - tIni) / DIA))),
            restantes: Math.round((tFin - tHoy) / DIA),
            pct: Math.max(0, Math.min(100, ((tHoy - tIni) / (tFin - tIni)) * 100)),
            porIniciar: tHoy < tIni,
        }
        : null;

    const fillFormForEdit = (ciclo: CicloAgricola) => {
        setFormData(ciclo);
        setIsEditing(true);
    };

    const handleNew = () => {
        setFormData({
            nombre: '',
            clave: '',
            fecha_inicio: '',
            fecha_fin: '',
            volumen_autorizado_mm3: 0,
            activo: false
        });
        setIsEditing(true);
    };

    const submitCiclo = async (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.fecha_inicio && formData.fecha_fin && formData.fecha_fin < formData.fecha_inicio) {
            toast.error('La fecha de cierre no puede ser anterior al inicio.');
            return;
        }
        const vol = Number(formData.volumen_autorizado_mm3);
        if (!Number.isFinite(vol) || vol < 0) {
            toast.error('Captura un volumen autorizado válido (≥ 0).');
            return;
        }
        try {
            const data = await saveCiclo({ ...formData, clave: formData.clave?.trim(), volumen_autorizado_mm3: vol });
            if (data) setSelectedCicloId(data.id);
            setIsEditing(false);
        } catch {
            // saveCiclo ya avisó el error; el formulario queda abierto para no perder lo capturado.
        }
    };

    const chips: ChipEstado[] = [];
    if (selectedCiclo) {
        chips.push({ key: 'c', sev: selectedCiclo.activo ? 'ok' : 'info', texto: `${selectedCiclo.nombre} · ${selectedCiclo.activo ? 'activo' : 'histórico'}` });
        if (selectedCiclo.fecha_inicio && selectedCiclo.fecha_fin) chips.push({ key: 'f', sev: 'info', texto: `${selectedCiclo.fecha_inicio} → ${selectedCiclo.fecha_fin}` });
        if (volCiclo == null) chips.push({ key: 'p', sev: 'warn', texto: 'Sin presupuesto cargado' });
        if (sobregiro) chips.push({ key: 's', sev: 'crit', texto: 'Asignado supera lo autorizado' });
    }

    return (
        <div className="sc-root sc-pagina ci-root">
            <PaginaHero
                kicker="Plan hidrológico · DR 005 Delicias"
                titulo="Ciclos agrícolas"
                subtitulo="Distribución de los volúmenes concesionados de la Red Mayor entre las asociaciones (módulos)."
                chips={chips}
                acciones={<button type="button" className="sc-btn sc-btn-primario" onClick={handleNew}><Plus size={16} aria-hidden="true" /> Nuevo plan anual</button>}
            />

            {cicloVencido && selectedCiclo && (
                <p className="sc-aviso sc-aviso-warn" role="status">
                    {selectedCiclo.nombre} pasó su fecha de cierre ({selectedCiclo.fecha_fin}) y sigue activo (remanente / vaciado). Desactívalo al terminar.
                </p>
            )}

            {selectedCiclo && (
                <div className="sc-pulso-3">
                    <TileCifra
                        etiqueta="Volumen autorizado"
                        valor={volCiclo != null ? fmt(volCiclo, 2) : null}
                        unidad="Mm³"
                        lineas={[volCiclo == null ? 'Sin presupuesto cargado para el ciclo' : `Ciclo ${selectedCiclo.nombre}`]}
                        acento="var(--sc-sky)"
                    />
                    <TileCifra
                        etiqueta="Asignado a módulos"
                        valor={totalAutorizadoModulos != null ? fmt(totalAutorizadoModulos, 2) : null}
                        unidad="Mm³"
                        lineas={[totalAutorizadoModulos == null
                            ? 'Ningún módulo tiene volumen asignado'
                            : `${asignaciones.length} de ${modulos.length} módulos${pctAsignado != null ? ` · ${pctAsignado.toFixed(1)} % de lo autorizado` : ''}`]}
                        acento="#34d399"
                    />
                    <TileCifra
                        etiqueta={sobregiro ? 'Sobregiro' : 'Sin asignar'}
                        valor={restante != null ? fmt(Math.abs(restante), 2) : null}
                        unidad="Mm³"
                        estado={sobregiro ? { texto: 'Asignado > autorizado', tipo: 'crit' } : null}
                        lineas={[restante == null ? 'Requiere el volumen autorizado' : sobregiro ? 'Revisar las cuotas por módulo' : 'Disponible para asignar']}
                        acento={sobregiro ? 'var(--sc-crit)' : 'var(--sc-t3)'}
                    />
                </div>
            )}

            <div className="ci-grid">
                {/* Ciclos y formulario */}
                <div className="ci-lateral">
                    <section className="sc-card" aria-labelledby="ci-lista-t">
                        <span className="sc-kicker">Plan anual</span>
                        <h3 id="ci-lista-t">Ciclos registrados</h3>
                        {ciclos.length === 0 ? (
                            <p className="ci-nota">Aún no hay ciclos. Crea el plan anual con "Nuevo plan anual".</p>
                        ) : (
                            <ul className="ci-ciclos">
                                {ciclos.map(ciclo => {
                                    const sel = selectedCiclo?.id === ciclo.id;
                                    return (
                                        <li key={ciclo.id} className={`ci-ciclo ${sel ? 'ci-ciclo-sel' : ''}`}>
                                            <button type="button" className="ci-ciclo-btn" onClick={() => setSelectedCicloId(ciclo.id)} aria-pressed={sel}>
                                                <span className="ci-ciclo-top">
                                                    <b>{ciclo.nombre}</b>
                                                    <span className={`sc-chip ${ciclo.activo ? 'sc-chip-ok' : ''}`}>{ciclo.activo ? 'Activo' : 'Histórico'}</span>
                                                </span>
                                                <span className="ci-ciclo-meta">
                                                    {ciclo.fecha_inicio || 's/f'} → {ciclo.fecha_fin || 's/f'} · Autorizado <b>{Number(ciclo.volumen_autorizado_mm3) > 0 ? `${fmt(Number(ciclo.volumen_autorizado_mm3), 2)} Mm³` : 'S/D'}</b>
                                                </span>
                                            </button>
                                            <button type="button" className="sc-btn ci-editar" onClick={() => fillFormForEdit(ciclo)} aria-label={`Editar ${ciclo.nombre}`}>
                                                <Edit2 size={14} aria-hidden="true" /> Editar
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>

                    {selectedCiclo && (
                        <section className="sc-card" aria-labelledby="ci-cal-t">
                            <span className="sc-kicker">Calendario · {selectedCiclo.nombre}</span>
                            <h3 id="ci-cal-t">Avance del ciclo</h3>
                            {calendario ? (
                                <>
                                    <p className="ci-cal-cifra">
                                        <b>{calendario.porIniciar ? 0 : calendario.transcurridos}</b><small> de {calendario.total} días</small>
                                    </p>
                                    <div className="sc-barra ci-barra" role="img" aria-label={`Avance del calendario: ${calendario.pct.toFixed(0)} %`}>
                                        <i className={calendario.restantes < 0 ? 'sc-alta' : undefined} style={{ width: `${calendario.pct}%` }} />
                                    </div>
                                    <div className="ci-cal-et">
                                        <span>{selectedCiclo.fecha_inicio}</span>
                                        <span>{selectedCiclo.fecha_fin}</span>
                                    </div>
                                    <p className="ci-nota">
                                        {calendario.porIniciar ? `Inicia en ${Math.round((tIni - tHoy) / DIA)} días.`
                                            : calendario.restantes > 0 ? `Faltan ${calendario.restantes} días para el cierre.`
                                            : calendario.restantes === 0 ? 'Hoy es la fecha de cierre.'
                                            : `Cerró hace ${-calendario.restantes} días${selectedCiclo.activo ? ' y sigue activo' : ''}.`}
                                    </p>
                                </>
                            ) : <p className="ci-nota">Fechas de inicio y cierre sin capturar: S/D.</p>}
                        </section>
                    )}

                    {isEditing && (
                        <form onSubmit={submitCiclo} className="sc-card ci-form" aria-labelledby="ci-form-t">
                            <span className="sc-kicker">{formData.id ? 'Edición' : 'Alta'}</span>
                            <h3 id="ci-form-t">{formData.id ? 'Editar plan anual' : 'Nuevo plan anual'}</h3>
                            <div className="sc-campo">
                                <label htmlFor="ci-nombre">Nombre del ciclo</label>
                                <input id="ci-nombre" type="text" required placeholder="Ciclo 2026-2027" value={formData.nombre || ''} onChange={e => setFormData({ ...formData, nombre: e.target.value })} />
                            </div>
                            <div className="sc-campo">
                                <label htmlFor="ci-clave">Clave única</label>
                                <input id="ci-clave" type="text" required placeholder="2026-2027" value={formData.clave || ''} onChange={e => setFormData({ ...formData, clave: e.target.value })} />
                            </div>
                            <div className="ci-fechas">
                                <div className="sc-campo">
                                    <label htmlFor="ci-ini">Inicio</label>
                                    <input id="ci-ini" type="date" required value={formData.fecha_inicio || ''} onChange={e => setFormData({ ...formData, fecha_inicio: e.target.value })} />
                                </div>
                                <div className="sc-campo">
                                    <label htmlFor="ci-fin">Cierre</label>
                                    <input id="ci-fin" type="date" required value={formData.fecha_fin || ''} onChange={e => setFormData({ ...formData, fecha_fin: e.target.value })} />
                                </div>
                            </div>
                            <div className="sc-campo">
                                <label htmlFor="ci-vol">Volumen autorizado (Mm³)</label>
                                <input id="ci-vol" type="number" inputMode="decimal" step="0.01" required value={formData.volumen_autorizado_mm3 ?? ''} onChange={e => setFormData({ ...formData, volumen_autorizado_mm3: e.target.value === '' ? undefined : parseFloat(e.target.value) })} />
                                <small>0 = sin presupuesto cargado (se muestra como S/D).</small>
                            </div>
                            <div className="sc-campo">
                                <label htmlFor="ci-estado">Estado del ciclo</label>
                                <select id="ci-estado" className="ci-select" value={formData.activo ? 'activo' : 'inactivo'} onChange={e => setFormData({ ...formData, activo: e.target.value === 'activo' })}>
                                    <option value="activo">Activo</option>
                                    <option value="inactivo">Inactivo / histórico</option>
                                </select>
                            </div>
                            <div className="sc-acciones">
                                <button type="submit" className="sc-btn sc-btn-primario"><Save size={16} aria-hidden="true" /> Guardar ciclo</button>
                                <button type="button" className="sc-btn" onClick={() => setIsEditing(false)}>Cancelar</button>
                            </div>
                        </form>
                    )}
                </div>

                {/* Presupuesto por módulo */}
                {selectedCiclo && (
                    <section className="sc-card ci-presupuesto" aria-labelledby="ci-pres-t">
                        <span className="sc-kicker">Presupuesto por asociación civil · {selectedCiclo.nombre}</span>
                        <h3 id="ci-pres-t">Cuota hídrica por módulo</h3>

                        <div className="ci-balance" aria-hidden={volCiclo == null}>
                            <div className="ci-balance-et">
                                <span>Asignado <b>{totalAutorizadoModulos != null ? `${fmt(totalAutorizadoModulos, 2)} Mm³` : 'S/D'}</b></span>
                                <span className={sobregiro ? 'ci-crit' : undefined}>
                                    {restante == null ? 'Sin asignar: S/D' : <>{sobregiro ? 'Sobregiro' : 'Sin asignar'} <b>{fmt(Math.abs(restante), 2)} Mm³</b></>}
                                </span>
                            </div>
                            <div className="sc-barra ci-barra" role="img"
                                aria-label={pctAsignado != null ? `${pctAsignado.toFixed(1)} % del volumen autorizado asignado` : 'Sin volumen autorizado: no se puede calcular la proporción asignada'}>
                                {pctAsignado != null && <i className={sobregiro ? 'ci-barra-crit' : undefined} style={{ width: `${Math.min(100, pctAsignado)}%` }} />}
                            </div>
                        </div>

                        <div className="sc-tabla-wrap">
                            <table className="sc-tabla ci-tabla">
                                <caption className="sc-sr">Volumen asignado a cada módulo en {selectedCiclo.nombre}</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Módulo</th>
                                        <th scope="col">Asignado (Mm³)</th>
                                        <th scope="col" className="ci-col-part">Parte de lo autorizado</th>
                                        <th scope="col"><span className="sc-sr">Acción</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {modulosOrden.map(mod => {
                                        const vinculacion = modulosCiclos.find(mc => mc.modulo_id === mod.id && mc.ciclo_id === selectedCiclo.id);
                                        return (
                                            <PresupuestoRow
                                                key={mod.id}
                                                modulo={mod}
                                                cicloId={selectedCiclo.id}
                                                vinculacion={vinculacion}
                                                volCiclo={volCiclo}
                                                onSave={saveModuloCiclo}
                                            />
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <p className="ci-nota">S/D = módulo sin cuota capturada para este ciclo (no es una cuota de cero).</p>
                    </section>
                )}
            </div>
        </div>
    );
}

// Subcomponente de fila para manejar la edición aislada
interface PresupuestoRowProps {
    modulo: Modulo;
    cicloId: string;
    vinculacion?: ModuloCiclo;
    volCiclo: number | null;
    onSave: (id: string | null, cicloId: string, moduloId: string, vol: number) => Promise<boolean | undefined>;
}

function PresupuestoRow({ modulo, cicloId, vinculacion, volCiclo, onSave }: PresupuestoRowProps) {
    const [isEditing, setIsEditing] = useState(false);
    const guardado = vinculacion?.volumen_autorizado_mm3 ?? null;
    const [vol, setVol] = useState<string>(guardado != null ? String(guardado) : '');

    // Re-sincroniza con lo persistido (tras refetch o cambio de ciclo) mientras no se edita:
    // ajuste de estado durante el render, sin efecto (patrón recomendado por React).
    const clave = `${cicloId}|${guardado ?? ''}`;
    const [claveVista, setClaveVista] = useState(clave);
    if (clave !== claveVista) {
        setClaveVista(clave);
        if (!isEditing) setVol(guardado != null ? String(guardado) : '');
    }

    const handleSaveRow = async () => {
        const n = Number(vol);
        if (vol.trim() === '' || !Number.isFinite(n) || n < 0) {
            toast.error('Captura un volumen válido (≥ 0).');
            return;
        }
        const ok = await onSave(vinculacion?.id || null, cicloId, modulo.id, n);
        if (ok) setIsEditing(false);
    };

    const pct = guardado != null && volCiclo != null ? (Number(guardado) / volCiclo) * 100 : null;

    return (
        <tr>
            <th scope="row">
                <span className="ci-mod">{modulo.nombre}</span>
                <span className="ci-mod-cod">{modulo.codigo_corto}</span>
            </th>
            <td>
                {isEditing ? (
                    <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        autoFocus
                        value={vol}
                        onChange={e => setVol(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void handleSaveRow(); if (e.key === 'Escape') setIsEditing(false); }}
                        aria-label={`Volumen asignado a ${modulo.nombre} (Mm³)`}
                        className="ci-input"
                    />
                ) : (
                    <span className={guardado != null ? 'ci-val' : 'ci-val sc-sd'}>{guardado != null ? fmt(Number(guardado), 2) : 'S/D'}</span>
                )}
            </td>
            <td className="ci-col-part">
                {pct != null ? (
                    <span className="ci-part">
                        <span className="sc-barra"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
                        <small>{pct.toFixed(1)} %</small>
                    </span>
                ) : <span className="sc-sd">S/D</span>}
            </td>
            <td className="ci-col-acc">
                {isEditing ? (
                    <span className="ci-acc">
                        <button type="button" className="sc-btn sc-btn-primario" onClick={handleSaveRow}><Save size={14} aria-hidden="true" /> Guardar</button>
                        <button type="button" className="sc-btn" onClick={() => setIsEditing(false)} aria-label="Cancelar"><X size={14} aria-hidden="true" /></button>
                    </span>
                ) : (
                    /* Siempre visible: antes aparecía solo con el cursor encima y en iPad no se veía. */
                    <button type="button" className="sc-btn" onClick={() => setIsEditing(true)} aria-label={`Modificar volumen de ${modulo.nombre}`}>
                        <Edit2 size={14} aria-hidden="true" /> Modificar
                    </button>
                )}
            </td>
        </tr>
    );
}
