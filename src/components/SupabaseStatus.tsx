import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Database, CheckCircle, AlertCircle } from 'lucide-react';
import './SupabaseStatus.css';

const SupabaseStatus = () => {
    const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState<string>('');

    useEffect(() => {
        const checkConnection = async () => {
            try {
                const { error } = await supabase.from('presas').select('count', { count: 'exact', head: true });
                if (error) throw error;
                setStatus('connected');
            } catch (err: any) {
                console.error('Supabase connection error:', err);
                setStatus('error');
                setErrorMessage(err.message || 'Error desconocido');
            }
        };

        checkConnection();
    }, []);

    if (status === 'loading') return (
        <div className="supabase-status status-loading">
            <Database size={12} className="status-icon-pulse" />
            Verificando conexión...
        </div>
    );

    if (status === 'error') return (
        <div className="supabase-status status-error" title={errorMessage}>
            <AlertCircle size={12} />
            Sin conexión
        </div>
    );

    return (
        <div className="supabase-status status-connected">
            <CheckCircle size={12} />
            Conectado a Supabase
        </div>
    );
};

export default SupabaseStatus;
