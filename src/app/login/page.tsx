'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import styles from './page.module.css';

type PublicRoom = {
    id: string;
    name: string;
    floor?: string | null;
};
type LoginMode = 'room' | 'admin';

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();

    const [mode, setMode] = useState<LoginMode>('room');
    const [rooms, setRooms] = useState<PublicRoom[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [roomId, setRoomId] = useState('');
    const [pin, setPin] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    useEffect(() => {
        async function fetchRooms() {
            try {
                const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/rooms/public`);
                if (res.ok) {
                    const data = await res.json();
                    setRooms(Array.isArray(data) ? data : []);
                }
            } catch (e) {
                console.error('Failed to fetch public rooms', e);
            }
        }
        fetchRooms();
        const interval = setInterval(fetchRooms, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login({
                mode,
                email: mode === 'admin' ? email : undefined,
                password: mode === 'admin' ? password : undefined,
                roomId: mode === 'room' ? roomId : undefined,
                pin: mode === 'room' ? pin : undefined,
            });
            router.push(mode === 'admin' ? '/admin' : '/');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to sign in');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Brand Panel */}
            <aside className={styles.brand}>
                <div className={styles.brandLogo}>
                    <div className={styles.brandIcon}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                    </div>
                    <span className={styles.brandName}>Alvyto</span>
                </div>

                <div className={styles.brandContent}>
                    <h1 className={styles.brandHeadline}>
                        Clinical intelligence,<br />
                        <span className={styles.brandAccent}>at full speed.</span>
                    </h1>
                    <p className={styles.brandBody}>
                        Real-time AI transcription and summarisation for exam rooms.
                        Built for clinicians who need fewer clicks and more time with patients.
                    </p>
                    <div className={styles.featureList}>
                        {[
                            'Live AI-assisted visit documentation',
                            'Smart queue and scheduling management',
                            'Physician-reviewed SOAP summaries',
                            'HIPAA-compliant audit trail',
                        ].map(f => (
                            <div key={f} className={styles.feature}>
                                <span className={styles.featureDot} />
                                {f}
                            </div>
                        ))}
                    </div>
                </div>

                <p className={styles.brandFooter}>© 2026 Alvyto EMR · All rights reserved.</p>
            </aside>

            {/* Form Panel */}
            <main className={styles.formPanel}>
                <div className={styles.loginCard}>
                    <div className={styles.header}>
                        <h2 className={styles.title}>
                            {mode === 'admin' ? 'Admin sign in' : 'Room device sign in'}
                        </h2>
                        <p className={styles.subtitle}>
                            {mode === 'admin'
                                ? 'Access the admin console with your credentials.'
                                : 'Select an exam room and enter the device PIN.'}
                        </p>
                    </div>

                    {/* Mode Toggle */}
                    <div className={styles.modeToggle}>
                        <button
                            type="button"
                            className={`${styles.modeButton} ${mode === 'room' ? styles.active : ''}`}
                            onClick={() => setMode('room')}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                            </svg>
                            Room Device
                        </button>
                        <button
                            type="button"
                            className={`${styles.modeButton} ${mode === 'admin' ? styles.active : ''}`}
                            onClick={() => setMode('admin')}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            Administrator
                        </button>
                    </div>

                    {error && (
                        <div className={styles.error}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className={styles.form}>
                        {mode === 'room' ? (
                            <>
                                <div className={styles.field}>
                                    <label htmlFor="roomId">Exam Room</label>
                                    <select
                                        id="roomId"
                                        value={roomId}
                                        onChange={(e) => setRoomId(e.target.value)}
                                        required
                                    >
                                        <option value="">Select a room…</option>
                                        {rooms.map(room => (
                                            <option key={room.id} value={room.id}>{room.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="pin">Device PIN</label>
                                    <input
                                        id="pin"
                                        type="password"
                                        value={pin}
                                        onChange={(e) => setPin(e.target.value)}
                                        placeholder="4-digit PIN"
                                        maxLength={4}
                                        pattern="[0-9]{4}"
                                        required
                                        inputMode="numeric"
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className={styles.field}>
                                    <label htmlFor="email">Email</label>
                                    <input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="admin@clinic.com"
                                        required
                                        autoComplete="email"
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="password">Password</label>
                                    <input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        required
                                        autoComplete="current-password"
                                    />
                                </div>
                            </>
                        )}

                        <button type="submit" className={styles.submitButton} disabled={loading}>
                            {loading ? (
                                <>
                                    <svg className={styles.spinner} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                                    </svg>
                                    Signing in…
                                </>
                            ) : (
                                'Sign in'
                            )}
                        </button>
                    </form>

                    <p className={styles.footer}>Secure access · HIPAA compliant</p>
                </div>
            </main>
        </div>
    );
}
