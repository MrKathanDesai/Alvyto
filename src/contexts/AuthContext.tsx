'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AuthState, UserRole } from '@/types/emr';
import { getMe, login as apiLogin, logout as apiLogout, storeToken, clearToken } from '@/services/api';

interface AuthContextValue extends AuthState {
  login: (params: {
    mode: 'admin' | 'room';
    email?: string;
    password?: string;
    roomId?: string;
    pin?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  loaded: boolean;
  isAdmin: boolean;
  isRoomDevice: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'alvyto_auth';

function loadStoredAuth(): AuthState {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as AuthState;
    // Check token expiry
    if (parsed.expiresAt && new Date(parsed.expiresAt) < new Date()) {
      localStorage.removeItem(STORAGE_KEY);
      clearToken();
      return empty();
    }
    return parsed;
  } catch (err) {
    console.warn('[AuthContext] Failed to parse stored auth state, clearing:', err);
    return empty();
  }
}

function empty(): AuthState {
  return {
    token: null, role: null, adminId: null,
    roomId: null, name: null, expiresAt: null,
    isAuthenticated: false,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(empty);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    const bootstrapAuth = async () => {
      const stored = loadStoredAuth();

      if (!stored.isAuthenticated || !stored.token) {
        if (active) setLoaded(true);
        return;
      }

      storeToken(stored.token);
      if (active) setAuth(stored);

      try {
        await getMe();
      } catch (err) {
        console.warn('[AuthContext] Session validation failed, clearing auth state:', err);
        localStorage.removeItem(STORAGE_KEY);
        clearToken();
        if (active) setAuth(empty());

        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      } finally {
        if (active) setLoaded(true);
      }
    };

    void bootstrapAuth();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (params: {
    mode: 'admin' | 'room';
    email?: string; password?: string;
    roomId?: string; pin?: string;
  }) => {
    const result = await apiLogin(params);
    const next: AuthState = {
      token: result.token,
      role: result.role as UserRole,
      adminId: result.adminId ?? null,
      roomId: result.roomId ?? null,
      name: result.name ?? null,
      expiresAt: result.expiresAt,
      isAuthenticated: true,
    };
    storeToken(result.token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    localStorage.removeItem(STORAGE_KEY);
    clearToken();
    setAuth(empty());
  }, []);

  const value: AuthContextValue = {
    ...auth,
    login,
    logout,
    loaded,
    isAdmin: auth.role === 'admin' || auth.role === 'super_admin',
    isRoomDevice: auth.role === 'room_device',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
