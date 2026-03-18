-- SICA 005: Actualización de Puntos de Entrega desde Excel
-- Generado el: 3/17/2026, 9:12:34 PM

BEGIN;

INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-001', 'MOD-001', 'SEC-001', 'Toma Granja K-6+800', 6.8, 'lateral', 0.2, -105.1942667, 27.7253583, 'ZONA #1', '1 Y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-002', 'MOD-001', 'SEC-001', 'Toma Granja K-7+610', 7.61, 'toma', 0.2, -105.193725, 27.73255, 'ZONA #1', '1 Y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-003', 'MOD-001', 'SEC-001', 'Toma Directa K-8+164', 8.164, 'toma', 0.2, -105.19242103, 27.73717605, 'ZONA #1', '1 Y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-004', 'MOD-001', 'SEC-001', 'Toma Directa K-10+530', 10.53, 'toma', 0.2, -105.18438539, 27.75524667, 'ZONA #1', '1 Y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-005', 'MOD-001', 'SEC-001', 'Toma Lateral K-11+210', 11.21, 'toma', 0.3, -105.18461036, 27.76110613, 'ZONA #1', '1 Y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-006', 'MOD-001', 'SEC-001', 'Lateral K-14+500', 14.5, 'lateral', 0.2, -105.18494722, 27.79201146, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-007', 'MOD-001', 'SEC-001', 'Toma Lateral K-15+700', 15.7, 'toma', 0.15, -105.18779439, 27.8019115, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-008', 'MOD-001', 'SEC-001', 'Toma Lateral 16+410', 16.41, 'toma', 0.15, -105.18806952, 27.80784976, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-009', 'MOD-001', 'SEC-001', 'Lateral K-17+320', 17.32, 'lateral', 0.3, -105.18725971, 27.81376686, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-010', 'MOD-001', 'SEC-001', 'Lateral K-17+600', 17.6, 'toma', 0.2, -105.18745744, 27.81847145, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-011', 'MOD-001', 'SEC-001', 'Directa K-19+960', 19.96, 'toma', 0.3, -105.19613178, 27.83637168, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-012', 'MOD-001', 'SEC-001', 'Directa K 21+630', 21.63, 'toma', 0.3, -105.19996148, 27.85101788, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-013', 'MOD-001', 'SEC-001', 'Directa K 22+210', 22.21, 'toma', 0.2, -105.20323401, 27.85524571, 'ZONA #1', '1 y 2')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-016', 'MOD-001', 'SEC-001', 'Directa K-23+820', 23.82, 'toma', 0.15, -105.20724141, 27.8661535, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-017', 'MOD-001', 'SEC-001', 'Lateral K-24+898', 24.898, 'toma', 0.3, -105.20528398, 27.87495458, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-018', 'MOD-001', 'SEC-001', 'Directa K-26+510', 26.51, 'toma', 0.3, -105.20948399, 27.88696669, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-019', 'MOD-001', 'SEC-001', 'Directa K-27+750', 27.75, 'toma', 0.2, -105.20854941, 27.89642022, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-020', 'MOD-001', 'SEC-001', 'Lateral K-28+230', 28.23, 'lateral', 0.12, -105.21288428, 27.89862567, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-021', 'MOD-001', 'SEC-001', 'Directa k-28+860', 28.26, 'toma', 0.2, -105.21814476, 27.90179109, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-022', 'MOD-001', 'SEC-001', 'Directa K-31+600', 31.6, 'toma', 0.2, -105.22875038, 27.92299773, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-023', 'MOD-001', 'SEC-001', 'Directa k-32+510', 32.51, 'toma', 0.2, -105.23515617, 27.92809015, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-024', 'MOD-001', 'SEC-001', 'Lateral 33+340', 33.34, 'lateral', 0.15, -105.24074069, 27.93214682, 'ZONA #1', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-027', 'MOD-001', 'SEC-001', 'Directa K 34+020', 34.02, 'toma', 0.2, -105.2372353, 27.93760059, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-026', 'MOD-001', 'SEC-001', 'Lateral K-34+950', 34.95, 'lateral', 0.5, -105.23711433, 27.94703927, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-028', 'MOD-001', 'SEC-001', 'Lateral k-34+952', 34.952, 'lateral', 0.5, -105.23711435, 27.94703929, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-029', 'MOD-001', 'SEC-001', 'Directa K-34+980', 34.98, 'toma', 0.15, -105.23729137, 27.94707365, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-030', 'MOD-001', 'SEC-001', 'Directa K-36+600', 36.6, 'toma', 0.2, -105.23754886, 27.9470988, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-031', 'MOD-001', 'SEC-001', 'Lateral k-36+960', 36.96, 'lateral', 0.5, -105.25444519, 27.95329546, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-032', 'MOD-001', 'SEC-001', 'Directa K-37+500', 37.5, 'toma', 0.15, -105.25980885, 27.95250823, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-033', 'MOD-001', 'SEC-001', 'Carcamo k-38+004 salcido', 38, 'carcamo', 0.1, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-034', 'MOD-001', 'SEC-001', 'Carcamo k-38+300 Ulate', 38.3, 'carcamo', 0.08, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-035', 'MOD-001', 'SEC-001', 'Carcamo k-38+679 Alvarez', 38.67, 'carcamo', 0.04, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-036', 'MOD-001', 'SEC-001', 'Lateral k-38+880', 38.8, 'lateral', 0.3, -105.27104099, 27.95686016, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-037', 'MOD-001', 'SEC-001', 'Carcamo k-38+940 Limas ', 38.94, 'carcamo', 0.04, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-038', 'MOD-001', 'SEC-001', 'Carcamo k-39+040 Alvarado ', 39.04, 'carcamo', 0.04, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-039', 'MOD-001', 'SEC-001', 'Carcamo k-39+278 Salcido ', 39.27, 'carcamo', 0.04, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-040', 'MOD-001', 'SEC-001', 'Directa k-39+780', 39.78, 'toma', 0.1, -105.27726006, 27.9629095, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-041', 'MOD-001', 'SEC-001', 'Carcamo k-39+790 Zacate', 39.79, 'carcamo', 0.04, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-042', 'MOD-001', 'SEC-001', 'Carcamo k-40+067 cano', 40.06, 'carcamo', 0.06, 105, 27, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-043', 'MOD-001', 'SEC-001', 'Lateral k-40+260', 40.26, 'lateral', 0.4, -105.28063009, 27.9661916, 'ZONA #1', 4)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-045', 'MOD-001', 'SEC-001', 'Directa k-41+080', 41.08, 'toma', 0.15, -105.28573684, 27.97063627, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-046', 'MOD-001', 'SEC-001', 'Lateral k-41+912', 41.91, 'lateral', 0.4, -105.2903634, 27.97804973, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-047', 'MOD-001', 'SEC-001', 'Directa k-42+260', 42.26, 'toma', 0.2, -105.29259601, 27.98025819, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-048', 'MOD-001', 'SEC-001', 'Directa K-42+990', 42.99, 'toma', 0.2, 105, 27, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-049', 'MOD-001', 'SEC-001', 'Directa k-43+360', 43.36, 'toma', 0.2, -105.29749196, 27.98815671, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-050', 'MOD-001', 'SEC-001', 'Lateral k-43+710', 43.71, 'lateral', 0.4, -105.30043954, 27.99142314, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-051', 'MOD-001', 'SEC-001', 'Directa k-43+740', 43.74, 'toma', 0.15, -105.30089099, 27.99164132, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-052', 'MOD-001', 'SEC-001', 'Directa k-44+540', 44.54, 'toma', 0.15, -105.30767815, 27.98923614, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-053', 'MOD-001', 'SEC-001', 'Directa k-44+800', 44.8, 'toma', 0.2, -105.31023949, 27.9891431, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-054', 'MOD-001', 'SEC-001', 'Directa K45+950', 44.95, 'toma', 0.2, -105.31295607, 27.99550035, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-055', 'MOD-001', 'SEC-001', 'Lateral k-46+500', 46.5, 'lateral', 0.6, -105.31206826, 28.00013789, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-056', 'MOD-001', 'SEC-002', 'Directa k-47+640', 47.64, 'toma', 0.2, 105, 28, 'ZONA #1', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-058', 'MOD-012', 'SEC-002', 'Toma k-48+420', 48.42, 'toma', 0.8, -105.3240962, 28.01218696, 'ZONA #2', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-059', 'MOD-012', 'SEC-002', 'Toma K-49+872', 49.872, 'toma', 0.6, 105, 28, 'ZONA #2', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-060', 'MOD-012', 'SEC-002', 'Toma k-55+370', 55.37, 'toma', 0.6, -105.35649905, 28.05499745, 'ZONA #2', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-061', 'MOD-012', 'SEC-002', 'Toma K-57+290', 57.29, 'toma', 0.6, 105, 28, 'ZONA #2', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-062', 'MOD-012', 'SEC-002', 'Tomak-62+160', 62.16, 'toma', 0.6, -105.39453445, 28.0826708, 'ZONA #2', 5)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-063', 'MOD-002', 'SEC-002', 'Directa k-49+040', 49.04, 'toma', 0.8, -105.32486768, 28.01660581, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-064', 'MOD-002', 'SEC-002', 'Lateral k-49+640', 49.64, 'lateral', 0.4, -105.32485167, 28.02157821, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-065', 'MOD-002', 'SEC-002', 'Directa k-49+704', 49.7, 'toma', 0.15, -105.32513062, 28.0222097, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-066', 'MOD-002', 'SEC-002', 'Directa k-49+872', 49.87, 'toma', 0.12, 105, 28, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-067', 'MOD-002', 'SEC-002', 'Directa k-50+500', 50.5, 'toma', 0.1, -105.33104413, 28.02657944, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-068', 'MOD-002', 'SEC-002', 'Directa k-51+090', 51.09, 'toma', 0.15, -105.33677668, 28.02872621, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-069', 'MOD-002', 'SEC-002', 'Directa K-52+360', 52.36, 'toma', 0.1, -105.33835558, 28.03738983, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-070', 'MOD-002', 'SEC-002', 'Directa K-52+900', 50.9, 'toma', 0.15, -105.33761831, 28.04194749, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-071', 'MOD-002', 'SEC-002', 'Directa K-53+114', 53.14, 'toma', 0.15, -105.33914449, 28.04340402, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-072', 'MOD-002', 'SEC-002', 'Lateral K-53+380', 53.38, 'lateral', 0.25, -105.34160726, 28.04451051, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-073', 'MOD-002', 'SEC-002', 'Directa K-53+390', 53.9, 'toma', 0.35, -105.34165914, 28.04452694, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-074', 'MOD-002', 'SEC-002', 'Directa K-54+414', 54.41, 'toma', 0.1, -105.34921065, 28.05042461, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-076', 'MOD-002', 'SEC-002', 'Directa K-55+030', 55.03, 'toma', 0.1, -105.35306607, 28.05469318, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-077', 'MOD-012', 'SEC-002', 'Toma K-55+360', 55.36, 'toma', 0.5, -105.35636175, 28.05497121, 'ZONA #2', 6)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-080', 'MOD-002', 'SEC-002', 'Lateral k-56+360', 56.36, 'lateral', 0.2, -105.35787544, 28.06220002, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-081', 'MOD-002', 'SEC-002', 'Directa K-56+368', 56.36, 'toma', 0.1, -105.35785373, 28.062313, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-082', 'MOD-002', 'SEC-002', 'Lateral k-57+140', 57.14, 'lateral', 0.7, -105.36198308, 28.06825703, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-083', 'MOD-002', 'SEC-002', 'Directa K-57-152', 57.15, 'toma', 0.5, -105.36214426, 28.06835317, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-084', 'MOD-002', 'SEC-002', 'Directa K-57+290', 57.29, 'toma', 0.12, 105, 28, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-085', 'MOD-002', 'SEC-002', 'Directa K-58+600', 58.6, 'toma', 0.15, -105.37317283, 28.06971858, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-086', 'MOD-002', 'SEC-002', 'Directa K-58+761', 58.76, 'toma', 0.5, -105.3748234, 28.07050573, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-088', 'MOD-002', 'SEC-002', 'Directa K-60+303', 60.3, 'toma', 0.1, -105.38525518, 28.07375162, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-089', 'MOD-002', 'SEC-002', 'Lateral K-61+030', 61.03, 'lateral', 0.2, -105.3870215, 28.08012773, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-091', 'MOD-002', 'SEC-002', 'Directa K-62+630', 62.63, 'toma', 0.1, -105.39425558, 28.08700626, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-092', 'MOD-002', 'SEC-002', 'Repr. Y Pte K-62+800', 62.8, 'toma', 0.5, -105.39407772, 28.08851215, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-093', 'MOD-002', 'SEC-002', 'Directa K-63+710', 63.71, 'toma', 0.5, 105, 28, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-094', 'MOD-002', 'SEC-002', 'Directa K-64+292', 64.25, 'toma', 0.25, -105.39665105, 28.09837966, 'ZONA #2', 7)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-096', 'MOD-002', 'SEC-002', 'Lateral K-64+340', 64.34, 'lateral', 0.5, -105.396456, 28.09882441, 'ZONA #2', 8)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-097', 'MOD-002', 'SEC-002', 'Directa K-64+540', 64.54, 'toma', 0.5, 105, 28, 'ZONA #2', 8)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-098', 'MOD-002', 'SEC-002', 'Lateral K-65+850', 65.85, 'lateral', 0.15, -105.39881911, 28.11053485, 'ZONA #2', 8)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-099', 'MOD-002', 'SEC-002', 'Bombeo K-66+900', 66.9, 'carcamo', 0.3, 105, 28, 'ZONA #2', 8)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-100', 'MOD-002', 'SEC-003', 'Lateral k-67+320', 67.32, 'lateral', 0.5, -105.39667469, 28.12288147, 'ZONA #2', 8)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-102', 'MOD-002', 'SEC-003', ' DIRECTA K-67+615', 67.61, 'toma', 0.4, -105.39545235, 28.12536118, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-103', 'MOD-002', 'SEC-003', ' LATERAL K-67+850', 67.85, 'lateral', 0.4, -105.39539644, 28.12746143, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-104', 'MOD-002', 'SEC-003', ' DIRECTA K-68+197', 68.19, 'toma', 0.4, -105.39714424, 28.13018672, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-105', 'MOD-002', 'SEC-003', 'LATERAL K-68+582', 68.58, 'lateral', 0.4, -105.39927341, 28.13314687, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-107', 'MOD-002', 'SEC-001', 'TOMA GRANJA K-0+541', 0.54, 'toma', 0.4, 105, 27, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-108', 'MOD-002', 'SEC-001', 'SUBLATERAL K-1+125', 1.12, 'lateral', 0.4, 105, 27, 'ZONA #3', 9)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-110', 'MOD-002', 'SEC-001', 'TOMA GRANJA K-1+363', 1.36, 'toma', 0.4, 105, 27, 'ZONA #3', 10)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-110', 'MOD-003', 'SEC-001', 'TOMA GRANJA K-1+363', 1.36, 'toma', 0.4, 105, 27, 'ZONA #3', 10)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-111', 'MOD-003', 'SEC-001', 'SUB LATERAL K-1+370', 1.37, 'lateral', 0.4, 105, 27, 'ZONA #3', '10-13')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-113', 'MOD-004', 'SEC-001', 'BOMBEO K-0+533', 0.53, 'carcamo', 0.4, 105, 27, 'ZONA #3', 14)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-114', 'MOD-004', 'SEC-001', 'SUBLATERAL K-2+280', 2.28, 'lateral', 0.4, 105, 27, 'ZONA #3', 14)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-115', 'MOD-004', 'SEC-001', 'SUBLATERAL K-2+286', 2.286, 'lateral', 0.4, NULL, NULL, 'ZONA #3', '14-18')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-116', 'MOD-004', 'SEC-003', 'BOMBEO K-68+608', 68.6, 'carcamo', 0.4, 105, 28, 'ZONA #3', '14-18')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-117', 'MOD-004', 'SEC-003', 'BOMBEO K-69+960', 69.96, 'carcamo', 0.4, 105, 28, 'ZONA #3', '14-18')
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-118', 'MOD-004', 'SEC-003', 'LATERAL K-70+682', 70.68, 'lateral', 0.4, -105.42034577, 28.13127411, 'ZONA #3', 19)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-119', 'MOD-004', 'SEC-003', 'DIRECTA K-70+770', 70.77, 'toma', 0.4, 105, 28, 'ZONA #3', 19)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-120', 'MOD-004', 'SEC-003', 'DIRECTA K-70+840', 70.84, 'toma', 0.4, -105.42176239, 28.13059048, 'ZONA #3', 19)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-121', 'MOD-004', 'SEC-003', 'DIRECTA K-71+912', 71.91, 'toma', 0.4, -105.43241923, 28.1303728, 'ZONA #3', 19)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-123', 'MOD-012', 'SEC-001', 'SUB LAT K-0+186(M-12)', 0.186, 'lateral', 0.4, 105, 27, 'ZONA #3', 3)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-125', 'MOD-005', 'SEC-004', 'Directa K-72+922', 72.92, 'toma', 0.4, -105.43953957, 28.12976184, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-126', 'MOD-005', 'SEC-004', 'Lateral K-73+078', 73.07, 'lateral', 0.4, -105.44315854, 28.1315326, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-127', 'MOD-005', 'SEC-004', 'Directa K-73+278', 73.27, 'toma', 0.4, -105.44465396, 28.13130495, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-128', 'MOD-005', 'SEC-004', 'Represa K-73+296', 73.296, 'toma', 0.4, -105.44482729, 28.13110756, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-129', 'MOD-005', 'SEC-004', 'Lateral K-74+102', 74.1, 'lateral', 0.4, -105.45333761, 28.13055418, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-130', 'MOD-005', 'SEC-004', 'Lateral K-74+654', 74.65, 'lateral', 0.4, -105.45837714, 28.12893229, 'ZONA #4', 20)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-132', 'MOD-005', 'SEC-004', 'Lateral k-75+580', 75.58, 'lateral', 0.4, -105.46639611, 28.12456431, 'ZONA #4', 21)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-134', 'MOD-005', 'SEC-004', 'Lateral K-75+811', 75.81, 'lateral', 0.4, -105.46856644, 28.12376761, 'ZONA #4', 21)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-135', 'MOD-005', 'SEC-004', 'Directa K-79+007', 79, 'toma', 0.4, 105, 28, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-136', 'MOD-005', 'SEC-004', 'Directa K-79+011', 79.01, 'toma', 0.4, -105.48091742, 28.09913202, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-137', 'MOD-005', 'SEC-004', 'Directa K-79+014', 79.01, 'toma', 0.4, 105, 28, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-138', 'MOD-005', 'SEC-004', 'Represa K-79+025', 79.025, 'toma', 0.4, 105, 28, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-139', 'MOD-005', 'SEC-004', 'Directa K-79+874', 79.87, 'toma', 0.4, -105.48108581, 28.09161077, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-140', 'MOD-005', 'SEC-004', 'Directa K-80+400', 80.4, 'toma', 0.31, -105.48191688, 28.08701967, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-141', 'MOD-005', 'SEC-004', 'Lateral K-80+950', 80.95, 'lateral', 0.06, -105.48321943, 28.0822362, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-142', 'MOD-005', 'SEC-004', 'Directa K-82+934', 82.93, 'toma', 0.06, -105.49965215, 28.07462937, 'ZONA #4', 22)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-143', 'MOD-005', 'SEC-004', 'Directa K-84+050', 84.05, 'toma', 0.06, -105.50879454, 28.0790717, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-144', 'MOD-005', 'SEC-004', 'Directa k-84+554', 84.55, 'toma', 0.06, -105.51198017, 28.08252135, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-145', 'MOD-005', 'SEC-004', 'Directa k-85+047', 85.04, 'toma', 0.04, -105.51496128, 28.08633436, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-146', 'MOD-005', 'SEC-004', 'Directa K-85+512', 85.51, 'toma', 0.12, -105.51879692, 28.08875523, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-147', 'MOD-005', 'SEC-004', 'Lateral K-86+060', 86.06, 'lateral', 0.12, -105.52316951, 28.091679, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-148', 'MOD-005', 'SEC-004', 'Directa K-86+247', 86.24, 'toma', 0.09, 105, 28, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-149', 'MOD-005', 'SEC-004', 'Directa K-86+600', 86.6, 'toma', 0.1, -105.53100969, 28.09569988, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-150', 'MOD-005', 'SEC-004', 'Directa k-86+956', 86.95, 'toma', 0.1, -105.53100969, 28.09569988, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-151', 'MOD-005', 'SEC-004', 'Directa K-87+478', 87.47, 'toma', 0.1, -105.53535755, 28.09528573, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-152', 'MOD-005', 'SEC-004', 'Represa K-87+549', 87.549, 'toma', 4, -105.53596616, 28.09483093, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-153', 'MOD-005', 'SEC-004', 'Lateral K-88+379', 88.37, 'lateral', 0.18, -105.53899798, 28.10067429, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-154', 'MOD-005', 'SEC-004', 'Lateral K-88+865', 88.86, 'lateral', 0.12, -105.54076077, 28.10482786, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-155', 'MOD-005', 'SEC-004', 'Directa K-89+105', 89.1, 'toma', 0.06, -105.54267989, 28.10604743, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-156', 'MOD-005', 'SEC-004', 'Lateral K-89+733', 79.73, 'lateral', 0.12, -105.54784365, 28.10939868, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-157', 'MOD-005', 'SEC-004', 'Directa K-90+066', 90.06, 'toma', 0.5, -105.54986939, 28.11164495, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-158', 'MOD-005', 'SEC-004', 'Directa K-90+136', 90.13, 'toma', 0.4, -105.55062418, 28.11212372, 'ZONA #4', 23)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-160', 'MOD-005', 'SEC-004', 'Directa K-90+729', 90.72, 'toma', 0.12, -105.55624743, 28.11324723, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-161', 'MOD-005', 'SEC-004', 'Directa K-91+755', 91.75, 'toma', 0.1, -105.56281473, 28.11815408, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-162', 'MOD-005', 'SEC-004', 'Lateral K-92+070', 92.07, 'lateral', 0.12, -105.56566559, 28.11957758, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-163', 'MOD-005', 'SEC-004', 'Directa K-92+340', 92.34, 'toma', 0.1, -105.56806684, 28.12077242, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-164', 'MOD-005', 'SEC-004', 'Directa K-92+674', 92.67, 'toma', 0.12, -105.56995184, 28.12179459, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-165', 'MOD-005', 'SEC-004', 'Directa K-93+190', 93.19, 'toma', 0.12, -105.57484603, 28.12531348, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-167', 'MOD-005', 'SEC-004', 'Directa K-93+622', 93.62, 'toma', 0.12, -105.57809771, 28.12756143, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-168', 'MOD-005', 'SEC-004', 'Lateral K-93+643', 93.64, 'lateral', 0.18, -105.57814063, 28.1275864, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-169', 'MOD-005', 'SEC-004', 'Lateral K-93+716', 93.71, 'lateral', 1.2, -105.57855226, 28.12831169, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-170', 'MOD-005', 'SEC-004', 'Lateral K-94+034', 94.03, 'lateral', 0.36, -105.58096013, 28.12993124, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-171', 'MOD-005', 'SEC-004', 'Lateral K-94+044', 94.04, 'lateral', 0.1, -105.5811086, 28.12997904, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-172', 'MOD-005', 'SEC-004', 'Represa K-94+057', 94.057, 'toma', 0.2, -105.5812744, 28.12993402, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-173', 'MOD-005', 'SEC-004', 'Directa K-94+967', 94.96, 'toma', 0.1, -105.58607049, 28.13363479, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-174', 'MOD-005', 'SEC-004', 'Directa K-95+617', 95.61, 'toma', 0.1, -105.59170841, 28.13669049, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-175', 'MOD-005', 'SEC-004', 'Directa K-96+824', 96.82, 'toma', 0.1, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-176', 'MOD-005', 'SEC-004', 'Lateral K-96+965', 96.96, 'lateral', 0.48, -105.60089364, 28.14502562, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-177', 'MOD-005', 'SEC-004', 'Directa K-97+200', 97.2, 'toma', 0.03, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-178', 'MOD-005', 'SEC-004', 'Directa k-97+790', 97.79, 'toma', 0.1, -105.60755784, 28.14799265, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-180', 'MOD-005', 'SEC-004', 'Directa K-97+845', 97.84, 'toma', 0.12, -105.60788029, 28.14848266, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-181', 'MOD-005', 'SEC-004', 'Directa K-98+360', 98.36, 'toma', 0.2, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-182', 'MOD-005', 'SEC-004', 'Directa K-98+380', 98.38, 'toma', 0.12, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-183', 'MOD-005', 'SEC-004', 'Directa K-99+620', 99.62, 'toma', 0.12, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-184', 'MOD-005', 'SEC-004', 'Directa K-99+752', 99.75, 'toma', 0.1, 105, 28, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;
INSERT INTO public.puntos_entrega (id, modulo_id, seccion_id, nombre, km, tipo, capacidad_max, coords_x, coords_y, zona, seccion_texto)
VALUES ('PE-185', 'MOD-005', 'SEC-004', 'Represa K-99+786', 99.786, 'toma', 0.2, 28.16002554, 28.16002554, 'ZONA #4', 24)
ON CONFLICT (id) DO UPDATE SET
    modulo_id = EXCLUDED.modulo_id,
    seccion_id = EXCLUDED.seccion_id,
    nombre = EXCLUDED.nombre,
    km = EXCLUDED.km,
    tipo = EXCLUDED.tipo,
    capacidad_max = EXCLUDED.capacidad_max,
    coords_x = EXCLUDED.coords_x,
    coords_y = EXCLUDED.coords_y,
    zona = EXCLUDED.zona,
    seccion_texto = EXCLUDED.seccion_texto;

-- Eliminar registros que NO están en el Excel (Sustitución)
-- DELETE FROM public.puntos_entrega WHERE id NOT IN ('PE-001', 'PE-002', 'PE-003', 'PE-004', 'PE-005', 'PE-006', 'PE-007', 'PE-008', 'PE-009', 'PE-010', 'PE-011', 'PE-012', 'PE-013', 'PE-016', 'PE-017', 'PE-018', 'PE-019', 'PE-020', 'PE-021', 'PE-022', 'PE-023', 'PE-024', 'PE-027', 'PE-026', 'PE-028', 'PE-029', 'PE-030', 'PE-031', 'PE-032', 'PE-033', 'PE-034', 'PE-035', 'PE-036', 'PE-037', 'PE-038', 'PE-039', 'PE-040', 'PE-041', 'PE-042', 'PE-043', 'PE-045', 'PE-046', 'PE-047', 'PE-048', 'PE-049', 'PE-050', 'PE-051', 'PE-052', 'PE-053', 'PE-054', 'PE-055', 'PE-056', 'PE-058', 'PE-059', 'PE-060', 'PE-061', 'PE-062', 'PE-063', 'PE-064', 'PE-065', 'PE-066', 'PE-067', 'PE-068', 'PE-069', 'PE-070', 'PE-071', 'PE-072', 'PE-073', 'PE-074', 'PE-076', 'PE-077', 'PE-080', 'PE-081', 'PE-082', 'PE-083', 'PE-084', 'PE-085', 'PE-086', 'PE-088', 'PE-089', 'PE-091', 'PE-092', 'PE-093', 'PE-094', 'PE-096', 'PE-097', 'PE-098', 'PE-099', 'PE-100', 'PE-102', 'PE-103', 'PE-104', 'PE-105', 'PE-107', 'PE-108', 'PE-110', 'PE-110', 'PE-111', 'PE-113', 'PE-114', 'PE-115', 'PE-116', 'PE-117', 'PE-118', 'PE-119', 'PE-120', 'PE-121', 'PE-123', 'PE-125', 'PE-126', 'PE-127', 'PE-128', 'PE-129', 'PE-130', 'PE-132', 'PE-134', 'PE-135', 'PE-136', 'PE-137', 'PE-138', 'PE-139', 'PE-140', 'PE-141', 'PE-142', 'PE-143', 'PE-144', 'PE-145', 'PE-146', 'PE-147', 'PE-148', 'PE-149', 'PE-150', 'PE-151', 'PE-152', 'PE-153', 'PE-154', 'PE-155', 'PE-156', 'PE-157', 'PE-158', 'PE-160', 'PE-161', 'PE-162', 'PE-163', 'PE-164', 'PE-165', 'PE-167', 'PE-168', 'PE-169', 'PE-170', 'PE-171', 'PE-172', 'PE-173', 'PE-174', 'PE-175', 'PE-176', 'PE-177', 'PE-178', 'PE-180', 'PE-181', 'PE-182', 'PE-183', 'PE-184', 'PE-185');
-- Nota: El DELETE está comentado por seguridad. Si estás seguro, descoméntalo antes de ejecutar.

COMMIT;