import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const { document_id } = await req.json();

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Fetch document metadata
        const { data: doc, error: docError } = await supabase
            .from("hydric_documents")
            .select("*")
            .eq("id", document_id)
            .single();

        if (docError || !doc) throw new Error("Documento no encontrado");

        // 2. Fetch file from storage
        const { data: fileData, error: storageError } = await supabase.storage
            .from("hydric-knowledge")
            .download(doc.url_storage);

        if (storageError) throw storageError;

        const text = await fileData.text();

        // 3. Simple matching/chunking logic (Simplified for initial version)
        // In a real RAG, we would split by paragraphs/tokens and generate embeddings
        const chunks = text.split("\n\n").filter(c => c.trim().length > 10);

        for (const chunk of chunks) {
            await supabase.from("hydric_document_chunks").insert({
                document_id: doc.id,
                content: chunk,
                metadata: { source: doc.titulo }
                // NOTE: embedding would be generated here if an API key is available
            });
        }

        return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
