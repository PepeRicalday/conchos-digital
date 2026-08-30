-- ═══════════════════════════════════════════════════════════════════════════
-- fn_cron_hydric_doc_estado: diagnóstico del cron hydric-doc-ingest-1min
-- Fecha: 2026-08-29
--
-- El esquema `cron` no se expone por REST. Esta función (SECURITY DEFINER) lee
-- cron.job + cron.job_run_details y devuelve las últimas ejecuciones del job,
-- siguiendo el mismo patrón que fn_cron_weatherlink_estado.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_cron_hydric_doc_estado(p_limit INT DEFAULT 10)
RETURNS TABLE (
  jobid       BIGINT,
  jobname     TEXT,
  schedule    TEXT,
  activo      BOOLEAN,
  run_status  TEXT,
  run_message TEXT,
  run_start   TIMESTAMPTZ,
  run_end     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT j.jobid, j.jobname, j.schedule, j.active,
         d.status, d.return_message, d.start_time, d.end_time
  FROM cron.job j
  LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
  WHERE j.jobname = 'hydric-doc-ingest-1min'
  ORDER BY d.start_time DESC NULLS LAST
  LIMIT p_limit;
$$;

-- Lectura pública (solo diagnóstico, no expone datos sensibles).
GRANT EXECUTE ON FUNCTION public.fn_cron_hydric_doc_estado(INT) TO anon, authenticated;
