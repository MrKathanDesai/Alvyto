'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseSpeechRecognitionOptions {
    onTranscript?: (text: string, isFinal: boolean) => void;
    onError?: (error: string) => void;
    language?: string;
    continuous?: boolean;
}

interface UseSpeechRecognitionReturn {
    isRecording: boolean;
    isSupported: boolean;
    transcript: string;
    interimTranscript: string;
    startRecording: () => void;
    stopRecording: () => void;
    clearTranscript: () => void;
    error: string | null;
}

// Declare SpeechRecognition types for TypeScript
interface ISpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: ISpeechRecognitionResultList;
}

interface ISpeechRecognitionResultList {
    length: number;
    item(index: number): ISpeechRecognitionResult;
    [index: number]: ISpeechRecognitionResult;
}

interface ISpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): ISpeechRecognitionAlternative;
    [index: number]: ISpeechRecognitionAlternative;
}

interface ISpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface ISpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
}

interface ISpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: ISpeechRecognitionEvent) => void) | null;
    onerror: ((event: ISpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

export function useSpeechRecognition(
    options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
    const {
        onTranscript,
        onError,
        language = 'en-US',
        continuous = true,
    } = options;

    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [interimTranscript, setInterimTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSupported, setIsSupported] = useState(false);

    const recognitionRef = useRef<ISpeechRecognition | null>(null);
    const finalTranscriptRef = useRef('');

    // Check browser support
    useEffect(() => {
        const SpeechRecognitionAPI =
            typeof window !== 'undefined'
                ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
                : null;

        setIsSupported(!!SpeechRecognitionAPI);
    }, []);

    const startRecording = useCallback(() => {
        const SpeechRecognitionAPI =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognitionAPI) {
            const errMsg = 'Speech recognition is not supported in this browser. Please use Chrome or Edge.';
            setError(errMsg);
            onError?.(errMsg);
            return;
        }

        setError(null);

        const recognition = new SpeechRecognitionAPI() as ISpeechRecognition;
        recognitionRef.current = recognition;

        recognition.continuous = continuous;
        recognition.interimResults = true;
        recognition.lang = language;

        recognition.onstart = () => {
            setIsRecording(true);
        };

        recognition.onresult = (event: any) => { // Cast to any to avoid strict Event type mismatch if needed, or ISpeechRecognitionEvent
            const e = event as ISpeechRecognitionEvent;
            let interimText = '';
            let finalText = '';

            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                const text = result[0].transcript;

                if (result.isFinal) {
                    finalText += text + ' ';
                } else {
                    interimText += text;
                }
            }

            if (finalText) {
                finalTranscriptRef.current += finalText;
                setTranscript(finalTranscriptRef.current);
                onTranscript?.(finalTranscriptRef.current, true);
            }

            setInterimTranscript(interimText);

            if (interimText) {
                onTranscript?.(finalTranscriptRef.current + interimText, false);
            }
        };

        recognition.onerror = (event: any) => {
            const e = event as ISpeechRecognitionErrorEvent;
            let errorMessage = 'Speech recognition error';

            switch (e.error) {
                case 'no-speech':
                    errorMessage = 'No speech was detected. Please try again.';
                    break;
                case 'audio-capture':
                    errorMessage = 'No microphone was found or microphone access was denied.';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone permission was denied. Please allow microphone access.';
                    break;
                case 'network':
                    errorMessage = 'Network error occurred. Please check your connection.';
                    break;
                case 'aborted':
                    // User stopped, not an error
                    return;
                default:
                    errorMessage = `Speech recognition error: ${e.error}`;
            }

            setError(errorMessage);
            onError?.(errorMessage);
        };

        recognition.onend = () => {
            // Auto-restart if still recording (for continuous mode)
            if (isRecording && recognitionRef.current) {
                try {
                    recognition.start();
                } catch {
                    setIsRecording(false);
                }
            } else {
                setIsRecording(false);
            }
        };

        try {
            recognition.start();
        } catch (err) {
            const errMsg = 'Failed to start speech recognition';
            setError(errMsg);
            onError?.(errMsg);
        }
    }, [continuous, language, onTranscript, onError, isRecording]);

    const stopRecording = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.onend = null; // Prevent auto-restart
            recognitionRef.current.stop();
            recognitionRef.current = null;
        }
        setIsRecording(false);
        setInterimTranscript('');
    }, []);

    const clearTranscript = useCallback(() => {
        setTranscript('');
        setInterimTranscript('');
        finalTranscriptRef.current = '';
        setError(null);
    }, []);

    return {
        isRecording,
        isSupported,
        transcript,
        interimTranscript,
        startRecording,
        stopRecording,
        clearTranscript,
        error,
    };
}
