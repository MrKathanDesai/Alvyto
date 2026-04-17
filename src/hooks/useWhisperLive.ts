'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { KeyFactCategory, VisitSummary } from '@/types';
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

function isGenericSnapshotLabel(label: string): boolean {
    const normalized = normalizeText(label);
    if (!normalized) return true;
    if (GENERIC_SNAPSHOT_LABELS.has(normalized)) return true;
    if (label.includes(' - ')) {
        const [left = '', right = ''] = label.split(' - ', 2).map(normalizeText);
        if (!left || !right) return true;
        if (left === right) return true;
        if (GENERIC_SNAPSHOT_LABELS.has(left) && GENERIC_SNAPSHOT_LABELS.has(right)) return true;
    }
    return false;
}

function inferChiefComplaintFromDialogue(dialogue: DialogueTurn[]): string {
    const patientTurns = dialogue
        .filter((turn) => turn.speaker.toLowerCase().includes('patient'))
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
    return value;
}

function isPatientTurn(turn: DialogueTurn, doctorName?: string, patientName?: string): boolean {
    return normalizeSpeakerRole(turn.speaker, doctorName, patientName) === 'Patient';
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
    const extracted = extractStructuredFindings(dialogue, doctorName, patientName);

    const enrichedSnapshot = (result.clinicalSnapshot ?? []).map((item) => ({
        ...item,
        label: trimFactLabel(item.label),
        confidence: item.confidence ?? 0.8,
        evidence: item.evidence ?? extracted.find((f) => f.label.toLowerCase().includes(item.label.toLowerCase()) || item.label.toLowerCase().includes(f.label.toLowerCase()))?.evidence,
        status: item.status ?? (item.category === 'negative' ? 'denied' : 'confirmed'),
    }));

    const fallbackSnapshot = extracted.map((f) => ({
        label: trimFactLabel(f.label),
        category: f.category,
        isSupported: true,
        confidence: f.confidence,
        evidence: f.evidence,
        status: f.status,
    }));

    const filteredSnapshot = enrichedSnapshot.filter((item) => {
        return !isGenericSnapshotLabel(item.label) && !isNoiseChunk(item.label);
    });

    const snapshotWithFallback = filteredSnapshot.length > 0 ? filteredSnapshot : fallbackSnapshot;

    const clinicalSnapshot = snapshotWithFallback.map((item) => {
        if (item.category === 'symptom' && !item.label.includes(' - ') && item.evidence) {
            return {
                ...item,
                label: trimFactLabel(`${item.label} - ${item.evidence}`),
            };
        }
        return item;
    });

    const candidateChiefComplaint = result.chiefComplaint?.trim()
        || clinicalSnapshot.find((f) => f.category === 'symptom' && (f.status ?? 'confirmed') !== 'denied')?.label
        || inferChiefComplaintFromDialogue(dialogue)
        || '';

    const chiefComplaint = isNoiseChunk(candidateChiefComplaint)
        ? inferChiefComplaintFromDialogue(dialogue)
        : candidateChiefComplaint;

    const structuredFindings = (result.structuredFindings && result.structuredFindings.length > 0)
        ? result.structuredFindings
        : extracted;

    const missingFields: string[] = [];
    if (!chiefComplaint) missingFields.push('chiefComplaint');
    if ((result.prescriptionDraft?.medications?.length ?? 0) === 0) missingFields.push('medications');
    if ((result.doctorActions?.length ?? 0) === 0) missingFields.push('doctorActions');

    const quality = {
        ...(result.quality ?? {}),
        score: Math.max(15, 100 - missingFields.length * 18),
        confidence: clamp01(
            (clinicalSnapshot.reduce((acc, item) => acc + (item.confidence ?? 0.7), 0) / Math.max(1, clinicalSnapshot.length))
        ),
        missingFields,
        mode: result.quality?.mode ?? ('hybrid' as const),
        generatedAt: result.quality?.generatedAt ?? new Date().toISOString(),
    };

    const mergedDoctorActions = [...(result.doctorActions ?? [])].reduce<VisitSummary['doctorActions']>((acc, action) => {
        const text = compactText(action.text || '');
        if (!text) return acc;
        const key = text.toLowerCase();
        if (acc.some((item) => compactText(item.text).toLowerCase() === key)) return acc;
        acc.push({ ...action, text });
        return acc;
    }, []).slice(0, 8);

    return {
        ...result,
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
        label: trimFactLabel(item.label),
        category: item.category,
        isSupported: true,
        confidence: item.confidence,
        evidence: item.evidence,
        status: item.status,
    }));

    const missingFields: string[] = [];
    if (!chiefComplaint) missingFields.push('chiefComplaint');
    if (doctorActions.length === 0) missingFields.push('doctorActions');

    return {
        clinicalSnapshot,
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
            confidence: clamp01(clinicalSnapshot.reduce((acc, item) => acc + (item.confidence ?? 0.7), 0) / Math.max(1, clinicalSnapshot.length)),
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

        let triggeredViaWs = false;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && sessionId) {
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
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsRecording(false);
        setIsPaused(false);
        isPausedRef.current = false;
        setConnectionStatus('disconnected');

        if (!sessionId) {
            console.error('[useWhisperLive] No active session ID to process');
            return { text: confirmedText, dialogue: dialogue };
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
                        processResp = await fetch(`${whisperEndpoint}/process/${sessionId}${queryStr}`, {
                            method: 'POST',
                            headers: getRoomAgentHeaders(),
                        });
                        if (processResp.ok) break;
                        if (processResp.status !== 404) break;
                    }

                    if (!processResp || !processResp.ok) {
                        // Last chance: if status endpoint exists, pipeline may already be active.
                        const statusProbe = await fetch(`${whisperEndpoint}/session/${sessionId}/status`, {
                            headers: getRoomAgentHeaders(),
                        });
                        if (!statusProbe.ok) {
                            throw new Error(`HTTP ${processResp?.status}`);
                        }
                    }
                }

                const interval = setInterval(async () => {
                    pollCount++;
                        if (pollCount >= MAX_POLLS) {
                            clearInterval(interval);
                            setIsTranscribing(false);
                            setProcessingStage(null);
                            setError('Transcription timed out after 5 minutes. Please try again.');
                            if (wsRef.current) {
                                wsRef.current.close();
                                wsRef.current = null;
                            }
                            resolve({ text: confirmedText, dialogue });
                            return;
                        }

                    try {
                        const statusResp = await fetch(`${whisperEndpoint}/session/${sessionId}/status`, {
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
                                    wsRef.current.close();
                                    wsRef.current = null;
                                }
                                resolve({ text: confirmedText, dialogue });
                                return;
                            }

                            const finalDialogue = data.dialogue || [];
                            const finalSamples = data.speaker_samples || [];
                            const finalSummary = data.summary;

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
                                setDialogue(finalDialogue);
                                if (wsRef.current) {
                                    wsRef.current.close();
                                    wsRef.current = null;
                                }
                                resolve({ text: finalText, dialogue: finalDialogue, summary: finalSummary });
                            }
                        } else if (statusData.status === 'error' || statusData.error) {
                            clearInterval(interval);
                            setIsTranscribing(false);
                            setError(statusData.error || "WhisperX processing failed");
                            setProcessingStage(null);
                            if (wsRef.current) {
                                wsRef.current.close();
                                wsRef.current = null;
                            }
                            resolve({ text: confirmedText, dialogue: dialogue });
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
                    wsRef.current.close();
                    wsRef.current = null;
                }
                resolve({ text: confirmedText, dialogue });
            }
        });
    }, [sessionId, whisperEndpoint, confirmedText, dialogue, stopAutoSaveInterval, stopDurationTimer]);

    const clearTranscript = useCallback(() => {
        stopAutoSaveInterval();
        stopDurationTimer();
        accumulatedDurationRef.current = 0;
        recordingStartRef.current = null;

        setConfirmedText('');
        setPartialText('');
        setLivePreviewText('');
        setConfidence(0);
        setError(null);
        setRecordingDuration(0);
        setIsPaused(false);
        isPausedRef.current = false;
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
            // No explicit remapping provided — keep detected speaker labels as-is.
            finalDialogue = backendDialogue.map(turn => ({
                ...turn,
                speaker: turn.speaker,
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
                speaker: backendRoleToActualName[turn.speaker] ?? turn.speaker,
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
