
import { createContext, useContext, useEffect, useState } from 'react';
import { type Session, type User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface UserProfile {
    id: string;
    rol: 'SRL' | 'ACU' | 'AUDITORIA';
    modulo_id: string | null;
    nombre: string | null;
}

interface AuthContextType {
    session: Session | null;
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('perfiles_usuario')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;
            setProfile(data);
        } catch (err) {
            console.error('Error fetching profile:', err);
            setProfile(null);
        }
    };

    useEffect(() => {
        // 1. Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            // BYPASS DE EMERGENCIA (PARA LOCALHOST O FALLO DE RED)
            if (!session && window.location.hostname === 'localhost') {
                console.warn('AUTH_BYPASS: Sesión local de emergencia activa.');
                const mockUser = { id: 'admin-local', email: 'gerente@srlconchos.com' } as User;
                const mockSession = { user: mockUser, access_token: 'local-token' } as Session;
                setSession(mockSession);
                setUser(mockUser);
                setProfile({ id: 'admin-local', rol: 'SRL', modulo_id: '01', nombre: 'Administrador (Bypass Local)' });
                setLoading(false);
                return;
            }

            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id).finally(() => setLoading(false));
            } else {
                setLoading(false);
            }
        });

        // 2. Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session && window.location.hostname === 'localhost') return; // Don't logout the bypass!
            
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id).finally(() => setLoading(false));
            } else {
                setProfile(null);
                setLoading(false);
            }
        });

        // 3. Fail-safe timeout (SICA - Hidro-Sincronía)
        const timeout = setTimeout(() => {
            setLoading((prevValue) => {
                if (prevValue) {
                    console.warn('[DIAGNOSTIC] Auth check timed out after 2s, applying local bypass/recovery.');
                }
                return false;
            });
        }, 2000);

        return () => {
            subscription.unsubscribe();
            clearTimeout(timeout);
        };
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
        setProfile(null);
    };

    return (
        <AuthContext.Provider value={{ session, user, profile, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
