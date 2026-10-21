# Fase 2 — avance 2026-10-21

Reversa de todo lo de abajo: `reversa_estado_20261021.sql` (misma carpeta).

## Aplicado en la BD (vía apply_migration)
| Migración | Efecto | Verificado como anon |
|---|---|---|
| cerrar_escritura_anon_dem_terreno_presa | DROP "Auth Write DEM Terreno" (ALL, true) | lee 1 fila; UPDATE = 0 filas |
| cerrar_acceso_total_anon_perfil_hidraulico_canal | DROP "Public Access Canal Perfil" (ALL, true); quedan Admin All (authenticated) y Public Read | lee 60 filas; UPDATE = 0 filas |

## Pendiente (bloqueado por el clasificador de permisos, no aplicado)
- DROP "Auth Write Textura Satelital" en textura_satelital_terreno. Escriben solo Edge Functions con service role.
- DROP "Auth Write Curva Correccion" en curva_batimetrica_correccion. Idem.

## Inventario de escritores (resultado)
- Terreno/curva: cliente solo lee; escriben sentinel-truecolor-terreno-sync, dem-boquilla-sync, recalibra-curva-batimetrica (todas con SERVICE_ROLE).
- perfil_hidraulico_canal: ManningCalibrador.tsx (UPDATE, sesion autenticada).
- movimientos_presas: sica-capture sync.ts:930 (upsert, tiene login) -> DIFERIDO, riesgo de frenar captura.
- Edge Functions verify_jwt=false: process-hydric-doc, extract-aforo-imagen, hydraulic-engine. OJO: verify_jwt=true acepta tambien la clave anon (es un JWT valido); el cierre real exige validar rol del usuario en el codigo de la funcion.
- Funciones: las usadas por vistas (fn_q_actual_k0, fn_tiempo_transito_dinamico, fn_vol_interescala, get_q_actual_escala) NO se tocan hasta decidir BE-4 (security_invoker en vistas las rompería para anon).
- auth_rol / auth_modulo_id las usan las politicas RLS: no revocar.
- Candidatas a revocar (administrativas/trigger/cron, sin llamada de cliente): fn_recalibra_curva_batimetrica, sync_daily_dam_registry, fn_generar_continuidad_diaria, fn_mantenimiento_diario_continuidad, fn_cron_hydric_doc_estado, fn_cron_weatherlink_estado, handle_new_user, check_dam_critical_level, check_module_overdraft, check_desviacion_vaso_ndwi, update_chat_conversation_timestamp. Revocar de PUBLIC y anon (el GRANT puede venir de PUBLIC) y dejar authenticated/service_role.
