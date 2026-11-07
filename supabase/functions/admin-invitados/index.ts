// Administración de cuentas INVITADO (solo lectura). Solo la puede usar un usuario SRL.
//   POST { accion: "listar" }
//   POST { accion: "crear", email, nombre, vigente_hasta?: "YYYY-MM-DD" }  → devuelve contraseña temporal UNA vez
//   POST { accion: "actualizar", id, activo?, vigente_hasta?: "YYYY-MM-DD" | null }
//   POST { accion: "restablecer", id }                                       → nueva contraseña temporal
// Requiere la migración 20261106100000_rol_invitado_solo_lectura.sql (rol INVITADO, activo, vigente_hasta).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { clienteAdmin, exigirRol } from "../_shared/auth.ts";

const ORIGENES_FIJOS = new Set([
  "https://conchos-digital.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
]);
const ORIGEN_PREVIEW = /^https:\/\/conchos-digital(-[a-z0-9]+)*-pepericaldays-projects\.vercel\.app$/;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") ?? "";
  return {
    ...(ORIGENES_FIJOS.has(o) || ORIGEN_PREVIEW.test(o) ? { "Access-Control-Allow-Origin": o } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const resp = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function passwordTemporal(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, (x) => abc[x % abc.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return resp(req, 405, { error: "Método no permitido." });

  const sb = clienteAdmin();
  const auth = await exigirRol(req, ["SRL"], {}, sb);
  if (!auth.ok) return resp(req, auth.status, { error: auth.error });

  let c: Record<string, unknown>;
  try { c = await req.json(); } catch { return resp(req, 400, { error: "Cuerpo JSON inválido." }); }

  try {
    switch (c.accion) {
      case "listar": {
        const { data: perfiles, error } = await sb.from("perfiles_usuario")
          .select("id, nombre, activo, vigente_hasta, creado_por").eq("rol", "INVITADO").order("nombre");
        if (error) throw error;
        const { data: lista, error: e2 } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (e2) throw e2;
        const porId = new Map(lista.users.map((u: { id: string }) => [u.id, u]));
        // deno-lint-ignore no-explicit-any
        return resp(req, 200, { invitados: (perfiles ?? []).map((p: any) => {
          // deno-lint-ignore no-explicit-any
          const u = porId.get(p.id) as any;
          return { ...p, email: u?.email ?? null, ultimo_acceso: u?.last_sign_in_at ?? null, bloqueado: !!u?.banned_until && new Date(u.banned_until) > new Date() };
        }) });
      }

      case "crear": {
        const email = String(c.email ?? "").trim().toLowerCase();
        const nombre = String(c.nombre ?? "").trim();
        const vig = c.vigente_hasta == null || c.vigente_hasta === "" ? null : String(c.vigente_hasta);
        if (!EMAIL.test(email)) return resp(req, 400, { error: "Correo inválido." });
        if (nombre.length < 2 || nombre.length > 80) return resp(req, 400, { error: "El nombre debe tener entre 2 y 80 caracteres." });
        if (vig && (!FECHA.test(vig) || vig < new Date().toISOString().slice(0, 10))) return resp(req, 400, { error: "La vigencia debe ser una fecha futura (AAAA-MM-DD)." });

        const password = passwordTemporal();
        const { data: u, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !u?.user) return resp(req, 400, { error: error?.message ?? "No se pudo crear el usuario." });
        // El trigger handle_new_user ya creó la fila (INVITADO, inactiva): se completa y activa aquí.
        const { error: eP } = await sb.from("perfiles_usuario").upsert({
          id: u.user.id, rol: "INVITADO", nombre, modulo_id: null, activo: true, vigente_hasta: vig, creado_por: auth.userId,
        }, { onConflict: "id" });
        if (eP) {
          await sb.auth.admin.deleteUser(u.user.id); // no dejar un usuario sin perfil
          return resp(req, 500, { error: `No se pudo crear el perfil: ${eP.message}` });
        }
        return resp(req, 200, { id: u.user.id, email, password_temporal: password });
      }

      case "actualizar": {
        const id = String(c.id ?? "");
        if (!id) return resp(req, 400, { error: "Falta id." });
        const { data: p } = await sb.from("perfiles_usuario").select("rol").eq("id", id).maybeSingle();
        if (p?.rol !== "INVITADO") return resp(req, 403, { error: "Solo se administran cuentas INVITADO." });
        const cambios: Record<string, unknown> = {};
        if (typeof c.activo === "boolean") cambios.activo = c.activo;
        if ("vigente_hasta" in c) {
          const v = c.vigente_hasta == null || c.vigente_hasta === "" ? null : String(c.vigente_hasta);
          if (v && !FECHA.test(v)) return resp(req, 400, { error: "Fecha inválida (AAAA-MM-DD)." });
          cambios.vigente_hasta = v;
        }
        if (Object.keys(cambios).length === 0) return resp(req, 400, { error: "Nada que actualizar." });
        const { error } = await sb.from("perfiles_usuario").update(cambios).eq("id", id);
        if (error) throw error;
        // Reactivar = quitar el bloqueo de Auth (si su vigencia sigue siendo válida); desactivar/vencer = bloquear.
        const vigenteAhora = (cambios.activo ?? true) !== false &&
          (!("vigente_hasta" in cambios) || !cambios.vigente_hasta || String(cambios.vigente_hasta) >= new Date().toISOString().slice(0, 10));
        if (vigenteAhora && cambios.activo === true) await sb.auth.admin.updateUserById(id, { ban_duration: "none" });
        await sb.rpc("fn_invitados_expirar");
        return resp(req, 200, { ok: true });
      }

      case "restablecer": {
        const id = String(c.id ?? "");
        const { data: p } = await sb.from("perfiles_usuario").select("rol").eq("id", id).maybeSingle();
        if (p?.rol !== "INVITADO") return resp(req, 403, { error: "Solo se administran cuentas INVITADO." });
        const password = passwordTemporal();
        const { error } = await sb.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        return resp(req, 200, { password_temporal: password });
      }

      default:
        return resp(req, 400, { error: "Acción desconocida." });
    }
  } catch (e) {
    console.error("admin-invitados:", e instanceof Error ? e.message : e);
    return resp(req, 500, { error: "Error interno." });
  }
});
