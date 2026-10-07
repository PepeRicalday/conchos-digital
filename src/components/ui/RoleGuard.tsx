import type { ReactNode } from 'react';
import { useRol } from '../../lib/auth/roles';
import { AccesoRestringido } from './AccesoRestringido';

/** Solo personal SRL ve a los hijos; mientras carga el perfil no muestra "denegado" por error. */
export function RoleGuard({ children, detalle }: { children: ReactNode; detalle?: string }) {
    const { esSRL, cargando } = useRol();
    if (cargando) return <div className="p-8 text-slate-400" role="status">Verificando acceso…</div>;
    if (!esSRL) return <AccesoRestringido detalle={detalle} />;
    return <>{children}</>;
}
