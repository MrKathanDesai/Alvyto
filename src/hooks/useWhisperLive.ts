'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

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
}

interface UseWhisperLiveOptions {
    whisperEndpoint?: string;
    onTranscriptUpdate?: (confirmed: string, partial: string) => void;
    onError?: (error: string) => void;
}

export interface UseWhisperLiveReturn {
    isRecording: boolean;
    isTranscribing: boolean;
    confirmedText: string;
    partialText: string;
    fullTranscript: string;
    confidence: number;
    dialogue: DialogueTurn[];
    startRecording: () => Promise<void>;
    stopRecording: (doctorName?: string, patientName?: string) => Promise<{ text: string; dialogue: DialogueTurn[] }>;
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
}

export function useWhisperLive(
    options: UseWhisperLiveOptions = {}
): UseWhisperLiveReturn {
    const {
        whisperEndpoint = 'http://localhost:8000',
        onTranscriptUpdate,
        onError,
    } = options;

    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
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
    const [rawSegments, setRawSegments] = useState<any[]>([]);
    const [backendDialogue, setBackendDialogue] = useState<DialogueTurn[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const isRecordingRef = useRef(false);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const confirmationResolverRef = useRef<((value: { text: string; dialogue: DialogueTurn[] }) => void) | null>(null);
    const namesRef = useRef<{ doctor?: string, patient?: string }>({});

    const wsUrl = whisperEndpoint.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/transcribe';

    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch(`${whisperEndpoint}/health`);
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

    // Connect WebSocket
    const connectWebSocket = useCallback((): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
            setConnectionStatus('connecting');

            const ws = new WebSocket(wsUrl);
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
                            setRecordingDuration(data.duration || recordingDuration);
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
    }, [wsUrl, onTranscriptUpdate]);

    // Start recording with WebSocket streaming
    const startRecording = useCallback(async () => {
        try {
            setError(null);
            setConfirmedText('');
            setPartialText('');
            setLivePreviewText('');
            setConfidence(0);
            setRecordingDuration(0);
            setIsConfirming(false);
            setRawSegments([]);
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

            await connectWebSocket();

            if (wsRef.current) {
                // Setup audio processing for WebSocket streaming
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
                const source = audioContextRef.current.createMediaStreamSource(stream);

                const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;

                processor.onaudioprocess = (e) => {
                    if (!isRecordingRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
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
            timerRef.current = setInterval(() => {
                setRecordingDuration(d => d + 1);
            }, 1000);

            setIsRecording(true);
            isRecordingRef.current = true;
            setDialogue([]); // Clear dialogue on start

        } catch (err) {
            let errorMessage = 'Failed to start recording';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
            onError?.(errorMessage);
        }
    }, [connectWebSocket, onError]);


    // Stop recording
    const stopRecording = useCallback(async (doctorName?: string, patientName?: string): Promise<{ text: string; dialogue: DialogueTurn[] }> => {
        console.log('[useWhisperLive] stopRecording called', doctorName, patientName);
        namesRef.current = { doctor: doctorName, patient: patientName };
        isRecordingRef.current = false;

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

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

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsRecording(false);
        setConnectionStatus('disconnected');

        if (!sessionId) {
            console.error('[useWhisperLive] No active session ID to process');
            return { text: confirmedText, dialogue: dialogue };
        }

        return new Promise(async (resolve) => {
            setIsTranscribing(true);

            try {
                const params = new URLSearchParams();
                if (doctorName) params.append('doctor_name', doctorName);
                if (patientName) params.append('patient_name', patientName);
                const queryStr = params.toString() ? `?${params.toString()}` : '';

                const processResp = await fetch(`${whisperEndpoint}/process/${sessionId}${queryStr}`, { method: 'POST' });
                if (!processResp.ok) throw new Error(`HTTP ${processResp.status}`);

                const interval = setInterval(async () => {
                    try {
                        const statusResp = await fetch(`${whisperEndpoint}/session/${sessionId}/status`);
                        const statusData = await statusResp.json();

                        if (statusData.status === 'completed') {
                            clearInterval(interval);
                            setIsTranscribing(false);

                            const data = statusData.data;
                            const finalDialogue = data.dialogue || [];
                            const finalSamples = data.speaker_samples || [];
                            const rawSegs = data.raw_segments || [];

                            setRawSegments(rawSegs);
                            setBackendDialogue(finalDialogue);
                            setSpeakerSamples(finalSamples);

                            // Let the UI confirmation take over if there are samples
                            if (finalSamples.length > 0) {
                                setIsConfirming(true);
                                confirmationResolverRef.current = resolve;
                            } else {
                                // No confirmation needed, resolve immediately
                                const finalText = finalDialogue.map((d: any) => d.text).join(' ');
                                setConfirmedText(finalText);
                                setDialogue(finalDialogue);
                                resolve({ text: finalText, dialogue: finalDialogue });
                            }
                        } else if (statusData.status === 'error' || statusData.error) {
                            clearInterval(interval);
                            setIsTranscribing(false);
                            setError(statusData.error || "WhisperX processing failed");
                            resolve({ text: confirmedText, dialogue: dialogue });
                        }
                    } catch (e) {
                        console.error("Error polling processing status", e);
                    }
                }, 3000);
            } catch (e) {
                console.error("Error starting WhisperX post-processing", e);
                setIsTranscribing(false);
                resolve({ text: confirmedText, dialogue });
            }
        });
    }, [sessionId, whisperEndpoint, confirmedText, dialogue]);

    const clearTranscript = useCallback(() => {
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
        setRawSegments([]);
    }, []);

    const confirmSpeakersClientSide = useCallback((assignments: Record<string, string> | null) => {
        let finalDialogue: DialogueTurn[] = [];

        if (!assignments) {
            // Use auto-detected dialogue generated by the backend
            // In a real scenario you might need to rebuild or trust the backend's auto-map
            finalDialogue = backendDialogue;
        } else {
            const doctorName = namesRef.current.doctor || "Doctor";
            const patientName = namesRef.current.patient || "Patient";

            const roleToName: Record<string, string> = {
                "Doctor": doctorName,
                "Patient": patientName,
                "Companion": "Companion"
            };

            // Re-map using doctor's confirmed assignments
            const remapped = rawSegments.map(seg => {
                const role = assignments[seg.speaker] || "Unknown";
                const mappedName = roleToName[role] || role;
                return { ...seg, speaker: mappedName };
            });

            // Merge consecutive same-speaker turns
            for (const seg of remapped) {
                if (finalDialogue.length && finalDialogue[finalDialogue.length - 1].speaker === seg.speaker) {
                    finalDialogue[finalDialogue.length - 1].text += " " + seg.text.trim();
                    finalDialogue[finalDialogue.length - 1].end = seg.end;
                } else {
                    finalDialogue.push({
                        speaker: seg.speaker,
                        text: seg.text.trim(),
                        start: seg.start,
                        end: seg.end
                    });
                }
            }
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
    }, [rawSegments, backendDialogue]);

    const fullTranscript = confirmedText + (partialText ? ' ' + partialText : '');

    return {
        isRecording,
        isTranscribing,
        confirmedText,
        partialText,
        fullTranscript: fullTranscript.trim(),
        confidence,
        dialogue,
        startRecording,
        stopRecording,
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
    };
}
