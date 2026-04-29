import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_PROMPT = `Analiza esta imagen de un formulario "Aforo por Molinete - Método de Dobelas" y extrae TODOS los datos con máxima fidelidad al documento físico.

Devuelve ÚNICAMENTE un objeto JSON válido con la siguiente estructura (usa null para valores que no puedas leer claramente):

{
  "punto_control": "identificador exacto del punto, ej: K 1+000",
  "fecha": "fecha en formato YYYY-MM-DD",
  "hora_inicio": "hora de inicio en formato HH:MM",
  "hora_fin": "hora de fin en formato HH:MM",
  "escala_inicial": 2.19,
  "escala_final": 2.19,
  "molinete_modelo": "modelo completo tal como aparece, ej: ROSSBACH_PRICE",
  "molinete_numero": "número o serie del molinete, ej: 73201",
  "aforador": "nombre completo del aforador si aparece",
  "tirante_m": 2.19,
  "plantilla_m": 13.30,
  "espejo_m": 20.96,
  "profundidad_total_m": 3.93,
  "borde_libre_m": 1.97,
  "area_total_m2": 37.509,
  "gasto_total_m3s": 22.801,
  "velocidad_promedio_ms": 0.5937,
  "coef_molinete": 0.70,
  "dobelas": [
    {
      "numero": 1,
      "base_m": 3.73,
      "tirante_m": 2.19,
      "area_m2": 4.079,
      "n_revoluciones": 30,
      "velocidad_media_ms": 0.4670,
      "gasto_m3s": 1.905,
      "lecturas": [
        {
          "lectura_raw": "46/40",
          "tiempo_s": 46,
          "tiempo_s_alt": 40,
          "velocidad_ms": 0.456
        },
        {
          "lectura_raw": "45",
          "tiempo_s": 45,
          "tiempo_s_alt": null,
          "velocidad_ms": 0.467
        },
        {
          "lectura_raw": "44",
          "tiempo_s": 44,
          "tiempo_s_alt": null,
          "velocidad_ms": 0.478
        }
      ]
    }
  ]
}

INSTRUCCIONES CRÍTICAS:
1. Extrae TODAS las dobelas visibles — no omitas ninguna.
2. Para "lectura_raw": copia EXACTAMENTE el texto impreso incluyendo formato "X/Y" cuando aparezcan dos números separados por barra (ej: "46/40", "57/52"). Esto indica dos tiempos en una misma lectura.
3. Para "tiempo_s": usa el PRIMER número de la notación "X/Y" como tiempo principal.
4. Para "tiempo_s_alt": usa el SEGUNDO número de "X/Y" si existe, null si la lectura es un solo número.
5. Para "velocidad_ms" por lectura: si aparece en el formulario úsalo; si no, calcula V = coef × (n_revoluciones / tiempo_s) donde coef usualmente es 0.70.
6. Para "n_revoluciones": cada dobela puede tener un número diferente de revoluciones (ej V1=30, V2=40, V5=45). Léelo de la columna "# Revoluciones" de la tabla molinete.
7. Preserva todos los valores numéricos con sus decimales exactos tal como aparecen.
8. NO incluyas texto adicional ni explicaciones — SOLO el objeto JSON válido.`;


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
