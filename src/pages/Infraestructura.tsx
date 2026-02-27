import { useState } from 'react';
import { useInfraestructura, type PuntoEntrega } from '../hooks/useInfraestructura';
import { MapPin, Plus, Save, Trash2, Edit2, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Infraestructura() {
    const { puntos, modulos, secciones, loading, savePunto, deletePunto } = useInfraestructura();
    const { profile } = useAuth();

    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<PuntoEntrega>>({});

    const accessDenied = profile?.rol !== 'SRL';
    if (accessDenied) {
        return (
            <div className="p-8 h-full flex items-center justify-center">
                <div className="bg-red-500/10 border border-red-500/30 text-red-500 p-8 rounded-xl text-center max-w-lg">
                    <h2 className="text-2xl font-bold mb-2">Acceso Restringido</h2>
                    <p>Este módulo es de uso exclusivo para el personal directivo de la S.R.L. Unidad Conchos.</p>
                </div>
            </div>
        );
    }

    const handleNew = () => {
        setFormData({
            nombre: '',
            km: 0,
            tipo: 'toma',
            capacidad_max: 0,
            coords_x: 0,
            coords_y: 0,
            zona: '',
            seccion_texto: ''
        });
        setIsEditing(true);
    };

    const handleEdit = (punto: PuntoEntrega) => {
        setFormData(punto);
        setIsEditing(true);
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('¿Está seguro de eliminar esta infraestructura? Se perderá el historial vinculado.')) {
            await deletePunto(id);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await savePunto(formData);
        setIsEditing(false);
    };

    return (
        <div className="h-full bg-slate-900 p-6 flex flex-col overflow-hidden text-slate-200">
            <div className="mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <MapPin className="text-blue-400" size={28} />
                        Catálogo de Infraestructura
                    </h1>
                    <p className="text-slate-400">Administración de Puntos de Entrega, Tomas y Escalas de la Red Mayor</p>
                </div>
                {!isEditing && (
                    <button onClick={handleNew} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors">
                        <Plus size={18} /> Nueva Estructura
                    </button>
                )}
            </div>

            <div className="flex-1 flex gap-6 min-h-0 relative">

                {/* Tabla de Puntos (Oculta si se está editando en móvil, o reducida en desktop) */}
                <div className={`flex-1 bg-slate-800 rounded-xl overflow-hidden shadow-lg border border-slate-700 flex flex-col transition-all ${isEditing ? 'opacity-30 pointer-events-none lg:opacity-100 lg:pointer-events-auto lg:w-1/2 flex-none' : 'w-full'}`}>
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Puntos Registrados ({puntos.length})</h2>
                    </div>
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead className="bg-slate-900/80 sticky top-0 z-10 backdrop-blur">
                                <tr className="text-xs text-slate-400 uppercase tracking-widest">
                                    <th className="py-3 px-4 font-bold">Km</th>
                                    <th className="py-3 px-4 font-bold">Nombre / Tipo</th>
                                    <th className="py-3 px-4 font-bold">Módulo / Sección</th>
                                    <th className="py-3 px-4 font-bold text-right">Capacidad</th>
                                    <th className="py-3 px-4"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr><td colSpan={5} className="text-center py-8 text-slate-500">Cargando catálogo...</td></tr>
                                ) : (
                                    puntos.map(p => (
                                        <tr key={p.id} className="hover:bg-slate-750 transition-colors group">
                                            <td className="py-3 px-4 font-mono text-blue-400">{p.km?.toFixed(3)}</td>
                                            <td className="py-3 px-4">
                                                <div className="font-bold text-white uppercase text-xs">{p.nombre}</div>
                                                <div className="text-[10px] text-slate-500 bg-slate-900 inline-block px-1.5 py-0.5 rounded mt-1 uppercase">{p.tipo}</div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="text-slate-300 font-medium text-xs">{p.m_codigo_corto || 'N/A'}</div>
                                                <div className="text-[10px] text-slate-500">{p.s_nombre || p.seccion_texto || 'S/S'}</div>
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono text-emerald-400 font-bold">
                                                {p.capacidad_max} <span className="text-[10px] text-slate-500 font-sans">m³/s</span>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => handleEdit(p)} className="p-1.5 text-blue-400 bg-blue-500/10 rounded hover:bg-blue-500/20"><Edit2 size={14} /></button>
                                                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-red-400 bg-red-500/10 rounded hover:bg-red-500/20"><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Formulario Lateral Flotante */}
                {isEditing && (
                    <div className="absolute right-0 top-0 bottom-0 w-full lg:w-[450px] lg:relative bg-slate-800 rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-blue-500/30 flex flex-col z-20 overflow-hidden">
                        <div className="p-5 border-b border-slate-700 bg-slate-900/50">
                            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                <Zap className="text-blue-400" size={16} />
                                {formData.id ? 'Modificar Estructura' : 'Alta de Estructura'}
                            </h2>
                        </div>

                        <form onSubmit={handleSubmit} className="p-5 flex-1 overflow-y-auto custom-scrollbar space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Nombre</label>
                                    <input type="text" required value={formData.nombre || ''} onChange={e => setFormData({ ...formData, nombre: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-white text-sm focus:border-blue-500 outline-none" placeholder="Ej. Toma La Esperanza" />
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Kilometraje (Km)</label>
                                    <input type="number" step="0.001" required value={formData.km || 0} onChange={e => setFormData({ ...formData, km: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-blue-400 font-mono text-sm focus:border-blue-500 outline-none" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Tipo</label>
                                    <select value={formData.tipo || 'toma'} onChange={e => setFormData({ ...formData, tipo: e.target.value as any })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-white text-sm focus:border-blue-500 outline-none uppercase font-bold">
                                        <option value="toma">Toma Agrícola</option>
                                        <option value="lateral">Canal Lateral</option>
                                        <option value="escala">Escala (Nivel)</option>
                                        <option value="carcamo">Cárcamo</option>
                                        <option value="estacion">Estación Aforo</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Diseño Max (m³/s)</label>
                                    <input type="number" step="0.001" required value={formData.capacidad_max || 0} onChange={e => setFormData({ ...formData, capacidad_max: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-emerald-400 font-mono text-sm focus:border-blue-500 outline-none" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Módulo Destino / Custodia</label>
                                <select value={formData.modulo_id || ''} onChange={e => setFormData({ ...formData, modulo_id: e.target.value || undefined })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-white text-sm focus:border-blue-500 outline-none">
                                    <option value="">-- Sin Módulo / Control SRL --</option>
                                    {modulos.map(m => <option key={m.id} value={m.id}>{m.codigo_corto} - {m.nombre}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Sección Hidráulica Relacional</label>
                                <select value={formData.seccion_id || ''} onChange={e => setFormData({ ...formData, seccion_id: e.target.value || undefined })} className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-white text-sm focus:border-blue-500 outline-none">
                                    <option value="">-- Sin Sección --</option>
                                    {secciones.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                            </div>

                            <div className="pt-4 border-t border-slate-700/50">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Opcional: Ubicación Física GPS</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Latitud (Y)</label>
                                        <input type="number" step="0.0000001" value={formData.coords_y || ''} onChange={e => setFormData({ ...formData, coords_y: parseFloat(e.target.value) || undefined })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-300 font-mono text-xs focus:border-blue-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-slate-400 mb-1 uppercase font-bold tracking-wider">Longitud (X)</label>
                                        <input type="number" step="0.0000001" value={formData.coords_x || ''} onChange={e => setFormData({ ...formData, coords_x: parseFloat(e.target.value) || undefined })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-slate-300 font-mono text-xs focus:border-blue-500 outline-none" />
                                    </div>
                                </div>
                            </div>
                        </form>

                        <div className="p-5 border-t border-slate-700 bg-slate-900 flex gap-3">
                            <button type="submit" onClick={handleSubmit} className="flex-1 bg-green-600 hover:bg-green-500 text-white p-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors">
                                <Save size={18} /> Guardar
                            </button>
                            <button type="button" onClick={() => setIsEditing(false)} className="bg-slate-700 hover:bg-slate-600 p-3 rounded-lg text-white font-bold px-6 transition-colors">
                                Descartar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
