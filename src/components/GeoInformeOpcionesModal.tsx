import { useEffect, useState } from 'react';
import { X, MapPin, Thermometer, Wind, Sun, CloudRain, Check, Calendar, Users, FlaskConical } from 'lucide-react';
import type { OpcionesGeoInforme } from '../utils/exportClimaGeoInforme';
import { getTodayString, addDays } from '../utils/dateHelpers';

interface GeoInformeOpcionesModalProps {
    abierto: boolean;
    onCerrar: () => void;
    onConfirmar: (opciones: OpcionesGeoInforme) => void;
}

// Acento por variable — mismos tonos que ya identifican cada magnitud en el
// resto de Clima.tsx (naranja=temperatura en quick-stat, azul=precipitación,
// verde=evapotranspiración/aire). La radiación solar toma ámbar (sol) para no
// repetir el naranja de temperatura. Son valores fijos (no clases Tailwind
// "-primary"/"-accent": esos tokens no existen en el tema de Tailwind v4 de
// este proyecto — sin un bloque @theme que los declare, cualquier utilidad
// que los use ("text-primary", "bg-primary/15", "border-primary/50") no
// genera CSS y queda inerte; se verificó en runtime con getComputedStyle
// antes de este cambio: el ícono, el botón "Generar informe" y el estado
// activo de estos chips no mostraban ningún color pese a esas clases).
const VARIABLES_UI: Array<{
    clave: OpcionesGeoInforme['variables'][number];
    label: string;
    Icono: typeof Thermometer;
    color: string;
    bg: string;
    border: string;
}> = [
    { clave: 'tempC', label: 'Temperatura', Icono: Thermometer, color: '#fb923c', bg: 'rgba(251,146,60,0.14)', border: 'rgba(251,146,60,0.45)' },
    { clave: 'vientoMs', label: 'Viento', Icono: Wind, color: '#38bdf8', bg: 'rgba(56,189,248,0.14)', border: 'rgba(56,189,248,0.45)' },
    { clave: 'radSolarWm2', label: 'Radiación solar', Icono: Sun, color: '#fbbf24', bg: 'rgba(251,191,36,0.14)', border: 'rgba(251,191,36,0.45)' },
    { clave: 'lluviaDiaMm', label: 'Precipitación', Icono: CloudRain, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.45)' },
];

/**
 * Modal previo a la descarga del Informe Geoclimático: elegir qué variables
 * incluir (evita archivos innecesariamente grandes/largos cuando solo
 * interesa una) y qué periodo analizar. Por defecto el periodo es "Todo el
 * histórico": el mapa y todos los apartados usan el corte actual (última
 * lectura), igual que antes. Si se fija un rango (mismo patrón de
 * input+presets que TendenciasPanel.tsx), todo el informe — mapas, KPIs,
 * veredicto, tablas — pasa a mostrar el agregado de ese periodo, y cada
 * bloque de variable añade el desglose mes a mes dentro del rango (ver
 * generarGeoInforme en Clima.tsx y climaResumenMensual.ts). Mismo patrón que
 * WindyMapModal.tsx: componente controlado por `abierto`, Escape cierra,
 * scroll del body bloqueado mientras está abierto.
 */
export function GeoInformeOpcionesModal({ abierto, onCerrar, onConfirmar }: GeoInformeOpcionesModalProps) {
    // Simple por defecto: la mayoría de quienes generan este informe son
    // personal de campo/gerencia, no auditores de datos — el detalle técnico
    // completo (badges MEDIDO/INTERPOLADO, distancias IDW en km, cobertura de
    // muestras, tabla de estaciones) sigue existiendo íntegro en modo Técnico
    // y en el acordeón de metodología de ambos modos, nunca se pierde, solo
    // deja de ser lo primero que ve alguien que no lo necesita (pedido del
    // usuario 2026-09-16: la subtabla de precipitación con 3 columnas
    // numéricas y ceros repetidos era ilegible para personal no técnico).
    const [modoTecnico, setModoTecnico] = useState(false);
    const [variables, setVariables] = useState<Set<OpcionesGeoInforme['variables'][number]>>(
        new Set(['tempC', 'vientoMs', 'radSolarWm2', 'lluviaDiaMm']),
    );
    // null = "Todo el histórico" (comportamiento actual, sin filtro de
    // periodo) — mismo significado que "sin rango" en el resto del informe.
    const [periodo, setPeriodo] = useState<{ desde: string; hasta: string } | null>(null);

    useEffect(() => {
        if (!abierto) return;
        const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        document.addEventListener('keydown', alPulsar);
        const overflowPrevio = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', alPulsar);
            document.body.style.overflow = overflowPrevio;
        };
    }, [abierto, onCerrar]);

    if (!abierto) return null;

    const alternarVariable = (clave: OpcionesGeoInforme['variables'][number]) => {
        setVariables(prev => {
            const next = new Set(prev);
            if (next.has(clave)) {
                // Nunca dejar la selección vacía: un informe sin ningún mapa no
                // tiene sentido — se ignora el intento de deseleccionar la última.
                if (next.size > 1) next.delete(clave);
            } else {
                next.add(clave);
            }
            return next;
        });
    };

    const presetDias = (dias: number) => {
        const hasta = getTodayString();
        setPeriodo({ desde: addDays(hasta, -dias), hasta });
    };

    // "Hoy": desde = hasta = hoy, un rango de un solo día — sigue el mismo
    // camino de periodo explícito que 7d/30d/90d (estacionesDesdeResumenRango
    // en Clima.tsx), no el atajo de "todo el histórico" con el contador de
    // consola: para un solo día, el acumulado reconstruido desde la BD y la
    // lectura real coinciden, así que no hay divergencia que resolver aquí.
    const presetHoy = () => {
        const hoy = getTodayString();
        setPeriodo({ desde: hoy, hasta: hoy });
    };
    const esHoy = !!periodo && periodo.desde === getTodayString() && periodo.hasta === getTodayString();

    const confirmar = () => {
        if (!variables.size) return;
        onConfirmar({
            variables: Array.from(variables),
            periodoDesde: periodo?.desde,
            periodoHasta: periodo?.hasta,
            modoTecnico,
        });
        onCerrar();
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
            style={{ padding: 16 }}
            onClick={onCerrar}
            role="presentation"
        >
            <div
                className="glass-card shadow-2xl w-full max-w-xl border-white/10"
                style={{ padding: 0, overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Opciones del Informe Geoclimático"
            >
                {/* Línea de acento superior, mismo lenguaje que .station-card::before
                    en Clima.css (halo + línea degradada) para emparentar visualmente
                    el modal con el resto del módulo. */}
                <div style={{ height: 3, background: 'linear-gradient(90deg, #38bdf8, #3b82f6 45%, transparent)' }} />

                <div style={{ padding: '20px 28px 16px' }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 18 }}>
                        <div className="flex items-center" style={{ gap: 14 }}>
                            <div
                                className="flex items-center justify-center"
                                style={{
                                    width: 42, height: 42, borderRadius: 12, flex: 'none',
                                    background: 'linear-gradient(140deg, #38bdf8, #2563eb)',
                                    boxShadow: '0 6px 18px -6px rgba(37,99,235,0.6)',
                                }}
                            >
                                <MapPin size={20} color="#fff" />
                            </div>
                            <div>
                                <h2 className="font-black text-white uppercase" style={{ fontSize: 16, letterSpacing: '0.04em', margin: 0 }}>
                                    Informe Geoclimático
                                </h2>
                                <p className="font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.18em', color: '#64748b', margin: '2px 0 0' }}>
                                    Elige qué incluir
                                </p>
                            </div>
                        </div>
                        <button
                            className="hover:bg-slate-800 transition-colors"
                            style={{ padding: 8, background: 'rgba(15,23,42,0.9)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}
                            onClick={onCerrar}
                            title="Cerrar"
                        >
                            <X size={16} className="text-slate-400" />
                        </button>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>
                            Nivel de detalle
                        </p>
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {([
                                { valor: false, label: 'Simple', Icono: Users, desc: 'KPIs, mapas y gráficas — para todo el personal' },
                                { valor: true, label: 'Técnico', Icono: FlaskConical, desc: 'Añade procedencia, distancias y cobertura de cada dato' },
                            ] as const).map(({ valor, label, Icono, desc }) => {
                                const activo = modoTecnico === valor;
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => setModoTecnico(valor)}
                                        className="flex items-center transition-colors"
                                        style={{
                                            gap: 10,
                                            padding: '10px 12px',
                                            borderRadius: 12,
                                            border: `1px solid ${activo ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.10)'}`,
                                            background: activo ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.02)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                        aria-pressed={activo}
                                    >
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 28, height: 28, borderRadius: 8, flex: 'none',
                                                background: activo ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <Icono size={14} color={activo ? '#0f172a' : '#64748b'} />
                                        </span>
                                        <span style={{ flex: 1 }}>
                                            <span
                                                className="font-semibold block"
                                                style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#64748b' }}
                                            >
                                                {label}
                                            </span>
                                            <span style={{ fontSize: 9.5, color: '#64748b', display: 'block', marginTop: 1, lineHeight: 1.3 }}>
                                                {desc}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>
                            Variables a incluir
                        </p>
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {VARIABLES_UI.map(({ clave, label, Icono, color, bg, border }) => {
                                const activo = variables.has(clave);
                                return (
                                    <button
                                        key={clave}
                                        type="button"
                                        onClick={() => alternarVariable(clave)}
                                        className="flex items-center transition-colors"
                                        style={{
                                            gap: 10,
                                            padding: '10px 12px',
                                            borderRadius: 12,
                                            border: `1px solid ${activo ? border : 'rgba(255,255,255,0.10)'}`,
                                            background: activo ? bg : 'rgba(255,255,255,0.02)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                        aria-pressed={activo}
                                    >
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 28, height: 28, borderRadius: 8, flex: 'none',
                                                background: activo ? color : 'rgba(255,255,255,0.06)',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <Icono size={14} color={activo ? '#0f172a' : '#64748b'} />
                                        </span>
                                        <span
                                            className="font-semibold"
                                            style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#64748b', flex: 1 }}
                                        >
                                            {label}
                                        </span>
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 18, height: 18, borderRadius: '50%', flex: 'none',
                                                border: `1.5px solid ${activo ? color : 'rgba(255,255,255,0.18)'}`,
                                                background: activo ? color : 'transparent',
                                            }}
                                        >
                                            {activo && <Check size={12} color="#0f172a" strokeWidth={3} />}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <p style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                            Cada variable incluye el mapa del corte (o del periodo elegido abajo) y su evolución mensual (promedio; acumulado en precipitación). Menos variables = archivo más ligero.
                        </p>
                    </div>

                    <div style={{ marginBottom: 4 }}>
                        <p className="font-bold uppercase flex items-center" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px', gap: 6 }}>
                            <Calendar size={13} /> Periodo del informe
                        </p>
                        <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 10 }}>
                            <button
                                type="button"
                                onClick={() => setPeriodo(null)}
                                className="font-semibold transition-colors"
                                style={{
                                    padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                    border: `1px solid ${!periodo ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                    background: !periodo ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.03)',
                                    color: !periodo ? '#7dd3fc' : '#94a3b8',
                                }}
                            >
                                Todo el histórico
                            </button>
                            <button
                                type="button"
                                onClick={presetHoy}
                                className="font-semibold transition-colors"
                                style={{
                                    padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                    border: `1px solid ${esHoy ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                    background: esHoy ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.03)',
                                    color: esHoy ? '#7dd3fc' : '#94a3b8',
                                }}
                            >
                                Hoy
                            </button>
                            {[7, 30, 90].map(dias => (
                                <button
                                    key={dias}
                                    type="button"
                                    onClick={() => presetDias(dias)}
                                    className="font-semibold transition-colors"
                                    style={{
                                        padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                        border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: '#94a3b8',
                                    }}
                                >
                                    {dias} d
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
                            <label className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#94a3b8' }}>
                                Desde
                                <input
                                    type="date"
                                    value={periodo?.desde ?? ''}
                                    max={periodo?.hasta ?? getTodayString()}
                                    onChange={e => setPeriodo({ desde: e.target.value, hasta: periodo?.hasta ?? getTodayString() })}
                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(15,23,42,0.9)', color: '#f1f5f9', fontSize: 11.5 }}
                                />
                            </label>
                            <label className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#94a3b8' }}>
                                Hasta
                                <input
                                    type="date"
                                    value={periodo?.hasta ?? ''}
                                    min={periodo?.desde}
                                    max={getTodayString()}
                                    onChange={e => setPeriodo({ desde: periodo?.desde ?? e.target.value, hasta: e.target.value })}
                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(15,23,42,0.9)', color: '#f1f5f9', fontSize: 11.5 }}
                                />
                            </label>
                        </div>
                        <p style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                            {periodo
                                ? 'El informe mostrará el promedio (o acumulado, en precipitación) global del rango elegido, además del desglose mes a mes dentro de ese rango.'
                                : 'Todo el histórico: el informe mostrará el promedio (o acumulado, en precipitación) desde el primer dato de la red hasta hoy — no solo la lectura del día en que se genera.'}
                        </p>
                    </div>
                </div>

                <div
                    className="flex justify-end"
                    style={{ gap: 8, padding: '14px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}
                >
                    <button
                        type="button"
                        onClick={onCerrar}
                        className="font-semibold hover:text-slate-300 transition-colors"
                        style={{ padding: '9px 16px', borderRadius: 10, fontSize: 12, color: '#94a3b8' }}
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={confirmar}
                        className="font-bold transition-colors whitespace-nowrap"
                        style={{
                            padding: '9px 18px', borderRadius: 10, fontSize: 12, color: '#fff',
                            background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                            boxShadow: '0 6px 18px -6px rgba(37,99,235,0.55)',
                        }}
                    >
                        Generar informe
                    </button>
                </div>
            </div>
        </div>
    );
}
