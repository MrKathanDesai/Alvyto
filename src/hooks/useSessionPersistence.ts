'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActiveVisitSession, DialogueTurn, VisitStatus, VisitSummary } from '@/types';

const ACTIVE_SESSION_KEY = 'alvyto_active_session';
const visitDraftKey = (visitId: string) => `alvyto_visit_draft_${visitId}`;

export interface PersistedSession {
  activeVisitId: string;
  selectedPatientId: string;
  savedAt: string;
}

export interface PersistedVisitDraft {
  visitId: string;
  patientId: string;
  transcript: string;
  dialogue: DialogueTurn[];
  summary: VisitSummary;
  status: VisitStatus;
  createdAt: string;
  savedAt: string;
}

export interface UseSessionPersistenceReturn {
  saveSession: (activeVisitId: string, selectedPatientId: string) => void;
  saveVisitDraft: (visit: ActiveVisitSession) => void;
  clearSession: () => void;
  recoveredSession: PersistedSession | null;
  recoveredDraft: PersistedVisitDraft | null;
}
const isBrowser = () => typeof window !== 'undefined';

function loadRecoveredState(): { recoveredSession: PersistedSession | null; recoveredDraft: PersistedVisitDraft | null } {
  if (!isBrowser()) {
    return { recoveredSession: null, recoveredDraft: null };
  }

  try {
    const rawSession = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!rawSession) {
      return { recoveredSession: null, recoveredDraft: null };
    }

    const parsedSession = JSON.parse(rawSession) as PersistedSession;
    if (!parsedSession?.activeVisitId || !parsedSession?.selectedPatientId) {
      return { recoveredSession: null, recoveredDraft: null };
    }

    const rawDraft = localStorage.getItem(visitDraftKey(parsedSession.activeVisitId));
    if (!rawDraft) {
      return { recoveredSession: parsedSession, recoveredDraft: null };
    }

    try {
      const parsedDraft = JSON.parse(rawDraft) as PersistedVisitDraft;
      if (parsedDraft?.visitId) {
        return { recoveredSession: parsedSession, recoveredDraft: parsedDraft };
      }
    } catch (draftErr) {
      console.warn('[useSessionPersistence] Failed to parse saved visit draft:', draftErr);
    }

    return { recoveredSession: parsedSession, recoveredDraft: null };
  } catch (sessionErr) {
    console.warn('[useSessionPersistence] Failed to parse saved session:', sessionErr);
    return { recoveredSession: null, recoveredDraft: null };
  }
}

export function useSessionPersistence(): UseSessionPersistenceReturn {
  const [initialRecoveredState] = useState(() => loadRecoveredState());
  const [recoveredSession, setRecoveredSession] = useState<PersistedSession | null>(initialRecoveredState.recoveredSession);
  const [recoveredDraft, setRecoveredDraft] = useState<PersistedVisitDraft | null>(initialRecoveredState.recoveredDraft);
  const latestDraftRef = useRef<PersistedVisitDraft | null>(null);

  useEffect(() => {
    latestDraftRef.current = recoveredDraft;
  }, [recoveredDraft]);

  const saveSession = useCallback((activeVisitId: string, selectedPatientId: string) => {
    if (!isBrowser() || !activeVisitId || !selectedPatientId) return;

    const payload: PersistedSession = {
      activeVisitId,
      selectedPatientId,
      savedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('[useSessionPersistence] Failed to save active session:', err);
    }
  }, []);

  const saveVisitDraft = useCallback((visit: ActiveVisitSession) => {
    if (!isBrowser() || !visit?.visitId) return;

    const payload: PersistedVisitDraft = {
      visitId: visit.visitId,
      patientId: visit.patientId,
      transcript: visit.transcript,
      dialogue: visit.dialogue,
      summary: visit.summary,
      status: visit.status,
      createdAt: visit.createdAt,
      savedAt: new Date().toISOString(),
    };

    latestDraftRef.current = payload;

    try {
      localStorage.setItem(visitDraftKey(visit.visitId), JSON.stringify(payload));
    } catch (err) {
      console.warn('[useSessionPersistence] Failed to save visit draft:', err);
    }
  }, []);

  const clearSession = useCallback(() => {
    if (!isBrowser()) return;

    try {
      const rawSession = localStorage.getItem(ACTIVE_SESSION_KEY);
      localStorage.removeItem(ACTIVE_SESSION_KEY);

      if (rawSession) {
        try {
          const parsed = JSON.parse(rawSession) as PersistedSession;
          if (parsed?.activeVisitId) {
            localStorage.removeItem(visitDraftKey(parsed.activeVisitId));
          }
        } catch (err) {
          console.warn('[useSessionPersistence] Failed to parse saved session while clearing:', err);
        }
      }

      if (latestDraftRef.current?.visitId) {
        localStorage.removeItem(visitDraftKey(latestDraftRef.current.visitId));
      }
    } catch (err) {
      console.warn('[useSessionPersistence] Failed to clear session persistence:', err);
    }

    latestDraftRef.current = null;
    setRecoveredSession(null);
    setRecoveredDraft(null);
  }, []);

  useEffect(() => {
    if (!isBrowser()) return;

    const interval = setInterval(() => {
      const latestDraft = latestDraftRef.current;
      if (!latestDraft?.visitId) {
        return;
      }

      try {
        localStorage.setItem(
          visitDraftKey(latestDraft.visitId),
          JSON.stringify({
            ...latestDraft,
            savedAt: new Date().toISOString(),
          })
        );
      } catch (err) {
        console.warn('[useSessionPersistence] Failed periodic draft save:', err);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  return {
    saveSession,
    saveVisitDraft,
    clearSession,
    recoveredSession,
    recoveredDraft,
  };
}
