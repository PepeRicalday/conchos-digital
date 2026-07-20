-- Migración: anunciar sica-capture v2.6.6 a la flota de tabletas
-- Fecha: 2026-07-19
--
-- QUÉ HACE
-- Publica en app_versions la versión que YA está desplegada en producción.
-- VersionGuard (v4.0) consulta esta tabla cada 10 min y al volver la app a
-- primer plano; al ver una versión mayor que la compilada, purga caché y
-- recarga. Esta fila es el interruptor del refresco forzado en toda la red.
--
-- POR QUÉ 2.6.6 Y NO 2.6.4
-- El bundle desplegado y verificado en tableta es 2.6.6 (commit 088acc7 subió
-- la versión deliberadamente). package.json decía 2.6.4 por estar atrasado
-- respecto a vite.config.ts, que es de donde salía la versión real compilada.
-- Anunciar 2.6.4 dejaría a las tabletas POR ENCIMA de la nube y el refresco
-- nunca dispararía.
--
-- POR QUÉ min_supported_version SE QUEDA EN 2.5.9
-- VersionGuard bloquea la app por completo cuando la versión local es menor
-- que el mínimo. Subir el mínimo a 2.6.6 haría que cualquier tableta que no
-- logre actualizarse (sin señal en campo, caché anclada) quede con la pantalla
-- de bloqueo y SIN PODER CAPTURAR. El refresco automático solo necesita que
-- `version` sea mayor; el mínimo es la maza y aquí no hace falta.
-- Se sube solo si aparece una incompatibilidad de datos real.
--
-- ORDEN DE EJECUCIÓN (no invertir)
--   1. Bundle 2.6.6 publicado en Vercel        [HECHO 2026-07-19]
--   2. Verificado en tableta real: carga, v2.6.6 en el pie, login OK
--   3. Esta migración
-- Ejecutarla antes del paso 1 haría que cada tableta purgue su caché y recargue
-- contra un bundle que no existe: el anclaje que estas capas buscan evitar.
--
-- CÓMO EJECUTAR
-- Pegar en el editor SQL de Supabase. NO usar `supabase db push` (drift).
--
-- REVERSIÓN
-- Si tras el anuncio las tabletas fallan, restaurar el estado previo:
--   UPDATE public.app_versions
--   SET version = '2.5.9',
--       min_supported_version = '2.5.9',
--       build_hash = 'v2.5.9',
--       release_notes = 'Corrección crítica: Monitor mostraba 0 en versión cloud. Gasto queda como referencia en Distribución.',
--       actualizado_en = now()
--   WHERE app_id = 'capture';
-- Ojo: revertir la fila NO deshace las recargas ya ocurridas. Si el bundle
-- 2.6.6 estuviera roto, hay que redesplegar el anterior en Vercel además de
-- revertir aquí.
--
-- control-digital NO se toca: ya está en 2.10.2 desde el 2026-07-19.

BEGIN;

UPDATE public.app_versions
SET
  version = '2.6.6',
  build_hash = 'v2.6.6',
  release_notes = 'Refresco automático de versión desde la nube y correcciones de caché PWA: las tabletas dejan de quedarse ancladas en versiones viejas. La actualización espera si hay una captura sin guardar.',
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

  IF v_version <> '2.6.6' THEN
    RAISE EXCEPTION 'La versión quedó en % y se esperaba 2.6.6', v_version;
  END IF;

  -- El mínimo por encima de la versión publicada dejaría a las tabletas
  -- bloqueadas sin poder capturar.
  IF v_minimo <> '2.5.9' THEN
    RAISE EXCEPTION 'min_supported_version quedó en %, se esperaba 2.5.9 (no debe subirse en este anuncio)', v_minimo;
  END IF;

  RAISE NOTICE 'OK: capture anunciada en v2.6.6 (mínimo soportado sigue en %)', v_minimo;
END $$;

COMMIT;

-- Verificación posterior (correr aparte para confirmar el estado final):
--   SELECT app_id, version, min_supported_version, build_hash, actualizado_en
--   FROM public.app_versions ORDER BY app_id;
