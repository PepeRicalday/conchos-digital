import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const g = 9.81;

interface Params {
    q: number;
    km_inicio: number;
    km_fin: number;
    y_inicial?: number;
    dx?: number;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const { q, km_inicio, km_fin, y_inicial, dx = 100 } = await req.json() as Params;

        // Fetch geometry from DB
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: geometry, error } = await supabase
            .from("canal_geometria")
            .select("*")
            .gte("km", Math.min(km_inicio, km_fin))
            .lte("km", Math.max(km_inicio, km_fin))
            .order("km", { ascending: km_inicio < km_fin });

        if (error || !geometry || geometry.length === 0) {
            // Default Geometry if DB is empty for initial testing
            return new Response(JSON.stringify({ error: "No geometry found in DB" }), { status: 404, headers: corsHeaders });
        }

        let y = y_inicial || geometry[0].tirante_diseno_y || 2.4;
        let x = km_inicio;
        const profile = [];
        let totalTimeSeconds = 0;

        // Standard Step Loop (Simple version)
        for (let i = 0; i < geometry.length - 1; i++) {
            const sec1 = geometry[i];
            const sec2 = geometry[i+1];
            const L = Math.abs(sec2.km - sec1.km) * 1000; // Meters
            
            // 1. Calculate Section 1 Properties
            const A1 = (sec1.ancho_plantilla_b + sec1.talud_z * y) * y;
            const P1 = sec1.ancho_plantilla_b + 2 * y * Math.sqrt(1 + sec1.talud_z ** 2);
            const R1 = A1 / P1;
            const v1 = q / A1;
            const H1 = y + v1**2 / (2*g);
            const Sf1 = (sec1.manning_n * v1 / (R1**(2/3)))**2;

            // 2. Iterate for Section 2 y (y2)
            // Simplified: we'll use a small increment for demonstration or direct Step calculation
            // H2 + Sf_avg * L = H1 + S0 * L
            // For now, let's assume Manning flow if no structures
            const S0 = sec1.pendiente_s0;
            const Sf_avg = Sf1; // Approximation
            const dy = (S0 - Sf_avg) * L;
            
            y = Math.max(0.1, y + dy);
            const v_avg = v1; // Approx
            totalTimeSeconds += L / v_avg;

            profile.push({
                km: sec2.km,
                y: parseFloat(y.toFixed(3)),
                v: parseFloat(v1.toFixed(3)),
                h_total: parseFloat(H1.toFixed(3))
            });
        }

        return new Response(JSON.stringify({
            q,
            transit_time_seconds: totalTimeSeconds,
            transit_time_formatted: new Date(totalTimeSeconds * 1000).toISOString().substr(11, 8),
            profile
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: corsHeaders });
    }
});
