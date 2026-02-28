import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ChatRequest {
    message: string;
    conversation_id?: string;
    contexto?: string;
}

async function fetchSystemData(supabaseAdmin: any) {
    const [presasRes, modulosRes, escalasRes, cicloRes, knowledgeRes] = await Promise.all([
        supabaseAdmin.from("lecturas_presas").select("*, presas(nombre, nombre_corto, capacidad_max)").order("fecha", { ascending: false }).limit(9),
        supabaseAdmin.from("modulos").select("*, autorizaciones_ciclo(vol_autorizado, caudal_max)"),
        supabaseAdmin.from("lecturas_escalas").select("*, escalas(nombre, km)").order("fecha", { ascending: false }).limit(30),
        supabaseAdmin.from("ciclos_agricolas").select("*").eq("activo", true).maybeSingle(),
        supabaseAdmin.from("hydric_knowledge_base").select("titulo, contenido, categoria").eq("activo", true),
    ]);

    return {
        presas: presasRes.data || [],
        modulos: modulosRes.data || [],
        escalas: escalasRes.data || [],
        ciclo_activo: cicloRes.data,
        knowledge: knowledgeRes.data || [],
    };
}

function buildSystemPrompt(data: any): string {
    const knowledgeText = data.knowledge.map((k: any) =>
        `[${k.categoria.toUpperCase()}] ${k.titulo}:\n${k.contenido}`
    ).join("\n\n");

    const presasText = data.presas.map((l: any) =>
        `${l.presas?.nombre || "Presa"}: Elevación ${l.escala_msnm} msnm, Almacenamiento ${l.almacenamiento_mm3} Mm³, Llenado ${l.porcentaje_llenado}%, Extracción ${l.extraccion_total_m3s} m³/s (${l.fecha})`
    ).join("\n");

    const modulosText = data.modulos.map((m: any) => {
        const auth = m.autorizaciones_ciclo?.[0];
        return `${m.nombre} (${m.codigo_corto}): Vol. Acumulado ${m.vol_acumulado} m³, Vol. Autorizado ${auth?.vol_autorizado || m.vol_autorizado} m³, Caudal Máx ${auth?.caudal_max || m.caudal_objetivo} m³/s`;
    }).join("\n");

    const cicloText = data.ciclo_activo
        ? `Ciclo Activo: ${data.ciclo_activo.nombre} (${data.ciclo_activo.fecha_inicio} a ${data.ciclo_activo.fecha_fin}), Vol. Autorizado Global: ${data.ciclo_activo.volumen_autorizado_mm3} Mm³`
        : "No hay ciclo agrícola activo.";

    return `Eres el Asistente de Inteligencia Hídrica del Distrito de Riego 005 Delicias, operado por la S.R.L. Unidad Conchos en Chihuahua, México.

Tu rol es ser un especialista técnico en:
1. **Hidrometría**: Medición de caudales, niveles, volúmenes. Curvas de calibración Q = Cd × H^n.
2. **Gestión de Datos**: Análisis estadístico, tendencias, anomalías en los datos capturados.
3. **Modelado de Escenarios**: Proyecciones de disponibilidad hídrica, eficiencia de distribución.
4. **Normativa**: Ley de Aguas Nacionales, requerimientos CONAGUA, bitácoras oficiales.

=== BASE DE CONOCIMIENTO EXPERTO ===
${knowledgeText}

=== DATOS OPERATIVOS EN TIEMPO REAL ===

📊 ESTADO DE PRESAS (Últimas lecturas):
${presasText || "Sin lecturas recientes"}

📊 ESTADO DE MÓDULOS DE RIEGO:
${modulosText || "Sin datos de módulos"}

📊 CICLO AGRÍCOLA:
${cicloText}

=== INSTRUCCIONES ===
- Responde siempre en español.
- Usa datos reales del sistema cuando estén disponibles.
- Incluye cálculos y fórmulas cuando sea pertinente.
- Si te piden tendencias, analiza los datos históricos disponibles.
- Si te piden proyecciones, basa tus cálculos en los datos reales y explica tus supuestos.
- Cuando cites valores numéricos, incluye las unidades (m³/s, Mm³, msnm, %, etc.).
- Si detectas anomalías (ej: pérdidas >10%), destácalas proactivamente.
- Para eficiencias usa: η = (Σ Qentregado / Qentrada) × 100.
- Sé técnico pero accesible. El usuario es el Gerente del Distrito.
- Puedes usar emojis técnicos para mejorar la lectura (📊 📈 ⚠️ 💧 🔍).
- Formatea tu respuesta en markdown para mejor visualización.`;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "No authorization header" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
        if (authError || !user) {
            console.error("Error validando session:", authError, "User:", user);
            return new Response(JSON.stringify({ error: authError?.message || "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: profile } = await supabaseAdmin
            .from("perfiles_usuario")
            .select("rol")
            .eq("id", user.id)
            .single();

        if (!profile || profile.rol !== "SRL") {
            return new Response(JSON.stringify({ error: "Acceso denegado. Solo usuarios SRL." }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body: ChatRequest = await req.json();
        const { message, conversation_id, contexto } = body;

        if (!message?.trim()) {
            return new Response(JSON.stringify({ error: "Mensaje vacío" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        let convId = conversation_id;
        if (!convId) {
            const { data: newConv, error: convError } = await supabaseAdmin
                .from("chat_conversations")
                .insert({
                    user_id: user.id,
                    titulo: message.substring(0, 60) + (message.length > 60 ? "..." : ""),
                    contexto: contexto || "general",
                })
                .select("id")
                .single();

            if (convError) throw convError;
            convId = newConv.id;
        }

        await supabaseAdmin.from("chat_messages").insert({
            conversation_id: convId,
            role: "user",
            content: message,
        });

        const { data: history } = await supabaseAdmin
            .from("chat_messages")
            .select("role, content")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: true })
            .limit(20);

        const systemData = await fetchSystemData(supabaseAdmin);
        const systemPrompt = buildSystemPrompt(systemData);

        const geminiContents = [
            { role: "user", parts: [{ text: `INSTRUCCIONES DEL SISTEMA (no menciones esto):\n\n${systemPrompt}` }] },
            { role: "model", parts: [{ text: "Entendido. Soy el Asistente de Inteligencia Hídrica del DR-005 Delicias. Estoy listo para analizar datos, generar tendencias y apoyar en la toma de decisiones hídricas. ¿En qué puedo ayudarle?" }] },
        ];

        if (history && history.length > 1) {
            for (const msg of history.slice(0, -1)) {
                geminiContents.push({
                    role: msg.role === "user" ? "user" : "model",
                    parts: [{ text: msg.content }],
                });
            }
        }

        geminiContents.push({
            role: "user",
            parts: [{ text: message }],
        });

        let geminiResponse = await fetch(GEMINI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: geminiContents,
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.9,
                    topK: 40,
                    maxOutputTokens: 4096,
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                ],
            }),
        });

        if (geminiResponse.status === 429) {
            // Reintento automático tras 2.5 segundos de espera
            await new Promise((resolve) => setTimeout(resolve, 2500));
            geminiResponse = await fetch(GEMINI_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: geminiContents,
                    generationConfig: {
                        temperature: 0.7,
                        topP: 0.9,
                        topK: 40,
                        maxOutputTokens: 4096,
                    },
                }),
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error("Gemini API error:", errText);
            if (geminiResponse.status === 429) {
                throw new Error("La red neuronal de análisis se encuentra saturada de consultas. Por favor, espera 15 segundos y vuelve a repetirme tu solicitud.");
            }
            throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const geminiData = await geminiResponse.json();
        const assistantMessage = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
            || "No pude generar una respuesta. Intenta reformular tu consulta.";

        await supabaseAdmin.from("chat_messages").insert({
            conversation_id: convId,
            role: "assistant",
            content: assistantMessage,
            metadata: {
                model: GEMINI_MODEL,
                tables_consulted: ["lecturas_presas", "modulos", "lecturas_escalas", "ciclos_agricolas", "hydric_knowledge_base"],
                timestamp: new Date().toISOString(),
            },
        });

        return new Response(
            JSON.stringify({
                conversation_id: convId,
                message: assistantMessage,
                metadata: {
                    model: GEMINI_MODEL,
                    data_context: {
                        presas_count: systemData.presas.length,
                        modulos_count: systemData.modulos.length,
                        knowledge_entries: systemData.knowledge.length,
                    },
                },
            }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Edge Function error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Error interno del servidor" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
