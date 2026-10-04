import { useState, useEffect } from 'react';
import { Save, Cloud, Droplet, Activity, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useFecha } from '../context/FechaContext';
import { toast } from 'sonner';

const CLIMA_OPTIONS = ['Soleado', 'Lluvia Ligera', 'Tormenta', 'Nublado', 'Viento Fuerte'];
const PRESA_BOQUILLA = 'PRE-001';
const PRESA_MADERO = 'PRE-002';

export default function Bitacora() {
    const { profile } = useAuth();
    const { fechaSeleccionada } = useFecha();
    const [loading, setLoading] = useState(false);

    // Form States
    const [boquillaEscala, setBoquillaEscala] = useState('');
    const [boquillaExtraccion, setBoquillaExtraccion] = useState('');
    const [boquillaVolumen, setBoquillaVolumen] = useState('');

    const [maderoEscala, setMaderoEscala] = useState('');
    const [maderoExtraccion, setMaderoExtraccion] = useState('');
    const [maderoVolumen, setMaderoVolumen] = useState('');

    const [climaDia, setClimaDia] = useState('Soleado');
    const [evaporacion, setEvaporacion] = useState('');
    const [precipitacion, setPrecipitacion] = useState('');

    // Tablas reales: lecturas_presas (escala/almacenamiento/extracción por presa y día) y
    // clima_presas (clima por presa y día). Antes apuntaba a `presas.fecha` y `clima`, que no
    // existen: la carga fallaba (400/404) y el guardado "tenía éxito" sin escribir nada.
    const loadData = async () => {
        const { data: lect, error: errLect } = await supabase
            .from('lecturas_presas')
            .select('presa_id, escala_msnm, almacenamiento_mm3, extraccion_total_m3s')
            .eq('fecha', fechaSeleccionada)
            .in('presa_id', [PRESA_BOQUILLA, PRESA_MADERO]);
        if (errLect) { toast.error('No se pudieron cargar las presas: ' + errLect.message); return; }

        const fmt = (v: number | null | undefined) => (v == null ? '' : String(v));
        const boquilla = lect?.find(p => p.presa_id === PRESA_BOQUILLA);
        setBoquillaEscala(fmt(boquilla?.escala_msnm));
        setBoquillaExtraccion(fmt(boquilla?.extraccion_total_m3s));
        setBoquillaVolumen(fmt(boquilla?.almacenamiento_mm3));
        const madero = lect?.find(p => p.presa_id === PRESA_MADERO);
        setMaderoEscala(fmt(madero?.escala_msnm));
        setMaderoExtraccion(fmt(madero?.extraccion_total_m3s));
        setMaderoVolumen(fmt(madero?.almacenamiento_mm3));

        const { data: clima, error: errClima } = await supabase
            .from('clima_presas')
            .select('presa_id, edo_tiempo, evaporacion_mm, precipitacion_mm')
            .eq('fecha', fechaSeleccionada)
            .in('presa_id', [PRESA_BOQUILLA, PRESA_MADERO]);
        if (errClima) { toast.error('No se pudo cargar la climatología: ' + errClima.message); return; }
        const c = clima?.find(x => x.presa_id === PRESA_BOQUILLA) ?? clima?.[0];
        setClimaDia(c?.edo_tiempo || 'Soleado');
        setEvaporacion(fmt(c?.evaporacion_mm));
        setPrecipitacion(fmt(c?.precipitacion_mm));
    };

    useEffect(() => {
        if (profile?.rol === 'SRL') {
            loadData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fechaSeleccionada, profile?.rol]);

    // Access Control — MUST be after all hooks
    if (profile?.rol !== 'SRL') {
        return (
            <div className="flex h-full items-center justify-center p-8">
                <div className="card text-center max-w-md">
                    <AlertTriangle size={48} className="mx-auto text-yellow-500 mb-4" />
                    <h2 className="text-xl font-bold mb-2">Acceso Denegado</h2>
                    <p className="text-slate-400">
                        La captura de Bitácora Hidrometeorológica es exclusiva para el personal administrativo de la S.R.L. Unidad Conchos.
                    </p>
                </div>
            </div>
        );
    }

    // Número válido o undefined (campo vacío = NO tocar ese dato, nunca guardar 0 por omisión).
    const num = (v: string) => { const n = parseFloat(v); return v.trim() !== '' && Number.isFinite(n) ? n : undefined; };

    // Inserta o actualiza SOLO los campos capturados (la clave natural es presa_id+fecha; el id
    // es texto sin default, por eso no se usa upsert: reescribiría el id de la fila existente).
    const guardarFila = async (tabla: 'lecturas_presas' | 'clima_presas', presaId: string, campos: Record<string, unknown>) => {
        const limpios = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
        if (Object.keys(limpios).length === 0) return;
        const { data: existe, error: errSel } = await supabase
            .from(tabla).select('id').eq('presa_id', presaId).eq('fecha', fechaSeleccionada).maybeSingle();
        if (errSel) throw new Error(`${tabla}: ${errSel.message}`);
        const { error } = existe
            ? await supabase.from(tabla).update(limpios).eq('id', existe.id)
            : await supabase.from(tabla).insert({ id: crypto.randomUUID(), presa_id: presaId, fecha: fechaSeleccionada, ...limpios });
        if (error) throw new Error(`${tabla}: ${error.message}`);
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            const resp = profile?.nombre ?? 'Bitácora SRL';
            await guardarFila('lecturas_presas', PRESA_BOQUILLA, {
                escala_msnm: num(boquillaEscala), extraccion_total_m3s: num(boquillaExtraccion),
                almacenamiento_mm3: num(boquillaVolumen), responsable: resp,
            });
            await guardarFila('lecturas_presas', PRESA_MADERO, {
                escala_msnm: num(maderoEscala), extraccion_total_m3s: num(maderoExtraccion),
                almacenamiento_mm3: num(maderoVolumen), responsable: resp,
            });
            // Climatología del distrito: se registra para ambas presas.
            for (const presaId of [PRESA_BOQUILLA, PRESA_MADERO]) {
                await guardarFila('clima_presas', presaId, {
                    edo_tiempo: climaDia, evaporacion_mm: num(evaporacion), precipitacion_mm: num(precipitacion),
                });
            }
            toast.success('Bitácora guardada exitosamente');
            await loadData(); // releer lo realmente persistido
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('Error saving:', error);
            toast.error('NO se guardó la bitácora: ' + msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6 fade-in h-[calc(100vh-80px)] overflow-auto pb-20">
            <header className="mb-6">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <Activity className="text-blue-500" />
                    Bitácora Oficina (S.R.L.)
                </h1>
                <p className="text-slate-400 mt-2">
                    Ingresa las métricas diarias oficiales para el Reporte Hidrometeorológico de {fechaSeleccionada}.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* PRESA LA BOQUILLA */}
                <div className="card space-y-4 shadow-lg border-t-4 border-t-blue-500">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Droplet className="text-blue-400" /> Presa La Boquilla
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Escala (m)</label>
                            <input type="number" step="0.01" value={boquillaEscala} onChange={e => setBoquillaEscala(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors" placeholder="1302.50" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Extracción (m³/s)</label>
                            <input type="number" step="0.1" value={boquillaExtraccion} onChange={e => setBoquillaExtraccion(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors" placeholder="35.0" />
                        </div>
                        <div className="space-y-1 col-span-2">
                            <label className="text-xs text-slate-400 font-bold uppercase">Volumen Actual (Mm³)</label>
                            <input type="number" step="0.01" value={boquillaVolumen} onChange={e => setBoquillaVolumen(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors" placeholder="Almacenamiento total" />
                        </div>
                    </div>
                </div>

                {/* PRESA FRANCISCO I MADERO */}
                <div className="card space-y-4 shadow-lg border-t-4 border-t-cyan-500">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Droplet className="text-cyan-400" /> Presa Francisco I. Madero
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Escala (m)</label>
                            <input type="number" step="0.01" value={maderoEscala} onChange={e => setMaderoEscala(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors" placeholder="1225.30" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Extracción (m³/s)</label>
                            <input type="number" step="0.1" value={maderoExtraccion} onChange={e => setMaderoExtraccion(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors" placeholder="15.0" />
                        </div>
                        <div className="space-y-1 col-span-2">
                            <label className="text-xs text-slate-400 font-bold uppercase">Volumen Actual (Mm³)</label>
                            <input type="number" step="0.01" value={maderoVolumen} onChange={e => setMaderoVolumen(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors" placeholder="Almacenamiento total" />
                        </div>
                    </div>
                </div>

                {/* CLIMA DISTRITO */}
                <div className="card space-y-4 shadow-lg border-t-4 border-t-amber-500 lg:col-span-2">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Cloud className="text-amber-400" /> Climatología (Vaso de Presa / Distrito)
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Estado General</label>
                            <select value={climaDia} onChange={e => setClimaDia(e.target.value)} className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-amber-500 transition-colors text-white">
                                {CLIMA_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Evaporación (mm)</label>
                            <input type="number" step="0.1" value={evaporacion} onChange={e => setEvaporacion(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-amber-500 transition-colors" placeholder="ej. 5.2" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs text-slate-400 font-bold uppercase">Precipitación (mm)</label>
                            <input type="number" step="0.1" value={precipitacion} onChange={e => setPrecipitacion(e.target.value)}
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-amber-500 transition-colors" placeholder="ej. 0.0" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800">
                <button
                    onClick={handleSave}
                    disabled={loading}
                    className="btn btn-primary px-8 py-3 text-lg flex items-center gap-2 shadow-lg shadow-blue-500/20"
                >
                    {loading ? <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" /> : <Save size={20} />}
                    Guardar Oficialmente
                </button>
            </div>

        </div>
    );
}
