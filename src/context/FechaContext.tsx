import { createContext, useContext, useState, type ReactNode } from 'react';
import { toZonedTime, format } from 'date-fns-tz';

interface FechaContextType {
    fechaSeleccionada: string;  // Format: 'YYYY-MM-DD'
    setFechaSeleccionada: (fecha: string) => void;
    esHoy: boolean;
}

const FechaContext = createContext<FechaContextType | undefined>(undefined);

function getHoyISO(): string {
    const timeZone = 'America/Chihuahua';
    const zonedDate = toZonedTime(new Date(), timeZone);
    return format(zonedDate, 'yyyy-MM-dd', { timeZone });
}

export function FechaProvider({ children }: { children: ReactNode }) {
    const [fechaSeleccionada, setFechaSeleccionada] = useState<string>(getHoyISO());

    const esHoy = fechaSeleccionada === getHoyISO();

    return (
        <FechaContext.Provider value={{ fechaSeleccionada, setFechaSeleccionada, esHoy }}>
            {children}
        </FechaContext.Provider>
    );
}

export function useFecha() {
    const context = useContext(FechaContext);
    if (context === undefined) {
        throw new Error('useFecha debe usarse dentro de FechaProvider');
    }
    return context;
}
