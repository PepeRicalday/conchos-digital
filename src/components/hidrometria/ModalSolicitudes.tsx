import { useState } from 'react';
import { Save, X, Loader } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { caudalAMm3, parseCaudalCampo } from '../../utils/hidrometria';
import { fmt } from '../../utils/formato';

export interface ModuloCaptura { id: string; nombre: string; detalle: string }

interface Props {
    modulos: ModuloCaptura[];
    inicio: string;
    fin: string;
    /** Valores iniciales en m³/s (texto) por módulo; ausente = sin solicitud capturada. */
    iniciales: Record<string, string>;
    guardando: boolean;
    error: string | null;
    onGuardar: (valores: Record<string, string>) => void;
    onCerrar: () => void;
}

const dmy = (s: string) => s.split('-').reverse().join('/');

/** Captura semanal de solicitudes. Campo vacío = no se escribe nada (antes se guardaba 0 Mm³ por módulo). */
export function ModalSolicitudes({ modulos, inicio, fin, iniciales, guardando, error, onGuardar, onCerrar }: Props) {
    const [valores, setValores] = useState<Record<string, string>>(iniciales);
    const ref = useModalA11y<HTMLDivElement>(true, onCerrar);
    const capturados = modulos.filter((m) => parseCaudalCampo(valores[m.id] ?? '') != null).length;

    return (
        <div className="sc-modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div ref={ref} className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="hid-modal-t" tabIndex={-1}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <span className="sc-kicker">Semana {dmy(inicio)} → {dmy(fin)}</span>
                        <h2 id="hid-modal-t">Programación semanal de riego</h2>
                        <p className="sc-hero-sub">Captura el caudal medio solicitado por módulo. Los campos vacíos no se guardan.</p>
                    </div>
                    <button type="button" className="sc-btn" onClick={onCerrar} aria-label="Cerrar sin guardar"><X size={18} aria-hidden="true" /></button>
                </div>

                <div className="sc-campos-grid">
                    {modulos.map((m) => {
                        const q = parseCaudalCampo(valores[m.id] ?? '');
                        const id = `hid-q-${m.id}`;
                        return (
                            <div key={m.id} className="sc-campo">
                                <label htmlFor={id}>{m.nombre} · m³/s</label>
                                <input id={id} type="text" inputMode="decimal" autoComplete="off" placeholder="Sin solicitud"
                                    value={valores[m.id] ?? ''} onChange={(e) => setValores((p) => ({ ...p, [m.id]: e.target.value }))}
                                    aria-describedby={`${id}-v`} aria-invalid={(valores[m.id] ?? '').trim() !== '' && q == null} />
                                <small id={`${id}-v`}>
                                    {(valores[m.id] ?? '').trim() !== '' && q == null ? 'Valor no válido' : q != null ? `≈ ${fmt(caudalAMm3(q), 3)} Mm³ en la semana` : m.detalle}
                                </small>
                            </div>
                        );
                    })}
                </div>

                {error && <p className="sc-aviso sc-aviso-crit" role="alert">No se pudo guardar: {error}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                    <span className="sc-fresco">{capturados} de {modulos.length} módulos con solicitud</span>
                    <div className="sc-acciones">
                        <button type="button" className="sc-btn" onClick={onCerrar}>Cancelar</button>
                        <button type="button" className="sc-btn sc-btn-primario" disabled={guardando || capturados === 0} onClick={() => onGuardar(valores)}>
                            {guardando ? <Loader size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Guardar programación
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
