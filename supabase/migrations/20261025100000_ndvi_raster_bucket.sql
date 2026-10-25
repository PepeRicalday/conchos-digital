-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket privado 'ndvi-raster' — caché de imágenes NDVI por módulo y mes cerrado
-- Fecha: 2026-10-25
--
-- Lo usa la edge function sentinel-ndvi-modulo-raster (clave '{AAAA-MM}/M{n}.json',
-- JSON con el PNG en base64 + metadatos). SOLO el service role lee y escribe: el
-- service role omite RLS, así que NO se crea ninguna política para anon ni
-- authenticated (con RLS activa en storage.objects, sin política = sin acceso).
-- Las políticas de otros buckets no aplican aquí porque todas filtran por bucket_id.
-- Tope de 5 MB por objeto (un PNG de 900 px con 5 colores pesa < 1 MB).
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ndvi-raster', 'ndvi-raster', false, 5242880, ARRAY['application/json'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Política explícita y restrictiva: nadie salvo service_role (que de todos modos omite RLS).
-- Se declara para que la intención quede en el esquema y para que una política amplia futura
-- de otro bucket no se confunda con ésta.
DROP POLICY IF EXISTS "Solo service role ndvi-raster" ON storage.objects;
CREATE POLICY "Solo service role ndvi-raster" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'ndvi-raster')
  WITH CHECK (bucket_id = 'ndvi-raster');
