import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// ─── STAGE 1: Timezone-correct "today" ─────────────────────────────────────
function getTodayChihuahua(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chihuahua" }).format(new Date());
}

// ─── STAGE 1: Format timestamps to local time ───────────────────────────────
function fmtLocal(isoStr: string | null | undefined): string {
    if (!isoStr) return "—";
    return new Intl.DateTimeFormat("es-MX", {
        timeZone: "America/Chihuahua",
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(isoStr));
}

// ─── STAGE 1: Round a number to N decimals ──────────────────────────────────
function r(val: number | null | undefined, decimals = 2): string {
    if (val == null || isNaN(Number(val))) return "—";
    return Number(val).toFixed(decimals);
}

async function fetchSystemData(supabaseAdmin: any) {
    // STAGE 1: Use Chihuahua timezone for "today" — UTC was off 6 h during summer
    const today = getTodayChihuahua();

    try {
        const [
            presasRes, modulosRes, escalasRawRes, cicloRes,
            knowledgeRes, operacionRes, aforosRes, perfilRes,
            canalStatusRes, eventoLogRes
        ] = await Promise.all([
            supabaseAdmin.from("lecturas_presas")
                .select("*, presas(nombre, nombre_corto, capacidad_max)")
                .order("fecha", { ascending: false }).limit(9),

            supabaseAdmin.from("modulos")
                .select("*, autorizaciones_ciclo(vol_autorizado, caudal_max)"),

            // STAGE 1: Fetch 50 rows so we can deduplicate per escala_id below
            // Include gate dimensions from escalas: ancho, alto, pzas_radiales, coeficiente_descarga
            supabaseAdmin.from("lecturas_escalas")
                .select("*, escalas(nombre, km, ancho, alto, pzas_radiales, coeficiente_descarga)")
                .order("fecha", { ascending: false }).limit(50),

            supabaseAdmin.from("ciclos_agricolas").select("*").eq("activo", true).maybeSingle(),

            supabaseAdmin.from("hydric_knowledge_base")
                .select("titulo, contenido, categoria").eq("activo", true),

            supabaseAdmin.from("reportes_operacion")
                .select("*, puntos_entrega(nombre, km)")
                .eq("fecha", today)
                .in("estado", ["inicio", "continua", "reabierto", "modificacion"]),

            supabaseAdmin.from("aforos_control").select("*"),

            supabaseAdmin.from("perfil_hidraulico_canal")
                .select("*").order("km_inicio", { ascending: true }),

            supabaseAdmin.from("sica_canal_status").select("*").maybeSingle(),

            supabaseAdmin.from("sica_eventos_log")
                .select("*").eq("esta_activo", true).maybeSingle(),
        ]);

        // STAGE 1: Deduplicate escalas — keep only the most recent reading per escala_id
        const escalasRaw: any[] = escalasRawRes.data || [];
        const escalasMap = new Map<string, any>();
        for (const row of escalasRaw) {
            const key = row.escala_id ?? row.escalas?.nombre ?? row.id;
            if (!escalasMap.has(key)) escalasMap.set(key, row); // already ordered desc → first = newest
        }
        const escalas = Array.from(escalasMap.values());

        // PRE-CALCULAR tiempos de tránsito por tramo — el LLM lee la tabla, no calcula
        const perfilData: any[] = perfilRes.data || [];
        const transitoTramos = perfilData.map((t: any) => {
            const L_m = Math.round((t.km_fin - t.km_inicio) * 1000);
            const V = t.velocidad_diseno_ms || 1.0;
            const t_s = L_m / V;
            const t_min = Math.round(t_s / 60);
            return {
                km_inicio: t.km_inicio,
                km_fin: t.km_fin,
                nombre: t.nombre_tramo,
                L_m,
                V_ms: Number(V).toFixed(3),
                t_min,
                Qmax: t.capacidad_diseno_m3s,
            };
        });

        // Acumulado desde KM 0 para cualquier consulta de tránsito KMa → KMb
        let acum_min = 0;
        const transitoAcumulado = transitoTramos.map((t: any) => {
            acum_min += t.t_min;
            return { ...t, t_acum_min: acum_min };
        });

        return {
            presas: presasRes.data || [],
            modulos: modulosRes.data || [],
            escalas,
            ciclo_activo: cicloRes.data,
            knowledge: knowledgeRes.data || [],
            tomas_activas: operacionRes.data || [],
            aforos_control: aforosRes.data || [],
            perfil_canal: perfilData,
            transito_tramos: transitoAcumulado,
            canal_status: canalStatusRes.data,
            evento_oficial: eventoLogRes.data,
        };
    } catch (e) {
        console.error("Error fetching system data:", e);
        return {
            presas: [], modulos: [], escalas: [], knowledge: [],
            tomas_activas: [], aforos_control: [], perfil_canal: [],
            canal_status: null, evento_oficial: null,
        };
    }
}

// ─── STAGE 2: buildSystemPrompt ─────────────────────────────────────────────
function buildSystemPrompt(data: any, contexto: string): string {
    const knowledgeText = data.knowledge.map((k: any) =>
        `[${k.categoria.toUpperCase()}] ${k.titulo}:\n${k.contenido}`
    ).join("\n\n");

    // STAGE 1: Rounded floats + timestamps
    const presasText = data.presas.map((l: any) =>
        `${l.presas?.nombre || "Presa"}: ` +
        `Elevación ${r(l.escala_msnm, 3)} msnm, ` +
        `Almacenamiento ${r(l.almacenamiento_mm3, 3)} Mm³, ` +
        `Llenado ${r(l.porcentaje_llenado, 1)}%, ` +
        `Extracción total ${r(l.extraccion_total_m3s, 2)} m³/s ` +
        `(lectura: ${fmtLocal(l.fecha)})`
    ).join("\n");

    const modulosText = data.modulos.map((m: any) => {
        const auth = m.autorizaciones_ciclo?.[0];
        const volAcum = parseFloat(m.vol_acumulado || "0").toLocaleString("en-US");
        const volAuth = parseFloat(auth?.vol_autorizado || m.vol_autorizado || "0");
        const volAuthMm3 = (volAuth / 1000).toFixed(2);
        return `${m.nombre} (${m.codigo_corto}): ` +
            `Vol. Acumulado ${volAcum} millares m³, ` +
            `Vol. Autorizado ${volAuth.toLocaleString("en-US")} millares m³ (${volAuthMm3} Mm³), ` +
            `Caudal Máx ${auth?.caudal_max || m.caudal_objetivo || 0} m³/s`;
    }).join("\n");

    // STAGE 1: Deduped + rounded + timestamped escalas
    // Includes gate structure dimensions from escalas table (ancho, alto, pzas_radiales, coeficiente_descarga)
    const escalasText = data.escalas.map((e: any) => {
        const esc = e.escalas || {};
        const pzas = esc.pzas_radiales ?? 0;
        const ancho = esc.ancho ?? 0;
        const alto = esc.alto ?? 0;
        const cd = esc.coeficiente_descarga ?? 0.62;
        const deltaH = (e.nivel_m ?? 0) - (e.nivel_abajo_m ?? 0);

        // Gate structure line (only if this point has radial gates)
        let estructuraInfo = "";
        if (pzas > 0 && ancho > 0) {
            estructuraInfo = ` | ESTRUCTURA: ${pzas} compuerta(s) radial(es), ancho=${r(ancho, 2)}m c/u, alto_max=${r(alto, 2)}m, Cd=${r(cd, 3)}, L_total=${r(ancho * pzas, 2)}m`;
        }

        // Current aperture readings
        let aperturaInfo = "";
        if ((e.apertura_radiales_m ?? 0) > 0 || (e.radiales_json?.length > 0)) {
            const aperturas = e.radiales_json
                ? e.radiales_json.map((rj: any) => `R${rj.index + 1}:${Number(rj.apertura_m).toFixed(2)}m`).join(", ")
                : `${r(e.apertura_radiales_m, 2)}m`;
            aperturaInfo = ` | Apertura actual: [${aperturas}]`;
        }

        return `${esc.nombre || "Escala"} (Km ${r(esc.km, 1)}): ` +
            `NA=${r(e.nivel_m, 3)}m, NB=${r(e.nivel_abajo_m, 3)}m, ΔH=${r(deltaH, 3)}m` +
            `${estructuraInfo}` +
            `${aperturaInfo}` +
            ` | Q=${r(e.gasto_calculado_m3s, 2)} m³/s` +
            ` | Lectura: ${fmtLocal(e.created_at ?? e.fecha)}`;
    }).join("\n");

    const tomasActivasText = (data.tomas_activas || []).map((t: any) =>
        `Km ${r(t.puntos_entrega?.km, 1)} - ${t.puntos_entrega?.nombre || "Toma"}: ` +
        `Estado ${t.estado}, Gasto ${r(t.caudal_promedio, 2)} L/s`
    ).join("\n");

    const cicloText = data.ciclo_activo
        ? `Ciclo Activo: ${data.ciclo_activo.nombre} (${data.ciclo_activo.fecha_inicio} a ${data.ciclo_activo.fecha_fin}), ` +
          `Vol. Autorizado Global: ${data.ciclo_activo.volumen_autorizado_mm3} Mm³`
        : "No hay ciclo agrícola activo.";

    // STAGE 2: aforosControlText now INJECTED (was built but never used before)
    const aforosControlText = (data.aforos_control || []).map((a: any) => {
        const geo = a.caracteristicas_hidraulicas || {};
        return `${a.nombre_punto} | Coord: ${r(a.latitud, 5)}, ${r(a.longitud, 5)} | ` +
            `b=${r(geo.b, 2)}m, z=${r(geo.z, 2)}, n=${r(geo.n, 4)}, S₀=${r(geo.s0, 6)}`;
    }).join("\n");

    const perfilCanalText = (data.perfil_canal || []).map((t: any) =>
        `KM ${t.km_inicio}-${t.km_fin} | ${t.nombre_tramo} | ` +
        `b=${r(t.plantilla_m, 2)}m, z=${r(t.talud_z, 2)}, S₀=${r(t.pendiente_s0, 6)}, ` +
        `Qmax=${r(t.capacidad_diseno_m3s, 2)} m³/s, V=${r(t.velocidad_diseno_ms, 3)} m/s, ` +
        `dn=${r(t.tirante_diseno_m, 3)}m, BL=${r(t.bordo_libre_m, 3)}m`
    ).join("\n");

    // STAGE 2: Contexto-specific instruction
    const contextoInstruction = contexto === "operacion"
        ? "El usuario es un operador en campo. Prioriza instrucciones claras de acción, valores puntuales y alertas de seguridad."
        : contexto === "balance"
        ? "El usuario analiza el balance hídrico del ciclo. Incluye comparativos de vol. acumulado vs autorizado y eficiencia."
        : contexto === "hidraulica"
        ? "El usuario realiza análisis hidráulico. Usa las fórmulas de Manning y descarga de compuertas con los datos provistos."
        : "Responde con rigor técnico. Adapta el nivel de detalle a la pregunta formulada.";

    return `Eres el Asistente de Inteligencia Hídrica del Distrito de Riego 005 Delicias (S.R.L. Unidad Conchos).
Eres un especialista técnico y estratégico en:
1. **Hidrometría y Compuertas**: Medición de caudales, niveles, volúmenes. Cálculo de gasto por compuertas radiales.
2. **Gestión y Distribución**: Análisis de módulos, tomas laterales, balance hídrico por ciclo agrícola.
3. **Modelado Hidráulico**: Manning Q = (1/n) × A × R^(2/3) × S^(1/2). Perfil de flujo en canal principal.
4. **Escenarios de Operación**: Proyecciones de disponibilidad, eficiencia de conducción, alerta por capacidad.

=== DATOS OPERATIVOS EN TIEMPO REAL ===
PRESAS:
${presasText || "Sin lecturas recientes"}

ESCALAS DE MEDICIÓN (lectura más reciente por punto):
${escalasText || "Sin lecturas recientes"}

TOMAS ABIERTAS HOY (${getTodayChihuahua()} — zona Chihuahua):
${tomasActivasText || "No hay tomas laterales activas hoy."}

MÓDULOS — BALANCE DEL CICLO:
${cicloText}
${modulosText || "Sin datos de módulos"}

=== PERFIL HIDRÁULICO DEL CANAL PRINCIPAL ===
${perfilCanalText.substring(0, 5000) || "No hay datos de perfil hidráulico."}

=== TIEMPOS DE TRÁNSITO PRE-CALCULADOS (usa esta tabla directamente) ===
Formato: KM_inicio → KM_fin | Longitud | Velocidad diseño | t_tramo | t_acumulado_desde_K0
${(data.transito_tramos || []).map((t: any) => {
    const hh = Math.floor(t.t_acum_min / 60).toString().padStart(2, "0");
    const mm = (t.t_acum_min % 60).toString().padStart(2, "0");
    const hh_t = Math.floor(t.t_min / 60).toString().padStart(2, "0");
    const mm_t = (t.t_min % 60).toString().padStart(2, "0");
    return `KM ${t.km_inicio}→${t.km_fin} | ${t.L_m}m | V=${t.V_ms}m/s | +${hh_t}:${mm_t} | acum=${hh}:${mm} | Qmax=${r(t.Qmax,2)}m³/s`;
}).join("\n") || "Sin datos de tránsito."}

INSTRUCCIÓN: Para consultas de tránsito KMa→KMb, resta t_acumulado(KMb) − t_acumulado(KMa).
NO uses estimaciones de velocidad — la tabla de arriba tiene los valores reales de diseño.

=== PUNTOS DE AFORO DE CONTROL ===
${aforosControlText || "Sin puntos de aforo registrados."}

=== ESTATUS HIDRÁULICO DEL SISTEMA ===
EVENTO OFICIAL (SRL): ${data.evento_oficial?.evento_tipo || "ESTABILIZACIÓN"}
  Activado: ${fmtLocal(data.evento_oficial?.fecha_inicio)}
  Notas: ${data.evento_oficial?.notas || "Sin notas especiales."}

DETECCIÓN AUTOMÁTICA (SENSÓRICA): ${data.canal_status?.estado_hidraulico || "ESTABLE"}
  Extracción Boquilla: ${r(data.canal_status?.qe_boquilla, 2)} m³/s
  Alerta Estructural: ${data.canal_status?.alerta_activa ? "SÍ — " + data.canal_status.mensaje_alerta : "Ninguna"}

=== BASE DE CONOCIMIENTO TÉCNICO ===
${knowledgeText || "Sin entradas en la base de conocimiento."}

=== FÓRMULAS HIDRÁULICAS DE REFERENCIA ===
COMPUERTAS RADIALES (Tainter gates):
  Q = Cd × L_efectiva × a × √(2 × g × ΔH)
  Donde: Cd ≈ 0.61, g = 9.81 m/s², ΔH = NA − NB (carga diferencial en metros),
  a = apertura vertical de la compuerta (m), L_efectiva = longitud efectiva de la compuerta (m).

  CALIBRACIÓN OBLIGATORIA de L_efectiva:
    Si en los datos de Escalas hay Q, apertura (a) y ΔH disponibles para el punto consultado,
    DEBES calcular L_eff ANTES de responder:
      L_eff = Q_actual / (Cd × a_actual × √(2 × g × ΔH))
    Muestra el cálculo paso a paso y usa ese L_eff para cualquier escenario de la pregunta.
    NO pidas al usuario datos que ya están en las Escalas de Medición.

  ESCENARIOS DE APERTURA: Con L_eff calibrada, aplica la fórmula con la nueva apertura propuesta.
  Verifica siempre que Q_resultado ≤ Qmax del tramo aguas abajo (ver Perfil Hidráulico).

MANNING (canal trapezoidal):
  A = (b + z × y) × y
  P = b + 2 × y × √(1 + z²)
  R = A / P
  Q = (1/n) × A × R^(2/3) × S₀^(1/2)

TIEMPO DE TRAVESÍA (tránsito hidráulico):
  Para calcular cuánto tarda el agua en recorrer un tramo o la ruta completa:
    t_tramo(s) = L_tramo(m) / velocidad_diseno_ms
    t_total    = Σ t_tramo para todos los tramos del recorrido
  Los valores de L_tramo y velocidad_diseno_ms están en el Perfil Hidráulico del Canal.
  Presenta el resultado en horas y minutos (h:mm).

  SIEMPRE usa la tabla "TIEMPOS DE TRÁNSITO PRE-CALCULADOS" — resta t_acumulado(KMb) − t_acumulado(KMa).
  PROHIBIDO usar velocidades estimadas o promedios globales. Los valores reales están en esa tabla.

=== INSTRUCCIONES OPERATIVAS ===
- Contexto actual: ${contextoInstruction}
- SIEMPRE responde en Español con formato Markdown estructurado.

REGLA DE ORO — BALANCE DE CONTINUIDAD POR TRAMO:
  Antes de escribir cualquier recomendación operativa, DEBES ejecutar este análisis:

  PASO 1 — Determinar Q de entrada al sistema:
    Usa la extracción total de la Presa (Boquilla) como Q_entrada.

  PASO 2 — Balance tramo a tramo (aguas abajo):
    Para cada par de escalas consecutivas (Km_A → Km_B):
      Q_tomas_tramo = suma de caudal de tomas activas (reportes_operacion) ubicadas entre Km_A y Km_B
      Q_esperado_B  = Q_medido_A − Q_tomas_tramo
      Diferencia    = Q_medido_B − Q_esperado_B
      Si Diferencia < −(Q_esperado_B × 0.08): DÉFICIT en el tramo → requiere acción aguas arriba
      Si Q_medido_B > Qmax_tramo_B:            EXCEDENTE → riesgo de desbordamiento
      De lo contrario:                          CONSISTENTE

  PASO 3 — Recomendaciones solo donde hay DÉFICIT o EXCEDENTE:
    Para DÉFICIT: calcular apertura adicional requerida en la compuerta aguas ARRIBA del tramo deficitario.
    Para EXCEDENTE: calcular reducción de apertura en la compuerta que alimenta ese tramo.
    Usa SIEMPRE la fórmula de compuerta con L_eff y datos reales de la escala.

  PASO 4 — Presentar tabla resumen:
    Km | Q_medido | Q_esperado | Diferencia | Estado | Acción

  PROHIBIDO:
  - Decir "no requiere ajuste" sin mostrar los números del balance.
  - Recomendar reducir apertura en el punto de origen (Km 0) cuando el problema es déficit aguas abajo.
  - Inventar números de compuertas (R7, R8…) que no están en los datos de Escalas.
  - Dar consejos genéricos si los datos operativos están disponibles.

- NUNCA le pidas al usuario datos que ya están disponibles en las secciones de Escalas, Presas o Perfil de Canal.
- NUNCA respondas "requiere datos adicionales" si esos datos están en el contexto. Si están, úsalos.
- AMBIGÜEDAD DE UNIDADES: En preguntas de traslado o tránsito, si el usuario dice "m³" sin contexto claro,
  ACLARA si se refiere a:
    (a) 1 m³/s — caudal adicional a sostener en ese tramo
    (b) 1 Mm³ (millón de m³) — volumen total a trasladar
    (c) 1 m³ — volumen puntual (inusual en operación de canal)
  Presenta la aclaración y luego resuelve el escenario más probable dado el contexto operativo.
- Si una pregunta menciona apertura de compuerta ("habrá Xcm", "abrir Xcm más", "apertura total"),
  ACLARA si el valor es apertura total o incremento antes de calcular. Si es ambiguo, presenta AMBOS escenarios.
- Si el Q calculado supera la capacidad del tramo aguas abajo, emite ADVERTENCIA CRÍTICA de desbordamiento.
- Usa los datos de Escalas provistos para ΔH real. NO inventes valores.
- Redondea resultados hidráulicos a 2 decimales.
- Si no hay datos operativos, infórmalo indicando que el ciclo puede estar en reinicio o que los sensores no reportan.`;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        console.log("--- Inicio Invocación Groq (Llama 3.3 70B) ---");

        if (!GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en los Secrets.");

        // Auth
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Acceso no autorizado (Falta token)");
        const token = authHeader.split(/\s+/)[1];

        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
            console.error("Auth Error:", authError);
            if (!token) throw new Error("Sesión inválida.");
        }

        console.log(`Usuario: ${user?.id || "Public/Operator"}`);

        // STAGE 2: Destructure contexto from request body
        const { message, conversation_id, contexto = "general" } = await req.json() as ChatRequest;

        // STAGE 3 (RAG interim): Broader keyword search instead of 20-char prefix
        let contextText = "";
        try {
            // Split message into significant keywords (>4 chars), search each independently
            const keywords = message
                .replace(/[¿?¡!.,;:]/g, " ")
                .split(/\s+/)
                .filter((w: string) => w.length > 4)
                .slice(0, 5); // top 5 keywords

            if (keywords.length > 0) {
                // Build OR filter: ilike for each keyword
                const filters = keywords.map((k: string) => `content.ilike.%${k}%`).join(",");
                const { data: chunks } = await supabaseAdmin
                    .from("hydric_document_chunks")
                    .select("content, metadata")
                    .or(filters)
                    .limit(4);

                if (chunks && chunks.length > 0) {
                    contextText = "\n\n=== INFORMACIÓN DE DOCUMENTOS TÉCNICOS ===\n" +
                        chunks.map((c: any) =>
                            `[Fuente: ${c.metadata?.source || "Documento"}]\n${c.content}`
                        ).join("\n---\n");
                }
            }
        } catch (e) {
            console.error("Error fetching RAG context:", e);
        }

        // Build system prompt with contexto
        const systemData = await fetchSystemData(supabaseAdmin);
        const systemPrompt = buildSystemPrompt(systemData, contexto) + contextText;

        // Conversation management
        let convId = conversation_id;
        if (!convId && user) {
            const { data: newConv, error: convError } = await supabaseAdmin
                .from("chat_conversations")
                .insert({ user_id: user.id, titulo: message.substring(0, 50), contexto })
                .select("id").single();

            if (convError) throw new Error(`DB Error (chat_conversations): ${convError.message}`);
            convId = newConv?.id;
        }

        if (convId) {
            const { error: msgError } = await supabaseAdmin
                .from("chat_messages")
                .insert({ conversation_id: convId, role: "user", content: message });
            if (msgError) throw new Error(`DB Error (chat_messages): ${msgError.message}`);
        }

        // STAGE 4: Increase history limit 8 → 15
        const { data: history } = convId
            ? await supabaseAdmin.from("chat_messages")
                .select("role, content")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: true })
                .limit(15)
            : { data: [] };

        const messages = [
            { role: "system", content: systemPrompt },
            ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
        ];

        if (!history?.some((h: any) => h.content === message)) {
            messages.push({ role: "user", content: message });
        }

        console.log(`Llamando a Groq API — modelo: ${AI_MODEL}, contexto: ${contexto}`);

        // STAGE 2+3: Higher token limit (1500→2500), lower temperature (0.5→0.3)
        const response = await fetch(AI_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages,
                temperature: 0.3,
                max_tokens: 6000,
                stream: false,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Groq Error Response:", errorText);
            throw new Error(`Groq API Error: ${response.status} — ${errorText}`);
        }

        const result = await response.json();
        const assistantMessage = result.choices[0]?.message?.content || "No pude generar una respuesta.";

        // Persist assistant response
        if (convId) {
            await supabaseAdmin.from("chat_messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: assistantMessage,
            });
            await supabaseAdmin.from("chat_conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", convId);
        }

        console.log("Respuesta generada con éxito.");

        return new Response(JSON.stringify({
            conversation_id: convId,
            message: assistantMessage,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (e: any) {
        console.error("DEBUG CRÍTICO (Edge Function):", e);

        let errorMessage = e.message || "Error desconocido en el motor de IA";
        if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
            errorMessage = "Autorización fallida en la API de Groq. Verifica GROQ_API_KEY en Supabase Secrets.";
        } else if (errorMessage.includes("404")) {
            errorMessage = `Modelo ${AI_MODEL} no encontrado en Groq.`;
        }

        return new Response(JSON.stringify({
            error: true,
            message: errorMessage,
            details: e.toString(),
        }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
