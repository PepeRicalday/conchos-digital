import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_PROMPT = `Analiza esta imagen de un formulario "Aforo por Molinete - Método de Dobelas" y extrae TODOS los datos que puedas identificar.

Devuelve ÚNICAMENTE un objeto JSON válido con la siguiente estructura (usa null para valores que no puedas leer claramente):

{
  "punto_control": "identificador del punto de control, ej: K 1+000",
  "fecha": "fecha en formato YYYY-MM-DD",
  "hora_inicio": "hora de inicio en formato HH:MM",
  "hora_fin": "hora de fin en formato HH:MM",
  "escala_inicial": número decimal de la escala inicial en metros,
  "escala_final": número decimal de la escala final en metros,
  "molinete_modelo": "modelo del molinete, ej: ROSSBACH_PRICE",
  "molinete_serie": "número de serie del molinete",
  "aforador": "nombre completo del aforador",
  "tirante_m": número decimal del tirante en metros,
  "plantilla_m": número decimal de la plantilla en metros,
  "espejo_m": número decimal del espejo de agua en metros,
  "area_total_m2": número decimal del área total en metros cuadrados,
  "gasto_total_m3s": número decimal del gasto total en metros cúbicos por segundo,
  "velocidad_media_ms": número decimal de la velocidad media en metros por segundo,
  "dobelas": [
    {
      "numero": número entero de la dobela,
      "base_m": número decimal del ancho de la dobela en metros,
      "tirante_m": número decimal del tirante en la dobela en metros,
      "revoluciones": número entero de revoluciones del molinete,
      "lecturas": [
        { "tiempo_s": número entero del tiempo en segundos }
      ]
    }
  ]
}

Instrucciones importantes:
- Extrae TODAS las dobelas visibles en el formulario.
- Para cada dobela, incluye TODAS las lecturas de tiempo disponibles (generalmente 3 lecturas).
- Si un valor numérico no es legible con claridad, usa null.
- Si un campo de texto no es legible, usa null.
- NO incluyas explicaciones ni texto adicional, SOLO el objeto JSON.
- Asegúrate de que el JSON sea válido y bien formado.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método no permitido. Use POST." }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let body: { image_base64?: string; media_type?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Cuerpo de solicitud inválido. Se esperaba JSON." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const { image_base64, media_type } = body;

    if (!image_base64 || typeof image_base64 !== "string") {
      return new Response(
        JSON.stringify({ error: "Campo 'image_base64' requerido y debe ser string." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!media_type || typeof media_type !== "string") {
      return new Response(
        JSON.stringify({ error: "Campo 'media_type' requerido y debe ser string (ej: 'image/jpeg')." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validMediaTypes.includes(media_type)) {
      return new Response(
        JSON.stringify({ error: `Tipo de medio '${media_type}' no soportado. Use: ${validMediaTypes.join(", ")}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: media_type,
                  data: image_base64,
                },
              },
              {
                type: "text",
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Error de Anthropic API:", anthropicResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Error al llamar a Anthropic API: ${anthropicResponse.status} ${errorText}` }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicResponse.json();

    const rawText: string = anthropicData?.content?.[0]?.text ?? "";

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "Anthropic API no devolvió contenido de texto." }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
    let jsonText = rawText.trim();
    const codeBlockMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    let extractedObject: unknown;
    try {
      extractedObject = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Error al parsear JSON de Anthropic:", parseError, "\nTexto recibido:", rawText);
      return new Response(
        JSON.stringify({
          error: "No se pudo parsear la respuesta de Anthropic como JSON válido.",
          raw_response: rawText,
        }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ data: extractedObject }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error inesperado:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Error interno del servidor: ${message}` }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
