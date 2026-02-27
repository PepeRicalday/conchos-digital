import { useState } from 'react';
import { useCiclos, type CicloAgricola } from '../hooks/useCiclos';
import { CalendarDays, Save, Edit2, Plus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Ciclos() {
    const { ciclos, modulos, modulosCiclos, loading, saveCiclo, saveModuloCiclo } = useCiclos();
    const { profile } = useAuth();
    const [selectedCicloId, setSelectedCicloId] = useState<string | null>(null);

    // Formulario de Ciclo
    const [formData, setFormData] = useState<Partial<CicloAgricola>>({});
    const [isEditing, setIsEditing] = useState(false);

    if (loading && ciclos.length === 0) return <div className="p-8 text-white">Cargando Ciclos...</div>;

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

    const selectedCiclo = ciclos.find(c => c.id === selectedCicloId) || ciclos[0];

    // Cálculos de Volumen
    const totalAutorizadoModulos = modulosCiclos
        .filter(mc => mc.ciclo_id === selectedCiclo?.id)
        .reduce((sum, mc) => sum + Number(mc.volumen_autorizado_mm3 || 0), 0);

    const restante = (selectedCiclo?.volumen_autorizado_mm3 || 0) - totalAutorizadoModulos;

    const fillFormForEdit = (ciclo: CicloAgricola) => {
        setFormData(ciclo);
        setIsEditing(true);
    };

    const handleNew = () => {
        setFormData({
            nombre: '',
            clave: '',
            fecha_inicio: '',
            fecha_fin: '',
            volumen_autorizado_mm3: 0,
            activo: false
        });
        setIsEditing(true);
    };

    const submitCiclo = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = await saveCiclo(formData);
        if (data) setSelectedCicloId(data.id);
        setIsEditing(false);
    };

    return (
        <div className="h-full bg-slate-900 p-6 flex flex-col overflow-hidden text-slate-200">
            <div className="mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <CalendarDays className="text-blue-400" size={28} />
                        Plan Hidrológico y Ciclos Agrícolas
                    </h1>
                    <p className="text-slate-400">Distribución de volúmenes concesionados de la Red Mayor</p>
                </div>
                <button onClick={handleNew} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors">
                    <Plus size={18} /> Nuevo Plan Anual
                </button>
            </div>

            <div className="flex gap-6 flex-1 min-h-0">
                {/* Lado Izquierdo: Lista de Ciclos y Formulario */}
                <div className="w-1/3 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                    {/* Lista de Ciclos */}
                    <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Ciclos Registrados</h2>
                        <div className="flex flex-col gap-2">
                            {ciclos.map(ciclo => (
                                <div
                                    key={ciclo.id}
                                    onClick={() => setSelectedCicloId(ciclo.id)}
                                    className={`p-3 rounded-lg cursor-pointer border transition-all ${selectedCiclo?.id === ciclo.id ? 'bg-blue-900/40 border-blue-500/50' : 'bg-slate-900/50 border-slate-700 hover:border-slate-500'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-bold text-white">{ciclo.nombre}</h3>
                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${ciclo.activo ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-300'}`}>
                                            {ciclo.activo ? 'activo' : 'inactivo'}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-400">
                                        Vol. Autorizado: <span className="text-blue-300 font-mono">{ciclo.volumen_autorizado_mm3} Mm³</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); fillFormForEdit(ciclo); }} className="mt-2 text-xs text-blue-400 flex items-center gap-1 hover:text-blue-300">
                                        <Edit2 size={12} /> Editar
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Formulario Ciclo */}
                    {isEditing && (
                        <form onSubmit={submitCiclo} className="bg-slate-800 rounded-xl p-4 shadow-lg border border-blue-500/30">
                            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4 border-b border-slate-700 pb-2">
                                {formData.id ? 'Editar Plan Anual' : 'Nuevo Plan Anual'}
                            </h2>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1 uppercase font-bold tracking-wider">Nombre del Ciclo (Ej. Ciclo 2024-2025)</label>
                                    <input type="text" required value={formData.nombre || ''} onChange={e => setFormData({ ...formData, nombre: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:border-blue-500 outline-none" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1 uppercase font-bold tracking-wider">Inicio</label>
                                        <input type="date" required value={formData.fecha_inicio || ''} onChange={e => setFormData({ ...formData, fecha_inicio: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:border-blue-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1 uppercase font-bold tracking-wider">Cierre</label>
                                        <input type="date" required value={formData.fecha_fin || ''} onChange={e => setFormData({ ...formData, fecha_fin: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:border-blue-500 outline-none" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1 uppercase font-bold tracking-wider">Millones de M3 Generales Autorizados</label>
                                    <input type="number" step="0.01" required value={formData.volumen_autorizado_mm3 || 0} onChange={e => setFormData({ ...formData, volumen_autorizado_mm3: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:border-blue-500 outline-none font-mono text-lg" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1 uppercase font-bold tracking-wider">Estado de Ciclo</label>
                                    <select value={formData.activo ? 'activo' : 'inactivo'} onChange={e => setFormData({ ...formData, activo: e.target.value === 'activo' })} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white outline-none">
                                        <option value="activo">1. Activo</option>
                                        <option value="inactivo">2. Inactivo / Histórico</option>
                                    </select>
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <button type="submit" className="flex-1 bg-green-600 hover:bg-green-500 text-white p-2 rounded-lg font-bold flex items-center justify-center gap-2">
                                        <Save size={16} /> Guardar
                                    </button>
                                    <button type="button" onClick={() => setIsEditing(false)} className="bg-slate-700 hover:bg-slate-600 p-2 rounded-lg text-white font-bold px-4">
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>

                {/* Lado Derecho: Asignación a Módulos */}
                {selectedCiclo && (
                    <div className="w-2/3 bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700 flex flex-col">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Users className="text-blue-400" /> Presupuesto por Asociación Civil
                                </h2>
                                <p className="text-slate-400 text-sm mt-1">Asigna la cuota hídrica a los Módulos para el ciclo <span className="text-white font-bold">{selectedCiclo.nombre}</span></p>
                            </div>
                            <div className="text-right bg-slate-900 p-3 rounded-xl border border-slate-700">
                                <div className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-1">Balance Autorizado</div>
                                <div className="text-2xl font-mono text-white leading-none">{selectedCiclo.volumen_autorizado_mm3} <span className="text-sm text-slate-500">Mm³</span></div>
                            </div>
                        </div>

                        {/* Indicador Visual de Balance */}
                        <div className="mb-6">
                            <div className="flex justify-between text-xs font-bold uppercase tracking-wide mb-2">
                                <span className="text-blue-400">Asignado: {totalAutorizadoModulos.toFixed(2)} Mm³</span>
                                <span className={restante < 0 ? 'text-red-400' : 'text-slate-400'}>
                                    {restante < 0 ? 'Déficit/Sobregiro: ' : 'Sin Asignar: '} {Math.abs(restante).toFixed(2)} Mm³
                                </span>
                            </div>
                            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden flex">
                                <div className={`h-full transition-all ${restante < 0 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (totalAutorizadoModulos / (selectedCiclo.volumen_autorizado_mm3 || 1)) * 100)}%` }}></div>
                            </div>
                        </div>

                        {/* Listado de Módulos (Tabla Minimalista Interactiva) */}
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
                                        <th className="pb-3 px-2 w-1/3">ACU / Módulo</th>
                                        <th className="pb-3 px-2 w-1/3">Volumen Asignado (Mm³)</th>
                                        <th className="pb-3 px-2 text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {modulos.map(mod => {
                                        const vinculacion = modulosCiclos.find(mc => mc.modulo_id === mod.id && mc.ciclo_id === selectedCiclo.id);
                                        return (
                                            <PresupuestoRow
                                                key={mod.id}
                                                modulo={mod}
                                                cicloId={selectedCiclo.id}
                                                vinculacion={vinculacion}
                                                onSave={saveModuloCiclo}
                                            />
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Subcomponente de fila para manejar la edición aislada
function PresupuestoRow({ modulo, cicloId, vinculacion, onSave }: any) {
    const [isEditing, setIsEditing] = useState(false);
    const [vol, setVol] = useState(vinculacion?.volumen_autorizado_mm3 || 0);

    const handleSaveRow = async () => {
        await onSave(vinculacion?.id || null, cicloId, modulo.id, Number(vol));
        setIsEditing(false);
    };

    return (
        <tr className="border-b border-slate-700/50 hover:bg-slate-750 transition-colors group">
            <td className="py-3 px-2 w-1/3">
                <div className="font-bold text-white text-sm">{modulo.nombre}</div>
                <div className="text-xs text-slate-500">{modulo.codigo_corto}</div>
            </td>
            <td className="py-3 px-2 w-1/3">
                {isEditing ? (
                    <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={vol}
                        onChange={e => setVol(e.target.value)}
                        className="bg-slate-900 border border-blue-500 rounded p-1 text-white font-mono outline-none w-32"
                    />
                ) : (
                    <span className="font-mono text-slate-300 font-bold bg-slate-900 px-3 py-1 rounded">
                        {vol} Mm³
                    </span>
                )}
            </td>
            <td className="py-3 px-2 text-right">
                {isEditing ? (
                    <button onClick={handleSaveRow} className="bg-green-600/20 text-green-400 hover:bg-green-600/40 px-3 py-1 rounded border border-green-500/50 font-bold text-xs uppercase transition-colors">
                        Guardar
                    </button>
                ) : (
                    <button onClick={() => setIsEditing(true)} className="text-blue-400 hover:text-blue-300 px-3 py-1 rounded font-bold text-xs uppercase flex items-center justify-end gap-1 w-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <Edit2 size={12} /> Modificar
                    </button>
                )}
            </td>
        </tr>
    );
}
