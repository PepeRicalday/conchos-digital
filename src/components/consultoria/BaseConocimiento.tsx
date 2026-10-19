import { useState } from 'react';
import { AlertTriangle, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { HydricDocument } from '../../hooks/useHydricKnowledge';

interface Props {
    documentos: HydricDocument[];
    /** La lista ya se consultó con éxito; si no, el conteo es S/D (no "Sin documentos"). */
    cargado: boolean;
    subiendo: boolean;
    error: string | null;
    onCerrarError: () => void;
    onSubir: (file: File) => Promise<void>;
    onEliminar: (id: string, ruta: string) => Promise<boolean>;
    onReintentar: (id: string) => Promise<boolean>;
}

const ESTADO: Record<string, { texto: (d: HydricDocument) => string; clase: string }> = {
    completado: { texto: (d) => `Indexado${d.chunks_generados ? ` · ${d.chunks_generados.toLocaleString('es-MX')} fragmentos` : ''}`, clase: 'sc-estado-ok' },
    procesando: { texto: () => 'Indexando…', clase: 'sc-estado-info' },
    pendiente: { texto: () => 'En cola', clase: 'sc-estado-info' },
    error: { texto: () => 'Error al indexar', clase: 'sc-estado-crit' },
};

const tamano = (d: HydricDocument) => {
    const b = d.metadata?.size;
    return typeof b === 'number' && Number.isFinite(b) && b > 0 ? (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : 'S/D';
};

/** Biblioteca del RAG: el estado de cada documento sale de la BD (antes decía "Ready for RAG" siempre). Solo PDF con texto. */
export function BaseConocimiento({ documentos, cargado, subiendo, error, onCerrarError, onSubir, onEliminar, onReintentar }: Props) {
    const [arrastrando, setArrastrando] = useState(false);
    const [confirmando, setConfirmando] = useState<string | null>(null);

    const soltar = (e: React.DragEvent) => {
        e.preventDefault();
        setArrastrando(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !subiendo) onSubir(f).catch(() => { /* el hook deja el mensaje en `error` */ });
    };

    const indexados = documentos.filter((d) => d.estado_procesamiento === 'completado').length;

    return (
        <div className="ci-biblioteca">
            {error && (
                <div className="sc-aviso sc-aviso-crit" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} /><span style={{ flex: 1 }}>{error}</span>
                    <button type="button" className="sc-btn" onClick={onCerrarError}>Cerrar</button>
                </div>
            )}

            <label className={`ci-dropzone ${arrastrando ? 'ci-dropzone-activa' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={soltar}>
                <input type="file" className="sc-sr" accept="application/pdf,.pdf" disabled={subiendo}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onSubir(f).catch(() => { /* error en el banner */ }); e.target.value = ''; }} />
                {subiendo ? <Loader2 size={26} className="spin" aria-hidden="true" /> : <Upload size={26} aria-hidden="true" />}
                <h4>{subiendo ? 'Subiendo documento…' : 'Sube un manual o norma en PDF'}</h4>
                <p>Arrastra el archivo aquí o toca para elegirlo · solo PDF con texto (no escaneados) · hasta 30 MB</p>
            </label>

            <p className="sc-kicker" role="status">{!cargado ? 'Documentos: S/D' : documentos.length === 0 ? 'Sin documentos' : `${indexados} de ${documentos.length} documentos indexados`}</p>

            {!cargado ? (
                <div className="ci-vacio"><p style={{ margin: 0 }} role="status">{error ? 'No se pudo consultar la biblioteca.' : 'Consultando la biblioteca…'}</p></div>
            ) : documentos.length === 0 ? (
                <div className="ci-vacio"><FileText size={40} aria-hidden="true" /><p style={{ margin: 0 }}>Agrega manuales, normas técnicas o reglas de operación para que el asistente pueda citarlos.</p></div>
            ) : (
                <ul className="ci-docs">
                    {documentos.map((d) => {
                        const est = ESTADO[d.estado_procesamiento ?? ''] ?? { texto: () => 'Estado S/D', clase: 'sc-estado-sd' };
                        return (
                            <li key={d.id} className="ci-doc">
                                <div className="ci-doc-titulo"><FileText size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} /><span>{d.titulo}</span></div>
                                <div className="ci-doc-meta">
                                    <span className={`sc-estado ${est.clase}`}>{est.texto(d)}</span>
                                    <span>{tamano(d)}</span>
                                </div>
                                <div className="ci-doc-acciones">
                                    {d.estado_procesamiento === 'error' && (
                                        <button type="button" className="sc-btn" onClick={() => { void onReintentar(d.id); }}><RefreshCw size={14} aria-hidden="true" /> Reintentar</button>
                                    )}
                                    {confirmando === d.id ? (
                                        <span role="alertdialog" aria-label={`Eliminar ${d.titulo}`} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13 }}>¿Eliminar este documento?</span>
                                            <button type="button" className="sc-btn" onClick={() => { void onEliminar(d.id, d.url_storage); setConfirmando(null); }}>Eliminar</button>
                                            <button type="button" className="sc-btn" autoFocus onClick={() => setConfirmando(null)}>Cancelar</button>
                                        </span>
                                    ) : (
                                        <button type="button" className="sc-btn" onClick={() => setConfirmando(d.id)} aria-label={`Eliminar ${d.titulo}`}><Trash2 size={14} aria-hidden="true" /> Eliminar</button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
