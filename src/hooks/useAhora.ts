import { useEffect, useState } from 'react';

/**
 * Hora actual (ms) que se actualiza cada `ms` mientras `activo`. Permite calcular antigüedades y cuentas regresivas
 * sin llamar a Date.now() durante el render (impuro). Vale 0 hasta el primer tick (unos milisegundos tras montar).
 */
export function useAhora(ms = 60_000, activo = true): number {
    const [ahora, setAhora] = useState(0);
    useEffect(() => {
        if (!activo) return;
        const tick = () => setAhora(Date.now());
        const inicial = window.setTimeout(tick, 0);
        const id = window.setInterval(tick, ms);
        return () => { window.clearTimeout(inicial); window.clearInterval(id); };
    }, [ms, activo]);
    return ahora;
}
