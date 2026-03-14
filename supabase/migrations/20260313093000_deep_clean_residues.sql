-- Scrub residual/simulation data for Absolute Zero start
-- Target: Escalas, Aforos, and Operation Reports

DELETE FROM lecturas_escalas;
DELETE FROM resumen_escalas_diario;
DELETE FROM aforos;
DELETE FROM reportes_operacion;
DELETE FROM sica_llenado_seguimiento;

-- Resetting any health metrics if they exist in separate tables
-- (Optional, usually derived from the above tables)
