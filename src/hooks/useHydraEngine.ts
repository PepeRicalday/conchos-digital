import { useEffect } from 'react';
import { useHydraStore } from '../store/useHydraStore';
export type { SectionData, DeliveryPoint, ModuleData } from '../store/useHydraStore';

export const useHydraEngine = () => {
    const { modules, loading, error, fetchHydraulicData, initSubscription } = useHydraStore();

    useEffect(() => {
        initSubscription();
    }, [initSubscription]);

    return { modules, loading, error, refresh: fetchHydraulicData };
};
