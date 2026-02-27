import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
    const { method } = req;

    if (method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        // 1. Instanciar Supabase Client usando Service Role (para bypass RLS en tareas programadas)
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

        console.log(`[Chronos] Ejecutando Continuidad Diaria (Midnight Rollover)...`);

        // Llamar a la función RPC que inyecta la medición 'continua' de las 00:00
        const { error: rpcError } = await supabaseAdmin.rpc('fn_generar_continuidad_diaria');

        if (rpcError) {
            console.error("[Chronos] Error al ejecutar fn_generar_continuidad_diaria:", rpcError);
            throw rpcError;
        }

        console.log(`[Chronos] fn_generar_continuidad_diaria ejecutada con éxito.`);

        const data = {
            success: true,
            cron_job: "generate-daily-report trigger",
            message: "Reporte Chronos Task procesado exitosamente. Continuidad de medianoche aplicada.",
            timestamp: new Date().toISOString()
        };

        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500
        });
    }
});
