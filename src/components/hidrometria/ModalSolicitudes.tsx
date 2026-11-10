import { useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, Boton } from '../ui/base';
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
    const capturados = modulos.filter((m) => parseCaudalCampo(valores[m.id] ?? '') != null).length;

    return (
        <Modal
            abierto onCerrar={onCerrar} tamano="lg" kicker={`Semana ${dmy(inicio)} → ${dmy(fin)}`} titulo="Programación semanal de riego"
            pie={<>
                <span className="sc-fresco" style={{ marginRight: 'auto' }}>{capturados} de {modulos.length} módulos con solicitud</span>
                <Boton onClick={onCerrar}>Cancelar</Boton>
                <Boton variante="primario" cargando={guardando} disabled={capturados === 0} onClick={() => onGuardar(valores)} icono={<Save size={16} aria-hidden="true" />}>
                    Guardar programación
                </Boton>
            </>}
        >
            <p className="sc-hero-sub">Captura el caudal medio solicitado por módulo. Los campos vacíos no se guardan.</p>

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
        </Modal>
    );
}
