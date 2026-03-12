'use client';

import { useRef, useEffect } from 'react';
import styles from './TranscriptionPanel.module.css';
import type { DialogueTurn, SpeakerSample } from '@/hooks/useWhisperLive';

interface TranscriptionPanelProps {
    confirmedText: string;
    partialText: string;
    livePreviewText?: string;
    confidence?: number;
    isRecording: boolean;
    isProcessing: boolean;
    connectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    dialogue?: DialogueTurn[];
    onReassign?: (turnIndex: number, newSpeaker: string) => void;
    speakerSamples?: SpeakerSample[];
    onConfirmSpeakers?: (mapping: Record<string, string>) => void;
}

function SpeakerAvatar({ name }: { name: string }) {
    function getInitials(fullName: string) {
        if (!fullName || fullName === "Unknown") return "?";
        const cleaned = fullName.replace(/^Dr\.?\s*/i, "").trim();
        const parts = cleaned.split(" ").filter(Boolean);
        if (parts.length === 0) return "?";
        if (parts.length === 1) return parts[0][0].toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function getColor(name: string) {
        if (!name || name === "Unknown") return { bg: "#f0f0f0", text: "#999999" };
        const colors = [
            { bg: "#E3F2FD", text: "#1565C0" }, // blue
            { bg: "#E8F5E9", text: "#2E7D32" }, // green
            { bg: "#FFF3E0", text: "#E65100" }, // orange
            { bg: "#F3E5F5", text: "#6A1B9A" }, // purple
        ];
        const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return colors[hash % colors.length];
    }

    const initials = getInitials(name);
    const { bg, text } = getColor(name);

    return (
        <div
            style={{
                backgroundColor: bg,
                color: text,
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                letterSpacing: "0.05em",
                marginRight: "8px"
            }}
        >
            {initials}
        </div>
    );
}

export default function TranscriptionPanel({
    confirmedText,
    partialText,
    livePreviewText,
    confidence = 0,
    isRecording,
    isProcessing,
    connectionStatus = 'disconnected',
    dialogue = [],
    onReassign,
    speakerSamples,
    onConfirmSpeakers,
}: TranscriptionPanelProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const SPEAKER_OPTIONS = ["Doctor", "Patient", "Companion"];

    // Auto-scroll to bottom when text updates
    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [confirmedText, partialText]);

    const isEmpty = !confirmedText && !partialText;
    const confidencePercent = Math.round(confidence * 100);

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Live Transcription
                    {isRecording && (
                        <span className={styles.draftLabel}>(draft)</span>
                    )}
                </h2>

                <div className={styles.statusGroup}>
                    {/* Confidence indicator */}
                    {(confirmedText || partialText) && confidence > 0 && (
                        <div className={styles.confidenceIndicator} title={`Confidence: ${confidencePercent}%`}>
                            <div
                                className={styles.confidenceBar}
                                style={{
                                    width: `${confidencePercent}%`,
                                    backgroundColor: confidence > 0.8 ? 'var(--color-success)' :
                                        confidence > 0.5 ? 'var(--color-warning)' :
                                            'var(--color-danger)'
                                }}
                            />
                            <span className={styles.confidenceText}>{confidencePercent}%</span>
                        </div>
                    )}

                    {/* Connection status */}
                    {isRecording && connectionStatus === 'connected' && (
                        <div className={styles.liveIndicator}>
                            <span className={styles.liveDot} />
                            LIVE
                        </div>
                    )}

                    {isRecording && connectionStatus === 'connecting' && (
                        <div className={styles.liveIndicator} style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                            Connecting...
                        </div>
                    )}

                    {isProcessing && (
                        <div className={styles.liveIndicator} style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={styles.spinIcon}>
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                                <path d="M12 2C6.47715 2 2 6.47715 2 12" />
                            </svg>
                            Processing...
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.content} ref={contentRef}>
                {isEmpty && !isRecording && !isProcessing ? (
                    <div className={styles.placeholder}>
                        <svg
                            className={styles.placeholderIcon}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        <h3 className={styles.placeholderTitle}>No transcription yet</h3>
                        <p className={styles.placeholderText}>
                            Start recording to see live transcription appear here.
                        </p>
                    </div>
                ) : isEmpty && isRecording && !livePreviewText ? (
                    <div className={styles.placeholder}>
                        <div className={styles.recordingPulse}></div>
                        <h3 className={styles.placeholderTitle}>Recording...</h3>
                        <p className={styles.placeholderText}>
                            Audio is being captured and buffered securely on the device.
                        </p>
                    </div>
                ) : isEmpty && isProcessing ? (
                    <div className={styles.placeholder}>
                        <div className={styles.loadingSpinner}></div>
                        <h3 className={styles.placeholderTitle}>Processing Audio</h3>
                        <p className={styles.placeholderText}>
                            Running advanced WhisperX transcription and exact word-level diarization...
                        </p>
                    </div>
                ) : !isRecording && dialogue.length > 0 ? (
                    <div className={styles.dialogue}>
                        {dialogue.map((turn, i) => {
                            const isUnknown = turn.speaker === "Unknown";
                            return (
                                <div key={i} className={`${styles.dialogueTurn} ${styles[`speaker${turn.speaker}`]} ${isUnknown ? styles.speakerUnknown : ''}`}>
                                    <div className={styles.turnHeader} style={{ display: 'flex', alignItems: 'center' }}>
                                        <SpeakerAvatar name={turn.speaker} />
                                        <span className={`${styles.speakerLabel} ${styles[`label${turn.speaker}`]}`}>
                                            {turn.speaker}
                                        </span>
                                        {isUnknown && onReassign && (
                                            <select
                                                className={styles.reassignSelect}
                                                defaultValue=""
                                                onChange={(e) => {
                                                    if (e.target.value) {
                                                        onReassign(i, e.target.value);
                                                    }
                                                }}
                                            >
                                                <option value="" disabled>Assign to...</option>
                                                {SPEAKER_OPTIONS.map(opt => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                    <p className={styles.turnText}>{turn.text}</p>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className={styles.transcript}>
                        {confirmedText && (
                            <span className={styles.confirmedText}>{confirmedText}</span>
                        )}
                        {partialText && (
                            <span className={styles.partialText}>
                                {confirmedText ? ' ' : ''}{partialText}
                            </span>
                        )}
                        {livePreviewText && isRecording && (
                            <div className={styles.livePreviewBanner}>
                                <span className={styles.previewLabel}>● Recording — live preview</span>
                                <p className={styles.previewText}>{livePreviewText}</p>
                                <span className={styles.previewNote}>Final diarized transcript will appear after Stop</span>
                            </div>
                        )}
                        {isRecording && !livePreviewText && <span className={styles.cursor} />}
                    </div>
                )}
            </div>

            {isRecording && (
                <div className={styles.footer}>
                    <span className={styles.footerHint}>
                        💡 Text may update as transcription refines
                    </span>
                </div>
            )}
        </div>
    );
}
