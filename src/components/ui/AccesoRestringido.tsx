import { ShieldAlert } from 'lucide-react';

/** Aviso único de acceso restringido (sustituye las variantes sueltas de cada pantalla de Administración). */
export function AccesoRestringido({ detalle }: { detalle?: string }) {
    return (
        <div className="p-8 h-full flex items-center justify-center" role="alert">
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-8 rounded-xl text-center max-w-lg">
                <ShieldAlert size={40} className="mx-auto mb-3" aria-hidden="true" />
                <h2 className="text-2xl font-bold mb-2">Acceso restringido</h2>
                <p>{detalle ?? 'Este módulo es de uso exclusivo para el personal directivo de la S.R.L. Unidad Conchos.'}</p>
            </div>
        </div>
    );
}
