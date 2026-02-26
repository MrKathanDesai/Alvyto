'use client';

import { useRef, useEffect } from 'react';
import styles from './TranscriptionPanel.module.css';
import type { DialogueTurn } from '@/hooks/useWhisperLive';

interface TranscriptionPanelProps {
    confirmedText: string;
    partialText: string;
    confidence?: number;
    isRecording: boolean;
    isProcessing: boolean;
    connectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    dialogue?: DialogueTurn[];
}

export default function TranscriptionPanel({
    confirmedText,
    partialText,
    confidence = 0,
    isRecording,
    isProcessing,
    connectionStatus = 'disconnected',
    dialogue = [],
}: TranscriptionPanelProps) {
    const contentRef = useRef<HTMLDivElement>(null);

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
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.spinIcon}>
                                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                            </svg>
                            Processing...
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.content} ref={contentRef}>
                {isEmpty ? (
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
                ) : !isRecording && dialogue.length > 0 ? (
                    <div className={styles.dialogue}>
                        {dialogue.map((turn, i) => (
                            <div key={i} className={`${styles.dialogueTurn} ${styles[`speaker${turn.speaker}`]}`}>
                                <span className={`${styles.speakerLabel} ${styles[`label${turn.speaker}`]}`}>
                                    {turn.speaker === 'Doctor' ? '👨‍⚕️' : '🧑'} {turn.speaker}
                                </span>
                                <p className={styles.turnText}>{turn.text}</p>
                            </div>
                        ))}
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
                        {isRecording && <span className={styles.cursor} />}
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
