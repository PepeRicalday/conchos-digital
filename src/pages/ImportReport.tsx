import React, { useState } from 'react';
import { Upload, FileText, Save, Wifi, WifiOff } from 'lucide-react';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';

// Mock DB Types (Same as designed) - Kept for reference but commented out to avoid linter errors
// interface DamReading { ... }
// interface WeatherReading { ... }

const ImportReport = () => {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'boquilla' | 'madero' | 'delicias'>('boquilla');

    // Offline Tracking
    const [isOnline, setIsOnline] = React.useState(navigator.onLine);
    const pendingCount = useLiveQuery(() => db.registros.where('sincronizado').equals('false').count(), []) || 0;

    React.useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            sincronizarPendientes();
        };
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const sincronizarPendientes = async () => {
        const pendientes = await db.registros.where({ sincronizado: 'false' }).toArray();
        if (pendientes.length === 0) return;

        console.log('Sincronizando', pendientes.length, 'registros con Supabase...');
        // Aquí iría el supabase.from('...').insert(...)

        await Promise.all(pendientes.map(p =>
            db.registros.update(p.id!, { sincronizado: true as any })
        ));
        alert(`${pendientes.length} Registros locales sincronizados a Supabase automáticamente.`);
    };

    // Form State (Simplified for Demo) - Placeholders for now
    /* const [boquillaData, setBoquillaData] = useState<DamReading & WeatherReading>({...}); */
    /* const [maderoData, setMaderoData] = useState<DamReading & WeatherReading>({...}); */

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        const mockPayload = {
            tipo: activeTab === 'delicias' ? 'clima' : 'presa' as 'clima' | 'presa',
            datos: { activo: activeTab, ts: Date.now() },
            fecha_captura: new Date().toISOString(),
            sincronizado: isOnline as any,
        };

        if (isOnline) {
            // await supabase.from('...').insert(...)
            alert("A) Conectado: Guardado en Supabase.");
        } else {
            mockPayload.sincronizado = 'false' as any; // Trick idb
            await db.registros.add(mockPayload);
            alert("B) Sin Conexión (Offline): Registro asegurado localmente. Se subirá al detectar señal.");
        }
    };

    return (
        <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
            {/* LEFT: Image Viewer (Source of Truth) */}
            <div className="w-1/2 h-full border-r border-slate-700 flex flex-col bg-slate-800/50">
                <header className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="font-bold flex items-center gap-2">
                        <FileText className="text-blue-400" />
                        Imagen del Reporte Oficial
                    </h2>
                    <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors">
                        <Upload size={14} />
                        Cargar Imagen / PDF
                        <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleImageUpload} />
                    </label>
                </header>
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900">
                    {imagePreview ? (
                        <img src={imagePreview} alt="Reporte Escaneado" className="max-w-full shadow-2xl border border-slate-600" />
                    ) : (
                        <div className="text-center text-slate-500 border-2 border-dashed border-slate-700 p-12 rounded-xl">
                            <Upload size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Sube una foto del reporte físico aquí<br />para comenzar la digitalización.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: Data Entry Form */}
            <div className="w-1/2 h-full flex flex-col">
                <header className="p-4 border-b border-slate-700 bg-slate-800 flex justify-between items-center">
                    <h2 className="font-bold text-lg mb-0 flex items-center gap-2">
                        Captura de Datos
                        <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-mono ${isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {isOnline ? 'ONLINE' : 'OFFLINE'}
                        </span>
                        {pendingCount > 0 && (
                            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Upload size={12} className="animate-bounce" /> {pendingCount} Pendientes
                            </span>
                        )}
                    </h2>
                    <div className="flex gap-2">
                        <TabButton id="boquilla" label="Presa Boquilla" active={activeTab} onClick={() => setActiveTab('boquilla')} />
                        <TabButton id="madero" label="Presa Madero" active={activeTab} onClick={() => setActiveTab('madero')} />
                        <TabButton id="delicias" label="Clima Delicias" active={activeTab} onClick={() => setActiveTab('delicias')} />
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <div className="max-w-xl mx-auto space-y-8">

                        {activeTab !== 'delicias' && (
                            <section>
                                <h3 className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-4 border-b border-blue-500/30 pb-1">
                                    Datos Hidráulicos (Presa)
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <InputGroup label="Escala (msnm)" placeholder="1302.68" />
                                    <InputGroup label="Almacenamiento (Mm³)" placeholder="1089.653" />
                                    <InputGroup label="Extracción Total (m³/s)" placeholder="45.0" />
                                    <InputGroup label="Vertedor (m³/s)" placeholder="0.0" />
                                </div>
                            </section>
                        )}

                        <section>
                            <h3 className="text-amber-400 text-xs font-bold uppercase tracking-widest mb-4 border-b border-amber-500/30 pb-1">
                                Datos Climatológicos ({activeTab.toUpperCase()})
                            </h3>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <InputGroup label="Temp. Ambiente (°C)" placeholder="8" />
                                <InputGroup label="Precipitación (mm)" placeholder="0" />
                                <InputGroup label="Temp. Máxima (°C)" placeholder="24" />
                                <InputGroup label="Temp. Mínima (°C)" placeholder="7" />
                                <InputGroup label="Evaporación (mm)" placeholder="4.70" />
                                <InputGroup label="Visibilidad" placeholder="4T" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <InputGroup label="Dirección Viento" placeholder="SE" />
                                <InputGroup label="Intensidad Viento" placeholder="Moderado" />
                            </div>
                            <div className="mt-4">
                                <label className="block text-xs uppercase text-slate-400 font-bold mb-1">Estado del Tiempo</label>
                                <select className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none">
                                    <option>Seleccionar...</option>
                                    <option>Soleado</option>
                                    <option>Medio Nublado</option>
                                    <option>Nublado</option>
                                    <option>Lluvia Ligera</option>
                                    <option>Frío</option>
                                    <option>Caluroso</option>
                                </select>
                            </div>
                        </section>

                    </div>
                </div>

                <footer className="p-4 border-t border-slate-700/50 bg-slate-800/50 backdrop-blur-sm flex justify-between items-center">
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        <p>Verifica visualmente contra el documento original.</p>
                    </div>
                    <button onClick={handleSave} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/40 border border-emerald-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0">
                        <Save size={16} />
                        Guardar Registro Oficial
                    </button>
                </footer>
            </div>
        </div>
    );
};

const TabButton = ({ id, label, active, onClick }: { id: string, label: string, active: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all border ${active === id
            ? 'bg-blue-600/20 border-blue-500 text-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
            }`}
    >
        {label}
    </button>
);

const InputGroup = ({ label, placeholder }: { label: string, placeholder: string }) => (
    <div className="group">
        <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1 tracking-wider transition-colors group-focus-within:text-blue-400">{label}</label>
        <div className="relative">
            <input
                type="number"
                placeholder={placeholder}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-md p-2.5 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono placeholder-slate-700 transition-all shadow-inner"
            />
        </div>
    </div>
);

export default ImportReport;
