import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail, ShieldCheck, Droplets } from 'lucide-react';
import './Login.css';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            navigate('/');
        } catch (err: any) {
            console.error('Login error:', err);
            setError(err.message || 'Error al iniciar sesión. Verifica tus credenciales.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-overlay"></div>

            <div className="login-card">
                <div className="login-brand">
                    <div className="brand-icon">
                        <Droplets className="water-icon" />
                    </div>
                    <h1>SICA 005</h1>
                    <p>Hidro-Sincronía Digital</p>
                    <div className="srl-tag">Sociedad de Asociaciones de Usuarios Unidad Conchos S. de R.L.</div>
                </div>

                <div className="login-content">
                    <h2>Centro de Control Operativo</h2>
                    <p className="subtitle">Ingresa tus credenciales para acceder al sistema</p>

                    <form onSubmit={handleLogin} className="login-form">
                        <div className="form-group">
                            <label htmlFor="email">Correo Electrónico</label>
                            <div className="input-wrapper">
                                <Mail className="input-icon" />
                                <input
                                    id="email"
                                    type="email"
                                    placeholder="correo@srlconchos.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Contraseña</label>
                            <div className="input-wrapper">
                                <Lock className="input-icon" />
                                <input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {error && <div className="login-error">{error}</div>}

                        <button
                            type="submit"
                            className={`login-submit ${loading ? 'loading' : ''}`}
                            disabled={loading}
                        >
                            {loading ? (
                                <span className="spinner"></span>
                            ) : (
                                <>
                                    <LogIn size={20} />
                                    <span>Iniciar Sesión</span>
                                </>
                            )}
                        </button>
                    </form>

                    <div className="login-footer">
                        <div className="security-badge">
                            <ShieldCheck size={14} />
                            <span>Acceso restringido a personal autorizado</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="login-background-info">
                <span>Distrito de Riego 005 - Delicias, Chihuahua</span>
            </div>
        </div>
    );
};

export default Login;
