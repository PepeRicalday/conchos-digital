import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { AlertTriangle, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ChatConversation } from '../../hooks/useHydricChat';
import { agrupaConversaciones } from '../../utils/consultoria';
import { formatDate, getTodayString, toDateString } from '../../utils/dateHelpers';

interface Props {
    conversaciones: ChatConversation[];
    activaId: string | null;
    cargando: boolean;
    historialNoDisponible: boolean;
    abierto: boolean;            // solo aplica en el cajón (teléfono / tablet vertical)
    onCerrar: () => void;
    onSeleccionar: (id: string) => void;
    onNueva: () => void;
    onRenombrar: (id: string, titulo: string) => void;
    onEliminar: (id: string) => void;
}

/** Historial de consultas: agrupado por fecha, con búsqueda; renombrar y eliminar (con confirmación) siempre visibles. */
export function Historial({ conversaciones, activaId, cargando, historialNoDisponible, abierto, onCerrar, onSeleccionar, onNueva, onRenombrar, onEliminar }: Props) {
    const [filtro, setFiltro] = useState('');
    const [confirmando, setConfirmando] = useState<string | null>(null);
    const [editando, setEditando] = useState<string | null>(null);
    const [borrador, setBorrador] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const hoy = getTodayString();

    useEffect(() => { if (editando) inputRef.current?.select(); }, [editando]);
    // En el cajón (teléfono / tablet vertical): foco adentro, atrapado, Escape cierra y el foco regresa al botón "Historial".
    const asideRef = useModalA11y<HTMLElement>(abierto, onCerrar);

    const grupos = useMemo(
        () => agrupaConversaciones(conversaciones.map((c) => ({ ...c, titulo: c.titulo || 'Sin título' })), hoy, (iso) => toDateString(new Date(iso)), filtro),
        [conversaciones, hoy, filtro],
    );

    const guardarNombre = (id: string) => {
        const t = borrador.trim();
        if (t) onRenombrar(id, t);
        setEditando(null);
    };

    return (
        <>
            <div className={`ci-fondo ${abierto ? 'ci-fondo-visible' : ''}`} onClick={onCerrar} aria-hidden="true" />
            <aside ref={asideRef} className={`ci-historial ${abierto ? 'ci-historial-abierto' : ''}`} aria-label="Historial de consultas" role={abierto ? 'dialog' : undefined} aria-modal={abierto ? true : undefined}>
                <div className="ci-hist-cab">
                    <h3>Historial</h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="ci-icono-btn" onClick={() => { onNueva(); onCerrar(); }} aria-label="Nueva consulta"><Plus size={18} aria-hidden="true" /></button>
                        <button type="button" className="ci-icono-btn ci-btn-historial" onClick={onCerrar} aria-label="Cerrar historial"><X size={18} aria-hidden="true" /></button>
                    </div>
                </div>

                <div className="ci-buscar">
                    <label className="sc-sr" htmlFor="ci-buscar">Buscar en el historial</label>
                    <input id="ci-buscar" type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar consultas…" autoComplete="off" />
                </div>

                <div className="ci-hist-lista">
                    {historialNoDisponible && (
                        <p className="sc-aviso sc-aviso-warn" role="status"><AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0 }} /> Historial no disponible. Renueva tu sesión.</p>
                    )}
                    {!historialNoDisponible && cargando && conversaciones.length === 0 && <p className="ci-vacio" role="status">Cargando historial…</p>}
                    {!historialNoDisponible && !cargando && conversaciones.length === 0 && (
                        <div className="ci-vacio"><MessageSquare size={28} aria-hidden="true" /><p style={{ margin: 0 }}>Tus consultas aparecerán aquí</p></div>
                    )}
                    {conversaciones.length > 0 && grupos.length === 0 && <p className="ci-vacio">Ninguna consulta coincide con “{filtro}”.</p>}

                    {grupos.map((g) => (
                        <section key={g.grupo} aria-label={g.grupo}>
                            <h4 className="ci-grupo">{g.grupo}</h4>
                            {g.items.map((c) => {
                                const activa = c.id === activaId;
                                if (editando === c.id) {
                                    return (
                                        <div key={c.id} className="ci-conv ci-conv-activa">
                                            <div className="ci-conv-editar">
                                                <label className="sc-sr" htmlFor={`ci-ren-${c.id}`}>Nuevo título</label>
                                                <input ref={inputRef} id={`ci-ren-${c.id}`} value={borrador} maxLength={120} onChange={(e) => setBorrador(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) guardarNombre(c.id); if (e.key === 'Escape') { e.stopPropagation(); setEditando(null); } }}
                                                    onBlur={() => guardarNombre(c.id)} />
                                            </div>
                                        </div>
                                    );
                                }
                                if (confirmando === c.id) {
                                    return (
                                        <div key={c.id} className="ci-conv ci-conv-confirma" role="alertdialog" aria-label={`Eliminar “${c.titulo}”`}>
                                            <span>¿Eliminar “{c.titulo}”?</span>
                                            <button type="button" className="sc-btn" onClick={() => { onEliminar(c.id); setConfirmando(null); }}>Eliminar</button>
                                            <button type="button" className="sc-btn" autoFocus onClick={() => setConfirmando(null)}>Cancelar</button>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={c.id} className={`ci-conv ${activa ? 'ci-conv-activa' : ''}`}>
                                        <button type="button" className="ci-conv-abrir" aria-current={activa ? 'true' : undefined} onClick={() => { onSeleccionar(c.id); onCerrar(); }}>
                                            <span className="ci-conv-titulo">{c.titulo}</span>
                                            <span className="ci-conv-fecha">{formatDate(c.updated_at)}</span>
                                        </button>
                                        <div className="ci-conv-acciones">
                                            <button type="button" className="ci-conv-btn" aria-label={`Renombrar “${c.titulo}”`} onClick={() => { setBorrador(c.titulo); setEditando(c.id); }}><Pencil size={15} aria-hidden="true" /></button>
                                            <button type="button" className="ci-conv-btn" aria-label={`Eliminar “${c.titulo}”`} onClick={() => setConfirmando(c.id)}><Trash2 size={15} aria-hidden="true" /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                    ))}
                </div>
            </aside>
        </>
    );
}

