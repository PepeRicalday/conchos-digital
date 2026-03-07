import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface HydricDocument {
    id: string;
    titulo: string;
    tipo_documento: string;
    url_storage: string;
    metadata: any;
    created_at: string;
    created_by: string;
}

export function useHydricKnowledge() {
    const [documents, setDocuments] = useState<HydricDocument[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchDocuments = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error: fetchError } = await supabase
                .from('hydric_documents')
                .select('*')
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;
            setDocuments(data || []);
        } catch (err: any) {
            console.error('Error fetching hydric documents:', err);
            // Hide error if table doesn't exist yet
            if (!err.message?.includes('does not exist')) {
                setError(err.message);
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    const uploadDocument = async (file: File, tipo: string = 'manual') => {
        setIsUploading(true);
        setError(null);
        try {
            // 1. Upload to Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${crypto.randomUUID()}.${fileExt}`;
            const filePath = `knowledge/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('hydric-knowledge')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Register in Database
            const { error: dbError } = await supabase
                .from('hydric_documents')
                .insert({
                    titulo: file.name,
                    tipo_documento: tipo,
                    url_storage: filePath,
                    metadata: { size: file.size, type: file.type }
                });

            if (dbError) throw dbError;

            // 3. Trigger processing
            const { data: docData } = await supabase
                .from('hydric_documents')
                .select('id')
                .eq('url_storage', filePath)
                .single();

            if (docData) {
                await supabase.functions.invoke('process-hydric-doc', {
                    body: { document_id: docData.id }
                });
            }

            await fetchDocuments();
        } catch (err: any) {
            console.error('Error uploading document:', err);
            setError(err.message);
            throw err;
        } finally {
            setIsUploading(false);
        }
    };

    const deleteDocument = async (id: string, storagePath: string) => {
        try {
            // Delete from storage
            await supabase.storage.from('hydric-knowledge').remove([storagePath]);
            // Delete from DB
            const { error: deleteError } = await supabase
                .from('hydric_documents')
                .delete()
                .eq('id', id);

            if (deleteError) throw deleteError;
            setDocuments(prev => prev.filter(d => d.id !== id));
        } catch (err: any) {
            console.error('Error deleting document:', err);
            setError(err.message);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    return {
        documents,
        isLoading,
        isUploading,
        error,
        uploadDocument,
        deleteDocument,
        refreshDocuments: fetchDocuments,
        clearError: () => setError(null)
    };
}
