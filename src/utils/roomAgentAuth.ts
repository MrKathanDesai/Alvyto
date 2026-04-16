import { getStoredToken } from '@/services/api';

export function getRoomAgentToken(): string | null {
  return getStoredToken();
}

export function getRoomAgentHeaders(init?: HeadersInit): HeadersInit {
  const headers = new Headers(init);
  const token = getRoomAgentToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export function withRoomAgentToken(url: string): string {
  const token = getRoomAgentToken();
  if (!token) return url;

  const next = new URL(url, window.location.origin);
  next.searchParams.set('token', token);
  return next.toString();
}
