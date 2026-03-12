'use client';

import { useState, useCallback } from 'react';
import { Visit, VisitStatus, SummaryItem, KeyFact } from '@/types';
import { v4 as uuidv4 } from 'uuid';

interface UseVisitSummaryReturn {
    currentVisit: Visit | null;
    startNewVisit: (patientId: string) => void;
    updateTranscript: (transcript: string, dialogue?: Visit['dialogue']) => void;
    updateIssues: (items: SummaryItem[]) => void;
    updateActions: (items: SummaryItem[]) => void;
    updateKeyFacts: (items: KeyFact[]) => void;
    setVisitStatus: (status: VisitStatus) => void;
    approveVisit: () => Promise<void>;
    discardVisit: () => void;
}

export function useVisitSummary(): UseVisitSummaryReturn {
    const [currentVisit, setCurrentVisit] = useState<Visit | null>(null);

    const startNewVisit = useCallback((patientId: string) => {
        const newVisit: Visit = {
            id: uuidv4(),
            patientId,
            transcript: '',
            atomicFacts: [],
            summary: {
                issuesIdentified: [],
                actionsPlan: [],
            },
            dialogue: [],
            status: 'recording',
            createdAt: new Date().toISOString(),
        };
        setCurrentVisit(newVisit);
    }, []);

    const updateTranscript = useCallback((transcript: string, dialogue?: Visit['dialogue']) => {
        setCurrentVisit(prev => prev ? { ...prev, transcript, dialogue: dialogue || prev.dialogue } : null);
    }, []);

    const updateIssues = useCallback((items: SummaryItem[]) => {
        setCurrentVisit(prev => prev ? {
            ...prev,
            summary: {
                ...prev.summary,
                issuesIdentified: items,
            },
        } : null);
    }, []);

    const updateActions = useCallback((items: SummaryItem[]) => {
        setCurrentVisit(prev => prev ? {
            ...prev,
            summary: {
                ...prev.summary,
                actionsPlan: items,
            },
        } : null);
    }, []);

    const updateKeyFacts = useCallback((items: KeyFact[]) => {
        setCurrentVisit(prev => prev ? {
            ...prev,
            summary: {
                ...prev.summary,
                keyFacts: items,
            },
        } : null);
    }, []);

    const setVisitStatus = useCallback((status: VisitStatus) => {
        setCurrentVisit(prev => prev ? { ...prev, status } : null);
    }, []);

    const approveVisit = useCallback(async () => {
        if (!currentVisit) return;

        setCurrentVisit(prev => prev ? {
            ...prev,
            status: 'approved' as VisitStatus,
            approvedAt: new Date().toISOString(),
        } : null);
    }, [currentVisit]);

    const discardVisit = useCallback(() => {
        setCurrentVisit(null);
    }, []);

    return {
        currentVisit,
        startNewVisit,
        updateTranscript,
        updateIssues,
        updateActions,
        updateKeyFacts,
        setVisitStatus,
        approveVisit,
        discardVisit,
    };
}
