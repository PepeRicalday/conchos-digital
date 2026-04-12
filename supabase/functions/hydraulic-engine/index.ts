import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const G = 9.81;

// ── TIPOS ────────────────────────────────────────────────────────────────────
interface Params {
    q:          number;          // Caudal presa (m³/s)
    km_inicio?: number;          // default 0
    km_fin?:    number;          // default 104
    y_inicial?: number;          // Tirante condición frontera aguas arriba
    tomas?:     { km: number; q_m3s: number }[];  // extracciones activas
    // Para IEC
    eficiencia?:   number;       // % presa→K104 (de coherencia)
    n_coherentes?: number;
    total_puntos?: number;
    q_fuga_total?: number;
    escalas_criticas?: number;
    total_escalas?: number;
}

interface Tramo {
    km_inicio: number;
    km_fin:    number;
    plantilla_m: number;
    talud_z:   number;
    rugosidad_n: number;
    pendiente_s0: number;
    tirante_diseno_m: number;
    bordo_libre_m: number;
    capacidad_diseno_m3s: number | null;
}

interface FGVStep {
    km:         number;
    y:          number;
    q:          number;
    v:          number;
    fr:         number;
    sf:         number;
    energia:    number;
    remanso:    "M1" | "M2" | "NORMAL";
    pct_bordo:  number;
    alerta:     boolean;
    critico:    boolean;
}

interface IECResult {
    iec:       number;
    semaforo:  "VERDE" | "AMARILLO" | "ROJO";
    p_eficiencia: number;
    p_coherencia: number;
    p_fugas:   number;
    p_criticos: number;
    texto:     string;
}

// ── HIDRÁULICA ───────────────────────────────────────────────────────────────
function secProps(b: number, z: number, y: number) {
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    const T = b + 2 * z * y;
    const R = A / P;
    return { A, P, T, R };
}

function normalDepth(Q: number, S0: number, b: number, z: number, n: number): number {
    if (Q <= 0) return 0.1;
    let y = Math.max(0.2, Q / (b * 1.5));
    for (let i = 0; i < 60; i++) {
        const { A, P, R } = secProps(b, z, y);
        const Qc = (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S0);
        if (Math.abs(Qc - Q) < 0.001) break;
        const dA = b + 2 * z * y;
        const dP = 2 * Math.sqrt(1 + z * z);
        const dR = (dA * P - A * dP) / (P * P);
        const dQ = (1 / n) * Math.sqrt(S0) * (dA * Math.pow(R, 2/3) + A * (2/3) * Math.pow(R, -1/3) * dR);
        if (Math.abs(dQ) < 1e-10) break;
        y = Math.max(0.05, y - (Qc - Q) / dQ);
    }
    return y;
}

function criticalDepth(Q: number, b: number, z: number): number {
    if (Q <= 0) return 0.1;
    let y = Math.max(0.1, Q / (b * 2));
    for (let i = 0; i < 60; i++) {
        const { A, T } = secProps(b, z, y);
        const F  = Q * Q * T - G * A * A * A;
        const dF = Q * Q * 2 * z - 3 * G * A * A * (b + 2 * z * y);
        if (Math.abs(F) < 0.001 || Math.abs(dF) < 1e-10) break;
        y = Math.max(0.05, y - F / dF);
    }
    return y;
}

function froude(b: number, z: number, y: number, Q: number): number {
    const { A, T } = secProps(b, z, y);
    const v = Q / Math.max(A, 0.001);
    return v / Math.sqrt(G * Math.max(A / Math.max(T, 0.001), 0.001));
}

function energiaEspecifica(b: number, z: number, y: number, Q: number): number {
    const { A } = secProps(b, z, y);
    const v = Q / Math.max(A, 0.001);
    return y + v * v / (2 * G);
}

function sfManning(b: number, z: number, n: number, y: number, Q: number): number {
    const { A, R } = secProps(b, z, y);
    const v = Q / Math.max(A, 0.001);
    return Math.pow(n * v / Math.pow(Math.max(R, 0.001), 2/3), 2);
}

// Resolver y2 mediante el Método del Paso Estándar (Newton-Raphson)
// H1 + S0*L = H2 + Sf_avg*L  →  H2 - H1 - (S0 - Sf_avg)*L = 0
function stepStandard(
    y1: number, Q: number,
    b1: number, z1: number, n1: number, S01: number,
    b2: number, z2: number, n2: number,
    L: number  // longitud del paso en metros
): number {
    const H1  = energiaEspecifica(b1, z1, y1, Q);
    const Sf1 = sfManning(b1, z1, n1, y1, Q);
    const S0  = S01;

    // Estimación inicial: Manning en sección 2
    let y2 = normalDepth(Q, S01, b2, z2, n2);
    y2 = Math.max(0.05, y2);

    for (let i = 0; i < 50; i++) {
        const H2  = energiaEspecifica(b2, z2, y2, Q);
        const Sf2 = sfManning(b2, z2, n2, y2, Q);
        const Sf_avg = (Sf1 + Sf2) / 2;
        // F(y2) = H2 + Sf_avg*L - H1 - S0*L = 0
        const F = H2 + Sf_avg * L - H1 - S0 * L;
        // dF/dy2 ≈ dH2/dy2 + (dSf2/dy2)*L  (aproximación numérica)
        const dy = 1e-4;
        const H2p  = energiaEspecifica(b2, z2, y2 + dy, Q);
        const Sf2p = sfManning(b2, z2, n2, y2 + dy, Q);
        const dF = (H2p + ((Sf1 + Sf2p)/2) * L - H1 - S0 * L - F) / dy;
        if (Math.abs(dF) < 1e-12) break;
        const y2new = y2 - F / dF;
        if (Math.abs(y2new - y2) < 0.0001) { y2 = y2new; break; }
        y2 = Math.max(0.05, y2new);
    }
    return y2;
}

// ── IEC — Índice de Estado del Canal (0–100) ─────────────────────────────────
function calcIEC(
    eficiencia:     number,
    nCoherentes:    number,
    totalPuntos:    number,
    qFugaTotal:     number,
    qEntrada:       number,
    escalasCriticas: number,
    totalEscalas:   number,
): IECResult {
    const p_ef  = Math.min(30, Math.max(0, (eficiencia / 100) * 30));
    const p_coh = totalPuntos > 0
        ? Math.min(25, Math.max(0, (nCoherentes / totalPuntos) * 25))
        : 25;
    const fracFuga = qEntrada > 0 ? qFugaTotal / qEntrada : 0;
    const p_fugas  = Math.min(25, Math.max(0, 25 * (1 - Math.min(1, fracFuga))));
    const fracCrit = totalEscalas > 0 ? escalasCriticas / totalEscalas : 0;
    const p_crit   = Math.min(20, Math.max(0, 20 * (1 - fracCrit)));

    const iec = Math.round(p_ef + p_coh + p_fugas + p_crit);
    const semaforo: "VERDE" | "AMARILLO" | "ROJO" =
        iec >= 75 ? "VERDE" : iec >= 50 ? "AMARILLO" : "ROJO";
    const texto = iec >= 75
        ? "Sistema operando normalmente"
        : iec >= 50
        ? "Sistema con anomalías — monitoreo reforzado"
        : "Sistema en condición crítica — acción inmediata requerida";

    return { iec, semaforo, p_eficiencia: Math.round(p_ef * 10) / 10, p_coherencia: Math.round(p_coh * 10) / 10, p_fugas: Math.round(p_fugas * 10) / 10, p_criticos: Math.round(p_crit * 10) / 10, texto };
}

// ── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const params = await req.json() as Params;
        const {
            q,
            km_inicio = 0,
            km_fin    = 104,
            y_inicial,
            tomas     = [],
        } = params;

        const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Cargar geometría real desde perfil_hidraulico_canal
        const { data: tramos, error: geoErr } = await supabase
            .from("perfil_hidraulico_canal")
            .select("km_inicio, km_fin, plantilla_m, talud_z, rugosidad_n, pendiente_s0, tirante_diseno_m, bordo_libre_m, capacidad_diseno_m3s")
            .eq("nombre_tramo", "CANAL PRINCIPAL CONCHOS")
            .gte("km_fin", km_inicio)
            .lte("km_inicio", km_fin)
            .order("km_inicio", { ascending: true });

        if (geoErr || !tramos || tramos.length === 0) {
            return new Response(
                JSON.stringify({ error: "Sin geometría en perfil_hidraulico_canal para el tramo solicitado" }),
                { status: 404, headers: corsHeaders }
            );
        }

        // 2. Condición de frontera aguas arriba
        const t0 = tramos[0] as Tramo;
        let y = y_inicial ?? normalDepth(q, t0.pendiente_s0, t0.plantilla_m, t0.talud_z, t0.rugosidad_n);

        // 3. Resolver FGV tramo a tramo — Paso Estándar iterativo
        const profile: FGVStep[] = [];
        let qCur = q;
        let totalTransitSec = 0;

        // Punto inicial
        profile.push(buildStep(km_inicio, y, qCur, t0));

        for (let i = 0; i < tramos.length; i++) {
            const t = tramos[i] as Tramo;

            // Descontar tomas en este tramo
            const qTomas = tomas
                .filter(d => d.km > t.km_inicio && d.km <= t.km_fin)
                .reduce((s, d) => s + d.q_m3s, 0);
            const qSalida = Math.max(0.5, qCur - qTomas);

            // Siguiente tramo geometría
            const tNext = (tramos[i + 1] as Tramo) ?? t;
            const L = (t.km_fin - t.km_inicio) * 1000; // metros

            // Paso estándar hacia aguas abajo
            const y2 = stepStandard(
                y, qSalida,
                t.plantilla_m, t.talud_z, t.rugosidad_n, t.pendiente_s0,
                tNext.plantilla_m, tNext.talud_z, tNext.rugosidad_n,
                Math.max(1, L)
            );

            // Tiempo de tránsito en el tramo (v_onda empírica Canal Conchos)
            const v_onda_ms = (5.3 * Math.pow(Math.max(qSalida, 1), 0.15)) / 3.6;
            totalTransitSec += L / Math.max(v_onda_ms, 0.1);

            qCur = qSalida;
            y = y2;

            profile.push(buildStep(t.km_fin, y, qCur, t));
        }

        // 4. Calcular IEC si se pasan los parámetros
        let iec: IECResult | null = null;
        if (params.eficiencia !== undefined) {
            iec = calcIEC(
                params.eficiencia      ?? 0,
                params.n_coherentes    ?? 0,
                params.total_puntos    ?? 0,
                params.q_fuga_total    ?? 0,
                q,
                params.escalas_criticas ?? 0,
                params.total_escalas   ?? 1,
            );
        }

        // 5. Métricas globales
        const yMin = Math.min(...profile.map(p => p.y));
        const yMax = Math.max(...profile.map(p => p.y));
        const alertas = profile.filter(p => p.alerta).map(p => ({ km: p.km, y: p.y, pct_bordo: p.pct_bordo }));
        const criticos = profile.filter(p => p.critico).map(p => ({ km: p.km, y: p.y, remanso: p.remanso }));

        return new Response(JSON.stringify({
            q_entrada: q,
            q_salida:  qCur,
            eficiencia_conduccion: q > 0 ? Math.round((qCur / q) * 1000) / 10 : null,
            transit_time_seconds:  Math.round(totalTransitSec),
            transit_time_h:        Math.round(totalTransitSec / 360) / 10,
            km_inicio, km_fin,
            tramos_calculados: tramos.length,
            profile,
            y_min: Math.round(yMin * 1000) / 1000,
            y_max: Math.round(yMax * 1000) / 1000,
            alertas,
            criticos,
            iec,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
    }
});

// ── HELPER ───────────────────────────────────────────────────────────────────
function buildStep(km: number, y: number, Q: number, t: Tramo): FGVStep {
    const { A }   = secProps(t.plantilla_m, t.talud_z, y);
    const v       = Q / Math.max(A, 0.001);
    const fr      = froude(t.plantilla_m, t.talud_z, y, Q);
    const sf      = sfManning(t.plantilla_m, t.talud_z, t.rugosidad_n, y, Q);
    const energia = energiaEspecifica(t.plantilla_m, t.talud_z, y, Q);
    const yn      = normalDepth(Q, t.pendiente_s0, t.plantilla_m, t.talud_z, t.rugosidad_n);
    const remanso: "M1" | "M2" | "NORMAL" = y > yn + 0.05 ? "M1" : y < yn - 0.05 ? "M2" : "NORMAL";
    const profundidadTotal = t.tirante_diseno_m + t.bordo_libre_m;
    const pct_bordo = profundidadTotal > 0 ? Math.round((y / profundidadTotal) * 1000) / 10 : 0;
    return {
        km:        Math.round(km * 1000) / 1000,
        y:         Math.round(y * 1000) / 1000,
        q:         Math.round(Q * 100) / 100,
        v:         Math.round(v * 1000) / 1000,
        fr:        Math.round(fr * 1000) / 1000,
        sf:        Math.round(sf * 1e6) / 1e6,
        energia:   Math.round(energia * 1000) / 1000,
        remanso,
        pct_bordo,
        alerta:    pct_bordo >= 75 && pct_bordo < 92,
        critico:   pct_bordo >= 92,
    };
}
