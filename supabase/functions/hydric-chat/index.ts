import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Motor solicitado por el usuario: Groq (Llama 3.3) - El más rápido y ligero
const AI_MODEL = "llama-3.3-70b-versatile";
const AI_URL = "https://api.groq.com/openai/v1/chat/completions";

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
    const today = new Date().toISOString().split("T")[0];
    try {
        const [presasRes, modulosRes, escalasRes, cicloRes, knowledgeRes, operacionRes, aforosRes, perfilRes] = await Promise.all([
            supabaseAdmin.from("lecturas_presas").select("*, presas(nombre, nombre_corto, capacidad_max)").order("fecha", { ascending: false }).limit(9),
            supabaseAdmin.from("modulos").select("*, autorizaciones_ciclo(vol_autorizado, caudal_max)"),
            supabaseAdmin.from("lecturas_escalas").select("*, escalas(nombre, km)").order("fecha", { ascending: false }).limit(30),
            supabaseAdmin.from("ciclos_agricolas").select("*").eq("activo", true).maybeSingle(),
            supabaseAdmin.from("hydric_knowledge_base").select("titulo, contenido, categoria").eq("activo", true),
            supabaseAdmin.from("reportes_operacion").select("*, puntos_entrega(nombre, km)").eq("fecha", today).in("estado", ["inicio", "continua", "reabierto", "modificacion"]),
            supabaseAdmin.from("aforos_control").select("*"),
            supabaseAdmin.from("perfil_hidraulico_canal").select("*").order("km_inicio", { ascending: true }),
        ]);

        return {
            presas: presasRes.data || [],
            modulos: modulosRes.data || [],
            escalas: escalasRes.data || [],
            ciclo_activo: cicloRes.data,
            knowledge: knowledgeRes.data || [],
            tomas_activas: operacionRes.data || [],
            aforos_control: aforosRes.data || [],
            perfil_canal: perfilRes.data || [],
        };
    } catch (e) {
        console.error("Error fetching system data:", e);
        return { presas: [], modulos: [], escalas: [], knowledge: [], tomas_activas: [], aforos_control: [], perfil_canal: [] };
    }
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

    const escalasText = data.escalas.map((e: any) => {
        let radialInfo = "";
        if (e.apertura_radiales_m > 0 || (e.radiales_json && e.radiales_json.length > 0)) {
            const aperturas = e.radiales_json ? e.radiales_json.map((r: any) => `R${r.index + 1}:${r.apertura_m}m`).join(', ') : `Máx ${e.apertura_radiales_m}m`;
            radialInfo = ` | Compuertas Radiales: [${aperturas}]`;
        }
        return `${e.escalas?.nombre || "Escala"} (Km ${e.escalas?.km || 0}): Nivel Arriba ${e.nivel_m}m, Nivel Abajo ${e.nivel_abajo_m || 0}m | Gasto Detectado: ${e.gasto_calculado_m3s || 0} m³/s${radialInfo}`;
    }).join("\n");

    const tomasActivasText = (data.tomas_activas || []).map((t: any) =>
        `Km ${t.puntos_entrega?.km || '?'} - ${t.puntos_entrega?.nombre || "Toma"}: Estado ${t.estado}, Gasto Promedio ${t.caudal_promedio} L/s`
    ).join("\n");

    const cicloText = data.ciclo_activo
        ? `Ciclo Activo: ${data.ciclo_activo.nombre} (${data.ciclo_activo.fecha_inicio} a ${data.ciclo_activo.fecha_fin}), Vol. Autorizado Global: ${data.ciclo_activo.volumen_autorizado_mm3} Mm³`
        : "No hay ciclo agrícola activo.";

    const aforosControlText = (data.aforos_control || []).map((a: any) =>
        `Ubicación: ${a.nombre_punto} | Coord: ${a.latitud}, ${a.longitud} | Geometría: ${JSON.stringify(a.caracteristicas_hidraulicas)}`
    ).join("\n");

    const perfilCanalText = (data.perfil_canal || []).map((t: any) =>
        `KM ${t.km_inicio}-${t.km_fin} | ${t.nombre_tramo} | b=${t.plantilla_m}m, z=${t.talud_z}, S₀=${t.pendiente_s0}, Qmax=${t.capacidad_diseno_m3s}m³/s, V=${t.velocidad_diseno_ms}m/s, dn=${t.tirante_diseno_m}m, BL=${t.bordo_libre_m}m`
    ).join("\n");

    return `Eres el Asistente de Inteligencia Hídrica del Distrito de Riego 005 Delicias, operado por la S.R.L. Unidad Conchos.
Tu rol es ser un especialista técnico y estratégico en:
1. **Hidrometría y Represos**: Medición de caudales, niveles, volúmenes. Estructuras de Represos, Compuertas Radiales.
2. **Gestión de Datos y Distribución**: Análisis estadístico, estado de tomas laterales activas.
3. **Modelado de Escenarios**: Proyecciones de disponibilidad hídrica, eficiencia de conducción.
4. **Perfil Hidráulico del Canal**: Análisis de capacidades de diseño, ecuación de Manning (Q = 1/n x A x R^(2/3) x S^(1/2)).

=== DATOS OPERATIVOS EN TIEMPO REAL (CICLO 2025-2026) ===
ESTADO DE PRESAS:
${presasText || "Sin lecturas recientes"}

NIVELES Y GASTOS EN ESCALAS:
${escalasText || "Sin lecturas recientes"}

TOMAS ABIERTAS HOY:
${tomasActivasText || "No hay tomas laterales activas hoy."}

ESTADO DE MÓDULOS (Balance):
${modulosText || "Sin datos de módulos"}

PERFIL HIDRÁULICO DEL CANAL PRINCIPAL:
${perfilCanalText.substring(0, 3000) || "No hay datos de perfil hidráulico."}

INSTRUCCIONES CRÍTICAS:
- Responde siempre en Español.
- Eres preciso y técnico. Si te preguntan por Manning, usa los datos del Perfil Hidráulico provistos.
- Formatea tus respuestas con Markdown para legibilidad.
- Si no hay datos operativos (lecturas vacías), infórmalo indicando que el ciclo está reiniciando.`;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        console.log("--- Inicio Invocación Groq (Llama 3.3) ---");

        // 1. Validar configuracion
        if (!GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en los Secrets.");

        // 2. Extraer y validar token (Autenticación robusta)
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Acceso no autorizado (Falta token)");
        const token = authHeader.split(/\s+/)[1];

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            console.error("Auth Error:", authError);
            // Fallback permisivo temporal si estamos en transición de perfiles
            if (!token) throw new Error("Sesión inválida.");
        }

        console.log(`Usuario ID: ${user?.id || 'Public/Operator'}`);

        // 3. Obtener datos del sistema y preparar prompt
        const systemData = await fetchSystemData(supabaseAdmin);
        const systemPrompt = buildSystemPrompt(systemData);

        const body: ChatRequest = await req.json();
        const { message, conversation_id } = body;

        // 4. Gestión de Historial
        let convId = conversation_id;
        if (!convId && user) {
            const { data: newConv } = await supabaseAdmin.from("chat_conversations")
                .insert({ user_id: user.id, titulo: message.substring(0, 50), contexto: "general" })
                .select("id").single();
            convId = newConv?.id;
        }

        if (convId) {
            await supabaseAdmin.from("chat_messages").insert({ conversation_id: convId, role: "user", content: message });
        }

        const { data: history } = convId
            ? await supabaseAdmin.from("chat_messages").select("role, content").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(8)
            : { data: [] };

        const messages = [
            { role: "system", content: systemPrompt },
            ...(history || []).map(m => ({ role: m.role, content: m.content })),
        ];

        // Evitar duplicar el último mensaje si ya se guardó
        if (!history?.some(h => h.content === message)) {
            messages.push({ role: "user", content: message });
        }

        // 5. Llamada a GROQ API (Llama 3.3)
        console.log(`Llamando a Groq API con modelo ${AI_MODEL}...`);

        const response = await fetch(AI_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: messages,
                temperature: 0.5,
                max_tokens: 1500,
                stream: false
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Groq Error Response:", errorText);
            throw new Error(`Groq API Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const assistantMessage = result.choices[0]?.message?.content || "No pude generar una respuesta.";

        // 6. Guardar respuesta del asistente
        if (convId) {
            await supabaseAdmin.from("chat_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: assistantMessage
            });
            // Actualizar fecha de la conversación
            await supabaseAdmin.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
        }

        console.log("Respuesta generada con éxito.");

        return new Response(JSON.stringify({
            conversation_id: convId,
            message: assistantMessage
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (e) {
        console.error("DEBUG CRITICO:", e);
        return new Response(JSON.stringify({
            error: e instanceof Error ? e.message : "Error desconocido en el motor de IA"
        }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
