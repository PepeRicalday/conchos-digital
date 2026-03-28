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
  "escala_inicial": 2.56,
  "escala_final": 2.56,
  "molinete_modelo": "modelo del molinete, ej: ROSSBACH_PRICE",
  "molinete_serie": "número de serie del molinete",
  "aforador": "nombre completo del aforador",
  "tirante_m": 2.56,
  "plantilla_m": 13.30,
  "espejo_m": 22.20,
  "area_total_m2": 45.440,
  "gasto_total_m3s": 29.161,
  "velocidad_media_ms": 0.6328,
  "dobelas": [
    {
      "numero": 1,
      "base_m": 4.34,
      "tirante_m": 2.56,
      "revoluciones": 30,
      "lecturas": [
        { "tiempo_s": 41 },
        { "tiempo_s": 42 },
        { "tiempo_s": 41 }
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
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY no configurada." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let body: { image_base64?: string; media_type?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Cuerpo de solicitud inválido. Se esperaba JSON." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const { image_base64, media_type } = body;

    if (!image_base64 || typeof image_base64 !== "string") {
      return new Response(
        JSON.stringify({ error: "Campo 'image_base64' requerido." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const finalMediaType = (media_type && validMediaTypes.includes(media_type))
      ? media_type
      : "image/jpeg";

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: finalMediaType,
                data: image_base64
              }
            },
            {
              text: EXTRACTION_PROMPT
            }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.1
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Error Gemini API:", geminiResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Gemini ${geminiResponse.status}: ${errorText}` }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "Gemini no devolvió contenido de texto." }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    let jsonText = rawText.trim();
    const codeBlockMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    let extractedObject: unknown;
    try {
      extractedObject = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Error al parsear JSON:", parseError, "\nTexto:", rawText);
      return new Response(
        JSON.stringify({ error: "No se pudo parsear la respuesta como JSON.", raw_response: rawText }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
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
      JSON.stringify({ error: `Error interno: ${message}` }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
