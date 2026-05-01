'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { KeyFact, KeyFactCategory, VisitSummary } from '@/types';
import { saveVisitProgress } from '@/services/api';
import { getRoomAgentHeaders, withRoomAgentToken } from '@/utils/roomAgentAuth';
export interface DialogueTurn {
    speaker: 'Doctor' | 'Patient' | 'Unknown' | string;
    text: string;
    start: number;
    end: number;
}

export interface SpeakerSample {
    speaker_id: string;
    sample_text: string;
    start: number;
    backend_role?: string; // Current server-side display label for this detected speaker
}
interface UseWhisperLiveOptions {
    whisperEndpoint?: string;
    onTranscriptUpdate?: (confirmed: string, partial: string) => void;
    onError?: (error: string) => void;
    visitId?: string | null;
}
export interface UseWhisperLiveReturn {
    isRecording: boolean;
    isPaused: boolean;
    isTranscribing: boolean;
    isSummarizing: boolean;
    confirmedText: string;
    partialText: string;
    fullTranscript: string;
    confidence: number;
    dialogue: DialogueTurn[];
    startRecording: (customSessionId?: string | null, customVisitId?: string | null) => Promise<void>;
    pauseRecording: () => void;
    resumeRecording: () => void;
    stopRecording: (doctorName?: string, patientName?: string) => Promise<{ text: string; dialogue: DialogueTurn[] }>;
    generateSummary: (dialogue: DialogueTurn[], medicalHistory?: Record<string, unknown> | null) => Promise<VisitSummary | undefined>;
    generateQuickSummary: (dialogue: DialogueTurn[]) => VisitSummary;
    updateDialogue: (newDialogue: DialogueTurn[]) => void;
    clearTranscript: () => void;
    error: string | null;
    recordingDuration: number;
    isWhisperAvailable: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    speakerSamples: SpeakerSample[];
    isConfirming: boolean;
    confirmSpeakersClientSide: (mapping: Record<string, string> | null) => void;
    livePreviewText: string;
    processingStage: string | null;
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function categoryFromLabel(label: string): KeyFactCategory {
    const lower = label.toLowerCase();
    if (/\b(no|denies|without|not)\b/.test(lower)) return 'negative';
    if (/\b(day|days|week|weeks|month|months|since|yesterday|today)\b/.test(lower)) return 'duration';
    if (/\bmorning|night|evening|after|before|intermittent|continuous\b/.test(lower)) return 'timing';
    if (/\btablet|capsule|mg|ml|paracetamol|ibuprofen|aspirin|antibiotic|medication\b/.test(lower)) return 'medication';
    if (/\bavoid|exercise|diet|hydrate|rest|sleep\b/.test(lower)) return 'lifestyle';
    if (/\bwarning|allergy|allergic|reaction|bleeding|severe\b/.test(lower)) return 'warning';
    if (/\badvise|plan|start|continue|stop|review|follow\b/.test(lower)) return 'action';
    return 'symptom';
}

function compactText(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function normalizeText(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function trimFactLabel(input: string): string {
    return compactText(input).slice(0, 100);
}

const GENERIC_PRESCRIPTION_NAMES = new Set([
    'medicine',
    'medication',
    'this medicine',
    'care',
    'treatment',
    'tablet',
    'capsule',
    'drug',
]);

const JUNK_DOCTOR_ACTION_PATTERNS = [
    /^(take care|you'?ll be (fine|ok(?:ay)?)|feel better|get well|goodbye|bye)\b/i,
    /^(good (morning|afternoon|evening))\b/i,
    /^(thank you|thanks)\b/i,
];

const NOISE_PATTERNS = [
    /^(all right|alright|okay|ok|hmm|uh|um|sure|thanks|thank you)\b/i,
    /^(good (morning|afternoon|evening|bye))\b/i,
    /^(how are you|how long have|what'?s the problem|what brings you)\b/i,
    /^(do you have|are you|did you|have you|does it)\b/i,
    /^(you'?ll be (fine|ok)|take care|feel better|get well)\b/i,
    /^please have a seat\b/i,
    /^let'?s do this\b/i,
    /^(symptom|issue|regular words?)$/i,
    /\?$/,
];

const GENERIC_SNAPSHOT_LABELS = new Set([
    'symptom',
    'symptoms',
    'issue',
    'have',
    'had',
    'just',
    'problem',
    'complaint',
    'duration',
    'timing',
    'finding',
    'findings',
    'inquiry',
    'question',
    'fever inquiry',
    'headache inquiry',
    'pain inquiry',
    'duration of symptoms',
    'location of pain',
    'location',
    'trigger food drink',
    'trigger food/drink',
    'weight loss',
    'night symptoms',
    'frequency',
    'frequency of symptom',
    'medication use',
    'associated symptom with food/drink',
    'lifestyle factor related to symptoms',
    'symptom relief attempts',
]);

const COMPLAINT_HINT_PATTERNS = [
    /\b(pain|burning|cough|fever|breathless|breathlessness|nausea|vomiting|headache|dizziness|tightness|reflux|acidity|itching|swelling)\b/i,
    /\b(since|for\s+\d+|worse|worsened|night|after meals|after food)\b/i,
];

function isNoiseChunk(chunk: string): boolean {
    const text = compactText(chunk);
    if (!text || text.length < 6) return true;
    return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

// Matches LLM-generated category meta-labels like "Duration of headache",
// "Location of pain", "Onset of fever", "Frequency of cough", etc.
const GENERIC_CATEGORY_PREFIXES = /^(duration|location|onset|frequency|timing|severity|nature|character|quality|pattern|history|progression|associated|trigger|relief|aggravating|relieving factor) of\b/i;

// Matches pure inquiry/question labels: "X inquiry", "X question", "X symptom"
const GENERIC_INQUIRY_SUFFIXES = /\b(inquiry|question|symptom|complaint|finding|factor|attempt)s?$/i;

function isGenericSnapshotLabel(label: string): boolean {
    const normalized = normalizeText(label);
    if (!normalized) return true;
    if (GENERIC_SNAPSHOT_LABELS.has(normalized)) return true;
    if (GENERIC_CATEGORY_PREFIXES.test(label)) return true;
    if (GENERIC_INQUIRY_SUFFIXES.test(label) && label.split(' ').length <= 4) return true;
    if (label.includes(' - ')) {
        const [left = '', right = ''] = label.split(' - ', 2).map(normalizeText);
        if (!left || !right) return true;
        if (left === right) return true;
        if (GENERIC_SNAPSHOT_LABELS.has(left) && GENERIC_SNAPSHOT_LABELS.has(right)) return true;
    }
    return false;
}

function normalizeDedupKey(value: string): string {
    return normalizeText(value)
        .replace(/\bfor\b/g, '')
        .replace(/\bhave\b/g, '')
        .replace(/\bhad\b/g, '')
        .replace(/\bjust\b/g, '')
        .replace(/\ba\b/g, '')
        .replace(/\ban\b/g, '')
        .replace(/\bthe\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanSnapshotLabel(label: string, category: KeyFactCategory): string {
    const text = trimFactLabel(label);
    if (!text) return '';

    if (category === 'symptom') {
        const stripped = text
            .replace(/^good morning[,]?\s*doctor[,]?\s*/i, '')
            .replace(/^i\s+(have|had|am having)\s+/i, '')
            .replace(/^just\s+/i, '')
            .trim();
        return trimFactLabel(stripped || text);
    }

    if (category === 'duration') {
        const durationMatch = text.match(/\b(for\s+)?((?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:day|days|week|weeks|month|months))\b/i);
        if (durationMatch?.[2]) {
            return trimFactLabel(durationMatch[2]);
        }
    }

    if (category === 'negative') {
        return trimFactLabel(text.replace(/^no[, ]*/i, 'No ').trim());
    }

    return text;
}

function inferSnapshotCategory(label: string, fallback: KeyFactCategory): KeyFactCategory {
    const normalized = normalizeText(label);
    if (!normalized) return fallback;
    if (/\b(no|denies|without|not)\b/.test(normalized)) return 'negative';
    if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(day|days|week|weeks|month|months)\b/.test(normalized)) return 'duration';
    if (/\b(after|before|morning|night|evening|daily|hour|hours|weekly)\b/.test(normalized)) return 'timing';
    if (/\b(paracetamol|ibuprofen|amoxicillin|pantoprazole|tablet|capsule|mg|ml)\b/.test(normalized)) return 'medication';
    return fallback;
}

function chooseBetterSnapshotFact(current: KeyFact, candidate: KeyFact): KeyFact {
    const currentConfidence = current.confidence ?? 0;
    const candidateConfidence = candidate.confidence ?? 0;

    if (candidateConfidence > currentConfidence) return candidate;
    if (candidateConfidence < currentConfidence) return current;
    if (candidate.category === 'symptom' && current.category !== 'symptom') return candidate;
    if (candidate.category !== 'symptom' && current.category === 'symptom') return current;
    return candidate.label.length < current.label.length ? candidate : current;
}

function sanitizeClinicalSnapshot(items: KeyFact[]): KeyFact[] {
    const deduped = new Map<string, KeyFact>();

    for (const item of items) {
        const category = inferSnapshotCategory(item.label, (item.category ?? 'symptom') as KeyFactCategory);
        const cleanedLabel = cleanSnapshotLabel(item.label, category);
        if (!cleanedLabel) continue;
        if (isGenericSnapshotLabel(cleanedLabel) || isNoiseChunk(cleanedLabel)) continue;

        const normalizedItem: KeyFact = {
            ...item,
            label: cleanedLabel,
            category,
            status: item.status ?? (category === 'negative' ? 'denied' : 'confirmed'),
        };

        const key = `${category}:${normalizeDedupKey(cleanedLabel)}`;
        const existing = deduped.get(key);
        if (!existing) {
            deduped.set(key, normalizedItem);
        } else {
            deduped.set(key, chooseBetterSnapshotFact(existing, normalizedItem));
        }
    }

    return [...deduped.values()].slice(0, 10);
}

function cleanDoctorActionText(value: unknown): string {
    let text = '';

    if (typeof value === 'string') {
        text = value;
    } else if (value && typeof value === 'object') {
        const candidate = value as { text?: unknown; action?: unknown; label?: unknown; note?: unknown };
        const raw = [candidate.text, candidate.action, candidate.label, candidate.note].find((item) => typeof item === 'string');
        text = typeof raw === 'string' ? raw : '';
    }

    text = compactText(text);
    if (!text) return '';

    const objectMatch = text.match(/['"]action['"]\s*:\s*['"](.+?)['"]/i);
    if (objectMatch?.[1]) {
        text = compactText(objectMatch[1]);
    }

    return text;
}

function isMeaningfulDoctorAction(text: string): boolean {
    if (!text) return false;
    if (JUNK_DOCTOR_ACTION_PATTERNS.some((pattern) => pattern.test(text))) return false;
    if (text.endsWith('?')) return false;
    return text.split(/\s+/).length >= 3;
}

function sanitizeDoctorActions(actions: VisitSummary['doctorActions']): VisitSummary['doctorActions'] {
    const deduped = new Map<string, VisitSummary['doctorActions'][number]>();

    actions.forEach((action, index) => {
        const text = cleanDoctorActionText(action);
        if (!isMeaningfulDoctorAction(text)) return;

        const normalizedAction = {
            ...action,
            id: action.id || `action-${index}`,
            text,
        };
        const key = normalizeDedupKey(text);
        const existing = deduped.get(key);
        if (!existing || existing.text.length > normalizedAction.text.length) {
            deduped.set(key, normalizedAction);
        }
    });

    return [...deduped.values()].slice(0, 8);
}

function sanitizeMedicationInstructions(name: string, instructions?: string): string | undefined {
    const text = compactText(instructions || '');
    if (!text) return undefined;

    let cleaned = text;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`\\b${escapedName}\\b`, 'ig'), '').trim();
    cleaned = cleaned.replace(/\b(in order to|would recommend you to|recommend you to)\b/ig, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ').replace(/^[,\s.]+|[,\s.]+$/g, '');
    return cleaned || undefined;
}

function sanitizeMedicationDetails(result: VisitSummary): VisitSummary {
    const sanitizeMed = (med: NonNullable<VisitSummary['prescriptionDraft']>['medications'][number]) => {
        const name = compactText(med.name || '');
        const dosage = compactText(med.dosage || '');
        const frequency = compactText(med.frequency || '');
        const instructions = sanitizeMedicationInstructions(name, med.instructions);

        return {
            ...med,
            name,
            dosage: dosage || undefined,
            frequency: frequency || undefined,
            instructions,
        };
    };

    return {
        ...result,
        prescriptionDraft: result.prescriptionDraft
            ? {
                ...result.prescriptionDraft,
                medications: (result.prescriptionDraft.medications ?? []).map(sanitizeMed),
                advice: (result.prescriptionDraft.advice ?? []).map((item) => compactText(item)).filter((item) => item && !JUNK_DOCTOR_ACTION_PATTERNS.some((pattern) => pattern.test(item))),
            }
            : null,
    };
}

function isMeaningfulPrescriptionName(name: string): boolean {
    const normalized = normalizeText(name);
    if (!normalized) return false;
    if (GENERIC_PRESCRIPTION_NAMES.has(normalized)) return false;
    if (/^(this|that|the)\s+(medicine|medication|tablet|capsule|drug)$/i.test(normalized)) return false;
    return true;
}

function sanitizePrescriptionDraft(result: VisitSummary): VisitSummary {
    const medicationCleaned = sanitizeMedicationDetails(result);
    const sanitizedPrescriptions = (medicationCleaned.prescriptions ?? []).filter((rx) => isMeaningfulPrescriptionName(rx.name));
    const sanitizedDraftMeds = (medicationCleaned.prescriptionDraft?.medications ?? []).filter((med) => isMeaningfulPrescriptionName(med.name));

    return {
        ...medicationCleaned,
        prescriptions: sanitizedPrescriptions,
        prescriptionDraft: medicationCleaned.prescriptionDraft
            ? {
                ...medicationCleaned.prescriptionDraft,
                medications: sanitizedDraftMeds,
            }
            : null,
    };
}

function inferChiefComplaintFromDialogue(dialogue: DialogueTurn[]): string {
    const patientTurns = dialogue
        .filter((turn) => isPatientTurn(turn))
        .map((turn) => compactText(turn.text))
        .filter(Boolean);

    for (const turn of patientTurns) {
        const sentences = turn.split(/[.!?]/).map((part) => compactText(part)).filter(Boolean);
        for (const sentence of sentences) {
            if (isNoiseChunk(sentence)) continue;
            if (COMPLAINT_HINT_PATTERNS.some((pattern) => pattern.test(sentence))) {
                return sentence.slice(0, 100);
            }
        }
    }

    const firstMeaningful = patientTurns.find((turn) => !isNoiseChunk(turn));
    return firstMeaningful ? firstMeaningful.slice(0, 100) : '';
}

function normalizeSpeakerRole(speaker: string, doctorName?: string, patientName?: string): string {
    const value = compactText(speaker);
    const lower = value.toLowerCase();
    const normalizedDoctor = compactText(doctorName || '').toLowerCase();
    const normalizedPatient = compactText(patientName || '').toLowerCase();

    if (!value) return 'Unknown';
    if (lower.includes('doctor') || (normalizedDoctor && lower === normalizedDoctor)) return 'Doctor';
    if (lower.includes('patient') || (normalizedPatient && lower === normalizedPatient)) return 'Patient';
    if (/^speaker[\s_-]?\d+$/i.test(value) || /^s\d+$/i.test(value)) return 'Patient';
    return value;
}

function isPatientTurn(turn: DialogueTurn, doctorName?: string, patientName?: string): boolean {
    const normalizedRole = normalizeSpeakerRole(turn.speaker, doctorName, patientName);
    if (normalizedRole === 'Patient') return true;
    if (normalizedRole === 'Doctor') return false;
    return !compactText(turn.speaker).toLowerCase().includes('doctor');
}

function extractStructuredFindings(dialogue: DialogueTurn[], doctorName?: string, patientName?: string): NonNullable<VisitSummary['structuredFindings']> {
    const seen = new Set<string>();
    const findings: NonNullable<VisitSummary['structuredFindings']> = [];

    dialogue.forEach((turn, idx) => {
        if (!isPatientTurn(turn, doctorName, patientName)) return;
        const text = compactText(turn.text || '');
        if (!text) return;

        const chunks = text
            .split(/[.!?]/)
            .map((chunk) => compactText(chunk))
            .filter(Boolean)
            .slice(0, 3);

        chunks.forEach((chunk, cIdx) => {
            if (chunk.length < 8 || isNoiseChunk(chunk)) return;
            const normalized = chunk.toLowerCase();
            if (seen.has(normalized)) return;
            seen.add(normalized);

            const category = categoryFromLabel(chunk);
            const status = /\b(no|denies|without|not)\b/i.test(chunk)
                ? 'denied'
                : /\bmaybe|possible|likely|probably\b/i.test(chunk)
                    ? 'probable'
                    : 'confirmed';

            findings.push({
                id: `f-${idx}-${cIdx}`,
                label: trimFactLabel(chunk),
                category,
                status,
                confidence: clamp01(status === 'probable' ? 0.62 : status === 'denied' ? 0.76 : 0.84),
                evidence: chunk,
            });
        });
    });

    return findings.slice(0, 24);
}

function buildHybridSummary(result: VisitSummary, dialogue: DialogueTurn[], doctorName?: string, patientName?: string): VisitSummary {
    const sanitizedResult = sanitizePrescriptionDraft(result);
    const extracted = extractStructuredFindings(dialogue, doctorName, patientName);

    const enrichedSnapshot = (sanitizedResult.clinicalSnapshot ?? []).map((item) => ({
        ...item,
        label: cleanSnapshotLabel(item.label, item.category),
        confidence: item.confidence ?? 0.8,
        evidence: item.evidence ?? extracted.find((f) => f.label.toLowerCase().includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(f.label.toLowerCase()))?.evidence,
        status: item.status ?? (item.category === 'negative' ? 'denied' : 'confirmed'),
    }));

    const fallbackSnapshot = extracted.map((f) => ({
        label: cleanSnapshotLabel(f.label, f.category),
        category: f.category,
        isSupported: true,
        confidence: f.confidence,
        evidence: f.evidence,
        status: f.status,
    }));

    const snapshotWithFallback = enrichedSnapshot.length > 0 ? enrichedSnapshot : fallbackSnapshot;
    const clinicalSnapshot = sanitizeClinicalSnapshot(snapshotWithFallback);

    const candidateChiefComplaint = sanitizedResult.chiefComplaint?.trim()
        || clinicalSnapshot.find((f) => f.category === 'symptom' && (f.status ?? 'confirmed') !== 'denied')?.label
        || inferChiefComplaintFromDialogue(dialogue)
        || '';

    const chiefComplaint = isNoiseChunk(candidateChiefComplaint)
        ? inferChiefComplaintFromDialogue(dialogue)
        : candidateChiefComplaint;

    const structuredFindings = (sanitizedResult.structuredFindings && sanitizedResult.structuredFindings.length > 0)
        ? sanitizedResult.structuredFindings
        : extracted;

    const missingFields: string[] = [];
    if (!chiefComplaint) missingFields.push('chiefComplaint');
    if ((sanitizedResult.prescriptionDraft?.medications?.length ?? 0) === 0) missingFields.push('medications');
    if ((sanitizedResult.doctorActions?.length ?? 0) === 0) missingFields.push('doctorActions');

    const quality = {
        ...(sanitizedResult.quality ?? {}),
        score: Math.max(15, 100 - missingFields.length * 18),
        confidence: clamp01(
            (clinicalSnapshot.reduce((acc, item) => acc + (item.confidence ?? 0.7), 0) / Math.max(1, clinicalSnapshot.length))
        ),
        missingFields,
        mode: sanitizedResult.quality?.mode ?? ('hybrid' as const),
        generatedAt: sanitizedResult.quality?.generatedAt ?? new Date().toISOString(),
    };

    const mergedDoctorActions = sanitizeDoctorActions([...(sanitizedResult.doctorActions ?? [])]);

    return {
        ...sanitizedResult,
        clinicalSnapshot,
        doctorActions: mergedDoctorActions,
        chiefComplaint,
        structuredFindings,
        quality,
    };
}

function buildQuickSummary(dialogue: DialogueTurn[], doctorName?: string, patientName?: string): VisitSummary {
    const extracted = extractStructuredFindings(dialogue, doctorName, patientName);
    const positiveFindings = extracted.filter((item) => item.status !== 'denied');

    const chiefComplaint =
        positiveFindings.find((item) => item.category === 'symptom')?.label
        || inferChiefComplaintFromDialogue(dialogue)
        || '';

    const doctorTurns = dialogue
        .filter((turn) => normalizeSpeakerRole(turn.speaker, doctorName, patientName) === 'Doctor')
        .map((turn) => compactText(turn.text))
        .filter(Boolean);

    const doctorActions = doctorTurns.slice(0, 6).map((text, index) => ({
        id: `quick-${index}`,
        text,
        sourceFactIds: [],
        isEdited: false,
        isSupported: true,
    }));

    const clinicalSnapshot = extracted.slice(0, 10).map((item) => ({
        label: cleanSnapshotLabel(item.label, item.category),
        category: item.category,
        isSupported: true,
        confidence: item.confidence,
        evidence: item.evidence,
        status: item.status,
    }));
    const sanitizedSnapshot = sanitizeClinicalSnapshot(clinicalSnapshot);

    const missingFields: string[] = [];
    if (!chiefComplaint) missingFields.push('chiefComplaint');
    if (doctorActions.length === 0) missingFields.push('doctorActions');

    return {
        clinicalSnapshot: sanitizedSnapshot,
        doctorActions,
        prescriptions: [],
        prescriptionDraft: null,
        issuesParagraph: chiefComplaint
            ? `Primary concern appears to be ${chiefComplaint.toLowerCase()}.`
            : 'Primary concern not clearly captured yet.',
        actionsParagraph: doctorActions.length > 0
            ? 'Preliminary plan is available from dialogue and will be refined after full summarization.'
            : 'No clear action plan captured yet.',
        chiefComplaint,
        structuredFindings: extracted,
        sourceFacts: [],
        sections: {
            historyOfPresentIllness: chiefComplaint ? [chiefComplaint] : [],
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
            carePlan: doctorActions.map((item) => item.text),
            warnings: [],
            followUp: [],
            unmapped: [],
        },
        quality: {
            score: Math.max(25, 100 - missingFields.length * 25),
            confidence: clamp01(sanitizedSnapshot.reduce((acc, item) => acc + (item.confidence ?? 0.7), 0) / Math.max(1, sanitizedSnapshot.length)),
            missingFields,
            mode: 'rule_only',
            generatedAt: new Date().toISOString(),
            coverage: 0,
            sourceFactCount: 0,
            mappedFactCount: 0,
            unmappedFactIds: [],
            criticalMisses: [],
            sectionCounts: {},
        },
    };
}

export function useWhisperLive(
    options: UseWhisperLiveOptions = {}
): UseWhisperLiveReturn {
    const {
        whisperEndpoint = process.env.NEXT_PUBLIC_WHISPER_ENDPOINT || 'http://localhost:8000',
        onError,
        visitId,
    } = options;
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [confirmedText, setConfirmedText] = useState('');
    const [partialText, setPartialText] = useState('');
    const [confidence, setConfidence] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [isWhisperAvailable, setIsWhisperAvailable] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const [dialogue, setDialogue] = useState<DialogueTurn[]>([]);
    const [speakerSamples, setSpeakerSamples] = useState<SpeakerSample[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [livePreviewText, setLivePreviewText] = useState('');
    const [isConfirming, setIsConfirming] = useState(false);
    const [backendDialogue, setBackendDialogue] = useState<DialogueTurn[]>([]);
    const [processingStage, setProcessingStage] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const isRecordingRef = useRef(false);
    const isPausedRef = useRef(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    /** Wall-clock timestamp (ms) when the current recording segment started. */
    const recordingStartRef = useRef<number | null>(null);
    /** Seconds accumulated before the most recent pause. */
    const accumulatedDurationRef = useRef<number>(0);
    const confirmationResolverRef = useRef<((value: { text: string; dialogue: DialogueTurn[] }) => void) | null>(null);
    const namesRef = useRef<{ doctor?: string, patient?: string }>({});
    const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const confirmedTextRef = useRef('');
    const dialogueRef = useRef<DialogueTurn[]>([]);
    const visitIdRef = useRef<string | null | undefined>(visitId);
    // Ref mirrors sessionId state so stopRecording always reads the current value
    // even when called from a stale closure (avoids "no session ID" early return on re-record).
    const sessionIdRef = useRef<string | null>(null);
    const wsUrl = whisperEndpoint.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/transcribe';
    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch(`${whisperEndpoint}/health`, {
                    headers: getRoomAgentHeaders(),
                });
                if (res.ok) {
                    await res.json();
                    setIsWhisperAvailable(true);
                }
            } catch {
                setIsWhisperAvailable(false);
            }
        };
        checkHealth();
    }, [whisperEndpoint]);

    useEffect(() => {
        confirmedTextRef.current = confirmedText;
    }, [confirmedText]);

    useEffect(() => {
        dialogueRef.current = dialogue;
    }, [dialogue]);

    useEffect(() => {
        visitIdRef.current = visitId;
    }, [visitId]);

    useEffect(() => {
        return () => {
            if (autoSaveIntervalRef.current) {
                clearInterval(autoSaveIntervalRef.current);
                autoSaveIntervalRef.current = null;
            }
        };
    }, []);

    const startDurationTimer = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        recordingStartRef.current = Date.now();
        timerRef.current = setInterval(() => {
            if (recordingStartRef.current !== null) {
                const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
                setRecordingDuration(accumulatedDurationRef.current + elapsed);
            }
        }, 500);
    }, []);

    const stopDurationTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        // Freeze accumulated time at the moment of stopping/pausing
        if (recordingStartRef.current !== null) {
            accumulatedDurationRef.current += Math.floor((Date.now() - recordingStartRef.current) / 1000);
            recordingStartRef.current = null;
        }
    }, []);

    const startAutoSaveInterval = useCallback(() => {
        if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
        }

        autoSaveIntervalRef.current = setInterval(() => {
            const currentVisitId = visitIdRef.current;
            if (!currentVisitId) {
                return;
            }

            const latestTranscript = confirmedTextRef.current;
            const latestDialogue = dialogueRef.current;

            if (!latestTranscript.trim() && latestDialogue.length === 0) {
                return;
            }

            saveVisitProgress(currentVisitId, {
                transcript: latestTranscript,
                dialogue: latestDialogue,
            }).catch((saveError) => {
                console.warn('[useWhisperLive] Failed to auto-save visit progress:', saveError);
            });
        }, 30000);
    }, []);

    const stopAutoSaveInterval = useCallback(() => {
        if (autoSaveIntervalRef.current) {
            clearInterval(autoSaveIntervalRef.current);
            autoSaveIntervalRef.current = null;
        }
    }, []);

    // Connect WebSocket
    const connectWebSocket = useCallback((customSessionId?: string | null, customVisitId?: string | null): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            setConnectionStatus('connecting');
            const nextUrl = new URL(wsUrl, window.location.origin);
            if (customSessionId) {
                nextUrl.searchParams.set('session_id', customSessionId);
            }
            const effectiveVisitId = customVisitId ?? visitIdRef.current;
            if (effectiveVisitId) {
                nextUrl.searchParams.set('visit_id', effectiveVisitId);
            }
            const url = withRoomAgentToken(nextUrl.toString());

            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                // WebSocket connected
                setConnectionStatus('connected');
                resolve(ws);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'recording_progress') {
                        // The server sends us how much audio it has buffered.
                        setRecordingDuration(data.duration || 0);
                    } else if (data.type === 'session_start') {
                        // Session started
                        if (data.session_id) {
                            sessionIdRef.current = data.session_id;
                            setSessionId(data.session_id);
                        }
                    } else if (data.type === 'live_preview') {
                        // Used for visual proof-of-life only
                        if (data.text) {
                            setLivePreviewText(data.text);
                            setRecordingDuration(data.duration || 0);
                        }
                    }
                } catch (e) {
                    console.warn('Failed to parse WebSocket message:', e);
                }
            };

            ws.onerror = (e) => {
                console.error('WebSocket error:', e);
                setConnectionStatus('error');
                reject(new Error('WebSocket connection failed'));
            };

            ws.onclose = () => {
                // WebSocket closed
                setConnectionStatus('disconnected');
            };

            wsRef.current = ws;
        });
    }, [wsUrl]);

    // Start recording with WebSocket streaming
    const startRecording = useCallback(async (customSessionId?: string | null, customVisitId?: string | null) => {
        try {
            setError(null);
            setConfirmedText('');
            setPartialText('');
            setLivePreviewText('');
            setConfidence(0);
            setRecordingDuration(0);
            accumulatedDurationRef.current = 0;
            recordingStartRef.current = null;
            setIsConfirming(false);
            setProcessingStage(null);
            setBackendDialogue([]);

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
            streamRef.current = stream;

            await connectWebSocket(customSessionId, customVisitId);

            if (wsRef.current) {
                // Setup audio processing for WebSocket streaming
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
                const source = audioContextRef.current.createMediaStreamSource(stream);

                const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    if (!isRecordingRef.current || isPausedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                        return;
                    }

                    const inputData = e.inputBuffer.getChannelData(0);
                    // Send as float32 PCM
                    const buffer = new Float32Array(inputData);
                    wsRef.current.send(buffer.buffer);
                };

                source.connect(processor);
                processor.connect(audioContextRef.current.destination);
            }

            // Start duration timer just in case WS messages drop
            startDurationTimer();

            setIsRecording(true);
            isRecordingRef.current = true;
            setIsPaused(false);
            isPausedRef.current = false;
            setDialogue([]); // Clear dialogue on start

            startAutoSaveInterval();
        } catch (err) {
            let errorMessage = 'Failed to start recording';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
            onError?.(errorMessage);
        }
    }, [connectWebSocket, onError, startAutoSaveInterval, startDurationTimer]);

    const pauseRecording = useCallback(() => {
        if (!isRecordingRef.current || isPausedRef.current) {
            return;
        }

        setIsPaused(true);
        isPausedRef.current = true;
        stopDurationTimer();
        stopAutoSaveInterval();
    }, [stopAutoSaveInterval, stopDurationTimer]);

    const resumeRecording = useCallback(() => {
        if (!isRecordingRef.current || !isPausedRef.current) {
            return;
        }

        setIsPaused(false);
        isPausedRef.current = false;
        startDurationTimer();
        startAutoSaveInterval();
    }, [startAutoSaveInterval, startDurationTimer]);

    // Stop recording
    const stopRecording = useCallback(async (doctorName?: string, patientName?: string): Promise<{ text: string; dialogue: DialogueTurn[]; summary?: VisitSummary }> => {
        console.log('[useWhisperLive] stopRecording called', doctorName, patientName);
        namesRef.current = { doctor: doctorName, patient: patientName };
        isRecordingRef.current = false;

        stopAutoSaveInterval();
        stopDurationTimer();
        if (processorRef.current && audioContextRef.current) {
            processorRef.current.disconnect();
            audioContextRef.current.close();
            processorRef.current = null;
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // Read session ID from ref so we always have the current value regardless
        // of when this callback was last recreated (avoids stale-closure misses on re-record).
        const activeSessionId = sessionIdRef.current;

        let triggeredViaWs = false;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activeSessionId) {
            try {
                wsRef.current.send(JSON.stringify({
                    type: 'stop_recording',
                    doctor_name: 'Doctor',
                    patient_name: 'Patient',
                }));
                triggeredViaWs = true;
            } catch (sendErr) {
                console.warn('[useWhisperLive] Failed stop_recording over WS, will fallback to REST:', sendErr);
            }
        }

        if (!triggeredViaWs && wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsRecording(false);
        setIsPaused(false);
        isPausedRef.current = false;
        setConnectionStatus('disconnected');

        if (!activeSessionId) {
            console.error('[useWhisperLive] No active session ID to process');
            return { text: confirmedTextRef.current, dialogue: dialogueRef.current };
        }

        return new Promise(async (resolve) => {
            setIsTranscribing(true);

            // Safety: stop polling after 5 minutes (100 × 3s) — pipeline can be slow on CPU
            const MAX_POLLS = 100;
            let pollCount = 0;

            try {
                // Always pass generic role labels to the API so backendDialogue
                // consistently uses "Doctor"/"Patient" as speaker labels.
                // Actual names are stored in namesRef for use during confirmation.
                const params = new URLSearchParams();
                params.append('doctor_name', 'Doctor');
                params.append('patient_name', 'Patient');
                const effectiveVisitId = visitIdRef.current;
                if (effectiveVisitId) {
                    params.append('visit_id', effectiveVisitId);
                }
                const queryStr = `?${params.toString()}`;

                if (!triggeredViaWs) {
                    // Retry POST to handle disconnect/process race when WS stop trigger was not sent.
                    let processResp: Response | null = null;
                    for (let attempt = 0; attempt < 12; attempt++) {
                        if (attempt > 0) {
                            await new Promise(r => setTimeout(r, 500));
                        }
                        processResp = await fetch(`${whisperEndpoint}/process/${activeSessionId}${queryStr}`, {
                            method: 'POST',
                            headers: getRoomAgentHeaders(),
                        });
                        if (processResp.ok) break;
                        if (processResp.status !== 404) break;
                    }

                    if (!processResp || !processResp.ok) {
                        // Last chance: if status endpoint exists, pipeline may already be active.
                        const statusProbe = await fetch(`${whisperEndpoint}/session/${activeSessionId}/status`, {
                            headers: getRoomAgentHeaders(),
                        });
                        if (!statusProbe.ok) {
                            throw new Error(`HTTP ${processResp?.status}`);
                        }
                    }
                }

                let notFoundStrikes = 0;
                const MAX_NOT_FOUND_STRIKES = 5;
                const interval = setInterval(async () => {
                    pollCount++;
                        if (pollCount >= MAX_POLLS) {
                            clearInterval(interval);
                            setIsTranscribing(false);
                            setProcessingStage(null);
                            setError('Transcription timed out after 5 minutes. Please try again.');
                            if (wsRef.current) {
                                wsRef.current.onclose = null;
                                wsRef.current.close();
                                wsRef.current = null;
                            }
                            resolve({ text: confirmedTextRef.current, dialogue: dialogueRef.current });
                            return;
                        }

                    try {
                        const statusResp = await fetch(`${whisperEndpoint}/session/${activeSessionId}/status`, {
                            headers: getRoomAgentHeaders(),
                        });
                        const statusData = await statusResp.json();

                        if (statusData.status === 'completed') {
                            clearInterval(interval);
                            setIsTranscribing(false);

                            const data = statusData.data;

                            // Detect pipeline-level errors wrapped inside the "completed" envelope
                            if (data?.status === 'error' || data?.error) {
                                console.error('[useWhisperLive] Pipeline error:', data?.error);
                                setError(`Transcription failed: ${data?.error || 'Unknown error'}`);
                                setProcessingStage(null);
                                if (wsRef.current) {
                                    wsRef.current.onclose = null;
                                    wsRef.current.close();
                                    wsRef.current = null;
                                }
                                resolve({ text: confirmedTextRef.current, dialogue: dialogueRef.current });
                                return;
                            }

                            const finalDialogue = data.dialogue || [];
                            const finalSamples = data.speaker_samples || [];

                            setBackendDialogue(finalDialogue);
                            setSpeakerSamples(finalSamples);
                            setProcessingStage(null);

                            // Let the UI confirmation take over if there are samples
                            if (finalSamples.length > 0) {
                                setIsConfirming(true);
                                confirmationResolverRef.current = resolve;
                            } else {
                                const finalText = finalDialogue.map((d: DialogueTurn) => d.text).join(' ');
                                setConfirmedText(finalText);
                                confirmedTextRef.current = finalText;
                                setDialogue(finalDialogue);
                                dialogueRef.current = finalDialogue;
                                if (wsRef.current) {
                                    wsRef.current.onclose = null;
                                    wsRef.current.close();
                                    wsRef.current = null;
                                }
                                resolve({ text: finalText, dialogue: finalDialogue });
                            }
                        } else if (statusData.status === 'error' || statusData.error) {
                            // "Session not found" can be a transient race — the pipeline may
                            // not have been queued yet. Give it a few strikes before giving up.
                            if (statusResp.status === 404) {
                                notFoundStrikes++;
                                if (notFoundStrikes < MAX_NOT_FOUND_STRIKES) return;
                            }
                            clearInterval(interval);
                            setIsTranscribing(false);
                            setError(statusData.error || "WhisperX processing failed");
                            setProcessingStage(null);
                            if (wsRef.current) {
                                wsRef.current.onclose = null;
                                wsRef.current.close();
                                wsRef.current = null;
                            }
                            resolve({ text: confirmedTextRef.current, dialogue: dialogueRef.current });
                        } else if (statusData.stage) {
                            setProcessingStage(statusData.stage);
                        }
                        // If "processing" (no stage), just keep polling — don't give up
                    } catch (e) {
                        // Network glitch during poll — log but keep retrying (don't resolve empty)
                        console.warn('[useWhisperLive] Poll error (will retry):', e);
                    }
                }, 3000);
            } catch (e) {
                console.error("Error starting WhisperX post-processing", e);
                setIsTranscribing(false);
                setProcessingStage(null);
                if (wsRef.current) {
                    wsRef.current.onclose = null;
                    wsRef.current.close();
                    wsRef.current = null;
                }
                resolve({ text: confirmedTextRef.current, dialogue: dialogueRef.current });
            }
        });
    }, [whisperEndpoint, stopAutoSaveInterval, stopDurationTimer]);

    const clearTranscript = useCallback(() => {
        stopAutoSaveInterval();
        stopDurationTimer();

        // Stop any active recording
        isRecordingRef.current = false;
        isPausedRef.current = false;

        // Disconnect audio processing nodes
        if (processorRef.current) {
            try { processorRef.current.disconnect(); } catch { /* ignore */ }
            processorRef.current = null;
        }
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch { /* ignore */ }
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // Close the WebSocket so its onclose doesn't fire into a future session
        if (wsRef.current) {
            wsRef.current.onclose = null; // suppress the setConnectionStatus('disconnected') side-effect
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }

        accumulatedDurationRef.current = 0;
        recordingStartRef.current = null;
        sessionIdRef.current = null;

        setIsRecording(false);
        setIsPaused(false);
        setIsTranscribing(false);
        setConfirmedText('');
        setPartialText('');
        setLivePreviewText('');
        setConfidence(0);
        setError(null);
        setRecordingDuration(0);
        setDialogue([]);
        setSpeakerSamples([]);
        setSessionId(null);
        setIsConfirming(false);
        setProcessingStage(null);
    }, [stopAutoSaveInterval, stopDurationTimer]);
    const confirmSpeakersClientSide = useCallback((assignments: Record<string, string> | null) => {
        const doctorName = namesRef.current.doctor || "Doctor";
        const patientName = namesRef.current.patient || "Patient";

        const roleToName: Record<string, string> = {
            Doctor: doctorName,
            Patient: patientName,
            Companion: "Companion",
        };

        let finalDialogue: DialogueTurn[];

        if (!assignments) {
            // No explicit assignment — first unique "Speaker X" label is the doctor
            // (recording typically starts with the doctor greeting the patient).
            const speakerOrder: string[] = [];
            for (const turn of backendDialogue) {
                if (!speakerOrder.includes(turn.speaker)) speakerOrder.push(turn.speaker);
            }
            const firstSpeaker = speakerOrder[0] ?? '';
            finalDialogue = backendDialogue.map(turn => ({
                ...turn,
                speaker: normalizeSpeakerRole(turn.speaker, doctorName, patientName) === 'Doctor'
                    || turn.speaker === firstSpeaker
                    ? doctorName
                    : patientName,
            }));
        } else {
            const backendRoleOfSpeaker: Record<string, string> = {};
            speakerSamples.forEach((s) => {
                backendRoleOfSpeaker[s.speaker_id] = s.backend_role ?? s.speaker_id;
            });

            const backendRoleToActualName: Record<string, string> = {};
            for (const [speakerId, userRole] of Object.entries(assignments)) {
                const backendRole = backendRoleOfSpeaker[speakerId] ?? speakerId;
                backendRoleToActualName[backendRole] = roleToName[userRole] ?? userRole;
            }

            finalDialogue = backendDialogue.map(turn => ({
                ...turn,
                speaker: backendRoleToActualName[turn.speaker]
                    ?? (normalizeSpeakerRole(turn.speaker, doctorName, patientName) === 'Doctor' ? doctorName : patientName),
            }));
        }

        const finalText = finalDialogue.map(d => d.text).join(' ');
        setConfirmedText(finalText);
        setDialogue(finalDialogue);
        setIsConfirming(false);
        setSpeakerSamples([]);

        if (confirmationResolverRef.current) {
            confirmationResolverRef.current({ text: finalText, dialogue: finalDialogue });
            confirmationResolverRef.current = null;
        }

        // Close the WebSocket now that the session is fully done — prevents it from
        // orphaning and firing ws.onclose into a future recording session.
        if (wsRef.current) {
            wsRef.current.onclose = null;
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }
    }, [backendDialogue, speakerSamples]);

    // Call this AFTER speaker confirmation to generate the summary from confirmed dialogue
    const generateSummary = useCallback(async (confirmedDialogue: DialogueTurn[], medicalHistory?: Record<string, unknown> | null): Promise<VisitSummary | undefined> => {
        setIsSummarizing(true);
        try {
            const normalizedDialogue = confirmedDialogue.map((turn) => ({
                ...turn,
                speaker: normalizeSpeakerRole(turn.speaker, namesRef.current.doctor, namesRef.current.patient),
            }));

            const resp = await fetch(`${whisperEndpoint}/summarize`, {
                method: 'POST',
                headers: getRoomAgentHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ dialogue: normalizedDialogue, medical_history: medicalHistory ?? null }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const data = await resp.json();
            const result: VisitSummary = {
                clinicalSnapshot: data.clinicalSnapshot ?? [],
                doctorActions: data.doctorActions ?? [],
                prescriptions: data.prescriptions ?? [],
                prescriptionDraft: data.prescriptionDraft ?? null,
                issuesParagraph: data.issuesParagraph ?? '',
                actionsParagraph: data.actionsParagraph ?? '',
                chiefComplaint: data.chiefComplaint ?? '',
                structuredFindings: data.structuredFindings ?? [],
                sourceFacts: data.sourceFacts ?? [],
                sections: data.sections ?? null,
                quality: data.quality ?? undefined,
            };

            const hybrid = buildHybridSummary(result, confirmedDialogue, namesRef.current.doctor, namesRef.current.patient);
            return hybrid;
        } catch (e) {
            console.error('[useWhisperLive] generateSummary failed', e);
            return undefined;
        } finally {
            setIsSummarizing(false);
        }
    }, [whisperEndpoint]);
    const fullTranscript = confirmedText + (partialText ? ' ' + partialText : '');

    return {
        isRecording,
        isPaused,
        isTranscribing,
        isSummarizing,
        confirmedText,
        partialText,
        fullTranscript: fullTranscript.trim(),
        confidence,
        dialogue,
        startRecording,
        pauseRecording,
        resumeRecording,
        stopRecording,
        generateSummary,
        generateQuickSummary: (inputDialogue: DialogueTurn[]) =>
            buildQuickSummary(inputDialogue, namesRef.current.doctor, namesRef.current.patient),
        updateDialogue: setDialogue,
        clearTranscript,
        error,
        recordingDuration,
        isWhisperAvailable,
        connectionStatus,
        speakerSamples,
        isConfirming,
        confirmSpeakersClientSide,
        livePreviewText,
        processingStage,
    };
}
