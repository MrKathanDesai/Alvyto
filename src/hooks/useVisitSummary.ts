'use client';

import { useCallback, useRef, useState } from 'react';
import {
    ActiveVisitSession,
    KeyFact,
    SummaryItem,
    VisitStatus,
    VisitSummary,
} from '@/types';
import { approveVisit as approveVisitApi, updateVisitStatus, getVisit, saveVisitProgress } from '@/services/api';

function isDialogueTurn(value: unknown): value is import('@/types').DialogueTurn {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.speaker === 'string' && typeof item.text === 'string';
}

function normalizeDialogue(dialogue: unknown): import('@/types').DialogueTurn[] {
    if (!Array.isArray(dialogue)) return [];
    return dialogue
        .filter(isDialogueTurn)
        .map((turn) => ({
            speaker: turn.speaker,
            text: turn.text,
            start: typeof turn.start === 'number' ? turn.start : 0,
            end: typeof turn.end === 'number' ? turn.end : 0,
        }));
}
interface UseVisitSummaryReturn {
    currentVisit: ActiveVisitSession | null;
    startNewVisit: (patientId: string, visitId?: string) => Promise<void>;
    updateTranscript: (transcript: string, dialogue?: ActiveVisitSession['dialogue']) => void;
    updateSummary: (summary: VisitSummary) => void;
    updateSnapshot: (items: KeyFact[]) => void;
    updateDoctorActions: (items: SummaryItem[]) => void;
    updateParagraphs: (issuesParagraph: string, actionsParagraph: string) => void;
    setVisitStatus: (status: VisitStatus) => void;
    approveVisit: (visitId: string, summaryOverride?: VisitSummary) => Promise<void>;
    discardVisit: (visitId?: string) => Promise<void>;
}
const createEmptySummary = (): VisitSummary => ({
    clinicalSnapshot: [],
    doctorActions: [],
    prescriptions: [],
    prescriptionDraft: null,
    issuesParagraph: '',
    actionsParagraph: '',
    chiefComplaint: '',
    structuredFindings: [],
    sourceFacts: [],
    sections: {
        historyOfPresentIllness: [],
        negativeFindings: [],
        riskFactors: [],
        pastHistory: [],
        medicationHistory: [],
        allergies: [],
        vitals: [],
        examination: [],
        assessment: [],
        medications: [],
        investigations: [],
        carePlan: [],
        warnings: [],
        followUp: [],
        unmapped: [],
    },
    quality: {
        score: 0,
        confidence: 0,
        missingFields: ['chiefComplaint', 'doctorActions', 'medications'],
        mode: 'hybrid',
        coverage: 0,
        sourceFactCount: 0,
        mappedFactCount: 0,
        unmappedFactIds: [],
        criticalMisses: [],
        sectionCounts: {},
    },
});

const createDraftVisit = (patientId: string): ActiveVisitSession => ({
    visitId: '',
    patientId,
    transcript: '',
    dialogue: [],
    summary: createEmptySummary(),
    status: 'pending',
    createdAt: new Date().toISOString(),
});

function coerceParagraphText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
        const maybeText = (value as { text?: unknown }).text;
        if (typeof maybeText === 'string') return maybeText.trim();
    }
    return '';
}


export function useVisitSummary(): UseVisitSummaryReturn {
    const [currentVisit, setCurrentVisit] = useState<ActiveVisitSession | null>(null);
    const currentVisitRef = useRef<ActiveVisitSession | null>(null);

    const setVisit = useCallback((next: ActiveVisitSession | null) => {
        currentVisitRef.current = next;
        setCurrentVisit(next);
    }, []);

    const patchVisit = useCallback((updater: (visit: ActiveVisitSession) => ActiveVisitSession) => {
        setCurrentVisit(previous => {
            if (!previous) {
                currentVisitRef.current = null;
                return null;
            }

            const nextVisit = updater(previous);
            currentVisitRef.current = nextVisit;
            return nextVisit;
        });
    }, []);

    const startNewVisit = useCallback(async (patientId: string, visitId?: string) => {
        let draft = createDraftVisit(patientId);

        if (visitId) {
            try {
                const visit = await getVisit(visitId);
                if (visit) {
                    draft = {
                        visitId: visit.id,
                        patientId: visit.patientId,
                        transcript: visit.transcript || '',
                        dialogue: normalizeDialogue(visit.dialogue || []),
                        summary: visit.summary || createEmptySummary(),
                        status: visit.status as VisitStatus,
                        createdAt: visit.createdAt,
                    };
                }
            } catch (err) {
                console.error('Failed to fetch visit for recovery:', err);
                draft.visitId = visitId;
            }
        }

        setVisit(draft);
    }, [setVisit]);

    const updateTranscript = useCallback(
        (transcript: string, dialogue?: ActiveVisitSession['dialogue']) => {
            patchVisit(visit => {
                const nextDialogue = dialogue ?? visit.dialogue;
                const nextVisit = {
                    ...visit,
                    transcript,
                    dialogue: nextDialogue,
                };

                if (transcript.trim() && visit.visitId) {
                    saveVisitProgress(visit.visitId, {
                        transcript,
                        dialogue: nextDialogue,
                    }).catch((err) => {
                        console.warn('[useVisitSummary] Failed to auto-save visit progress:', err);
                    });
                }

                return nextVisit;
            });
        },
        [patchVisit]
    );
    const updateSnapshot = useCallback(
        (items: KeyFact[]) => {
            patchVisit(visit => ({
                ...visit,
                summary: {
                    ...visit.summary,
                    clinicalSnapshot: items,
                },
            }));
        },
        [patchVisit]
    );

    const updateSummary = useCallback(
        (summary: VisitSummary) => {
            patchVisit(visit => ({
                ...visit,
                summary: {
                    ...summary,
                    issuesParagraph: coerceParagraphText(summary.issuesParagraph),
                    actionsParagraph: coerceParagraphText(summary.actionsParagraph),
                },
            }));
        },
        [patchVisit]
    );

    const updateDoctorActions = useCallback(
        (items: SummaryItem[]) => {
            patchVisit(visit => ({
                ...visit,
                summary: {
                    ...visit.summary,
                    doctorActions: items,
                },
            }));
        },
        [patchVisit]
    );

    const updateParagraphs = useCallback(
        (issuesParagraph: string, actionsParagraph: string) => {
            patchVisit(visit => ({
                ...visit,
                summary: {
                    ...visit.summary,
                    issuesParagraph: coerceParagraphText(issuesParagraph),
                    actionsParagraph: coerceParagraphText(actionsParagraph),
                },
            }));
        },
        [patchVisit]
    );

    const setVisitStatus = useCallback(
        (status: VisitStatus) => {
            patchVisit(visit => ({
                ...visit,
                status,
            }));
        },
        [patchVisit]
    );

    const approveVisit = useCallback(async (visitId: string, summaryOverride?: VisitSummary) => {
        const activeVisit = currentVisitRef.current;
        if (!activeVisit || !visitId) {
            return;
        }

        await approveVisitApi(visitId, summaryOverride ?? activeVisit.summary);
        setVisit(null);
    }, [setVisit]);

    const discardVisit = useCallback(
        async (visitId?: string) => {
            if (visitId) {
                try {
                    await updateVisitStatus(visitId, 'cancelled');
                } catch (err) {
                    console.warn('[useVisitSummary] Failed to cancel visit on backend, continuing with local discard:', err);
                }
            }

            setVisit(null);
        },
        [setVisit]
    );


    return {
        currentVisit,
        startNewVisit,
        updateTranscript,
        updateSummary,
        updateSnapshot,
        updateDoctorActions,
        updateParagraphs,
        setVisitStatus,
        approveVisit,
        discardVisit,
    };
}
