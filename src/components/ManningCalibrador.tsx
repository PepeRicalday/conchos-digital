import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { FlaskConical, CheckCircle, AlertTriangle, XCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useManningCalibration, type ResultadoCalibPunto, type ConfianzaNivel } from '../hooks/useManningCalibration';

// ─── Constantes visuales ──────────────────────────────────────────────────────

const ESTADO_STYLE = {
    ok:        { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  label: 'Conforme',   Icon: CheckCircle  },
    atencion:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: 'Atención',   Icon: Info         },
    revision:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'Revisión',   Icon: AlertTriangle },
    critico:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Crítico',    Icon: XCircle      },
};

const CONFIANZA_LABEL: Record<ConfianzaNivel, string> = {
    alta:         '≥10 aforos',
    media:        '5–9 aforos',
    baja:         '2–4 aforos',
    insuficiente: '1 aforo',
};

// ─── Subcomponente: fila de la tabla ─────────────────────────────────────────

const FilaCalib = ({ r, onApply }: { r: ResultadoCalibPunto; onApply: (r: ResultadoCalibPunto) => void }) => {
    const [expanded, setExpanded] = useState(false);
    const st = ESTADO_STYLE[r.estado];
    const Icon = st.Icon;
    const signoPct = r.delta_pct >= 0 ? '+' : '';

    return (
        <>
            <tr
                className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer"
                onClick={() => setExpanded(e => !e)}
            >
                {/* Punto */}
                <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Icon size={12} style={{ color: st.color }} />
                        <span className="text-[11px] font-bold text-white">{r.nombre_punto}</span>
                    </div>
                </td>

                {/* n diseño */}
                <td className="px-4 py-3 text-center font-mono text-[11px] text-slate-400">
                    {r.n_diseno.toFixed(4)}
                </td>

                {/* n calibrado */}
                <td className="px-4 py-3 text-center">
                    <span className="font-mono text-[12px] font-bold" style={{ color: st.color }}>
                        {r.n_calibrado.toFixed(4)}
                    </span>
                </td>

                {/* Delta */}
                <td className="px-4 py-3 text-center">
                    <span
                        className="text-[11px] font-black font-mono px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: st.bg, color: st.color }}
                    >
                        {signoPct}{r.delta_pct.toFixed(1)}%
                    </span>
                </td>

                {/* Muestras / Confianza */}
                <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[11px] font-black text-white">{r.n_muestras}</span>
                        <span className="text-[8px] font-bold text-slate-500 uppercase">{CONFIANZA_LABEL[r.confianza]}</span>
                    </div>
                </td>

                {/* Estado */}
                <td className="px-4 py-3 text-center">
                    <span
                        className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md"
                        style={{ backgroundColor: st.bg, color: st.color }}
                    >
                        {st.label}
                    </span>
                </td>

                {/* Acción */}
                <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                        {r.estado !== 'ok' && r.confianza !== 'insuficiente' && (
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onApply(r); }}
                                className="text-[9px] font-black uppercase px-2 py-1 rounded-md border transition-all hover:opacity-80 active:scale-95"
                                style={{ borderColor: st.color, color: st.color }}
                            >
                                Aplicar
                            </button>
                        )}
                        {expanded ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                    </div>
                </td>
            </tr>

            {/* Fila expandida: distribución de n ──────────────────────────── */}
            {expanded && (
                <tr className="border-b border-white/5 bg-slate-950/50">
                    <td colSpan={7} className="px-6 py-4">
                        <div className="flex gap-8 flex-wrap text-[10px]">
                            <div>
                                <span className="text-slate-500 font-bold uppercase tracking-widest block mb-1">Estadísticas</span>
                                <div className="flex gap-4 font-mono text-slate-300">
                                    <span>Media: <strong className="text-white">{r.n_media.toFixed(4)}</strong></span>
                                    <span>σ: <strong className="text-white">{r.n_std.toFixed(4)}</strong></span>
                                    <span>S₀ usado: <strong className="text-white">{r.s0_usado.toExponential(2)}</strong></span>
                                </div>
                            </div>
                            <div>
                                <span className="text-slate-500 font-bold uppercase tracking-widest block mb-1">Distribución n ({r.valores_n.length} valores)</span>
                                <div className="flex gap-1 items-end h-8">
                                    {(() => {
                                        const min = Math.min(...r.valores_n);
                                        const max = Math.max(...r.valores_n);
                                        const range = max - min || 0.001;
                                        return r.valores_n.map((v, i) => (
                                            <div
                                                key={i}
                                                className="w-1.5 rounded-t-[1px]"
                                                style={{
                                                    height: `${Math.max(10, ((v - min) / range) * 100)}%`,
                                                    backgroundColor: st.color,
                                                    opacity: 0.7
                                                }}
                                                title={v.toFixed(4)}
                                            />
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};

// ─── Modal de confirmación ────────────────────────────────────────────────────

const ConfirmModal = ({
    item,
    onConfirm,
    onCancel,
    saving,
}: {
    item: ResultadoCalibPunto;
    onConfirm: () => void;
    onCancel: () => void;
    saving: boolean;
}) => (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in duration-200">
            <div className="p-6 border-b border-white/5 bg-gradient-to-r from-amber-600/20 to-orange-600/20">
                <h3 className="text-lg font-black text-white flex items-center gap-2 uppercase tracking-tighter">
                    <FlaskConical className="text-amber-400" size={20} />
                    Aplicar Calibración Manning
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">{item.nombre_punto}</p>
            </div>
            <div className="p-6 space-y-4">
                <div className="bg-slate-950/50 rounded-xl p-4 font-mono text-sm space-y-2">
                    <div className="flex justify-between">
                        <span className="text-slate-400">n actual (diseño):</span>
                        <span className="text-white font-bold">{item.n_diseno.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">n calibrado (mediana):</span>
                        <span className="text-amber-400 font-bold">{item.n_calibrado.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-2 mt-2">
                        <span className="text-slate-400">Cambio:</span>
                        <span className="font-black" style={{ color: ESTADO_STYLE[item.estado].color }}>
                            {item.delta_pct >= 0 ? '+' : ''}{item.delta_pct.toFixed(1)}%
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">Basado en:</span>
                        <span className="text-white">{item.n_muestras} aforos de campo</span>
                    </div>
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                    Esto actualizará <code className="text-amber-400">rugosidad_n</code> en{' '}
                    <code className="text-amber-400">perfil_hidraulico_canal</code> para el punto "{item.nombre_punto}".
                    El ModelingDashboard y los cálculos de Paso Estándar usarán el nuevo valor en su próxima ejecución.
                </p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-xs font-black text-slate-400 uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={saving}
                    className="flex-1 px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-amber-900/40 transition-all active:scale-95 disabled:opacity-50"
                >
                    {saving ? 'Aplicando...' : 'Confirmar'}
                </button>
            </div>
        </div>
    </div>
);

// ─── Componente principal ─────────────────────────────────────────────────────

export const ManningCalibrador = () => {
    const { resultados, loading, error, ultima_actualizacion } = useManningCalibration(90);
    const [pendingApply, setPendingApply] = useState<ResultadoCalibPunto | null>(null);
    const [saving, setSaving] = useState(false);

    const handleApply = async () => {
        if (!pendingApply) return;

        // Requiere km_punto para filtrar solo el tramo correspondiente.
        // Evita actualizar rugosidad_n globalmente en todo el canal.
        if (pendingApply.km_punto === null) {
            toast.error(
                `No se puede determinar el km de "${pendingApply.nombre_punto}". ` +
                'Incluye el chainage en el nombre del punto (ej. "K-23 Derivadora").'
            );
            return;
        }

        setSaving(true);
        try {
            // Actualiza solo el tramo del perfil que contiene el km del punto calibrado.
            const { error: updateErr } = await supabase
                .from('perfil_hidraulico_canal')
                .update({ rugosidad_n: pendingApply.n_calibrado })
                .lte('km_inicio', pendingApply.km_punto)
                .gte('km_fin',    pendingApply.km_punto);

            if (updateErr) throw updateErr;
            toast.success(
                `n calibrado aplicado: ${pendingApply.n_calibrado.toFixed(4)} ` +
                `en tramo que contiene K${pendingApply.km_punto} (${pendingApply.nombre_punto})`
            );
            setPendingApply(null);
        } catch (err: any) {
            toast.error('Error al aplicar calibración: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest animate-pulse">
                    Procesando aforos de campo ({90} días)...
                </span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center gap-2 py-8 text-red-400">
                <XCircle size={14} />
                <span className="text-xs font-bold">Error al cargar aforos: {error}</span>
            </div>
        );
    }

    if (resultados.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-600">
                <FlaskConical size={32} />
                <p className="text-xs font-bold uppercase tracking-widest">Sin aforos de campo en los últimos 90 días</p>
                <p className="text-[10px] text-slate-700 text-center max-w-sm">
                    Registra aforos desde SICA Capture (método de dobles o vadeo) para
                    habilitar la calibración automática de Manning.
                </p>
            </div>
        );
    }

    const conforme   = resultados.filter(r => r.estado === 'ok').length;
    const desviados  = resultados.length - conforme;

    return (
        <>
            {pendingApply && (
                <ConfirmModal
                    item={pendingApply}
                    onConfirm={handleApply}
                    onCancel={() => setPendingApply(null)}
                    saving={saving}
                />
            )}

            {/* KPIs resumen */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-950/50 rounded-xl p-3 border border-white/5">
                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Puntos analizados</p>
                    <p className="text-2xl font-black text-white font-mono mt-1">{resultados.length}</p>
                </div>
                <div className="bg-emerald-950/30 rounded-xl p-3 border border-emerald-900/30">
                    <p className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">Conformes (Δ &lt;5%)</p>
                    <p className="text-2xl font-black text-emerald-400 font-mono mt-1">{conforme}</p>
                </div>
                <div className="bg-amber-950/30 rounded-xl p-3 border border-amber-900/30">
                    <p className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Requieren revisión</p>
                    <p className="text-2xl font-black text-amber-400 font-mono mt-1">{desviados}</p>
                </div>
            </div>

            {/* Tabla */}
            <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-white/10 bg-slate-950/80">
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">Punto de Control</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">n Diseño</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">n Calibrado</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Δ%</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Muestras</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Estado</th>
                            <th className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        {resultados.map(r => (
                            <FilaCalib key={r.punto_control_id} r={r} onApply={setPendingApply} />
                        ))}
                    </tbody>
                </table>
            </div>

            {ultima_actualizacion && (
                <p className="text-[8px] text-slate-700 mt-3 text-right font-mono">
                    Calculado: {new Date(ultima_actualizacion).toLocaleString('es-MX')} · Ventana: 90 días
                </p>
            )}
        </>
    );
};

export default ManningCalibrador;
