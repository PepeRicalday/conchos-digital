# Pruebas del handler de `hydric-chat` (sin Deno, sin red, sin costo)

Ejecutan la edge function **completa** (`supabase/functions/hydric-chat/index.ts`) en Node contra un Supabase simulado
(`fake_supabase.mjs`) y un servidor Anthropic simulado (dentro de `escenarios.mjs`). Cubren autenticación, rol, límite de
uso, idempotencia, persistencia (incluido el reintento con service role), aborto del cliente, CORS y el streaming SSE.

```bash
npm i --no-save @anthropic-ai/sdk@0.135.0     # misma versión que importa llm.ts
node e2e/edge-hydric/build.mjs                # → e2e/out/edge-hydric-driver.mjs
node e2e/edge-hydric/escenarios.mjs           # imprime OK/FALLA por escenario; sale con código 1 si hay fallas
```

Las pruebas unitarias de la lógica pura (contexto, balance, herramientas, validación) corren con `npx vitest run supabase`.

**Límites:** el simulador no ejecuta RLS ni el API real de Anthropic; no sustituye una prueba con un JWT de usuario SRL
en producción. Cuando cambie el contrato SSE o las tablas que toca el handler, actualizar `fake_supabase.mjs`.
