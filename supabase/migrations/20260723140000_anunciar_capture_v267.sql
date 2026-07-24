-- Migración: anunciar sica-capture v2.6.7 a la flota de tabletas
-- Fecha: 2026-07-23
--
-- QUÉ HACE
-- Publica en app_versions la versión que YA está desplegada en producción.
-- VersionGuard (v4.0) consulta esta tabla cada 10 min y al volver la app a
-- primer plano; al ver una versión mayor que la compilada, purga caché y
-- recarga. Esta fila es el interruptor del refresco forzado en toda la red.
--
-- POR QUÉ HACE FALTA ESTE ANUNCIO
-- El bundle 2.6.7 (formularios de Presas: desglose de obras de toma TB/CFE/
-- Izq/Der, nivel de embalse, posición de compuerta) se desplegó a Vercel el
-- 2026-07-23 pero `app_versions` seguía en 2.6.6 — VersionGuard nunca detectó
-- la diferencia, así que las tabletas de campo siguieron sirviendo el bundle
-- viejo desde su Service Worker. Un movimiento de Boquilla capturado ese
-- mismo día salió con gasto_m3s total (17) y TODOS los campos de desglose en
-- null, confirmando que el formulario viejo (un solo campo) seguía activo en
-- campo. Sin este anuncio, ninguna captura futura tendrá el desglose aunque
-- el código ya lo soporte de punta a punta.
--
-- ORDEN DE EJECUCIÓN (no invertir)
--   1. Bundle 2.6.7 publicado en Vercel        [HECHO 2026-07-23]
--   2. Esta migración
-- Ejecutarla antes del paso 1 haría que cada tableta purgue su caché y recargue
-- contra un bundle que no existe: el anclaje que estas capas buscan evitar.
--
-- CÓMO EJECUTAR
-- Pegar en el editor SQL de Supabase. NO usar `supabase db push` (drift).
--
-- REVERSIÓN
-- Si tras el anuncio las tabletas fallan, restaurar el estado previo:
--   UPDATE public.app_versions
--   SET version = '2.6.6',
--       min_supported_version = '2.5.9',
--       build_hash = 'v2.6.6',
--       release_notes = 'Refresco automático de versión desde la nube y correcciones de caché PWA: las tabletas dejan de quedarse ancladas en versiones viejas. La actualización espera si hay una captura sin guardar.',
--       actualizado_en = now()
--   WHERE app_id = 'capture';
-- Ojo: revertir la fila NO deshace las recargas ya ocurridas. Si el bundle
-- 2.6.7 estuviera roto, hay que redesplegar el anterior en Vercel además de
-- revertir aquí.
--
-- control-digital (conchos-digital) NO se toca: ya está desplegado por su
-- propio flujo manual (npx vercel --prod), sin gate de versión anunciada.

BEGIN;

UPDATE public.app_versions
SET
  version = '2.6.7',
  build_hash = 'v2.6.7',
  release_notes = 'Presas: captura desglosada de obras de toma (Toma Baja/CFE/Toma Izq./Toma Der.), nivel de embalse (elevación + % de llenado) y posición de compuerta como referencia.',
  actualizado_en = now()
WHERE app_id = 'capture';

-- Guardas de integridad: si algo no cuadra, la transacción se revierte entera
-- y la tabla queda intacta. Sin esto, un app_id mal escrito pasaría como éxito
-- silencioso (PostgREST devuelve 200 afectando cero filas).
DO $$
DECLARE
  v_version   text;
  v_minimo    text;
  v_afectadas int;
BEGIN
  SELECT count(*) INTO v_afectadas
  FROM public.app_versions WHERE app_id = 'capture';

  IF v_afectadas <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente 1 fila para app_id=capture, hay %', v_afectadas;
  END IF;

  SELECT version, min_supported_version INTO v_version, v_minimo
  FROM public.app_versions WHERE app_id = 'capture';

  IF v_version <> '2.6.7' THEN
    RAISE EXCEPTION 'La versión quedó en % y se esperaba 2.6.7', v_version;
  END IF;

  -- El mínimo por encima de la versión publicada dejaría a las tabletas
  -- bloqueadas sin poder capturar. No se sube en este anuncio.
  IF v_minimo <> '2.5.9' THEN
    RAISE EXCEPTION 'min_supported_version quedó en %, se esperaba 2.5.9 (no debe subirse en este anuncio)', v_minimo;
  END IF;

  RAISE NOTICE 'OK: capture anunciada en v2.6.7 (mínimo soportado sigue en %)', v_minimo;
END $$;

COMMIT;

-- Verificación posterior (correr aparte para confirmar el estado final):
--   SELECT app_id, version, min_supported_version, build_hash, actualizado_en
--   FROM public.app_versions ORDER BY app_id;
