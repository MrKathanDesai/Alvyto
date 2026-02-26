'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/services/api';
import { Room } from '@/types/emr';
import styles from './page.module.css';

type LoginMode = 'room' | 'admin';

export default function LoginPage() {
    const router = useRouter();
    const { login, loading, error } = useAuth();

    const [mode, setMode] = useState<LoginMode>('room');
    const [rooms, setRooms] = useState<Room[]>([]);

    // Room login fields
    const [roomId, setRoomId] = useState('');
    const [pin, setPin] = useState('');

    // Admin login fields
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // Fetch rooms on mount and poll every 3 seconds
    useEffect(() => {
        async function fetchRooms() {
            try {
                const data = await api.getRooms();
                // Only update if length changed or first load (simple optimization)
                setRooms(prev => {
                    if (JSON.stringify(prev) !== JSON.stringify(data)) {
                        return data;
                    }
                    return prev;
                });
            } catch (e) {
                console.error("Failed to fetch rooms", e);
            }
        }

        fetchRooms();
        const interval = setInterval(fetchRooms, 3000);

        return () => clearInterval(interval);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const success = await login({
            mode,
            email: mode === 'admin' ? email : undefined,
            password: mode === 'admin' ? password : undefined,
            roomId: mode === 'room' ? roomId : undefined,
            pin: mode === 'room' ? pin : undefined,
        });

        if (success) {
            router.push(mode === 'admin' ? '/admin' : '/');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.loginCard}>
                {/* Logo and Header */}
                <div className={styles.header}>
                    <div className={styles.logo}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                    </div>
                    <h1 className={styles.title}>Exam Room EMR</h1>
                    <p className={styles.subtitle}>Secure Healthcare Access Portal</p>
                </div>

                {/* Mode Toggle */}
                <div className={styles.modeToggle}>
                    <button
                        type="button"
                        className={`${styles.modeButton} ${mode === 'room' ? styles.active : ''}`}
                        onClick={() => setMode('room')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 15c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
                            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                        </svg>
                        Administrator
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className={styles.error}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4m0 4h.01" />
                        </svg>
                        {error}
                    </div>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit} className={styles.form}>
                    {mode === 'room' ? (
                        <>
                            <div className={styles.field}>
                                <label htmlFor="roomId">Room</label>
                                <select
                                    id="roomId"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value)}
                                    required
                                >
                                    <option value="">Select exam room...</option>
                                    {rooms.map(room => (
                                        <option key={room.id} value={room.id}>
                                            {room.name}
                                        </option>
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
                                    placeholder="Enter 4-digit PIN"
                                    maxLength={4}
                                    pattern="[0-9]{4}"
                                    required
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className={styles.field}>
                                <label htmlFor="email">Email Address</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@clinic.com"
                                    required
                                />
                            </div>
                            <div className={styles.field}>
                                <label htmlFor="password">Password</label>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter password"
                                    required
                                />
                            </div>
                        </>
                    )}

                    <button
                        type="submit"
                        className={styles.submitButton}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <svg className={styles.spinner} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                                </svg>
                                Signing in...
                            </>
                        ) : (
                            <>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
                                </svg>
                                Sign In
                            </>
                        )}
                    </button>
                </form>

                {/* Footer */}
                <div className={styles.footer}>
                    <p>© 2026 Alvyto EMR. Production Ready.</p>
                </div>
            </div>
        </div>
    );
}

