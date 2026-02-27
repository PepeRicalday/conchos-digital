import React, { useState, useEffect } from 'react';
import { Upload, FileText, Save, Wifi, WifiOff, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ImportReport = () => {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'boquilla' | 'madero' | 'delicias'>('boquilla');
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [saving, setSaving] = useState(false);

    // Initial constants
    const AREAS = {
        boquilla: 8020.088,
        madero: 2748.303,
    };

    const CAPACIDAD_TOTAL = {
        boquilla: 2846.782,
        madero: 333.320,
    };

    const ELEVACION = {
        boquilla: 1317.00,
        madero: 1239.30,
    };

    // State for all 3 entities
    const [formData, setFormData] = useState<any>({
        boquilla: {
            // Presa
            escala: '', almacenamiento: '', t_baja: '', cfe: '', extraccion_total: 'Cerrada', porcentaje: '',
            // Clima
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            // 24h
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            // Aforo
            aforo_escala: '', aforo_gasto: ''
        },
        madero: {
            escala: '', almacenamiento: '', toma_izq: '', toma_der: '', extraccion_total: 'Cerrada', porcentaje: '',
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            aforo_escala: '', aforo_gasto: ''
        },
        delicias: {
            temp_ambiente: '', temp_maxima: '', temp_minima: '', precipitacion: '', evaporacion: '', dir_viento: '', intensidad: '', visibilidad: '', edo_tiempo: '',
            edo_tiempo_24h: '', dir_viento_24h: '', intensidad_24h: '',
            aforo_escala: '', aforo_gasto: ''
        }
    });

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const handleChange = (tab: string, field: string, value: any) => {
        setFormData((prev: any) => ({
            ...prev,
            [tab]: {
                ...prev[tab],
                [field]: value
            }
        }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const data = formData[activeTab];
            const presaIdMap: Record<string, string> = { boquilla: 'PRE-001', madero: 'PRE-002', delicias: 'PRE-003' };
            const presaId = presaIdMap[activeTab];
            const today = new Date().toISOString().split('T')[0];

            // 1. Save Hydraulic Data (Only for dams)
            if (activeTab !== 'delicias') {
                const extraccion = isNaN(Number(data.extraccion_total)) ? 0 : Number(data.extraccion_total);
                const { error: errPresa } = await supabase.from('lecturas_presas').upsert({
                    presa_id: presaId,
                    fecha: today,
                    escala_msnm: Number(data.escala) || null,
                    almacenamiento_mm3: Number(data.almacenamiento) || null,
                    porcentaje_llenado: Number(data.porcentaje) || null,
                    extraccion_total_m3s: extraccion,
                    gasto_toma_baja_m3s: activeTab === 'boquilla' ? (Number(data.t_baja) || null) : null,
                    gasto_cfe_m3s: activeTab === 'boquilla' ? (Number(data.cfe) || null) : null,
                    gasto_toma_izq_m3s: activeTab === 'madero' ? (Number(data.toma_izq) || null) : null,
                    gasto_toma_der_m3s: activeTab === 'madero' ? (Number(data.toma_der) || null) : null,
                    notas: isNaN(Number(data.extraccion_total)) ? `Extracción: ${data.extraccion_total}` : null
                }, { onConflict: 'presa_id, fecha' });
                if (errPresa) throw errPresa;
            }

            // 2. Save Weather Data
            const precip = data.precipitacion === 'Ø' || data.precipitacion === '0' || data.precipitacion === '' ? 0 : Number(data.precipitacion);
            const { error: errClima } = await supabase.from('clima_presas').upsert({
                presa_id: presaId,
                fecha: today,
                temp_ambiente_c: Number(data.temp_ambiente) || null,
                temp_maxima_c: Number(data.temp_maxima) || null,
                temp_minima_c: Number(data.temp_minima) || null,
                precipitacion_mm: isNaN(precip) ? null : precip,
                evaporacion_mm: Number(data.evaporacion) || null,
                dir_viento: data.dir_viento || null,
                intensidad_viento: data.intensidad || null,
                visibilidad: data.visibilidad || null,
                edo_tiempo: data.edo_tiempo || null,
                edo_tiempo_24h: data.edo_tiempo_24h || null,
                dir_viento_24h: data.dir_viento_24h || null,
                intensidad_24h: data.intensidad_24h || null
            }, { onConflict: 'presa_id, fecha' });
            if (errClima) throw errClima;

            // 3. Save Aforo Data
            const estacionMap: Record<string, string> = { boquilla: 'Km 0+580', madero: 'Km 106', delicias: 'Km 104' };
            const estacion = estacionMap[activeTab];

            if (data.aforo_escala || data.aforo_gasto) {
                const { error: errAforo } = await supabase.from('aforos_principales_diarios').upsert({
                    fecha: today,
                    estacion: estacion,
                    escala: Number(data.aforo_escala) || null,
                    gasto_m3s: Number(data.aforo_gasto) || null
                }, { onConflict: 'fecha, estacion' });
                if (errAforo) throw errAforo;
            }

            alert(`Captura Oficial (${activeTab.toUpperCase()}) Guardada Correctamente en la Nube.`);
        } catch (error: any) {
            alert('Error guardando: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const EDO_TIEMPO_OPTIONS = ["Soleado", "Medio Nublado", "Nublado", "Lluvia Ligera", "Frío", "Caluroso"];
    const currentData = formData[activeTab];

    return (
        <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
            {/* LEFT: Image Viewer */}
            <div className="w-1/2 h-full border-r border-slate-700 flex flex-col bg-slate-800/50">
                <header className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h2 className="font-bold flex items-center gap-2 text-white">
                        <FileText className="text-blue-400" />
                        Imagen del Reporte Oficial CONAGUA
                    </h2>
                    <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors">
                        <Upload size={14} />
                        Cargar Imagen
                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </label>
                </header>
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900 border-4 border-slate-800 m-4 rounded-xl relative">
                    {imagePreview ? (
                        <img src={imagePreview} alt="Reporte Escaneado" className="max-w-full shadow-2xl border border-slate-600" />
                    ) : (
                        <div className="text-center text-slate-500">
                            <Upload size={48} className="mx-auto mb-4 opacity-30" />
                            <p>Sube el reporte físico aquí<br />para tenerlo de referencia visual.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: Data Entry Form */}
            <div className="w-1/2 h-full flex flex-col">
                <header className="p-4 border-b border-slate-700 bg-slate-800 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h2 className="font-bold text-lg mb-0 flex items-center gap-2">
                            Captura de Datos Oficiales
                            <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 font-mono ${isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                        </h2>
                    </div>
                    <div className="flex bg-slate-900/50 p-1 rounded-lg">
                        <TabButton id="boquilla" label="Presa Boquilla" active={activeTab} onClick={() => setActiveTab('boquilla')} />
                        <TabButton id="madero" label="Presa Fco. I. Madero" active={activeTab} onClick={() => setActiveTab('madero')} />
                        <TabButton id="delicias" label="Delicias" active={activeTab} onClick={() => setActiveTab('delicias')} />
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <div className="max-w-2xl mx-auto space-y-6">

                        {/* DATOS HIDRAULICOS (Solo Presas) */}
                        {activeTab !== 'delicias' && (
                            <section className="bg-slate-800/30 p-4 rounded-xl border border-slate-700">
                                <h3 className="text-blue-400 text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                    Datos Hidráulicos
                                </h3>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <InputGroup label="Escala (m.s.n.m)" value={currentData.escala} onChange={(v: any) => handleChange(activeTab, 'escala', v)} placeholder={ELEVACION[activeTab].toString()} />
                                    <InputGroup label="Almacenamiento (Mm³)" value={currentData.almacenamiento} onChange={(v: any) => handleChange(activeTab, 'almacenamiento', v)} />
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    {activeTab === 'boquilla' ? (
                                        <>
                                            <InputGroup label="T. Baja" value={currentData.t_baja} onChange={(v: any) => handleChange(activeTab, 't_baja', v)} type="text" placeholder="--" />
                                            <InputGroup label="C.F.E." value={currentData.cfe} onChange={(v: any) => handleChange(activeTab, 'cfe', v)} type="text" placeholder="--" />
                                        </>
                                    ) : (
                                        <>
                                            <InputGroup label="Toma Izq. #1" value={currentData.toma_izq} onChange={(v: any) => handleChange(activeTab, 'toma_izq', v)} type="text" placeholder="--" />
                                            <InputGroup label="Toma Der. #2" value={currentData.toma_der} onChange={(v: any) => handleChange(activeTab, 'toma_der', v)} type="text" placeholder="--" />
                                        </>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <InputGroup label="Extracción Total (m³/Seg)" value={currentData.extraccion_total} onChange={(v: any) => handleChange(activeTab, 'extraccion_total', v)} type="text" />
                                    <InputGroup label="Porcentaje (%)" value={currentData.porcentaje} onChange={(v: any) => handleChange(activeTab, 'porcentaje', v)} />
                                </div>
                            </section>
                        )}

                        {/* CLIMA */}
                        <section className="bg-slate-800/30 p-4 rounded-xl border border-slate-700">
                            <h3 className="text-amber-400 text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                Datos Climatológicos
                            </h3>
                            <div className="grid grid-cols-3 gap-4 mb-4">
                                <InputGroup label="Temp. Ambiente (°C)" value={currentData.temp_ambiente} onChange={(v: any) => handleChange(activeTab, 'temp_ambiente', v)} />
                                <InputGroup label="Temp. Máxima (°C)" value={currentData.temp_maxima} onChange={(v: any) => handleChange(activeTab, 'temp_maxima', v)} />
                                <InputGroup label="Temp. Mínima (°C)" value={currentData.temp_minima} onChange={(v: any) => handleChange(activeTab, 'temp_minima', v)} />
                            </div>
                            <div className="grid grid-cols-3 gap-4 mb-4">
                                <InputGroup label="Precipitación (mm)" value={currentData.precipitacion} onChange={(v: any) => handleChange(activeTab, 'precipitacion', v)} type="text" placeholder="Ø" />
                                <InputGroup label="Evaporación (mm)" value={currentData.evaporacion} onChange={(v: any) => handleChange(activeTab, 'evaporacion', v)} />
                                <InputGroup label="Dir. Viento" value={currentData.dir_viento} onChange={(v: any) => handleChange(activeTab, 'dir_viento', v)} type="text" placeholder="SE" />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <InputGroup label="Intensidad Viento" value={currentData.intensidad} onChange={(v: any) => handleChange(activeTab, 'intensidad', v)} type="text" placeholder="--" />
                                <InputGroup label="Visibilidad" value={currentData.visibilidad} onChange={(v: any) => handleChange(activeTab, 'visibilidad', v)} type="text" placeholder="4T" />
                                <SelectGroup label="Edo. del Tiempo" value={currentData.edo_tiempo} onChange={(v: any) => handleChange(activeTab, 'edo_tiempo', v)} options={EDO_TIEMPO_OPTIONS} />
                            </div>
                        </section>

                        {/* 24 HORAS ANTERIORES */}
                        <section className="bg-slate-800/30 p-4 rounded-xl border border-slate-700">
                            <h3 className="text-purple-400 text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                24 Horas Anteriores
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                <SelectGroup label="Edo. del Tiempo" value={currentData.edo_tiempo_24h} onChange={(v: any) => handleChange(activeTab, 'edo_tiempo_24h', v)} options={EDO_TIEMPO_OPTIONS} />
                                <InputGroup label="Dir. Viento" value={currentData.dir_viento_24h} onChange={(v: any) => handleChange(activeTab, 'dir_viento_24h', v)} type="text" placeholder="SE" />
                                <InputGroup label="Intensidad" value={currentData.intensidad_24h} onChange={(v: any) => handleChange(activeTab, 'intensidad_24h', v)} type="text" placeholder="--" />
                            </div>
                        </section>

                        {/* AFOROS */}
                        <section className="bg-slate-800/30 p-4 rounded-xl border border-slate-700">
                            <h3 className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                Aforos Principales ({activeTab === 'boquilla' ? 'Km 0+580' : activeTab === 'madero' ? 'Km 106' : 'Km 104'})
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <InputGroup label="Escala" value={currentData.aforo_escala} onChange={(v: any) => handleChange(activeTab, 'aforo_escala', v)} type="text" />
                                <InputGroup label="Gasto (m³/Seg)" value={currentData.aforo_gasto} onChange={(v: any) => handleChange(activeTab, 'aforo_gasto', v)} type="text" />
                            </div>
                        </section>

                        {/* Constantes Informativas */}
                        {activeTab !== 'delicias' && (
                            <section className="bg-slate-900/50 p-4 rounded-xl border border-dashed border-slate-700 mt-8 mb-4">
                                <h4 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2 text-center">Datos Constantes Oficiales</h4>
                                <div className="flex justify-around text-xs text-slate-400">
                                    <div><strong className="text-white">Área:</strong> {AREAS[activeTab]}</div>
                                    <div><strong className="text-white">Capacidad Total (Mm³):</strong> {CAPACIDAD_TOTAL[activeTab]}</div>
                                </div>
                            </section>
                        )}
                        <br />
                    </div>
                </div>

                <footer className="p-4 border-t border-slate-700/50 bg-slate-800/50 backdrop-blur-sm flex justify-end items-center">
                    <button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-900/40 border border-emerald-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0">
                        {saving ? <Loader className="animate-spin" size={16} /> : <Save size={16} />}
                        Guardar {activeTab === 'boquilla' ? 'Presa Boquilla' : activeTab === 'madero' ? 'Presa Madero' : 'Delicias'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

// Componentes Auxiliares
const TabButton = ({ id, label, active, onClick }: { id: string, label: string, active: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`flex-1 px-4 py-2.5 text-sm font-bold transition-all border-b-2 ${active === id
            ? 'border-blue-500 bg-blue-500/10 text-blue-100'
            : 'border-transparent text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
            }`}
    >
        {label}
    </button>
);

const InputGroup = ({ label, placeholder, value, onChange, type = "number" }: any) => (
    <div className="group">
        <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1 tracking-wider transition-colors group-focus-within:text-blue-400">{label}</label>
        <div className="relative">
            <input
                type={type}
                placeholder={placeholder}
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                className="w-full bg-slate-900/80 border border-slate-700/50 rounded-md p-2.5 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono placeholder-slate-700 transition-all shadow-inner"
            />
        </div>
    </div>
);

const SelectGroup = ({ label, value, onChange, options }: any) => (
    <div className="group">
        <label className="block text-[10px] uppercase text-slate-500 font-bold mb-1 tracking-wider transition-colors group-focus-within:text-blue-400">{label}</label>
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-700/50 rounded-md p-2.5 text-white text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none placeholder-slate-500 transition-all font-mono"
        >
            <option value="">--</option>
            {options.map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    </div>
);

export default ImportReport;
