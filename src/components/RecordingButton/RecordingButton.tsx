'use client';

import styles from './RecordingButton.module.css';
import { VisitStatus } from '@/types';

interface RecordingButtonProps {
    isRecording: boolean;
    isPaused: boolean;
    isProcessing: boolean;
    recordingDuration?: number;
    processingStage?: string | null;
    visitStatus: VisitStatus | null;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onPause: () => void;
    onResume: () => void;
    onSummarize: () => void;
    onApprove: () => void;
    onDiscard: () => void;
}

function formatTime(seconds: number): string {
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function RecordingButton({
    isRecording,
    isPaused,
    isProcessing,
    recordingDuration = 0,
    processingStage,
    visitStatus,
    onStartRecording,
    onStopRecording,
    onPause,
    onResume,
    onSummarize,
    onApprove,
    onDiscard,
}: RecordingButtonProps) {
    const handleClick = () => {
        if (isProcessing) return;

        if (isRecording) {
            onStopRecording();
        } else {
            onStartRecording();
        }
    };

    // Show approved message
    if (visitStatus === 'approved') {
        return (
            <div className={styles.container}>
                <div className={styles.approvedMessage}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    Visit Saved Successfully
                </div>
            </div>
        );
    }

    // Show summarize button if recording is stopped + speakers confirmed
    if (visitStatus === 'ready_to_summarize') {
        return (
            <div className={styles.container}>
                <div className={styles.approveContainer}>
                    <button className={styles.discardBtn} onClick={onDiscard} disabled={isProcessing}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Discard
                    </button>
                    <button className={styles.recordingBtn} onClick={onSummarize} disabled={isProcessing}>
                        {isProcessing ? (
                            <>
                                <svg className={styles.processingIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                                    <path d="M12 2C6.47715 2 2 6.47715 2 12" />
                                </svg>
                                Generating...
                            </>
                        ) : (
                            <>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="16" y1="13" x2="8" y2="13" />
                                    <line x1="16" y1="17" x2="8" y2="17" />
                                    <polyline points="10 9 9 9 8 9" />
                                </svg>
                                Summarize
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    // Show approve button after recording
    if (visitStatus === 'draft' && !isRecording && !isProcessing) {
        return (
            <div className={styles.container}>
                <div className={styles.approveContainer}>
                    <button className={styles.discardBtn} onClick={onDiscard}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Discard
                    </button>
                    <button className={styles.approveBtn} onClick={onApprove}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                        Approve & Save
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {isRecording && (
                <div className={styles.timer}>
                    <span
                        className={styles.timerDot}
                        style={isPaused ? { backgroundColor: 'var(--amber)', animation: 'none' } : undefined}
                    />
                    {formatTime(recordingDuration)}
                    {isPaused && <span className={styles.pausedLabel}>(paused)</span>}
                </div>
            )}

            <div className={styles.actionRow}>
                {isRecording && (
                    <button
                        className={styles.secondaryBtn}
                        onClick={isPaused ? onResume : onPause}
                        disabled={isProcessing}
                        aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                    >
                        {isPaused ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                                Resume
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <rect x="6" y="5" width="4" height="14" rx="1" />
                                    <rect x="14" y="5" width="4" height="14" rx="1" />
                                </svg>
                                Pause
                            </>
                        )}
                    </button>
                )}

                <button
                    className={`${styles.recordingBtn} ${isProcessing ? styles.processing :
                        isRecording ? styles.recording :
                            styles.idle
                        }`}
                    onClick={handleClick}
                    disabled={isProcessing}
                    aria-label={isProcessing ? 'Processing recording' : isRecording ? 'Stop recording' : 'Start recording'}
                    aria-live="polite"
                >
                    {isProcessing ? (
                        <>
                            <svg className={styles.processingIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                                <path d="M12 2C6.47715 2 2 6.47715 2 12" />
                            </svg>
                            {processingStage === 'transcribing' ? 'Transcribing speech...'
                                : processingStage === 'aligning' ? 'Aligning audio...'
                                    : processingStage === 'diarizing' ? 'Identifying speakers...'
                                        : 'Processing...'}
                        </>
                    ) : isRecording ? (
                        <>
                            <svg className={styles.stopIcon} viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                            Stop Recording
                        </>
                    ) : (
                        <>
                            <svg className={styles.micIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            Start Recording
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
