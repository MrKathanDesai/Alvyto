'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { User, Room, AuthState, AuthCredentials } from '@/types/emr';
import { api } from '@/services/api';

interface AuthContextType extends AuthState {
    login: (credentials: AuthCredentials) => Promise<boolean>;
    logout: () => void;
    switchRoom: (roomId: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_STORAGE_KEY = 'emr_auth';

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        isAuthenticated: false,
        user: null,
        room: null,
        loading: true,
        error: null,
    });

    useEffect(() => {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setState({
                    isAuthenticated: true,
                    user: parsed.user,
                    room: parsed.room,
                    loading: false,
                    error: null,
                });
            } catch {
                localStorage.removeItem(AUTH_STORAGE_KEY);
                setState(s => ({ ...s, loading: false }));
            }
        } else {
            setState(s => ({ ...s, loading: false }));
        }
    }, []);

    const login = useCallback(async (credentials: AuthCredentials): Promise<boolean> => {
        setState(s => ({ ...s, loading: true, error: null }));

        try {
            const response = await api.login(credentials);
            if (response.success && response.user) {
                const newState = {
                    isAuthenticated: true,
                    user: response.user,
                    room: response.user.role === 'room' ? { id: response.user.roomId, name: response.user.name } as Room : null,
                    loading: false,
                    error: null,
                };

                if (response.user.role === 'room' && response.user.roomId) {
                    try {
                        const rooms = await api.getRooms();
                        const room = rooms.find(r => r.id === response.user.roomId);
                        if (room) {
                            newState.room = room;
                        }
                    } catch (e) {
                        console.error("Failed to fetch room details after login", e);
                    }
                }

                setState(newState);
                localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
                    user: newState.user,
                    room: newState.room
                }));
                return true;
            } else {
                throw new Error('Login failed');
            }
        } catch (error: any) {
            console.error('Login error:', error);
            setState(s => ({
                ...s,
                loading: false,
                error: error.message || 'Invalid credentials',
            }));
            return false;
        }
    }, []);

    const logout = useCallback(() => {
        setState({
            isAuthenticated: false,
            user: null,
            room: null,
            loading: false,
            error: null,
        });
        localStorage.removeItem(AUTH_STORAGE_KEY);
    }, []);

    const switchRoom = useCallback(async (roomId: string) => {
        try {
            const rooms = await api.getRooms();
            const room = rooms.find(r => r.id === roomId);
            if (room) {
                setState(s => ({ ...s, room }));
            }
        } catch (e) {
            console.error("Failed to switch room", e);
        }
    }, []);

    return (
        <AuthContext.Provider value={{ ...state, login, logout, switchRoom }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
