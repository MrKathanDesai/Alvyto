'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface DialogueTurn {
    speaker: 'Doctor' | 'Patient' | 'Unknown';
    text: string;
    start: number;
    end: number;
}

interface UseWhisperLiveOptions {
    whisperEndpoint?: string;
    onTranscriptUpdate?: (confirmed: string, partial: string) => void;
    onError?: (error: string) => void;
}

interface UseWhisperLiveReturn {
    isRecording: boolean;
    isTranscribing: boolean;
    confirmedText: string;
    partialText: string;
    fullTranscript: string;
    confidence: number;
    dialogue: DialogueTurn[];
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<string>;
    clearTranscript: () => void;
    error: string | null;
    recordingDuration: number;
    isWhisperAvailable: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
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
    const [isDiarizationAvailable, setIsDiarizationAvailable] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isRecordingRef = useRef(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const wsUrl = whisperEndpoint.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws/transcribe';

    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch(`${whisperEndpoint}/health`);
                if (res.ok) {
                    const data = await res.json();
                    setIsWhisperAvailable(true);
                    setIsDiarizationAvailable(data.diarization === true);
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

                    if (data.type === 'transcription') {
                        const confirmed = data.confirmed || '';
                        const partial = data.partial || '';
                        const conf = data.confidence || 0;

                        setConfirmedText(confirmed);
                        setPartialText(partial);
                        setConfidence(conf);
                        onTranscriptUpdate?.(confirmed, partial);
                    } else if (data.type === 'session_start') {
                        // Session started
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
            setConfidence(0);
            audioChunksRef.current = [];
            setRecordingDuration(0);

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

            // Try WebSocket-first approach
            let useWebSocket = false;
            try {
                await connectWebSocket();
                useWebSocket = true;
            } catch (e) {
                console.warn('WebSocket failed, falling back to HTTP chunking');
            }

            if (useWebSocket && wsRef.current) {
                // Setup audio processing for WebSocket streaming
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
                const source = audioContextRef.current.createMediaStreamSource(stream);

                // Use ScriptProcessor for raw PCM access (deprecated but reliable)
                // Buffer size 4096 = ~256ms at 16kHz
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

                // Also record full audio via MediaRecorder for final transcription on stop
                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm';
                const recorder = new MediaRecorder(stream, { mimeType });
                mediaRecorderRef.current = recorder;
                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        audioChunksRef.current.push(e.data);
                    }
                };
                recorder.start(1000);
            } else {
                // HTTP fallback: use MediaRecorder
                const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm';

                const recorder = new MediaRecorder(stream, { mimeType });
                mediaRecorderRef.current = recorder;

                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        audioChunksRef.current.push(e.data);
                    }
                };

                recorder.start(1000);  // 1s chunks

                // Process chunks every 3 seconds
                const processChunks = async () => {
                    if (!isRecordingRef.current || audioChunksRef.current.length === 0) return;

                    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    if (blob.size > 5000) {
                        try {
                            const formData = new FormData();
                            formData.append('audio', blob, 'chunk.webm');

                            const response = await fetch(`${whisperEndpoint}/transcribe/chunk`, {
                                method: 'POST',
                                body: formData,
                            });

                            if (response.ok) {
                                const data = await response.json();
                                if (data.text) {
                                    // HTTP mode: all text is provisional until final
                                    setPartialText(data.text);
                                    setConfidence(data.confidence || 0);
                                    onTranscriptUpdate?.('', data.text);
                                }
                            }
                        } catch (e) {
                            console.warn('Chunk processing failed:', e);
                        }
                    }
                };

                // Start chunk processing interval
                const chunkInterval = setInterval(processChunks, 3000);
                (window as unknown as { __chunkInterval?: NodeJS.Timeout }).__chunkInterval = chunkInterval;
            }

            // Start duration timer
            timerRef.current = setInterval(() => {
                setRecordingDuration(d => d + 1);
            }, 1000);

            setIsRecording(true);
            isRecordingRef.current = true;
            setDialogue([]); // Clear dialogue on start

        } catch (err) {
            let errorMessage = 'Failed to start recording';
            if (err instanceof Error) {
                if (err.name === 'NotAllowedError') {
                    errorMessage = 'Microphone permission denied';
                } else if (err.name === 'NotFoundError') {
                    errorMessage = 'No microphone found';
                } else {
                    errorMessage = err.message;
                }
            }
            setError(errorMessage);
            onError?.(errorMessage);
        }
    }, [connectWebSocket, whisperEndpoint, onTranscriptUpdate, onError]);

    // Stop recording
    const stopRecording = useCallback(async (): Promise<string> => {
        console.log('[useWhisperLive] stopRecording called');
        isRecordingRef.current = false;

        // Stop timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        // Stop chunk interval
        const chunkInterval = (window as unknown as { __chunkInterval?: NodeJS.Timeout }).__chunkInterval;
        if (chunkInterval) {
            clearInterval(chunkInterval);
            delete (window as unknown as { __chunkInterval?: NodeJS.Timeout }).__chunkInterval;
        }

        // Stop WebSocket
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        // Stop audio context
        if (processorRef.current && audioContextRef.current) {
            processorRef.current.disconnect();
            audioContextRef.current.close();
            processorRef.current = null;
            audioContextRef.current = null;
        }

        setIsRecording(false);
        setConnectionStatus('disconnected');

        // Stop recorder explicitly ensuring we capture the final blob
        const recorder = mediaRecorderRef.current;
        let finalTranscriptionPromise: Promise<string> | null = null;

        if (recorder) {
            console.log('[useWhisperLive] Waiting for recorder to stop...');
            finalTranscriptionPromise = new Promise((resolve) => {
                recorder.onstop = async () => {
                    console.log('[useWhisperLive] recorder.onstop fired');
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    console.log(`[useWhisperLive] Final blob size: ${audioBlob.size} bytes`);

                    // Stop stream tracks now that we have our blob
                    if (streamRef.current) {
                        streamRef.current.getTracks().forEach(track => track.stop());
                        streamRef.current = null;
                    }

                    if (audioBlob.size > 0) {
                        setIsTranscribing(true);
                        try {
                            const formData = new FormData();
                            formData.append('audio', audioBlob, 'recording.webm');
                            console.log('[useWhisperLive] Sending to /transcribe?diarize=true');
                            const response = await fetch(`${whisperEndpoint}/transcribe?diarize=true`, {
                                method: 'POST',
                                body: formData,
                            });

                            if (response.ok) {
                                const data = await response.json();
                                console.log('[useWhisperLive] Transcribe response:', data);

                                const finalResponseText = data.text || '';

                                // Only update if we got actual text, OR if we really want to clear it (rare).
                                // Safety: if final is empty but we had live text, prefer keeping live text 
                                // to avoid "disappearing" content.
                                if (finalResponseText.length > 5) {
                                    setConfirmedText(finalResponseText);
                                    setPartialText('');
                                } else {
                                    console.warn('[useWhisperLive] Final text empty/short, keeping live transcript');
                                    // Just commit whatever partial we had
                                    const fallback = (confirmedText + ' ' + partialText).trim();
                                    setConfirmedText(fallback);
                                    setPartialText('');
                                }

                                setConfidence(data.confidence || 0);
                                if (data.dialogue && Array.isArray(data.dialogue)) {
                                    setDialogue(data.dialogue);
                                }
                                resolve(finalResponseText || confirmedText);
                            } else {
                                console.error('[useWhisperLive] Transcribe failed:', response.status);
                                resolve(confirmedText + ' ' + partialText);
                            }
                        } catch (e) {
                            console.error('[useWhisperLive] Transcribe error:', e);
                            resolve(confirmedText + ' ' + partialText);
                        } finally {
                            setIsTranscribing(false);
                        }
                    } else {
                        console.warn('[useWhisperLive] Audio blob was empty');
                        resolve(confirmedText + ' ' + partialText);
                    }
                };
            });

            if (recorder.state !== 'inactive') {
                recorder.stop();
            } else {
                console.warn('[useWhisperLive] Recorder was already inactive');
                // If somehow already inactive, manually fire handler logic or callback
                // But generally with this flow it should be active.
                // Tricky part: if it IS inactive, onstop won't fire again.
                // We should force stream stop here just in case.
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            }
        } else {
            // No recorder, just stop stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        }

        if (finalTranscriptionPromise) {
            return finalTranscriptionPromise;
        }

        // If no recorder promise, return current text
        const finalFallback = confirmedText + (partialText ? ' ' + partialText : '');
        setConfirmedText(finalFallback.trim());
        setPartialText('');
        return finalFallback.trim();
    }, [whisperEndpoint, confirmedText, partialText]);

    const clearTranscript = useCallback(() => {
        setConfirmedText('');
        setPartialText('');
        setConfidence(0);
        setError(null);
        setRecordingDuration(0);
        setDialogue([]);
    }, []);

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
        clearTranscript,
        error,
        recordingDuration,
        isWhisperAvailable,
        connectionStatus,
    };
}
