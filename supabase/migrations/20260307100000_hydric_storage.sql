-- Create storage bucket for knowledge base documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('hydric-knowledge', 'hydric-knowledge', false)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS for the bucket
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow users to upload into hydric-knowledge
CREATE POLICY "Usuarios pueden subir documentos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'hydric-knowledge');

-- Allow users to read from hydric-knowledge
CREATE POLICY "Usuarios pueden leer documentos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'hydric-knowledge');

-- Allow users to delete their own documents or SRL admin
CREATE POLICY "Usuarios pueden eliminar documentos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'hydric-knowledge' AND (auth.uid() = owner OR EXISTS (SELECT 1 FROM public.perfiles_usuario WHERE id = auth.uid() AND rol = 'SRL')));
