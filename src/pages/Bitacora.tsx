import { useState, useEffect } from 'react';
import { Save, Cloud, Droplet, Activity, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useFecha } from '../context/FechaContext';
import { toast } from 'sonner';

const CLIMA_OPTIONS = ['Soleado', 'Lluvia Ligera', 'Tormenta', 'Nublado', 'Viento Fuerte'];

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

    // Access Control
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

    const loadData = async () => {
        // Load Today's Presas
        const { data: presasData } = await supabase
            .from('presas')
            .select('*')
            .eq('fecha', fechaSeleccionada);

        if (presasData) {
            const boquilla = presasData.find(p => p.nombre_presa === 'La Boquilla');
            if (boquilla) {
                setBoquillaEscala(boquilla.escala?.toString() || '');
                setBoquillaExtraccion(boquilla.extraccion?.toString() || '');
                setBoquillaVolumen(boquilla.volumen_hm3?.toString() || '');
            } else {
                setBoquillaEscala(''); setBoquillaExtraccion(''); setBoquillaVolumen('');
            }

            const madero = presasData.find(p => p.nombre_presa === 'Francisco I. Madero');
            if (madero) {
                setMaderoEscala(madero.escala?.toString() || '');
                setMaderoExtraccion(madero.extraccion?.toString() || '');
                setMaderoVolumen(madero.volumen_hm3?.toString() || '');
            } else {
                setMaderoEscala(''); setMaderoExtraccion(''); setMaderoVolumen('');
            }
        }

        // Load Today's Clima
        const { data: climaData } = await supabase
            .from('clima')
            .select('*')
            .eq('fecha', fechaSeleccionada)
            .single();

        if (climaData) {
            setClimaDia(climaData.estado_general || 'Soleado');
            setEvaporacion(climaData.evaporacion_mm?.toString() || '');
            setPrecipitacion(climaData.precipitacion_mm?.toString() || '');
        } else {
            setClimaDia('Soleado'); setEvaporacion(''); setPrecipitacion('');
        }
    };

    useEffect(() => {
        loadData();
    }, [fechaSeleccionada]);

    const handleSave = async () => {
        setLoading(true);
        const dateStr = fechaSeleccionada;

        try {
            // Upsert Boquilla
            if (boquillaEscala || boquillaExtraccion || boquillaVolumen) {
                await supabase.from('presas').upsert({
                    nombre_presa: 'La Boquilla',
                    fecha: dateStr,
                    escala: parseFloat(boquillaEscala) || 0,
                    extraccion: parseFloat(boquillaExtraccion) || 0,
                    volumen_hm3: parseFloat(boquillaVolumen) || 0
                }, { onConflict: 'nombre_presa,fecha' });
            }

            // Upsert Madero
            if (maderoEscala || maderoExtraccion || maderoVolumen) {
                await supabase.from('presas').upsert({
                    nombre_presa: 'Francisco I. Madero',
                    fecha: dateStr,
                    escala: parseFloat(maderoEscala) || 0,
                    extraccion: parseFloat(maderoExtraccion) || 0,
                    volumen_hm3: parseFloat(maderoVolumen) || 0
                }, { onConflict: 'nombre_presa,fecha' });
            }

            // Upsert Clima
            await supabase.from('clima').upsert({
                fecha: dateStr,
                estado_general: climaDia,
                evaporacion_mm: parseFloat(evaporacion) || 0,
                precipitacion_mm: parseFloat(precipitacion) || 0
            }, { onConflict: 'fecha' });

            toast.success('Bitácora guardada exitosamente');

        } catch (error: any) {
            console.error('Error saving:', error);
            toast.error('Error al guardar: ' + error.message);
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
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-blue-500 transition-colors" placeholder="Almacenamiento Total" />
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
                                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 outline-none focus:border-cyan-500 transition-colors" placeholder="Almacenamiento Total" />
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
