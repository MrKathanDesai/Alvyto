'use client';

import { useState, useCallback } from 'react';
import { Visit, VisitStatus, SummaryItem } from '@/types';
import { v4 as uuidv4 } from 'uuid';

interface UseVisitSummaryReturn {
    currentVisit: Visit | null;
    startNewVisit: (patientId: string) => void;
    updateTranscript: (transcript: string) => void;
    updateIssues: (items: SummaryItem[]) => void;
    updateActions: (items: SummaryItem[]) => void;
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
            status: 'recording',
            createdAt: new Date().toISOString(),
        };
        setCurrentVisit(newVisit);
    }, []);

    const updateTranscript = useCallback((transcript: string) => {
        setCurrentVisit(prev => prev ? { ...prev, transcript } : null);
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
        setVisitStatus,
        approveVisit,
        discardVisit,
    };
}
