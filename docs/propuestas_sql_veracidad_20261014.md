# Propuestas SQL de veracidad (NO aplicadas)

Origen: auditoría 2026-10-14. Estas funciones viven en la BD de producción y su definición vigente puede diferir de los
archivos de `supabase/migrations/` (hay deriva; ver memoria "NUNCA db push"). Antes de aplicar nada:
1. Leer la definición VIVA (`select pg_get_functiondef('public.<fn>'::regproc)`), no el archivo.
2. Aplicar con el conector SQL, no con `db push`, y con autorización explícita del usuario.

## 1. `fn_verificar_escala_km` — gasto de entrada inventado (ALTA)
Migración de origen `20260329100000_fn_simulacion_hidraulica.sql:517`:
```sql
SELECT COALESCE(lp.extraccion_total_m3s, 50.0) INTO v_q_entrada FROM public.lecturas_presas lp WHERE lp.fecha = p_fecha ...
```
Si la presa no reporta extracción se inventa **50 m³/s**. Propuesta: quitar el `COALESCE` (queda NULL) y propagar NULL
a `q_balance` y a la verificación (devolver "sin dato"). El front NO la llama hoy (solo aparece en un comentario), por lo
que el riesgo es bajo; conviene corregirla o eliminarla.

## 2. `fn_trg_calcular_gasto_escala` y `fn_calcular_gasto_escala` — apertura NULL → 0 (ALTA)
Migración de origen `20260329110000_fn_hidraulica_compuertas_fgv.sql:205-222` y `:899`:
- `COALESCE(NEW.apertura_radiales_m, 0)` y `h2 = 0 -- se asume descarga libre`.
Una lectura sin apertura reportada calcula un gasto con compuertas cerradas (≈0) en lugar de NULL.
Propuesta: si `apertura_radiales_m IS NULL` (y la escala tiene compuertas) dejar `gasto_calculado_m3s` en NULL; solo
asumir `h2 = 0` cuando la escala no tenga nivel aguas abajo y el cálculo sea de descarga libre documentada.
Ojo: el 2026-10-04 ya se corrigió un caso (compuertas cerradas); verificar contra la función viva qué quedó.

## 3. Constantes por defecto a documentar o unificar (MEDIA)
`Cd 0.62` (SQL) vs `CD_GATE = 0.70` (`src/utils/modelingTypes.ts`), rugosidad 0.014, bordo libre 0.6. Citar fuente y unificar.
