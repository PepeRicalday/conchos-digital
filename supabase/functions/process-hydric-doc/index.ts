import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// CORS: solo orígenes propios (el cron de pg_net no usa navegador y no necesita CORS).
const ORIGENES_FIJOS = new Set([
    "https://conchos-digital.vercel.app",
    "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173",
]);
const ORIGEN_PREVIEW = /^https:\/\/conchos-digital(-[a-z0-9]+)*-pepericaldays-projects\.vercel\.app$/;
let corsHeaders: Record<string, string> = {};
function calculaCors(req: Request): Record<string, string> {
    const origen = req.headers.get("Origin") ?? "";
    const permitido = ORIGENES_FIJOS.has(origen) || ORIGEN_PREVIEW.test(origen);
    return {
        ...(permitido ? { "Access-Control-Allow-Origin": origen } : {}),
        "Vary": "Origin",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tope de páginas: un PDF enorme agota el worker (WORKER_RESOURCE_LIMIT) y no se puede capturar. */
const MAX_PAGINAS = 600;

// deno-lint-ignore no-explicit-any
async function llamadaEsSrl(req: Request, supabase: any): Promise<boolean> {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return false;
    const { data: { user }, error } = await supabase.auth.getUser(token);   // la anon key NO es un usuario
    if (error || !user) return false;
    const { data: perfil } = await supabase.from("perfiles_usuario").select("rol").eq("id", user.id).maybeSingle();
    return perfil?.rol === "SRL";
}

// ─── Chunking inteligente ────────────────────────────────────────────────────
// gte-small fue entrenado con secuencias de hasta 512 tokens (~400-500 chars en español).
// Fragmentamos por párrafos primero; los párrafos largos se parten en oraciones.
const MAX_CHUNK_CHARS = 480;
const MIN_CHUNK_CHARS = 20;

function chunkText(text: string): string[] {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length >= MIN_CHUNK_CHARS);
    const chunks: string[] = [];

    for (const para of paragraphs) {
        if (para.length <= MAX_CHUNK_CHARS) {
            chunks.push(para);
            continue;
        }

        // Párrafo largo: dividir por oraciones
        const sentences = para.split(/(?<=[.!?])\s+/);
        let current = "";
        for (const sent of sentences) {
            const candidate = current ? `${current} ${sent}` : sent;
            if (candidate.length > MAX_CHUNK_CHARS && current) {
                chunks.push(current.trim());
                current = sent;
            } else {
                current = candidate;
            }
        }
        if (current.trim().length >= MIN_CHUNK_CHARS) chunks.push(current.trim());
    }

    return chunks;
}

// ─── Embedding via Supabase AI (gte-small, 384 dims, sin API key externa) ───
// session.run() con mean_pool+normalize devuelve directamente el array de
// 384 floats (no un objeto {data: Float32Array} como sugiere la doc de otros
// modos) — Array.from(output.data) fallaba con "undefined is not iterable"
// porque output.data no existe; output YA es el vector.
async function generateEmbedding(text: string): Promise<number[]> {
    const session = new Supabase.ai.Session("gte-small");
    const output = await session.run(text, { mean_pool: true, normalize: true });
    return Array.from(output as unknown as number[]);
}

// El runtime de Supabase.ai (gte-small) se queda sin recursos si se llama
// ~20+ veces seguidas dentro de la misma invocación (WORKER_RESOURCE_LIMIT,
// sin excepción capturable — mata el worker completo). Medido: 15 seguidas
// OK, 20 falla. Se procesa en lotes de BATCH_SIZE por invocación; el caller
// vuelve a invocar con el mismo document_id hasta que done=true.
const BATCH_SIZE = 5;

/** Fallo atribuible al documento (no al servidor): se informa a la S.R.L. con un mensaje seguro y accionable (HTTP 422). */
class ErrorDocumento extends Error {
    constructor(public codigo: "sin_texto" | "demasiadas_paginas" | "sin_fragmentos" | "embedding_fallido", mensaje: string) { super(mensaje); }
}

Deno.serve(async (req: Request) => {
    corsHeaders = calculaCors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parsear body una sola vez — req.body es un stream de un solo uso
    let document_id: string | null = null;
    try {
        const body = await req.json();
        document_id = body.document_id ?? null;
    } catch {
        return new Response(JSON.stringify({ error: "Body JSON inválido" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        if (!document_id || typeof document_id !== "string" || !UUID.test(document_id)) {
            return new Response(JSON.stringify({ error: "document_id inválido" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 1. Obtener metadata del documento
        const { data: doc, error: docError } = await supabase
            .from("hydric_documents")
            .select("*")
            .eq("id", document_id)
            .single();

        // PGRST116 = ninguna fila: el documento no existe (404). Cualquier otro error es del servidor (500), no "no encontrado".
        if (docError && docError.code !== "PGRST116") throw docError;
        if (!doc) {
            return new Response(JSON.stringify({ error: "Documento no encontrado" }), {
                status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // El cron (anon key) solo debe avanzar documentos PENDIENTES. Reprocesar uno completado o con error es
        // una acción de la S.R.L. (JWT de usuario): así un llamador anónimo no puede forzar trabajo de embeddings.
        if (!["pendiente", "procesando"].includes(doc.estado_procesamiento) && !(await llamadaEsSrl(req, supabase))) {
            return new Response(JSON.stringify({ error: "El documento ya fue procesado" }), {
                status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 2. ¿Ya hay chunks de texto para este documento (de un lote previo o de
        // la fase de extracción)? Solo se piden CONTEOS aquí (barato) — traer los
        // 70+ `content` completos de golpe ya agotaba el margen de recursos antes
        // de llegar a generar un solo embedding. Si no hay ninguno, extraer texto
        // del PDF y crear TODOS los chunks sin embedding — el PDF completo (hasta
        // ~30MB en este proyecto) solo se descarga y parsea UNA vez, no en cada lote.
        const { count: totalExistente, error: countError } = await supabase
            .from("hydric_document_chunks")
            .select("id", { count: "exact", head: true })
            .eq("document_id", document_id);

        if (countError) throw countError;

        const { count: pendientesCount, error: pendCountError } = await supabase
            .from("hydric_document_chunks")
            .select("id", { count: "exact", head: true })
            .eq("document_id", document_id)
            .is("embedding", null);

        if (pendCountError) throw pendCountError;

        let pendientes: { id: string; content: string }[] = [];
        let totalChunksRecienExtraidos: number | null = null;
        const yaConEmbedding = (totalExistente ?? 0) - (pendientesCount ?? 0);

        if (!totalExistente || totalExistente === 0) {
            // Fase de extracción — solo ocurre en la primera invocación del documento.
            const { error: marcaError } = await supabase.from("hydric_documents")
                .update({ estado_procesamiento: "procesando" })
                .eq("id", document_id);
            if (marcaError) console.error("No se pudo marcar el documento como procesando:", marcaError.message);

            const { data: fileData, error: storageError } = await supabase.storage
                .from("hydric-knowledge")
                .download(doc.url_storage);

            if (storageError) throw storageError;

            const arrayBuffer = await fileData.arrayBuffer();
            const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
            if (pdf.numPages > MAX_PAGINAS) throw new ErrorDocumento("demasiadas_paginas", `El PDF tiene ${pdf.numPages} páginas (máximo ${MAX_PAGINAS}). Divídelo en partes.`);
            const { text } = await extractText(pdf, { mergePages: true });

            if (!text.trim()) throw new ErrorDocumento("sin_texto", "El PDF no tiene texto extraíble (¿escaneado sin OCR?).");

            const textChunks = chunkText(text);
            // Sin fragmentos el documento volvería a "no tener chunks" y cada invocación re-descargaría y re-parsearía el PDF.
            if (textChunks.length === 0) throw new ErrorDocumento("sin_fragmentos", "No se pudo dividir el texto del PDF en fragmentos útiles.");
            console.log(`Documento "${doc.titulo}": ${textChunks.length} chunks extraídos del PDF`);

            // Insertar todos los chunks de texto SIN embedding — se completan por lotes.
            const rows = textChunks.map((chunk) => ({
                document_id: doc.id,
                content: chunk,
                embedding: null,
                metadata: { source: doc.titulo, tipo: doc.tipo_documento },
            }));
            const { error: insertError } = await supabase
                .from("hydric_document_chunks")
                .insert(rows);

            if (insertError) throw insertError;
            // La extracción del PDF (descarga + parseo, hasta ~30MB) ya usa buena
            // parte del margen de recursos de esta invocación — no se generan
            // embeddings aquí. El caller vuelve a invocar para el primer lote.
            pendientes = [];
            totalChunksRecienExtraidos = textChunks.length;
        } else if ((pendientesCount ?? 0) > 0) {
            // Ya existen chunks — traer SOLO el lote pendiente (no los 70+ completos).
            const { data: lotePendiente, error: loteError } = await supabase
                .from("hydric_document_chunks")
                .select("id, content")
                .eq("document_id", document_id)
                .is("embedding", null)
                .order("created_at", { ascending: true })
                .limit(BATCH_SIZE);

            if (loteError) throw loteError;
            pendientes = lotePendiente ?? [];
        }

        // 3. Procesar el lote de embeddings ya acotado a BATCH_SIZE
        const lote = pendientes;
        console.log(`Documento "${doc.titulo}": generando embeddings para ${lote.length} chunks de este lote`);

        let completados = 0;
        for (const row of lote) {
            let embedding: number[] | null = null;
            try {
                embedding = await generateEmbedding((row as any).content ?? "");
            } catch (embErr) {
                console.error("Error generando embedding:", embErr);
            }
            if (embedding == null) continue;

            const { error: updateError } = await supabase
                .from("hydric_document_chunks")
                .update({ embedding })
                .eq("id", row.id);

            if (updateError) {
                console.error("Error actualizando embedding:", updateError.message);
            } else {
                completados++;
            }
        }

        // Un lote que no logró NI UN embedding no avanza: el siguiente reintento tomaría los mismos fragmentos y la cola
        // quedaría atascada en "procesando" para siempre. Se marca error y se responde con un código HTTP de falla.
        if (lote.length > 0 && completados === 0) {
            throw new ErrorDocumento("embedding_fallido", "No se pudieron generar los embeddings del documento. Reintenta más tarde.");
        }

        const totalConEmbeddingAhora = yaConEmbedding + completados;
        const totalChunks = totalExistente && totalExistente > 0
            ? totalExistente
            : (totalChunksRecienExtraidos ?? 0);
        const done = totalChunks > 0 && totalConEmbeddingAhora >= totalChunks;

        // 4. Solo marcar completado cuando el último lote de embeddings terminó
        const { error: cierreError } = await supabase.from("hydric_documents")
            .update({
                estado_procesamiento: done ? "completado" : "procesando",
                chunks_generados: totalConEmbeddingAhora,
            })
            .eq("id", document_id);
        // Si no se pudo guardar el avance, no se responde success: el estado visible quedaría mal.
        if (cierreError) throw cierreError;

        console.log(`Lote completo: ${totalConEmbeddingAhora}/${totalChunks} embeddings — done=${done}`);

        return new Response(JSON.stringify({
            success: true,
            done,
            embeddings_en_lote: completados,
            embeddings_totales_hasta_ahora: totalConEmbeddingAhora,
            chunks_totales: totalChunks,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (e: any) {
        console.error("Error en process-hydric-doc:", e?.message ?? e);

        if (document_id && UUID.test(document_id)) {
            // supabase-js no lanza: devuelve {error}. (El builder tampoco tiene .catch(); encadenarlo lanzaba un TypeError
            // dentro de este mismo catch y el documento nunca pasaba a "error", con lo que el cron lo reintentaba sin fin.)
            const { error: errorMarca } = await supabase.from("hydric_documents")
                .update({ estado_procesamiento: "error" })
                .eq("id", document_id);
            if (errorMarca) console.error("No se pudo marcar el documento como error:", errorMarca.message);
        }

        // Fallos del propio documento: mensaje seguro y accionable (422). El resto: genérico (500); el detalle queda en logs.
        if (e instanceof ErrorDocumento) {
            return new Response(JSON.stringify({ error: e.message, code: e.codigo }), {
                status: e.codigo === "embedding_fallido" ? 502 : 422,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({ error: "No se pudo procesar el documento" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
