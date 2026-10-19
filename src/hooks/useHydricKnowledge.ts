import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// El bucket `hydric-knowledge` admite solo PDF hasta 30 MB (migración 20261018120000) y process-hydric-doc solo sabe
// extraer texto de PDF: aceptar otros formatos los dejaba en estado "error" mientras la interfaz decía "Ready for RAG".
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const REFRESCO_MS = 5000;

export type EstadoDocumento = 'pendiente' | 'procesando' | 'completado' | 'error';

export interface HydricDocument {
    id: string;
    titulo: string;
    tipo_documento: string;
    url_storage: string;
    metadata: { size?: number; type?: string } | null;
    created_at: string;
    created_by: string;
    estado_procesamiento: EstadoDocumento | string | null;
    chunks_generados: number | null;
}

/** El PDF se reconoce por su contenido (%PDF-), no solo por la extensión o el tipo que declare el navegador. */
async function esPdfReal(file: File): Promise<boolean> {
    try { return (await file.slice(0, 5).text()) === '%PDF-'; } catch { return false; }
}

export function useHydricKnowledge() {
    const [documents, setDocuments] = useState<HydricDocument[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** La biblioteca ya se consultó con éxito: antes de eso (o si falló) el conteo es S/D, no 0. */
    const [cargado, setCargado] = useState(false);

    const fetchDocuments = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('hydric_documents')
                .select('*')
                .order('created_at', { ascending: false });
            if (fetchError) throw fetchError;
            setDocuments((data as HydricDocument[]) || []);
            setCargado(true);
        } catch (err) {
            const msg = (err as Error)?.message ?? '';
            if (silent || msg.includes('does not exist')) return;
            if (/algorithm|JWT|token.*invalid|invalid.*token|unauthorized/i.test(msg)) return;
            console.error('Error fetching hydric documents:', err);
            setError(msg);
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    const uploadDocument = async (file: File, tipo: string = 'manual') => {
        const falla = (msg: string): never => { setError(msg); throw new Error(msg); };

        if (!/\.pdf$/i.test(file.name) || !(await esPdfReal(file))) {
            falla(`"${file.name}" no es un PDF válido. Por ahora la Base de Conocimiento solo indexa PDF con texto.`);
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            falla(`"${file.name}" pesa ${(file.size / (1024 * 1024)).toFixed(1)} MB — el límite es ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Divide el documento o sube una versión comprimida.`);
        }

        setIsUploading(true);
        setError(null);
        try {
            const filePath = `knowledge/${crypto.randomUUID()}.pdf`;
            const { error: uploadError } = await supabase.storage
                .from('hydric-knowledge')
                .upload(filePath, file, { contentType: 'application/pdf' });
            if (uploadError) throw uploadError;

            const { data: doc, error: dbError } = await supabase
                .from('hydric_documents')
                .insert({ titulo: file.name, tipo_documento: tipo, url_storage: filePath, metadata: { size: file.size, type: file.type } })
                .select('id')
                .single();
            if (dbError || !doc) {
                // El registro no se creó: se retira el archivo para no dejar un huérfano en Storage.
                await supabase.storage.from('hydric-knowledge').remove([filePath]);
                throw dbError ?? new Error('No se pudo registrar el documento.');
            }

            // Arranca el procesamiento; si falla no pasa nada grave: el documento queda "pendiente" y el cron
            // (cada minuto) lo toma. El estado real se refleja en la lista.
            const { error: invokeError } = await supabase.functions.invoke('process-hydric-doc', { body: { document_id: doc.id } });
            if (invokeError) console.warn('process-hydric-doc: se procesará por el cron.', invokeError.message);

            await fetchDocuments(true);
        } catch (err) {
            console.error('Error uploading document:', err);
            setError((err as Error).message);
            throw err;
        } finally {
            setIsUploading(false);
        }
    };

    /** Elimina el registro (y sus fragmentos por cascada) y luego el archivo. Devuelve true si se eliminó. */
    const deleteDocument = async (id: string, storagePath: string): Promise<boolean> => {
        try {
            const { data, error: deleteError } = await supabase.from('hydric_documents').delete().eq('id', id).select('id');
            if (deleteError) throw deleteError;
            // Sin política DELETE el borrado afecta 0 filas SIN error: no se puede dar por eliminado.
            if (!data?.length) throw new Error('No se pudo eliminar el documento (sin permiso o ya no existe).');
            setDocuments(prev => prev.filter(d => d.id !== id));
            const { error: storageError } = await supabase.storage.from('hydric-knowledge').remove([storagePath]);
            if (storageError) console.warn('Documento eliminado, pero el archivo no se pudo retirar de Storage:', storageError.message);
            return true;
        } catch (err) {
            console.error('Error deleting document:', err);
            setError((err as Error).message);
            return false;
        }
    };

    /** Reintenta un documento que quedó en error (acción de la S.R.L.: el servidor la valida con el JWT de usuario). */
    const reprocesarDocumento = async (id: string): Promise<boolean> => {
        setError(null);
        const { error: invokeError } = await supabase.functions.invoke('process-hydric-doc', { body: { document_id: id } });
        await fetchDocuments(true);
        if (invokeError) { setError('No se pudo reintentar el documento. Revisa que sea un PDF con texto.'); return false; }
        return true;
    };

    useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

    // Mientras haya documentos indexándose, se refresca solo (antes decía "Ready for RAG" desde el primer segundo).
    const hayEnProceso = documents.some(d => d.estado_procesamiento === 'pendiente' || d.estado_procesamiento === 'procesando');
    useEffect(() => {
        if (!hayEnProceso) return;
        const id = window.setInterval(() => { if (document.visibilityState === 'visible') void fetchDocuments(true); }, REFRESCO_MS);
        return () => window.clearInterval(id);
    }, [hayEnProceso, fetchDocuments]);

    return {
        documents,
        cargado,
        isLoading,
        isUploading,
        error,
        uploadDocument,
        deleteDocument,
        reprocesarDocumento,
        refreshDocuments: fetchDocuments,
        clearError: () => setError(null),
    };
}
