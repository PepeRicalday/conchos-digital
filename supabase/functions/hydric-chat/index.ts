import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    return `Eres el Asistente de Inteligencia Hídrica del Distrito de Riego 005 Delicias, operado por la S.R.L. Unidad Conchos en Chihuahua, México.

Tu rol es ser un especialista técnico y estratégico en:
1. **Hidrometría y Represos**: Medición de caudales, niveles, volúmenes. Estructuras de Represos, Compuertas Radiales y curvas de calibración (Q = Cd × H^n).
2. **Gestión de Datos y Distribución**: Análisis estadístico, estado de tomas laterales activas a lo largo del canal principal.
3. **Modelado de Escenarios**: Proyecciones de disponibilidad hídrica, eficiencia de conducción (Entrada vs Salida) y pérdidas de conducción.
4. **Normativa**: Ley de Aguas Nacionales, requerimientos CONAGUA, bitácoras oficiales.
5. **Perfil Hidráulico del Canal**: Análisis de capacidades de diseño, ecuación de Manning (Q = 1/n × A × R^{2/3} × S^{1/2}), comparación medido vs teórico.

=== BASE DE CONOCIMIENTO EXPERTO ===
${knowledgeText}

=== DATOS OPERATIVOS EN TIEMPO REAL ===

📊 ESTADO DE PRESAS (Últimas lecturas):
${presasText || "Sin lecturas recientes"}

💧 NIVELES Y GASTOS EN ESCALAS/REPRESOS DEL CANAL PRINCIPAL:
${escalasText || "Sin lecturas recientes del canal"}

🌊 TOMAS LATERALES ACTUALMENTE ABIERTAS (Distribución en vivo):
${tomasActivasText || "No hay tomas laterales activas reportadas hoy."}

📊 ESTADO DE MÓDULOS DE RIEGO:
${modulosText || "Sin datos de módulos"}

📊 CICLO AGRÍCOLA:
${cicloText}

📏 PUNTOS DE AFORO OFICIALES (CALIBRACIÓN):
${aforosControlText || "No hay puntos de aforo definidos."}

🌊 PERFIL HIDRÁULICO DEL CANAL PRINCIPAL (DISEÑO DE INGENIERÍA):
${perfilCanalText || "No hay datos de perfil hidráulico cargados."}

=== INSTRUCCIONES ===
- Responde siempre en español.
- Usa EXHAUSTIVAMENTE los datos reales del sistema provistos arriba.
- Si el usuario te pregunta por las aperturas de los represos, analiza "NIVELES Y GASTOS EN ESCALAS" y dales las medidas exactas de cada compuerta.
- Si detectas diferencias significativas de gasto entre las escalas de aguas arriba y aguas abajo, resáltalo como posible pérdida o toma no contabilizada.
- Incluye cálculos y fórmulas (Q = Cd × A × √(2gh) para radiales) cuando se te pregunte la comprobación del gasto.
- Cuando el usuario pregunte sobre la capacidad del canal, usa los datos del PERFIL HIDRÁULICO para calcular con Manning.
- Compara siempre los datos medidos contra los de diseño del perfil hidráulico cuando sea relevante.
- Sé técnico pero directo. El usuario es el Gerente de la Red Mayor.
- Puedes usar emojis técnicos para mejorar la lectura (📊 📈 ⚠️ 💧 🔍 ⚙️).
- Formatea tu respuesta en markdown con tablas si es necesario.`;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // ─── Validar configuración del servidor ───
        if (!GROQ_API_KEY) {
            console.error("GROQ_API_KEY secret not configured!");
            return new Response(JSON.stringify({ error: "Servicio de IA no configurado. Falta GROQ_API_KEY en Supabase Secrets." }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            console.error("SUPABASE_SERVICE_ROLE_KEY not available!");
            return new Response(JSON.stringify({ error: "Configuración del servidor incompleta." }), {
                status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ─── Extraer y validar usuario con el cliente de Supabase (Método recomendado) ───
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Se requiere autenticación." }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Crear un cliente con el token del usuario para validar la sesión automáticamente
        const supabaseUserClient = createClient(
            SUPABASE_URL,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();

        if (authError || !user) {
            console.error("Auth error:", authError);
            return new Response(JSON.stringify({ error: "Token de sesión inválido o expirado. Inicia sesión de nuevo." }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const userId = user.id;
        console.log("User autenticado:", userId);

        // Mantener el cliente admin para consultas privilegiadas
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: profile } = await supabaseAdmin
            .from("perfiles_usuario")
            .select("rol")
            .eq("id", userId)
            .single();

        if (!profile || profile.rol !== "SRL") {
            return new Response(JSON.stringify({ error: "Acceso denegado. Solo usuarios con rol Gerente (SRL)." }), {
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
                    user_id: userId,
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

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "assistant", content: "Entendido. Soy el Asistente de Inteligencia Hídrica del DR-005 Delicias. Estoy listo para analizar datos, generar tendencias y apoyar en la toma de decisiones hídricas. ¿En qué puedo ayudarle?" }
        ];

        if (history && history.length > 1) {
            for (const msg of history.slice(0, -1)) {
                if (msg.role === "user" || msg.role === "assistant") {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }
        }

        messages.push({ role: "user", content: message });

        let aiResponse = await fetch(AI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: messages,
                temperature: 0.7,
                max_tokens: 4096,
            }),
        });

        if (aiResponse.status === 429) {
            // Reintento automático tras 5 segundos de espera
            await new Promise((resolve) => setTimeout(resolve, 5000));
            aiResponse = await fetch(AI_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 4096,
                }),
            });
        }

        if (!aiResponse.ok) {
            const errText = await aiResponse.text();
            console.error("Groq API error:", errText);
            throw new Error(`Groq API error: ${aiResponse.status} - ${errText}`);
        }

        const aiData = await aiResponse.json();
        const assistantMessage = aiData.choices?.[0]?.message?.content
            || "No pude generar una respuesta. Intenta reformular tu consulta.";

        await supabaseAdmin.from("chat_messages").insert({
            conversation_id: convId,
            role: "assistant",
            content: assistantMessage,
            metadata: {
                model: AI_MODEL,
                tables_consulted: ["lecturas_presas", "modulos", "lecturas_escalas", "ciclos_agricolas", "hydric_knowledge_base"],
                timestamp: new Date().toISOString(),
            },
        });

        return new Response(
            JSON.stringify({
                conversation_id: convId,
                message: assistantMessage,
                metadata: {
                    model: AI_MODEL,
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
