import { memo } from 'react';
import { Smartphone, Monitor } from 'lucide-react';
import type { AppVersionRow } from '../../types/sica.types';

/** Versiones de las apps y sello del corte (hora local de Chihuahua, rotulada). */
export const PieSistema = memo(function PieSistema({ versiones, corte, appVersion, buildHash }: { versiones: AppVersionRow[]; corte: string; appVersion: string; buildHash: string }) {
    return (
        <footer className="sc-card sc-pie" aria-label="Versiones del sistema">
            <ul className="sc-vers">
                {versiones.map((v) => (
                    <li key={v.id}>
                        {v.app_id === 'capture' ? <Smartphone size={13} aria-hidden="true" /> : <Monitor size={13} aria-hidden="true" />}
                        {v.app_id.replace('-', ' ')} <b>v{v.version}</b>
                    </li>
                ))}
            </ul>
            <span>SICA DR-005 Conchos Digital · v{appVersion} · {buildHash} · corte {corte} (hora de Chihuahua)</span>
        </footer>
    );
});
