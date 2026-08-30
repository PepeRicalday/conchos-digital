import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
        if (!document_id) throw new Error("Falta document_id");

        // 1. Obtener metadata del documento
        const { data: doc, error: docError } = await supabase
            .from("hydric_documents")
            .select("*")
            .eq("id", document_id)
            .single();

        if (docError || !doc) throw new Error("Documento no encontrado");

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
            await supabase.from("hydric_documents")
                .update({ estado_procesamiento: "procesando" })
                .eq("id", document_id);

            const { data: fileData, error: storageError } = await supabase.storage
                .from("hydric-knowledge")
                .download(doc.url_storage);

            if (storageError) throw storageError;

            const arrayBuffer = await fileData.arrayBuffer();
            const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
            const { text } = await extractText(pdf, { mergePages: true });

            if (!text.trim()) throw new Error("El PDF no tiene texto extraíble (¿escaneado sin OCR?)");

            const textChunks = chunkText(text);
            console.log(`Documento "${doc.titulo}": ${textChunks.length} chunks extraídos del PDF`);

            // Insertar todos los chunks de texto SIN embedding — se completan por lotes.
            const rows = textChunks.map((chunk) => ({
                document_id: doc.id,
                content: chunk,
                embedding: null,
                metadata: { source: doc.titulo, tipo: doc.tipo_documento },
            }));
            const { data: inserted, error: insertError } = await supabase
                .from("hydric_document_chunks")
                .insert(rows)
                .select("id, content, embedding");

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

        const totalConEmbeddingAhora = yaConEmbedding + completados;
        const totalChunks = totalExistente && totalExistente > 0
            ? totalExistente
            : (totalChunksRecienExtraidos ?? 0);
        const done = totalChunks > 0 && totalConEmbeddingAhora >= totalChunks;

        // 4. Solo marcar completado cuando el último lote de embeddings terminó
        await supabase.from("hydric_documents")
            .update({
                estado_procesamiento: done ? "completado" : "procesando",
                chunks_generados: totalConEmbeddingAhora,
            })
            .eq("id", document_id);

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
        console.error("Error en process-hydric-doc:", e.message);

        if (document_id) {
            await supabase.from("hydric_documents")
                .update({ estado_procesamiento: "error" })
                .eq("id", document_id)
                .catch(() => {});
        }

        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
