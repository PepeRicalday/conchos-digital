import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
async function generateEmbedding(text: string): Promise<number[]> {
    const session = new Supabase.ai.Session("gte-small");
    const output = await session.run(text, { mean_pool: true, normalize: true });
    return Array.from(output.data as Float32Array);
}

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

        // 2. Marcar como procesando
        await supabase.from("hydric_documents")
            .update({ estado_procesamiento: "procesando" })
            .eq("id", document_id);

        // 3. Descargar archivo del Storage
        const { data: fileData, error: storageError } = await supabase.storage
            .from("hydric-knowledge")
            .download(doc.url_storage);

        if (storageError) throw storageError;

        const text = await fileData.text();
        if (!text.trim()) throw new Error("El documento está vacío");

        // 4. Eliminar chunks anteriores (idempotencia en caso de reprocesamiento)
        await supabase.from("hydric_document_chunks").delete().eq("document_id", document_id);

        // 5. Fragmentar y generar embeddings
        const chunks = chunkText(text);
        console.log(`Documento "${doc.titulo}": ${chunks.length} chunks generados`);

        let insertados = 0;
        for (const chunk of chunks) {
            let embedding: number[] | null = null;
            try {
                embedding = await generateEmbedding(chunk);
            } catch (embErr) {
                console.error("Error generando embedding:", embErr);
                // Insertar chunk sin embedding — será ignorado en búsqueda vectorial
                // pero útil como respaldo para búsqueda ILIKE
            }

            const { error: insertError } = await supabase.from("hydric_document_chunks").insert({
                document_id: doc.id,
                content: chunk,
                embedding,
                metadata: { source: doc.titulo, tipo: doc.tipo_documento },
            });

            if (insertError) {
                console.error("Error insertando chunk:", insertError.message);
            } else {
                insertados++;
            }
        }

        // 6. Actualizar estado del documento
        await supabase.from("hydric_documents")
            .update({ estado_procesamiento: "completado", chunks_generados: insertados })
            .eq("id", document_id);

        console.log(`Procesamiento completo: ${insertados}/${chunks.length} chunks con embedding`);

        return new Response(JSON.stringify({ success: true, chunks: insertados }), {
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
