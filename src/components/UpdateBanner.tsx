import { RefreshCw, X } from 'lucide-react';

interface UpdateBannerProps {
    onUpdate: () => void;
    onClose: () => void;
}

export const UpdateBanner = ({ onUpdate, onClose }: UpdateBannerProps) => {
    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] w-[90%] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-[#1e293b] border border-blue-500/50 rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-500/20 p-2 rounded-xl">
                        <RefreshCw className="text-blue-500 animate-spin-slow" size={20} />
                    </div>
                    <div>
                        <h4 className="text-white text-sm font-bold">Nueva Versión</h4>
                        <p className="text-slate-400 text-xs">Hay cambios disponibles en la plataforma.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onUpdate}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors shadow-lg shadow-blue-900/20"
                    >
                        Actualizar
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-500 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
