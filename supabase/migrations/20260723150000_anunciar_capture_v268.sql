-- Migración: anunciar sica-capture v2.6.8 a la flota de tabletas
-- Fecha: 2026-07-23
--
-- QUÉ HACE
-- Publica en app_versions la versión que YA está desplegada en producción.
-- VersionGuard (v4.0) consulta esta tabla cada 10 min y al volver la app a
-- primer plano; al ver una versión mayor que la compilada, purga caché y
-- recarga. Esta fila es el interruptor del refresco forzado en toda la red.
--
-- POR QUÉ HACE FALTA ESTE ANUNCIO
-- 2.6.8 prellena el formulario de Obras de Toma (Toma Baja/CFE/Izq./Der.) con
-- el último gasto reportado por obra: una obra sigue en el mismo gasto hasta
-- que se registre un cierre/modificación explícito, así que el operador ya no
-- tiene que re-teclear un valor que no cambió. Sin este anuncio, las tabletas
-- que ya recibieron 2.6.7 seguirían viendo el formulario abrir en 0.00.
--
-- ORDEN DE EJECUCIÓN (no invertir)
--   1. Bundle 2.6.8 publicado en Vercel        [HECHO 2026-07-23]
--   2. Esta migración
--
-- CÓMO EJECUTAR
-- Pegar en el editor SQL de Supabase. NO usar `supabase db push` (drift).
--
-- REVERSIÓN
-- Si tras el anuncio las tabletas fallan, restaurar el estado previo:
--   UPDATE public.app_versions
--   SET version = '2.6.7',
--       min_supported_version = '2.5.9',
--       build_hash = 'v2.6.7',
--       release_notes = 'Presas: captura desglosada de obras de toma (Toma Baja/CFE/Toma Izq./Toma Der.), nivel de embalse (elevación + % de llenado) y posición de compuerta como referencia.',
--       actualizado_en = now()
--   WHERE app_id = 'capture';
-- Ojo: revertir la fila NO deshace las recargas ya ocurridas. Si el bundle
-- 2.6.8 estuviera roto, hay que redesplegar el anterior en Vercel además de
-- revertir aquí.
--
-- control-digital (conchos-digital) NO se toca: ya está desplegado por su
-- propio flujo manual (npx vercel --prod), sin gate de versión anunciada.

BEGIN;

UPDATE public.app_versions
SET
  version = '2.6.8',
  build_hash = 'v2.6.8',
  release_notes = 'Presas: el formulario de Obras de Toma se prellena con el último gasto reportado por obra (Toma Baja/CFE/Izq./Der.) — ya no hay que re-teclear un valor que no cambió.',
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

  IF v_version <> '2.6.8' THEN
    RAISE EXCEPTION 'La versión quedó en % y se esperaba 2.6.8', v_version;
  END IF;

  IF v_minimo <> '2.5.9' THEN
    RAISE EXCEPTION 'min_supported_version quedó en %, se esperaba 2.5.9 (no debe subirse en este anuncio)', v_minimo;
  END IF;

  RAISE NOTICE 'OK: capture anunciada en v2.6.8 (mínimo soportado sigue en %)', v_minimo;
END $$;

COMMIT;

-- Verificación posterior (correr aparte para confirmar el estado final):
--   SELECT app_id, version, min_supported_version, build_hash, actualizado_en
--   FROM public.app_versions ORDER BY app_id;
