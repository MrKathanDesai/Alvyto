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

// Separate storage keys for admin panel vs room panel so sessions don't
// clobber each other when both panels are open in the same browser.
const ADMIN_STORAGE_KEY = 'alvyto_admin_auth';
const ROOM_STORAGE_KEY  = 'alvyto_room_auth';
const LEGACY_KEY        = 'alvyto_auth'; // migrated automatically on load

function getStorageKey(): string {
  if (typeof window === 'undefined') return ADMIN_STORAGE_KEY;
  return window.location.pathname.startsWith('/admin')
    ? ADMIN_STORAGE_KEY
    : ROOM_STORAGE_KEY;
}

function loadStoredAuth(): AuthState {
  if (typeof window === 'undefined') return empty();
  try {
    const key = getStorageKey();
    const raw = localStorage.getItem(key) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as AuthState;
    // Check token expiry
    if (parsed.expiresAt && new Date(parsed.expiresAt) < new Date()) {
      localStorage.removeItem(key);
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

function clearStoredAuthState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(getStorageKey());
  localStorage.removeItem(LEGACY_KEY);
  clearToken();
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

      storeToken(stored.token, stored.role === 'room_device' ? 'room' : 'admin');
      if (active) setAuth(stored);

      try {
        await getMe();
      } catch (err) {
        console.warn('[AuthContext] Session validation failed, clearing auth state:', err);
        clearStoredAuthState();
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
    storeToken(result.token, params.mode);
    localStorage.setItem(params.mode === 'admin' ? ADMIN_STORAGE_KEY : ROOM_STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearStoredAuthState();
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
