// Autorización común para edge functions. Sin dependencias del resto del repo.
//
// DOS MODOS (por qué hay dos):
//  1) `rechazarInvitado(req)`  → compatible con los crones actuales. Hoy 11 crones llaman con la anon key
//     (pública), así que NO se puede exigir sesión de usuario sin romperlos. Este modo solo corta a quien
//     sea un usuario con rol INVITADO (o cuenta inactiva/vencida). La anon key sola pasa, como hasta ahora.
//  2) `exigirRol(req, ['SRL'], {...})` → estricto. Requiere JWT de usuario con ese rol, o x-cron-secret
//     válido (tabla cron_secretos). Úsalo cuando el cron ya se migró a x-cron-secret (patrón goes-dcp-sync).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type RolApp = "SRL" | "ACU" | "AUDITORIA" | "INVITADO";
export type Resultado =
  | { ok: true; userId: string | null; rol: RolApp | null; via: "usuario" | "cron" | "anon" }
  | { ok: false; status: number; error: string };

// deno-lint-ignore no-explicit-any
type Sb = any;

const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

/** Lee el claim `role` del JWT SIN verificarlo: solo sirve como pista, nunca para autorizar por sí solo. */
function claimRole(jwt: string): string | null {
  try {
    const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")))?.role ?? null;
  } catch { return null; }
}

/**
 * ¿Es de verdad la anon key (firmada por este proyecto)? Un JWT con `role: "anon"` falsificado NO debe pasar.
 * 1) coincide con la clave del entorno → válida; 2) si no, la API REST valida la firma del `apikey`.
 * La service_role solo se acepta si coincide exactamente con la del entorno.
 */
async function esClaveDelProyecto(jwt: string): Promise<boolean> {
  if (jwt === Deno.env.get("SUPABASE_ANON_KEY") || jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  if (claimRole(jwt) !== "anon") return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/presas?select=id&limit=1`, { // presas tiene SELECT público; /rest/v1/ a secas rechaza la anon key
      headers: { apikey: jwt, Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(5_000),
    });
    return r.status === 200; // 401 = firma inválida (token falsificado)
  } catch { return false; }
}

export function clienteAdmin(): Sb {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function perfilDe(sb: Sb, jwt: string) {
  const { data: u, error } = await sb.auth.getUser(jwt);
  if (error || !u?.user?.id) return { userId: null as string | null, perfil: null, authCaida: (error?.status ?? 0) >= 500 };
  const { data: perfil } = await sb.from("perfiles_usuario")
    .select("rol, activo, vigente_hasta").eq("id", u.user.id).maybeSingle();
  return { userId: u.user.id as string, perfil, authCaida: false };
}

function vigente(p: { activo?: boolean; vigente_hasta?: string | null } | null): boolean {
  if (!p) return false;
  if (p.activo === false) return false;
  return !p.vigente_hasta || p.vigente_hasta >= new Date().toISOString().slice(0, 10);
}

/**
 * Modo 1 — compatible con crones. Rechaza INVITADO e invitados vencidos; deja pasar la anon key REAL, la service
 * y a los demás roles. Un token falsificado cae en getUser() y recibe 401.
 * LÍMITE CONOCIDO: la anon key es pública, así que quien la use directamente sigue pasando (también un invitado), y sin
 * cabecera Authorization solo corta si la función tiene verify_jwt activo (extract-aforo-imagen lo tiene desactivado).
 * El cierre completo es migrar los crones a `x-cron-secret` y usar `exigirRol`.
 */
export async function rechazarInvitado(req: Request, sb: Sb = clienteAdmin()): Promise<Resultado> {
  const jwt = bearer(req);
  if (!jwt) return { ok: true, userId: null, rol: null, via: "anon" };
  if (await esClaveDelProyecto(jwt)) return { ok: true, userId: null, rol: null, via: "anon" };
  const { userId, perfil, authCaida } = await perfilDe(sb, jwt);
  if (authCaida) return { ok: false, status: 503, error: "El servicio de autenticación no responde." };
  if (!userId) return { ok: false, status: 401, error: "Sesión inválida o vencida." };
  if (perfil?.rol === "INVITADO") return { ok: false, status: 403, error: "Las cuentas de invitado son de solo lectura." };
  return { ok: true, userId, rol: (perfil?.rol ?? null) as RolApp | null, via: "usuario" };
}

/** Modo 2 — estricto. Usuario con rol permitido (y vigente) o secreto de cron `nombreSecreto`. */
export async function exigirRol(
  req: Request, roles: RolApp[], opts: { nombreSecreto?: string } = {}, sb: Sb = clienteAdmin(),
): Promise<Resultado> {
  const secreto = req.headers.get("x-cron-secret");
  if (secreto && opts.nombreSecreto) {
    const { data: s } = await sb.from("cron_secretos").select("valor").eq("nombre", opts.nombreSecreto).maybeSingle();
    if (s?.valor && s.valor === secreto) return { ok: true, userId: null, rol: null, via: "cron" };
  }
  const jwt = bearer(req);
  if (!jwt) return { ok: false, status: 401, error: "Falta el token de sesión." };
  const { userId, perfil, authCaida } = await perfilDe(sb, jwt);
  if (authCaida) return { ok: false, status: 503, error: "El servicio de autenticación no responde." };
  if (!userId) return { ok: false, status: 401, error: "Sesión inválida o vencida." };
  if (!perfil || !roles.includes(perfil.rol) || !vigente(perfil)) return { ok: false, status: 403, error: "No tienes permiso para esta acción." };
  return { ok: true, userId, rol: perfil.rol as RolApp, via: "usuario" };
}
