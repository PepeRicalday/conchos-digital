import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { armaSnapshot, hoyLocal, promptDinamico, PROMPT_ESTATICO, type DatosCrudos } from "./contexto.ts";
import { bloqueDocumentos, esRespuestaParcial, motivoLimite, tituloDe, validaPeticion, type ChunkRag, type FuenteRag, type MensajeHistorial } from "./validacion.ts";
import { conversar, ErrorProveedor, proveedorActivo, type UsoLlm } from "./llm.ts";
import type { Tarjeta } from "./herramientas.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── CORS: solo orígenes propios (con Bearer no hay cookies, pero no hay motivo para dejarlo abierto) ───────────────
const ORIGENES_FIJOS = new Set([
    "https://conchos-digital.vercel.app",
    "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
]);
const ORIGEN_PREVIEW = /^https:\/\/conchos-digital(-[a-z0-9]+)*-pepericaldays-projects\.vercel\.app$/;
const EXTRA = (Deno.env.get("HYDRIC_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function cabecerasCors(req: Request): Record<string, string> {
    const origen = req.headers.get("Origin") ?? "";
    const permitido = ORIGENES_FIJOS.has(origen) || ORIGEN_PREVIEW.test(origen) || EXTRA.includes(origen);
    return {
        ...(permitido ? { "Access-Control-Allow-Origin": origen, "Vary": "Origin" } : { "Vary": "Origin" }),
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
}

function json(req: Request, status: number, codigo: string, message: string, extra: Record<string, unknown> = {}): Response {
    // `error` y `message` conservan el formato que ya lee el cliente.
    return new Response(JSON.stringify({ error: true, code: codigo, message, ...extra }), {
        status, headers: { ...cabecerasCors(req), "Content-Type": "application/json" },
    });
}

// ─── Datos del sistema (service role: solo lectura de datos operativos) ──────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Admin = any;

async function cargaDatos(admin: Admin, ahoraMs: number): Promise<DatosCrudos> {
    const hoy = hoyLocal(ahoraMs);
    const ayer = hoyLocal(ahoraMs - 86_400_000);
    const hace14 = hoyLocal(ahoraMs - 14 * 86_400_000);
    const fallos: string[] = [];
    const LIM_ESCALAS = 600;

    // Cada consulta registra su fallo por nombre: el modelo debe saber que faltan datos, no recibir "Sin datos".
    // `limite`: si la respuesta llega al tope, puede estar TRUNCADA y se marca (la última lectura medida podría quedar fuera).
    // deno-lint-ignore no-explicit-any
    const q = async (nombre: string, p: PromiseLike<{ data: any; error: { message: string } | null }>, vacio: unknown, limite?: number): Promise<any> => {
        try {
            const r = await p;
            if (r.error) { console.error(`consulta ${nombre}:`, r.error.message); fallos.push(nombre); return vacio; }
            if (limite && Array.isArray(r.data) && r.data.length >= limite) { console.warn(`consulta ${nombre}: llegó al tope (${limite})`); fallos.push(`${nombre} (truncada)`); }
            return r.data ?? vacio;
        } catch (e) { console.error(`consulta ${nombre}:`, e); fallos.push(nombre); return vacio; }
    };

    const [presas, escalasCat, lecturasEsc, modulos, volumenCiclo, ciclo, conocimiento, tomas, perfil, canalStatus, evento, balanceModulos, interescalas, zonas, entregas] = await Promise.all([
        q("presas", admin.from("lecturas_presas").select("presa_id, fecha, creado_en, escala_msnm, almacenamiento_mm3, porcentaje_llenado, extraccion_total_m3s, presas(nombre, nombre_corto, capacidad_max)").order("fecha", { ascending: false }).order("creado_en", { ascending: false }).limit(30), []),
        q("catalogo_escalas", admin.from("escalas").select("id, nombre, km, pzas_radiales, ancho, alto, nivel_min_operativo, nivel_max_operativo").eq("activa", true).order("km"), []),
        q("lecturas_escalas", admin.from("lecturas_escalas").select("escala_id, fecha, hora_lectura, creado_en, nivel_m, nivel_abajo_m, gasto_calculado_m3s, apertura_radiales_m, radiales_json, confirmada, responsable, notas").gte("fecha", hace14).order("fecha", { ascending: false }).order("hora_lectura", { ascending: false, nullsFirst: false }).limit(LIM_ESCALAS), [], LIM_ESCALAS),
        q("modulos", admin.from("modulos").select("nombre, codigo_corto, autorizaciones_ciclo(ciclo_id, vol_autorizado, caudal_max)"), []),
        q("volumen_ciclo", admin.from("volumen_ciclo_modulo").select("ciclo_id, modulo_id, codigo_corto, modulo_nombre, numero_modulo, vol_autorizado_miles_m3, vol_hoja_miles_m3, vol_remanente_miles_m3, vol_entregado_miles_m3, vol_saldo_miles_m3, pct_entregado, meses_con_dato, ultimo_mes_hoja, hoja_mes_parcial, remanente_desde, remanente_hasta"), []),
        q("ciclo", admin.from("ciclos_agricolas").select("id, nombre, fecha_inicio, fecha_fin").eq("activo", true).order("fecha_inicio", { ascending: false }).limit(1).maybeSingle(), null),
        q("conocimiento", admin.from("hydric_knowledge_base").select("titulo, contenido").eq("activo", true).limit(5), []),
        q("tomas_activas", admin.from("reportes_operacion").select("caudal_promedio, estado, puntos_entrega(nombre, km)").eq("fecha", hoy).in("estado", ["inicio", "continua", "reabierto", "modificacion"]), []),
        q("perfil_canal", admin.from("perfil_hidraulico_canal").select("km_inicio, km_fin, nombre_tramo, plantilla_m, talud_z, pendiente_s0, capacidad_diseno_m3s, velocidad_diseno_ms, tirante_diseno_m, bordo_libre_m").order("km_inicio", { ascending: true }), []),
        q("canal_status", admin.from("sica_canal_status").select("estado_hidraulico, qe_boquilla, alerta_activa, mensaje_alerta").limit(1).maybeSingle(), null),
        q("evento_oficial", admin.from("sica_eventos_log").select("evento_tipo, fecha_inicio, notas, gasto_solicitado_m3s").eq("esta_activo", true).order("fecha_inicio", { ascending: false }).limit(1).maybeSingle(), null),
        q("balance_modulos", admin.from("balance_volumen_modulo").select("modulo_nombre, codigo_corto, zona_codigo, vol_base_m3, vol_base_consumido_m3, vol_adicional_consumido_m3, vol_base_disponible_m3, pct_base_consumido, estado_volumen").order("zona_codigo"), []),
        q("vol_interescalas", admin.from("vol_interescalas").select("km_up, km_down, nivel_up_m, nivel_down_m, vol_m3, vol_mm3").order("km_up", { ascending: true }), []),
        q("vol_zonas", admin.from("vol_zonas").select("codigo, km_inicio, km_fin, nivel_medio_m, tirante_diseno_m, bordo_libre_m, y_capacidad_m, vol_actual_mm3, vol_capacidad_m3, pct_llenado").order("km_inicio", { ascending: true }), []),
        q("entregas_modulo", admin.from("entregas_modulo").select("modulo_id, zona_id, tipo_entrega, gasto_m3s, volumen_m3, fecha, estado_operativo").gte("fecha", ayer).or("estado_operativo.is.null,estado_operativo.neq.cierre").order("fecha", { ascending: false }).order("modulo_id"), []),
    ]);

    // Entregas: la más reciente por módulo + zona + tipo (un módulo multizona —M2→Z2/Z3, M12— tiene una entrega por zona;
    // deduplicar sin zona descartaba una de ellas y subestimaba la extracción).
    const vistas = new Map<string, DatosCrudos["entregas"][number]>();
    for (const e of entregas as DatosCrudos["entregas"]) { const k = `${e.modulo_id}_${e.zona_id ?? ""}_${e.tipo_entrega}`; if (!vistas.has(k)) vistas.set(k, e); }

    return {
        presas, escalasCat, lecturasEsc, modulos, volumenCiclo, ciclo, evento, canalStatus, perfil, tomas, zonas, interescalas, balanceModulos, conocimiento,
        entregas: [...vistas.values()], fallos,
    };
}

// ─── RAG ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `ok:false` = la búsqueda NO funcionó (distinto de "no hay documentos relevantes"). */
async function buscaDocumentos(admin: Admin, mensaje: string): Promise<{ chunks: ChunkRag[]; ok: boolean }> {
    try {
        // @ts-ignore: Supabase.ai es un global del runtime de Edge Functions
        const session = new Supabase.ai.Session("gte-small");
        const salida = await session.run(mensaje, { mean_pool: true, normalize: true });
        const embedding = Array.from(salida as unknown as number[]);
        const { data, error } = await admin.rpc("match_hydric_documents", { query_embedding: embedding, match_threshold: 0.40, match_count: 5 });
        if (error) { console.error("RAG rpc:", error.message); return { chunks: [], ok: false }; }
        return { chunks: (data ?? []) as ChunkRag[], ok: true };
    } catch (e) {
        console.error("RAG embedding:", e);
        return { chunks: [], ok: false };
    }
}

// ─── Servidor ────────────────────────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecerasCors(req) });
    if (req.method !== "POST") return json(req, 405, "metodo", "Método no permitido.");

    try {
        // 1) Autenticación: JWT de USUARIO válido (la anon key también es un JWT válido y NO basta).
        const authHeader = req.headers.get("Authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (!token) return json(req, 401, "no_autenticado", "Sesión inválida: falta el token.");

        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: { user }, error: authError } = await admin.auth.getUser(token);
        if (authError || !user) {
            // Una caída del servicio de Auth (5xx) no es una sesión vencida: no se manda al usuario a cerrar sesión por eso.
            if ((authError?.status ?? 0) >= 500) { console.error("auth.getUser:", authError?.message); return json(req, 503, "auth_no_disponible", "El servicio de autenticación no responde. Intenta de nuevo en un momento."); }
            return json(req, 401, "no_autenticado", "Tu sesión expiró. Vuelve a iniciar sesión.");
        }

        // 2) Autorización: la Consultoría IA es solo de la S.R.L.
        const { data: perfil, error: perfilError } = await admin.from("perfiles_usuario").select("rol").eq("id", user.id).maybeSingle();
        if (perfilError) { console.error("perfil:", perfilError.message); return json(req, 500, "interno", "No se pudo verificar tu perfil."); }
        if (perfil?.rol !== "SRL") return json(req, 403, "prohibido", "La Consultoría IA está disponible solo para la S.R.L.");

        // Cliente con el JWT del usuario: el chat se lee y escribe bajo RLS (solo conversaciones propias).
        const userDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });

        // 3) Entrada
        let cuerpo: unknown;
        try { cuerpo = await req.json(); } catch { return json(req, 400, "entrada", "Cuerpo JSON inválido."); }
        const v = validaPeticion(cuerpo);
        if (!v.ok) return json(req, v.status, "entrada", v.error);
        const { message, conversationId, contexto, clientMsgId } = v.value;

        // 4) Límite de uso, contado POR INVOCACIÓN en una tabla que solo escribe el servidor: no se puede reiniciar
        // borrando mensajes ni reenviando un client_msg_id. Se registra primero y se cuenta incluyendo esta consulta.
        // Falla CERRADO: si no se puede contar, no se llama al motor de IA.
        const ahora = Date.now();
        const desde = (ms: number) => new Date(ahora - ms).toISOString();
        const { error: errUso } = await admin.from("hydric_uso").insert({ user_id: user.id });
        const [rMin, rHora] = await Promise.all([
            admin.from("hydric_uso").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("ts", desde(60_000)),
            admin.from("hydric_uso").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("ts", desde(3_600_000)),
        ]);
        if (errUso || rMin.error || rHora.error) {
            console.error("límite de uso:", errUso?.message ?? rMin.error?.message ?? rHora.error?.message);
            return json(req, 503, "limite_no_disponible", "No se pudo verificar tu límite de uso. Intenta de nuevo en un momento.");
        }
        const limite = motivoLimite((rMin.count ?? 1) - 1, (rHora.count ?? 1) - 1);
        if (limite) return json(req, 429, "limite", limite);

        // 5) Conversación: existente (y propia, por RLS) o nueva
        let convId = conversationId;
        let conversacionExistia = false;
        if (convId) {
            const { data: c, error: errC } = await userDb.from("chat_conversations").select("id").eq("id", convId).maybeSingle();
            if (errC) { console.error("buscar conversación:", errC.message); return json(req, 500, "interno", "No se pudo abrir la conversación."); }
            if (!c) return json(req, 404, "conversacion", "Conversación no encontrada.");
            conversacionExistia = true;
        } else {
            const { data: nueva, error: errConv } = await userDb.from("chat_conversations")
                .insert({ user_id: user.id, titulo: tituloDe(message), contexto }).select("id").single();
            if (errConv || !nueva) { console.error("crear conversación:", errConv?.message); return json(req, 500, "interno", "No se pudo crear la conversación."); }
            convId = nueva.id as string;
        }

        // 6) Mensaje del usuario, idempotente por client_msg_id (índice único parcial en BD).
        // Un reintento NO duplica el mensaje; si esa consulta ya tiene respuesta, no se vuelve a llamar al motor de IA.
        let yaGuardado = false;
        if (clientMsgId && conversacionExistia) {
            const { data: previo, error: errP } = await userDb.from("chat_messages").select("id, created_at")
                .eq("conversation_id", convId).eq("metadata->>client_msg_id", clientMsgId).limit(1);
            if (errP) { console.error("idempotencia:", errP.message); return json(req, 500, "interno", "No se pudo verificar el mensaje."); }
            if (previo && previo.length > 0) {
                yaGuardado = true;
                const { data: respuesta, error: errR } = await userDb.from("chat_messages").select("id")
                    .eq("conversation_id", convId).eq("role", "assistant").gt("created_at", previo[0].created_at).limit(1);
                if (errR) { console.error("idempotencia (respuesta):", errR.message); return json(req, 500, "interno", "No se pudo verificar el mensaje."); }
                if (respuesta && respuesta.length > 0) return json(req, 409, "duplicado", "Esa consulta ya fue respondida. Recarga la conversación para verla.", { conversation_id: convId });
            }
        }
        if (!yaGuardado) {
            const { error: errMsg } = await userDb.from("chat_messages").insert({
                conversation_id: convId, role: "user", content: message, metadata: clientMsgId ? { client_msg_id: clientMsgId } : null,
            });
            // 23505 = otra petición con el mismo client_msg_id ganó la carrera: ya está guardado.
            if (errMsg && errMsg.code !== "23505") { console.error("guardar mensaje:", errMsg.message); return json(req, 500, "interno", "No se pudo guardar tu mensaje."); }
        }

        // 7) Datos del sistema + RAG en paralelo, e historial
        const [datos, rag0, hist] = await Promise.all([
            cargaDatos(admin, ahora),
            buscaDocumentos(admin, message),
            userDb.from("chat_messages").select("role, content, metadata").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(8),
        ]);
        if (!rag0.ok) datos.fallos.push("busqueda_documental");
        if (hist.error) { console.error("historial:", hist.error.message); datos.fallos.push("historial"); }
        const snapshot = armaSnapshot(datos, ahora);
        const rag = bloqueDocumentos(rag0.chunks);
        const historial: MensajeHistorial[] = ((hist.data ?? []) as Array<{ role: string; content: string; metadata: unknown }>)
            .reverse()
            .filter((m) => (m.role === "user" || m.role === "assistant") && !(m.role === "assistant" && esRespuestaParcial(m.metadata)))
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
        if (!historial.length || historial[historial.length - 1].role !== "user") historial.push({ role: "user", content: message });

        // 8) Respuesta en streaming (SSE). Se persiste lo generado aunque el cliente se desconecte a medias.
        const encoder = new TextEncoder();
        const abort = new AbortController();
        req.signal.addEventListener("abort", () => abort.abort());
        let clienteConectado = true;

        const stream = new ReadableStream({
            async start(controller) {
                const enviar = (obj: Record<string, unknown>) => {
                    if (!clienteConectado) return;
                    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
                    catch { clienteConectado = false; abort.abort(); }
                };
                let texto = "";
                const tarjetas: Tarjeta[] = [];
                let fin: { razon: string; proveedor: string; modelo: string; truncada: boolean; rechazada: boolean; uso?: UsoLlm } | null = null;
                let abortada = false;
                let errorEnviado = false;

                try {
                    enviar({ type: "inicio", conversation_id: convId, proveedor: proveedorActivo() });
                    for await (const ev of conversar({
                        estatico: PROMPT_ESTATICO, dinamico: promptDinamico(snapshot, contexto, rag.texto),
                        historial, snapshot, signal: abort.signal,
                    })) {
                        if (ev.tipo === "texto") { texto += ev.texto; enviar({ delta: ev.texto, conversation_id: convId }); }
                        else if (ev.tipo === "pensando") enviar({ type: "pensando", texto: ev.texto });
                        else if (ev.tipo === "estado") enviar({ type: "estado", texto: ev.texto });
                        else if (ev.tipo === "tarjetas") { tarjetas.push(...ev.tarjetas); enviar({ type: "tarjetas", tarjetas: ev.tarjetas }); }
                        else if (ev.tipo === "fin") fin = ev;
                    }
                } catch (err) {
                    abortada = abort.signal.aborted;
                    if (!abortada) {
                        console.error("Error del proveedor de IA:", err);
                        const e = err instanceof ErrorProveedor ? err : new ErrorProveedor("proveedor", "Error del motor de IA.");
                        enviar({ error: true, code: e.codigo, message: e.message });
                        errorEnviado = true;
                    }
                }

                // Sin texto no hay "respuesta": un 200 con `done` y nada que mostrar dejaba al usuario sin saber qué pasó.
                if (!errorEnviado && !abortada && texto.trim().length === 0) {
                    console.warn("respuesta sin texto; razón:", fin?.razon ?? "desconocida");
                    const msg = fin?.rechazada ? "El motor de IA declinó responder esta consulta. Reformula la pregunta."
                        : fin?.truncada ? "El motor de IA agotó su límite antes de redactar la respuesta. Acota la pregunta (por ejemplo, a un solo tramo o presa)."
                            : "El motor de IA no generó una respuesta. Intenta de nuevo.";
                    enviar({ error: true, code: "sin_respuesta", message: msg });
                    errorEnviado = true;
                }

                // Persistir lo generado (completo o parcial) como mensaje del asistente — verificando el resultado:
                // supabase-js NO lanza excepciones, devuelve {error}.
                let persistido = true;
                if (texto.trim().length > 0) {
                    const fila = {
                        conversation_id: convId, role: "assistant", content: texto,
                        metadata: {
                            proveedor: fin?.proveedor ?? proveedorActivo(), modelo: fin?.modelo ?? null, razon: fin?.razon ?? (abortada ? "abortada" : "error"),
                            truncada: fin?.truncada ?? false, abortada, uso: fin?.uso ?? null,
                            tarjetas: tarjetas.length ? tarjetas : undefined, fuentes: rag.fuentes.length ? rag.fuentes : undefined,
                        },
                    };
                    let r = await userDb.from("chat_messages").insert(fila);
                    if (r.error) {
                        // JWT vencido en una respuesta larga o RLS: se reintenta con service role (la conversación ya se verificó como propia).
                        console.error("persistir respuesta (usuario):", r.error.message, "conv:", convId);
                        r = await admin.from("chat_messages").insert(fila);
                    }
                    if (r.error) { persistido = false; console.error("persistir respuesta (admin):", r.error.message, "conv:", convId); }
                    const u = await userDb.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
                    if (u.error) console.error("actualizar conversación:", u.error.message);
                }

                if (fin && !errorEnviado) {
                    enviar({
                        type: "done", done: true, conversation_id: convId, proveedor: fin.proveedor, modelo: fin.modelo,
                        truncada: fin.truncada, rechazada: fin.rechazada, fuentes: rag.fuentes as FuenteRag[],
                        persistido, datos_incompletos: datos.fallos,
                    });
                }
                try { controller.close(); } catch { /* cliente ya desconectado */ }
            },
            cancel() { clienteConectado = false; abort.abort(); },
        });

        return new Response(stream, {
            headers: { ...cabecerasCors(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
    } catch (e) {
        // Detalle solo en logs del servidor; al cliente, un mensaje genérico.
        console.error("hydric-chat error:", e);
        return json(req, 500, "interno", "Error interno del servidor. Intenta de nuevo.");
    }
});
